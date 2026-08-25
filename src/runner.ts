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

console.log('Runner up — waiting for admin start commands (polling every 3s).');

for (;;) {
  // Drain everything while idle: a `stop`/`say` with no live session is stale
  // and must not leak into the next session's first poll.
  const cmds = await takeCommands(['start', 'stop', 'say']);
  const start = cmds.find((c) => c.kind === 'start');
  if (start && !running) {
    running = true;
    try {
      // Batch mode: count rounds over the condition list, interleaved
      // (§6.1: condition A, B, A, B — never blocks). A plain start is the
      // degenerate 1×[condition] batch. Admin `stop` mid-session ends that
      // session (via the session's own poll); a further `stop` arriving
      // between sessions aborts the rest of the batch.
      const b = start.payload?.batch;
      const conditions = b?.conditions?.length ? b.conditions : [start.payload?.condition || 'house'];
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
          const cfg = configFrom({ ...start.payload, condition: cond });
          if (batchName) cfg.batch = { name: batchName, index: index++, total };
          console.log(`Admin start${batchName ? ` [${batchName} ${index}/${total}]` : ''}: condition '${cfg.conditionName}', ${cfg.agents.length} agents, ${cfg.durationMinutes} min, shuffle=${cfg.shuffle.kind}`);
          await runSession(cfg, (h) => { handle = h; });
        }
      }
    } catch (err) {
      console.error('session failed:', err);
    }
    running = false;
  } else if (start && running) {
    console.log('Ignored start command — a session is already running.');
  }
  await new Promise((r) => setTimeout(r, 3000));
}
