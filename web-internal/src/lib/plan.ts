// Module 6B — Plan (PLAN-) client types + fetchers (RAB-14/15 route surface).
//
// The M6B domain shipped its write functions before any page consumed them; this
// file is the contract those pages will be built against, and it exists NOW for
// the same reason `strategi.ts` did: in CDPS the FE interface is the source of
// truth the response-shape guard (`apps/api/src/lib/shape-parity.test.ts`) checks
// the wire layer against. A converter with no declared FE type is a converter
// nothing verifies — the O43 blank-page class.
//
// Everything here is snake_case, matching the wire body. The camelCase↔snake_case
// boundary lives in `apps/api/src/lib/wire.ts` and nowhere else.

import { api } from './api';
import type { Brief } from '@/lib/account';

// ---------------------------------------------------------------------------
// Shapes (mirror `apps/api/src/lib/wire.ts` Plan* wire interfaces exactly).
// ---------------------------------------------------------------------------

/** The PLAN- period header (Section P-A). */
export interface Plan {
  id: string;
  lingkup: string;
  contract_id: string | null;
  client_id: string;
  strategi_id: string | null;
  periode_no: number;
  tanggal_mulai: string;
  tanggal_akhir: string;
  jumlah_minggu: number;
  status: string;
  catatan_pembuka: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
}

/** A per-channel target (Section P-B / Rule 9). */
export interface PlanTarget {
  plan_id: string;
  channel: string;
  metric: string;
  nilai_strategi: number;
  nilai_dipakai: number;
  arah: string;
  persen_perubahan: number;
  alasan: string | null;
  bukti_file: string | null;
  status_persetujuan: string | null;
}

/** One work-row (Section P-C). */
export interface PlanRow {
  id: number;
  plan_id: string;
  channel: string;
  pilar: string;
  strategi_pillar_id: number | null;
  service_id: string | null;
  di_luar_strategi: boolean;
  di_luar_service: boolean;
  di_luar_alasan: string | null;
  aksi: string;
  sku_sasaran: unknown[];
  kuota: number;
  satuan: string;
  budget: number | null;
  divisi_pic: string;
  minggu_sasaran: number[];
  prioritas: string;
  hasil_diharapkan: string;
  prasyarat: string | null;
  status_baris: string;
  status_baris_alasan: string | null;
  visibilitas: string;
  keberatan_kapasitas: boolean;
  keberatan_alasan: string | null;
  terbawa: boolean;
  periode_asal_id: string | null;
  keputusan_carryover: string | null;
}

/** One weekly-distribution cell (Section P-D). */
export interface PlanRowWeek {
  id: number;
  plan_row_id: number;
  minggu_no: number;
  kuota: number;
}

/** A per-channel actual (Section P-E, hybrid). */
export interface PlanActual {
  plan_id: string;
  channel: string;
  metric: string;
  sumber: string;
  nilai: number;
  file_bukti: string | null;
  tanggal_ambil: string | null;
  sengketa: string | null;
}

/** Contract-level carried deficit (Rule 9 / PA-6). */
export interface PlanDeficit {
  defisit_terbawa: number;
}

/** The period close review (Section P-F). */
export interface PlanReview {
  plan_id: string;
  yang_jalan: string | null;
  yang_tidak_jalan: string | null;
  diagnosa_gap: string | null;
  diagnosa_gap_bukti: string | null;
  rekomendasi: string | null;
  perlu_revisi: boolean | null;
  materi_klien: string | null;
}

/** One auto-raised deviation flag (Section P-G). */
export interface PlanFlag {
  id: number;
  plan_id: string;
  plan_row_id: number | null;
  jenis: string;
  detail: string | null;
  ack_spv_oleh: string | null;
  ack_spv_pada: string | null;
}

/** The whole period bundle a Plan page renders in one load (Section P-A…P-G). */
export interface PlanDetail {
  plan: Plan;
  targets: PlanTarget[];
  rows: PlanRow[];
  weeks: PlanRowWeek[];
  actuals: PlanActual[];
  review: PlanReview | null;
  flags: PlanFlag[];
  defisit_terbawa: number;
}

/** RAB-16 — one row NOT briefed by the one-click inherit, and why. `reason` is a
 *  machine code (di_luar / service_ambigu / tanpa_jadwal / sudah_diwarisi /
 *  service_tidak_ditemukan / service_tidak_briefable / divisi_pic_tidak_valid /
 *  kuota_nol) the page maps to its own friendly text. */
export interface BriefInheritSkip {
  plan_row_id: number;
  reason: string;
}

/** RAB-16 — the result of one "warisi semua" click: Briefs created + rows skipped. */
export interface BriefInheritResult {
  created: Brief[];
  skipped: BriefInheritSkip[];
}

// ---------------------------------------------------------------------------
// Request bodies.
// ---------------------------------------------------------------------------

/** Section P-C fields for a NEW work-row (RAB-14). Origin (PC-3) is exactly one
 *  of strategi_pillar_id / service_id / di_luar_strategi / di_luar_service. */
export interface CreatePlanRowBody {
  channel: string;
  pilar: string;
  strategi_pillar_id?: number | null;
  service_id?: string | null;
  di_luar_strategi?: boolean;
  di_luar_service?: boolean;
  di_luar_alasan?: string | null;
  aksi?: string;
  sku_sasaran?: unknown[];
  kuota: number;
  satuan?: string;
  budget?: number | null;
  divisi_pic: string;
  minggu_sasaran?: number[];
  prioritas?: string;
  hasil_diharapkan?: string;
  prasyarat?: string | null;
  visibilitas?: string;
}

export interface AdjustTargetBody {
  channel: string;
  metric: string;
  nilai_dipakai: number;
  alasan?: string;
  bukti_file?: string;
}

export interface ManualActualBody {
  channel: string;
  metric: string;
  nilai: number;
  file_bukti: string;
  tanggal_ambil: string;
}

// ---------------------------------------------------------------------------
// Fetchers (RAB-15 — one per M6B route).
// ---------------------------------------------------------------------------

/** Loads one period with every child block (Section P-A…P-G) in one shot. */
export function getPlanDetail(id: string): Promise<PlanDetail> {
  return api.get<PlanDetail>(`/plan/${id}`);
}

/** Lists every Plan period of a contract, ordered by period number. */
export function listPlansForContract(contractId: string): Promise<Plan[]> {
  return api.get<Plan[]>(`/contracts/${contractId}/plans`);
}

/** PA-7 — save the AM's opening note. Only while the period is Draft. */
export function saveCatatanPembuka(id: string, catatanPembuka: string): Promise<Plan> {
  return api.put<Plan>(`/plan/${id}/pembuka`, { catatan_pembuka: catatanPembuka });
}

export function submitPlanPeriode(id: string): Promise<Plan> {
  return api.post<Plan>(`/plan/${id}/submit`);
}

export function approvePlanPeriode(id: string): Promise<Plan> {
  return api.post<Plan>(`/plan/${id}/approve`);
}

export function returnPlanPeriode(id: string, catatan: string): Promise<Plan> {
  return api.post<Plan>(`/plan/${id}/return`, { catatan });
}

export function activatePlanPeriode(id: string): Promise<Plan> {
  return api.post<Plan>(`/plan/${id}/activate`);
}

export function createPlanRow(id: string, body: CreatePlanRowBody): Promise<PlanRow> {
  return api.post<PlanRow>(`/plan/${id}/rows`, body);
}

export function adjustPlanTarget(id: string, body: AdjustTargetBody): Promise<PlanTarget> {
  return api.post<PlanTarget>(`/plan/${id}/target`, body);
}

export function approveTargetAdjustment(
  id: string,
  body: { channel: string; metric: string },
): Promise<PlanTarget> {
  return api.post<PlanTarget>(`/plan/${id}/target/approve`, body);
}

export function setWeeklyDistribution(
  rowId: number,
  perWeek: { minggu_no: number; kuota: number }[],
): Promise<PlanRowWeek[]> {
  return api.post<PlanRowWeek[]>(`/plan/rows/${rowId}/weeks`, { per_week: perWeek });
}

export function recordManualActual(id: string, body: ManualActualBody): Promise<PlanActual> {
  return api.post<PlanActual>(`/plan/${id}/actual`, body);
}

export function fileSengketa(
  id: string,
  body: { channel: string; metric: string; alasan: string },
): Promise<PlanActual> {
  return api.post<PlanActual>(`/plan/${id}/sengketa`, body);
}

export function getContractDeficit(contractId: string): Promise<PlanDeficit> {
  return api.get<PlanDeficit>(`/contracts/${contractId}/plan-deficit`);
}

/** RAB-16 — one-click "warisi semua": AM supplies { plan_row_id, due_date,
 *  priority } per row; the server briefs every eligible row and reports skips. */
export function inheritBriefsFromPlan(
  id: string,
  fills: { plan_row_id: number; due_date: string; priority: string }[],
): Promise<BriefInheritResult> {
  return api.post<BriefInheritResult>(`/plan/${id}/briefs`, { fills });
}
