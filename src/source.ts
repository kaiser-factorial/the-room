// F4½ transparency tool (Corina 2026-08-27, from joint-session): agents
// can read the source code of the tools they're using — [SOURCE] for the
// index, [SOURCE: name] for a file, delivered privately like search
// results. Reading is free (never consumes the tool budget): looking up
// how the machine works shouldn't cost the room its one action.
//
// SCOPE IS DELIBERATE: only the tool layer is exposed. session.ts and
// context.ts stay out — they carry condition machinery whose discovery
// would break manipulations (an uninformed-broadcast agent reading
// context.ts would find thinkingBroadcast; countdown-hidden rooms would
// find the clock). Known, accepted leak: parse.ts reveals that journal
// and pass sentinels EXIST even in conditions where they're disabled.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_FILES: Record<string, { file: string; blurb: string }> = {
  parse: { file: 'parse.ts', blurb: 'how your replies are parsed — every sentinel and its typo tolerance' },
  search: { file: 'search.ts', blurb: 'the websearch backend' },
  sandbox: { file: 'sandbox.ts', blurb: 'the python sandbox — isolation, packages, timeouts, the shared/ mount' },
  source: { file: 'source.ts', blurb: 'this tool itself' },
};

export function sourceIndex(): string {
  const lines = Object.entries(SOURCE_FILES).map(([name, s]) => `- ${name}: ${s.blurb}`);
  return `The room's tool source code, readable with [SOURCE: name]:\n${lines.join('\n')}`;
}

export function readSource(name: string): string | null {
  const entry = SOURCE_FILES[name.toLowerCase().replace(/\.ts$/, '')];
  if (!entry) return null;
  try {
    return readFileSync(join(import.meta.dirname, entry.file), 'utf8');
  } catch {
    return null;
  }
}
