/**
 * POST /api/v1/strategi/{id}/expire — `Aktif` → `Kedaluwarsa` at contract end
 * (Rule 14).
 *
 * Exposed as an endpoint rather than only a scheduled job because the job that
 * would drive it belongs with M6B's WIB scheduler (backlog B-09); until that
 * lands, an AM or SPV closes it explicitly instead of the record silently
 * outliving its contract.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { strategiToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return json(strategiToWire(await strategi.expireStrategi(db(), actor, id)));
  });
}
