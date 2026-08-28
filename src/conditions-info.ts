// Emit conditions.json for the viewer's admin panel: every named condition
// with its description and the EXACT overrides it applies on top of the
// control config — so the (i) expander in the panel can spell out what a
// condition changes without the static viewer needing repo access.
// Run at deploy time by deploy/deploy.sh:  tsx src/conditions-info.ts > out

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listConditions } from './conditions.js';

const entries = [
  {
    name: 'control',
    description: 'The base state — every knob at its SUMMARY.md control value: no journal, no tools, hidden countdown, named roster but NO self-disclosure (the room never says which of the six you are), the transcript as your own turns, full context, effort low, and a 1200-token VISIBLE cap with reasoning allowed on top. Every other condition is diffs on top of this.',
    overrides: {},
  },
  ...listConditions().map((name) => {
    const spec = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'conditions', `${name}.json`), 'utf8')) as Record<string, unknown>;
    const { description, ...overrides } = spec;
    return { name, description: (description as string) ?? '', overrides };
  }),
];

console.log(JSON.stringify(entries, null, 2));
