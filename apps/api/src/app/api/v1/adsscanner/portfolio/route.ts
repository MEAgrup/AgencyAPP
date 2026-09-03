/**
 * GET /api/v1/adsscanner/portfolio — the cross-client portfolio: each client's
 * LATEST scan with its account-level verdict and rollups.
 *
 * This is the read pattern that justified `adsscanner_run` being a table of
 * its own (O69) rather than rows in `client_reports`: one advertiser holds many
 * shops, and the Monday question is "which of my clients needs attention this
 * week", not "show me one client's history". Row scope lives in the domain's
 * SQL, mirroring the migration's RLS predicate.
 */
import { adsscanner } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { adsScanPortfolioRowToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await adsscanner.adsScanPortfolio(db(), actor);
    return json({ data: rows.map(adsScanPortfolioRowToWire) });
  });
}
