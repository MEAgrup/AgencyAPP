/** POST /api/v1/bookings/{id}/attributed-gmv — record Attributed GMV (M9-OA-4). */
import { kol } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ attributed_gmv?: string }>(request);
    const r = await kol.recordAttributedGmv(db(), actor, id, b.attributed_gmv ?? '');
    return json({ id, attributed_gmv: r.value, attributed_gmv_display: r.display });
  });
}
