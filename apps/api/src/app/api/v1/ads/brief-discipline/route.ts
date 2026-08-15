/**
 * GET /api/v1/ads/brief-discipline — the discipline summary for every Ads
 * Brief-as-task the actor may see: which lack a metric target ("brief tanpa
 * target") and which are behind on their weekly report ("laporan telat"). Feeds
 * the two nudge lists on the /ads workspace (keputusan pemilik 2026-08-14).
 *
 * Runs on the service-role connection: visibility is enforced set-wise inside
 * `ads.adsBriefDiscipline` (predicate mirrors canViewCampaign), and the audit-log
 * start anchor is read in full — the same pattern the other M8 reads use.
 */
import { ads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { adsBriefDisciplineToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await ads.adsBriefDiscipline(db(), actor);
    return json({ data: rows.map(adsBriefDisciplineToWire) });
  });
}
