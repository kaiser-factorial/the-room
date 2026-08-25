// `npm run runner` — long-lived daemon: polls room_control for admin `start`
// commands and runs sessions on demand. One session at a time; `start` while
// a session is live is dropped with a log line (commands are consumed before
// execution, so a crash-restart never replays them).
//
// Start payload: { condition?: string, minutes?, delaySeconds?, agentIds?,
// shuffle? } — condition names a preset in conditions/; the rest are ad-hoc
// overrides applied on top.

import './env.js';
import { resolveCondition } from './conditions.js';
import { runSession } from './session.js';
import { controlEnabled, takeCommands, type StartPayload } from './control.js';
import type { RoomConfig } from './types.js';

if (!controlEnabled) {
  console.error('Runner needs SUPABASE_URL + SUPABASE_SERVICE_KEY (the control plane lives in Supabase).');
  process.exit(1);
}

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
      const cfg = configFrom(start.payload);
      console.log(`Admin start: condition '${cfg.conditionName}', ${cfg.agents.length} agents, ${cfg.durationMinutes} min, shuffle=${cfg.shuffle.kind}`);
      await runSession(cfg, (h) => { handle = h; });
    } catch (err) {
      console.error('session failed:', err);
    }
    running = false;
  } else if (start && running) {
    console.log('Ignored start command — a session is already running.');
  }
  await new Promise((r) => setTimeout(r, 3000));
}
