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

// =============================================================================
// Shopee (sesi 34 lanjutan, riset G2-01 Shopee) — enam dimensi BEDA dari
// TikTok (`report/shopee/skor.ts` `computeSkor`, mesin PRODUKSI, diverifikasi
// dari kode yang SEDANG berjalan, bukan ditebak): ROAS & Channel 0,22,
// Traffic Quality 0,22, Conversion & Retention 0,18, Product Performance
// 0,14, Live Streaming 0,12, Kesehatan Toko 0,12 (Σ = 1,00, sama persis
// mesin lama).
//
// **Asimetri nyata dipertahankan, BUKAN "diperbaiki" saat porting**: mesin
// lama `computeSkor(M: ShopeeMetrics)` TIDAK menerima parameter benchmark
// sama sekali — setiap ambang di bawah adalah KONSTANTA hardcode
// (diverifikasi dari kode produksi), beda total dari `computeSkorTiktok`
// yang menerima `PdtBenchmarkTiktok` eksplisit. `computeSkorShopee` di
// bawah juga TIDAK menerima benchmark, sengaja.
//
// **Fix Rule 12 yang sama diterapkan** (satu-satunya perubahan dari mesin
// lama): setiap cabang "berkas/modul tidak ada" yang dulu mengembalikan
// netral 5/10 sekarang mengembalikan `null` (dikeluarkan dari pembobotan,
// bobot dasar dimensi lain dinormalisasi ulang via `renormalisasiDimensi`).
// Sub-formula ber-banyak suku (Traffic Quality, Conversion & Retention)
// memakai `rataRataTertimbang` yang sama, persis pola TikTok di atas.
//
// **TIGA dari enam dimensi terblokir data sungguhan** (dicatat
// `docs/backlog/PDT_BACKLOG.md` §G2-01, TIDAK ditebak di sini — pemanggil
// akan memberi `null` untuk field-field ini sampai Open masing-masing
// ditutup):
// - `PdtSkorInputShopee.dibuat.repeatRate`/`.cancelRate` — kolom sumber
//   TERVERIFIKASI ada di sample nyata (`Pesanan Dibatalkan`/`Penjualan
//   Dibatalkan`/`Tingkat Pembelian Berulang`), tapi `pdt_fact_shop_daily`
//   belum punya kolomnya (`G2-01-SHOPEE-CANCEL-REPEAT-RATE`) — Conversion &
//   Retention TETAP dapat skor SEBAGIAN dari `cr` saja lewat renormalisasi
//   sub-formula.
// - `PdtSkorInputShopee.produk` — sama gap `G2-01-KUADRAN-SKU` seperti
//   TikTok (`pdt_fact_sku_period.kuadran` belum pernah ditulis modul
//   manapun untuk platform manapun).
// - `PdtSkorInputShopee.kesehatan` — modul parser `shopee_kesehatan` sudah
//   terdaftar dan bisa dideteksi, tapi NOL fungsi penulis fakta ada di
//   manapun dalam skema (`G2-01-SHOPEE-KESEHATAN-WRITER`).
//
// Pembobotan ulang GMV vs hitungan SKU pada Product Performance: mesin lama
// Shopee membobot per HITUNGAN SKU aktif (bintang+hidden_gem vs
// bocor_traffic+evaluasi), BUKAN per GMV seperti dimensi Portfolio Produk
// TikTok — perbedaan metodologi ASLI antar dua alat produksi, dipertahankan
// apa adanya (bukan diseragamkan ke pola TikTok).
// =============================================================================

/** Agregat `pdt_fact_ads` (`sumber IN ('shopee_ads_cpc','shopee_ads_live','shopee_ads_search')`) untuk satu periode. `null` = nol biaya iklan di periode ini — pemetaan sumber↔kategori "toko/produk/banner/live" mesin lama BELUM diputuskan (dicatat sebagai pekerjaan lanjutan perakit input, di luar cakupan fungsi murni ini). */
export interface PdtSkorInputAdsShopee {
  /** > 0 dijamin pemanggil (nol biaya ⇒ `null` di level objek, sama kontrak `PdtSkorInputAdsTiktok`). */
  spend: number;
  /** `null` = basis omzet tidak diketahui dari SELURUH sumber (bukan omzet 0 sungguhan) — padanan `sumOpt` mesin lama: satu baris pun tanpa kolom omzet membuat totalnya `null`. */
  omzet: number | null;
  /** CTR gabungan (Σ klik / Σ dilihat), dihitung pemanggil. `null` bila basis dilihat/klik tidak diketahui. */
  ctr: number | null;
}

/** Agregat `pdt_fact_shop_daily` (basis `'dibuat'`) untuk satu periode. `null` = nol baris basis ini di periode ini. */
export interface PdtSkorInputPesananDibuatShopee {
  /** CVR toko (Σ pesanan / Σ pengunjung), dihitung pemanggil — BUKAN rata-rata `cr` harian mentah, pola sama `PdtSkorInputKartuTiktok.cvr`. */
  cr: number | null;
  /** Persentase pembeli berulang. `null` sampai `G2-01-SHOPEE-CANCEL-REPEAT-RATE` ditutup. */
  repeatRate: number | null;
  /** Rasio pesanan dibatalkan (Σ batal / Σ pesanan). `null` sampai `G2-01-SHOPEE-CANCEL-REPEAT-RATE` ditutup. */
  cancelRate: number | null;
}

/** Jumlah SKU aktif per kuadran (`pdt_fact_sku_period.kuadran`, SUDAH dikelompokkan pemanggil) untuk satu periode. `null` = kolom kuadran belum terisi sama sekali (`G2-01-KUADRAN-SKU`). */
export interface PdtSkorInputProdukShopee {
  /** Σ SKU kuadran `bintang`+`hidden_gem`. */
  baik: number;
  /** Σ SKU kuadran `bocor_traffic`+`evaluasi`. */
  buruk: number;
  /** Σ SKU KEEMPAT kuadran di atas (TIDAK termasuk `tidur`/`tidak_tayang`/`no_data` — mesin lama: "produk aktif"). */
  aktifTotal: number;
}

/** Agregat `pdt_fact_content` (`jenis='live'`, platform Shopee) untuk satu periode. */
export interface PdtSkorInputLiveShopee {
  /** Apakah modul `shopee_live` PERNAH terdeteksi untuk batch manapun yang mencakup periode ini — pemanggil menentukan dari riwayat deteksi batch (`pdt_file`), BUKAN dari keberadaan baris `pdt_fact_content` (nol baris di sana ambigu: bisa "tidak pernah diunggah" ATAU "diunggah, sungguh nol sesi" — dua kondisi yang mesin lama sengaja bedakan skornya). */
  diunggah: boolean;
  sesi: number;
}

/** `pdt_fact_*` untuk modul `shopee_kesehatan` — BELUM ADA penulisnya (`G2-01-SHOPEE-KESEHATAN-WRITER`), didefinisikan di sini supaya bentuk kontrak siap begitu writer-nya dibangun. */
export interface PdtSkorInputKesehatanShopee {
  poinTotal: number;
}

export interface PdtSkorInputShopee {
  ads: PdtSkorInputAdsShopee | null;
  dibuat: PdtSkorInputPesananDibuatShopee | null;
  produk: PdtSkorInputProdukShopee | null;
  live: PdtSkorInputLiveShopee | null;
  kesehatan: PdtSkorInputKesehatanShopee | null;
}

/** Ambang ROAS piecewise mesin lama (`report/shopee/skor.ts` `scoreRoas`) — konstanta hardcode, bukan benchmark (lihat docblock bagian Shopee di atas). */
function skorRoasChannel(ads: PdtSkorInputAdsShopee | null): number | null {
  if (ads == null) return null;
  const roas = ads.omzet == null ? null : div(ads.omzet, ads.spend);
  if (roas == null) return null;
  let s: number;
  if (roas >= 6) s = 10;
  else if (roas >= 4) s = 7 + (roas - 4) * 1.5;
  else if (roas >= 2) s = 4 + (roas - 2) * 1.5;
  else s = Math.max(1, roas * 3);
  return clamp10(s);
}

function skorTrafficQuality(ads: PdtSkorInputAdsShopee | null, dibuat: PdtSkorInputPesananDibuatShopee | null): number | null {
  return rataRataTertimbang([
    { skor: scale(ads?.ctr ?? null, 0.005, 0.03), bobot: 0.5 },
    { skor: scale(dibuat?.cr ?? null, 0.02, 0.06), bobot: 0.5 },
  ]);
}

/** Cancel rate mesin lama pakai `invert` (cancel makin tinggi makin buruk) — `scale()` di sini tidak punya flag invert, jadi hasilnya dibalik manual (`10 - x`), padanan `scaleV(..., true)`. */
function skorConversionRetention(dibuat: PdtSkorInputPesananDibuatShopee | null): number | null {
  if (dibuat == null) return null;
  const sCancelRaw = scale(dibuat.cancelRate, 0.02, 0.2);
  const sCancel = sCancelRaw == null ? null : Math.round((10 - sCancelRaw) * 10) / 10;
  return rataRataTertimbang([
    { skor: scale(dibuat.cr, 0.02, 0.06), bobot: 0.5 },
    { skor: scale(dibuat.repeatRate, 0.1, 0.3), bobot: 0.2 },
    { skor: sCancel, bobot: 0.3 },
  ]);
}

/**
 * Berbeda dari Portfolio Produk TikTok: dibobot per HITUNGAN SKU, bukan GMV
 * (asimetri asli mesin produksi — lihat docblock bagian Shopee di atas).
 */
function skorProdukPerformance(input: PdtSkorInputProdukShopee | null): number | null {
  if (input == null) return null;
  if (input.aktifTotal <= 0) return 3; // kuadran ADA tapi nol produk aktif — beda dari "kuadran tidak ada sama sekali"
  const baik = div(input.baik, input.aktifTotal) ?? 0;
  const buruk = div(input.buruk, input.aktifTotal) ?? 0;
  return clamp10(3 + baik * 7 - buruk * 4);
}

/**
 * Mesin lama (`scoreLive`) membedakan TIGA kondisi: tidak pernah diunggah
 * (dulu netral 5, DI SINI diperbaiki Rule 12 ⇒ `null`/dikeluarkan), diunggah
 * tapi nol sesi (sinyal SUNGGUHAN, skor 1 — bukan data hilang, dipertahankan
 * apa adanya), dan diunggah dengan aktivitas APA PUN (skor flat 5 tanpa
 * memandang volume — quirk metodologi ASLI mesin produksi, "non-fix" yang
 * dicatat eksplisit di docblock mesin lama, dipertahankan apa adanya).
 */
function skorLiveStreaming(input: PdtSkorInputLiveShopee | null): number | null {
  if (input == null || !input.diunggah) return null;
  if (input.sesi <= 0) return 1;
  return 5;
}

function skorKesehatanToko(input: PdtSkorInputKesehatanShopee | null): number | null {
  if (input == null) return null;
  const p = input.poinTotal;
  if (p === 0) return 10;
  return p === 1 ? 5 : p === 2 ? 3 : 1;
}

export interface PdtSkorHasilShopee {
  /** `null` hanya bila SELURUH enam dimensi absen. */
  total: number | null;
  label: PdtSkorLabel | null;
  dimensi: PdtDimensiSkorHasil[];
}

/** Rule 21/G2-01 Shopee: hitung skor enam dimensi dari fakta yang SUDAH diagregasi pemanggil per periode. Sama label & pita (`labelSkorPdt`) dengan TikTok — mesin lama membagi SATU sumber label (`report/shopee/skor.ts` mengimpor `labelSkor` dari `report/skor.ts`), bukan dua salinan angka yang bisa menyimpang. */
export function computeSkorShopee(input: PdtSkorInputShopee): PdtSkorHasilShopee {
  const dimensi: PdtDimensiSkor[] = [
    { kode: 'roas_channel', label: 'ROAS & Channel', bobotDasar: 0.22, nilai: skorRoasChannel(input.ads) },
    { kode: 'traffic_quality', label: 'Traffic Quality', bobotDasar: 0.22, nilai: skorTrafficQuality(input.ads, input.dibuat) },
    { kode: 'conversion_retention', label: 'Conversion & Retention', bobotDasar: 0.18, nilai: skorConversionRetention(input.dibuat) },
    { kode: 'product_performance', label: 'Product Performance', bobotDasar: 0.14, nilai: skorProdukPerformance(input.produk) },
    { kode: 'live_streaming', label: 'Live Streaming', bobotDasar: 0.12, nilai: skorLiveStreaming(input.live) },
    { kode: 'kesehatan_toko', label: 'Kesehatan Toko', bobotDasar: 0.12, nilai: skorKesehatanToko(input.kesehatan) },
  ];
  const hasil = renormalisasiDimensi(dimensi);
  const total = totalSkorDimensi(hasil);
  return { total, label: total == null ? null : labelSkorPdt(total), dimensi: hasil };
}
