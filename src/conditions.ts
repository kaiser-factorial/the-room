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
  agents?: (string | { id: string; personaId?: string })[];
  welcomeMessage?: string;
  shuffle?: RoomConfig['shuffle'];
  sampling?: Partial<RoomConfig['sampling']>;
  countdown?: RoomConfig['countdown'];
  journal?: Partial<RoomConfig['journal']> & { pass?: RoomConfig['journal']['pass'] };
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
  const merged: ConditionSpec = { ...spec, ...overrides, journal: { ...spec.journal, ...overrides?.journal } };

  const cfg: RoomConfig = {
    ...baseConfig,
    conditionName,
    shuffle: merged.shuffle ?? baseConfig.shuffle,
    sampling: { ...baseConfig.sampling, ...merged.sampling },
    countdown: merged.countdown ?? baseConfig.countdown,
    journal: { ...baseConfig.journal, ...merged.journal, pass: { ...baseConfig.journal.pass, ...merged.journal?.pass } },
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
      return [{ ...cat, personaId: seat.personaId }];
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
      personaId: a.personaId ?? 'base',
      personaText: personaText(a.personaId),
    })),
    welcomeMessage: cfg.welcomeMessage,
    shuffle: cfg.shuffle,
    sampling: cfg.sampling,
    countdown: cfg.countdown,
    journal: cfg.journal,
    contextPolicy: cfg.contextPolicy,
    contextWindowTokens: cfg.contextWindowTokens,
    durationMinutes: cfg.durationMinutes,
    maxRounds: cfg.maxRounds,
    maxOutputTokens: cfg.maxOutputTokens,
    interTurnDelaySeconds: cfg.interTurnDelaySeconds,
  };
}
