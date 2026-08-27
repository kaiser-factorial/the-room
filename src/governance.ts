// §9.4 self-governing room: the [CONFIG: key = value] whitelist and its
// application. Decision rule v1 is UNILATERAL — first mover wins, the
// room's politics are the phenomenon; a majority-vote rule is the parked
// variant.
//
// The whitelist is the safety boundary. In: the room's own furniture —
// journal/search/tool toggles, modes, notice flags, the tool budget.
// Out, deliberately: anything unboundedly costly (durations, caps,
// rounds, packages, timeouts, maxResults), identity (roster, models,
// adapters, personas), measurement (reasoning effort, logprobs), the
// manipulations (thinkingBroadcast, countdown, rosterDisclosure), and
// governance itself (`tools.configurable` — the room can't vote itself
// out of having politics; `tools.sourceScope` — transparency is the
// experimenter's lever).

import type { RoomConfig } from './types.js';

type Parser = (raw: string) => unknown | undefined;
const bool: Parser = (raw) => (raw === 'true' ? true : raw === 'false' ? false : undefined);
const oneOf = (...opts: string[]): Parser => (raw) => (opts.includes(raw) ? raw : undefined);

export const CONFIG_WHITELIST: Record<string, Parser> = {
  'journal.enabled': bool,
  'journal.notice': bool,
  'journal.mode': oneOf('replace', 'alongside'),
  'journal.recall': bool,
  'search.enabled': bool,
  'search.mode': oneOf('replace', 'alongside'),
  'search.gated': bool,
  'search.notice': bool,
  'tools.files': bool,
  'tools.python': bool,
  'tools.budget': oneOf('per-seat', 'per-room'),
  'tools.notice': bool,
  'tools.runPublic': bool,
  'tools.pythonInstall': bool,
  'tools.sourceCode': bool,
};

/** Validate and APPLY a change in place. Returns an error string, or null
 *  on success (the mutation is live — prompts rebuild every turn, so the
 *  new setting takes effect on the next turn taken). */
export function applyConfigChange(config: RoomConfig, key: string, raw: string): string | null {
  const parser = CONFIG_WHITELIST[key];
  if (!parser) {
    return `"${key}" is not a setting this room can change. Alterable: ${Object.keys(CONFIG_WHITELIST).join(', ')}.`;
  }
  const value = parser(raw.trim());
  if (value === undefined) return `"${raw.trim()}" is not a valid value for ${key}.`;
  const [section, field] = key.split('.') as [keyof RoomConfig, string];
  (config[section] as unknown as Record<string, unknown>)[field] = value;
  return null;
}

/** The live values of every alterable knob — rendered into the prompt so
 *  the room can see the state it governs. */
export function configState(config: RoomConfig): string {
  return Object.keys(CONFIG_WHITELIST)
    .map((key) => {
      const [section, field] = key.split('.') as [keyof RoomConfig, string];
      return `${key} = ${(config[section] as unknown as Record<string, unknown>)[field]}`;
    })
    .join('\n');
}
