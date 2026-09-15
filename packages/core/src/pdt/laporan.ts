/**
 * PDT (Pusat Data Toko) — payload "laporan" v1 (G2-01 lanjutan, PDT-21 Rule
 * 21: "laporan adalah view atas fakta. Tidak ada baris laporan yang
 * menyimpan angka yang bisa dihitung dari fakta.").
 *
 * Fungsi murni saja — nol I/O, nol DB. Pemanggil (domain, `pdt.ts`) yang
 * membaca `pdt_fact_*`, memanggil `hitungSkorTiktok`/`hitungSkorShopee`,
 * lalu menyerahkan hasilnya ke sini untuk dirakit jadi bentuk payload yang
 * bisa dikirim mentah sebagai response HTTP maupun dibekukan ke
 * `pdt_laporan_kiriman.payload` (Flow B langkah 4, belum ada — di luar
 * cakupan v1 ini).
 *
 * **v1 SENGAJA sempit, keputusan pemilik via `AskUserQuestion`**: mesin
 * laporan LAMA (`report/payload.ts` `buildReportPayload`) py DUA BELAS
 * bagian jauh lebih kaya — kpi, kanal, iklan, live, video, produk (kuadran),
 * afiliasi, tokopedia, ads_manager, skor, tahap (buyer-journey), insight
 * (narasi+rekomendasi). Di PDT hari ini HANYA "skor" (`hitungSkorTiktok`/
 * `hitungSkorShopee`, G2-01) yang bisa dibangun dari `pdt_fact_*` — sebelas
 * bagian lain butuh fungsi agregasi fakta BARU per bagian (pola sama
 * `rakitInputSkorTiktok`/`rakitInputSkorShopee`) yang belum ada satupun,
 * pekerjaan multi-sesi. v1 di sini menambah SATU bagian lagi: KPI ringkas
 * (GMV/pesanan/pengunjung/CVR) — sebelas bagian sisanya TETAP di luar
 * cakupan, ditambahkan satu-per-satu sesi berikutnya seperti pola G1-09
 * fact-writer, TIDAK ditebak/dibangun sekaligus di sini.
 *
 * **Basis KPI ringkas per platform diverifikasi dari PRD (bukan ditebak)**:
 * TikTok = GMV−refund, basis `'net'` (Rule 15); Shopee = basis
 * `'siap_dikirim'` ("Basis default untuk laporan klien Shopee = Pesanan
 * Siap Dikirim", Rule 16) — BEDA dari basis `'dibuat'` yang dipakai dimensi
 * Conversion & Retention `computeSkorShopee` (tujuan berbeda: KPI headline
 * laporan vs sub-formula skor, PRD memisahkan keduanya secara eksplisit).
 * GMV Shopee TIDAK di-net-kan dengan `refund` — Rule 15 hanya menyebut
 * "TikTok = GMV−refund" secara eksplisit, kontras dengan pendekatan
 * tiga-basis Shopee; menyamakan Shopee ke rumus netting TikTok tanpa
 * verifikasi sample nyata adalah menebak, bukan porting.
 */

import type { PdtSkorHasilShopee, PdtSkorHasilTiktok } from './skor';

const bulat = (v: number | null | undefined): number | null =>
  v == null || !isFinite(v) ? null : Math.round(v);

const persen5 = (v: number | null | undefined): number | null =>
  v == null || !isFinite(v) ? null : Math.round(v * 100_000) / 100_000;

/** Agregat `pdt_fact_shop_daily` untuk satu periode — basis berbeda per platform (lihat docblock berkas). `null` = nol baris basis terkait di periode ini. */
export interface PdtLaporanKpiInput {
  gmv: number;
  pesanan: number;
  pengunjung: number;
}

export interface PdtLaporanKpiRingkas {
  gmv: number | null;
  pesanan: number | null;
  pengunjung: number | null;
  /** Σ pesanan / Σ pengunjung periode ini — `null` bila pengunjung tidak diketahui (BUKAN 0 sungguhan, dibedakan pemanggil). */
  cvr: number | null;
}

/** Rakit `PdtLaporanKpiRingkas` dari agregat mentah. `null` input ⇒ seluruh field `null` (nol baris basis terkait — Rule 12/aturan rumah #7, bukan 0 yang mengarang). */
export function bangunKpiRingkas(input: PdtLaporanKpiInput | null): PdtLaporanKpiRingkas {
  if (input == null) return { gmv: null, pesanan: null, pengunjung: null, cvr: null };
  return {
    gmv: bulat(input.gmv),
    pesanan: bulat(input.pesanan),
    pengunjung: bulat(input.pengunjung),
    cvr: input.pengunjung === 0 ? null : persen5(input.pesanan / input.pengunjung),
  };
}

export interface PdtLaporanTiktok {
  schema: 'cdps.pdt.laporan.tiktok.v1';
  platform: 'tiktok';
  clientPlatformId: number;
  periodeAwalBulan: string;
  generatedAt: string;
  kpi: PdtLaporanKpiRingkas;
  skor: PdtSkorHasilTiktok;
  benchmarkVersi: number;
}

export interface PdtLaporanShopee {
  schema: 'cdps.pdt.laporan.shopee.v1';
  platform: 'shopee';
  clientPlatformId: number;
  periodeAwalBulan: string;
  generatedAt: string;
  kpi: PdtLaporanKpiRingkas;
  skor: PdtSkorHasilShopee;
}

export interface PdtLaporanTiktokOptions {
  clientPlatformId: number;
  periodeAwalBulan: string;
  generatedAt: string;
  kpi: PdtLaporanKpiInput | null;
  skor: PdtSkorHasilTiktok;
  benchmarkVersi: number;
}

export interface PdtLaporanShopeeOptions {
  clientPlatformId: number;
  periodeAwalBulan: string;
  generatedAt: string;
  kpi: PdtLaporanKpiInput | null;
  skor: PdtSkorHasilShopee;
}

/** Rakit payload laporan TikTok v1 — KPI basis `'net'` (Rule 15, GMV−refund; pemanggil sudah menyerahkan gmv yang SUDAH di-net-kan). */
export function bangunLaporanTiktok(opts: PdtLaporanTiktokOptions): PdtLaporanTiktok {
  return {
    schema: 'cdps.pdt.laporan.tiktok.v1',
    platform: 'tiktok',
    clientPlatformId: opts.clientPlatformId,
    periodeAwalBulan: opts.periodeAwalBulan,
    generatedAt: opts.generatedAt,
    kpi: bangunKpiRingkas(opts.kpi),
    skor: opts.skor,
    benchmarkVersi: opts.benchmarkVersi,
  };
}

/** Rakit payload laporan Shopee v1 — KPI basis `'siap_dikirim'` (Rule 16, "Basis default untuk laporan klien Shopee"). Nol `benchmarkVersi` (asimetri asli, `computeSkorShopee` tidak menerima benchmark). */
export function bangunLaporanShopee(opts: PdtLaporanShopeeOptions): PdtLaporanShopee {
  return {
    schema: 'cdps.pdt.laporan.shopee.v1',
    platform: 'shopee',
    clientPlatformId: opts.clientPlatformId,
    periodeAwalBulan: opts.periodeAwalBulan,
    generatedAt: opts.generatedAt,
    kpi: bangunKpiRingkas(opts.kpi),
    skor: opts.skor,
  };
}
