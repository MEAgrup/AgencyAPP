// Module 6A — Strategi (STRG-) and Vendor (VND-) client types + fetchers.
//
// The Section A→J form itself is backlog A-05…A-09; this file is the contract
// the form will be built against, and it exists NOW for a specific reason: in
// CDPS the FE interface is the source of truth the response-shape guard
// (`apps/api/src/lib/shape-parity.test.ts`) checks the wire layer against. A
// converter with no declared FE type is a converter nothing verifies — and the
// last four production blank-page defects were all exactly that.
//
// Everything here is snake_case, matching the wire body. The camelCase↔snake_case
// boundary lives in `apps/api/src/lib/wire.ts` and nowhere else.

import { api } from './api';

// ---------------------------------------------------------------------------
// Vendor (M6A §7 / D19) — the E-8 / F-4 prerequisite.
// ---------------------------------------------------------------------------

export type VendorService = 'live_stream' | 'produksi_video' | 'talent' | 'lainnya';
export type VendorFeeScheme = 'per_jam' | 'per_sesi' | 'bagi_hasil' | 'retainer';
export type VendorStatus = 'Aktif' | 'Nonaktif' | 'Blacklist';

export interface VendorDocument {
  nama: string;
  url: string;
}

export interface Vendor {
  id: string;
  nama_vendor: string;
  jenis_layanan: VendorService;
  status: VendorStatus;
  pic_nama: string;
  pic_kontak: string;
  skema_biaya: VendorFeeScheme;
  // Rupiah for per_jam / per_sesi / retainer; null for bagi_hasil (which uses
  // the percentage instead — the two never coexist).
  tarif: string | null;
  bagi_hasil_persen: number | null;
  catatan_kinerja: string;
  dokumen: VendorDocument[];
  created_by: string;
  created_at: string;
}

export interface VendorBody {
  nama_vendor: string;
  jenis_layanan: VendorService;
  pic_nama: string;
  pic_kontak: string;
  skema_biaya: VendorFeeScheme;
  tarif?: string | null;
  bagi_hasil_persen?: number | null;
  catatan_kinerja?: string;
  dokumen?: VendorDocument[];
}

/** The E-8 / F-4 picker: active vendors only unless the admin list asks for all. */
export function listVendors(opts: { jenis?: VendorService; includeInactive?: boolean } = {}): Promise<Vendor[]> {
  const q = new URLSearchParams();
  if (opts.jenis) q.set('jenis_layanan', opts.jenis);
  if (opts.includeInactive) q.set('include_inactive', 'true');
  const qs = q.toString();
  return api.get<Vendor[]>(`/vendors${qs ? `?${qs}` : ''}`);
}

export function getVendor(id: string): Promise<Vendor> {
  return api.get<Vendor>(`/vendors/${id}`);
}

export function createVendor(body: VendorBody): Promise<Vendor> {
  return api.post<Vendor>('/vendors', body);
}

export function updateVendor(id: string, body: VendorBody): Promise<Vendor> {
  return api.put<Vendor>(`/vendors/${id}`, body);
}

/** Status moves through the engine; Blacklist → Aktif is deliberately two steps. */
export function setVendorStatus(id: string, status: VendorStatus): Promise<Vendor> {
  return api.post<Vendor>(`/vendors/${id}/status`, { status });
}

// ---------------------------------------------------------------------------
// Strategi (M6A)
// ---------------------------------------------------------------------------

export type StrategiStatus =
  | 'Draft'
  | 'Diajukan'
  | 'Aktif'
  | 'Draft Revisi'
  | 'Kedaluwarsa'
  | 'Diarsipkan';

export type Channel = 'Shopee' | 'TikTok Shop' | 'Tokopedia' | 'Lazada' | 'Website' | 'Lainnya';
export type ChannelState = 'Eksisting' | 'Belum Aktif';
export type AssumptionState = 'Berlaku' | 'Gugur' | 'Terverifikasi';
export type RiskLevel = 'rendah' | 'sedang' | 'tinggi';

export interface Strategi {
  id: string;
  service_id: string;
  client_id: string;
  versi_no: number;
  strategi_induk_id: string | null;
  versi_sebelumnya_id: string | null;
  status: StrategiStatus;
  durasi_kontrak_bulan: number;
  tanggal_mulai_kontrak: string;
  tanggal_akhir_kontrak: string;
  tanggal_mulai_siklus: string | null;
  siklus_terkunci: boolean;
  toleransi_over_persen: number;
  diajukan_pada: string | null;
  disetujui_pada: string | null;
  disetujui_oleh: string | null;
  catatan_reviewer: string | null;
  created_by: string;
  created_at: string;
}

/** B-1 / B-5 — one row per month of the declared baseline window (B-0.7). */
export interface StrategiBaselineMonth {
  month_index: number;
  gmv: string;
  jumlah_pesanan: number;
  persen_batal: number;
  ad_spend: string;
  roas: number;
  acos: number;
  // B-1.3 auto (GMV/order). Null when there were no orders — render `—`.
  aov: string | null;
}

export interface StrategiChannel {
  id: number;
  channel: Channel;
  channel_lain: string | null;
  status_channel: ChannelState;
  nama_toko: string;
  url_toko: string;
  umur_toko_bulan: number | null;
  badge: string | null;
  target_tanggal_live: string | null;
  prasyarat_pembukaan: string[];
  sumber_data: string | null;
  tanggal_ambil_data: string | null;
  lampiran: string | null;
  periode_baseline_bulan: number | null;
  periode_mulai: string | null;
  periode_akhir: string | null;
  alasan_periode_pendek: string | null;
  catatan_periode_pendek: string | null;
  baseline: StrategiBaselineMonth[];
}

export interface StrategiTarget {
  channel: string;
  month_index: number;
  metric: string;
  nilai_floor: string | null;
  nilai_stretch: string;
  // O57: `kontrak` once a Contract record exists, `input_am` until then — a
  // report must be able to tell a contractual floor from a self-set one.
  sumber_floor: string | null;
}

export interface StrategiAssumption {
  kode: string;
  asumsi: string;
  pemilik: string;
  cara_verifikasi: string;
  status: AssumptionState;
  // D-9 mapping, as target keys `metric:channel:month_index`.
  target_terkait: string[];
}

export interface StrategiPillar {
  id: number;
  jenis: string;
  channel: string | null;
  urutan: number;
  sku: string | null;
  peran: string | null;
  aksi: string;
  target: string;
  harga_normal: string | null;
  harga_promo: string | null;
  floor_price: string | null;
  vendor_id: string | null;
  slot_jam: number | null;
  tarif: string | null;
  target_gmv_per_jam: string | null;
  detail: Record<string, unknown>;
}

export interface StrategiResource {
  id: number;
  jenis: string;
  channel: string | null;
  divisi: string | null;
  nilai: string | null;
  jumlah: number | null;
  satuan: string | null;
  sumber_dana: string | null;
  vendor_id: string | null;
  skema_biaya: string | null;
  catatan: string;
}

export interface StrategiRisk {
  id: number;
  risiko: string;
  dampak: RiskLevel;
  kemungkinan: RiskLevel;
  mitigasi: string;
  pic: string;
  urutan: number;
}

/** Section J — append-only, one row per event (a version can be returned twice). */
export interface StrategiEvent {
  versi_no: number;
  peristiwa: string;
  aktor: string;
  catatan: string | null;
  trigger_revisi: string[];
  alasan_revisi: string | null;
  asumsi_gugur: string[];
  created_at: string;
}

export interface StrategiDetail extends Strategi {
  channels: StrategiChannel[];
  targets: StrategiTarget[];
  assumptions: StrategiAssumption[];
  pillars: StrategiPillar[];
  resources: StrategiResource[];
  risks: StrategiRisk[];
  riwayat: StrategiEvent[];
}

/** One unmet requirement — §5 step 5 asks for a live count, not a first error. */
export interface StrategiKekurangan {
  kode: string;
  pesan: string;
}

export interface StrategiHeaderBody {
  durasi_kontrak_bulan: number;
  tanggal_mulai_kontrak: string;
  tanggal_akhir_kontrak: string;
  tanggal_mulai_siklus?: string | null;
  toleransi_over_persen?: number | null;
}

export function listStrategi(serviceId: string): Promise<Strategi[]> {
  return api.get<Strategi[]>(`/services/${serviceId}/strategi`);
}

export function createStrategi(serviceId: string, body: StrategiHeaderBody): Promise<Strategi> {
  return api.post<Strategi>(`/services/${serviceId}/strategi`, body);
}

export function getStrategi(id: string): Promise<StrategiDetail> {
  return api.get<StrategiDetail>(`/strategi/${id}`);
}

export function updateStrategiHeader(id: string, body: StrategiHeaderBody): Promise<Strategi> {
  return api.put<Strategi>(`/strategi/${id}`, body);
}

export function saveStrategiChannels(id: string, channels: unknown[]): Promise<StrategiDetail> {
  return api.put<StrategiDetail>(`/strategi/${id}/channels`, { channels });
}

export function saveStrategiBaseline(
  id: string,
  channelId: number,
  months: unknown[],
): Promise<StrategiDetail> {
  return api.put<StrategiDetail>(`/strategi/${id}/channels/${channelId}/baseline`, { months });
}

export function saveStrategiTargets(id: string, targets: unknown[]): Promise<StrategiDetail> {
  return api.put<StrategiDetail>(`/strategi/${id}/targets`, { targets });
}

export function saveStrategiAssumptions(id: string, assumptions: unknown[]): Promise<StrategiDetail> {
  return api.put<StrategiDetail>(`/strategi/${id}/assumptions`, { assumptions });
}

export function saveStrategiPillars(id: string, pillars: unknown[]): Promise<StrategiDetail> {
  return api.put<StrategiDetail>(`/strategi/${id}/pillars`, { pillars });
}

export function saveStrategiResources(id: string, resources: unknown[]): Promise<StrategiDetail> {
  return api.put<StrategiDetail>(`/strategi/${id}/resources`, { resources });
}

export function saveStrategiRisks(id: string, risks: unknown[]): Promise<StrategiDetail> {
  return api.put<StrategiDetail>(`/strategi/${id}/risks`, { risks });
}

/** The live "what is still missing" list the submit button reads (§5 step 5). */
export function strategiKekurangan(id: string): Promise<StrategiKekurangan[]> {
  return api.get<StrategiKekurangan[]>(`/strategi/${id}/kekurangan`);
}

export function submitStrategi(id: string): Promise<Strategi> {
  return api.post<Strategi>(`/strategi/${id}/submit`);
}

export function approveStrategi(id: string): Promise<Strategi> {
  return api.post<Strategi>(`/strategi/${id}/approve`);
}

export function returnStrategi(id: string, catatan: string): Promise<Strategi> {
  return api.post<Strategi>(`/strategi/${id}/return`, { catatan });
}

/** Rule 13: a revision must declare trigger + reason + which assumptions broke. */
export function openStrategiRevision(
  id: string,
  body: { trigger_revisi: string[]; alasan_revisi: string; asumsi_gugur: string[] },
): Promise<Strategi> {
  return api.post<Strategi>(`/strategi/${id}/revision`, body);
}

export function expireStrategi(id: string): Promise<Strategi> {
  return api.post<Strategi>(`/strategi/${id}/expire`);
}
