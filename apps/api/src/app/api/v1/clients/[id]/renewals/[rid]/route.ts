/**
 * GET /api/v1/clients/{id}/renewals/{rid} — one renewal/cross-sell request
 * with its newest proposal version's priced lines (R-04 review/decide/execute
 * screens). `{id}` is carried in the path for REST symmetry with the other
 * `/clients/{id}/...` routes; the read itself is scoped by `{rid}` alone.
 */
import { renewal } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { renewalDetailToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string; rid: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { rid } = await ctx.params;
    const detail = await renewal.getRenewalDetail(db(), actor, rid);
    return json(renewalDetailToWire(detail));
  });
}
