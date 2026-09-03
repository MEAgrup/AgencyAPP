/**
 * SH-06 — which `Shopee Ads` campaigns a Shopee report would touch.
 *
 *  - GET /api/v1/clients/{id}/reports/shopee/campaigns?periode_mulai=&periode_akhir=
 *    — the active campaigns overlapping that period, i.e. exactly the set the
 *    report's combined ads spend/omzet is split across when it becomes Metric
 *    Entries. The upload form renders these as the "exclude" checkboxes.
 *
 * A read, not a dry run: it starts no report and writes nothing. Same thin-shell
 * contract as its POST sibling — resolve actor → call domain → map to wire.
 */
import { report } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { shopeeAdsCampaignOptionToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const url = new URL(request.url);
    const rows = await report.listShopeeAdsCampaignsForPeriod(
      db(), actor, id,
      url.searchParams.get('periode_mulai') ?? '',
      url.searchParams.get('periode_akhir') ?? '',
    );
    return json({ data: rows.map(shopeeAdsCampaignOptionToWire) });
  });
}
