/** /api/v1/marketing/campaigns — acquisition Campaign (CMP-): create (POST) + list (GET) (M3 §3/§5). */
import { campaign } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { marketingCampaignToWire } from '@/lib/wire';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const b = await readJson<{ name?: string; channel?: string; online?: boolean; offline?: boolean; start_date?: string }>(request);
    const c = await campaign.createCampaign(db(), actor, {
      name: b.name ?? '', channel: b.channel ?? '', online: b.online, offline: b.offline, startDate: b.start_date ?? '',
    });
    return json(marketingCampaignToWire(c));
  });
}

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const list = await readAsActor(actor, (sql) => campaign.listCampaigns(sql, actor));
    return json({ data: list.map(marketingCampaignToWire) });
  });
}
