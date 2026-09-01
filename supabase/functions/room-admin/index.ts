// The admin control plane, in front of `room_control`.
//
// Kept in the repo as of 2026-09-01 — it was previously deployed only to
// Supabase, so the source of the one component that can start a room lived
// nowhere a future session could read it.
//
// Actions: login · command (start|stop|say) · status.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  let body: { action?: string; password?: string; kind?: string; payload?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad json' });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: row, error: adminErr } = await admin
    .from('room_admin').select('password_hash').eq('id', 1).single();
  if (adminErr || !row) return json(500, { error: 'admin record missing' });

  const hash = await sha256Hex(body.password ?? '');
  if (hash !== row.password_hash) {
    // small constant-ish delay to blunt brute force
    await new Promise((r) => setTimeout(r, 600));
    return json(401, { error: 'wrong password' });
  }

  if (body.action === 'login') return json(200, { ok: true });

  if (body.action === 'command') {
    const kind = body.kind;
    if (kind !== 'start' && kind !== 'stop' && kind !== 'say') {
      return json(400, { error: 'unknown command kind' });
    }
    // `select()` so the caller learns WHICH row this was: the panel then
    // watches that id to find out whether the runner ever took it.
    const { data, error } = await admin
      .from('room_control').insert({ kind, payload: body.payload ?? null })
      .select('id').single();
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, id: data?.id ?? null });
  }

  // Is anything actually listening?
  //
  // The runner marks a command consumed BEFORE executing it, and drains the
  // queue on boot — so an unconsumed command more than a few seconds old
  // means no runner is polling at all. That is the state the panel could not
  // see on 2026-09-01, when four start commands sat unconsumed for half an
  // hour because the Space had gone to sleep and nothing said so.
  //
  // `id` (optional) asks about one specific command: consumed yet, or not.
  if (body.action === 'status') {
    const wanted = typeof body.payload === 'object' && body.payload !== null
      ? (body.payload as { id?: number }).id : undefined;
    const [pending, recent, one] = await Promise.all([
      admin.from('room_control').select('id,kind,created_at')
        .eq('consumed', false).order('id', { ascending: true }).limit(50),
      admin.from('room_control').select('id,kind,created_at')
        .eq('consumed', true).order('id', { ascending: false }).limit(1),
      wanted != null
        ? admin.from('room_control').select('id,consumed').eq('id', wanted).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (pending.error) return json(500, { error: pending.error.message });
    const rows = pending.data ?? [];
    const oldest = rows[0]?.created_at ? Date.parse(rows[0].created_at) : null;
    return json(200, {
      ok: true,
      pending: rows.length,
      pendingKinds: rows.map((r) => r.kind),
      oldestPendingAgeSec: oldest ? Math.round((Date.now() - oldest) / 1000) : null,
      lastTakenId: recent.data?.[0]?.id ?? null,
      commandConsumed: one.data ? !!(one.data as { consumed: boolean }).consumed : null,
    });
  }

  return json(400, { error: 'unknown action' });
});
