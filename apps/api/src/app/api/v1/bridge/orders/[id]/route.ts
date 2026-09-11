/**
 * GET /api/v1/bridge/orders/{id} — order detail (immutable payload rendered)
 * plus dedup candidates for the accept screen. RLS-scoped read like the list
 * route; `candidates` is a separate, un-gated helper query (it only ever
 * surfaces existing `clients` rows a human then chooses from — never picks).
 */
import { bridge } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { bridgeCandidateToWire, bridgeOrderDetailToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const [detail, cands] = await readAsActor(actor, async (sql) => [
      await bridge.getOrder(sql, id),
      await bridge.candidates(sql, id),
    ]);
    return json({
      order: bridgeOrderDetailToWire(detail),
      candidates: cands.map(bridgeCandidateToWire),
    });
  });
}
