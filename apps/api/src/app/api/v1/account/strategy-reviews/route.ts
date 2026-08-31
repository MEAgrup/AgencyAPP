/**
 * GET /api/v1/account/strategy-reviews — every Strategy & Plan
 * `canApproveStrategy` may still act on: [Strategy Submitted for Approval] or
 * a pending GMV adjustment, oldest first (M6 §4 Rule 4). The "Perlu
 * Persetujuan Saya" queue for Account lead / Director;
 * `account.pendingStrategyReviews` gates explicitly and returns empty for
 * anyone else, RLS scoping aside.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { pendingStrategyReviewToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await readAsActor(actor, (sql) => account.pendingStrategyReviews(sql, actor));
    return json({ data: rows.map(pendingStrategyReviewToWire) });
  });
}
