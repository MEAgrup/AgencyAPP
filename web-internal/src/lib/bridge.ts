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
}

export interface BridgeOrderDetail extends BridgeOrderSummary {
  payload_versi: number;
  payload: BridgeOrderPayload;
}

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
