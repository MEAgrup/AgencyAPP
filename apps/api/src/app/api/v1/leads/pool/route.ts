/**
 * GET /api/v1/leads/pool — the Sales Pool board (M1 §6 / contract §3): every
 * `[Pool]` lead with its contest counts, the M1-OA-7 stale flag (unclaimed >
 * 24h), and whether the caller already holds an open attempt on it. Returns
 * { data: PoolRow[] }, newest-first. The actor is resolved from the session for
 * the `my_open_attempt` marker.
 *
 * Access (O37): the board belongs to Sales — `canReadPool` (ported from Go
 * `reads.go`) denies everyone else with the verbatim BI message rather than
 * returning an empty board, and rows are additionally filtered by RLS because
 * the query runs through `readAsActor`.
 */
import { leads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { poolRowToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    if (!leads.canReadPool(actor)) {
      throw new leads.ForbiddenError();
    }
    const rows = await readAsActor(actor, (sql) => leads.poolBoard(sql, actor.employeeId));
    return json({ data: rows.map(poolRowToWire) });
  });
}
