/**
 * Mesin Laporan Klien (C1) — the FE data layer.
 *
 * Like Riset Awal (`riset-awal.ts`), the ONLY step that runs in the browser is
 * turning the uploaded xlsx binary into rows (array-of-arrays) plus a sha256
 * fingerprint (`parseExportFile`, reused as-is). The file detection, the scoring
 * engine, and every threshold live SERVER-SIDE in `@cdps/core` — web-internal is
 * a standalone Next app with no `@cdps/core`, and a second copy of the score
 * rules in the browser is the drift the owner forbade (keputusan 4). So this
 * module parses, hashes, and POSTs; the server scores, writes the report, and
 * (the gap C1 closes) writes `clients.total_sales`.
 *
 * Wire shapes are snake_case (the API boundary); every field is present — a
 * missing key blanks a page even on a 200 (O43). Mirrors `apps/api`
 * `clientReport*ToWire` exactly (shape-parity guards it).
 */
import { api } from './api';
import { type ParsedExport } from './riset-awal';
import { type Role } from './types';

// ---------------------------------------------------------------------------
// Wire types (snake_case) — mirror apps/api `clientReport*ToWire`.
// ---------------------------------------------------------------------------
export interface ClientReportSummary {
  id: number;
  client_id: string;
  client_platform_id: number;
  platform: string;
  periode_tipe: string;
  periode_mulai: string;
  periode_akhir: string;
  hari_periode: number;
  rentang_dari_berkas: boolean;
  skor: number | null;
  skor_label: string | null;
  gmv_net: number;
  gmv_kotor: number;
  gmv_runrate_bulanan: number;
  benchmark_versi: number;
  engine_versi: string;
  created_at: string;
  created_by: string;
}

export interface ClientReportBerkas {
  id: number;
  nama_berkas: string;
  sha256: string;
  ukuran_bytes: number;
  tipe_terdeteksi: string | null;
  tipe_override: string | null;
  jumlah_baris: number | null;
  periode: unknown;
}

export interface ClientReportDetail extends ClientReportSummary {
  payload: unknown;
  kelengkapan_file: unknown;
  berkas: ClientReportBerkas[];
  publikasi: ReportPublikasi;
}

// ---------------------------------------------------------------------------
// Insight yang bisa disunting + gerbang publikasi
// ---------------------------------------------------------------------------
export interface Rekomendasi {
  judul: string;
  target: string;
  dampak: string;
  timeline: string;
}

export interface Indikator {
  nama: string;
  target: string;
}

/** The six editable fields — the same shape the engine payload uses. */
export interface ReportInsight {
  ringkasan: string;
  poin: string[];
  rekomendasi_tinggi: Rekomendasi[];
  rekomendasi_sedang: Rekomendasi[];
  outlook: string;
  indikator: Indikator[];
}

export interface ReportInsightRevisi {
  revisi: number;
  sumber: string;
  insight: ReportInsight;
  catatan_revisi: string | null;
  created_at: string;
  created_by: string;
}

export interface ReportPublikasi {
  status: string;
  /** The revision the CLIENT reads. Null while not published. */
  insight_revisi: number | null;
  diterbitkan_pada: string | null;
  diterbitkan_oleh: string | null;
  dicabut_pada: string | null;
  dicabut_oleh: string | null;
  alasan_cabut: string | null;
}

export interface ReportInsightBundle {
  report_id: number;
  publikasi: ReportPublikasi;
  /** Highest revision on file — what the internal preview renders. */
  terbaru: ReportInsightRevisi;
  /** Revisi 0, the engine snapshot. */
  mesin: ReportInsightRevisi;
  terpaku: ReportInsightRevisi | null;
  ada_perubahan_belum_terbit: boolean;
}

export const STATUS_DRAF = '[Draf]';
export const STATUS_TERBIT = '[Terbit]';
export const STATUS_DICABUT = '[Dicabut]';

export type PeriodeTipe = 'mingguan' | 'bulanan';
export type ReportMode = 'klien' | 'internal';

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------
/** GET /clients/{id}/reports — a client's report chain, newest period first. */
export async function getClientReports(clientId: string): Promise<ClientReportSummary[]> {
  const res = await api.get<{ data: ClientReportSummary[] }>(`/clients/${clientId}/reports`);
  return res.data;
}

/**
 * POST /clients/{id}/reports — build ONE report for one active store from the
 * uploaded exports. The server detects each file, runs the engine, stores the
 * report, and rewrites `clients.total_sales`. An ambiguous own-vs-affiliate file
 * comes back as a `[...]` error until the AM sets `tipe_override` on it.
 */
export async function createClientReport(
  clientId: string,
  input: {
    clientPlatformId: number;
    periodeTipe: PeriodeTipe;
    files: ParsedExport[];
    net?: boolean;
    linkedAccounts?: string[];
    periodeMulai?: string | null;
    periodeAkhir?: string | null;
  },
): Promise<ClientReportDetail> {
  return api.post<ClientReportDetail>(`/clients/${clientId}/reports`, {
    client_platform_id: input.clientPlatformId,
    periode_tipe: input.periodeTipe,
    files: input.files,
    net: input.net ?? true,
    linked_accounts: input.linkedAccounts ?? [],
    periode_mulai: input.periodeMulai ?? null,
    periode_akhir: input.periodeAkhir ?? null,
  });
}

/** GET /reports/{id} — one full report bundle (payload + provenance). */
export function getClientReport(reportId: number): Promise<ClientReportDetail> {
  return api.get<ClientReportDetail>(`/reports/${reportId}`);
}

/**
 * The URL of the standalone HTML render, opened in a new tab (never fetched as
 * JSON). `internal` carries MEA's audit blocks; `klien` is what the client
 * receives. The route resolves the actor from the session cookie.
 */
export function reportHtmlUrl(reportId: number, mode: ReportMode): string {
  return `/api/v1/reports/${reportId}/html?mode=${mode}`;
}

// ---------------------------------------------------------------------------
// Insight & publikasi — API client
// ---------------------------------------------------------------------------
/** GET /reports/{id}/insight — engine text, latest edit, and the pinned revision. */
export function getReportInsight(reportId: number): Promise<ReportInsightBundle> {
  return api.get<ReportInsightBundle>(`/reports/${reportId}/insight`);
}

/**
 * PUT /reports/{id}/insight — append the edited narrative as a new revision.
 *
 * Saving deliberately changes NOTHING the client sees, even on a published
 * report: publishing is a separate, explicit act. That is what makes it safe to
 * save mid-thought.
 */
export function saveReportInsight(
  reportId: number, insight: ReportInsight, catatanRevisi?: string | null,
): Promise<ReportInsightBundle> {
  return api.put<ReportInsightBundle>(`/reports/${reportId}/insight`, {
    ringkasan: insight.ringkasan,
    poin: insight.poin,
    rekomendasi_tinggi: insight.rekomendasi_tinggi,
    rekomendasi_sedang: insight.rekomendasi_sedang,
    outlook: insight.outlook,
    indikator: insight.indikator,
    catatan_revisi: catatanRevisi ?? null,
  });
}

/** POST /reports/{id}/insight/reset — bring back the engine text as a new revision. */
export function resetReportInsight(reportId: number): Promise<ReportInsightBundle> {
  return api.post<ReportInsightBundle>(`/reports/${reportId}/insight/reset`, {});
}

/** POST /reports/{id}/publish — publish, pinning the latest revision. */
export function publishReport(reportId: number): Promise<ReportPublikasi> {
  return api.post<ReportPublikasi>(`/reports/${reportId}/publish`, {});
}

/** POST /reports/{id}/republish — move the pin to the newest revision. */
export function republishReport(reportId: number): Promise<ReportPublikasi> {
  return api.post<ReportPublikasi>(`/reports/${reportId}/republish`, {});
}

/** POST /reports/{id}/revoke — withdraw it from the client. Reason mandatory. */
export function revokeReport(reportId: number, alasan: string): Promise<ReportPublikasi> {
  return api.post<ReportPublikasi>(`/reports/${reportId}/revoke`, { alasan });
}

/**
 * Can this role POSSIBLY write a report insight? Mirrors the role limb of
 * `report.canWriteReport`, and deliberately NOT its row limb.
 *
 * The server gate is "Director, OR an Account lead, OR the client's own AM".
 * This page does not know who the owning AM is (`ReportPanel` receives the
 * client id and its platforms, not the client's assignment), so the honest UI
 * gate is the part that IS knowable: OD never writes anywhere, and a division
 * outside Account never writes a client report. An Account staff member sees
 * the controls and, if the client is not theirs, gets the server's
 * `[Anda tidak berhak mengakses laporan klien ini]` — which the panel shows.
 *
 * Deliberate choice: hiding the button for every Account staffer would hide it
 * from the exact person it is for. Showing a refusable button beats hiding a
 * usable one, as long as the refusal is legible — and it is.
 */
export function canPublishReportUi(role: Role | null): boolean {
  if (!role) return false;
  if (role.director) return true;
  if (role.od) return false;
  return role.division === 'Account';
}

/** Human label for a publication status, for the panel's badge. */
export function labelStatusPublikasi(status: string): string {
  switch (status) {
    case STATUS_TERBIT: return 'Terbit ke klien';
    case STATUS_DICABUT: return 'Dicabut';
    default: return 'Draf — belum dilihat klien';
  }
}
