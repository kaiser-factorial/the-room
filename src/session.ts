import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SUMMARIZER_MODEL } from './config.js';
import { openrouterAdapter } from './openrouter.js';
import { adapterFor } from './adapters.js';
import { audibleEvents, buildSummaryPrompt, buildTurnMessages, contextSlice } from './context.js';
import { conditionRecord } from './conditions.js';
import { liveSinkEnabled, sinkEvent, sinkJournal } from './sink.js';
import { takeCommands } from './control.js';
import { isToolAction, parseReply, type ToolAction } from './parse.js';
import { webSearch } from './search.js';
import { runPython } from './sandbox.js';
import { readSource, sourceIndex } from './source.js';
import { applyConfigChange } from './governance.js';
import {
  effectiveTurnSteps, formatRefusal, loopEnabled, maxTurnCalls, observationBlock, refusal,
  MAX_TURN_REFUSALS, type Refusal,
} from './agentic.js';
import type { AgentConfig, RoomConfig, RoomEvent } from './types.js';

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
  /** Spend the room's single action for this round (per-room budget only).
   *  Called only by actions that actually RUN — a refusal never costs the
   *  room its slot. */
  const spendRoomBudget = (round: number) => { if (config.tools.budget === 'per-room') roomToolRound = round; };
  const FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  const MAX_FILE_CHARS = 16_000;
  const MAX_BINARY_BYTES = 400_000;
  const MAX_FILES = 20;

  /** Publish one shared file (from [WRITE] or a python run): store, mirror
   *  to disk, and record the room-visible file event. */
  function publishFile(agent: AgentConfig, round: number, name: string, data: Buffer, thinking?: string, step?: number) {
    const binary = data.includes(0);
    sharedFiles.set(name, { data, binary });
    const sharedDir = join(sessionDir, 'shared');
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(join(sharedDir, name), data);
    record({
      kind: 'file', ts: now(), round, agentId: agent.id, agentName: agent.name, name,
      content: binary ? data.toString('base64') : data.toString('utf8'),
      ...(binary ? { encoding: 'base64' as const } : {}),
      notice: config.tools.notice, thinking, ...(step ? { step } : {}),
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
    opts: { deny?: Refusal; step?: number; attemptsLeft: number },
  ): Promise<{ observation: string; refused: boolean }> {
    const { deny, step, attemptsLeft } = opts;
    const stamp = step ? { step } : {};
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
      publishFile(agent, round, parsed.name, Buffer.from(combined, 'utf8'), thinking, step);
      return {
        observation: `You ${parsed.append ? 'appended to' : 'wrote'} the shared file "${parsed.name}" (${combined.length} characters). Everyone in the room can read it.`,
        refused: false,
      };
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
        else publishFile(agent, round, name, Buffer.from(combined, 'utf8'), undefined, step);
      }
      for (const f of res.files) {
        const data = Buffer.from(f.dataBase64, 'base64');
        if (!FILE_NAME_RE.test(f.name)) publishNotes.push(`"${f.name}" was not published (invalid file name).`);
        else if (data.length > MAX_BINARY_BYTES) publishNotes.push(`"${f.name}" was not published (${data.length} bytes exceeds the ${MAX_BINARY_BYTES}-byte limit).`);
        else if (!sharedFiles.has(f.name) && sharedFiles.size >= MAX_FILES) publishNotes.push(`"${f.name}" was not published (the room already holds ${MAX_FILES} shared files).`);
        else publishFile(agent, round, f.name, data, undefined, step);
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

  for (let round = 1; round <= config.maxRounds; round++) {
    if (stopping || existsSync(stopFile) || Date.now() >= endAt) break;

    if (roundsUntilShuffle <= 0 || order.length === 0) {
      order = shuffledOrder(config.agents, previousLast);
      roundsUntilShuffle = drawInterval();
      record({ kind: 'order', ts: now(), round, order: order.map((a) => a.id) });
    }
    roundsUntilShuffle--;

    for (const agent of order) {
      await pollAdmin(round);
      if (stopping || existsSync(stopFile)) break;
      if (Date.now() >= endAt) break;
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
      const inTurn: { reply: string; observation: string }[] = [];
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
        let reply: string;
        let telemetry;
        let thinking: string | undefined;
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
            },
          );
          reply = res.text;
          telemetry = calls > 1 ? { ...res.meta, calls } : res.meta;
          thinking = res.thinking;
          if (thinking) traceSeats.add(agent.id);
          // The carried block was delivered on THIS completed call — consume
          // it now (an errored call above keeps it for the next attempt).
          pendingPrivate.delete(agent.id);
        } catch (err) {
          record({ kind: 'system', ts: now(), round, text: `${agent.name} could not speak this turn (${(err as Error).message.slice(0, 120)})` });
          if (unread) pendingPrivate.set(agent.id, unread);
          failed = true;
          break;
        }

        const j = config.journal;
        const parsed = parseReply(reply, j, config.search, config.tools);

        // ── Utterances: they end the turn where they stand ──────────────
        if (!isToolAction(parsed)) {
          if (parsed.kind === 'pass') {
            if (j.pass.notice) record({ kind: 'system', ts: now(), round, text: `${agent.name} chose to say nothing.` });
            else clog(`\n   — ${agent.name} passed (silent).`);
          } else if (parsed.kind === 'alongside') {
            // One call, one trace: attach it to the spoken message if there
            // is one, else to the journal event, so it's stored exactly once.
            if (parsed.entry) saveJournal(agent, round, parsed.entry, parsed.spoken ? undefined : thinking);
            if (parsed.spoken) record({ kind: 'message', ts: now(), round, agentId: agent.id, agentName: agent.name, text: parsed.spoken, telemetry, thinking });
          } else if (parsed.kind === 'journal') {
            saveJournal(agent, round, parsed.entry, thinking);
          } else if (parsed.kind === 'message') {
            record({ kind: 'message', ts: now(), round, agentId: agent.id, agentName: agent.name, text: parsed.text, telemetry, thinking });
          } else {
            // Empty visible text (e.g. reasoning ate the whole budget). Never
            // drop a turn silently — the room perceives silence, and analysis
            // needs the event. The trace (if any) rides along: it's often the
            // only record of what the silent turn was doing. A turn that has
            // already acted ends here quietly, which is the loop's normal way
            // of finishing a turn spent working rather than talking.
            record({ kind: 'system', ts: now(), round, text: `${agent.name} said nothing this turn.`, agentId: agent.id, thinking });
          }
          break;
        }

        // ── Actions ────────────────────────────────────────────────────
        // Per-room budget (F4½): one action per round for the WHOLE room,
        // across search/write/run. A losing attempt is refused privately and
        // inaudibly; any spoken half of the turn still lands.
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
        // One call, one trace: it belongs to the spoken message when there
        // is one, otherwise to the action event.
        const toolThinking = parsed.spoken ? undefined : thinking;
        const { observation, refused } = await executeAction(agent, round, parsed, toolThinking, {
          deny,
          step: loop ? steps + 1 : undefined,
          attemptsLeft: loop ? Math.max(0, MAX_TURN_REFUSALS - (refusals + 1)) : 0,
        });
        if (refused) refusals++;
        else steps++;

        if (parsed.spoken) {
          // Acted AND spoke: the utterance ends the turn, so what came back
          // waits for the next one — the original alongside economics.
          record({ kind: 'message', ts: now(), round, agentId: agent.id, agentName: agent.name, text: parsed.spoken, telemetry, thinking });
          pendingPrivate.set(agent.id, observation);
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
          pendingPrivate.set(agent.id, observation);
          break;
        }
        unread = observation;
        inTurn.push({ reply, observation: observationBlock(observation, Math.max(0, maxSteps - steps)) });
      }

      if (failed) continue;

      previousLast = agent.id;
      await maybeSummarize(round);
      await sleep(config.interTurnDelaySeconds);
    }
  }

  record({ kind: 'system', ts: now(), round: -1, text: 'The session has ended.' });
  record({ kind: 'end', ts: now(), round: -1, payload: { adminTouched, traceSeats: [...traceSeats].sort() } });
  writeFileSync(join(sessionDir, 'summary-final.md'), summary || '(no rolling summary — full-context session or too short)');
  clog(`\nDone. Everything saved under ${sessionDir}`);
  return sessionId;
}
