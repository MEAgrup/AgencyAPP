/**
 * POST /api/v1/plan/{id}/rows — add one Section P-C work-row (RAB-14). Before
 * this, `plan_row` had no write path outside the test suite. Origin (PC-3) is
 * exactly one of a Strategi pillar / service / `Di Luar` flag; validation, the
 * one-of gate, the write scope (owning AM / lead) and the audit row all live in
 * the domain (`createPlanRow`). This route only maps snake_case → the domain
 * input and shapes the response back through `planRowToWire` (O43).
 */
import { plan } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { planRowToWire } from '@/lib/wire';

interface CreateRowBody {
  channel?: string;
  pilar?: string;
  strategi_pillar_id?: number | null;
  service_id?: string | null;
  di_luar_strategi?: boolean;
  di_luar_service?: boolean;
  di_luar_alasan?: string | null;
  aksi?: string;
  sku_sasaran?: unknown[];
  kuota?: number;
  satuan?: string;
  budget?: number | null;
  divisi_pic?: string;
  minggu_sasaran?: number[];
  prioritas?: plan.PlanRow['prioritas'];
  hasil_diharapkan?: string;
  prasyarat?: string | null;
  instruksi_brief?: string | null;
  visibilitas?: plan.PlanRow['visibilitas'];
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<CreateRowBody>(request);
    const row = await plan.createPlanRow(db(), actor, id, {
      channel: b.channel ?? '',
      pilar: b.pilar ?? '',
      strategiPillarId: b.strategi_pillar_id ?? null,
      serviceId: b.service_id ?? null,
      diLuarStrategi: b.di_luar_strategi ?? false,
      diLuarService: b.di_luar_service ?? false,
      diLuarAlasan: b.di_luar_alasan ?? null,
      aksi: b.aksi,
      skuSasaran: b.sku_sasaran,
      kuota: b.kuota as number,
      satuan: b.satuan,
      budget: b.budget ?? null,
      divisiPic: b.divisi_pic ?? '',
      mingguSasaran: b.minggu_sasaran,
      prioritas: b.prioritas,
      hasilDiharapkan: b.hasil_diharapkan,
      prasyarat: b.prasyarat ?? null,
      instruksiBrief: b.instruksi_brief ?? null,
      visibilitas: b.visibilitas,
    });
    return json(planRowToWire(row), 201);
  });
}
