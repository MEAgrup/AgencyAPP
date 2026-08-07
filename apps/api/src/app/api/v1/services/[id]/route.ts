/**
 * GET /api/v1/services/{id} — one Service: status, client, the EFFECTIVE
 * `requires_strategy_plan` gate (override ∨ MSL pin, M6-OA-1) and the Strategy &
 * Plan behind it, if any.
 *
 * The Service hub page used to infer the execution path from "does a Strategy row
 * exist", which reads a plan-gated Service that nobody has drafted yet as Direct
 * — so it offered a Brief form the server always rejected. This route gives the
 * page the flag itself.
 *
 * Read gate (in the domain): owning AM / Account lead / OD / Director.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { serviceQueueRowToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const row = await readAsActor(actor, (sql) => account.getService(sql, actor, id));
    return json(serviceQueueRowToWire(row));
  });
}
