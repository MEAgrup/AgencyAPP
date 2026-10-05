/**
 * GET /api/v1/campaigns — daftar Ad Campaign yang terlihat oleh aktor, terbaru
 * dulu (ADS-REVISI-UI R4: "list semua campaign yang sudah dibuat per orang
 * dengan detail nama klien, toko klien, tanggal buat campaign"). Row scope =
 * RLS `ad_campaigns_select`; staff Ads dipaku ke kampanye miliknya sendiri.
 * Query: `advertiser` (employee id, Lead Ads/Director/OD), `q` (nama klien /
 * nama toko / ID kampanye).
 */
import { ads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { campaignListRowToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const params = new URL(request.url).searchParams;
    const rows = await readAsActor(actor, (sql) =>
      ads.listCampaigns(sql, actor, { advertiser: params.get('advertiser') ?? '', q: params.get('q') ?? '' }),
    );
    return json({ data: rows.map(campaignListRowToWire) });
  });
}
