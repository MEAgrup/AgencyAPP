/**
 * GET /api/v1/transactions/{id}/bermasalah — returns the current [Bermasalah]
 * flag + all votes (M5-OA-5). FE: finance.getBermasalah(id) → BermasalahStatus.
 *
 * POST /api/v1/transactions/{id}/bermasalah — M5 §5 Rule 5: Admin & Finance
 * raises the [Bermasalah] dispute flag on a Transaction (a verified payment was
 * disputed/reversed). Opens the joint-resolution cycle (M5-OA-5). Does not change
 * Payment Status. Ports Go's handleFlagBermasalah. Forbidden → 403, NotFound →
 * 404, Incomplete (missing reason) → 400.
 *
 * Body: { reason: string } (FE sends `reason`).
 * Response: { status: string }.
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { bermasalahStatusToWire } from '@/lib/wire';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const status = await finance.getBermasalahStatus(db(), id);
    return json(bermasalahStatusToWire(status));
  });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ reason?: string; note?: string }>(request);
    await finance.flagBermasalah(db(), actor, id, b.reason ?? b.note ?? '');
    return json({ status: 'ok' });
  });
}
