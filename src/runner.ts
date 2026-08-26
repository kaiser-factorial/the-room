// `npm run runner` — long-lived daemon: polls room_control for admin `start`
// commands and runs sessions on demand. One session at a time; `start` while
// a session is live is dropped with a log line (commands are consumed before
// execution, so a crash-restart never replays them).
//
// Start payload: { condition?: string, minutes?, delaySeconds?, agentIds?,
// shuffle? } — condition names a preset in conditions/; the rest are ad-hoc
// overrides applied on top.

import { createServer } from 'node:http';
import './env.js';
import { resolveCondition } from './conditions.js';
import { runSession } from './session.js';
import { controlEnabled, takeCommands, type StartPayload } from './control.js';
import type { RoomConfig } from './types.js';

if (!controlEnabled) {
  console.error('Runner needs SUPABASE_URL + SUPABASE_SERVICE_KEY (the control plane lives in Supabase).');
  process.exit(1);
}

// Minimal status endpoint. Hosted platforms (HF Docker Spaces, Fly, …)
// require the container to answer HTTP on $PORT or they mark it broken;
// it also gives the admin dashboard a liveness probe. No control surface
// here — commands only ever come through room_control.
const bootedAt = Date.now();
createServer((_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, state: running ? 'in-session' : 'idle', uptimeSec: Math.round((Date.now() - bootedAt) / 1000) }));
}).listen(Number(process.env.PORT) || 7860, () => {
  console.log(`Status endpoint on :${Number(process.env.PORT) || 7860}`);
});

function configFrom(p: StartPayload | null): RoomConfig {
  const overrides: Record<string, unknown> = {};
  if (p?.minutes && p.minutes > 0) overrides.durationMinutes = Math.min(p.minutes, 24 * 60);
  if (p?.delaySeconds && p.delaySeconds > 0) overrides.interTurnDelaySeconds = p.delaySeconds;
  if (p?.agentIds?.length) overrides.agents = p.agentIds;
  if (p?.shuffle) {
    overrides.shuffle =
      p.shuffle.kind === 'periodic'
        ? { kind: 'periodic', minRounds: p.shuffle.minRounds ?? 3, maxRounds: p.shuffle.maxRounds ?? 6 }
        : { kind: p.shuffle.kind };
  }
  return resolveCondition(p?.condition || 'house', overrides);
}

let running = false;
let handle: { stop: () => void } | undefined;
process.on('SIGINT', () => {
  if (running) {
    console.log('\nStopping session after current turn… (Ctrl-C again to kill the runner)');
    handle?.stop();
    running = false; // second Ctrl-C path below
  } else {
    process.exit(0);
  }
});

// Execute one start payload: a plain session, or a batch (count ×
// conditions, INTERLEAVED — §6.1: condition A, B, A, B, never blocks).
// Admin `stop` mid-session ends that session (via the session's own poll);
// a further `stop` between batch sessions aborts the rest of the batch.
async function runStart(payload: StartPayload | null): Promise<void> {
  const b = payload?.batch;
  const conditions = b?.conditions?.length ? b.conditions : [payload?.condition || 'house'];
  const count = Math.max(1, Math.min(b?.count ?? 1, 50));
  const total = count * conditions.length;
  const batchName = total > 1 ? (b?.name || `batch-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`) : undefined;
  let index = 0;
  outer: for (let r = 0; r < count; r++) {
    for (const cond of conditions) {
      if (index > 0 && (await takeCommands(['stop'])).length) {
        console.log(`Batch ${batchName}: aborted by admin after ${index}/${total} sessions.`);
        break outer;
      }
      const cfg = configFrom({ ...payload, condition: cond });
      if (batchName) cfg.batch = { name: batchName, index: index++, total };
      console.log(`Start${batchName ? ` [${batchName} ${index}/${total}]` : ''}: condition '${cfg.conditionName}', ${cfg.agents.length} agents, ${cfg.durationMinutes} min, shuffle=${cfg.shuffle.kind}`);
      await runSession(cfg, (h) => { handle = h; });
    }
  }
}

// Boot drain: commands that arrived while NO runner was listening are stale
// mail, not intent — a `start` sent hours ago must not fire a surprise
// session the moment the runner (re)boots. (Learned live 2026-08-25: a
// start from 03:50 sat unconsumed and ran at 18:31 when the Space booted.)
const stale = await takeCommands(['start', 'stop', 'say']);
if (stale.length) console.log(`Boot: discarded ${stale.length} stale command(s) queued before startup.`);

console.log('Runner up — waiting for admin start commands (polling every 3s).');

// Queue + autopilot. Queued starts (admin while busy) run first; autopilot
// then cycles its condition list round-robin, forever, with a pause between
// sessions, until a stop with {scope:'loop'}. Both are in-memory: a runner
// restart clears them (boot drain above makes that explicit, not silent).
const queue: (StartPayload | null)[] = [];
let autopilot: { conditions: string[]; pauseMs: number; base: StartPayload; next: number; maxSessions: number } | null = null;
let nextAutoAt = 0;

for (;;) {
  for (const cmd of await takeCommands(['start', 'stop', 'say'])) {
    if (cmd.kind === 'start' && cmd.payload?.loop) {
      const conditions = cmd.payload.loop.conditions?.length ? cmd.payload.loop.conditions : [cmd.payload.condition || 'house'];
      const sets = cmd.payload.loop.sets && cmd.payload.loop.sets > 0 ? Math.min(cmd.payload.loop.sets, 100) : Infinity;
      autopilot = {
        conditions,
        pauseMs: Math.max(0, cmd.payload.loop.pauseMinutes ?? 10) * 60_000,
        base: cmd.payload,
        next: 0,
        maxSessions: sets * conditions.length,
      };
      nextAutoAt = 0; // first rotation session starts immediately
      console.log(`Autopilot ON: rotating [${conditions.join(', ')}], ${autopilot.pauseMs / 60000} min gap, ${Number.isFinite(autopilot.maxSessions) ? `${autopilot.maxSessions} sessions total` : 'forever'}.`);
    } else if (cmd.kind === 'start') {
      queue.push(cmd.payload);
      console.log(`Queued start (${cmd.payload?.condition || 'house'}) — position ${queue.length}.`);
    } else if (cmd.kind === 'stop' && cmd.payload?.scope === 'loop') {
      autopilot = null;
      console.log('Autopilot OFF (queue kept).');
    } else if (cmd.kind === 'stop') {
      // Plain stop while idle: full stand-down.
      queue.length = 0;
      autopilot = null;
      console.log('Stop while idle — queue cleared, autopilot off.');
    }
    // stray `say` with no live session: dropped (nothing to speak into)
  }

  let payload: (StartPayload & { fromAutopilot?: boolean }) | null | undefined;
  if (queue.length) payload = queue.shift();
  else if (autopilot && Date.now() >= nextAutoAt) {
    const cond = autopilot.conditions[autopilot.next % autopilot.conditions.length];
    autopilot.next++;
    payload = { ...autopilot.base, condition: cond, batch: undefined, loop: undefined, fromAutopilot: true };
    if (autopilot.next >= autopilot.maxSessions) {
      console.log(`Autopilot: final rotation session (${autopilot.next}/${autopilot.maxSessions}) — autopilot ends after it.`);
      autopilot = null;
    }
  }

  if (payload !== undefined) {
    running = true;
    try {
      await runStart(payload);
    } catch (err) {
      console.error('session failed:', err);
    }
    running = false;
    if (autopilot) {
      nextAutoAt = Date.now() + autopilot.pauseMs;
      console.log(`Autopilot: next rotation session at ${new Date(nextAutoAt).toISOString()} (queued starts run sooner).`);
    }
  }
  await new Promise((r) => setTimeout(r, 3000));
}
