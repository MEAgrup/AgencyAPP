/**
 * PATCH /api/v1/campaigns/{id}/additional-days — set the Ads Management Date's
 * manual extra-days input (M16 LT-42, e.g. libur Lebaran). Ads staff/lead or
 * Director. `end_date` itself is never written here — it is always recomputed
 * from GET .../management-date.
 */
import { ads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ additional_days?: number }>(request);
    await ads.setAdditionalDays(db(), actor, id, Number(b.additional_days ?? NaN));
    return json({ ok: true });
  });
}
