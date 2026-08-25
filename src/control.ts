// Control plane: admin commands land in room_control (via the room-admin edge
// function) and the runner/session poll them with the service key. Commands
// are marked consumed BEFORE execution so a crash-restart never re-runs them.

import { liveSinkEnabled, serviceHeaders, supabaseUrl } from './sink.js';

export interface StartPayload {
  /** Named preset from conditions/ ('house' when absent). */
  condition?: string;
  minutes?: number;
  agentIds?: string[];
  shuffle?: { kind: 'every-round' | 'periodic' | 'fixed-random'; minRounds?: number; maxRounds?: number };
  delaySeconds?: number;
  /** Batch mode (BUILD_PLAN item 12): run count × conditions sessions,
   *  INTERLEAVED across conditions (§6.1 — never sequential blocks).
   *  conditions defaults to [condition]; name defaults to a timestamp. */
  batch?: { count?: number; conditions?: string[]; name?: string };
}

export interface Command {
  id: number;
  kind: 'start' | 'stop' | 'say';
  payload: (StartPayload & { text?: string }) | null;
}

export const controlEnabled = liveSinkEnabled;

export async function takeCommands(kinds: Command['kind'][]): Promise<Command[]> {
  if (!controlEnabled) return [];
  try {
    const q = `${supabaseUrl}/rest/v1/room_control?consumed=eq.false&kind=in.(${kinds.join(',')})&order=id.asc`;
    const res = await fetch(q, { headers: serviceHeaders() });
    if (!res.ok) return [];
    const rows = (await res.json()) as Command[];
    if (rows.length) {
      await fetch(`${supabaseUrl}/rest/v1/room_control?id=in.(${rows.map((r) => r.id).join(',')})`, {
        method: 'PATCH',
        headers: { ...serviceHeaders(), Prefer: 'return=minimal' },
        body: JSON.stringify({ consumed: true }),
      });
    }
    return rows;
  } catch (err) {
    console.error('control:', (err as Error).message);
    return [];
  }
}
