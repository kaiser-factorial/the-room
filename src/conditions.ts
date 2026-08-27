// Condition presets: JSON files in conditions/ that override the base
// (control) config. Resolution is shallow-merge per top-level field, with
// two structured cases: `journal` merges key-by-key, and `agents` may be
// given as either a list of catalog ids (seat selection) or a list of
// {id, personaId} objects (persona matrix). The fully-resolved condition is
// stamped into the session meta so analysis never guesses.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config as baseConfig } from './config.js';
import { personaText } from './personas.js';
import type { RoomConfig } from './types.js';

const CONDITIONS_DIR = join(import.meta.dirname, '..', 'conditions');

export interface ConditionSpec {
  description?: string;
  /** Seats: catalog ids, or objects for the persona matrix and the identity
   *  axis. `name` overrides what the ROOM calls this seat while the model
   *  behind it is unchanged — the identity-swap conditions. */
  agents?: (string | { id: string; personaId?: string; name?: string })[];
  welcomeMessage?: string;
  shuffle?: RoomConfig['shuffle'];
  sampling?: Partial<RoomConfig['sampling']>;
  countdown?: RoomConfig['countdown'];
  journal?: Partial<RoomConfig['journal']> & { pass?: RoomConfig['journal']['pass'] };
  search?: Partial<RoomConfig['search']>;
  tools?: Partial<RoomConfig['tools']>;
  rosterDisclosure?: RoomConfig['rosterDisclosure'];
  selfDisclosure?: RoomConfig['selfDisclosure'];
  transcriptMode?: RoomConfig['transcriptMode'];
  thinkingBroadcast?: RoomConfig['thinkingBroadcast'];
  reasoningEffort?: RoomConfig['reasoningEffort'];
  captureLogprobs?: boolean;
  contextPolicy?: RoomConfig['contextPolicy'];
  contextWindowTokens?: number;
  durationMinutes?: number;
  maxRounds?: number;
  maxOutputTokens?: number;
  interTurnDelaySeconds?: number;
}

export function listConditions(): string[] {
  try {
    return readdirSync(CONDITIONS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
  } catch {
    return [];
  }
}

/** Resolve a named condition (+ ad-hoc overrides, e.g. from the admin start
 *  payload) into a runnable RoomConfig. Name 'control' or absent = base. */
export function resolveCondition(name?: string, overrides?: ConditionSpec): RoomConfig {
  let spec: ConditionSpec = {};
  const conditionName = name || 'control';
  if (conditionName !== 'control') {
    const raw = readFileSync(join(CONDITIONS_DIR, `${conditionName}.json`), 'utf8');
    spec = JSON.parse(raw) as ConditionSpec;
  }
  const merged: ConditionSpec = {
    ...spec,
    ...overrides,
    journal: { ...spec.journal, ...overrides?.journal },
    search: { ...spec.search, ...overrides?.search },
    tools: { ...spec.tools, ...overrides?.tools },
  };

  const cfg: RoomConfig = {
    ...baseConfig,
    conditionName,
    shuffle: merged.shuffle ?? baseConfig.shuffle,
    sampling: { ...baseConfig.sampling, ...merged.sampling },
    countdown: merged.countdown ?? baseConfig.countdown,
    journal: { ...baseConfig.journal, ...merged.journal, pass: { ...baseConfig.journal.pass, ...merged.journal?.pass } },
    search: { ...baseConfig.search, ...merged.search },
    tools: { ...baseConfig.tools, ...merged.tools },
    rosterDisclosure: merged.rosterDisclosure ?? baseConfig.rosterDisclosure,
    selfDisclosure: merged.selfDisclosure ?? baseConfig.selfDisclosure,
    transcriptMode: merged.transcriptMode ?? baseConfig.transcriptMode,
    thinkingBroadcast: merged.thinkingBroadcast ?? baseConfig.thinkingBroadcast,
    reasoningEffort: merged.reasoningEffort ?? baseConfig.reasoningEffort,
    captureLogprobs: merged.captureLogprobs ?? baseConfig.captureLogprobs,
    contextPolicy: merged.contextPolicy ?? baseConfig.contextPolicy,
    contextWindowTokens: merged.contextWindowTokens ?? baseConfig.contextWindowTokens,
    welcomeMessage: merged.welcomeMessage ?? baseConfig.welcomeMessage,
    durationMinutes: merged.durationMinutes ?? baseConfig.durationMinutes,
    maxRounds: merged.maxRounds ?? baseConfig.maxRounds,
    maxOutputTokens: merged.maxOutputTokens ?? baseConfig.maxOutputTokens,
    interTurnDelaySeconds: merged.interTurnDelaySeconds ?? baseConfig.interTurnDelaySeconds,
  };

  if (merged.agents?.length) {
    const seats = merged.agents.map((s) => (typeof s === 'string' ? { id: s } : s));
    const agents = seats.flatMap((seat) => {
      const cat = baseConfig.agents.find((a) => a.id === seat.id);
      if (!cat) {
        console.error(`condition ${conditionName}: unknown agent id '${seat.id}' — skipped`);
        return [];
      }
      // `name` moves; `model`, `adapter` and `color` do not. The seat id and
      // the model stay bound, so conditionRecord still stamps which model
      // actually sat where — and the viewer's colours keep tracking the real
      // models, which is how a human reads a swapped room while the room
      // itself only has the names (Corina 2026-08-27).
      return [{ ...cat, personaId: seat.personaId, ...(seat.name ? { name: seat.name } : {}) }];
    });
    if (agents.length < 2) throw new Error(`condition ${conditionName}: needs ≥2 valid agents`);
    cfg.agents = agents;
  }

  // Fail loudly on a persona id that isn't in the library.
  for (const a of cfg.agents) {
    if (a.personaId && a.personaId !== 'base' && !personaText(a.personaId)) {
      throw new Error(`condition ${conditionName}: unknown personaId '${a.personaId}' for seat '${a.id}'`);
    }
  }

  return cfg;
}

/** The record stamped into session meta — everything analysis needs. */
export function conditionRecord(cfg: RoomConfig): Record<string, unknown> {
  return {
    name: cfg.conditionName,
    agents: cfg.agents.map((a) => ({
      id: a.id,
      model: a.model,
      adapter: a.adapter,
      personaId: a.personaId ?? 'base',
      personaText: personaText(a.personaId),
      providerOrder: a.providerOrder ?? null,
    })),
    welcomeMessage: cfg.welcomeMessage,
    shuffle: cfg.shuffle,
    sampling: cfg.sampling,
    countdown: cfg.countdown,
    journal: cfg.journal,
    search: cfg.search,
    tools: cfg.tools,
    rosterDisclosure: cfg.rosterDisclosure,
    selfDisclosure: cfg.selfDisclosure,
    transcriptMode: cfg.transcriptMode,
    thinkingBroadcast: cfg.thinkingBroadcast,
    reasoningEffort: cfg.reasoningEffort,
    captureLogprobs: cfg.captureLogprobs,
    contextPolicy: cfg.contextPolicy,
    contextWindowTokens: cfg.contextWindowTokens,
    durationMinutes: cfg.durationMinutes,
    maxRounds: cfg.maxRounds,
    maxOutputTokens: cfg.maxOutputTokens,
    interTurnDelaySeconds: cfg.interTurnDelaySeconds,
  };
}
