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
import { sha256Hex, type ParsedExport } from './riset-awal';
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
  /** TikTok rows only; null for Shopee rows (see `benchmark_versi_shopee`). */
  benchmark_versi: number | null;
  /** Shopee rows only (`cdps.report.shopee.v1`); null for TikTok rows. */
  benchmark_versi_shopee: number | null;
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

/** R3 — the AM's paragraph for one buyer-journey stage. */
export interface TahapNarasi {
  tahap: TahapKey;
  judul: string;
  teks: string;
}

/** The seven editable fields — the same shape the engine payload uses. */
export interface ReportInsight {
  ringkasan: string;
  poin: string[];
  rekomendasi_tinggi: Rekomendasi[];
  rekomendasi_sedang: Rekomendasi[];
  outlook: string;
  indikator: Indikator[];
  tahap_narasi: TahapNarasi[];
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
/**
 * The rendered report's URL.
 *
 * `download` is what separates the two buttons the panel shows per mode.
 * Without it the browser opens the document in a tab (a preview); with it the
 * API answers `Content-Disposition: attachment` and the file lands in the
 * downloads folder under a name that says which mode it is. The button labelled
 * "Unduh" used to do the former, which is why both now exist explicitly.
 */
export function reportHtmlUrl(reportId: number, mode: ReportMode, download = false): string {
  return `/api/v1/reports/${reportId}/html?mode=${mode}${download ? '&download=1' : ''}`;
}

/** R3 — the three buyer-journey stages. `''` in the UI means "not set". */
export type TahapKey = 'awareness' | 'consideration' | 'conversion';

export const TAHAP_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Belum ditetapkan' },
  { value: 'awareness', label: 'Awareness' },
  { value: 'consideration', label: 'Consideration' },
  { value: 'conversion', label: 'Conversion' },
];

export function labelTahap(v: string | null): string {
  return TAHAP_OPTIONS.find((o) => o.value === (v ?? ''))?.label ?? (v ?? '');
}

/**
 * PUT /clients/{id}/platforms/{pid}/tahap-fokus — set or clear the store's stage.
 *
 * Sent as `''` to clear, because that is what the blank `<option>` submits and
 * translating it here would hide the one state the field must be able to return
 * to. The server echoes what it stored, so the caller renders the truth rather
 * than its own optimism.
 */
export function setTahapFokus(clientId: string, platformId: number, tahap: string): Promise<{ tahap_fokus: string | null }> {
  return api.put<{ tahap_fokus: string | null }>(
    `/clients/${clientId}/platforms/${platformId}/tahap-fokus`, { tahap });
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
    tahap_narasi: insight.tahap_narasi,
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

// ---------------------------------------------------------------------------
// Shopee (Gelombang 2, SH-06) — browser-side reader + API client
// ---------------------------------------------------------------------------
/**
 * The 17 Shopee file slots, for the upload table's manual override.
 *
 * A UI-side copy of `@cdps/core` `SHOPEE_MODULE_LABEL` — `web-internal` is a
 * standalone Next app with no `@cdps/core` dependency, and these are LABELS,
 * not rules: the detection (`detectModule`) and every threshold stay
 * server-side. Same precedent as `ReportPanel`'s TikTok `TIPE_OVERRIDE_OPTIONS`.
 * The value strings must match `ShopeeModule` exactly — the server drops an
 * unknown `tipe_override` and falls back to detection, so a typo here would
 * silently ignore the AM's choice.
 */
export const SHOPEE_MODULE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'bisnis_home', label: 'Bisnis — Home' },
  { value: 'bisnis_produk', label: 'Bisnis — Produk' },
  { value: 'bisnis_live', label: 'Bisnis — Live' },
  { value: 'bisnis_kesehatan', label: 'Bisnis — Kesehatan Toko' },
  { value: 'bisnis_video', label: 'Bisnis — Shopee Video' },
  { value: 'ads_toko', label: 'Ads — Toko' },
  { value: 'ads_produk', label: 'Ads — Produk' },
  { value: 'ads_live', label: 'Ads — Live' },
  { value: 'ads_banner', label: 'Ads — Banner (Search Brand)' },
  { value: 'aff_product', label: 'Affiliate — Product' },
  { value: 'aff_creator', label: 'Affiliate — Creator' },
  { value: 'promo_diskon', label: 'Promo — Diskon' },
  { value: 'promo_voucher', label: 'Promo — Voucher' },
  { value: 'promo_flashsale', label: 'Promo — Flashsale' },
  { value: 'layanan_chat', label: 'Layanan — Chat' },
  { value: 'layanan_broadcast', label: 'Layanan — Broadcast' },
  { value: 'meta', label: 'Meta CPAS' },
];

/** Row emitted between worksheets so server parsers stop at their own table. */
const SHEET_MARK = '__SHEET__:';

/**
 * Parse ONE Shopee export the way the Shopee engine expects it.
 *
 * Two differences from `parseExportFile` (TikTok), both required by
 * `@cdps/core` `report/shopee`:
 *
 *  1. **Every worksheet is read, not just the first.** A single Shopee export
 *     bundles several tables across sheets, and `metrik.ts` needs all of them.
 *  2. **A `__SHEET__:name` marker row precedes each sheet.** Every
 *     section-scanning parser in `metrik.ts` breaks on `isSheetMarker`, which is
 *     what stops one sheet's table from being read into the next. The marker is
 *     emitted before EVERY sheet (the first included) so the shape does not
 *     depend on how many sheets the workbook happens to have; parsers locate
 *     their header by search, so a leading marker row is inert.
 *
 * The browser still does nothing but decode and hash — detection, scoring, and
 * every threshold stay server-side (PLAN §3 rule 4).
 */
export async function parseShopeeExportFile(file: File): Promise<ParsedExport> {
  const buf = await file.arrayBuffer();
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array' });
  const aoa: unknown[][] = [];
  for (const name of wb.SheetNames) {
    aoa.push([`${SHEET_MARK}${name}`]);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
      header: 1,
      raw: false,
      defval: '',
    });
    for (const r of rows) aoa.push(r as unknown[]);
  }
  return {
    filename: file.name,
    aoa,
    sha256: await sha256Hex(buf),
    ukuran_bytes: file.size,
  };
}

/** One active `Shopee Ads` campaign overlapping the report period (SH-06 split). */
export interface ShopeeAdsCampaignOption {
  id: string;
  objective: string;
  tipe_iklan: string;
  start_date: string;
  end_date: string;
  budget: string;
}

/**
 * GET /clients/{id}/reports/shopee/campaigns — the active `Shopee Ads`
 * campaigns whose dates overlap the period, i.e. exactly the set the report's
 * combined ads figure would be split across.
 *
 * Read-only, and deliberately the SAME server-side overlap predicate the
 * attribution itself uses (`findOverlappingShopeeAdsCampaigns`) — a UI-side
 * re-derivation of "which campaigns overlap" could show the AM a different
 * list from the one the split actually uses.
 */
export async function listShopeeAdsCampaigns(
  clientId: string, periodeMulai: string, periodeAkhir: string,
): Promise<ShopeeAdsCampaignOption[]> {
  const q = `periode_mulai=${encodeURIComponent(periodeMulai)}&periode_akhir=${encodeURIComponent(periodeAkhir)}`;
  const res = await api.get<{ data: ShopeeAdsCampaignOption[] }>(
    `/clients/${clientId}/reports/shopee/campaigns?${q}`,
  );
  return res.data;
}

/**
 * POST /clients/{id}/reports/shopee — build ONE Shopee report.
 *
 * Unlike TikTok, the period is never derived from the files: `periode`,
 * `periodeMulai` and `periodeAkhir` are all REQUIRED by the server
 * (`createReportShopee`), so the form asks for them outright instead of
 * offering them as an "only if unreadable" fallback.
 *
 * `excludeCampaignIds` removes a campaign from the even split of the report's
 * combined ads spend/omzet into Metric Entries (`MTR-`) — the "no manual
 * upload" path for M6D RM-C.
 */
export async function createClientReportShopee(
  clientId: string,
  input: {
    clientPlatformId: number;
    periodeTipe: PeriodeTipe;
    files: ParsedExport[];
    periode: string;
    periodeMulai: string;
    periodeAkhir: string;
    excludeCampaignIds?: string[];
  },
): Promise<ClientReportDetail> {
  return api.post<ClientReportDetail>(`/clients/${clientId}/reports/shopee`, {
    client_platform_id: input.clientPlatformId,
    periode_tipe: input.periodeTipe,
    files: input.files,
    periode: input.periode,
    periode_mulai: input.periodeMulai,
    periode_akhir: input.periodeAkhir,
    exclude_campaign_ids: input.excludeCampaignIds ?? [],
  });
}
