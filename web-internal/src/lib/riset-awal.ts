/**
 * Riset Awal Baseline — the FE data layer (RAB-04/RAB-05).
 *
 * The ONLY step that runs in the browser is turning the uploaded xlsx binary into
 * rows (array-of-arrays) plus a sha256 fingerprint. The scoring engine, the file
 * detection, and every threshold live SERVER-SIDE in `@cdps/core` — web-internal
 * is a standalone Next app with no `@cdps/core`, and a second copy of the score
 * rules in the browser is exactly the drift the owner forbade (keputusan 4). So
 * this module parses, hashes, and POSTs; the server scores and persists.
 *
 * Wire shapes are snake_case (the API boundary); every optional field is present
 * (missing keys blank a page even on a 200). Mirrors `interview.ts`.
 */
import { api } from './api';

// ---------------------------------------------------------------------------
// Wire types (snake_case) — mirror apps/api `risetAwalBaselineToWire`.
// ---------------------------------------------------------------------------
export interface RisetAwalAnalisa {
  id: number;
  client_platform_id: number;
  platform: string;
  metode_baseline: 'analisa_penuh' | 'analisa_tipis' | 'manual';
  kondisi_toko: string;
  skor: number | null;
  benchmark_versi: number | null;
  parser_versi: string | null;
  cakupan_riwayat: string | null;
  created_at: string;
}

export interface RisetAwalIsian {
  section: string;
  field_key: string;
  sumber: string;
  nilai_teks: string | null;
  nilai_angka: number | null;
  nilai_uang: string | null;
  nilai_usulan: unknown;
  dikonfirmasi: boolean;
}

/** One active client_platforms row → one sub-section in the panel (RAB-04). */
export interface RisetAwalPlatform {
  client_platform_id: number;
  platform: string;
  metode: 'analisa_penuh' | 'analisa_tipis' | 'manual';
  store_link: string | null;
}

export interface RisetAwalBaseline {
  interview_id: string;
  platforms: RisetAwalPlatform[];
  analisa: RisetAwalAnalisa[];
  isian: RisetAwalIsian[];
  semua_terkonfirmasi: boolean;
}

/** One export file, parsed to rows in the browser, ready to POST. */
export interface ParsedExport {
  filename: string;
  aoa: unknown[][];
  sha256: string;
  ukuran_bytes: number;
  tipe_override?: string | null;
  tanggal_ambil?: string | null;
}

/** The AM-entered 6-month GMV history row (flags are the AM's). */
export interface HistRowWire {
  key: string;
  label: string;
  gmv: string | number;
  order: string | number;
  flag: 'normal' | 'campaign' | 'belum' | 'masalah';
}

export interface ManualBaselineWire {
  gmv_bulan: number | null;
  order: number | null;
  aov: number | null;
  sku_total: number | null;
  belanja_iklan: number | null;
  roas: number | null;
  periode_mulai?: string | null;
  periode_akhir?: string | null;
  tanggal_ambil?: string | null;
}

export interface ConfirmIsianItemWire {
  section: string;
  field_key: string;
  nilai_teks?: string | null;
  nilai_angka?: number | null;
  nilai_uang?: string | null;
  dikonfirmasi: boolean;
}

// ---------------------------------------------------------------------------
// Browser-only adapter: xlsx binary → rows + sha256
// ---------------------------------------------------------------------------
/** SHA-256 of the raw bytes (provenance identity; the server stores no binary). */
async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Parse ONE uploaded workbook into the shape the API expects. Reads the FIRST
 * sheet as array-of-arrays (header:1) — exactly what the server's `readSheet`
 * consumes. The heavy xlsx dependency is loaded lazily so it never enters the
 * initial bundle of pages that don't touch Riset Awal.
 */
export async function parseExportFile(file: File): Promise<ParsedExport> {
  const buf = await file.arrayBuffer();
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array' });
  const first = wb.SheetNames[0];
  const ws = wb.Sheets[first];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '' });
  return {
    filename: file.name,
    aoa: aoa as unknown[][],
    sha256: await sha256Hex(buf),
    ukuran_bytes: file.size,
  };
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------
/** GET /interview/{id}/baseline — every platform's baseline + auto-filled fields. */
export function getRisetAwalBaseline(id: string): Promise<RisetAwalBaseline> {
  return api.get<RisetAwalBaseline>(`/interview/${id}/baseline`);
}

/**
 * POST /interview/{id}/baseline — submit ONE TikTok Shop platform's baseline. The
 * server detects each file, runs the engine, and derives the auto-filled fields
 * (RAB-05). An ambiguous own-vs-affiliate file comes back as a `[...]` error until
 * the AM sets `tipe_override` on it.
 */
export function submitBaselineAnalisa(
  id: string,
  clientPlatformId: number,
  files: ParsedExport[],
  hist: HistRowWire[],
  opts: { net?: boolean; linkedAccounts?: string[] } = {},
): Promise<RisetAwalBaseline> {
  return api.post<RisetAwalBaseline>(`/interview/${id}/baseline`, {
    client_platform_id: clientPlatformId,
    analisa: { files, hist, net: opts.net ?? true, linked_accounts: opts.linkedAccounts ?? [] },
  });
}

/** POST /interview/{id}/baseline — submit a non-TikTok platform's minimal manual entry. */
export function submitBaselineManual(
  id: string,
  clientPlatformId: number,
  manual: ManualBaselineWire,
): Promise<RisetAwalBaseline> {
  return api.post<RisetAwalBaseline>(`/interview/${id}/baseline`, { client_platform_id: clientPlatformId, manual });
}

/** POST /interview/{id}/baseline/confirm — the AM confirms/corrects fields per number. */
export function confirmBaselineIsian(id: string, items: ConfirmIsianItemWire[]): Promise<RisetAwalBaseline> {
  return api.post<RisetAwalBaseline>(`/interview/${id}/baseline/confirm`, { items });
}
