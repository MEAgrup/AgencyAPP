/**
 * POST /api/v1/transactions/{id}/bermasalah — M5 §5 Rule 5: Admin & Finance
 * raises the [Bermasalah] dispute flag on a Transaction (a verified payment was
 * disputed/reversed). Opens the joint-resolution cycle (M5-OA-5). Does not change
 * Payment Status. Ports Go's handleFlagBermasalah. Forbidden → 403, NotFound →
 * 404, Incomplete (missing reason) → 400.
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ note?: string }>(request);
    await finance.flagBermasalah(db(), actor, id, b.note ?? '');
    return json({ ok: true });
  });
}
