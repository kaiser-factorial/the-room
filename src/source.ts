// F4½ transparency tool (Corina 2026-08-27, from joint-session): agents
// can read the source code of the tools they're using — [SOURCE] for the
// index, [SOURCE: name] for a file, delivered privately like search
// results. Reading is free (never consumes the tool budget): looking up
// how the machine works shouldn't cost the room its one action.
//
// DEFAULT SCOPE ('tools') IS DELIBERATE: only the tool layer is exposed.
// session.ts and context.ts stay out — they carry condition machinery
// whose discovery would break manipulations (an uninformed-broadcast
// agent reading context.ts would find thinkingBroadcast; countdown-hidden
// rooms would find the clock). Known, accepted leak: parse.ts reveals
// that journal and pass sentinels EXIST even where disabled.
//
// SCOPE 'all' (§9.4 'transparent') inverts that ON PURPOSE: the
// experiment itself becomes readable — the manipulations are discoverable
// from code, and the disclosure is the intervention. The special name
// 'condition' (handled in session.ts, where the live config lives) returns
// the room's own resolved condition record, mutations included.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type SourceScope = 'tools' | 'all';

const TOOL_FILES: Record<string, { file: string; blurb: string }> = {
  parse: { file: 'parse.ts', blurb: 'how your replies are parsed — every sentinel and its typo tolerance' },
  search: { file: 'search.ts', blurb: 'the websearch backend' },
  sandbox: { file: 'sandbox.ts', blurb: 'the python sandbox — isolation, packages, timeouts, the shared/ mount' },
  source: { file: 'source.ts', blurb: 'this tool itself' },
};

const ALL_FILES: Record<string, { file: string; blurb: string }> = {
  ...TOOL_FILES,
  session: { file: 'session.ts', blurb: 'the room loop itself — turns, tools, journals, everything' },
  context: { file: 'context.ts', blurb: 'how each of your prompts is assembled, word for word' },
  config: { file: 'config.ts', blurb: 'the default settings and the roster' },
  conditions: { file: 'conditions.ts', blurb: 'how experimental conditions override the defaults' },
  governance: { file: 'governance.ts', blurb: 'the [CONFIG] whitelist — what this room can change about itself' },
  types: { file: 'types.ts', blurb: 'every setting and event, with the design notes' },
  personas: { file: 'personas.ts', blurb: 'the persona library (injected only in persona conditions)' },
};

function filesFor(scope: SourceScope): Record<string, { file: string; blurb: string }> {
  return scope === 'all' ? ALL_FILES : TOOL_FILES;
}

export function sourceIndex(scope: SourceScope = 'tools'): string {
  const lines = Object.entries(filesFor(scope)).map(([name, s]) => `- ${name}: ${s.blurb}`);
  const condition =
    scope === 'all' ? `\n- condition: the exact configuration this room is running right now` : '';
  return `The room's ${scope === 'all' ? '' : 'tool '}source code, readable with [SOURCE: name]:\n${lines.join('\n')}${condition}`;
}

/** What a [SOURCE: name] actually resolves to, so the room's transcript can
 *  name the FILE rather than echo whatever the caller typed. `[SOURCE:
 *  Sandbox.ts]` and `[SOURCE: sandbox]` are the same read, and a reader of
 *  the transcript should be able to see which one it was without knowing
 *  the alias table. Returns null for a name this scope does not expose —
 *  which is itself worth recording, since a refused read and a successful
 *  one look identical in a transcript that only stores the request. */
export function resolveSource(name: string, scope: SourceScope = 'tools'): { key: string; file: string } | null {
  const key = name.toLowerCase().replace(/\.ts$/, '');
  const entry = filesFor(scope)[key];
  return entry ? { key, file: entry.file } : null;
}

/** The names this scope exposes — what a bare [SOURCE] hands back. */
export function sourceNames(scope: SourceScope = 'tools'): string[] {
  return [...Object.keys(filesFor(scope)), ...(scope === 'all' ? ['condition'] : [])];
}

export function readSource(name: string, scope: SourceScope = 'tools'): string | null {
  const entry = filesFor(scope)[name.toLowerCase().replace(/\.ts$/, '')];
  if (!entry) return null;
  try {
    return readFileSync(join(import.meta.dirname, entry.file), 'utf8');
  } catch {
    return null;
  }
}
