// F2: batch runner. Runs N sessions per condition, INTERLEAVED across
// conditions (§6.1: never "condition A this week, B next" — snapshot drift),
// and writes a manifest that analyze.ts --batch consumes.
//
//   npm run batch -- --name pilot-length --count 5 house control
//
// runs house, control, house, control, … (5 of each, alternating), writing
// batches/pilot-length.json as it goes — a crash keeps every completed
// session in the manifest. Ctrl-C stops after the current session.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import './env.js';
import { resolveCondition } from './conditions.js';
import { runSession, type SessionHandle } from './session.js';

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
const name = flag('name');
const count = Number(flag('count') ?? 1);
const conditions = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--name' && args[i - 1] !== '--count');

if (!name || !conditions.length || !Number.isFinite(count) || count < 1) {
  console.error('usage: npm run batch -- --name <batch> --count <N> <condition> [<condition> …]');
  process.exit(1);
}

const batchesDir = join(import.meta.dirname, '..', 'batches');
mkdirSync(batchesDir, { recursive: true });
const manifestPath = join(batchesDir, `${name}.json`);
const manifest = { name, createdAt: new Date().toISOString(), plannedPerCondition: count, sessions: [] as { id: string; condition: string }[] };

let stopping = false;
let handle: SessionHandle | undefined;
process.on('SIGINT', () => {
  console.log('\nBatch: stopping after the current session…');
  stopping = true;
  handle?.stop();
});

// Interleave: round r runs every condition once, in order.
for (let r = 0; r < count && !stopping; r++) {
  for (const cond of conditions) {
    if (stopping) break;
    console.log(`\n═══ batch ${name}: session ${manifest.sessions.length + 1}/${count * conditions.length} (${cond}) ═══`);
    const config = resolveCondition(cond);
    const id = await runSession(config, (h) => { handle = h; });
    manifest.sessions.push({ id, condition: cond });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }
}

console.log(`\nBatch ${stopping ? 'stopped early' : 'complete'}: ${manifest.sessions.length} sessions → ${manifestPath}`);
console.log(`Analyze with: npm run analyze -- --batch ${manifestPath}`);
