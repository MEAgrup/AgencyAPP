// Typed wrapper over lib/api.ts for Module 6D (Rekap Hasil Mingguan / Weekly
// Result Recap) endpoints. Shapes mirror the apps/api wire converters
// (apps/api/src/lib/wire.ts `recap*ToWire`) exactly — snake_case, read from the
// converter, never invented. Every derived/auto field (production counts,
// gmv_interim, roas, deltas) is computed server-side; the page renders read-only.
//
// Machine #18 states + the "who may press which button" gates mirror the domain
// (packages/domain/src/recap.ts). The server stays the final authority — these
// helpers only trim the UI, exactly like the M6 complaint page: the owning-AM
// arm is row-scoped, so write controls show to any Account staff/lead/Director
// and the server enforces the row.

import { api } from '@/lib/api';
import type { Role } from '@/lib/types';

// ---------------------------------------------------------------------------
// Read models (mirror apps/api RecapWire family)
// ---------------------------------------------------------------------------

export interface Recap {
  id: string;
  client_id: string;
  plan_id: string | null;
  iso_year: number;
  iso_week: number;
  minggu_mulai: string; // YYYY-MM-DD (ISO Mon–Sun WIB)
  minggu_akhir: string; // YYYY-MM-DD
  status: string; // Terjadwal | Terbuka | Ditutup | Ditutup Otomatis
  pernah_ditutup_otomatis: boolean;
  catatan_pembuka: string | null;
  ditutup_pada: string | null; // RFC3339
  ditutup_oleh: string | null;
  created_at: string;
  created_by: string;
}

export interface RecapDivisi {
  recap_id: string;
  divisi: string; // Creative | Ads | KOL | Live Stream
  jumlah_produksi: number;
  rincian: Record<string, unknown>;
  sengketa: string | null;
}

export interface RecapMetrik {
  recap_id: string;
  metrik: string; // gmv_interim | ad_spend | roas_ads | total_view | ctr | cvr
  nilai: number | null;
  sumber: string; // otomatis | manual | tidak_tersedia
  file_bukti: string | null;
  tanggal_ambil: string | null; // YYYY-MM-DD
  nilai_minggu_lalu: number | null;
  sengketa: string | null;
}

export interface RecapCatatan {
  recap_id: string;
  yang_bergerak: string | null;
  yang_tertahan: string | null;
  fokus_minggu_depan: string | null;
  bahan_untuk_klien: string | null;
  catatan_metrik_tambahan: string | null;
}

export interface RecapCatatanDivisi {
  id: number;
  recap_id: string;
  divisi: string;
  catatan: string;
  created_at: string;
  created_by: string;
}

export interface RecapDetail {
  recap: Recap;
  divisi: RecapDivisi[];
  metrik: RecapMetrik[];
  catatan: RecapCatatan | null;
  catatan_divisi: RecapCatatanDivisi[];
}

/** RM-E read-only rollup — the snake_case JSON `wrr_plan_rollup(plan_id)` builds.
 *  Not compared by shape-parity (no wire converter — SQL builds it directly). */
export interface PlanRekapRollupWeek {
  recap_id: string;
  iso_week: number;
  video: number;
  creator: number;
  live: number;
  jam_live: number;
  gmv_interim: number | null;
  ad_spend: number | null;
  roas_ads: number | null;
}
export interface PlanRekapRollup {
  plan_id: string;
  rekap_count: number;
  kumulatif: {
    video: number;
    creator: number;
    live: number;
    jam_live: number;
    gmv_interim: number;
    ad_spend: number;
  };
  roas_terakhir: number | null;
  minggu: PlanRekapRollupWeek[];
}

// ---------------------------------------------------------------------------
// State machine #18 constants (mirror packages/domain/src/recap.ts)
// ---------------------------------------------------------------------------

export const WRR_TERJADWAL = 'Terjadwal';
export const WRR_TERBUKA = 'Terbuka';
export const WRR_DITUTUP = 'Ditutup';
export const WRR_DITUTUP_OTOMATIS = 'Ditutup Otomatis';

/** RM-C metrics an AM may fill manually (isi atau `—`). view_organik = T-4a. */
export const MANUAL_ELIGIBLE_METRICS = ['total_view', 'view_organik', 'ctr', 'cvr'] as const;
/** The four divisions that may owe a weekly note (RM-D6). */
export const DIVISIONS = ['Creative', 'Ads', 'KOL', 'Live Stream'] as const;

/** Display labels for the consolidated metric keys (PRD istilah). */
export const METRIK_LABELS: Record<string, string> = {
  gmv_interim: 'GMV Eksekusi (interim)',
  ad_spend: 'Ad Spend',
  roas_ads: 'ROAS (Ads)',
  total_view: 'Total View (Berbayar/Live)',
  view_organik: 'View Organik',
  ctr: 'CTR',
  cvr: 'CVR',
  cpc: 'CPC',
  cpm: 'CPM',
};

/** T-4a: label for the derived blended view summary (paid total_view + organik). */
export const VIEW_BLENDED_LABEL = 'Total View (Blended)';

export function getMetrikLabel(key: string): string {
  return METRIK_LABELS[key] ?? key;
}

// ---------------------------------------------------------------------------
// UX gating (mirror the domain gates; server is final)
// ---------------------------------------------------------------------------

function inDivision(role: Role | null, division: string): boolean {
  return !!role && role.division.toLowerCase() === division.toLowerCase();
}
function isLeadOf(role: Role | null, division: string): boolean {
  return !!role && role.level === 'lead' && inDivision(role, division);
}
function isAccountLead(role: Role | null): boolean {
  return isLeadOf(role, 'Account');
}
function isAccountStaff(role: Role | null): boolean {
  return !!role && inDivision(role, 'Account') && role.level === 'staff';
}
/** OD (not layered with Director/Account) is read-only across M6 writes. */
export function isReadOnlyRecap(role: Role | null): boolean {
  return !!role?.od && !role?.director && !isAccountLead(role) && !isAccountStaff(role);
}

/**
 * canManageRecap — the AM-writable fields (pembuka, narasi, manual metric,
 * Sengketa, close). Owning AM / Account lead / Director. The owning-AM arm is
 * row-scoped (server enforces `canWriteRecap`), so any Account staff sees the
 * controls; a stray AM is refused by the API.
 */
export function canManageRecap(role: Role | null): boolean {
  return !isReadOnlyRecap(role) && (isAccountStaff(role) || isAccountLead(role) || !!role?.director);
}

/**
 * canWriteDivisiNote — RM-D6. The lead of the touching division writes their own
 * note; an Account lead/Director may override.
 */
export function canWriteDivisiNote(role: Role | null, divisi: string): boolean {
  if (isReadOnlyRecap(role)) return false;
  return isAccountLead(role) || !!role?.director || isLeadOf(role, divisi);
}

/** canReopenRecap — RM-5. Head of Account (Account lead) or Director only. */
export function canReopenRecap(role: Role | null): boolean {
  return isAccountLead(role) || !!role?.director;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export function getRecapDetail(id: string): Promise<RecapDetail> {
  return api.get<RecapDetail>(`/rekap/${encodeURIComponent(id)}`);
}

export function listRecapsForClient(clientId: string): Promise<{ data: Recap[] }> {
  return api.get<{ data: Recap[] }>(`/clients/${encodeURIComponent(clientId)}/rekap`);
}

export function getPlanRekapRollup(planId: string): Promise<PlanRekapRollup> {
  return api.get<PlanRekapRollup>(`/plan/${encodeURIComponent(planId)}/rekap-rollup`);
}

export function saveRecapPembuka(id: string, catatanPembuka: string): Promise<Recap> {
  return api.put<Recap>(`/rekap/${encodeURIComponent(id)}/pembuka`, { catatan_pembuka: catatanPembuka });
}

export interface RecapNarasiBody {
  yang_bergerak: string | null;
  yang_tertahan: string | null;
  fokus_minggu_depan: string | null;
  bahan_untuk_klien: string | null;
  catatan_metrik_tambahan: string | null;
}
export function saveRecapNarasi(id: string, body: RecapNarasiBody): Promise<RecapCatatan> {
  return api.put<RecapCatatan>(`/rekap/${encodeURIComponent(id)}/narasi`, body);
}

export interface RecapMetrikManualBody {
  nilai: number | null;
  file_bukti?: string;
  tanggal_ambil?: string;
}
export function recordRecapMetrikManual(id: string, metrik: string, body: RecapMetrikManualBody): Promise<RecapMetrik> {
  return api.put<RecapMetrik>(`/rekap/${encodeURIComponent(id)}/metrik/${encodeURIComponent(metrik)}`, body);
}

export function fileRecapSengketaMetrik(id: string, metrik: string, alasan: string): Promise<RecapDetail> {
  return api.post<RecapDetail>(`/rekap/${encodeURIComponent(id)}/metrik/${encodeURIComponent(metrik)}/sengketa`, { alasan });
}

export function fileRecapSengketaDivisi(id: string, divisi: string, alasan: string): Promise<RecapDetail> {
  return api.post<RecapDetail>(`/rekap/${encodeURIComponent(id)}/divisi/${encodeURIComponent(divisi)}/sengketa`, { alasan });
}

export function addRecapCatatanDivisi(id: string, divisi: string, catatan: string): Promise<RecapCatatanDivisi> {
  return api.post<RecapCatatanDivisi>(`/rekap/${encodeURIComponent(id)}/catatan-divisi`, { divisi, catatan });
}

export function closeRecap(id: string): Promise<Recap> {
  return api.post<Recap>(`/rekap/${encodeURIComponent(id)}/close`);
}

export function reopenRecap(id: string, alasan: string): Promise<Recap> {
  return api.post<Recap>(`/rekap/${encodeURIComponent(id)}/reopen`, { alasan });
}
