/**
 * GET /api/v1/renewals/{id} — one renewal/cross-sell request (R-03). Gated by
 * `renewal.canReadRenewal` inside `renewal.getRenewal`.
 */
import { renewal } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { renewalToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const r = await renewal.getRenewal(db(), actor, id);
    return json(renewalToWire(r));
  });
}
