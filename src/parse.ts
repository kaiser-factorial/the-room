// Reply sentinel parsing, extracted pure from session.ts so the table of
// model-mangled sentinel variants can be tested directly.

import type { CompletionConfig, JournalConfig, PassConfig, SearchConfig, ToolsConfig } from './types.js';

// Loose sentinel matches: models bold/colon these more often than not —
// and sometimes TYPO them ([GOURNAL], live 2026-08-25: a private entry was
// spoken to the room). A leading bracket token within edit distance 2 of
// JOURNAL counts as the sentinel: mis-journaling a message is recoverable,
// leaking an entry is not.
// `\[\s*` throughout: models put the token on the NEXT line. Qwen wrote
//
//     [
//
//     RUN]
//     s = open('shared/index.html').read()
//
// on three separate turns of one live session, and lost the call every time
// — the bracket was there, the token was there, and nothing in between them
// was. A mangled bracket is a typo and gets fixed; a model writing its OWN
// tool-call envelope instead (Seed's <seed:tool_call>) is deliberately NOT
// accepted, because which models can work in a syntax that is not theirs is
// a finding rather than a bug (Corina 2026-08-29).
const JOURNAL_OPEN_RE = /^\s*\**\[\s*([A-Za-z]{5,9})\s*\]:?\**\s*([\s\S]*)/;
const JOURNAL_CLOSE_RE = /\[\/([A-Za-z]{5,9})\]\s*([\s\S]*)/;
const PASS_RE = /^\s*\**\[PASS\]\**\s*$/i;
// §9.8 [DONE] / [NOT DONE] — standing on, or standing down from, the claim
// that the room's work is finished. Alongside-style by construction: an
// agreement nobody can argue for is not a negotiation, so whatever follows
// the sentinel is spoken to the room as usual. Same typo tolerance as the
// rest of the furniture; the two-word negative forms are spelled out
// because a room that means "not yet" writes it several ways.
const DONE_RE = /^\s*\**\[\s*(NOT[ _-]?DONE|UNDONE|DONE|[A-Za-z]{3,6})\s*\]\**:?\s*\n?([\s\S]*)$/i;
// [SEARCH: query] (F4). Same tolerance philosophy as JOURNAL: bold/typo'd
// tokens still count (edit distance ≤2 of SEARCH — disjoint from JOURNAL,
// which is >2 away). The closing bracket is optional (models drop it), and
// anything AFTER the sentinel is discarded: searching costs the whole turn
// (replace economics), so trailing prose is a mis-formatted extra, not a
// message to leak to the room.
const SEARCH_RE = /^\s*\**\[\s*([A-Za-z]{4,8})(?::|\s)\s*([^\]\n]{0,300})\]?/;
// F4½ tools. [WRITE: name]…[/WRITE] replaces a shared file's contents;
// [APPEND: name]…[/APPEND] adds to the end (same regex, token decides —
// closing tags are interchangeable, models will mix them). Contents are
// room-public by design, so an unterminated block just swallows the rest
// as content. [RUN]…[/RUN] — python; [RUN > file] additionally saves the
// run's output to a shared file, [RUN >> file] appends it (shell-flavored
// on purpose). The unterminated [RUN form takes the whole remainder
// (never leak a half-closed block to the room in the private-run mode).
// All alongside-style: text after the closing tag is spoken as usual.
const WRITE_OPEN_RE = /^\s*\**\[\s*([A-Za-z]{4,6})(?::|\s)\s*([^\]\n]{1,200})\]\**\s*\n?([\s\S]*)$/;
const WRITE_CLOSE_RE = /\[\/([A-Za-z]{4,6})\]\s*([\s\S]*)/;
// [DELETE: name] — one line, no body and no closing tag: there is nothing
// to enclose. Same name grammar as WRITE so `src/old.py` works wherever
// folders do.
const DELETE_RE = /^\s*\**\[\s*([A-Za-z]{5,7})(?::|\s)\s*([^\]\n]{1,200})\]\**\s*\n?([\s\S]*)$/;
const RUN_OPEN_RE = /^\s*\**\[\s*([A-Za-z]{2,4})\s*(?:\s*(>{1,2})\s*([^\]\n>]{1,80}))?\]\**:?\s*\n?([\s\S]*)$/;
const RUN_CLOSE_RE = /\[\/RUN\]\s*([\s\S]*)/i;
// [SOURCE] / [SOURCE: name] — read the tool layer's own code (F4½
// transparency). Alongside-style; bare form asks for the index.
const SOURCE_RE = /^\s*\**\[\s*([A-Za-z]{5,7})\s*(?:(?::|\s)\s*([^\]\n]{0,40}))?\]\**\s*\n?([\s\S]*)$/;
// [CONFIG: key = value] — §9.4 self-governance. Validation happens
// against the whitelist in governance.ts, not here. The value charset
// carries digits since F4¾ ([CONFIG: tools.turnSteps = 4] — the first
// numeric knob a room can vote itself).
const CONFIG_RE = /^\s*\**\[\s*([A-Za-z]{5,7})(?::|\s)\s*([A-Za-z.]{3,40})\s*=\s*([A-Za-z0-9-]{1,20})\s*\]\**\s*\n?([\s\S]*)$/;

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

function isJournalToken(w: string): boolean {
  return editDistance(w.toUpperCase(), 'JOURNAL') <= 2;
}

// [RUN] had NO tolerance while every other sentinel had some, so "[RUNN]"
// fell through the parser and was SPOKEN to the room as prose — the reverse
// of the [GOURNAL] lesson: the harm here is a broken tool call leaking into
// the transcript and the agent learning nothing (found 2026-08-27).
function isRunToken(w: string): boolean {
  const u = w.toUpperCase();
  // Tighter than the other tolerances because RUN is short: one edit from
  // it also reaches RUM and RAN. Requiring "RU…N" keeps RUNN/RUNS/RUNE and
  // rejects words that merely happen to be one letter away.
  return u.startsWith('RU') && u.includes('N') && editDistance(u, 'RUN') <= 1;
}

function isSearchToken(w: string): boolean {
  return editDistance(w.toUpperCase(), 'SEARCH') <= 2;
}

function isWriteToken(w: string): boolean {
  return editDistance(w.toUpperCase(), 'WRITE') <= 1;
}

function isAppendToken(w: string): boolean {
  return editDistance(w.toUpperCase(), 'APPEND') <= 1;
}
function isDeleteToken(w: string): boolean {
  return editDistance(w.toUpperCase(), 'DELETE') <= 1;
}

function isSourceToken(w: string): boolean {
  return editDistance(w.toUpperCase(), 'SOURCE') <= 1;
}

function isConfigToken(w: string): boolean {
  return editDistance(w.toUpperCase(), 'CONFIG') <= 1;
}

/** [DONE] and its withdrawals. Tolerance is 1 (DONE is short: at 2, DOING
 *  and NONE would both count as agreement, and a vote misread is the one
 *  mistake this axis cannot afford). The negative forms are matched FIRST
 *  — "UNDONE" is one edit from nothing else here, but it must never fall
 *  through to the positive branch. */
function doneVote(w: string): boolean | null {
  const u = w.toUpperCase().replace(/[ _-]/g, '');
  if (u === 'NOTDONE' || editDistance(u, 'UNDONE') <= 1) return false;
  // The leading D is the same trick isRunToken plays with "RU…N": one edit
  // from DONE also reaches NONE, GONE and TONE, and a room that writes
  // "[NONE]" must not be recorded as agreeing that its work is finished.
  if (u.startsWith('D') && editDistance(u, 'DONE') <= 1) return true;
  return null;
}

export type ParsedReply =
  | { kind: 'pass' }
  /** Journal replaces the turn (or: alongside-mode privacy fallback — an
   *  opening [JOURNAL] with no closing tag was meant to be private, so the
   *  whole reply becomes the entry rather than leaking to the room). */
  | { kind: 'journal'; entry: string; preamble?: string }
  | { kind: 'alongside'; entry: string; spoken: string; preamble?: string }
  | { kind: 'message'; text: string }
  /** F4 search; results return privately next turn. `spoken` is set only in
   *  alongside mode (`search-free`), where text after the sentinel is a
   *  normal message; in replace mode trailing text is discarded (the
   *  search costs the turn). */
  | { kind: 'search'; query: string; spoken?: string; preamble?: string }
  /** F4½ shared-file write (contents room-public); alongside-style.
   *  append = [APPEND: name] — add to the end instead of replacing. */
  | { kind: 'write'; name: string; content: string; append?: boolean; spoken?: string; preamble?: string }
  /** [DELETE: name] — remove a shared file. Only where tools.fileDelete is
   *  on; every condition before the project task keeps a filesystem that
   *  can only grow. */
  | { kind: 'delete'; name: string; spoken?: string; preamble?: string }
  /** F4½ python run; alongside-style. saveTo = [RUN > name] (or >> to
   *  append): the run's output is also saved to that shared file. */
  | { kind: 'run'; code: string; saveTo?: { name: string; append: boolean }; spoken?: string; preamble?: string }
  /** F4½ source read (name absent = index); alongside-style. */
  | { kind: 'source'; name?: string; spoken?: string; preamble?: string }
  /** §9.4 self-governance: change a room setting; alongside-style. */
  | { kind: 'config'; key: string; value: string; spoken?: string; preamble?: string }
  /** §9.8: standing on (agree=true) or withdrawing from (agree=false) the
   *  claim that the room's work is finished. Alongside-style — the case
   *  for it is spoken in the same turn. Not a ToolAction: a vote is an
   *  utterance, and it ends the turn like one. */
  | { kind: 'done'; agree: boolean; spoken?: string; preamble?: string }
  | { kind: 'empty' };

/** Reply kinds that are an ACTION rather than an utterance — the ones the
 *  F4¾ turn loop can iterate on. Everything else (a message, a journal
 *  entry, a pass, an empty reply) ends the turn where it stands. */
export type ToolAction = Extract<ParsedReply, { kind: 'search' | 'write' | 'delete' | 'run' | 'source' | 'config' }>;
const TOOL_KINDS = new Set<ParsedReply['kind']>(['search', 'write', 'delete', 'run', 'source', 'config']);
export function isToolAction(p: ParsedReply): p is ToolAction {
  return TOOL_KINDS.has(p.kind);
}

/** Models wrap a whole reply in a ``` fence surprisingly often — and a
 *  fenced sentinel is not at the start of the reply any more, so the call
 *  was spoken to the room instead of running. Unwrap a fence that encloses
 *  the ENTIRE reply; a fence around part of it is left alone (that one is
 *  someone quoting code inside a message). */
function unfence(reply: string): string {
  const m = reply.match(/^\s*```[A-Za-z]*\s*\n([\s\S]*?)\n?```\s*$/);
  return m ? m[1] : reply;
}

/** Every sentinel this room would recognise, as a line-start scanner. Used
 *  ONLY by the rescue below, so it never sees a reply that already parsed. */
function lineStartSentinel(reply: string, s?: SearchConfig, t?: ToolsConfig, c?: CompletionConfig, j?: JournalConfig): number {
  const lines = reply.split('\n');
  let off = 0;
  // A ``` fence is how a model QUOTES a call rather than making one, and
  // that distinction is load-bearing — "like this: ```[RUN] x``` see?" is
  // someone talking about the tool bench, and the room must hear it as
  // speech. Anything inside a fence is skipped. (A fence around the WHOLE
  // reply is a different animal: unfence() already unwrapped that, because
  // there the model wrapped its real call.)
  let fenced = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      off += line.length + 1;
      continue;
    }
    // off === 0 is the first line, which the anchored parser already had.
    if (!fenced && off > 0) {
      const m = line.match(/^[ \t]*\**\[([A-Za-z]{2,8})/);
      const tok = m?.[1];
      if (tok) {
        if (
          // The JOURNAL was the one sentinel this rescue never knew about.
          // Every tool got mid-message support, then [DONE] got it, and the
          // journal was left anchored to the first line — so a seat that
          // wrote a sentence and THEN opened a journal had the whole thing
          // spoken to the room. That is the worst version of this bug: not
          // a missed action, but private text read out loud, in the one
          // channel whose divergence from the public voice is the
          // measurement (§2.5).
          (j?.enabled && isJournalToken(tok)) ||
          (t?.files && (isWriteToken(tok) || isAppendToken(tok))) ||
          (t?.files && t?.fileDelete && isDeleteToken(tok)) ||
          (t?.python && isRunToken(tok)) ||
          (t?.sourceCode && isSourceToken(tok)) ||
          (t?.configurable && isConfigToken(tok)) ||
          (s?.enabled && isSearchToken(tok))
        ) return off;
      }
      // A VOTE is held to a stricter rule than a tool call: the line must be
      // nothing but the sentinel. Two reasons, both found in review.
      //
      // False positives are asymmetrically expensive. "I am not going to say
      // [DONE] until the footer is fixed" reads, to a line-start matcher, as
      // agreement — and under unanimity one of those can close a session
      // nobody agreed to end. A missed vote costs a turn; the tally is in
      // every prompt, so the seat sees it did not land and can say it again.
      //
      // And it makes yes and no symmetric. The looser token pattern above
      // stops at the space in "[NOT DONE]", so the withdrawal the prompt
      // actually teaches was the ONE form the rescue could not see, while
      // [DONE] and [UNDONE] sailed through — a consensus axis biased toward
      // consensus. Matching the whole bracket and passing it through
      // doneVote (which strips the space) treats both directions alike.
      if (c?.enabled) {
        const v = line.match(/^[ \t]*\**\[([A-Za-z][A-Za-z _-]{2,9})\]\**:?[ \t]*$/);
        if (v && doneVote(v[1]) !== null) return off;
      }
    }
    off += line.length + 1;
  }
  return -1;
}

/**
 * Parse a reply, and RESCUE a sentinel that a model put after some prose.
 *
 * The room's oldest failure mode, and the expensive one in a build room:
 * a model narrates ("Let me read the current state and fix it.") and THEN
 * writes its call, so the sentinel is no longer at the start of the reply,
 * nothing parses, and the whole thing — brackets, code and all — is spoken
 * to the room as prose while the author believes it acted. Watched live in
 * the first `site` room on 2026-08-29: two seats in a row lost a [RUN] that
 * way inside five minutes.
 *
 * The rule is where a bracket may SIT: a sentinel counts if it begins a
 * line. Text before it is a PREAMBLE — held and spoken as the turn's one
 * message when the turn ends, exactly as under the native transport, so
 * narrating no longer costs a seat its action. Text after the closing tag
 * is still the spoken half and still ends the turn.
 *
 * Order matters and is deliberate: the anchored parse runs FIRST and its
 * result is returned untouched whenever it recognised anything at all. The
 * rescue only ever looks at replies that were going to be plain messages,
 * so no reply that parses today can change meaning.
 *
 * The cost, accepted: a model that QUOTES a sentinel at the start of a line
 * — "you could try:\n[RUN]…" — now runs it. That ambiguity already existed
 * at position 0; this widens where it applies in exchange for calls that
 * actually land. [JOURNAL] and [PASS] are deliberately NOT rescued: the
 * journal's unterminated-block rule is a privacy guarantee, and a pass is
 * defined as a reply that is nothing else.
 */
export function parseReply(
  rawReply: string,
  j: JournalConfig,
  s?: SearchConfig,
  t?: ToolsConfig,
  p?: PassConfig,
  c?: CompletionConfig,
): ParsedReply {
  const first = parseAnchored(rawReply, j, s, t, p, c);
  if (first.kind !== 'message') return first;
  const reply = unfence(rawReply);
  const at = lineStartSentinel(reply, s, t, c, j);
  if (at <= 0) return first;
  const rescued = parseAnchored(reply.slice(at), j, s, t, p, c);
  // A rescued JOURNAL counts, in both modes. The prose in front of it is
  // the preamble and still reaches the room (session.ts speaks it via
  // withPreamble/flushPreamble on both journal branches), so nothing the
  // model addressed to the room is destroyed and nothing it marked private
  // is spoken.
  const rescuable = isToolAction(rescued) || rescued.kind === 'done'
    || rescued.kind === 'journal' || rescued.kind === 'alongside';
  if (!rescuable) return first;
  const preamble = reply.slice(0, at).trim();
  return preamble ? { ...rescued, preamble } : rescued;
}

/**
 * Did this reply LOOK like an attempt to call a tool that the room could
 * not read? Returns the offending fragment, or null.
 *
 * The room teaches a miswritten call nothing: `agentic.ts`'s refusals only
 * reach an agent once its reply PARSES as an action, so a seat whose calls
 * are unreadable gets silence and draws its own conclusions. Seed spent six
 * of eight turns in one live room emitting its own `<seed:tool_call>`
 * envelope, executed nothing after round 1, and reported that "the sandbox
 * says success but disk doesn't move" — reading its own prediction of a run
 * that never happened. Opus eventually worked it out from the transcript
 * and told it, in the room, in plain language.
 *
 * Deliberately narrow. A FOREIGN ENVELOPE is unambiguous — no one writes
 * `<function name="run">` in conversation. A bracket is only counted when
 * it opens a line, so that a seat explaining the syntax to another seat
 * (which is exactly what Opus did, in backticks, mid-sentence) is not
 * lectured about it.
 */
export function looksLikeUnparsedCall(reply: string, t?: ToolsConfig, s?: SearchConfig): string | null {
  const envelope = reply.match(/<\/?[a-z_]*tool_call\b|<function\s+name\s*=|<\|[a-z_]{2,20}\|>|<invoke\b/i);
  if (envelope) return envelope[0];
  for (const line of reply.split('\n')) {
    const m = line.match(/^[ \t]*\**\[\s*([A-Za-z]{2,8})/);
    const tok = m?.[1];
    if (!tok) continue;
    if (
      (t?.files && (isWriteToken(tok) || isAppendToken(tok))) ||
      (t?.python && isRunToken(tok)) ||
      (t?.sourceCode && isSourceToken(tok)) ||
      (t?.configurable && isConfigToken(tok)) ||
      (s?.enabled && isSearchToken(tok))
    ) return line.trim().slice(0, 60);
  }
  return null;
}

/**
 * Every action in one reply, in order, plus whatever was left to say.
 *
 * A reply can carry more than one call — Gemini sent `[RUN]…[/RUN][RUN]…
 * [/RUN][WRITE: index.html]<!DOCTYPE html>…` as a single completion in the
 * first `site-unending` room. `parseReply` returns the FIRST action and
 * hands everything after its closing tag back as `spoken`, so the second
 * read and a complete 16 KB page were spoken to the room as prose while
 * their author believed the page had been written. (The native transport
 * has always allowed several calls per completion; only the sentinel path
 * dropped them.)
 *
 * The trick is that "spoken" and "the next call" are the same bytes: parse
 * the spoken half again, and if it is an action, it was never speech. What
 * finally fails to parse is the real spoken half. Prose BETWEEN two calls
 * comes back as that action's `preamble` and joins the turn's one message.
 */
export function parseActions(
  reply: string,
  j: JournalConfig,
  s?: SearchConfig,
  t?: ToolsConfig,
  p?: PassConfig,
  c?: CompletionConfig,
): { actions: ToolAction[]; spoken?: string; preamble?: string } {
  const actions: ToolAction[] = [];
  const preambles: string[] = [];
  let cur = parseReply(reply, j, s, t, p, c);
  // A reply with more calls than any room grants still parses in full; the
  // turn loop refuses the ones past the budget, which is how their author
  // finds out. The cap is only a guard against pathological input.
  for (let i = 0; i < 16 && isToolAction(cur); i++) {
    const { spoken, preamble, ...action } = cur;
    if (preamble) preambles.push(preamble);
    actions.push(action as ToolAction);
    if (!spoken) break;
    const next = parseReply(spoken, j, s, t, p, c);
    if (!isToolAction(next)) {
      return { actions, spoken, ...(preambles.length ? { preamble: preambles.join('\n\n') } : {}) };
    }
    cur = next;
  }
  return { actions, ...(preambles.length ? { preamble: preambles.join('\n\n') } : {}) };
}

function parseAnchored(
  rawReply: string,
  j: JournalConfig,
  s?: SearchConfig,
  t?: ToolsConfig,
  p?: PassConfig,
  c?: CompletionConfig,
): ParsedReply {
  const reply = unfence(rawReply);
  // Declining the floor stands on its own: it used to require the journal
  // to be enabled, which welded two independent axes together.
  if (p?.enabled && PASS_RE.test(reply)) return { kind: 'pass' };
  // Before the tool sentinels: DONE collides with none of them (RUN needs
  // RU…N, WRITE/SOURCE/CONFIG are ≥4 edits away, JOURNAL needs 5+ letters),
  // but a vote that fell through to `message` would be a silent no-op on
  // the axis, and this order makes that impossible rather than unlikely.
  if (c?.enabled) {
    const d = reply.match(DONE_RE);
    const vote = d ? doneVote(d[1]) : null;
    if (d && vote !== null) {
      const spoken = d[2].trim();
      return { kind: 'done', agree: vote, ...(spoken ? { spoken } : {}) };
    }
  }
  const open = j.enabled ? reply.match(JOURNAL_OPEN_RE) : null;
  const opened = open && isJournalToken(open[1]);
  if (opened && j.mode === 'alongside') {
    const rest = open[2];
    const close = rest.match(JOURNAL_CLOSE_RE);
    if (close && isJournalToken(close[1])) {
      const entry = rest.slice(0, rest.indexOf(close[0])).trim();
      return { kind: 'alongside', entry, spoken: close[2].trim() };
    }
    // Privacy fallback: opened but never closed → the whole reply was
    // meant to be private; journal it rather than leak it.
  }
  if (opened) {
    // A bare sentinel with no entry text is a turn that wrote nothing —
    // record it as silence, not as an empty journal entry (test-found).
    // Replace mode: everything after the opener IS the entry — but a model
    // that closed the block properly should not have the literal [/JOURNAL]
    // stored in its own journal. Trim one trailing close tag (and anything
    // after it, which in replace mode is a mis-formatted extra, not a
    // message: journaling costs the turn).
    const closed = open[2].match(JOURNAL_CLOSE_RE);
    const body = closed && isJournalToken(closed[1])
      ? open[2].slice(0, open[2].indexOf(closed[0]))
      : open[2];
    return body.trim() ? { kind: 'journal', entry: body.trim() } : { kind: 'empty' };
  }
  if (t?.files) {
    const w = reply.match(WRITE_OPEN_RE);
    if (w && (isWriteToken(w[1]) || isAppendToken(w[1]))) {
      const name = w[2].trim();
      const append = isAppendToken(w[1]) ? { append: true as const } : {};
      const close = w[3].match(WRITE_CLOSE_RE);
      if (close && (isWriteToken(close[1]) || isAppendToken(close[1]))) {
        const content = w[3].slice(0, w[3].indexOf(close[0])).trim();
        const spoken = close[2].trim();
        return spoken ? { kind: 'write', name, content, ...append, spoken } : { kind: 'write', name, content, ...append };
      }
      return { kind: 'write', name, content: w[3].trim(), ...append };
    }
  }
  if (t?.files && t?.fileDelete) {
    const d = reply.match(DELETE_RE);
    if (d && isDeleteToken(d[1])) {
      const spoken = d[3].trim();
      return { kind: 'delete', name: d[2].trim(), ...(spoken ? { spoken } : {}) };
    }
  }
  if (t?.python) {
    const r = reply.match(RUN_OPEN_RE);
    if (r && isRunToken(r[1])) {
      const saveTo = r[3] ? { saveTo: { name: r[3].trim(), append: r[2] === '>>' } } : {};
      const body = r[4];
      const close = body.match(RUN_CLOSE_RE);
      if (close) {
        const code = body.slice(0, body.search(RUN_CLOSE_RE)).trim();
        const spoken = close[1].trim();
        if (!code) return { kind: 'empty' };
        return spoken ? { kind: 'run', code, ...saveTo, spoken } : { kind: 'run', code, ...saveTo };
      }
      return body.trim() ? { kind: 'run', code: body.trim(), ...saveTo } : { kind: 'empty' };
    }
  }
  if (t?.configurable) {
    const cfg = reply.match(CONFIG_RE);
    if (cfg && isConfigToken(cfg[1])) {
      const spoken = cfg[4].trim();
      return { kind: 'config', key: cfg[2].trim(), value: cfg[3].trim(), ...(spoken ? { spoken } : {}) };
    }
  }
  if (t?.sourceCode) {
    const src = reply.match(SOURCE_RE);
    if (src && isSourceToken(src[1])) {
      const name = src[2]?.trim() || undefined;
      const spoken = src[3].trim();
      return { kind: 'source', ...(name ? { name } : {}), ...(spoken ? { spoken } : {}) };
    }
  }
  if (s?.enabled) {
    const search = reply.match(SEARCH_RE);
    if (search && isSearchToken(search[1])) {
      const query = search[2].trim();
      if (!query) return { kind: 'empty' };
      if (s.mode === 'alongside') {
        const spoken = reply.slice(search[0].length).replace(/^\**/, '').trim();
        return spoken ? { kind: 'search', query, spoken } : { kind: 'search', query };
      }
      return { kind: 'search', query };
    }
  }
  return reply.trim() ? { kind: 'message', text: reply } : { kind: 'empty' };
}
