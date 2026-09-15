/**
 * PDT (Pusat Data Toko) — rekonsiliasi (G1-07, PRD §3.3 Rule 13-16, PDT-16).
 *
 * Fungsi murni saja — nol I/O, nol DB. Pemanggil (belum ada, G1-09) yang
 * menulis `pdt_upload_batch.status`/`reconcile_delta_pct` dan baris
 * `pdt_fact_shop_daily`/`pdt_fact_sku_period`. Pola sama dengan G1-02..06:
 * engine murni lebih dulu, penulis DB menyusul saat pipa batch lengkap.
 *
 * **`parseShopeeShopStatsBasisTerisolasi`** membaca shop-level Σ basis
 * 'Siap Dikirim' dari sheet `shopee_shop_stats` YANG SUDAH TERISOLASI per
 * basis (`PdtModuleDef.namaSheet`, G1-09-SHEET-BUKAN-PERTAMA) — TERVERIFIKASI
 * ke sample asli (`Shopee - Fim Motor.zip`, ZIP kedua pemilik, G1-09-
 * SHOPEESHOPSTATS-BASIS-TOTAL): sheet 'Pesanan Siap Dikirim' berbaris header
 * di baris 1, baris TEPAT SESUDAHNYA adalah ringkasan PERIODE PENUH (kolom
 * `Tanggal` berisi rentang `DD-MM-YYYY-DD-MM-YYYY`, bukan satu tanggal) —
 * dibuktikan Σ 31 baris harian di bawahnya PERSIS sama dengan baris ringkasan
 * itu (Rp1.515.002.476 / 12.801 pesanan, angka UAT Fim Motor asli yang sama
 * dengan `docs/handoff/UAT_SHOPEE_FIM_MOTOR_20260903.md`). Menggantikan
 * `parseShopeeShopStatsPerBasis` (dihapus sesi ini) yang mengasumsikan TIGA
 * basis sebagai marker-section dalam SATU sheet gabungan — tebakan itu
 * TERBUKTI salah (marker teksnya cuma nama TAB, bukan isi sel manapun,
 * `docs/DECISIONS.md` G1-09-SHEET-BUKAN-PERTAMA) — dan sejak `namaSheet`
 * mengunci modul ini ke SATU sheet basis Siap Dikirim, satu-satunya bentuk
 * `aoa` yang pernah sampai ke pemanggil (`commitUploadBatch`) memang sheet
 * terisolasi itu, bukan gabungan tiga basis.
 *
 * **`sumShopeeParentSkuGmv`** menjumlah kolom GMV per-basis
 * `shopee_parent_sku` (`PDT_MODULES`, `barisHeaderHint: 1`) — literal kolom
 * `'Total Penjualan (Pesanan Dibuat) (IDR)'`/`'Penjualan (Pesanan Siap Dikirim) (IDR)'`
 * SUDAH terverifikasi (`PDT_KOLOM_DIPANEN.md` §2.2, sama literal dengan
 * `report/shopee/metrik.ts` `PRODUK_HDR`). **Kolom Σ per-SKU basis `dibayar`
 * BELUM terverifikasi** — nol kemunculan literalnya di `PDT_KOLOM_DIPANEN.md`/
 * PRD §7/kode manapun (beda dari sisi shop-level, yang literal `'Total
 * Penjualan (IDR)'` di section "Pesanan Dibayar" SUDAH terverifikasi via
 * SHP-1). Dicatat `docs/DECISIONS.md` G1-07-PERSKU-DIBAYAR, tidak
 * memblokir — rekonsiliasi basis `dibayar` PX (PDT-19) tetap bisa jalan
 * shop-level-vs-shop-level sampai kolomnya ketemu.
 *
 * **`parseTiktokShopAnalytics`/`sumTiktokProductAnalyticsGmv`** menutup
 * `G1-07-TIKTOK-REKONSILIASI` — TERVERIFIKASI ke sample asli ("Tiktok -
 * Avitaskin.zip"): `tt_shop_analytics` (`Shop Analytics_Key metrics_*.xlsx`)
 * kolom `'GMV'`/`'Pesanan SKU'` di baris TEPAT SESUDAH header (label kolom
 * pertama `'Total nilai'`) ADALAH GMV shop-level Rule 15 (GMV kotor — lihat
 * catatan refund di bawah); `tt_product_analytics` (`product_list_20260701.xlsx`)
 * punya kolom `'GMV'`/`'Pesanan SKU'` PER SKU yang Σ-nya PERSIS SAMA dengan
 * shop-level (26.560.049 = 26.560.049 GMV; 145 = 145 Pesanan SKU, dihitung
 * ulang dari file asli). **Catatan bentuk berkas nyata**: `tt_product_analytics`
 * adalah laporan LEBAR dengan header BERULANG per kelompok kategori (baris
 * SEBELUM header: `'Semua'`/`'LIVE penjual'`/`'Video penjual'`/dst berulang
 * per blok kolom) — nama kolom `'GMV'`/`'Pesanan SKU'` MUNCUL LEBIH DARI
 * SEKALI (total "Semua" DI DEPAN, lalu breakdown per kategori menyusul).
 * `header.findIndex` (kecocokan PERTAMA) mengambil kolom di bawah kelompok
 * "Semua" — TERBUKTI benar secara aritmetika (Σ kolom pertama = shop-level;
 * kolom kedua dst adalah breakdown, BUKAN duplikat kebetulan). **Rule 15
 * "TikTok = GMV − refund"** bicara soal definisi `pdt_fact_shop_daily.gmv`
 * (tabel itu SENDIRI belum dibangun — G2, dicek: nol pemanggil menulisnya
 * hari ini) — gerbang rekonsiliasi (Rule 13-14) di sini murni memeriksa
 * KONSISTENSI basis antara shop-level dan per-SKU pada metrik MENTAH yang
 * SAMA (persis pola Shopee: `parseShopeeShopStatsBasisTerisolasi` juga
 * membaca GMV kotor, bukan net-of-return), bukan menghitung angka akhir
 * yang akan disimpan — netting refund adalah pekerjaan sesi yang membangun
 * `pdt_fact_shop_daily`.
 */
import { parsePdtAngka } from './angka';

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

export interface PdtShopStatsTotal {
  gmv: number;
  pesanan: number;
}

/**
 * Baca ringkasan PERIODE shop-level dari sheet `shopee_shop_stats` basis
 * Siap Dikirim (sheet SUDAH terisolasi lewat `namaSheet`, G1-09-SHEET-BUKAN-
 * PERTAMA — lihat docblock kepala berkas untuk bukti verifikasi sample asli).
 * Header di baris pertama (`aoa[0]`); baris TEPAT SESUDAHNYA (`aoa[1]`)
 * adalah ringkasan periode PENUH, sebelum baris kosong + header berulang +
 * rincian harian. `null` bila baris ringkasan atau salah satu kolom tidak
 * ditemukan (berkas tidak sesuai bentuk yang diharapkan — pemanggil
 * (`commitUploadBatch`) menahan status di `'parsing'` untuk kasus ini, bukan
 * menulis angka yang mungkin salah).
 */
export function parseShopeeShopStatsBasisTerisolasi(aoa: readonly (readonly unknown[])[]): PdtShopStatsTotal | null {
  const header = aoa[0];
  const totalRow = aoa[1];
  if (!header || !totalRow) return null;
  const idxGmv = header.findIndex((c) => norm(c) === 'total penjualan (idr)' || norm(c).includes('total penjualan'));
  const idxPesanan = header.findIndex((c) => norm(c).includes('total pesanan'));
  if (idxGmv === -1 || idxPesanan === -1) return null;
  return { gmv: parsePdtAngka(totalRow[idxGmv]), pesanan: parsePdtAngka(totalRow[idxPesanan]) };
}

/**
 * Σ kolom GMV `shopee_parent_sku` untuk satu basis (Rule 13 — Σ GMV per-SKU).
 * `kolomGmv` adalah nama literal kolom (`'Total Penjualan (Pesanan Dibuat) (IDR)'`/
 * `'Penjualan (Pesanan Siap Dikirim) (IDR)'`, `PDT_KOLOM_DIPANEN.md` §2.2) —
 * dipanggil dengan literal, bukan ditebak di sini (lihat docblock berkas
 * untuk basis `dibayar`, belum terverifikasi).
 */
export function sumShopeeParentSkuGmv(aoa: readonly (readonly unknown[])[], kolomGmv: string, barisHeader = 1): number {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = header.findIndex((c) => norm(c) === norm(kolomGmv));
  if (idx === -1) return 0;
  let total = 0;
  for (const row of aoa.slice(barisHeader)) total += parsePdtAngka(row?.[idx]);
  return total;
}

/**
 * Baca ringkasan shop-level `tt_shop_analytics` (Rule 13, GMV/Pesanan SKU
 * kotor — lihat docblock kepala berkas untuk bukti verifikasi sample asli).
 * Header di `aoa[barisHeader - 1]` (hasil `temukanBarisHeader`, TIDAK selalu
 * baris pertama sheet — bentuk asli punya preamble `'Tanggal analisis: ...'`
 * + `'Ringkasan data'` di atasnya); baris TEPAT SESUDAHNYA (`'Total nilai'`)
 * adalah ringkasan PERIODE PENUH, pola SAMA `parseShopeeShopStatsBasisTerisolasi`.
 * `null` bila baris ringkasan atau salah satu kolom tidak ditemukan.
 */
export function parseTiktokShopAnalytics(aoa: readonly (readonly unknown[])[], barisHeader: number): PdtShopStatsTotal | null {
  const header = aoa[barisHeader - 1];
  const totalRow = aoa[barisHeader];
  if (!header || !totalRow) return null;
  const idxGmv = header.findIndex((c) => norm(c) === 'gmv');
  const idxPesanan = header.findIndex((c) => norm(c) === 'pesanan sku');
  if (idxGmv === -1 || idxPesanan === -1) return null;
  return { gmv: parsePdtAngka(totalRow[idxGmv]), pesanan: parsePdtAngka(totalRow[idxPesanan]) };
}

/**
 * Σ kolom `'GMV'`/`'Pesanan SKU'` `tt_product_analytics` (Rule 13 — Σ per-SKU).
 * `header.findIndex` mengambil kecocokan PERTAMA — pada bentuk asli (header
 * berulang per kelompok kategori), kolom PERTAMA berlabel `'GMV'`/`'Pesanan
 * SKU'` berada di bawah kelompok kategori `'Semua'` (grand total), BUKAN di
 * bawah breakdown kategori (`'LIVE penjual'`/dst yang menyusul) — TERBUKTI
 * benar secara aritmetika terhadap sample asli (lihat docblock kepala berkas).
 */
export function sumTiktokProductAnalyticsGmv(aoa: readonly (readonly unknown[])[], barisHeader: number): PdtShopStatsTotal {
  const header = aoa[barisHeader - 1] ?? [];
  const idxGmv = header.findIndex((c) => norm(c) === 'gmv');
  const idxPesanan = header.findIndex((c) => norm(c) === 'pesanan sku');
  let gmv = 0;
  let pesanan = 0;
  for (const row of aoa.slice(barisHeader)) {
    if (idxGmv !== -1) gmv += parsePdtAngka(row?.[idxGmv]);
    if (idxPesanan !== -1) pesanan += parsePdtAngka(row?.[idxPesanan]);
  }
  return { gmv, pesanan };
}

/**
 * Selisih persentase antara dua angka, ambang terhadap yang LEBIH BESAR
 * (bukan salah satu sisi tetap) — inilah yang membuat "Selisih Dibuat vs
 * Dibayar = Rp 295.710.122 (18,2%)" (UAT Fim Motor) tepat direproduksi:
 * 295.710.122 / max(1.624.937.476, 1.329.227.354) = 18,2%. Kedua angka `0`
 * ⇒ `0` (bukan `NaN`/error — house rule #7, pembagi-nol).
 */
export function hitungDeltaPersen(a: number, b: number): number {
  const penyebut = Math.max(Math.abs(a), Math.abs(b));
  if (penyebut === 0) return 0;
  return (Math.abs(a - b) / penyebut) * 100;
}

/** Ambang rekonsiliasi PDT-16/Rule 14 — satu tempat, bukan angka ajaib berulang. */
export const AMBANG_REKONSILIASI_PERSEN = 0.5;

/** Satu modul yang terlibat dalam batch — dipakai untuk mengurutkan "kemungkinan penyebab" (Rule 14). */
export interface PdtModulTerlibat {
  kode: string;
  parseStatusOk: boolean;
}

export type PdtRekonsiliasiHasil =
  | { status: 'verified'; deltaGmvPct: number; deltaPesananPct: number | null }
  | { status: 'ditolak'; deltaPct: number; pesan: string; modulPenyebab: readonly string[] };

/**
 * Rule 13-14: Σ GMV per-SKU vs GMV shop-level DAN Σ pesanan per-SKU vs
 * pesanan shop-level, pada basis yang sama (pemanggil yang menjamin
 * kesamaan basis — lihat `hitungDeltaPersen` docblock kenapa fungsi ini
 * TIDAK menerima parameter basis: basis hidup di kunci yang pemanggil pilih
 * SEBELUM memanggil fungsi ini, bukan dicampur di sini). Ditolak bila SALAH
 * SATU (GMV atau pesanan, KETIKA pesanan diketahui) melebihi
 * `AMBANG_REKONSILIASI_PERSEN`; `deltaPct` yang tersimpan
 * (`pdt_upload_batch.reconcile_delta_pct`) adalah yang LEBIH BESAR dari
 * keduanya. `modulPenyebab` (Rule 14: "menunjuk modul penyebab") mengurutkan
 * modul ber-`parseStatusOk=false` LEBIH DULU.
 *
 * `perSkuPesanan`/`shopLevelPesanan` OPSIONAL (G1-09 sub-langkah 2b,
 * `docs/DECISIONS.md` 2026-09-14, `G1-07-PERSKU-PESANAN` Open) — **nol
 * kolom jumlah-pesanan per-SKU terverifikasi** di `shopee_parent_sku`
 * (`PDT_KOLOM_DIPANEN.md` §2.2, bucket 1+2 keduanya sudah dicek): whitelist
 * hanya membawa GMV/views/klik/CR/repeat-order per SKU, nol hitungan
 * pesanan mentah. Memaksa Rule 13 penuh hari ini berarti MENGARANG dua
 * angka yang selalu sama (delta 0% palsu) — persis kelas bug yang Rule
 * 13-16 dibangun untuk mencegah. Saat SALAH SATU sisi pesanan tidak
 * diberikan (`undefined`), perbandingan pesanan DILEWATI (`deltaPesananPct:
 * null`, BUKAN 0) — verdict hanya bergantung pada GMV sampai kolomnya
 * ditemukan; test lama (kedua sisi selalu diisi) berperilaku identik.
 */
export function rekonsiliasiGmvPesanan(input: {
  perSkuGmv: number;
  shopLevelGmv: number;
  perSkuPesanan?: number;
  shopLevelPesanan?: number;
  modulTerlibat: readonly PdtModulTerlibat[];
}): PdtRekonsiliasiHasil {
  const deltaGmvPct = hitungDeltaPersen(input.perSkuGmv, input.shopLevelGmv);
  const pesananDiketahui = input.perSkuPesanan != null && input.shopLevelPesanan != null;
  const deltaPesananPct = pesananDiketahui ? hitungDeltaPersen(input.perSkuPesanan!, input.shopLevelPesanan!) : null;

  const gmvGagal = deltaGmvPct > AMBANG_REKONSILIASI_PERSEN;
  const pesananGagal = deltaPesananPct != null && deltaPesananPct > AMBANG_REKONSILIASI_PERSEN;

  if (!gmvGagal && !pesananGagal) {
    return { status: 'verified', deltaGmvPct, deltaPesananPct };
  }
  const deltaPct = Math.max(deltaGmvPct, deltaPesananPct ?? 0);
  const modulPenyebab = [...input.modulTerlibat]
    .sort((a, b) => Number(a.parseStatusOk) - Number(b.parseStatusOk))
    .map((m) => m.kode);
  const sebab = gmvGagal ? 'GMV' : 'pesanan';
  return {
    status: 'ditolak',
    deltaPct,
    pesan: `[selisih rekonsiliasi ${sebab} ${deltaPct.toFixed(2)}% melebihi ambang ${AMBANG_REKONSILIASI_PERSEN}%]`,
    modulPenyebab,
  };
}
