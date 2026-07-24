/**
 * GET /api/v1/leads/pool — the Sales Pool board (M1 §6 / contract §3): every
 * `[Pool]` lead with its contest counts, the M1-OA-7 stale flag (unclaimed >
 * 24h), and whether the caller already holds an open attempt on it. Returns
 * { data: PoolRow[] }, newest-first. The actor is resolved from the session for
 * the `my_open_attempt` marker; row scope stays the RLS/service-role concern.
 */
import { leads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { poolRowToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await leads.poolBoard(db(), actor.employeeId);
    return json({ data: rows.map(poolRowToWire) });
  });
}
