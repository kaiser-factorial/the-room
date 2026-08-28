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

import { MAX_TURN_STEPS, refusal, type Refusal } from './agentic.js';
import type { RoomConfig } from './types.js';

type Parser = (raw: string) => unknown | undefined;
const bool: Parser = (raw) => (raw === 'true' ? true : raw === 'false' ? false : undefined);
const oneOf = (...opts: string[]): Parser => (raw) => (opts.includes(raw) ? raw : undefined);
/** Bounded integer — the only numeric knob shape the whitelist allows. An
 *  unbounded number is the thing this list exists to keep out; a capped one
 *  (how many actions a turn grants) is furniture like any other. */
const intRange = (lo: number, hi: number): Parser => (raw) => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : undefined;
};

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
  // F4¾: a room can vote itself an agentic loop (or take one away). Capped
  // at MAX_TURN_STEPS, so the worst case is bounded — every step is a model
  // call, and this is the only whitelisted knob that multiplies cost.
  'tools.turnSteps': intRange(1, MAX_TURN_STEPS),
  'tools.notice': bool,
  'tools.runPublic': bool,
  'tools.pythonInstall': bool,
  'tools.sourceCode': bool,
};

/** Validate and APPLY a change in place. Returns a Refusal (the machine-
 *  readable shape every tool answer uses — agentic.ts), or null on success:
 *  the mutation is live, and prompts rebuild every turn, so the new setting
 *  takes effect immediately. */
export function applyConfigChange(config: RoomConfig, key: string, raw: string): Refusal | null {
  const parser = CONFIG_WHITELIST[key];
  if (!parser) {
    return refusal(
      'bad_config_key',
      `"${key}" is not a setting this room can change.`,
      'Name one of the settings listed below, exactly as written.',
      Object.keys(CONFIG_WHITELIST),
    );
  }
  const value = parser(raw.trim());
  if (value === undefined) {
    return refusal(
      'bad_config_value',
      `"${raw.trim()}" is not a valid value for ${key}.`,
      key.endsWith('turnSteps')
        ? `Give a whole number from 1 to ${MAX_TURN_STEPS}.`
        : 'Give one of the values this setting accepts (the settings list shows its current one).',
    );
  }
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
