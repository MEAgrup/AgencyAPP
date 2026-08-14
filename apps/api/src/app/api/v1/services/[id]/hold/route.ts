/**
 * POST /api/v1/services/{id}/hold — T-2 / RM-2: put a Service [In Execution] →
 * [On Hold]. Head of Account (Account Lead) or Director only, reason mandatory.
 * No cascade to child Briefs/Assets/Campaigns. A Client whose services are all
 * On Hold stops getting weekly recaps opened (D-06).
 * Incomplete → 400, Forbidden → 403, NotFound → 404, wrong state → 409.
 */
import { client } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ reason?: string }>(request);
    await client.holdService(db(), actor, id, b.reason ?? '');
    return json({ ok: true });
  });
}
