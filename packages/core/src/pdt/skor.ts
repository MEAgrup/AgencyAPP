/**
 * PDT (Pusat Data Toko) — mesin skor TikTok (G2-01, PRD §3.5 Rule 21, riset sesi 34).
 *
 * Fungsi murni saja — nol I/O, nol DB, nol pengetahuan tentang `pdt_fact_*`/
 * `pdt_benchmark` sebagai TABEL. Pemanggil (lanjutan G2-01, BELUM ADA — akan
 * hidup di `packages/domain/src/pdt.ts`) yang membaca fakta+benchmark aktif
 * dan merakit `PdtSkorInputTiktok` dari SQL agregat per periode.
 *
 * Enam dimensi mengikuti bobot mesin LAMA TikTok (`packages/core/src/report/skor.ts`
 * `computeSkor`, diverifikasi dari kode yang SEDANG berjalan produksi) — PORTING
 * FORMULA, bukan porting bug. Mesin lama memberi dimensi tanpa berkas skor
 * NETRAL 5/10 dan bahkan menyebutnya "disengaja" di docblock-nya sendiri — framing
 * itu persis bug yang PRD Rule 12 larang ("skor netral 5/10 dihapus", dikonfirmasi
 * `docs/DECISIONS.md` 2026-09-13 lewat `parsestatus.ts` yang mereproduksi bug ini
 * dengan fixture Shopee). Mesin di sini memakai `renormalisasiDimensi`/
 * `totalSkorDimensi` (`parsestatus.ts`, sudah dibangun+diuji G1-08) untuk SELURUH
 * enam dimensi: dimensi tanpa data ⇒ `nilai: null`, DIKELUARKAN dari pembobotan,
 * bobot dasar dimensi yang tersedia dinormalisasi ulang.
 *
 * **Departure dari `scale()` mesin lama**: versi lama mengembalikan `5` (netral)
 * untuk input `null` — itulah sumber bug Rule 12 di level SUB-FORMULA (mis. CPA
 * ratio tak terhitung karena nol pesanan). `scale()` di sini mengembalikan `null`,
 * dan setiap dimensi ber-banyak sub-suku memakai `rataRataTertimbang` (bawah) yang
 * MENGECUALIKAN sub-suku `null` dan menormalisasi ulang bobot sisanya — satu
 * prinsip konsisten dari level dimensi sampai level sub-formula: TIDAK PERNAH
 * mengarang angka netral, SELALU menormalisasi ulang menjauhi data yang hilang.
 *
 * Sumber tiap dimensi (padanan sumber lama vs sumber PDT — pemanggil yang
 * mengagregasi, fungsi ini hanya menerima hasilnya):
 * - **GMV Max Ads (0,22)** — dulu `AdsReport` dari file Ads Manager mentah;
 *   sekarang `pdt_fact_ads` (`sumber IN ('tt_ads_product','tt_ads_live')`),
 *   agregat per periode.
 * - **LIVE Streaming (0,22)** — dulu `LiveReport`; sekarang `pdt_fact_content`
 *   (`jenis='live'`), agregat per periode (kolom `periode` ditambah sesi 34,
 *   migrasi `20261029010000` — tanpanya dimensi ini tidak bisa discope per bulan).
 * - **Video / Konten (0,18)** — dulu `VideoReport`; sekarang `pdt_fact_content`
 *   (`jenis='video'`), agregat per periode (sama migrasi sesi 34).
 * - **Kartu Produk & Shop Tab (0,14)** — dulu `Kanal`/`KpiToko` dari Analitik
 *   Toko; sekarang `pdt_fact_shop_daily` (`basis='net'`), agregat per periode
 *   (writer baru sesi 34, `ekstrakBarisShopDailyTiktok`).
 * - **Affiliate / Kreator (0,12)** — dulu `AffiliateReport`; sekarang
 *   `pdt_fact_creator_period`, filtered periode.
 * - **Portfolio Produk (0,12)** — dulu `Kuadrans` (mesin lama mengklasifikasi
 *   SKU individual lewat percentile `quad_klik`/`quad_cvr`); di sini fungsi
 *   TIDAK mengklasifikasi ulang — pemanggil memberi GMV yang SUDAH dikelompokkan
 *   per kuadran (`pdt_fact_sku_period.kuadran`, kolom yang sudah ada sejak
 *   G1-01 tapi BELUM ADA penulisnya — pekerjaan G2-01 lanjutan). Karena itu
 *   dimensi ini TIDAK butuh `PdtBenchmarkTiktok` sama sekali (formulanya
 *   self-normalizing terhadap GMV aktif toko sendiri, sama seperti mesin lama).
 *
 * `PdtBenchmarkTiktok` — subset LIMA kunci `ReportBench` mesin lama yang
 * benar-benar dipakai formula skor TikTok (`ctr_ads`/`quad_klik`/`quad_cvr`
 * dipakai KLASIFIKASI kuadran itu sendiri, di luar cakupan fungsi ini — lihat
 * catatan Portfolio Produk di atas). Struktur `{good, warn}` per kunci adalah
 * CALON bentuk `pdt_benchmark.nilai` versi 1 — G2-02 yang menyeed, BELUM
 * diputuskan final di sini.
 */
import { div } from '../baseline/angka';
import { renormalisasiDimensi, totalSkorDimensi, type PdtDimensiSkor, type PdtDimensiSkorHasil } from './parsestatus';

export interface PdtBenchBand {
  good: number;
  warn: number;
}

export interface PdtBenchmarkTiktok {
  roi_gmvmax: PdtBenchBand;
  cpa_ratio: PdtBenchBand;
  gmv_per_jam_live: PdtBenchBand;
  sesi_live: PdtBenchBand;
  gpm_video: PdtBenchBand;
  pct_video_sales: PdtBenchBand;
  cvr_toko: PdtBenchBand;
  pct_kreator_produktif: PdtBenchBand;
}

/** Σ biaya, GMV, pesanan `pdt_fact_ads` (`sumber IN ('tt_ads_product','tt_ads_live')`) untuk satu periode. `null` = nol baris iklan di periode ini. */
export interface PdtSkorInputAdsTiktok {
  biaya: number;
  gmv: number;
  pesanan: number;
  /** Σ `biaya` baris `sumber='tt_ads_product'` dengan `biaya > 0` DAN `gmv <= 0` — kampanye yang membakar anggaran tanpa hasil. */
  burnSpend: number;
  /** Σ `biaya` SELURUH baris `sumber='tt_ads_product'` (penyebut `burnSpend` — mesin lama menghitung rasio bakar HANYA atas sisi produk, bukan produk+LIVE gabungan). */
  biayaProduk: number;
}

/** Agregat `pdt_fact_content` (`jenis='live'`) untuk satu periode. `null`/`sesi=0` = nol sesi live di periode ini. */
export interface PdtSkorInputLiveTiktok {
  gmv: number;
  /** Σ `durasi_detik` seluruh sesi, dalam JAM (pemanggil yang mengonversi). */
  jamTotal: number;
  sesi: number;
  /** Jumlah sesi ber-`gmv <= 0`. */
  sesiNol: number;
}

/** Agregat `pdt_fact_content` (`jenis='video'`) untuk satu periode. `null`/`total=0` = nol video di periode ini. */
export interface PdtSkorInputVideoTiktok {
  total: number;
  adaPenjualan: number;
  gmv: number;
  vv: number;
}

/** Agregat `pdt_fact_shop_daily` (`basis='net'`) untuk satu periode. */
export interface PdtSkorInputKartuTiktok {
  /** Σ GMV yang berasal dari kartu produk/shop tab (GMV toko dikurangi kontribusi LIVE+video, dihitung pemanggil). */
  gmvKartu: number;
  /** Σ GMV kotor shop-level periode ini (penyebut kontribusi). */
  gmvTotal: number;
  /** CVR toko rata-rata periode (`Σ pesanan / Σ pengunjung`, dihitung pemanggil — BUKAN rata-rata `cr` harian mentah). */
  cvr: number;
}

/** Agregat `pdt_fact_creator_period` untuk satu periode. `null`/`total=0` = nol kreator afiliasi di periode ini. */
export interface PdtSkorInputAffiliateTiktok {
  produktif: number;
  total: number;
  gmv: number;
  /** GMV kotor shop-level periode ini (sama sumber `PdtSkorInputKartuTiktok.gmvTotal`) — penyebut share GMV afiliasi. */
  gmvKotorToko: number;
}

/** GMV per kuadran (`pdt_fact_sku_period.kuadran`) untuk satu periode, SUDAH dikelompokkan pemanggil. `null` = kolom kuadran belum terisi sama sekali di periode ini. */
export interface PdtSkorInputProdukTiktok {
  gmvBintangHiddenGem: number;
  gmvBocorTraffic: number;
  /** Σ GMV seluruh SKU YANG DIUJI (bintang+hidden_gem+bocor_traffic+evaluasi) — TIDAK termasuk `tidur`/`tidak_tayang` (mesin lama: `aktif`). */
  gmvAktifTotal: number;
}

export interface PdtSkorInputTiktok {
  ads: PdtSkorInputAdsTiktok | null;
  live: PdtSkorInputLiveTiktok | null;
  video: PdtSkorInputVideoTiktok | null;
  kartu: PdtSkorInputKartuTiktok | null;
  affiliate: PdtSkorInputAffiliateTiktok | null;
  produk: PdtSkorInputProdukTiktok | null;
}

/** Batas bawah pita label — sama nilai mesin lama (`report/skor.ts` `SKOR_SEHAT_MIN`/`SKOR_PERHATIAN_MIN`), belum tentu sama KONSTANTA (disalin, bukan diimpor — core tidak bergantung pada mesin platform lain). */
export const SKOR_SEHAT_MIN = 8;
export const SKOR_PERHATIAN_MIN = 6;

export type PdtSkorLabel = 'SEHAT' | 'PERLU PERHATIAN' | 'KRITIS';

/** `null` hanya bila SELURUH enam dimensi absen (Rule 12/aturan rumah #7 — bukan skor KRITIS palsu untuk toko tanpa data sama sekali). */
export function labelSkorPdt(total: number): PdtSkorLabel {
  return total >= SKOR_SEHAT_MIN ? 'SEHAT' : total >= SKOR_PERHATIAN_MIN ? 'PERLU PERHATIAN' : 'KRITIS';
}

/** Peta sebuah nilai mentah ke skala 0–10 dalam rentang `[lo,hi]`, diklem. `null` (BUKAN 5 — lihat docblock berkas) bila `v` tidak ada/tidak valid. */
export function scale(v: number | null | undefined, lo: number, hi: number): number | null {
  if (v == null || !isFinite(v) || hi === lo) return null;
  const x = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return Math.round(x * 100) / 10;
}

const clamp10 = (v: number): number => Math.round(Math.max(0, Math.min(10, v)) * 10) / 10;

/**
 * Rata-rata tertimbang yang MENGECUALIKAN suku ber-`skor: null` dan
 * menormalisasi ulang bobot sisanya — padanan `renormalisasiDimensi` tapi di
 * level SUB-FORMULA dalam satu dimensi (lihat docblock berkas). `null` bila
 * SELURUH suku absen.
 */
function rataRataTertimbang(bagian: readonly { skor: number | null; bobot: number }[]): number | null {
  const tersedia = bagian.filter((b) => b.skor != null);
  const totalBobot = tersedia.reduce((s, b) => s + b.bobot, 0);
  if (totalBobot === 0) return null;
  return tersedia.reduce((s, b) => s + (b.skor as number) * b.bobot, 0) / totalBobot;
}

function skorGmvMaxAds(input: PdtSkorInputAdsTiktok | null, bench: PdtBenchmarkTiktok): number | null {
  if (input == null || input.biaya <= 0) return null;
  const roi = div(input.gmv, input.biaya) ?? 0;
  const sRoi = scale(roi, 0, bench.roi_gmvmax.good * 1.5);
  const cpa = div(input.biaya, input.pesanan);
  const aov = div(input.gmv, input.pesanan);
  const cpaRatio = cpa == null || aov == null ? null : div(cpa, aov);
  const sCpa = cpaRatio == null ? null : scale(bench.cpa_ratio.warn * 2 - cpaRatio, 0, bench.cpa_ratio.warn * 2);
  const burnPct = input.biayaProduk > 0 ? div(input.burnSpend, input.biayaProduk) : null;
  const sBurn = burnPct == null ? null : scale(1 - burnPct, 0, 1);
  return rataRataTertimbang([
    { skor: sRoi, bobot: 0.6 },
    { skor: sCpa, bobot: 0.25 },
    { skor: sBurn, bobot: 0.15 },
  ]);
}

function skorLive(input: PdtSkorInputLiveTiktok | null, bench: PdtBenchmarkTiktok): number | null {
  if (input == null || input.sesi <= 0) return null;
  const gph = div(input.gmv, input.jamTotal);
  const sGph = gph == null ? null : scale(gph, 0, bench.gmv_per_jam_live.good * 1.5);
  const sSesi = scale(input.sesi, 0, bench.sesi_live.good * 1.5);
  const nolPct = div(input.sesiNol, input.sesi);
  const sNol = nolPct == null ? null : scale(1 - nolPct, 0, 1);
  return rataRataTertimbang([
    { skor: sGph, bobot: 0.5 },
    { skor: sSesi, bobot: 0.25 },
    { skor: sNol, bobot: 0.25 },
  ]);
}

function skorVideo(input: PdtSkorInputVideoTiktok | null, bench: PdtBenchmarkTiktok): number | null {
  if (input == null || input.total <= 0) return null;
  const salesRate = div(input.adaPenjualan, input.total);
  const sSales = salesRate == null ? null : scale(salesRate, 0, bench.pct_video_sales.good * 1.5);
  const gpm = div(input.gmv * 1000, input.vv);
  const sGpm = gpm == null ? null : scale(gpm, 0, bench.gpm_video.good * 1.5);
  return rataRataTertimbang([
    { skor: sSales, bobot: 0.55 },
    { skor: sGpm, bobot: 0.45 },
  ]);
}

function skorKartu(input: PdtSkorInputKartuTiktok | null, bench: PdtBenchmarkTiktok): number | null {
  if (input == null || input.gmvTotal <= 0) return null;
  const share = div(input.gmvKartu, input.gmvTotal);
  const sShare = share == null ? null : scale(share, 0, 0.4);
  const sCvr = scale(input.cvr, 0, bench.cvr_toko.good * 1.5);
  return rataRataTertimbang([
    { skor: sShare, bobot: 0.5 },
    { skor: sCvr, bobot: 0.5 },
  ]);
}

function skorAffiliate(input: PdtSkorInputAffiliateTiktok | null, bench: PdtBenchmarkTiktok): number | null {
  if (input == null || input.total <= 0) return null;
  const pp = div(input.produktif, input.total);
  const sPp = pp == null ? null : scale(pp, 0, bench.pct_kreator_produktif.good * 1.5);
  const gmvShare = div(input.gmv, input.gmvKotorToko);
  const sGmvShare = gmvShare == null ? null : scale(gmvShare, 0, 0.4);
  return rataRataTertimbang([
    { skor: sPp, bobot: 0.6 },
    { skor: sGmvShare, bobot: 0.4 },
  ]);
}

/**
 * Portfolio Produk — GMV-weighted (bukan hitungan SKU): katalog besar selalu
 * punya ekor panjang traffic rendah, menghitung SKU akan menghukum SEMUA toko
 * besar terlepas dari asal pendapatan sungguhan (sama alasan mesin lama).
 * TIDAK butuh `PdtBenchmarkTiktok` — formulanya self-normalizing terhadap
 * GMV aktif toko sendiri.
 */
function skorProduk(input: PdtSkorInputProdukTiktok | null): number | null {
  if (input == null) return null;
  if (input.gmvAktifTotal <= 0) return 3; // kuadran ADA tapi nol produk aktif — beda dari "kuadran tidak ada sama sekali"
  const baik = div(input.gmvBintangHiddenGem, input.gmvAktifTotal) ?? 0;
  const bocor = div(input.gmvBocorTraffic, input.gmvAktifTotal) ?? 0;
  return clamp10(3 + baik * 7 - bocor * 3);
}

export interface PdtSkorHasilTiktok {
  /** `null` hanya bila SELURUH enam dimensi absen. */
  total: number | null;
  label: PdtSkorLabel | null;
  dimensi: PdtDimensiSkorHasil[];
}

/** Rule 21/G2-01: hitung skor TikKok enam dimensi dari fakta yang SUDAH diagregasi pemanggil per periode. Dimensi tanpa data ⇒ dikeluarkan dari pembobotan (Rule 12), bukan diberi 5/10. */
export function computeSkorTiktok(input: PdtSkorInputTiktok, bench: PdtBenchmarkTiktok): PdtSkorHasilTiktok {
  const dimensi: PdtDimensiSkor[] = [
    { kode: 'gmvmax', label: 'GMV Max Ads', bobotDasar: 0.22, nilai: skorGmvMaxAds(input.ads, bench) },
    { kode: 'live', label: 'LIVE Streaming', bobotDasar: 0.22, nilai: skorLive(input.live, bench) },
    { kode: 'video', label: 'Video / Konten', bobotDasar: 0.18, nilai: skorVideo(input.video, bench) },
    { kode: 'kartu', label: 'Kartu Produk & Shop Tab', bobotDasar: 0.14, nilai: skorKartu(input.kartu, bench) },
    { kode: 'affiliate', label: 'Affiliate / Kreator', bobotDasar: 0.12, nilai: skorAffiliate(input.affiliate, bench) },
    { kode: 'produk', label: 'Portfolio Produk', bobotDasar: 0.12, nilai: skorProduk(input.produk) },
  ];
  const hasil = renormalisasiDimensi(dimensi);
  const total = totalSkorDimensi(hasil);
  return { total, label: total == null ? null : labelSkorPdt(total), dimensi: hasil };
}
