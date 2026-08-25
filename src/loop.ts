// `npm start` — run one session, then exit. Condition selection:
//   npm start                          → 'house' (the live room's default)
//   ROOM_CONDITION=<name> npm start    → named condition ('control', etc.)
// For the admin-driven daemon that starts sessions on command, see runner.ts.

import './env.js';
import { resolveCondition, listConditions } from './conditions.js';
import { runSession } from './session.js';

const name = process.env.ROOM_CONDITION || 'house';
let config;
try {
  config = resolveCondition(name);
} catch (err) {
  console.error(`Could not resolve condition '${name}': ${(err as Error).message}`);
  console.error(`Available: control, ${listConditions().join(', ')}`);
  process.exit(1);
}

let handle: { stop: () => void } | undefined;
process.on('SIGINT', () => {
  console.log('\nStopping after current turn…');
  handle?.stop();
});

runSession(config, (h) => { handle = h; }).catch((err) => {
  console.error(err);
  process.exit(1);
});
