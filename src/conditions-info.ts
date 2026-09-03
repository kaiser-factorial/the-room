// Emit conditions.json for the viewer's admin panel: every named condition
// with its description, the EXACT overrides it applies on top of the
// control config — so the (i) expander in the panel can spell out what a
// condition changes without the static viewer needing repo access — and
// its resolved SEATS (id, name, colour), so the panel's seat picker can
// show a room's own roster: a same-family room (§9.12) seats siblings the
// viewer's hardcoded catalog has never heard of, and the picker used to
// offer the six roster seats regardless, sending an override that would
// have quietly replaced the family with the mixed room.
// Run at deploy time by deploy/deploy.sh:  tsx src/conditions-info.ts > out

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { listConditions, resolveCondition } from './conditions.js';

export interface ConditionEntry {
  name: string;
  description: string;
  overrides: Record<string, unknown>;
  /** The room this condition seats, resolved — what the picker offers. */
  seats: { id: string; name: string; color: string }[];
}

const seatsOf = (name: string) =>
  resolveCondition(name).agents.map(({ id, name, color }) => ({ id, name, color }));

export function conditionEntries(): ConditionEntry[] {
  return [
    {
      name: 'control',
      description: 'The base state — every knob at its SUMMARY.md control value: no journal, no tools, hidden countdown, named roster but NO self-disclosure (the room never says which of the six you are), the transcript as your own turns, full context, effort low, and a 1200-token VISIBLE cap with reasoning allowed on top. Every other condition is diffs on top of this.',
      overrides: {},
      seats: seatsOf('control'),
    },
    ...listConditions().map((name) => {
      const spec = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'conditions', `${name}.json`), 'utf8')) as Record<string, unknown>;
      const { description, ...overrides } = spec;
      return { name, description: (description as string) ?? '', overrides, seats: seatsOf(name) };
    }),
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(conditionEntries(), null, 2));
}
