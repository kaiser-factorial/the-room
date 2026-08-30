import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SUMMARIZER_MODEL } from './config.js';
import { openrouterAdapter } from './openrouter.js';
import { adapterFor } from './adapters.js';
import { audibleEvents, buildSummaryPrompt, buildTurnMessages, contextSlice } from './context.js';
import { conditionRecord } from './conditions.js';
import { liveSinkEnabled, sinkEvent, sinkJournal } from './sink.js';
import { takeCommands } from './control.js';
import { isToolAction, looksLikeUnparsedCall, parseActions, parseReply, type ToolAction } from './parse.js';
import { actionFromToolCall, toolDefs } from './tools-schema.js';
import type { ChatMessage, ToolCall } from './openrouter.js';
import { webSearch } from './search.js';
import { runPython } from './sandbox.js';
import { readSource, sourceIndex } from './source.js';
import { applyConfigChange } from './governance.js';
import {
  effectiveTurnSteps, formatRefusal, isRefusal, loopEnabled, maxTurnCalls, observationBlock, refusal,
  requiredVotes, turnFooter,
  MAX_TURN_REFUSALS, type Refusal,
} from './agentic.js';
import type { AgentConfig, RoomConfig, RoomEvent, TurnTelemetry } from './types.js';

const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
// ROOM_QUIET=1 silences per-turn console output (tests: the node:test IPC
// protocol shares stdout and heavy interleaved logging can corrupt it).
const clog: typeof console.log = (...a) => { if (process.env.ROOM_QUIET !== '1') console.log(...a); };
const now = () => new Date().toISOString();

// Shuffles honor one constraint: a new order's first speaker never equals the
// previous round's last speaker (no double turns across the boundary).
// Exported for the property test in tests/.
export function shuffledOrder(agents: AgentConfig[], previousLast: string | null): AgentConfig[] {
  const order = [...agents];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (previousLast && order[0].id === previousLast) {
    const k = 1 + Math.floor(Math.random() * (order.length - 1));
    [order[0], order[k]] = [order[k], order[0]];
  }
  return order;
}

export interface SessionHandle {
  /** Set by SIGINT or an admin stop command; checked between turns. */
  stop: () => void;
}

/** Run one full session with the given (condition-resolved) config.
 *  Returns the session id (= the session dir name) for batch manifests. */
export async function runSession(config: RoomConfig, onHandle?: (h: SessionHandle) => void): Promise<string> {
  let sessionId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  // Second-resolution ids can collide (two runners, or tests): suffix
  // rather than interleave two transcripts into one dir (test-found).
  if (existsSync(join(import.meta.dirname, '..', 'sessions', sessionId))) {
    sessionId += '-' + Math.random().toString(36).slice(2, 6);
  }
  const sessionDir = join(import.meta.dirname, '..', 'sessions', sessionId);
  const journalsDir = join(sessionDir, 'journals');
  mkdirSync(journalsDir, { recursive: true });
  const transcriptPath = join(sessionDir, 'transcript.jsonl');
  const stopFile = join(sessionDir, 'STOP');

  const events: RoomEvent[] = [];
  let summary = '';
  let summarizedThrough = 0; // audible-event count already folded into summary
  let stopping = false;
  let adminTouched = false; // D8 dirty-session flag
  const traceSeats = new Set<string>(); // F1: seats that produced ≥1 trace
  // F4/F4½ tool state. pendingPrivate: a private block (search results,
  // python output, or a refusal note) delivered on the caller's next turn,
  // consumed on the first turn that actually completes. searchCredit
  // (gated only): a journal entry unlocks one search; credits don't stack.
  // sharedFiles: the room's shared filesystem (public, mirrored to
  // sessions/<id>/shared/). roomToolRound: the round whose single per-room
  // tool action has been taken (tools.budget === 'per-room').
  const pendingPrivate = new Map<string, string>();
  const searchCredit = new Set<string>();
  // Shared filesystem: [WRITE] stores text; python runs can also publish
  // BINARY files (a saved plot) via the sandbox's shared/ dir. `binary`
  // is detected by content (NUL byte), not extension.
  const sharedFiles = new Map<string, { data: Buffer; binary: boolean }>();
  let roomToolRound = 0;
  // §9.8 completion. `done` holds the seats currently standing on [DONE].
  // It is a live set, not a tally: votes go up, come down, and are cleared
  // wholesale when the artifact they were about changes. `ending` records
  // WHY the session stopped, which is the axis's headline result.
  const done = new Set<string>();
  let ending: 'agreement' | 'clock' | 'rounds' | 'admin' | 'stopfile' | undefined;
  const standingNames = () =>
    config.agents.filter((a) => done.has(a.id)).map((a) => a.name);
  /** Record one vote (raise or withdraw) and move the standing set. Shared
   *  by both places a vote can arrive: a reply that IS the vote, and the
   *  spoken half of a turn that also did something. */
  function recordVote(agent: AgentConfig, round: number, agree: boolean, thinking?: string) {
    const already = done.has(agent.id);
    if (agree) done.add(agent.id);
    else done.delete(agent.id);
    const changed = already !== agree;
    record({
      kind: 'system', ts: now(), round, agentId: agent.id,
      text: agree
        ? changed
          ? config.completion.muteOnDone
            // §9.10: standing is also stepping out. Said plainly, because
            // the room's shape just changed and the seats still speaking
            // need to know who is left.
            ? `${agent.name} says the work is finished, and steps out of the conversation.`
            : `${agent.name} says the work is finished.`
          : `${agent.name} says again that the work is finished.`
        : changed
          ? `${agent.name} is no longer saying the work is finished.`
          : `${agent.name} says the work is not finished.`,
      ...(config.completion.notice ? {} : { private: true }),
      ...(thinking ? { thinking } : {}),
    });
  }

  /** §9.8: a vote can also arrive in the SPOKEN half of a turn that acted —
   *  a seat that rewrites index.html and then says "[DONE] I think that's
   *  it" after the closing tag. Without this the sentinel is spoken to the
   *  room as prose and the vote is silently lost: the room's oldest failure
   *  mode (a call that misses becomes a sentence), in the one place where
   *  what goes missing is the room's own decision. Strip it, cast it, speak
   *  what is left. The journal is disabled for this parse — the entry has
   *  already been taken out upstream. */
  const castSpokenVote = (agent: AgentConfig, round: number, text: string): string => {
    if (!config.completion.enabled || !text) return text;
    const p = parseReply(text, { ...config.journal, enabled: false }, undefined, undefined, undefined, config.completion);
    if (p.kind !== 'done') return text;
    recordVote(agent, round, p.agree);
    // Everything that was NOT the sentinel still reaches the room. A vote
    // written after a sentence ("Looks good to me. [DONE]") used to take the
    // sentence down with it — the parse moves it to `preamble`, and this
    // returned only `spoken`.
    return [p.preamble, p.spoken].filter(Boolean).join('\n\n');
  };

  const agreementReached = () =>
    config.completion.enabled && done.size > 0 && done.size >= requiredVotes(config);
  /** Spend the room's single action for this round (per-room budget only).
   *  Called only by actions that actually RUN — a refusal never costs the
   *  room its slot. */
  const spendRoomBudget = (round: number) => { if (config.tools.budget === 'per-room') roomToolRound = round; };
  /** What a seat is told when its call could not be read. It names the
   *  forms this room actually offers — never one it has turned off, which
   *  would disclose a condition — and says what happened rather than
   *  scolding: the reply was heard as speech, which is why nothing came
   *  back. */
  const unreadableCallNote = (fragment: string): string => {
    const forms: string[] = [];
    if (config.tools.python) forms.push('[RUN] your code [/RUN]');
    if (config.tools.files) forms.push('[WRITE: filename] the contents [/WRITE]');
    if (config.search.enabled) forms.push('[SEARCH: your query]');
    if (config.tools.sourceCode) forms.push('[SOURCE]');
    return [
      `Nothing in your last turn reached the room's tools.`,
      `You wrote "${fragment.replace(/\s+/g, ' ').slice(0, 80)}", which this room reads as speech —`,
      `so it was spoken to the others, and no result came back to you.`,
      forms.length ? `The forms this room understands:\n${forms.map((f) => `  ${f}`).join('\n')}` : '',
    ].filter(Boolean).join('\n');
  };

  // One path SEGMENT. Folders are made of these joined by '/', validated
  // one at a time — which is why `..`, a leading '/', a trailing '/' and an
  // empty segment cannot be spelled at all rather than being blacklisted.
  const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  const MAX_PATH_DEPTH = 4;
  const MAX_PATH_CHARS = 120;
  /** A shared-file name the room is allowed to use. Flat unless the
   *  condition turns folders on; `..` never validates either way, because
   *  a segment must START with an alphanumeric. */
  const validName = (name: string): boolean => {
    if (!name || name.length > MAX_PATH_CHARS) return false;
    if (!config.tools.directories) return SEGMENT_RE.test(name);
    const parts = name.split('/');
    return parts.length <= MAX_PATH_DEPTH && parts.every((seg) => SEGMENT_RE.test(seg));
  };
  const FILE_NAME_RE = { test: validName };
  // Per-file ceiling, from the condition: a chat room passing notes and a
  // task room whose deliverable is one file want very different numbers.
  const MAX_FILE_CHARS = config.tools.maxFileChars;
  const MAX_BINARY_BYTES = 400_000;
  const MAX_FILES = config.tools.maxFiles;

  /** Does a write to `name` lapse the room's agreement? `'*'` means the
   *  agreement is about the whole tree — what a project-shaped task wants,
   *  where there is no single deliverable to name. */
  const targetsFile = (name: string) =>
    config.completion.target === '*' || name === config.completion.target;

  /** Publish one shared file (from [WRITE] or a python run): store, mirror
   *  to disk, and record the room-visible file event. */
  function publishFile(agent: AgentConfig, round: number, name: string, data: Buffer, thinking?: string, step?: number, via?: 'native' | 'sentinel') {
    const binary = data.includes(0);
    sharedFiles.set(name, { data, binary });
    // §9.8: the artifact just changed, so the agreement about it lapses.
    // Recorded as its own line — an agreement that quietly evaporated
    // would be indistinguishable in the transcript from one never reached.
    if (config.completion.enabled && config.completion.resetOnEdit && targetsFile(name) && done.size) {
      const stood = standingNames().join(', ');
      done.clear();
      record({
        kind: 'system', ts: now(), round,
        text: config.completion.muteOnDone
          ? `${agent.name} changed ${name}, so the room is no longer agreed that the work is finished — ${stood} are back in the conversation.`
          : `${agent.name} changed ${name}, so the room is no longer agreed that the work is finished (${stood} had been).`,
        ...(config.completion.notice ? {} : { private: true }),
      });
    }
    const sharedDir = join(sessionDir, 'shared');
    // `name` may carry folders now; validName() has already guaranteed it
    // cannot climb out of shared/.
    mkdirSync(dirname(join(sharedDir, name)), { recursive: true });
    writeFileSync(join(sharedDir, name), data);
    record({
      kind: 'file', ts: now(), round, agentId: agent.id, agentName: agent.name, name,
      content: binary ? data.toString('base64') : data.toString('utf8'),
      ...(binary ? { encoding: 'base64' as const } : {}),
      notice: config.tools.notice, thinking, ...(step ? { step } : {}), ...(via ? { via } : {}),
    });
  }

  /**
   * Execute ONE tool action and return the private observation its caller
   * gets back — the text that either rides the next turn's private block
   * (single-step rooms) or comes straight back inside the turn (F4¾ loop).
   *
   * Extracted from the turn body so both economics run the exact same code:
   * the only thing the loop changes is WHERE the observation goes. Every
   * refusal is worded through agentic.ts's schema — code, what failed, the
   * fix, and the legal options where they can be listed without disclosing
   * anything the room's condition hides.
   */
  async function executeAction(
    agent: AgentConfig,
    round: number,
    parsed: ToolAction,
    thinking: string | undefined,
    opts: { deny?: Refusal; step?: number; attemptsLeft: number; via?: 'native' | 'sentinel' },
  ): Promise<{ observation: string; refused: boolean }> {
    const { deny, step, attemptsLeft, via } = opts;
    const stamp = { ...(step ? { step } : {}), ...(via ? { via } : {}) };
    const refuse = (lead: string, r: Refusal) => ({ observation: formatRefusal(lead, r, attemptsLeft), refused: true });
    // Reading and governing are FREE of the room's tool budget (F4½/§9.4) —
    // but never free of the turn's action count, or a room could read source
    // forever inside one turn.
    const freeOfBudget = deny?.code === 'steps_exhausted' ? deny : undefined;

    if (parsed.kind === 'search') {
      const lead = `Your search for "${parsed.query}" did not run.`;
      const denial =
        deny ??
        (config.search.gated && !searchCredit.has(agent.id)
          ? refusal(
              'search_gated',
              'Searching in this room unlocks by writing in your journal.',
              'Write a journal entry first; each entry allows one search.',
            )
          : undefined);
      const searchEvent = (extra: Record<string, unknown>) =>
        record({ kind: 'search', ts: now(), round, agentId: agent.id, agentName: agent.name, query: parsed.query, notice: config.search.notice, thinking, ...stamp, ...extra } as RoomEvent);
      if (denial) {
        searchEvent({ denied: true });
        return refuse(lead, denial);
      }
      searchCredit.delete(agent.id);
      spendRoomBudget(round);
      let results: string;
      try {
        results = await webSearch(parsed.query, config.search.maxResults);
      } catch (err) {
        // An errored search is invisible to the room (no notice on a
        // failure) but honest to the requester — and retryable, unlike
        // every other refusal code.
        searchEvent({ denied: true });
        return refuse(
          lead,
          refusal('search_failed', `The search backend failed (${(err as Error).message.slice(0, 120)}).`, 'Try the same query again, or a different one.'),
        );
      }
      searchEvent({ results });
      return { observation: `Results of your web search for "${parsed.query}":\n${results}`, refused: false };
    }

    if (parsed.kind === 'write') {
      const lead = `Your ${parsed.append ? 'append' : 'write'} to "${parsed.name.slice(0, 80)}" did not happen.`;
      const existing = parsed.append ? sharedFiles.get(parsed.name) : undefined;
      const combined =
        existing && !existing.binary
          ? `${existing.data.toString('utf8').replace(/\n?$/, '\n')}${parsed.content}`
          : parsed.content;
      // Shape errors come BEFORE the budget/step refusals, exactly as they
      // did pre-loop: a malformed write never spends the room's one action.
      const denial = !FILE_NAME_RE.test(parsed.name)
        ? refusal('bad_file_name', `"${parsed.name.slice(0, 80)}" is not a valid file name.`, 'Use letters, digits, dots, underscores or hyphens (max 64 characters), starting with a letter or digit — then write again.')
        : parsed.append && existing?.binary
          ? refusal('binary_append', `"${parsed.name}" is a binary file — it can't be appended to.`, `Replace it with [WRITE: ${parsed.name}], or append to a text file instead.`)
          : combined.length > MAX_FILE_CHARS
            ? refusal('file_too_large', `The contents come to ${combined.length} characters, over the ${MAX_FILE_CHARS}-character limit for one file.`, 'Shorten it, or split it across several files.')
            : !sharedFiles.has(parsed.name) && sharedFiles.size >= MAX_FILES
              ? refusal('too_many_files', `The room already holds ${MAX_FILES} shared files.`, 'Write to one of the existing files instead.', [...sharedFiles.keys()])
              : deny;
      if (denial) {
        record({ kind: 'file', ts: now(), round, agentId: agent.id, agentName: agent.name, name: parsed.name.slice(0, 80), content: '', denied: true, notice: config.tools.notice, thinking, ...stamp });
        return refuse(lead, denial);
      }
      spendRoomBudget(round);
      publishFile(agent, round, parsed.name, Buffer.from(combined, 'utf8'), thinking, step, via);
      return {
        observation: `You ${parsed.append ? 'appended to' : 'wrote'} the shared file "${parsed.name}" (${combined.length} characters). Everyone in the room can read it.`,
        refused: false,
      };
    }

    if (parsed.kind === 'delete') {
      const lead = `Your deletion of "${parsed.name.slice(0, 80)}" did not happen.`;
      const existing = sharedFiles.get(parsed.name);
      const denial = !FILE_NAME_RE.test(parsed.name)
        ? refusal('bad_file_name', `"${parsed.name.slice(0, 80)}" is not a valid file name.`, 'Check the name against the shared files you can see, then try again.')
        : !existing
          ? refusal('no_such_file', `There is no shared file called "${parsed.name}".`, 'Check the name against the shared files you can see.', [...sharedFiles.keys()])
          : deny;
      if (denial) {
        record({ kind: 'file', ts: now(), round, agentId: agent.id, agentName: agent.name, name: parsed.name.slice(0, 80), content: '', denied: true, deleted: true, notice: config.tools.notice, thinking, ...stamp });
        return refuse(lead, denial);
      }
      spendRoomBudget(round);
      // The agreement was about an artifact that no longer exists, so it
      // lapses exactly as a rewrite would. Removing the thing is at least
      // as big a change as editing it.
      if (config.completion.enabled && config.completion.resetOnEdit && targetsFile(parsed.name) && done.size) {
        const stood = standingNames().join(', ');
        done.clear();
        record({
          kind: 'system', ts: now(), round,
          text: config.completion.muteOnDone
            ? `${agent.name} deleted ${parsed.name}, so the room is no longer agreed that the work is finished — ${stood} are back in the conversation.`
            : `${agent.name} deleted ${parsed.name}, so the room is no longer agreed that the work is finished (${stood} had been).`,
          ...(config.completion.notice ? {} : { private: true }),
        });
      }
      const gone = existing!;
      sharedFiles.delete(parsed.name);
      rmSync(join(sessionDir, 'shared', parsed.name), { force: true });
      record({
        kind: 'file', ts: now(), round, agentId: agent.id, agentName: agent.name, name: parsed.name,
        content: gone.binary ? '' : gone.data.toString('utf8'),
        deleted: true, notice: config.tools.notice, thinking, ...stamp,
      });
      return { observation: `You deleted the shared file "${parsed.name}". It is gone for everyone.`, refused: false };
    }

    if (parsed.kind === 'run') {
      if (deny) {
        record({ kind: 'run', ts: now(), round, agentId: agent.id, agentName: agent.name, code: parsed.code, denied: true, notice: config.tools.notice, thinking, ...stamp });
        // (denied runs stay inaudible in both visibility modes)
        return refuse('Your code did not run.', deny);
      }
      spendRoomBudget(round);
      const res = await runPython(
        parsed.code,
        Object.fromEntries([...sharedFiles].map(([n, f]) => [n, f.data])),
        config.tools.pythonTimeoutSeconds,
        config.tools.pythonPackages,
        config.tools.pythonInstall,
      );
      record({ kind: 'run', ts: now(), round, agentId: agent.id, agentName: agent.name, code: parsed.code, output: res.output, ...(config.tools.runPublic ? { public: true } : {}), notice: config.tools.notice, thinking, ...stamp });
      // Files the code saved under shared/ are PUBLISHED to the room
      // (that's the point of the writable mount); invalid ones are
      // reported privately, never silently dropped.
      const publishNotes: string[] = [];
      // [RUN > file] / [RUN >> file]: the output itself becomes (or
      // extends) a shared file — same publish path, same caps.
      if (parsed.saveTo) {
        const { name, append } = parsed.saveTo;
        const existing = append ? sharedFiles.get(name) : undefined;
        const combined =
          existing && !existing.binary
            ? `${existing.data.toString('utf8').replace(/\n?$/, '\n')}${res.output}`
            : res.output;
        if (!FILE_NAME_RE.test(name)) publishNotes.push(`Output was not saved: "${name}" is not a valid file name.`);
        else if (append && existing?.binary) publishNotes.push(`Output was not saved: "${name}" is a binary file.`);
        else if (combined.length > MAX_FILE_CHARS) publishNotes.push(`Output was not saved to "${name}": it would exceed the ${MAX_FILE_CHARS}-character file limit.`);
        else if (!sharedFiles.has(name) && sharedFiles.size >= MAX_FILES) publishNotes.push(`Output was not saved: the room already holds ${MAX_FILES} shared files.`);
        else publishFile(agent, round, name, Buffer.from(combined, 'utf8'), undefined, step, via);
      }
      for (const f of res.files) {
        const data = Buffer.from(f.dataBase64, 'base64');
        if (!FILE_NAME_RE.test(f.name)) publishNotes.push(`"${f.name}" was not published (invalid file name).`);
        else if (data.length > MAX_BINARY_BYTES) publishNotes.push(`"${f.name}" was not published (${data.length} bytes exceeds the ${MAX_BINARY_BYTES}-byte limit).`);
        else if (!sharedFiles.has(f.name) && sharedFiles.size >= MAX_FILES) publishNotes.push(`"${f.name}" was not published (the room already holds ${MAX_FILES} shared files).`);
        else publishFile(agent, round, f.name, data, undefined, step, via);
      }
      return {
        observation: `Output of the code you ran:\n${res.output}${publishNotes.length ? `\n${publishNotes.join('\n')}` : ''}`,
        refused: false,
      };
    }

    if (parsed.kind === 'source') {
      if (freeOfBudget) {
        record({ kind: 'source', ts: now(), round, agentId: agent.id, agentName: agent.name, ...(parsed.name ? { name: parsed.name } : {}), notice: config.tools.notice, thinking, ...stamp });
        return refuse('You did not get to read the source.', freeOfBudget);
      }
      record({ kind: 'source', ts: now(), round, agentId: agent.id, agentName: agent.name, ...(parsed.name ? { name: parsed.name } : {}), notice: config.tools.notice, thinking, ...stamp });
      const scope = config.tools.sourceScope;
      const body =
        parsed.name === 'condition' && scope === 'all'
          ? `This room's live configuration (mutations included):\n${JSON.stringify(conditionRecord(config), null, 2)}`
          : parsed.name
            ? readSource(parsed.name, scope)
            : sourceIndex(scope);
      return { observation: body ?? `There is no source file named "${parsed.name}".\n${sourceIndex(scope)}`, refused: false };
    }

    if (parsed.kind === 'config') {
      const denial = freeOfBudget ?? applyConfigChange(config, parsed.key, parsed.value);
      if (denial) {
        record({ kind: 'config', ts: now(), round, agentId: agent.id, agentName: agent.name, key: parsed.key.slice(0, 60), value: parsed.value.slice(0, 40), denied: true, thinking, ...stamp });
        return refuse('Your settings change did not happen.', denial);
      }
      record({ kind: 'config', ts: now(), round, agentId: agent.id, agentName: agent.name, key: parsed.key, value: parsed.value, thinking, ...stamp });
      return { observation: `The room's setting ${parsed.key} is now ${parsed.value}. Everyone was told.`, refused: false };
    }

    // Unreachable: the caller only routes tool actions here (parse.ts).
    return { observation: '', refused: false };
  }
  onHandle?.({ stop: () => { stopping = true; } });

  function record(e: RoomEvent) {
    events.push(e);
    appendFileSync(transcriptPath, JSON.stringify(e) + '\n');
    sinkEvent(sessionId, e);
    if (e.kind === 'message') clog(`\n── ${e.agentName} ──\n${e.text}`);
    else if (e.kind === 'journal') clog(`\n   ✎ ${e.agentName} stepped away to journal.`);
    else if (e.kind === 'system') clog(`\n   ⋯ ${e.text}`);
    else if (e.kind === 'search') clog(`\n   ⌕ ${e.agentName} ${e.denied ? 'reached for the web (no search available)' : `searched: ${e.query}`}`);
    else if (e.kind === 'file') clog(`\n   ▤ ${e.agentName} ${e.denied ? `write denied (${e.name})` : `wrote shared file: ${e.name}`}`);
    else if (e.kind === 'run') clog(`\n   ▶ ${e.agentName} ${e.denied ? 'run denied' : 'ran code'}`);
    else if (e.kind === 'source') clog(`\n   § ${e.agentName} read the source${e.name ? `: ${e.name}` : ' index'}`);
    else if (e.kind === 'config') clog(`\n   ⚙ ${e.agentName} ${e.denied ? `config change denied (${e.key})` : `set ${e.key} = ${e.value}`}`);
  }

  function readJournal(agentId: string): string {
    const p = join(journalsDir, `${agentId}.md`);
    // Recall strips the wall-clock timestamps our .md writer records: they
    // leak real time into the agent's context, breaking countdown-hidden
    // conditions (spotted 2026-08-25 — agents were writing time-stamped
    // headers they could only have copied from their own recall).
    return existsSync(p)
      ? readFileSync(p, 'utf8').replace(/^(## Round \d+) — \d{4}-\d{2}-\d{2}T[^\n]*$/gm, '$1')
      : '';
  }

  function saveJournal(agent: AgentConfig, round: number, entry: string, thinking?: string) {
    appendFileSync(join(journalsDir, `${agent.id}.md`), `\n## Round ${round} — ${now()}\n\n${entry}\n`);
    sinkJournal(sessionId, round, agent.id, agent.name, entry);
    if (config.search.enabled && config.search.gated) searchCredit.add(agent.id);
    if (config.journal.notice) {
      record({ kind: 'journal', ts: now(), round, agentId: agent.id, agentName: agent.name, thinking });
    } else {
      // No room event — but the local console still shows it happened.
      clog(`\n   ✎ ${agent.name} journaled (silent).`);
    }
  }

  // Summarizer runs only under the window policy; full-context sessions never
  // inject a second voice (§6.1 summarizer-leak control).
  async function maybeSummarize(round: number) {
    if (config.contextPolicy !== 'window') return;
    const { omitted } = contextSlice(config, events);
    if (omitted - summarizedThrough < config.summarizeEveryMessages) return;
    const fresh = audibleEvents(events).slice(summarizedThrough, omitted);
    try {
      const res = await openrouterAdapter.send(SUMMARIZER_MODEL, buildSummaryPrompt(summary, fresh), { maxTokens: 800 });
      summary = res.text;
      summarizedThrough = omitted;
      record({ kind: 'summary', ts: now(), round, text: summary });
    } catch (err) {
      console.error('summarizer failed (continuing without):', err);
    }
  }

  // Admin commands that apply mid-session: stop, and messages spoken into the
  // room. Checked between turns so they land at natural boundaries.
  async function pollAdmin(round: number) {
    for (const cmd of await takeCommands(['stop', 'say'])) {
      if (cmd.kind === 'stop') {
        clog('Admin stop received.');
        stopping = true;
      } else if (cmd.kind === 'say' && cmd.payload?.text) {
        adminTouched = true;
        record({ kind: 'message', ts: now(), round, agentId: 'admin', agentName: 'Admin', text: cmd.payload.text });
      }
    }
  }

  const endAt = Date.now() + config.durationMinutes * 60_000;
  clog(`Session ${sessionId} — condition '${config.conditionName}', ${config.agents.length} agents, ${config.durationMinutes} min.`);
  clog(`Transcript: ${transcriptPath}`);
  clog(liveSinkEnabled ? 'Live sink: ON (Supabase)' : 'Live sink: off (set SUPABASE_URL + SUPABASE_SERVICE_KEY)');
  clog(`To stop gracefully: Ctrl-C, or \`touch ${stopFile}\``);

  record({
    kind: 'meta',
    ts: now(),
    round: 0,
    payload: {
      endsAt: new Date(endAt).toISOString(),
      durationMinutes: config.durationMinutes,
      shuffle: config.shuffle,
      agents: config.agents.map((a) => ({ id: a.id, name: a.name, color: a.color })),
      condition: conditionRecord(config),
      ...(config.batch ? { batch: config.batch } : {}),
    },
  });
  const welcomeText =
    config.countdown === 'told-once'
      ? `${config.welcomeMessage} You have ${config.durationMinutes} minutes together; you will not be reminded of the time again.`
      : config.welcomeMessage;
  record({ kind: 'system', ts: now(), round: 0, text: welcomeText });

  // The call cap must leave room for everything a turn can produce.
  // Long-form journal variant: cap covers the bigger entry allowance.
  // Alongside mode: a turn is entry + spoken message + hidden reasoning in
  // ONE completion — at the plain cap that re-created D3 starvation (first
  // journal-free run: Seed said nothing 3 turns, trace present each time).
  // Doubling the cap is the backstop only; visible length is still shaped
  // by the prompt norm. A FUNCTION, not a const: a self-governing room
  // (§9.4) can enable the alongside journal mid-session.
  const callMaxTokens = () =>
    config.journal.enabled && config.journal.mode === 'alongside'
      ? config.maxOutputTokens * 2
      : config.journal.enabled && config.journal.maxTokens > 0
        ? Math.max(config.maxOutputTokens, config.journal.maxTokens)
        : config.maxOutputTokens;

  let previousLast: string | null = null;
  let order: AgentConfig[] = [];
  let roundsUntilShuffle = 0; // 0 → shuffle before the next round
  const drawInterval = () =>
    config.shuffle.kind === 'periodic'
      ? config.shuffle.minRounds + Math.floor(Math.random() * (config.shuffle.maxRounds - config.shuffle.minRounds + 1))
      : config.shuffle.kind === 'every-round'
        ? 1
        : Number.POSITIVE_INFINITY; // fixed-random: one draw, kept forever

  // How many rounds actually ran — stamped into the `end` event so a ledger
  // does not have to scan every row of a session to count them. Set inside
  // the body, after the break: a round that never opened is not a round.
  let roundsRun = 0;

  for (let round = 1; round <= config.maxRounds; round++) {
    if (stopping || existsSync(stopFile) || Date.now() >= endAt) break;
    roundsRun = round;

    if (roundsUntilShuffle <= 0 || order.length === 0) {
      order = shuffledOrder(config.agents, previousLast);
      roundsUntilShuffle = drawInterval();
      record({ kind: 'order', ts: now(), round, order: order.map((a) => a.id) });
    }
    roundsUntilShuffle--;

    // Whether every seat in this round was actually offered its turn. An
    // agreement is a state the room HELD for a whole round; a round the
    // clock or an admin stop cut in half never gave the remaining seats
    // their chance to withdraw, so it cannot be one — `ending` would have
    // read 'agreement' for a session we stopped.
    let roundComplete = true;
    // §9.10: a seat that has said [DONE] is no longer routed to. The room's
    // population whittles down as seats agree, and only an edit (which
    // clears every vote) brings anyone back. This is evaluated per turn,
    // not once per round: a write mid-round revives the rest of the round's
    // order immediately, and a seat that agrees mid-round is skipped for
    // the seats after it.
    //
    // `roundComplete` stays true through a muted skip. It means "every seat
    // that COULD speak was offered its turn" — a seat that took itself out
    // was not denied anything, and treating the round as truncated would
    // make agreement unreachable in exactly the arm built around it.
    const muted = (a: AgentConfig) => config.completion.muteOnDone && done.has(a.id);
    for (const agent of order) {
      if (muted(agent)) continue;
      await pollAdmin(round);
      if (stopping || existsSync(stopFile)) { roundComplete = false; break; }
      if (Date.now() >= endAt) { roundComplete = false; break; }
      const minutesRemaining = Math.ceil((endAt - Date.now()) / 60_000);

      // ── The turn (F4¾) ───────────────────────────────────────────────
      // One turn is a LOOP over model calls. It ends the moment the agent
      // says anything to the room — utterance is what costs a turn, actions
      // are not — and otherwise after `maxSteps` actions, two refusals, or
      // the hard call cap. In a single-step room (turnSteps 1, the control
      // economics) the loop runs exactly once and the observation is
      // deferred to the caller's next turn, byte for byte as before.
      const maxSteps = effectiveTurnSteps(config);
      const loop = loopEnabled(config);
      const callCap = maxTurnCalls(config);
      // The private block carried in from LAST turn stays visible for every
      // call of this one — an agent must not watch its own search results
      // vanish mid-turn. It is consumed once the turn's first call lands.
      const carried = pendingPrivate.get(agent.id);
      const inTurn: ChatMessage[] = [];
      // F4¾ native transport: text a model writes ALONGSIDE a tool call is
      // a preamble, not the end of its turn ("Let me look that up." then
      // the call). Ending the turn on it would make an agentic-native room
      // single-step for any seat that narrates — the loop would never
      // engage and the transport contrast would be measuring verbosity.
      // Preambles are held and spoken as the turn's one message when it
      // ends, so nothing addressed to the room is dropped and the room
      // still hears at most one message per seat per turn. (The sentinel
      // transport keeps its original economics: there, text after the
      // closing tag IS the message by construction, and it ends the turn.)
      const preamble: string[] = [];
      /** Speak whatever the turn narrated along the way, as its one message.
       *  No-op when it narrated nothing — a turn spent purely on actions
       *  still says nothing to the room, which the prompt calls a fine way
       *  to spend one. */
      const flushPreamble = (telemetry?: TurnTelemetry, thinking?: string) => {
        if (!preamble.length) return;
        record({
          kind: 'message', ts: now(), round, agentId: agent.id, agentName: agent.name,
          text: preamble.join('\n\n'), telemetry, thinking,
        });
        preamble.length = 0;
      };
      let steps = 0;      // actions that actually ran
      let refusals = 0;   // actions refused (they never spend a step)
      let calls = 0;      // model completions this turn
      let failed = false;
      // The most recent observation not yet handed anywhere. If the next
      // call dies, this still reaches its agent next turn — an action ran,
      // and its result is never dropped on the floor.
      let unread: string | undefined;

      while (true) {
        calls++;
        const minutesRemaining = Math.ceil((endAt - Date.now()) / 60_000);
        // Recomputed every call, like the prompt: an action this turn
        // already took (a [CONFIG] change in a self-governing room) can
        // change which tools the next step should even be offered.
        const nativeTools = config.tools.transport === 'native' ? toolDefs(config) : undefined;
        let reply: string;
        let telemetry;
        let thinking: string | undefined;
        let toolCalls: ToolCall[] | undefined;
        try {
          const res = await adapterFor(agent).send(
            agent.model,
            // Rebuilt every call, never appended to: a file this agent just
            // wrote must appear in its own shared-files block, and a
            // [CONFIG] change it just made must be live in its own prompt
            // (the joint-session/scatter-lab rule — recompute the request
            // each round, because the last action may have changed what the
            // next one is looking at).
            buildTurnMessages({
              agent,
              config,
              events,
              summary,
              minutesRemaining,
              ownJournal: readJournal(agent.id),
              privateBlock: carried,
              standingDone: standingNames(),
              sharedFiles: [...sharedFiles].map(([name, f]) => ({
                name,
                content: f.binary ? '' : f.data.toString('utf8'),
                binary: f.binary,
                size: f.data.length,
              })),
              inTurn,
            }),
            {
              maxTokens: callMaxTokens(),
              sampling: config.sampling,
              reasoningEffort: config.reasoningEffort,
              logprobs: config.captureLogprobs,
              providerOrder: agent.providerOrder,
              ...(nativeTools?.length ? { tools: nativeTools } : {}),
            },
          );
          reply = res.text;
          toolCalls = res.toolCalls;
          telemetry = calls > 1 ? { ...res.meta, calls } : res.meta;
          thinking = res.thinking;
          if (thinking) traceSeats.add(agent.id);
          // The carried block was delivered on THIS completed call — consume
          // it now (an errored call above keeps it for the next attempt).
          pendingPrivate.delete(agent.id);
        } catch (err) {
          // agentId: a failed turn is a silence like any other, and analysis
          // could not attribute it — the one silence kind with no author.
          record({ kind: 'system', ts: now(), round, agentId: agent.id, text: `${agent.name} could not speak this turn (${(err as Error).message.slice(0, 120)})` });
          if (unread) pendingPrivate.set(agent.id, unread);
          failed = true;
          break;
        }

        const j = config.journal;
        // Native transport: the actions arrive structured, and whatever
        // visible text came with them is the spoken half. The reply is
        // STILL parsed when no tool call was made — [JOURNAL] and [PASS]
        // are not tools, they're room furniture, and they stay sentinels
        // under both transports. A seat that ignores its tool channel and
        // writes a bracket anyway is still understood (the sentinel path
        // remains a fallback): the point of this transport is that a
        // miswritten call never reaches the room as prose, not that the
        // brackets stop working. `via` records which channel was used, so
        // the fallback rate is measurable.
        const nativeCalls = nativeTools?.length ? (toolCalls ?? []) : [];
        const parsed = parseReply(reply, j, config.search, config.tools, config.pass, config.completion);

        // ── Utterances: they end the turn where they stand ──────────────
        if (!nativeCalls.length && !isToolAction(parsed)) {
          // Anything held from earlier steps is spoken with this turn's
          // words, joined into the one message the room hears. A rescued
          // sentinel (prose, then the bracket) arrives with that prose as
          // its own preamble — it belongs at the front of the same message.
          if ('preamble' in parsed && parsed.preamble) preamble.push(parsed.preamble);
          const withPreamble = (text: string) => [...preamble, text].join('\n\n');
          if (parsed.kind === 'done') {
            // §9.8. Raising and lowering are the same event kind, always
            // attributed: WHO agreed first, who held out, and who took it
            // back is the whole record of the negotiation. `private` keeps
            // a silent room's votes out of every transcript while leaving
            // them in the log, exactly as a silent [PASS] does.
            recordVote(agent, round, parsed.agree, parsed.spoken ? undefined : thinking);
            if (parsed.spoken) {
              record({ kind: 'message', ts: now(), round, agentId: agent.id, agentName: agent.name, text: withPreamble(parsed.spoken), telemetry, thinking });
            } else {
              flushPreamble(telemetry, thinking);
            }
          } else if (parsed.kind === 'pass') {
            // Always recorded, always attributed — who declined the floor is
            // the whole signal. `private` keeps a silent pass out of every
            // agent's transcript without hiding it from analysis.
            record({
              kind: 'system', ts: now(), round, agentId: agent.id,
              text: `${agent.name} chose to say nothing.`,
              // A chosen silence has a trace behind it — the reasoning that
              // decided to spend the turn on nothing is exactly the thing
              // worth reading, and it was being dropped on the floor.
              thinking, telemetry,
              ...(config.pass.notice ? {} : { private: true }),
            });
          } else if (parsed.kind === 'alongside') {
            // One call, one trace: attach it to the spoken message if there
            // is one, else to the journal event, so it's stored exactly once.
            if (parsed.entry) saveJournal(agent, round, parsed.entry, parsed.spoken ? undefined : thinking);
            // The spoken half of a journal turn can carry a vote too, and
            // `site` runs the journal alongside — so this was the shape most
            // likely to lose one: [JOURNAL]…[/JOURNAL] then [DONE].
            const said = parsed.spoken ? castSpokenVote(agent, round, parsed.spoken) : '';
            if (said) record({ kind: 'message', ts: now(), round, agentId: agent.id, agentName: agent.name, text: withPreamble(said), telemetry, thinking });
            else flushPreamble(telemetry);
          } else if (parsed.kind === 'journal') {
            saveJournal(agent, round, parsed.entry, thinking);
            flushPreamble(telemetry);
          } else if (parsed.kind === 'message') {
            record({ kind: 'message', ts: now(), round, agentId: agent.id, agentName: agent.name, text: withPreamble(parsed.text), telemetry, thinking });
            // A reply that MEANT to be a call and wasn't. The room heard it
            // as speech; without this its author hears nothing at all and
            // has to infer, from an absence, that its hands are not
            // attached. Private, so the room's own reading of the situation
            // is left intact, and recorded so analysis can count it.
            const missed = config.tools.callFeedback
              ? looksLikeUnparsedCall(parsed.text, config.tools, config.search)
              : null;
            if (missed) {
              pendingPrivate.set(agent.id, unreadableCallNote(missed));
              record({
                kind: 'system', ts: now(), round, agentId: agent.id, private: true,
                text: `${agent.name} wrote something the room could not read as a tool call ("${missed.replace(/\s+/g, ' ').slice(0, 40)}").`,
              });
            }
          } else if (preamble.length) {
            // Nothing new said, but earlier steps narrated — that narration
            // is the turn's message rather than a "said nothing" line.
            flushPreamble(telemetry, thinking);
          } else {
            // Empty visible text (e.g. reasoning ate the whole budget). Never
            // drop a turn silently — the room perceives silence, and analysis
            // needs the event. The trace (if any) rides along: it's often the
            // only record of what the silent turn was doing. A turn that has
            // already acted ends here quietly, which is the loop's normal way
            // of finishing a turn spent working rather than talking.
            // The telemetry is the diagnosis: `usage.reasoning` against the
            // visible budget, and finishReason, say whether the seat thought
            // its whole turn away or simply had nothing to add.
            record({ kind: 'system', ts: now(), round, text: `${agent.name} said nothing this turn.`, agentId: agent.id, thinking, telemetry });
          }
          break;
        }

        // ── Actions ────────────────────────────────────────────────────
        // One completion can carry several native calls (a model may ask
        // for two things at once); the sentinel transport yields exactly
        // one. Either way each is executed in order, each costs a step, and
        // each gets its own answer back.
        // Every action the reply carries, in order — not just the first.
        // The native path has always been able to bring several; the
        // sentinel path used to take one and speak the rest to the room
        // (parse.ts parseActions has the live example that fixed it).
        const sentinelActions = nativeCalls.length
          ? { actions: [] as ToolAction[], spoken: undefined as string | undefined, preamble: undefined as string | undefined }
          : parseActions(reply, j, config.search, config.tools, config.pass, config.completion);
        const batch: { call?: ToolCall; action: ToolAction | Refusal }[] = nativeCalls.length
          ? nativeCalls.map((c) => ({ call: c, action: actionFromToolCall(c, config) }))
          : sentinelActions.actions.map((a) => ({ action: a }));
        // The spoken half. Under the sentinel transport it is whatever
        // followed the closing tag, and it ends the turn. Under native,
        // text that arrived WITH a call is a preamble: held, not spoken
        // yet, and the turn goes on.
        const spoken = nativeCalls.length ? undefined : sentinelActions.spoken;
        // Under the native transport the visible text alongside a call is a
        // preamble — and a seat that writes "[DONE]" there would have had it
        // flushed as prose and never counted, because agreeing is furniture
        // rather than a tool and there is no native `done` call to make.
        if (nativeCalls.length && reply.trim()) {
          const said = castSpokenVote(agent, round, reply.trim());
          if (said) preamble.push(said);
        }
        // Under the SENTINEL transport the same thing happens when a seat
        // narrates before its bracket, or between two of them: the prose is
        // a preamble, held and spoken when the turn ends, so acting after
        // speaking costs nothing. (parse.ts finds the calls; this is where
        // the words go.)
        else if (!nativeCalls.length && sentinelActions.preamble) preamble.push(sentinelActions.preamble);
        // One completion, one trace: it belongs to the spoken message when
        // there is one, otherwise to the action event.
        const toolThinking = spoken ? undefined : thinking;
        const results: { callId?: string; observation: string }[] = [];

        for (const item of batch) {
          // Per-room budget (F4½): one action per round for the WHOLE room,
          // across search/write/run. A losing attempt is refused privately
          // and inaudibly; any spoken half of the turn still lands.
          const roomBudgetSpent = config.tools.budget === 'per-room' && roomToolRound === round;
          const deny: Refusal | undefined = roomBudgetSpent
            ? refusal(
                'budget_spent',
                `The room's one tool action for this round is already spent.`,
                'Wait for the next round — or talk to the others about who takes it.',
              )
            : steps >= maxSteps
              ? refusal(
                  'steps_exhausted',
                  `You have used ${maxSteps === 1 ? 'your action' : `all ${maxSteps} of your actions`} for this turn.`,
                  'Say something to the room, or let the turn pass; your next turn brings more.',
                )
              : undefined;
          const attemptsLeft = loop ? Math.max(0, MAX_TURN_REFUSALS - (refusals + 1)) : 0;

          // A native call that didn't survive validation (unknown tool, bad
          // arguments) never reaches executeAction: there is no action to
          // record, so it is answered privately and nothing else happens.
          if (isRefusal(item.action)) {
            refusals++;
            results.push({
              callId: item.call?.id,
              observation: formatRefusal(`Your ${item.call?.name ?? 'tool'} call did not run.`, item.action, attemptsLeft),
            });
            continue;
          }
          const { observation, refused } = await executeAction(agent, round, item.action, toolThinking, {
            deny,
            step: loop ? steps + 1 : undefined,
            attemptsLeft,
            ...(nativeTools?.length ? { via: item.call ? ('native' as const) : ('sentinel' as const) } : {}),
          });
          if (refused) refusals++;
          else steps++;
          results.push({ callId: item.call?.id, observation });
        }
        const joined = results.map((r) => r.observation).join('\n\n');

        if (spoken) {
          // Acted AND spoke: the utterance ends the turn, so what came back
          // waits for the next one — the original alongside economics. Any
          // preamble held from an earlier native step rides with it, so a
          // seat that narrates and then falls back to a sentinel doesn't
          // lose what it already said.
          const said = castSpokenVote(agent, round, spoken);
          const text = [...preamble, said].filter(Boolean).join('\n\n');
          preamble.length = 0;
          // A turn whose whole spoken half was the vote says nothing more:
          // the vote event is the record, and an empty message is not one.
          if (text) record({ kind: 'message', ts: now(), round, agentId: agent.id, agentName: agent.name, text, telemetry, thinking });
          pendingPrivate.set(agent.id, joined);
          break;
        }

        // Nothing was said, so the turn can continue — unless this room
        // doesn't loop, the caps are reached, or the session is ending
        // (a stop or the clock must not be held up by a working seat).
        const outOfRoad =
          !loop ||
          calls >= callCap ||
          refusals >= MAX_TURN_REFUSALS ||
          stopping ||
          existsSync(stopFile) ||
          Date.now() >= endAt;
        if (outOfRoad) {
          pendingPrivate.set(agent.id, joined);
          // A turn that worked and narrated still says its narration; a
          // turn that only worked still says nothing. The traces are
          // already on the action events, so this message carries none.
          flushPreamble(telemetry);
          break;
        }
        unread = joined;
        const left = Math.max(0, maxSteps - steps);
        if (nativeCalls.length) {
          // The API contract: every tool_call must be answered by a
          // tool-result message, or the next request is rejected. The
          // "how much turn is left" note follows as its own line.
          inTurn.push({ role: 'assistant', content: reply, toolCalls: nativeCalls });
          for (const r of results) inTurn.push({ role: 'tool', toolCallId: r.callId ?? '', content: r.observation });
          inTurn.push({ role: 'user', content: turnFooter(left) });
        } else {
          inTurn.push({ role: 'assistant', content: reply });
          inTurn.push({ role: 'user', content: observationBlock(joined, left) });
        }
      }

      if (failed) continue;

      previousLast = agent.id;
      await maybeSummarize(round);
      await sleep(config.interTurnDelaySeconds);
    }

    // §9.8: agreement is checked at the END of the round, never the moment
    // the last vote lands. Everyone still gets the turn they were owed, and
    // a seat that changes its mind — or edits the artifact, which clears
    // the count — is heard before the room closes. What ends the session is
    // therefore a state the room HELD for a whole round, not a race won by
    // whoever spoke last.
    if (roundComplete && agreementReached()) {
      ending = 'agreement';
      record({
        kind: 'system', ts: now(), round,
        text: `The room agreed the work is finished (${standingNames().join(', ')}).`,
      });
      break;
    }
  }

  // Why it stopped. 'agreement' is set inside the loop and wins; everything
  // else is read off the state that broke it. ('admin' covers a SIGINT too —
  // both arrive as the same stop.)
  ending ??= stopping ? 'admin' : existsSync(stopFile) ? 'stopfile' : Date.now() >= endAt ? 'clock' : 'rounds';
  record({ kind: 'system', ts: now(), round: -1, text: 'The session has ended.' });
  record({ kind: 'end', ts: now(), round: -1, payload: { adminTouched, rounds: roundsRun, traceSeats: [...traceSeats].sort(), ...(ending ? { ending } : {}) } });
  writeFileSync(join(sessionDir, 'summary-final.md'), summary || '(no rolling summary — full-context session or too short)');
  clog(`\nDone. Everything saved under ${sessionDir}`);
  return sessionId;
}
