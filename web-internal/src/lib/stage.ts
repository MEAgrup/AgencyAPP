'use client';

// Data layer for M16 Tahapan Produksi Brief — lead time per tahap divisi.
// Mirrors `stageOverviewToWire`/`stageDefToWire` in apps/api/src/lib/wire.ts.
//
// The three lateness/duration fields (`hari_kerja`, `status`, `target_hari_kerja`)
// arrive PRE-COMPUTED from the server (`working_days_between`, `interview`
// SLA vocabulary) and are rendered as given — a second implementation here
// would eventually disagree with the server's (house rule #4/#7).

import { api } from '@/lib/api';

/** One `stage_definition` row (PRD §5.1). Mirrors `StageDefWire`. */
export interface StageDef {
  stage_code: string;
  label: string;
  urutan: number;
  sumber: 'stage' | 'status_brief';
  status_dipetakan: string | null;
  gate_pihak: string | null;
  target_hari_kerja: number | null;
}

/** One computed checkpoint in a Brief's lead-time timeline. Mirrors `StageLeadTimeRowWire`. */
export interface StageLeadTimeRow {
  stage_code: string;
  label: string;
  urutan: number;
  sumber: 'stage' | 'status_brief';
  gate_pihak: string | null;
  masuk_pada: string | null;
  keluar_pada: string | null;
  hari_kerja: number | null;
  target_hari_kerja: number | null;
  /** interview.SLA_STATUS vocabulary — belum_mulai | tepat_waktu | mendekati_batas | terlambat | tidak_berlaku. */
  status: string;
}

/** The Cek Brief AM decision (PRD §2 Rule 10), if any. Mirrors `StageReviewWire`. */
export interface StageReview {
  /** BRIEF-KEMBALI-SIKLUS — putaran keputusan (1 = pertama). */
  putaran: number;
  keputusan: string;
  alasan_kode: string | null;
  catatan: string;
  actor_employee_id: string;
  created_at: string;
}

/** Satu kiriman ulang AM (BRIEF-KEMBALI-SIKLUS). Mirrors `StageKirimUlangWire`. */
export interface StageKirimUlang {
  putaran: number;
  catatan: string;
  perubahan: Record<string, { before: unknown; after: unknown }>;
  actor_employee_id: string;
  created_at: string;
}

/** PRD §3 row 2 ("AM kirim → divisi merespons"). Mirrors `StageIntakeWire`. */
export interface StageIntake {
  masuk_pada: string;
  keluar_pada: string | null;
  hari_kerja: number;
}

/** One valid forward edge out of the Brief's current `production_stage` (LT-60). Mirrors `NextStageWire`. */
export interface NextStage {
  stage_code: string;
  label: string;
}

/** GET /briefs/{id}/stage response. Mirrors `StageOverviewWire`. */
export interface StageOverview {
  brief_id: string;
  stage_pipeline_code: string | null;
  production_stage: string | null;
  review: StageReview | null;
  /** menunggu | diterima | dikembalikan (= HOLD, menunggu revisi AM). */
  intake_state: 'menunggu' | 'diterima' | 'dikembalikan';
  reviews: StageReview[];
  kirim_ulang: StageKirimUlang[];
  stages: StageLeadTimeRow[];
  total_hari_kerja: number | null;
  tahap_aktif: string | null;
  intake: StageIntake;
  next_stages: NextStage[];
}

export function getBriefStage(briefId: string): Promise<StageOverview> {
  return api.get<StageOverview>(`/briefs/${briefId}/stage`);
}

/** Body of POST /briefs/{id}/stage/review (Cek Brief AM, PRD §2 Rule 10). */
export interface ReviewStageInput {
  keputusan: 'Diterima' | 'Dikembalikan';
  alasan_kode?: string;
  catatan?: string;
}

/** Cek Brief AM — accept ("Diterima") or return ("Dikembalikan" + alasan_kode) a dispatched Brief. */
export function reviewBriefStage(briefId: string, input: ReviewStageInput): Promise<{ ok: true }> {
  return api.post<{ ok: true }>(`/briefs/${briefId}/stage/review`, input);
}

/** Drive `production_stage` one edge forward — invalid edges are rejected server-side (409). */
export function advanceBriefStage(briefId: string, to: string): Promise<{ ok: boolean; from?: string; to?: string }> {
  return api.post(`/briefs/${briefId}/stage/advance`, { to });
}

/** Override one stage's target hari kerja for this Brief (Lead/SPV/Director only). */
export function setBriefStageSla(briefId: string, stageCode: string, targetHariKerja: number): Promise<{ ok: true }> {
  return api.post<{ ok: true }>(`/briefs/${briefId}/stage/sla`, { stage_code: stageCode, target_hari_kerja: targetHariKerja });
}

/**
 * Body of POST /briefs/{id}/kirim-ulang (BRIEF-KEMBALI-SIKLUS). Kunci yang
 * tidak dikirim = field tidak diubah; `catatan` wajib.
 */
export interface KirimUlangInput {
  catatan: string;
  title?: string;
  instructions?: string;
  reference_attachments?: string;
  due_date?: string;
  quantity_target?: number;
  priority?: string;
  tanggal_mulai?: string;
  tanggal_akhir?: string;
  budget?: string | null;
}

/** AM merevisi & mengirim ulang Brief yang dikembalikan divisi. */
export function kirimUlangBrief(briefId: string, input: KirimUlangInput): Promise<{ ok: true; putaran: number }> {
  return api.post<{ ok: true; putaran: number }>(`/briefs/${briefId}/kirim-ulang`, input);
}
