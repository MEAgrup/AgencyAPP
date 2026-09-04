/**
 * TikTok Ads Scanner (Gelombang 4, AS-01..AS-04) — FE data layer types.
 *
 * The wire types below are what `apps/api/src/lib/shape-parity.test.ts` (O43c)
 * watches: a field added to the wire without being declared here is a field no
 * page was ever designed to read, caught mechanically instead of by a human
 * diffing two files later.
 *
 * Wire shapes are snake_case (the API boundary) and mirror
 * `apps/api/src/lib/wire.ts` `adsScanRun*ToWire` / `adsScanPortfolioRowToWire`
 * exactly.
 *
 * No page consumes this yet — same "engine+domain+rute dulu, UI menyusul"
 * staging Gelombang 2 (SH-01..SH-05 before SH-07) and Gelombang 3 (SC-08
 * before SC-09) went through.
 */
import { api } from './api';
import { sha256Hex } from './riset-awal';
import type { Role } from './types';

export interface AdsScanRunSummary {
  id: string;
  client_id: string;
  kategori: string;
  mode: string;
  minggu_mulai: string | null;
  benchmark_versi: number;
  created_at: string;
  created_by: string;
}

export interface AdsScanRunDetail extends AdsScanRunSummary {
  payload_schema: string;
  /** The `AdsScannerConfig` the scan actually ran with (defaults merged with the AM's overrides). */
  konfigurasi: unknown;
  /** Opaque `cdps.adsscanner.tiktok.v1` — ringkasan/sku/orphan/realokasi/angles/winners. Only the render layer reads its shape, through `@cdps/core`'s own exported types. */
  payload: unknown;
  sumber_berkas: unknown;
}

/** One row of the cross-client portfolio: a client's LATEST scan plus rollups read from its frozen payload. */
export interface AdsScanPortfolioRow extends AdsScanRunSummary {
  client_toko: string | null;
  client_nama_pic: string | null;
  vonis: string | null;
  total_gmv: number | null;
  total_spend: number | null;
  /** null when the scan had zero ad spend — render `—`, never `0x` (house rule #7). */
  blended_roi: number | null;
  pool_realokasi: number | null;
  sku_total: number | null;
}

// ---------------------------------------------------------------------------
// Payload readers — the interior of the opaque `payload`, typed for rendering.
//
// These are NOT wire types (the wire declares `payload: unknown`, deliberately
// — see `wire.ts`): they are a narrowed VIEW of the `cdps.adsscanner.tiktok.v1`
// jsonb, covering only the fields the pages actually draw. The engine owns the
// full shape in `@cdps/core`; anything not listed here is simply not rendered.
//
// ⚠️ UNITS. `ctr`/`ctor`/`crVv`/etc. in this payload are FRACTIONS (`0.05`
// means 5%), because the engine's cell parser turns a `"5%"` cell into `0.05`
// (`baseline/angka.ts:n` divides by 100 when it sees `%`). That is the OPPOSITE
// of the SKU Screener payload, whose `ctr`/`cr` are percent-NUMBERS (`2.0`
// means 2%). Rendering either with the other's formatter is off by 100×, so the
// two pages deliberately have separate formatters — see `adsscanner-ui.ts`.
// ---------------------------------------------------------------------------
export const ADSSCANNER_SCHEMA = 'cdps.adsscanner.tiktok.v1';

/** One SKU's row as stored (subset — the engine's `SkuResult` has ~40 fields). */
export interface AdsScanSku {
  pid: string;
  pidFull: string;
  nama: string;
  status: string;
  gmv: number;
  pesanan: number;
  /** null when there were no orders — no basis, render `—`. */
  aov: number | null;
  /** FRACTION. null when there were no impressions. */
  ctr: number | null;
  /** FRACTION. null when there were no clicks. */
  ctor: number | null;
  impresi: number;
  klik: number;
  adCost: number;
  adRev: number;
  adOrders: number;
  adCreatives: number;
  konten: number;
  /** null when there was no ad spend. */
  roi: number | null;
  /** null when there were no ad orders. */
  cpa: number | null;
  /** FRACTION share of GMV from creators; null when GMV is 0. */
  gmvKreatorPct: number | null;
  gate: string;
  blockers: string[];
  skor: number;
  skorRinci: { konten: number; gmv: number; efisiensi: number; ctr: number; ctor: number };
  diagnosa: string;
  bucket: string;
  aksi: string;
  budgetHarian: number;
}

/** Ad spend landing on a product absent from Analitik Produk ("SKU mati"). */
export interface AdsScanOrphan {
  pid: string;
  cost: number;
  rev: number;
  creatives: number;
  kampanye: string[];
}

export interface AdsScanRealokasiRow {
  pid: string;
  nama: string;
  bucket: string;
  skor: number;
  tambahan: number;
}

export interface AdsScanAngleRow {
  angle: string;
  jumlah: number;
  menang: number;
  /** FRACTION. */
  winRate: number;
  gpmMedian: number;
  gmv: number;
  vv: number;
  lolosBenchmark: boolean;
}

/** Account-level rollup. Every ratio is null, never 0, when its denominator is 0. */
export interface AdsScanRingkasan {
  kategori: string;
  benchmark: { roi: number | null; tr: number | null; gpm: number | null };
  skuTotal: number;
  skuAktifGmv: number;
  skuSiap: number;
  skuKering: number;
  totalGmv: number;
  totalSpend: number;
  totalRev: number;
  blendedRoi: number | null;
  /** FRACTION of spend going to content-dry SKUs; null when there was no spend. */
  pctSpendKering: number | null;
  pctSpendKuat: number | null;
  orphanSpend: number;
  orphanSku: number;
  kontenKreator: number;
  kontenToko: number;
  kreatorUnik: number;
  videoBerGmvPct: number | null;
  poolRealokasi: number;
  medCtr: number;
  medCtor: number;
}

export interface AdsScanPayload {
  schema: string;
  generated_at: string;
  klien: { nama: string | null; account_manager: string | null; kategori: string; periode_minggu: string | null; minggu_mulai: string | null };
  benchmark_versi: number | null;
  benchmark_kategori: { roi: number | null; tr: number | null; gpm: number | null };
  gpm_benchmark_rupiah: number;
  ringkasan: AdsScanRingkasan;
  flags: string[];
  vonis: { label: string; cls: string };
  sku: AdsScanSku[];
  orphan: AdsScanOrphan[];
  realokasi: { pool: number; rows: AdsScanRealokasiRow[] };
  angles: { kreator: AdsScanAngleRow[]; toko: AdsScanAngleRow[] };
  kelengkapan_file: Partial<Record<string, boolean>>;
}

/** The scan payload, or null when the row is not a `cdps.adsscanner.tiktok.v1` one. */
export function readAdsScanPayload(payload: unknown): AdsScanPayload | null {
  const schema = payload && typeof payload === 'object' ? String((payload as { schema?: unknown }).schema ?? '') : '';
  return schema === ADSSCANNER_SCHEMA ? (payload as AdsScanPayload) : null;
}

/** One entry of `sumber_berkas`, as the server wrote it. */
export interface AdsScanBerkas {
  nama_berkas: string;
  sha256: string;
  ukuran_bytes: number;
  /** The detected slot, or null when nothing recognised the file. */
  peran: string | null;
  video_kind?: string;
  /** True when the video kind came from the fallback heuristic — offer the AM a swap. */
  video_kind_ambigu?: boolean;
  baris: number;
}

export function readAdsScanBerkas(v: unknown): AdsScanBerkas[] {
  return Array.isArray(v) ? (v as AdsScanBerkas[]) : [];
}

/** The stored `AdsScannerConfig`, or null. Read for display (which thresholds this scan ran with). */
export function readAdsScanCfg(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

/** One decoded upload, ready to POST. `aoa` is the raw sheet — the SERVER decides which of the 4 slots it is. */
export interface ParsedAdsScanExport {
  nama_berkas: string;
  sha256: string;
  ukuran_bytes: number;
  aoa: unknown[][];
}

/**
 * Decode one TikTok Shop export in the browser and hash it (RAB-04: the server
 * never sees the binary, only the rows + provenance).
 *
 * Sends the FIRST sheet only, and that is deliberate — unlike
 * `parseSkuWorkbook` (Gelombang 3), which forwards every sheet WITH its name
 * because the server picks the performance sheet by name (A02). These four
 * exports are single-sheet downloads whose type is decided by an exact header
 * ROW (`FILE_SIGS`: analitik row 3, ads row 0, video row 2, adslive row 0), so
 * there is no name for the server to choose by — the row index is the signal,
 * and it only means anything within one sheet's own array-of-arrays.
 *
 * `raw: false` keeps every cell as its DISPLAYED string, which is what the
 * engine's parsers expect (`toNum` handles "Rp13.473.176"/"5,37%"), and
 * `defval: ''` keeps blank cells as positional placeholders so a header
 * column never silently shifts onto the wrong values.
 */
export async function parseAdsScanExport(file: File): Promise<ParsedAdsScanExport> {
  const buf = await file.arrayBuffer();
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array' });
  const first = wb.SheetNames[0];
  return {
    nama_berkas: file.name,
    sha256: await sha256Hex(buf),
    ukuran_bytes: file.size,
    aoa: first
      ? (XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[first], { header: 1, raw: false, defval: '' }) as unknown[][])
      : [],
  };
}

/** AM-tunable thresholds; anything omitted keeps the engine default (`DEFAULT_ADS_SCANNER_CFG`). */
export interface AdsScanCfgInput {
  gateScale?: number;
  gateConsider?: number;
  gateYellow?: number;
  testBudgetDaily?: number;
  scaleStepPct?: number;
  minAov?: number;
  blacklist?: string[];
  usdRate?: number;
  winnerPctl?: number;
}

export interface RunAdsScanInput {
  kategori: string;
  mode?: 'weekly' | 'newclient';
  /** ISO date anywhere in the data week; the server Monday-aligns it. */
  mingguMulai?: string | null;
  cfg?: AdsScanCfgInput;
  files: (ParsedAdsScanExport & {
    /** Force a slot when detection would misfile it. */
    tipe_override?: string | null;
    /** Force a video sheet's kind — the auto guess can be ambiguous. */
    video_kind_override?: 'kreator' | 'toko' | null;
  })[];
}

/** POST /clients/{id}/adsscanner/scan — run and store one weekly scan. */
export function runAdsScan(clientId: string, input: RunAdsScanInput): Promise<AdsScanRunDetail> {
  return api.post<AdsScanRunDetail>(`/clients/${clientId}/adsscanner/scan`, {
    kategori: input.kategori,
    mode: input.mode,
    minggu_mulai: input.mingguMulai ?? null,
    cfg: input.cfg
      ? {
          gate_scale: input.cfg.gateScale,
          gate_consider: input.cfg.gateConsider,
          gate_yellow: input.cfg.gateYellow,
          test_budget_daily: input.cfg.testBudgetDaily,
          scale_step_pct: input.cfg.scaleStepPct,
          min_aov: input.cfg.minAov,
          blacklist: input.cfg.blacklist,
          usd_rate: input.cfg.usdRate,
          winner_pctl: input.cfg.winnerPctl,
        }
      : null,
    files: input.files.map((f) => ({
      nama_berkas: f.nama_berkas,
      sha256: f.sha256,
      ukuran_bytes: f.ukuran_bytes,
      aoa: f.aoa,
      tipe_override: f.tipe_override ?? null,
      video_kind_override: f.video_kind_override ?? null,
    })),
  });
}

/** GET /clients/{id}/adsscanner/runs — one client's scan history, newest first. */
export async function listAdsScanRuns(clientId: string): Promise<AdsScanRunSummary[]> {
  const res = await api.get<{ data: AdsScanRunSummary[] }>(`/clients/${clientId}/adsscanner/runs`);
  return res.data;
}

/** GET /adsscanner/runs/{id} — one stored scan in full. */
export function getAdsScanRun(id: string): Promise<AdsScanRunDetail> {
  return api.get<AdsScanRunDetail>(`/adsscanner/runs/${encodeURIComponent(id)}`);
}

/** GET /adsscanner/portfolio — each client's latest scan (the cross-client view). */
export async function adsScanPortfolio(): Promise<AdsScanPortfolioRow[]> {
  const res = await api.get<{ data: AdsScanPortfolioRow[] }>('/adsscanner/portfolio');
  return res.data;
}

/** GET /adsscanner/categories — the categories the ACTIVE benchmark carries (never the compiled-in constant). */
export async function adsScanCategories(): Promise<string[]> {
  const res = await api.get<{ data: string[] }>('/adsscanner/categories');
  return res.data;
}

/**
 * The URL of a scan's rendered HTML — for a new tab or an iframe.
 *
 * Returns the FULL same-origin path including `/api/v1`, matching
 * `report.ts:reportHtmlUrl`: this is a browser-navigable URL, not an `api.*`
 * path, so the prefix belongs here rather than at each call site where it could
 * be forgotten. Auth rides on the session cookie (`api.ts` uses
 * `credentials: 'include'` and sets no Authorization header), so a plain
 * anchor to this URL is authenticated like any other request.
 */
export function adsScanHtmlUrl(id: string): string {
  return `/api/v1/adsscanner/runs/${encodeURIComponent(id)}/html`;
}

// ---------------------------------------------------------------------------
// UI access gate
// ---------------------------------------------------------------------------
/**
 * Can this role open the Ads Scanner at all?
 *
 * Identical posture to `skuscreener.canUseSkuScreener`, and for the same
 * reason: the union of the two server gates, because the surface both reads
 * and writes.
 *
 *  - write (`adsscanner.canWriteAdsScan` → `ads.canManageCampaign`): Ads staff
 *    or Ads lead, or Director;
 *  - read (`adsscanner.canReadAdsScan`): additionally OD (read-everywhere,
 *    Role Matrix §4) — an OD must be able to inspect a scan they cannot create.
 *
 * WHICH scans a role sees is row scope and stays the server's job; a second
 * copy of a row predicate in the UI could only drift from it. An empty
 * portfolio is the honest answer there.
 */
export function canUseAdsScanner(role: Role | null): boolean {
  if (!role) return false;
  if (role.director || role.od) return true;
  return role.division.toLowerCase() === 'ads' && (role.level === 'staff' || role.level === 'lead');
}

/** Can this role RUN a scan? Mirrors `canWriteAdsScan` exactly — OD is read-only. */
export function canRunAdsScan(role: Role | null): boolean {
  if (!role) return false;
  if (role.director) return true;
  if (role.od) return false;
  return role.division.toLowerCase() === 'ads' && (role.level === 'staff' || role.level === 'lead');
}
