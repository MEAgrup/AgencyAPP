/**
 * GET /api/v1/briefs/{id}/ads-target-kpi — Target KPI yang diwarisi kampanye
 * Ads dari brief-nya (ADS-REVISI-UI R3: "Target KPI sudah diisi di dalam brief
 * jadi tidak perlu diisi kembali oleh advertiser"). Sumbernya Strategy STR- atau
 * baris Plan M6B — keduanya tak terbaca divisi Ads lewat RLS, jadi rute ini
 * service-role di belakang gerbang kampanye (`ads.targetKpiBrief`).
 */
import { ads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import type { AdsTargetKpiWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const k = await ads.targetKpiBrief(db(), actor, id);
    const body: AdsTargetKpiWire = { target_kpi: k.targetKpi, sumber: k.sumber };
    return json(body);
  });
}
