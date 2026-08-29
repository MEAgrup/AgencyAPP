/**
 * GET /api/v1/campaigns/{id}/management-date — Ads Management Date (M16 §4.2
 * LT-42): end_date TURUNAN read-only = start_date + durasi_jasa + additional_days
 * + total_hari_hold. Nol kolom disimpan; dihitung ulang setiap dibaca.
 */
import { ads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { adsManagementDateToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const d = await readAsActor(actor, (sql) => ads.computeAdsManagementEndDate(sql, actor, id));
    return json(adsManagementDateToWire(d));
  });
}
