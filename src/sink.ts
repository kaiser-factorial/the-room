// Optional live sink: mirrors every room event to Supabase so a viewer page
// can watch over realtime. Enabled when SUPABASE_URL + SUPABASE_SERVICE_KEY
// are set; otherwise a no-op. JSONL stays the source of truth — inserts are
// fire-and-forget and a Supabase outage never stalls the session.
//
// Journal *entries* never pass through here by design: journal events carry
// only the agent's name (the entry text stays local in journals/<agent>.md).

import type { RoomEvent } from './types.js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

export const liveSinkEnabled = Boolean(url && key);

export function serviceHeaders(): Record<string, string> {
  return {
    apikey: key!,
    Authorization: `Bearer ${key!}`,
    'Content-Type': 'application/json',
  };
}

export const supabaseUrl = url;

let seq = 0;

function sinkPayload(e: RoomEvent): unknown {
  if (e.kind === 'meta' || e.kind === 'end') return e.payload;
  const p: Record<string, unknown> = {};
  if ('thinking' in e && e.thinking) p.thinking = e.thinking;
  if ('telemetry' in e && e.telemetry) p.telemetry = e.telemetry;
  // F4¾: which action of the turn this was (absent in single-step rooms).
  if ('step' in e && e.step) p.step = e.step;
  // F4 search: query/results ride in payload — same public-read class as
  // traces (humans see them in the viewer; agents never do, context.ts
  // renders only the notice line).
  if (e.kind === 'search') {
    p.query = e.query;
    if (e.results) p.results = e.results;
    if (e.denied) p.denied = true;
    p.notice = e.notice;
  }
  // F4½ tools: same public-read class as traces — humans see everything in
  // the viewer; agents see only what context.ts renders (file contents via
  // the shared-files block, run code/output never).
  if (e.kind === 'file') {
    p.name = e.name;
    p.content = e.content;
    if (e.encoding) p.encoding = e.encoding;
    if (e.denied) p.denied = true;
    p.notice = e.notice;
  }
  if (e.kind === 'config') {
    p.key = e.key;
    p.value = e.value;
    if (e.denied) p.denied = true;
  }
  if (e.kind === 'source') {
    if (e.name) p.name = e.name;
    p.notice = e.notice;
  }
  if (e.kind === 'run') {
    p.code = e.code;
    if (e.output) p.output = e.output;
    if (e.public) p.public = true;
    if (e.denied) p.denied = true;
    p.notice = e.notice;
  }
  return Object.keys(p).length ? p : null;
}

export function sinkEvent(sessionId: string, e: RoomEvent): void {
  if (!url || !key) return;
  const row = {
    session_id: sessionId,
    seq: seq++,
    round: e.round,
    kind: e.kind,
    ts: e.ts,
    agent_id: 'agentId' in e ? e.agentId : null,
    agent_name: 'agentName' in e ? e.agentName : null,
    text: 'text' in e ? e.text : null,
    order_ids: e.kind === 'order' ? e.order : null,
    // Traces AND telemetry ride in payload (jsonb, no schema change).
    // Telemetry added 2026-08-26: the mirror silently dropped provider /
    // finish_reason / usage / logprobs, which starved every §6.1 filter
    // (truncation exclusion!) on sessions exported from Supabase. Public
    // read like journals: humans may see all of it; agents never do —
    // context building renders `text` only (F1 privacy rule in types.ts).
    payload: sinkPayload(e),
  };
  post('room_events', row);
}

/** Journals go to their own table — never into room_events, which is what the
 *  agents' shared context is built from. The site shows them; the room doesn't. */
export function sinkJournal(sessionId: string, round: number, agentId: string, agentName: string, text: string): void {
  if (!url || !key) return;
  post('room_journals', { session_id: sessionId, round, ts: new Date().toISOString(), agent_id: agentId, agent_name: agentName, text });
}

function post(table: string, row: unknown): void {
  fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...serviceHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  })
    .then((res) => {
      if (!res.ok) res.text().then((t) => console.error(`sink: ${res.status} ${t.slice(0, 120)}`));
    })
    .catch((err) => console.error('sink:', (err as Error).message));
}
