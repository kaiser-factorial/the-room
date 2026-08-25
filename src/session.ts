import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SUMMARIZER_MODEL } from './config.js';
import { openrouterAdapter } from './openrouter.js';
import { audibleEvents, buildSummaryPrompt, buildTurnMessages, contextSlice } from './context.js';
import { conditionRecord } from './conditions.js';
import { liveSinkEnabled, sinkEvent, sinkJournal } from './sink.js';
import { takeCommands } from './control.js';
import type { AgentConfig, RoomConfig, RoomEvent } from './types.js';

const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
const now = () => new Date().toISOString();

// Loose sentinel matches: models bold/colon these more often than not.
const JOURNAL_REPLACE_RE = /^\s*\**\[JOURNAL\]:?\**\s*([\s\S]*)/i;
const JOURNAL_ALONGSIDE_RE = /^\s*\**\[JOURNAL\]:?\**\s*([\s\S]*?)\[\/JOURNAL\]\s*([\s\S]*)/i;
const PASS_RE = /^\s*\**\[PASS\]\**\s*$/i;

// Shuffles honor one constraint: a new order's first speaker never equals the
// previous round's last speaker (no double turns across the boundary).
function shuffledOrder(agents: AgentConfig[], previousLast: string | null): AgentConfig[] {
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
  const sessionId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
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
  onHandle?.({ stop: () => { stopping = true; } });

  function record(e: RoomEvent) {
    events.push(e);
    appendFileSync(transcriptPath, JSON.stringify(e) + '\n');
    sinkEvent(sessionId, e);
    if (e.kind === 'message') console.log(`\n── ${e.agentName} ──\n${e.text}`);
    else if (e.kind === 'journal') console.log(`\n   ✎ ${e.agentName} stepped away to journal.`);
    else if (e.kind === 'system') console.log(`\n   ⋯ ${e.text}`);
  }

  function readJournal(agentId: string): string {
    const p = join(journalsDir, `${agentId}.md`);
    return existsSync(p) ? readFileSync(p, 'utf8') : '';
  }

  function saveJournal(agent: AgentConfig, round: number, entry: string, thinking?: string) {
    appendFileSync(join(journalsDir, `${agent.id}.md`), `\n## Round ${round} — ${now()}\n\n${entry}\n`);
    sinkJournal(sessionId, round, agent.id, agent.name, entry);
    if (config.journal.notice) {
      record({ kind: 'journal', ts: now(), round, agentId: agent.id, agentName: agent.name, thinking });
    } else {
      // No room event — but the local console still shows it happened.
      console.log(`\n   ✎ ${agent.name} journaled (silent).`);
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
        console.log('Admin stop received.');
        stopping = true;
      } else if (cmd.kind === 'say' && cmd.payload?.text) {
        adminTouched = true;
        record({ kind: 'message', ts: now(), round, agentId: 'admin', agentName: 'Admin', text: cmd.payload.text });
      }
    }
  }

  const endAt = Date.now() + config.durationMinutes * 60_000;
  console.log(`Session ${sessionId} — condition '${config.conditionName}', ${config.agents.length} agents, ${config.durationMinutes} min.`);
  console.log(`Transcript: ${transcriptPath}`);
  console.log(liveSinkEnabled ? 'Live sink: ON (Supabase)' : 'Live sink: off (set SUPABASE_URL + SUPABASE_SERVICE_KEY)');
  console.log(`To stop gracefully: Ctrl-C, or \`touch ${stopFile}\``);

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
    },
  });
  const welcomeText =
    config.countdown === 'told-once'
      ? `${config.welcomeMessage} You have ${config.durationMinutes} minutes together; you will not be reminded of the time again.`
      : config.welcomeMessage;
  record({ kind: 'system', ts: now(), round: 0, text: welcomeText });

  // Long-form journal variant: the call cap must leave room for the entry.
  const callMaxTokens =
    config.journal.enabled && config.journal.maxTokens > 0
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
        const res = await openrouterAdapter.send(
          agent.model,
          buildTurnMessages({
            agent,
            config,
            events,
            summary,
            minutesRemaining,
            ownJournal: readJournal(agent.id),
          }),
          { maxTokens: callMaxTokens, sampling: config.sampling, reasoningEffort: config.reasoningEffort },
        );
        reply = res.text;
        telemetry = res.meta;
        thinking = res.thinking;
        if (thinking) traceSeats.add(agent.id);
      } catch (err) {
        record({ kind: 'system', ts: now(), round, text: `${agent.name} could not speak this turn (${(err as Error).message.slice(0, 120)})` });
        continue;
      }

      const j = config.journal;
      const passMatch = j.enabled && j.pass.enabled && reply.match(PASS_RE);
      const alongsideMatch = j.enabled && j.mode === 'alongside' ? reply.match(JOURNAL_ALONGSIDE_RE) : null;
      // Privacy fallback: in alongside mode an opening [JOURNAL] with no
      // closing tag was meant to be private — journal the whole reply rather
      // than leak it to the room. In replace mode this is the normal parse.
      const replaceMatch = j.enabled && !alongsideMatch ? reply.match(JOURNAL_REPLACE_RE) : null;

      if (passMatch) {
        if (j.pass.notice) record({ kind: 'system', ts: now(), round, text: `${agent.name} chose to say nothing.` });
        else console.log(`\n   — ${agent.name} passed (silent).`);
      } else if (alongsideMatch) {
        const entry = alongsideMatch[1].trim();
        const spoken = alongsideMatch[2].trim();
        // One turn, one trace: attach it to the spoken message if there is
        // one, else to the journal event, so it's stored exactly once.
        if (entry) saveJournal(agent, round, entry, spoken ? undefined : thinking);
        if (spoken) record({ kind: 'message', ts: now(), round, agentId: agent.id, agentName: agent.name, text: spoken, telemetry, thinking });
      } else if (replaceMatch) {
        saveJournal(agent, round, replaceMatch[1].trim(), thinking);
      } else if (reply) {
        record({ kind: 'message', ts: now(), round, agentId: agent.id, agentName: agent.name, text: reply, telemetry, thinking });
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
  console.log(`\nDone. Everything saved under ${sessionDir}`);
  return sessionId;
}
