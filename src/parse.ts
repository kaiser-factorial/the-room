// Reply sentinel parsing, extracted pure from session.ts so the table of
// model-mangled sentinel variants can be tested directly.

import type { JournalConfig, SearchConfig, ToolsConfig } from './types.js';

// Loose sentinel matches: models bold/colon these more often than not —
// and sometimes TYPO them ([GOURNAL], live 2026-08-25: a private entry was
// spoken to the room). A leading bracket token within edit distance 2 of
// JOURNAL counts as the sentinel: mis-journaling a message is recoverable,
// leaking an entry is not.
const JOURNAL_OPEN_RE = /^\s*\**\[([A-Za-z]{5,9})\]:?\**\s*([\s\S]*)/;
const JOURNAL_CLOSE_RE = /\[\/([A-Za-z]{5,9})\]\s*([\s\S]*)/;
const PASS_RE = /^\s*\**\[PASS\]\**\s*$/i;
// [SEARCH: query] (F4). Same tolerance philosophy as JOURNAL: bold/typo'd
// tokens still count (edit distance ≤2 of SEARCH — disjoint from JOURNAL,
// which is >2 away). The closing bracket is optional (models drop it), and
// anything AFTER the sentinel is discarded: searching costs the whole turn
// (replace economics), so trailing prose is a mis-formatted extra, not a
// message to leak to the room.
const SEARCH_RE = /^\s*\**\[([A-Za-z]{4,8}):\s*([^\]\n]{0,300})\]?/;
// F4½ tools. [WRITE: name]…[/WRITE] replaces a shared file's contents;
// [APPEND: name]…[/APPEND] adds to the end (same regex, token decides —
// closing tags are interchangeable, models will mix them). Contents are
// room-public by design, so an unterminated block just swallows the rest
// as content. [RUN]…[/RUN] — python; [RUN > file] additionally saves the
// run's output to a shared file, [RUN >> file] appends it (shell-flavored
// on purpose). The unterminated [RUN form takes the whole remainder
// (never leak a half-closed block to the room in the private-run mode).
// All alongside-style: text after the closing tag is spoken as usual.
const WRITE_OPEN_RE = /^\s*\**\[([A-Za-z]{4,6}):\s*([^\]\n]{1,80})\]\**\s*\n?([\s\S]*)$/;
const WRITE_CLOSE_RE = /\[\/([A-Za-z]{4,6})\]\s*([\s\S]*)/;
const RUN_OPEN_RE = /^\s*\**\[RUN(?:\s*(>{1,2})\s*([^\]\n>]{1,80}))?\]\**:?\s*\n?([\s\S]*)$/i;
const RUN_CLOSE_RE = /\[\/RUN\]\s*([\s\S]*)/i;
// [SOURCE] / [SOURCE: name] — read the tool layer's own code (F4½
// transparency). Alongside-style; bare form asks for the index.
const SOURCE_RE = /^\s*\**\[([A-Za-z]{5,7})(?::\s*([^\]\n]{0,40}))?\]\**\s*\n?([\s\S]*)$/;
// [CONFIG: key = value] — §9.4 self-governance. Validation happens
// against the whitelist in governance.ts, not here.
const CONFIG_RE = /^\s*\**\[([A-Za-z]{5,7}):\s*([A-Za-z.]{3,40})\s*=\s*([A-Za-z-]{2,20})\s*\]\**\s*\n?([\s\S]*)$/;

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

function isSearchToken(w: string): boolean {
  return editDistance(w.toUpperCase(), 'SEARCH') <= 2;
}

function isWriteToken(w: string): boolean {
  return editDistance(w.toUpperCase(), 'WRITE') <= 1;
}

function isAppendToken(w: string): boolean {
  return editDistance(w.toUpperCase(), 'APPEND') <= 1;
}

function isSourceToken(w: string): boolean {
  return editDistance(w.toUpperCase(), 'SOURCE') <= 1;
}

function isConfigToken(w: string): boolean {
  return editDistance(w.toUpperCase(), 'CONFIG') <= 1;
}

export type ParsedReply =
  | { kind: 'pass' }
  /** Journal replaces the turn (or: alongside-mode privacy fallback — an
   *  opening [JOURNAL] with no closing tag was meant to be private, so the
   *  whole reply becomes the entry rather than leaking to the room). */
  | { kind: 'journal'; entry: string }
  | { kind: 'alongside'; entry: string; spoken: string }
  | { kind: 'message'; text: string }
  /** F4 search; results return privately next turn. `spoken` is set only in
   *  alongside mode (`search-free`), where text after the sentinel is a
   *  normal message; in replace mode trailing text is discarded (the
   *  search costs the turn). */
  | { kind: 'search'; query: string; spoken?: string }
  /** F4½ shared-file write (contents room-public); alongside-style.
   *  append = [APPEND: name] — add to the end instead of replacing. */
  | { kind: 'write'; name: string; content: string; append?: boolean; spoken?: string }
  /** F4½ python run; alongside-style. saveTo = [RUN > name] (or >> to
   *  append): the run's output is also saved to that shared file. */
  | { kind: 'run'; code: string; saveTo?: { name: string; append: boolean }; spoken?: string }
  /** F4½ source read (name absent = index); alongside-style. */
  | { kind: 'source'; name?: string; spoken?: string }
  /** §9.4 self-governance: change a room setting; alongside-style. */
  | { kind: 'config'; key: string; value: string; spoken?: string }
  | { kind: 'empty' };

export function parseReply(reply: string, j: JournalConfig, s?: SearchConfig, t?: ToolsConfig): ParsedReply {
  if (j.enabled && j.pass.enabled && PASS_RE.test(reply)) return { kind: 'pass' };
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
    return open[2].trim() ? { kind: 'journal', entry: open[2].trim() } : { kind: 'empty' };
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
  if (t?.python) {
    const r = reply.match(RUN_OPEN_RE);
    if (r) {
      const saveTo = r[2] ? { saveTo: { name: r[2].trim(), append: r[1] === '>>' } } : {};
      const body = r[3];
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
