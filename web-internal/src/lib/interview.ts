/**
 * FE mirror types for Modul Interview ("Kelola Klien" tab 1) — the snake_case
 * shapes the API serves (apps/api `wire.ts` interviewToWire / …DetailToWire /
 * …VerdictToWire). These are the O43 contract the shape-parity gate checks the
 * wire mappers against; the "Kelola Klien" UI (langkah 7) renders from them.
 *
 * Keep in lock-step with `apps/api/src/lib/wire.ts` — a key here that the wire
 * mapper does not emit (or vice-versa) is exactly the blank-page class of bug
 * the parity gate exists to catch.
 */

import { api } from './api';
import type { AnswerWire, ScoreWire } from './interview-fields';

/** The interview record. */
export interface Interview {
  id: string;
  client_id: string;
  contract_id: string | null;
  service_id: string | null;
  am_pengisi_id: string;
  acting_for_am_id: string | null;
  sales_closing_id: string | null;
  status: string;
  versi_no: number;
  interview_induk_id: string | null;
  versi_sebelumnya_id: string | null;
  interview_profile: string;
  retroaktif: boolean;
  alasan_kekosongan: string | null;
  alasan_pembatalan: string | null;
  created_at: string;
  created_by: string;
}

/** Blok A schedule. */
export interface InterviewJadwal {
  tanggal_waktu: string | null;
  durasi_menit: number | null;
  format: string | null;
  lokasi_link: string | null;
  peserta_klien: unknown;
  peserta_mea: unknown;
  catatan_persiapan: string | null;
  data_diminta: unknown;
}

/** Blok C qualification output (internal — never shown client-side). */
export interface InterviewKualifikasi {
  skor_kualifikasi: number;
  skor_per_blok: unknown;
  verdict_kualifikasi: string;
  hambatan_mendasar: unknown;
  prasyarat_status: string;
  margin_bersih: number | null;
  margin_bersih_basis: string;
  margin_kotor: number | null;
  margin_derivasi_input: unknown;
  kualitas_data: string;
  bep_roas: number | null;
  rasio_target: number | null;
  dihitung_pada: string;
}

/** One Blok B answer (row per section/field). */
export interface InterviewAnswer {
  section: string;
  field_key: string;
  nilai_teks: string | null;
  nilai_angka: number | null;
  nilai_uang: string | null;
  nilai_bool: boolean | null;
  nilai_enum: string | null;
  nilai_jsonb: unknown;
  sumber_angka: string | null;
  dasar_estimasi: string | null;
}

/** The full record the internal detail page loads at once. */
export interface InterviewDetail {
  interview: Interview;
  jadwal: InterviewJadwal | null;
  kualifikasi: InterviewKualifikasi | null;
  answers: InterviewAnswer[];
}

/** verdict + prasyarat ONLY — the Sales-facing surface. */
export interface InterviewVerdict {
  interview_id: string;
  verdict: string;
  prasyarat_status: string;
}

/** One row of the client's interview log (the "Riwayat Interview" list). */
export interface InterviewListRow {
  id: string;
  client_id: string;
  service_id: string | null;
  status: string;
  versi_no: number;
  interview_profile: string;
  retroaktif: boolean;
  verdict: string | null;
  prasyarat_status: string | null;
  skor_kualifikasi: number | null;
  created_at: string;
}

// ===========================================================================
// API client — every path here is served by apps/api (route-parity KNOWN_GAPS
// must stay empty). The score/prasyarat writes are advisory: they never block.
// ===========================================================================

/** Optional args for scoreInterview (config version + prerequisite status). */
export interface ScoreExtra {
  config_version?: number;
  prasyarat_status?: string;
}

export interface JadwalWire {
  tanggal_waktu: string | null;
  durasi_menit: number | null;
  format: string | null;
  lokasi_link: string | null;
  catatan_persiapan: string | null;
}

/** POST /interview request body (named so the body-parity scanner can read it). */
export interface CreateInterviewBody {
  client_id: string;
  contract_id?: string | null;
  service_id?: string | null;
  acting_for_am_id?: string | null;
  sales_closing_id?: string | null;
  interview_profile?: string;
  retroaktif?: boolean;
}

export function createInterview(body: CreateInterviewBody): Promise<InterviewDetail> {
  return api.post<InterviewDetail>('/interview', body);
}

/** GET /interview?client_id=… — the client's interview log (newest first). */
export function listInterviewsByClient(clientId: string): Promise<{ data: InterviewListRow[] }> {
  return api.get<{ data: InterviewListRow[] }>(`/interview?client_id=${encodeURIComponent(clientId)}`);
}

export function getInterview(id: string): Promise<InterviewDetail> {
  return api.get<InterviewDetail>(`/interview/${id}`);
}

export function saveInterviewAnswers(id: string, answers: AnswerWire[]): Promise<InterviewDetail> {
  return api.put<InterviewDetail>(`/interview/${id}/answers`, { answers });
}

/** POST /interview/{id}/score — computes + PERSISTS the qualification (advisory). */
export function scoreInterview(id: string, body: ScoreWire, extra: ScoreExtra = {}): Promise<InterviewKualifikasi> {
  return api.post<InterviewKualifikasi>(`/interview/${id}/score`, { ...body, ...extra });
}

export function getInterviewVerdict(id: string): Promise<InterviewVerdict | null> {
  return api.get<InterviewVerdict | null>(`/interview/${id}/verdict`);
}

/** POST /interview/{id}/prasyarat — "tandai prasyarat selesai" (advisory). */
export function resolveInterviewPrasyarat(id: string): Promise<InterviewVerdict | null> {
  return api.post<InterviewVerdict | null>(`/interview/${id}/prasyarat`);
}

export function scheduleInterview(id: string, body: JadwalWire): Promise<InterviewDetail> {
  return api.put<InterviewDetail>(`/interview/${id}/jadwal`, body);
}

export function transitionInterview(id: string, to: string, alasanPembatalan?: string): Promise<InterviewDetail> {
  return api.post<InterviewDetail>(`/interview/${id}/transition`, {
    to,
    alasan_pembatalan: alasanPembatalan ?? null,
  });
}

// ===========================================================================
// State machine (machine `interview`) — MIRRORS the sm_edges seed. The server
// (sm_transition) is the authority; this only decides which buttons to render.
// ===========================================================================

export const INTERVIEW_STATUS = {
  BelumDijadwalkan: 'Belum Dijadwalkan',
  Terjadwal: 'Terjadwal',
  DijadwalkanUlang: 'Dijadwalkan Ulang',
  SedangBerlangsung: 'Sedang Berlangsung',
  DraftIsian: 'Draft Isian',
  ButuhDataKlien: 'Butuh Data Klien',
  Diajukan: 'Diajukan',
  Selesai: 'Selesai',
  SelesaiDenganCatatan: 'Selesai Dengan Catatan',
  Dikembalikan: 'Dikembalikan',
  Dibatalkan: 'Dibatalkan',
} as const;

export interface InterviewEdge {
  from: string;
  to: string;
  /** Reviewer edges + cancellation gate an Account lead/Director. */
  requireLead: boolean;
  /** `Dibatalkan` requires a written reason (DB CHECK). */
  requireReason: boolean;
}

/** Verbatim from the migration's sm_edges seed for machine `interview`. */
export const INTERVIEW_EDGES: InterviewEdge[] = [
  { from: 'Belum Dijadwalkan', to: 'Terjadwal', requireLead: false, requireReason: false },
  // Direct "mulai interview" from any pre-interview state (20260812000000) — the
  // schedule is often unpredictable, so starting must not require a fixed jadwal.
  { from: 'Belum Dijadwalkan', to: 'Sedang Berlangsung', requireLead: false, requireReason: false },
  { from: 'Terjadwal', to: 'Sedang Berlangsung', requireLead: false, requireReason: false },
  { from: 'Terjadwal', to: 'Dijadwalkan Ulang', requireLead: false, requireReason: false },
  { from: 'Dijadwalkan Ulang', to: 'Terjadwal', requireLead: false, requireReason: false },
  { from: 'Dijadwalkan Ulang', to: 'Sedang Berlangsung', requireLead: false, requireReason: false },
  { from: 'Sedang Berlangsung', to: 'Draft Isian', requireLead: false, requireReason: false },
  { from: 'Draft Isian', to: 'Diajukan', requireLead: false, requireReason: false },
  { from: 'Draft Isian', to: 'Butuh Data Klien', requireLead: false, requireReason: false },
  { from: 'Butuh Data Klien', to: 'Draft Isian', requireLead: false, requireReason: false },
  { from: 'Diajukan', to: 'Selesai', requireLead: false, requireReason: false },
  { from: 'Diajukan', to: 'Selesai Dengan Catatan', requireLead: true, requireReason: false },
  { from: 'Diajukan', to: 'Dikembalikan', requireLead: true, requireReason: false },
  { from: 'Dikembalikan', to: 'Draft Isian', requireLead: false, requireReason: false },
  { from: 'Belum Dijadwalkan', to: 'Dibatalkan', requireLead: true, requireReason: true },
  { from: 'Terjadwal', to: 'Dibatalkan', requireLead: true, requireReason: true },
  { from: 'Dijadwalkan Ulang', to: 'Dibatalkan', requireLead: true, requireReason: true },
  { from: 'Sedang Berlangsung', to: 'Dibatalkan', requireLead: true, requireReason: true },
  { from: 'Draft Isian', to: 'Dibatalkan', requireLead: true, requireReason: true },
  { from: 'Butuh Data Klien', to: 'Dibatalkan', requireLead: true, requireReason: true },
  { from: 'Diajukan', to: 'Dibatalkan', requireLead: true, requireReason: true },
];

/**
 * The transitions a role can take from `status`, EXCLUDING moves to `Terjadwal`
 * and `Sedang Berlangsung`. Both are driven from the Blok A schedule card: the
 * former by the schedule form (it writes the jadwal in the same step), the
 * latter by the explicit "Mulai interview" button (start now, no fixed jadwal
 * required). Offering either here would duplicate those controls.
 */
export function availableTransitions(status: string, canLead: boolean): InterviewEdge[] {
  return INTERVIEW_EDGES.filter(
    (e) =>
      e.from === status &&
      e.to !== 'Terjadwal' &&
      e.to !== 'Sedang Berlangsung' &&
      (!e.requireLead || canLead),
  );
}

/** States in which Blok B answers + scoring may be written. */
export const ANSWER_EDITABLE_STATES: readonly string[] = [
  INTERVIEW_STATUS.SedangBerlangsung,
  INTERVIEW_STATUS.DraftIsian,
  INTERVIEW_STATUS.ButuhDataKlien,
  INTERVIEW_STATUS.Dikembalikan,
];

export function isAnswerEditable(status: string): boolean {
  return ANSWER_EDITABLE_STATES.includes(status);
}

/** Badge tone for an interview status (the shared heuristic buckets most to gray). */
export function interviewStatusTone(status: string): string {
  switch (status) {
    case INTERVIEW_STATUS.BelumDijadwalkan:
      return 'gray';
    case INTERVIEW_STATUS.Terjadwal:
    case INTERVIEW_STATUS.SedangBerlangsung:
      return 'blue';
    case INTERVIEW_STATUS.DijadwalkanUlang:
    case INTERVIEW_STATUS.DraftIsian:
    case INTERVIEW_STATUS.ButuhDataKlien:
      return 'amber';
    case INTERVIEW_STATUS.Diajukan:
      return 'purple';
    case INTERVIEW_STATUS.Selesai:
    case INTERVIEW_STATUS.SelesaiDenganCatatan:
      return 'green';
    case INTERVIEW_STATUS.Dikembalikan:
      return 'red';
    case INTERVIEW_STATUS.Dibatalkan:
      return 'darkgray';
    default:
      return 'gray';
  }
}

// ===========================================================================
// Verdict + prasyarat display
// ===========================================================================

export const VERDICT_LABELS: Record<string, string> = {
  growth_ready: 'Growth Ready',
  bersyarat: 'Bersyarat',
  risiko_tinggi: 'Risiko Tinggi',
  tidak_siap: 'Tidak Siap',
};

export function verdictTone(verdict: string): string {
  switch (verdict) {
    case 'growth_ready':
      return 'green';
    case 'bersyarat':
      return 'amber';
    case 'risiko_tinggi':
      return 'red';
    case 'tidak_siap':
      return 'darkgray';
    default:
      return 'gray';
  }
}

export const PRASYARAT_LABELS: Record<string, string> = {
  belum: 'Belum',
  jalan: 'Sedang berjalan',
  selesai: 'Selesai',
};

export const KUALITAS_DATA_LABELS: Record<string, string> = {
  terverifikasi: 'Terverifikasi',
  sebagian_estimasi: 'Sebagian estimasi',
  mayoritas_estimasi: 'Mayoritas estimasi',
};

/** Deal-breaker code → BI label (for the sidebar + prints). */
export const HAMBATAN_LABELS: Record<string, string> = {
  margin_di_bawah_minimum: 'Margin bersih di bawah minimum',
  dropship: 'Model bisnis dropship',
  rasio_target_terlalu_tinggi: 'Rasio target terlalu tinggi (> 5x)',
  daya_tahan_budget_terlalu_pendek: 'Daya tahan budget terlalu pendek (≤ 1 bulan)',
};
