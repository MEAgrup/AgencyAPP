/**
 * POST /api/v1/services/{id}/plan-gate/preview — run the Rule 3 trigger table
 * against the attributes currently in the form and return the recommendation,
 * WITHOUT writing anything.
 *
 * This exists because GB-1/GB-2 must be visible *before* the AM answers GB-3:
 * "The system computes a recommendation from the service's own attributes BEFORE
 * the AM answers." Recomputing it client-side would fork the trigger table into
 * two implementations that drift — the failure mode M6C is written against.
 */
import { plangate } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { planGateRecommendationToWire } from '@/lib/wire';

interface PreviewBody {
  durasi_bulan?: number | null;
  berulang?: boolean;
  divisi_terlibat?: string[];
  target_angka_jenis?: plangate.TargetKind | null;
  kuota_per_periode?: number | null;
  nilai_per_bulan?: string | null;
  sequence_dependency?: boolean;
  laporan_periodik?: boolean;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<PreviewBody>(request);
    const rec = await plangate.previewRecommendation(db(), actor, id, {
      durasiBulan: b.durasi_bulan ?? null,
      berulang: b.berulang === true,
      divisiTerlibat: b.divisi_terlibat ?? [],
      targetJenis: b.target_angka_jenis ?? null,
      kuotaPerPeriode: b.kuota_per_periode ?? null,
      nilaiPerBulan: b.nilai_per_bulan ?? null,
      sequenceDependency: b.sequence_dependency === true,
      laporanPeriodik: b.laporan_periodik === true,
    });
    return json(planGateRecommendationToWire(rec));
  });
}
