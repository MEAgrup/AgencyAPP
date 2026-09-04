/**
 * MEA SKU Screener (Gelombang 3, SC-08) — FE data layer types.
 *
 * Consumed by `/ads/screening` (Modul A/B/C/D). The wire types below are also
 * what `apps/api/src/lib/shape-parity.test.ts` (O43c) watches: a field added to
 * the wire without being declared here is a field no page was ever designed to
 * read, caught mechanically instead of by a human diffing two files later.
 *
 * Wire shapes are snake_case (the API boundary) and mirror
 * `apps/api/src/lib/wire.ts` `screeningRun*ToWire` / `decisionLogEntryToWire`
 * / `trackerRowToWire` exactly.
 */
import { api } from './api';
import { sha256Hex } from './riset-awal';
import type { Role } from './types';

export interface ScreeningRunSummary {
  id: string;
  client_id: string;
  jenis: string;
  created_at: string;
  created_by: string;
}

export interface ScreeningRunDetail extends ScreeningRunSummary {
  target_roas: number | null;
  cpc_pasar_kategori: number | null;
  faktor_cr_iklan: number | null;
  min_klik_sesudah: number | null;
  /** Opaque — computed medians (Modul A) or matched pairs (Modul B). Only the render layer reads its shape. */
  payload: unknown;
  sumber_berkas: unknown;
}

export interface DecisionLogEntry {
  id: string;
  client_id: string;
  screening_id: string | null;
  advertiser_id: string;
  platform: string;
  object_type: string;
  object_name: string;
  momen: string;
  sop_stage: string;
  decision: string;
  metric_key: string;
  metric_value: number;
  metric_target: number;
  status_vs_target: string;
  spend_7d: number | null;
  gmv_7d: number | null;
  roas_result: number | null;
  verdict: string | null;
  reviews_decision_id: string | null;
  premature: boolean;
  notes: string | null;
  created_at: string;
  created_by: string;
}

export interface TrackerMetrics {
  views: number;
  clicks: number;
  ctr: number;
  cr: number;
  orders: number;
}

export interface TrackerRow {
  screening_id: string;
  product_code: string;
  product_name: string;
  client_id: string;
  change_date: string;
  initial_route: string;
  change_type: string;
  metric_evaluated: string;
  before: TrackerMetrics;
  after: TrackerMetrics | null;
  delta_ctr_pct: number | null;
  delta_cr_pct: number | null;
  delta_metric_pct: number | null;
  verdict: string;
  budget_decision: string | null;
  notes: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Payload readers.
//
// `payload` crosses the wire as `unknown` on purpose (the domain calls it
// "opaque — only the render layer reads its shape"). These are that render
// layer. They are FE-only view types, NOT wire contracts: the payload is
// written by `@cdps/core` and is versioned by its own `schema` string, so the
// reader checks that string and refuses anything else rather than guessing at
// fields. A future `…v2` then fails loudly here instead of rendering blanks.
// ---------------------------------------------------------------------------
export const SCHEMA_SCREENING = 'cdps.skuscreener.screening.v1';
export const SCHEMA_PERBANDINGAN = 'cdps.skuscreener.perbandingan.v1';

export interface ScreeningMedians {
  ctr: number;
  cr: number;
  views: number;
  ctrRaw: number;
  crRaw: number;
  ctrThreshold: number;
  crThreshold: number;
  ctrSampleSize: number;
  crSampleSize: number;
  ctrReachedFloor: boolean;
  crReachedFloor: boolean;
}

export interface ScreeningSku {
  kode: string;
  produk: string;
  gmv: number;
  orders: number;
  views: number;
  clicks: number;
  ctr: number | null;
  cr: number | null;
  aov: number | null;
  baseRoute: string;
  label: string;
  isAntiRule: boolean;
  isTahanCpcRendah: boolean;
  cpcMax: number | null;
  marketCpcRatio: number | null;
  marketCpcVerdict: string | null;
}

export interface ScreeningPayload {
  schema: string;
  medians: ScreeningMedians;
  cpcAktual: number | null;
  targetRoas: number;
  faktorCrIklan: number;
  cpcPasarKategori: number | null;
  ringkasan: Record<string, number>;
  skus: ScreeningSku[];
}

export interface ComparePairMetrics {
  views: number;
  clicks: number;
  ctr: number | null;
  cr: number | null;
  orders: number;
  gmv: number;
}

export interface ComparePair {
  kode: string;
  produk: string;
  before: ComparePairMetrics;
  after: ComparePairMetrics;
  deltaCtrPct: number | null;
  deltaCrPct: number | null;
  deltaViewsPct: number | null;
  deltaGmvPct: number | null;
  verdict: string;
  rekomendasi: string | null;
}

export interface ComparePayload {
  schema: string;
  minKlikSesudah: number;
  ringkasan: Record<string, number>;
  pairs: ComparePair[];
}

function payloadSchema(payload: unknown): string {
  return payload && typeof payload === 'object' ? String((payload as { schema?: unknown }).schema ?? '') : '';
}

/** The Modul A payload, or null when this run is not a `screening` v1 run. */
export function readScreeningPayload(payload: unknown): ScreeningPayload | null {
  return payloadSchema(payload) === SCHEMA_SCREENING ? (payload as ScreeningPayload) : null;
}

/** The Modul B payload, or null when this run is not a `perbandingan` v1 run. */
export function readComparePayload(payload: unknown): ComparePayload | null {
  return payloadSchema(payload) === SCHEMA_PERBANDINGAN ? (payload as ComparePayload) : null;
}

// ---------------------------------------------------------------------------
// Vocabularies — every list here must match the server's `VALID_*` set in
// `packages/domain/src/skuscreener.ts` EXACTLY. They are enumerations the
// server rejects outside of, so a value missing here is a decision the
// advertiser cannot record, and an extra one is a form that submits a 400.
// ---------------------------------------------------------------------------
export const PLATFORM_OPTIONS = ['Shopee', 'TikTok', 'Meta', 'Google'] as const;
export const OBJECT_TYPE_OPTIONS = ['SKU', 'Kampanye', 'Kreator', 'Konten'] as const;
/** `momen` values are stored codes, not labels — hence the pair list. */
export const MOMEN_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'masuk_iklan', label: 'Masuk iklan' },
  { value: 'mulai_test', label: 'Mulai test' },
  { value: 'scale_turun_kill', label: 'Scale / turun / kill' },
  { value: 'jeda_restart', label: 'Jeda / restart' },
  { value: 'review_7_hari', label: 'Review 7 hari (follow-up)' },
];
export const MOMEN_REVIEW = 'review_7_hari';
export const SOP_STAGE_OPTIONS = [
  '1-Screening SKU', '2-Setup Test', '3-Evaluasi', '4-Scale', '5-Kill',
] as const;
export const DECISION_OPTIONS = [
  'Loloskan ke iklan', 'Tolak', 'Mulai test', 'Naikkan budget', 'Turunkan budget',
  'Ubah target ROAS', 'Ganti kreatif', 'Pause', 'Biarkan', 'Eskalasi ke lead',
] as const;
export const METRIC_KEY_OPTIONS = [
  'ROAS', 'ACOS', 'CTR', 'CR', 'GMV', 'Biaya per konversi', 'Pesanan', 'Views',
] as const;
export const VERDICT_OPTIONS = ['Berhasil', 'Gagal', 'Belum cukup data'] as const;
export const INITIAL_ROUTE_OPTIONS = [
  'SCALE', 'KANDIDAT IKLAN', 'OPTIMASI GAMBAR/JUDUL', 'OPTIMASI DESKRIPSI/HARGA', 'PARKIR',
] as const;
/** R12's 10 change types. The first four are judged on CTR, the rest on CR — the server decides which, never the form. */
export const CHANGE_TYPE_OPTIONS = [
  'Gambar utama', 'Judul produk', 'Video produk', 'Thumbnail & badge',
  'Deskripsi', 'Foto detail & ukuran', 'Harga', 'Voucher/promo',
  'Bundling/minimum belanja', 'Dorong ulasan',
] as const;

/** The shipped tool's default (`DEFAULT_TARGET_ROAS` in `@cdps/core`), not the PRD's 3,57 — see DECISIONS O66. */
export const DEFAULT_TARGET_ROAS = 4;
/** R10's "sesudah" click floor, the server's own default when the field is left blank. */
export const DEFAULT_MIN_KLIK_SESUDAH = 20;

// ---------------------------------------------------------------------------
// Browser-only adapter: workbook → named sheets (+ sha256)
// ---------------------------------------------------------------------------
/** One export read in the browser, ready to POST. `sheets` keeps the sheet NAMES because the server picks the "Performa Produk" sheet by name (A02). */
export interface ParsedSkuExport {
  filename: string;
  sha256: string;
  ukuran_bytes: number;
  sheets: Array<{ name: string; aoa: unknown[][] }>;
}

/**
 * Read a "Bisnis Saya → Performa Produk" export into NAMED sheets.
 *
 * Unlike the report readers, this one must not flatten the workbook: the server
 * picks the performa sheet BY NAME (`pickPerformaSheet`, A02) and only falls
 * back to the first sheet when no name contains "performa". Concatenating (or
 * dropping) sheets here would take that choice away from the server.
 *
 * The browser still only decodes and hashes — every rule R01-R16 stays in
 * `@cdps/core` server-side.
 */
export async function parseSkuWorkbook(file: File): Promise<ParsedSkuExport> {
  const buf = await file.arrayBuffer();
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array' });
  return {
    filename: file.name,
    sha256: await sha256Hex(buf),
    ukuran_bytes: file.size,
    sheets: wb.SheetNames.map((name) => ({
      name,
      aoa: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
        header: 1, raw: false, defval: '',
      }) as unknown[][],
    })),
  };
}

/**
 * Read the optional "Laporan Iklan Produk/CPC" export into rows.
 *
 * Only the FIRST sheet: the server searches the first 20 rows for the header
 * carrying both "Biaya" and "Jumlah Klik" (`readAdsCpc`), which is a
 * single-table read — there is no second sheet for it to consider.
 */
export async function parseSkuCsvRows(file: File): Promise<{
  filename: string;
  sha256: string;
  ukuran_bytes: number;
  rows: unknown[][];
}> {
  const buf = await file.arrayBuffer();
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array' });
  const first = wb.SheetNames[0];
  return {
    filename: file.name,
    sha256: await sha256Hex(buf),
    ukuran_bytes: file.size,
    rows: first
      ? (XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[first], {
          header: 1, raw: false, defval: '',
        }) as unknown[][])
      : [],
  };
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------
/** One `sumber_berkas` provenance entry — what the run records about its inputs. */
export interface BerkasProvenance {
  nama_berkas: string;
  sha256: string;
  ukuran_bytes: number;
  /** 'performa_produk' | 'iklan_cpc' (Modul A) or 'sebelum' | 'sesudah' (Modul B). */
  peran: string;
}

/** POST /clients/{id}/skuscreener/screening — Modul A. */
export function runScreening(
  clientId: string,
  input: {
    sheets: Array<{ name: string; aoa: unknown[][] }>;
    adsCsvRows?: unknown[][] | null;
    targetRoas: number;
    cpcPasarKategori?: number | null;
    faktorCrIklan?: number;
    berkas: BerkasProvenance[];
  },
): Promise<ScreeningRunDetail> {
  return api.post<ScreeningRunDetail>(`/clients/${clientId}/skuscreener/screening`, {
    sheets: input.sheets,
    ads_csv_rows: input.adsCsvRows ?? null,
    target_roas: input.targetRoas,
    cpc_pasar_kategori: input.cpcPasarKategori ?? null,
    faktor_cr_iklan: input.faktorCrIklan,
    berkas: input.berkas,
  });
}

/** POST /clients/{id}/skuscreener/compare — Modul B. */
export function runCompare(
  clientId: string,
  input: {
    sheetsSebelum: Array<{ name: string; aoa: unknown[][] }>;
    sheetsSesudah: Array<{ name: string; aoa: unknown[][] }>;
    minKlikSesudah?: number;
    berkas: BerkasProvenance[];
  },
): Promise<ScreeningRunDetail> {
  return api.post<ScreeningRunDetail>(`/clients/${clientId}/skuscreener/compare`, {
    sheets_sebelum: input.sheetsSebelum,
    sheets_sesudah: input.sheetsSesudah,
    min_klik_sesudah: input.minKlikSesudah,
    berkas: input.berkas,
  });
}

/** GET /clients/{id}/skuscreener/runs — newest first; `jenis` filters. */
export async function listScreeningRuns(
  clientId: string, jenis?: 'screening' | 'perbandingan',
): Promise<ScreeningRunSummary[]> {
  const q = jenis ? `?jenis=${jenis}` : '';
  const res = await api.get<{ data: ScreeningRunSummary[] }>(`/clients/${clientId}/skuscreener/runs${q}`);
  return res.data;
}

/** GET /skuscreener/runs/{id} — full run (payload + provenance). */
export function getScreeningRun(id: string): Promise<ScreeningRunDetail> {
  return api.get<ScreeningRunDetail>(`/skuscreener/runs/${id}`);
}

/** GET /clients/{id}/skuscreener/decisions — Modul C log, newest first. */
export async function listDecisions(clientId: string): Promise<DecisionLogEntry[]> {
  const res = await api.get<{ data: DecisionLogEntry[] }>(`/clients/${clientId}/skuscreener/decisions`);
  return res.data;
}

/**
 * POST /clients/{id}/skuscreener/decisions — append ONE decision (Modul C).
 *
 * Append-only by design: there is no PATCH or DELETE for an `ADL-` row, so a
 * correction is a NEW row, never an edit. `status_vs_target`, the `PREMATUR`
 * flag (R14) and `roas_result` are all computed server-side — the form never
 * sends them.
 */
export function logDecision(
  clientId: string,
  input: {
    screeningId?: string | null;
    advertiserId?: string | null;
    platform: string;
    objectType: string;
    objectName: string;
    momen: string;
    sopStage: string;
    decision: string;
    metricKey: string;
    metricValue: number;
    metricTarget: number;
    spend7d?: number | null;
    gmv7d?: number | null;
    verdict?: string | null;
    reviewsDecisionId?: string | null;
    dataPendukung?: { klik: number; konversi: number; hariJalan: number } | null;
    notes?: string | null;
  },
): Promise<DecisionLogEntry> {
  return api.post<DecisionLogEntry>(`/clients/${clientId}/skuscreener/decisions`, {
    screening_id: input.screeningId ?? null,
    advertiser_id: input.advertiserId ?? null,
    platform: input.platform,
    object_type: input.objectType,
    object_name: input.objectName,
    momen: input.momen,
    sop_stage: input.sopStage,
    decision: input.decision,
    metric_key: input.metricKey,
    metric_value: input.metricValue,
    metric_target: input.metricTarget,
    spend_7d: input.spend7d ?? null,
    gmv_7d: input.gmv7d ?? null,
    verdict: input.verdict ?? null,
    reviews_decision_id: input.reviewsDecisionId ?? null,
    data_pendukung: input.dataPendukung
      ? {
          klik: input.dataPendukung.klik,
          konversi: input.dataPendukung.konversi,
          hari_jalan: input.dataPendukung.hariJalan,
        }
      : null,
    notes: input.notes ?? null,
  });
}

/** GET /skuscreener/runs/{id}/tracker — Modul D rows of one run. */
export async function listTrackerRows(screeningId: string): Promise<TrackerRow[]> {
  const res = await api.get<{ data: TrackerRow[] }>(`/skuscreener/runs/${screeningId}/tracker`);
  return res.data;
}

/** POST /skuscreener/runs/{id}/tracker — D1/D2: open one row with `before` only. */
export function createTrackerRow(
  screeningId: string,
  input: {
    clientId: string;
    productCode?: string | null;
    productName: string;
    changeDate: string;
    initialRoute: string;
    changeType: string;
    before: TrackerMetrics;
    notes?: string | null;
  },
): Promise<TrackerRow> {
  return api.post<TrackerRow>(`/skuscreener/runs/${screeningId}/tracker`, {
    client_id: input.clientId,
    product_code: input.productCode ?? null,
    product_name: input.productName,
    change_date: input.changeDate,
    initial_route: input.initialRoute,
    change_type: input.changeType,
    before: input.before,
    notes: input.notes ?? null,
  });
}

/**
 * POST /skuscreener/runs/{id}/tracker/{productCode}/after — D3/D4.
 *
 * The delta and the verdict come back computed (R12): which metric is judged
 * follows from the change type recorded at D1, so filling "sesudah" cannot
 * change what the row is measuring.
 */
export function recordTrackerAfter(
  screeningId: string,
  productCode: string,
  input: { after: TrackerMetrics; minKlikSesudah?: number; budgetDecision?: string | null },
): Promise<TrackerRow> {
  return api.post<TrackerRow>(
    `/skuscreener/runs/${screeningId}/tracker/${encodeURIComponent(productCode)}/after`,
    {
      after: input.after,
      min_klik_sesudah: input.minKlikSesudah,
      budget_decision: input.budgetDecision ?? null,
    },
  );
}

// ---------------------------------------------------------------------------
// UI access gate
// ---------------------------------------------------------------------------
/**
 * Can this role open `/ads/screening` at all?
 *
 * Mirrors the two server gates the page sits on, unioned, because the page both
 * reads and writes:
 *
 *  - write (`skuscreener.canWriteSku` → `ads.canManageCampaign`): Ads staff or
 *    Ads lead, or Director;
 *  - read (`skuscreener.canReadSku`): additionally OD (read-everywhere, Role
 *    Matrix §4) — an OD must be able to inspect a screening they cannot create.
 *
 * Everything narrower than that — WHICH runs a role sees — is row scope and
 * stays RLS's job; a second copy of a row predicate in the UI could only drift
 * from it (`nav.ts` header note). An empty list is the honest answer there.
 *
 * The single source of truth for both the page guard and the nav gate. One
 * predicate, no drift — the same posture `embedded-tools.ts` takes.
 */
export function canUseSkuScreener(role: Role | null): boolean {
  if (!role) return false;
  if (role.director || role.od) return true;
  return role.division.toLowerCase() === 'ads' && (role.level === 'staff' || role.level === 'lead');
}

/** Can this role WRITE (run a screening, log a decision, open a tracker row)? Mirrors `canWriteSku` exactly — OD is read-only. */
export function canWriteSkuScreener(role: Role | null): boolean {
  if (!role) return false;
  if (role.director) return true;
  if (role.od) return false;
  return role.division.toLowerCase() === 'ads' && (role.level === 'staff' || role.level === 'lead');
}
