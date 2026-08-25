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
    // Reasoning traces ride in payload (jsonb, no schema change). Public
    // read like journals: humans may see traces; agents never do — context
    // building renders `text` only (F1 privacy rule in types.ts).
    payload:
      e.kind === 'meta' || e.kind === 'end'
        ? e.payload
        : 'thinking' in e && e.thinking
          ? { thinking: e.thinking }
          : null,
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
