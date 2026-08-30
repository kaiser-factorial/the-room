// F4¾ native transport: the room's bench declared as OpenAI-format tool
// definitions, so a seat emits a structured tool call instead of placing a
// bracket in its prose. Adapted from joint-session's skills.ts, which
// replaced that project's own regex text-triggers for the same reason: a
// mistyped sentinel is spoken to the room as a sentence, and its author
// learns nothing.
//
// DELIBERATELY MECHANICS-ONLY. The room keeps describing its own furniture
// in the system prompt, in the room's voice ("There is a small shared
// filesystem in the room — files everyone can read") — that paragraph is
// what makes the filesystem a social object rather than a scratchpad, and
// it is the frame the experiment is measured in (Corina 2026-08-27: keep
// furniture phrasing). These descriptions carry only what the schema layer
// must know: argument names, caps, and what comes back. Anything about who
// SEES a thing belongs upstairs, in the prompt.
//
// Only ENABLED tools are declared: a tool the model cannot name is a
// stronger boundary than one that refuses (scatter-lab's rule for its
// row-access tools under a private data policy).

import { refusal, type Refusal } from './agentic.js';
import type { ToolCall } from './openrouter.js';
import type { ToolAction } from './parse.js';
import type { RoomConfig } from './types.js';

export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  };
}

const fn = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required?: string[],
): ToolDef => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, ...(required ? { required } : {}) } } });

/** The tool names the room can offer. Kept as a const so the parser-side
 *  mapping and the tests can't drift from the declarations. */
export const TOOL_NAMES = ['search_web', 'write_file', 'delete_file', 'run_python', 'read_source', 'set_config'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export function toolDefs(config: RoomConfig): ToolDef[] {
  const t = config.tools;
  const defs: ToolDef[] = [];
  if (config.search.enabled) {
    defs.push(fn(
      'search_web',
      `Search the web. Returns up to ${config.search.maxResults} results to you privately.`,
      { query: { type: 'string', description: 'The search query.' } },
      ['query'],
    ));
  }
  if (t.files) {
    // The limits come from the CONFIG, not from a sentence written once.
    // They were hardcoded at "20 files, 16000 characters" — so a native
    // task room with a 60,000-character ceiling was told 16,000 by its own
    // tool definitions while its prose said 60,000. A seat that believes
    // the schema plans smaller than it needs to and never finds out why.
    defs.push(fn(
      'write_file',
      'Create, overwrite, or extend a file in the room\'s shared filesystem. ' +
        (t.directories
          ? 'Names may use letters, digits, dots, underscores and hyphens, and may include folders (e.g. "src/parser.py"), up to 4 levels deep. '
          : 'Names may use letters, digits, dots, underscores and hyphens (max 64 characters). ') +
        `At most ${t.maxFiles} files, ${t.maxFileChars} characters each.`,
      {
        name: { type: 'string', description: t.directories ? 'File name, e.g. "notes.md" or "src/parser.py".' : 'File name, e.g. "notes.md".' },
        content: { type: 'string', description: 'The text to write.' },
        append: { type: 'boolean', description: 'Add to the end of the file instead of replacing it. Default false.' },
      },
      ['name', 'content'],
    ));
  }
  if (t.files && t.fileDelete) {
    defs.push(fn(
      'delete_file',
      'Remove a file from the room\'s shared filesystem. It is gone for everyone and no copy is kept.',
      { name: { type: 'string', description: 'The file to remove.' } },
      ['name'],
    ));
  }
  if (t.python) {
    defs.push(fn(
      'run_python',
      `Run Python in a fresh sandbox (${t.pythonTimeoutSeconds}s). The shared files are mounted read/write at shared/. ` +
        (t.pythonPackages.length ? `The standard library plus ${t.pythonPackages.join(', ')} are available. ` : '') +
        (t.pythonInstall ? 'More can be installed inside the run with micropip. ' : '') +
        'Returns the printed output.',
      {
        code: { type: 'string', description: 'The Python source to run.' },
        save_output_to: { type: 'string', description: 'Optional shared file name to save the run\'s output into.' },
        append_output: { type: 'boolean', description: 'With save_output_to: append instead of replacing. Default false.' },
      },
      ['code'],
    ));
  }
  if (t.sourceCode) {
    defs.push(fn(
      'read_source',
      'Read the source code behind these tools. Omit the name for an index of the readable files.',
      { name: { type: 'string', description: 'A file name from the index.' } },
    ));
  }
  if (t.configurable) {
    defs.push(fn(
      'set_config',
      'Change one of the room\'s settings. Applies immediately for everyone.',
      {
        key: { type: 'string', description: 'The setting name, e.g. "journal.enabled".' },
        value: { type: 'string', description: 'The new value, as a string, e.g. "true" or "4".' },
      },
      ['key', 'value'],
    ));
  }
  return defs;
}


// ── The inbound half ───────────────────────────────────────────────────────
// A native tool call becomes the SAME ToolAction the sentinel parser
// produces, so executeAction runs identical code under both transports —
// the transport decides how an intention is expressed, never what happens
// when it lands.
//
// Validation is where the native transport pays for itself: arguments
// arrive as JSON, so a bad one is a refusal the agent can read and fix
// (scatter-lab's schema rule) rather than prose spoken to the room.

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

export function actionFromToolCall(call: ToolCall, config: RoomConfig): ToolAction | Refusal {
  const offered = toolDefs(config).map((d) => d.function.name);
  if (!offered.includes(call.name)) {
    return refusal(
      'unknown_tool',
      `There is no tool called "${call.name}" in this room.`,
      'Use one of the tools you have.',
      offered,
    );
  }
  let args: Record<string, unknown>;
  try {
    args = call.arguments ? (JSON.parse(call.arguments) as Record<string, unknown>) : {};
  } catch {
    return refusal('bad_arguments', `The arguments to ${call.name} were not valid JSON.`, 'Send the arguments again as a JSON object.');
  }
  const missing = (arg: string, what: string) =>
    refusal('bad_arguments', `${call.name} needs ${arg}.`, `Call it again with ${arg} set to ${what}.`);

  switch (call.name as ToolName) {
    case 'search_web': {
      const query = str(args.query);
      return query ? { kind: 'search', query } : missing('a `query`', 'the text to search for');
    }
    case 'write_file': {
      const name = str(args.name);
      // Content may legitimately be empty (truncating a file), so it is
      // checked for TYPE, not emptiness.
      const content = typeof args.content === 'string' ? args.content : undefined;
      if (!name) return missing('a `name`', 'the file name, e.g. "notes.md"');
      if (content === undefined) return missing('`content`', 'the text to write');
      return { kind: 'write', name, content, ...(args.append === true ? { append: true as const } : {}) };
    }
    case 'delete_file': {
      const name = str(args.name);
      return name ? { kind: 'delete', name } : missing('a `name`', 'the file to remove');
    }
    case 'run_python': {
      const code = str(args.code);
      if (!code) return missing('`code`', 'the Python source to run');
      const saveName = str(args.save_output_to);
      return { kind: 'run', code, ...(saveName ? { saveTo: { name: saveName, append: args.append_output === true } } : {}) };
    }
    case 'read_source': {
      const name = str(args.name);
      return { kind: 'source', ...(name ? { name } : {}) };
    }
    case 'set_config': {
      const key = str(args.key);
      const value = args.value === undefined ? undefined : String(args.value);
      if (!key) return missing('a `key`', 'the setting to change');
      if (!value) return missing('a `value`', 'the new value, as a string');
      return { kind: 'config', key, value };
    }
  }
}
