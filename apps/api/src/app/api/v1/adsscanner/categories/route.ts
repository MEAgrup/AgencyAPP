/**
 * GET /api/v1/adsscanner/categories — the TikTok Shop Level-3 categories the
 * scan form may offer.
 *
 * Served from the ACTIVE `adsscanner_benchmark` row, not from the compiled-in
 * `ALL_ADSSCANNER_CATEGORIES` constant: the two agree today (34 categories at
 * v1) but a recalibrated v2 could add or rename one, and a picker offering a
 * category the active benchmark does not carry would offer exactly the value
 * `runAdsScan` rejects.
 *
 * No client in the path and no per-client scope — a benchmark category list is
 * reference data, so this only requires a logged-in actor.
 */
import { adsscanner } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    requireActor(request);
    const data = await adsscanner.adsScanCategories(db());
    return json({ data });
  });
}
