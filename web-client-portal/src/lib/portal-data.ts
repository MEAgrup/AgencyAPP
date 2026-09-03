/**
 * Client Portal data layer — the four allow-listed surfaces (M15-C2).
 *
 * Every call is scoped by the SESSION, not by an argument: no function here
 * takes a client id, because the server resolves it from the contact's JWT and
 * would ignore one anyway (spec §4.3). `reportHtmlUrl` is the one exception in
 * shape — it takes a report id, which the server validates against the session's
 * client before returning anything.
 *
 * DTOs live in `./types` so `apps/api`'s shape-parity guard can pair them with
 * the wire types; a drift fails a test in `apps/api/src/lib/shape-parity.test.ts`.
 */
import { api } from './api';
import {
  type PortalComplaintAck,
  type PortalHealthSummary,
  type PortalReportRow,
  type PortalServiceProgress,
} from './types';

/** GET /client-portal/reports — published reports, newest period first. */
export function getReports(): Promise<PortalReportRow[]> {
  return api.get<PortalReportRow[]>('/client-portal/reports');
}

/** GET /client-portal/service-progress — one row per active service. */
export function getServiceProgress(): Promise<PortalServiceProgress[]> {
  return api.get<PortalServiceProgress[]>('/client-portal/service-progress');
}

/** GET /client-portal/health — the band LABEL only (M15 Rule 4). */
export function getHealthSummary(): Promise<PortalHealthSummary> {
  return api.get<PortalHealthSummary>('/client-portal/health');
}

/** POST /client-portal/complaints — submit only; there is no read counterpart. */
export function submitComplaint(input: {
  deskripsi: string;
  severity?: string | null;
  lampiran?: string | null;
}): Promise<PortalComplaintAck> {
  return api.post<PortalComplaintAck>('/client-portal/complaints', {
    deskripsi: input.deskripsi,
    severity: input.severity ?? null,
    lampiran: input.lampiran ?? null,
  });
}

/**
 * The report document's URL, framed SAME-ORIGIN by the report page.
 *
 * Never fetched as JSON — the response is a complete HTML document. Because it
 * is served from this very origin there is no cross-origin token to pass
 * (which is what the security spec left open as OQ-8, back when the report was
 * expected to come from a separate system).
 */
export function reportHtmlUrl(reportId: number): string {
  return `/api/v1/client-portal/reports/${reportId}/html`;
}

/** `2026-08-01` + `2026-08-31` → `1 – 31 Agustus 2026`. Falls back to the raw ISO pair. */
const BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export function labelPeriode(mulai: string, akhir: string): string {
  const a = mulai.split('-').map(Number);
  const b = akhir.split('-').map(Number);
  if (a.length !== 3 || b.length !== 3 || a.some(Number.isNaN) || b.some(Number.isNaN)) {
    return `${mulai} – ${akhir}`;
  }
  const [ay, am, ad] = a;
  const [by, bm, bd] = b;
  if (ay === by && am === bm) return `${ad} – ${bd} ${BULAN[am - 1]} ${ay}`;
  if (ay === by) return `${ad} ${BULAN[am - 1]} – ${bd} ${BULAN[bm - 1]} ${ay}`;
  return `${ad} ${BULAN[am - 1]} ${ay} – ${bd} ${BULAN[bm - 1]} ${by}`;
}

/** `mingguan` → `Laporan Mingguan`. Anything else reads as a plain report. */
export function labelTipe(tipe: string): string {
  if (tipe === 'mingguan') return 'Laporan Mingguan';
  if (tipe === 'bulanan') return 'Laporan Bulanan';
  return 'Laporan';
}

/**
 * Health band label → the tone the card is painted in.
 *
 * Deliberately maps the three CLIENT-FACING labels, not the internal band
 * names: the internal vocabulary never reaches this app, so matching on it
 * would be matching on a string that cannot arrive.
 */
export function toneBand(label: string | null): 'ok' | 'warn' | 'danger' | 'none' {
  if (label === 'On Track') return 'ok';
  if (label === 'Needs Attention') return 'warn';
  if (label === 'Action Needed') return 'danger';
  return 'none';
}
