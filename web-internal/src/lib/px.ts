// Typed wrapper over lib/api.ts for Product Exchange PX-M2a (eligibility
// policy). Shapes mirror packages/domain/src/productexchange.ts +
// apps/api/src/lib/wire.ts (eligibilityPolicyToWire) exactly.

import { api } from '@/lib/api';

/** The calibration value shape, apa adanya (PRD §4.5). */
export interface PxEligibilityPolicyValue {
  sales_threshold_idr: number;
  threshold_basis: string;
  threshold_window_days: number;
  commission_floor_pct: number | null;
  require_stock_in: boolean;
  platforms: string[];
}

/** One versioned Product Exchange eligibility-policy row (Director-only). */
export interface PxEligibilityPolicy {
  versi: number;
  nilai: PxEligibilityPolicyValue;
  aktif: boolean;
  catatan: string | null;
  dibuat_pada: string;
  dibuat_oleh: string;
}

/** GET /px/eligibility-policy — every calibration version, newest first. Director-only. */
export function listEligibilityPolicy(): Promise<{ data: PxEligibilityPolicy[] }> {
  return api.get<{ data: PxEligibilityPolicy[] }>('/px/eligibility-policy');
}

/** Body of `POST /px/eligibility-policy` — a named interface so
 *  `body-parity.test.ts` can statically resolve it against the route. */
export interface CreateEligibilityPolicyInput {
  nilai: PxEligibilityPolicyValue;
  catatan: string;
  aktif?: boolean;
}

/** POST /px/eligibility-policy — mint the next calibration version. Director-only. */
export function createEligibilityPolicy(input: CreateEligibilityPolicyInput): Promise<PxEligibilityPolicy> {
  return api.post<PxEligibilityPolicy>('/px/eligibility-policy', input);
}

// ---------------------------------------------------------------------------
// M3-B — Kandidat/Katalog/laporan kreator_kosong. Shapes mirror
// packages/domain/src/productexchange-m3.ts + apps/api/src/lib/wire.ts
// exactly. Angka mentah (BUKAN pra-format "Rp. …") — `fmtRupiah` di bawah
// memformat lokal, pola sama `adsscanner-ui.ts`/`skuscreener-ui.ts`.
// ---------------------------------------------------------------------------

/** IDR rumah: `Rp. 1.234.567,00`. Nilai kosong → `—`, tidak pernah `Rp. 0,00` palsu. */
export function fmtRupiah(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? `Rp. ${Math.round(v).toLocaleString('id-ID')},00` : '—';
}

export interface PxKandidat {
  client_platform_id: number;
  platform_product_id: string;
  nama_produk: string | null;
  client_id: string;
  nama_toko: string;
  platform: string;
  kategori_platform: string | null;
  harga_satuan: number | null;
  gmv_30d: number | null;
  level2_category: string | null;
  price_segment: string | null;
  verdict: string;
  lapis_gagal: number | null;
  dihitung_pada: string;
}

/** GET /px/kandidat — AM: klien miliknya. Lead Account/Director/OD: semua. */
export function listKandidat(): Promise<{ data: PxKandidat[] }> {
  return api.get<{ data: PxKandidat[] }>('/px/kandidat');
}

export interface PxKandidatVerdict {
  client_platform_id: number;
  platform_product_id: string;
  verdict: string;
  lapis_gagal: number | null;
  level2_category: string | null;
  price_segment: string | null;
}

/** Body of `PUT /px/kandidat/{cpid}/{pid}/kategori` — a named interface so `body-parity.test.ts` can statically resolve it. */
export interface KonfirmasiKategoriInput {
  level2_category: string;
}

/** PUT /px/kandidat/{cpid}/{pid}/kategori — AM/Lead Account/Director mengonfirmasi kategori (D-24). */
export function konfirmasiKategori(
  clientPlatformId: number,
  platformProductId: string,
  input: KonfirmasiKategoriInput,
): Promise<PxKandidatVerdict> {
  return api.put<PxKandidatVerdict>(
    `/px/kandidat/${clientPlatformId}/${encodeURIComponent(platformProductId)}/kategori`,
    input,
  );
}

/** GET /px/kategori-options — Rule 10: `tersaring:false` PERMANEN (M3-03 ditutup 2026-09-16, opsi (c) — bukan menunggu pemeta kategori). */
export interface PxKategoriOption {
  options: string[];
  tersaring: boolean;
}

export function listKategoriOptions(): Promise<PxKategoriOption> {
  return api.get<PxKategoriOption>('/px/kategori-options');
}

export interface PxKatalogItem {
  client_platform_id: number;
  platform_product_id: string;
  nama_produk: string | null;
  platform: string;
  client_id: string;
  nama_toko: string;
  level2_category: string | null;
  price_segment: string | null;
  sudah_afiliasi: boolean;
  dihitung_pada: string;
}

export interface PxCoverageMeta {
  batch_key: string | null;
  snapshot_at: string | null;
  umur_hari: number | null;
  basi: boolean;
}

/** GET /px/katalog — Lead Account/Director/OD saja. */
export function listKatalog(): Promise<{ data: PxKatalogItem[]; snapshot: PxCoverageMeta }> {
  return api.get<{ data: PxKatalogItem[]; snapshot: PxCoverageMeta }>('/px/katalog');
}

export interface PxKreatorKosong {
  level2_category: string;
  price_segment: string;
  jumlah_produk: number;
  jumlah_klien: number;
}

/** GET /px/laporan/kreator-kosong — Lead Account/Director/OD saja; input rekrutmen kreator MCN. */
export function listKreatorKosong(): Promise<{ data: PxKreatorKosong[] }> {
  return api.get<{ data: PxKreatorKosong[] }>('/px/laporan/kreator-kosong');
}
