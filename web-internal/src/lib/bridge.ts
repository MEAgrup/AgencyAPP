// Bridge MSDPS→CDPS Fase 1 — data layer for `/bridge/inbox`. Mirrors apps/api
// wire shapes exactly (snake_case, keys identical); registered in
// shape-parity.test.ts.
import { api } from '@/lib/api';

export interface BridgeMerchant {
  external_id: string;
  nama: string;
  kota: string;
  kategori_poi: string;
  pic_nama: string;
  pic_whatsapp: string | null;
  tanggal_mulai_kontrak: string;
  tanggal_akhir_kontrak: string;
}

export interface BridgeAttestation {
  external_trx_ref: string;
  bentuk_kerjasama: string;
  nilai: string | null;
  diverifikasi_pada: string;
  diverifikasi_oleh_external: string | null;
}

export interface BridgeLine {
  jenis: string;
  qty: number | null;
  catatan: string | null;
  alasan_non_roster: string | null;
  nilai_cross_charge: string | null;
}

export interface BridgeOrderPayload {
  payload_versi: number;
  deal_code: string;
  bd_identitas: string;
  merchant: BridgeMerchant;
  attestation: BridgeAttestation;
  lines: BridgeLine[];
}

export interface BridgeOrderSummary {
  id: string;
  sumber: string;
  external_deal_code: string;
  status: string;
  diterima_pada: string;
  client_id: string | null;
  ditolak_alasan: string | null;
  diputus_oleh: string | null;
  diputus_pada: string | null;
  /** Ringkasan pembayaran klien dari lines[].catatan (MSDPS 0377) — null untuk order lama/tanpa info. */
  pembayaran: BridgeRingkasanPembayaran | null;
}

/**
 * Turunan read-only (server-side, `bridge.ringkasanPembayaranOrder`) dari teks
 * yang MSDPS tempelkan ke `lines[].catatan` sejak 2026-11-04. Hanya untuk
 * ditampilkan — tidak mengubah apa pun pada payload atau gerbang accept.
 */
export interface BridgeRingkasanPembayaran {
  /** 'DP' | 'LUNAS'. */
  status: string;
  /** Persen seperti tercetak MSDPS, mis. "30" atau "33,3". */
  persen: string;
  dibayar: string | null;
  total: string | null;
  /** Teks asli (dengan kurung siku) — untuk tooltip. */
  teks: string;
}

export interface BridgeOrderDetail extends BridgeOrderSummary {
  payload_versi: number;
  payload: BridgeOrderPayload;
}

/**
 * BRIDGE-DP (opsi b, 2026-11-04) — klien MEAGO yang diterima saat pembayaran
 * klien belum lunas (snapshot saat diteruskan MSDPS), untuk follow-up Finance.
 */
export interface KlienBelumLunas {
  client_id: string;
  toko: string;
  kota: string;
  external_deal_code: string;
  /** Total kontrak. */
  nilai: string | null;
  /** Persen terbayar saat diteruskan, mis. "30.0". */
  persen_terbayar: string;
  nominal_terbayar: string | null;
  diverifikasi_pada: string;
  diterima_pada: string;
}

/** GET /bridge/belum-lunas → {data: KlienBelumLunas[]}. */
export function listKlienBelumLunas(): Promise<{ data: KlienBelumLunas[] }> {
  return api.get<{ data: KlienBelumLunas[] }>('/bridge/belum-lunas');
}

/** BRIDGE-LIVESTREAM (2026-11-05) — layanan bridge MEAGO + link Google Drive daftar kerja. */
export interface LayananBridge {
  service_id: string;
  name: string;
  status: string;
  link_drive: string | null;
}

/** Satu baris order MSDPS yang sudah diterima — hanya-baca dari payload imutabel. */
export interface RincianBaris {
  jenis: string;
  qty: number | null;
  catatan: string | null;
  alasan_non_roster: string | null;
}

export interface RincianOrder {
  order_id: string;
  deal_code: string;
  diputus_pada: string | null;
  pembayaran: BridgeRingkasanPembayaran | null;
  lines: RincianBaris[];
}

export interface RincianOrderKlien {
  orders: RincianOrder[];
  services: LayananBridge[];
}

/** GET /bridge/clients/{id}/rincian → RincianOrderKlien. */
export function getRincianOrderKlien(clientId: string): Promise<RincianOrderKlien> {
  return api.get<RincianOrderKlien>(`/bridge/clients/${clientId}/rincian`);
}

/** POST /bridge/services/{id}/link-drive → LayananBridge. Kosongkan dengan null. */
export function setLinkDrive(serviceId: string, linkDrive: string | null): Promise<LayananBridge> {
  return api.post<LayananBridge>(`/bridge/services/${serviceId}/link-drive`, { link_drive: linkDrive });
}

/** Jenis baris bridge yang di CDPS hanya berupa daftar kerja di Google Drive. */
export const JENIS_LIVE_STREAM = 'Live Stream';

export interface BridgeCandidate {
  client_id: string;
  toko: string;
  kota: string;
  confidence: string;
}

export interface ExternalServiceMap {
  id: number;
  sumber: string;
  external_service_type: string;
  master_service_id: string;
  aktif: boolean;
}

export const ORDER_MASUK = '[Masuk]';
export const ORDER_DITERIMA = '[Diterima]';
export const ORDER_DITOLAK = '[Ditolak]';

/** GET /bridge/orders?status= → {data: BridgeOrderSummary[]}. */
export function listBridgeOrders(status?: string): Promise<{ data: BridgeOrderSummary[] }> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return api.get<{ data: BridgeOrderSummary[] }>(`/bridge/orders${qs}`);
}

/** GET /bridge/orders/{id} → {order, candidates}. */
export function getBridgeOrder(
  id: string,
): Promise<{ order: BridgeOrderDetail; candidates: BridgeCandidate[] }> {
  return api.get<{ order: BridgeOrderDetail; candidates: BridgeCandidate[] }>(`/bridge/orders/${id}`);
}

export interface AcceptBridgeOrderInput {
  existing_client_id: string | null;
  gmv_baseline: string;
  target_gmv: string;
  link_toko: string;
  kategori: string;
  /** Link Google Drive daftar kerja baris Live Stream — opsional. */
  link_drive_live_stream?: string | null;
}

/** POST /bridge/orders/{id}/accept → BridgeOrderSummary. */
export function acceptBridgeOrder(id: string, input: AcceptBridgeOrderInput): Promise<BridgeOrderSummary> {
  return api.post<BridgeOrderSummary>(`/bridge/orders/${id}/accept`, input);
}

/** POST /bridge/orders/{id}/reject → BridgeOrderSummary. */
export function rejectBridgeOrder(id: string, alasan: string): Promise<BridgeOrderSummary> {
  return api.post<BridgeOrderSummary>(`/bridge/orders/${id}/reject`, { alasan });
}

/** GET /admin/external-service-map → {data: ExternalServiceMap[]}. */
export function listExternalServiceMap(): Promise<{ data: ExternalServiceMap[] }> {
  return api.get<{ data: ExternalServiceMap[] }>('/admin/external-service-map');
}

export interface UpsertExternalServiceMapInput {
  external_service_type: string;
  master_service_id: string;
  aktif: boolean;
}

/** POST /admin/external-service-map → ExternalServiceMap. */
export function upsertExternalServiceMap(input: UpsertExternalServiceMapInput): Promise<ExternalServiceMap> {
  return api.post<ExternalServiceMap>('/admin/external-service-map', input);
}

/** POST /admin/external-service-map/{id}/deactivate → void. */
export function deactivateExternalServiceMap(id: number): Promise<void> {
  return api.post<void>(`/admin/external-service-map/${id}/deactivate`);
}
