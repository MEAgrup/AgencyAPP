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
}

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
