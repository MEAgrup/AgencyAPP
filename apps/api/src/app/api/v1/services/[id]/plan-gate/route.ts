/**
 * GET  /api/v1/services/{id}/plan-gate — Section G-A context + the recorded G-B
 *      determination (null when the middle tier is still unanswered).
 * POST /api/v1/services/{id}/plan-gate — record the G-B determination (M6C §6).
 *
 * Both are shells: resolve the actor from JWT claims, read the body, call the
 * domain. Every gate (tier locked, ownership, the GB-5/6/8 conditional-required
 * matrix) lives in `plangate` so the DB CHECK constraints and the TS predicate
 * stay the single pair they are meant to be.
 *
 * POST never blocks and is never held for approval (M6C Rule 4) — a pending
 * approval here would stall delivery for a service that may be two weeks long.
 */
import { plangate } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { assignmentSummaryFromWire, planGateContextToWire, planGateToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const context = await plangate.gateContext(db(), actor, id);
    return json(planGateContextToWire(context));
  });
}

interface GateBody {
  durasi_bulan?: number | null;
  berulang?: boolean;
  divisi_terlibat?: string[];
  target_angka_jenis?: plangate.TargetKind | null;
  target_angka_nilai?: string | null;
  kuota_per_periode?: number | null;
  nilai_per_bulan?: string | null;
  sequence_dependency?: boolean;
  laporan_periodik?: boolean;
  floor_price?: unknown | null;
  deliverable?: string;
  keputusan_am?: plangate.GateDecision;
  alasan?: string | null;
  pemantauan_alternatif?: string | null;
  tanggal_tinjau_ulang?: string;
  ringkasan_penugasan?: unknown | null;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<GateBody>(request);
    const gate = await plangate.decideGate(db(), actor, id, {
      durasiBulan: b.durasi_bulan ?? null,
      berulang: b.berulang === true,
      divisiTerlibat: b.divisi_terlibat ?? [],
      targetJenis: b.target_angka_jenis ?? null,
      targetNilai: b.target_angka_nilai ?? null,
      kuotaPerPeriode: b.kuota_per_periode ?? null,
      nilaiPerBulan: b.nilai_per_bulan ?? null,
      sequenceDependency: b.sequence_dependency === true,
      laporanPeriodik: b.laporan_periodik === true,
      floorPrice: b.floor_price ?? null,
      deliverable: b.deliverable ?? '',
      keputusanAm: b.keputusan_am ?? 'tanpa_plan',
      alasan: b.alasan ?? null,
      pemantauanAlternatif: b.pemantauan_alternatif ?? null,
      tanggalTinjauUlang: b.tanggal_tinjau_ulang ?? '',
      ringkasanPenugasan: assignmentSummaryFromWire(b.ringkasan_penugasan ?? null),
    });
    return json(planGateToWire(gate));
  });
}
