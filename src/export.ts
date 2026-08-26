// Export hosted sessions from the Supabase mirror into local session dirs
// that analyze.ts reads — closing the loop for sessions whose JSONL lived
// on an ephemeral Space filesystem.
//
//   npm run export -- <sessionId> [<sessionId> …]
//   npm run export -- --all            # every session in the mirror
//
// Auth: SUPABASE_URL + SUPABASE_SERVICE_KEY if present, else the tables'
// public-read anon access via SUPABASE_ANON_KEY. Reconstruction caveats,
// stamped into each exported dir as EXPORTED.json:
//  - telemetry exists only for sessions run after 2026-08-26 (the sink
//    dropped it before then) — on older exports the §6.1 truncation
//    filters have nothing to filter on;
//  - journal .md headers are rebuilt from row timestamps (same format the
//    live writer uses).
// Sessions run before the config settled are PILOT data — export freely
// for pipeline validation, never as baseline (Corina, 2026-08-26).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import './env.js';
import type { RoomEvent } from './types.js';

const URL_ = process.env.SUPABASE_URL || 'https://wfrxfhpiuxofmfdjpuvv.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

interface EventRow {
  seq: number; round: number; kind: RoomEvent['kind']; ts: string;
  agent_id: string | null; agent_name: string | null; text: string | null;
  order_ids: string[] | null; payload: Record<string, unknown> | null;
}
interface JournalRow { round: number; ts: string; agent_id: string; text: string }

async function rest<T>(path: string): Promise<T> {
  if (!KEY) throw new Error('Set SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY.');
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

function toEvent(r: EventRow): RoomEvent {
  const base = { ts: r.ts, round: r.round };
  const extra = {
    ...(r.payload?.thinking ? { thinking: r.payload.thinking as string } : {}),
    ...(r.payload?.telemetry ? { telemetry: r.payload.telemetry } : {}),
  };
  switch (r.kind) {
    case 'message':
      return { kind: 'message', ...base, agentId: r.agent_id!, agentName: r.agent_name ?? r.agent_id!, text: r.text ?? '', ...extra } as RoomEvent;
    case 'journal':
      return { kind: 'journal', ...base, agentId: r.agent_id!, agentName: r.agent_name ?? r.agent_id!, ...extra } as RoomEvent;
    case 'system':
      return { kind: 'system', ...base, text: r.text ?? '', ...(r.agent_id ? { agentId: r.agent_id } : {}), ...extra } as RoomEvent;
    case 'order':
      return { kind: 'order', ...base, order: r.order_ids ?? [] };
    case 'summary':
      return { kind: 'summary', ...base, text: r.text ?? '' };
    case 'meta':
      return { kind: 'meta', ...base, payload: r.payload as never };
    case 'end':
      return { kind: 'end', ...base, payload: (r.payload ?? { adminTouched: false }) as never };
  }
}

export async function exportSession(sessionId: string): Promise<string> {
  const enc = encodeURIComponent(sessionId);
  const rows = await rest<EventRow[]>(`room_events?session_id=eq.${enc}&order=seq.asc&limit=100000`);
  if (!rows.length) throw new Error(`no events for session ${sessionId}`);
  const journals = await rest<JournalRow[]>(`room_journals?session_id=eq.${enc}&order=id.asc&limit=10000`);

  const dir = join(import.meta.dirname, '..', 'sessions', sessionId);
  mkdirSync(join(dir, 'journals'), { recursive: true });
  writeFileSync(join(dir, 'transcript.jsonl'), rows.map((r) => JSON.stringify(toEvent(r))).join('\n') + '\n');

  const byAgent = new Map<string, JournalRow[]>();
  for (const j of journals) (byAgent.get(j.agent_id) ?? byAgent.set(j.agent_id, []).get(j.agent_id)!).push(j);
  for (const [agentId, js] of byAgent) {
    writeFileSync(
      join(dir, 'journals', `${agentId}.md`),
      js.map((j) => `\n## Round ${j.round} — ${new Date(j.ts).toISOString()}\n\n${j.text}\n`).join(''),
    );
  }
  const hasTelemetry = rows.some((r) => r.payload?.telemetry);
  writeFileSync(join(dir, 'EXPORTED.json'), JSON.stringify({
    exportedAt: new Date().toISOString(),
    source: 'supabase-mirror',
    events: rows.length,
    journalEntries: journals.length,
    telemetryPresent: hasTelemetry,
    note: hasTelemetry ? null : 'pre-2026-08-26 session: mirror carried no telemetry — truncation filters inert',
  }, null, 2));
  return dir;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const args = process.argv.slice(2).filter(Boolean);
  if (!args.length) {
    console.error('usage: npm run export -- <sessionId> […] | --all');
    process.exit(1);
  }
  const ids = args[0] === '--all'
    ? (await rest<{ session_id: string }[]>('room_sessions?select=session_id&order=latest_id.desc')).map((r) => r.session_id)
    : args;
  for (const id of ids) {
    const dir = join(import.meta.dirname, '..', 'sessions', id);
    if (existsSync(join(dir, 'transcript.jsonl')) && !existsSync(join(dir, 'EXPORTED.json'))) {
      console.log(`skip ${id} — local original exists (never overwrite source of truth)`);
      continue;
    }
    console.log(`export ${id} → ${await exportSession(id)}`);
  }
}
