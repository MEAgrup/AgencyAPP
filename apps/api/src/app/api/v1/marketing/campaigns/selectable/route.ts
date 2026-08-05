/**
 * /api/v1/marketing/campaigns/selectable — the lead-intake campaign picker
 * (M1 §9.3 Origin Campaign / M0 §3 registration form).
 *
 * A SEPARATE endpoint from `GET /marketing/campaigns` on purpose, not a query
 * parameter on it: the two answer different questions with different scopes.
 * The list route is the Marketing workspace (owner-scoped, full Campaign record,
 * Marketing-only — a Sales actor gets 403 from `campaign.listCampaigns`); this
 * one is "which campaigns can a lead be attributed to", which every intake door
 * needs and no salesperson owns. Sharing one path would mean one route with two
 * response shapes and two permission gates.
 *
 * A static segment beside `[id]`, same as `/leads/delete-requests` beside
 * `/leads/{id}`: the App Router matches the literal segment first, so this never
 * shadows `GET /marketing/campaigns/CMP-…`.
 *
 * Read through `readAsActor` like every other read (O37) — the rows come from
 * `private.campaign_selectable()` (SECURITY DEFINER, migration 20260805022245),
 * which is why the `campaigns` table's owner scope can stay untouched.
 */
import { campaign } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { selectableCampaignToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const list = await readAsActor(actor, (sql) => campaign.listSelectableCampaigns(sql, actor));
    return json({ data: list.map(selectableCampaignToWire) });
  });
}
