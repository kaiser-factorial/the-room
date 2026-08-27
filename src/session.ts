import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SUMMARIZER_MODEL } from './config.js';
import { openrouterAdapter } from './openrouter.js';
import { adapterFor } from './adapters.js';
import { audibleEvents, buildSummaryPrompt, buildTurnMessages, contextSlice } from './context.js';
import { conditionRecord } from './conditions.js';
import { liveSinkEnabled, sinkEvent, sinkJournal } from './sink.js';
import { takeCommands } from './control.js';
import { parseReply } from './parse.js';
import { webSearch } from './search.js';
import { runPython } from './sandbox.js';
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
  const sharedFiles = new Map<string, string>();
  let roomToolRound = 0;
  const FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  const MAX_FILE_CHARS = 16_000;
  const MAX_FILES = 20;
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
  // by the prompt norm.
  const callMaxTokens =
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

      let reply: string;
      let telemetry;
      let thinking: string | undefined;
      try {
        const res = await adapterFor(agent).send(
          agent.model,
          buildTurnMessages({
            agent,
            config,
            events,
            summary,
            minutesRemaining,
            ownJournal: readJournal(agent.id),
            privateBlock: pendingPrivate.get(agent.id),
            sharedFiles: [...sharedFiles].map(([name, content]) => ({ name, content })),
          }),
          {
            maxTokens: callMaxTokens,
            sampling: config.sampling,
            reasoningEffort: config.reasoningEffort,
            logprobs: config.captureLogprobs,
            providerOrder: agent.providerOrder,
          },
        );
        reply = res.text;
        telemetry = res.meta;
        thinking = res.thinking;
        if (thinking) traceSeats.add(agent.id);
        // The private block was delivered on THIS completed turn — consume
        // it now (an errored turn above keeps it for the next attempt).
        pendingPrivate.delete(agent.id);
      } catch (err) {
        record({ kind: 'system', ts: now(), round, text: `${agent.name} could not speak this turn (${(err as Error).message.slice(0, 120)})` });
        continue;
      }

      const j = config.journal;
      const parsed = parseReply(reply, j, config.search, config.tools);

      // Per-room tool budget (F4½): one tool action per round for the whole
      // room, across search/write/run. A losing attempt is denied privately
      // and inaudibly; any spoken half of the turn still lands.
      const roomBudgetSpent = config.tools.budget === 'per-room' && roomToolRound === round;
      // Only an action that actually RUNS consumes the round's budget — a
      // gated refusal or an invalid write doesn't waste the room's one slot.
      const spendRoomBudget = () => { if (config.tools.budget === 'per-room') roomToolRound = round; };

      if (parsed.kind === 'pass') {
        if (j.pass.notice) record({ kind: 'system', ts: now(), round, text: `${agent.name} chose to say nothing.` });
        else clog(`\n   — ${agent.name} passed (silent).`);
      } else if (parsed.kind === 'alongside') {
        // One turn, one trace: attach it to the spoken message if there is
        // one, else to the journal event, so it's stored exactly once.
        if (parsed.entry) saveJournal(agent, round, parsed.entry, parsed.spoken ? undefined : thinking);
        if (parsed.spoken) record({ kind: 'message', ts: now(), round, agentId: agent.id, agentName: agent.name, text: parsed.spoken, telemetry, thinking });
      } else if (parsed.kind === 'journal') {
        saveJournal(agent, round, parsed.entry, thinking);
      } else if (parsed.kind === 'search') {
        // F4: replace mode spends the turn on the search; alongside mode
        // (`search-free`) also speaks parsed.spoken as a normal message.
        // Results (or the gated-refusal note) return privately on the
        // requester's next turn; the room at most hears the notice line.
        // Query/results never enter anyone else's context (privacy
        // invariant, tests/search.test.ts). One turn, one trace: attach it
        // to the spoken message when there is one, else the search event.
        const searchThinking = parsed.spoken ? undefined : thinking;
        if (roomBudgetSpent) {
          record({ kind: 'search', ts: now(), round, agentId: agent.id, agentName: agent.name, query: parsed.query, denied: true, notice: config.search.notice, thinking: searchThinking });
          pendingPrivate.set(agent.id, `Your search for "${parsed.query}" did not run: the room's one tool action for this round was already taken.`);
        } else if (config.search.gated && !searchCredit.has(agent.id)) {
          record({ kind: 'search', ts: now(), round, agentId: agent.id, agentName: agent.name, query: parsed.query, denied: true, notice: config.search.notice, thinking: searchThinking });
          pendingPrivate.set(agent.id, `Your search for "${parsed.query}" did not run: searching unlocks after you write in your journal.`);
        } else {
          searchCredit.delete(agent.id);
          spendRoomBudget();
          let results: string;
          try {
            results = await webSearch(parsed.query, config.search.maxResults);
          } catch (err) {
            // An errored search is invisible to the room (no notice on a
            // failure) but honest to the requester.
            record({ kind: 'search', ts: now(), round, agentId: agent.id, agentName: agent.name, query: parsed.query, denied: true, notice: config.search.notice, thinking: searchThinking });
            pendingPrivate.set(agent.id, `Your search for "${parsed.query}" failed (${(err as Error).message.slice(0, 120)}). You may try again.`);
            results = '';
          }
          if (results) {
            record({ kind: 'search', ts: now(), round, agentId: agent.id, agentName: agent.name, query: parsed.query, results, notice: config.search.notice, thinking: searchThinking });
            pendingPrivate.set(agent.id, `Results of your web search for "${parsed.query}":\n${results}`);
          }
        }
        if (parsed.spoken) record({ kind: 'message', ts: now(), round, agentId: agent.id, agentName: agent.name, text: parsed.spoken, telemetry, thinking });
      } else if (parsed.kind === 'write') {
        // F4½ shared-file write: contents are room-public; the transcript
        // carries only the notice line, everyone reads the file itself.
        const toolThinking = parsed.spoken ? undefined : thinking;
        const invalid = !FILE_NAME_RE.test(parsed.name)
          ? `"${parsed.name}" is not a valid file name (letters, digits, ., _, -; max 64 chars).`
          : parsed.content.length > MAX_FILE_CHARS
            ? `the contents exceed the ${MAX_FILE_CHARS}-character file limit.`
            : !sharedFiles.has(parsed.name) && sharedFiles.size >= MAX_FILES
              ? `the room already holds ${MAX_FILES} shared files.`
              : roomBudgetSpent
                ? `the room's one tool action for this round was already taken.`
                : null;
        if (invalid) {
          record({ kind: 'file', ts: now(), round, agentId: agent.id, agentName: agent.name, name: parsed.name.slice(0, 80), content: '', denied: true, notice: config.tools.notice, thinking: toolThinking });
          pendingPrivate.set(agent.id, `Your write to "${parsed.name.slice(0, 80)}" did not happen: ${invalid}`);
        } else {
          spendRoomBudget();
          sharedFiles.set(parsed.name, parsed.content);
          const sharedDir = join(sessionDir, 'shared');
          mkdirSync(sharedDir, { recursive: true });
          writeFileSync(join(sharedDir, parsed.name), parsed.content);
          record({ kind: 'file', ts: now(), round, agentId: agent.id, agentName: agent.name, name: parsed.name, content: parsed.content, notice: config.tools.notice, thinking: toolThinking });
        }
        if (parsed.spoken) record({ kind: 'message', ts: now(), round, agentId: agent.id, agentName: agent.name, text: parsed.spoken, telemetry, thinking });
      } else if (parsed.kind === 'run') {
        // F4½ python: code + output private to the caller (journal-class);
        // output returns like search results, in the next private block.
        const toolThinking = parsed.spoken ? undefined : thinking;
        if (roomBudgetSpent) {
          record({ kind: 'run', ts: now(), round, agentId: agent.id, agentName: agent.name, code: parsed.code, denied: true, notice: config.tools.notice, thinking: toolThinking });
          pendingPrivate.set(agent.id, `Your code did not run: the room's one tool action for this round was already taken.`);
        } else {
          spendRoomBudget();
          const output = await runPython(parsed.code, Object.fromEntries(sharedFiles), config.tools.pythonTimeoutSeconds, config.tools.pythonPackages);
          record({ kind: 'run', ts: now(), round, agentId: agent.id, agentName: agent.name, code: parsed.code, output, notice: config.tools.notice, thinking: toolThinking });
          pendingPrivate.set(agent.id, `Output of the code you ran:\n${output}`);
        }
        if (parsed.spoken) record({ kind: 'message', ts: now(), round, agentId: agent.id, agentName: agent.name, text: parsed.spoken, telemetry, thinking });
      } else if (parsed.kind === 'message') {
        record({ kind: 'message', ts: now(), round, agentId: agent.id, agentName: agent.name, text: parsed.text, telemetry, thinking });
      } else {
        // Empty visible text (e.g. reasoning ate the whole budget). Never
        // drop a turn silently — the room perceives silence, and analysis
        // needs the event. The trace (if any) rides along: it's often the
        // only record of what the silent turn was doing.
        record({ kind: 'system', ts: now(), round, text: `${agent.name} said nothing this turn.`, agentId: agent.id, thinking });
      }

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
