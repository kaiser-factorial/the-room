// Shared test scaffolding: minimal RoomConfigs, programmatic stub sessions,
// and synthetic session dirs for analyze.ts.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config as baseConfig } from '../src/config.js';
import { runSession } from '../src/session.js';
import { resetStub } from '../src/openrouter.js';
import type { RoomConfig, RoomEvent } from '../src/types.js';

export const AGENTS = [
  { id: 'alpha', name: 'Alpha', model: 'test/alpha-voice-0', adapter: 'openrouter' as const, color: '#111111' },
  { id: 'beta', name: 'Beta', model: 'test/beta-voice', adapter: 'openrouter' as const, color: '#222222' },
  { id: 'gamma', name: 'Gamma', model: 'test/gamma-voice', adapter: 'openrouter' as const, color: '#333333' },
];

export function testConfig(overrides: Partial<RoomConfig> = {}): RoomConfig {
  return {
    ...baseConfig,
    conditionName: 'test',
    agents: AGENTS,
    shuffle: { kind: 'fixed-random' },
    durationMinutes: 5,
    maxRounds: 3,
    interTurnDelaySeconds: 0,
    contextPolicy: 'full',
    journal: { enabled: false, notice: true, mode: 'replace', recall: true, maxTokens: 0 },
    ...overrides,
  };
}

/** Run a stub session and return its dir. Serializes on the wall clock —
 *  session ids have second resolution, so back-to-back runs must not share
 *  a second. */
export async function runStubSession(config: RoomConfig, script?: string): Promise<string> {
  process.env.ROOM_STUB = '1';
  process.env.ROOM_QUIET = '1';
  if (script !== undefined) process.env.ROOM_STUB_SCRIPT = script;
  else delete process.env.ROOM_STUB_SCRIPT;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  resetStub();
  const id = await runSession(config);
  delete process.env.ROOM_STUB_SCRIPT;
  await new Promise((r) => setTimeout(r, 1100));
  return join(import.meta.dirname, '..', 'sessions', id);
}

/** Write a synthetic session dir (transcript + journals) for analyze tests. */
export function syntheticSession(opts: {
  events: RoomEvent[];
  journals?: Record<string, string>; // agentId -> raw .md content
}): string {
  const dir = mkdtempSync(join(tmpdir(), 'room-test-'));
  const meta: RoomEvent = {
    kind: 'meta', ts: '2026-01-01T00:00:00.000Z', round: 0,
    payload: {
      endsAt: '2026-01-01T01:00:00.000Z', durationMinutes: 60, shuffle: { kind: 'fixed-random' },
      agents: AGENTS.map((a) => ({ id: a.id, name: a.name, color: a.color })),
      condition: { name: 'synthetic' },
    },
  };
  writeFileSync(join(dir, 'transcript.jsonl'), [meta, ...opts.events].map((e) => JSON.stringify(e)).join('\n') + '\n');
  mkdirSync(join(dir, 'journals'), { recursive: true });
  for (const [agentId, md] of Object.entries(opts.journals ?? {})) {
    writeFileSync(join(dir, 'journals', `${agentId}.md`), md);
  }
  return dir;
}

let seq = 0;
export function msg(round: number, agentId: string, text: string, extra: { truncated?: boolean; thinking?: string } = {}): RoomEvent {
  const name = AGENTS.find((a) => a.id === agentId)?.name ?? agentId;
  return {
    kind: 'message', round, agentId, agentName: name, text,
    ts: new Date(Date.UTC(2026, 0, 1, 0, 0, seq++)).toISOString(),
    telemetry: { provider: 'test', finishReason: extra.truncated ? 'length' : 'stop', attempts: 1 },
    thinking: extra.thinking,
  };
}
