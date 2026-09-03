/**
 * TikTok Ads Scanner — one client's scan history (Gelombang 4).
 *
 *  - GET /api/v1/clients/{id}/adsscanner/runs — the client's scans, newest
 *    first. Row scope is the domain's job (`listAdsScanRuns` mirrors the
 *    migration's RLS predicate): an Ads staffer sees their own scans, the Ads
 *    lead and the client's PICs see all of that client's.
 */
import { adsscanner } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { adsScanRunSummaryToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const rows = await adsscanner.listAdsScanRuns(db(), actor, id);
    return json({ data: rows.map(adsScanRunSummaryToWire) });
  });
}
