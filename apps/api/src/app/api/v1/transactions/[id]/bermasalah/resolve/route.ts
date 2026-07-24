/**
 * POST /api/v1/transactions/{id}/bermasalah/resolve — M5-OA-5: SPV Finance / SPV
 * Account / Director casts a vote on the current [Bermasalah] cycle. The flag
 * clears when both SPV divisions approve, or a Director approves (final
 * authority). Ports Go's handleResolveBermasalah. Forbidden → 403, NotFound →
 * 404, Incomplete (bad/absent decision, or not flagged) → 400.
 */
/**
 * POST /api/v1/transactions/{id}/bermasalah/resolve — cast a vote on the current
 * [Bermasalah] cycle (M5-OA-5). After the vote, returns the full BermasalahStatus
 * so the FE can update its view immediately.
 * FE: finance.voteBermasalah(id, decision, note) → BermasalahStatus.
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { bermasalahStatusToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ decision?: string; note?: string }>(request);
    await finance.resolveBermasalah(db(), actor, id, b.decision ?? '', b.note ?? '');
    const status = await finance.getBermasalahStatus(db(), id);
    return json(bermasalahStatusToWire(status));
  });
}
