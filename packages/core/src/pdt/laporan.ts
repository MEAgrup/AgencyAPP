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
 * (narasi+rekomendasi). Di PDT hari ini "skor" (`hitungSkorTiktok`/
 * `hitungSkorShopee`, G2-01), "kpi ringkas", "kanal" (lihat docblock
 * `PdtLaporanKanal` di bawah — keputusan pemilik via `AskUserQuestion`
 * KEDUA, 2026-09-16: TikTok+Shopee dibangun BERSAMAAN meski Shopee sengaja
 * tidak simetris, ditandai `lengkap: false`), dan sekarang "live" (lihat
 * docblock `PdtLaporanLive` di bawah — keputusan pemilik via
 * `AskUserQuestion` KETIGA, 2026-09-16: SATU bentuk bersama, nol asimetri
 * platform kali ini) sudah bisa dibangun dari `pdt_fact_*` — DELAPAN bagian
 * lain (iklan, video, produk, afiliasi, tokopedia, ads_manager, tahap,
 * insight) butuh fungsi agregasi fakta BARU per bagian (pola sama
 * `rakitInputSkorTiktok`/`rakitInputSkorShopee`) yang belum ada satupun,
 * pekerjaan multi-sesi. Delapan bagian sisanya TETAP di luar cakupan,
 * ditambahkan satu-per-satu
 * sesi berikutnya seperti pola G1-09 fact-writer, TIDAK ditebak/dibangun
 * sekaligus di sini.
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

/**
 * Bagian "kanal" (sumber GMV) — bagian KEDUA dari sebelas yang tadinya di
 * luar cakupan v1 (lihat docblock berkas). Keputusan pemilik via
 * `AskUserQuestion`: TikTok DAN Shopee dibangun SEKALIGUS, meski TIDAK
 * SIMETRIS — `lengkap` membedakan keduanya secara eksplisit (bukan
 * disembunyikan di balik angka yang terlihat lengkap).
 *
 * **TikTok (`lengkap: true`)** — cermin `report/metrik.ts` `kanal()`: GMV
 * dipecah live (toko+afiliasi) / video (toko+afiliasi) / kartu produk & shop
 * tab (sisa). Live+video di sini SUDAH tersedia lewat `pdt_fact_content`
 * (`jenis='live'|'video'`, pola SAMA `rakitInputSkorTiktok` dimensi
 * LIVE/Video — tapi TANPA filter `is_akun_toko` untuk `live`, karena "kanal"
 * menjumlah toko+afiliasi jadi SATU bucket, beda dari dimensi skor LIVE yang
 * sengaja memisah keduanya, lihat docblock `rakitInputSkorTiktok`).
 *
 * **Shopee (`lengkap: false`, SELALU)** — cermin `report/shopee/metrik.ts`
 * `computeChannels()`, yang aslinya py ENAM sumber (shopee_ads, affiliate,
 * voucher, chat, meta_cpas, shopee_video). PDT hari ini baru punya penulis
 * fakta untuk DUA (modul shopee_ads_cpc/search/live ke `pdt_fact_ads`, dan
 * `pdt_fact_creator_period`) — empat sisanya (voucher, chat, meta_cpas,
 * shopee_video) terdaftar sebagai modul parser (`PDT_MODULES`) tapi NOL
 * penulis fakta (pekerjaan terpisah, di luar cakupan "kanal"). `lengkap:
 * false` PERMANEN sampai keempatnya dibangun — FE WAJIB menampilkan catatan
 * eksplisit (`docs/DECISIONS.md` 2026-09-16 "kanal"), supaya GMV kanal yang
 * belum terproses tidak disalahartikan sebagai GMV kanal yang memang nol.
 *
 * GMV total penyebut persentase: TikTok = `pdt_fact_shop_daily` basis
 * `'net'` (GROSS, SAMA penyebut `report/metrik.ts` — "shares diambil
 * terhadap GMV KOTOR"); Shopee = basis `'dibuat'` (Pesanan Dibuat, cermin
 * `computeChannels`'s `bisnis_home.pesanan_dibuat.summary.penjualan`) — BEDA
 * dari basis `'siap_dikirim'` yang dipakai KPI ringkas laporan (Rule 16),
 * pola sama asimetri basis yang sudah ada di `rakitInputSkorShopee`
 * (Conversion & Retention basis `'dibuat'` juga, tujuan berbeda dari KPI).
 */
export interface PdtLaporanKanalItem {
  kode: string;
  label: string;
  gmv: number | null;
  /** `null` bila `gmv` `null` (sumber tidak diketahui, BUKAN nol) ATAU `gmvTotal` 0. */
  persen: number | null;
}

export interface PdtLaporanKanal {
  gmvTotal: number | null;
  items: PdtLaporanKanalItem[];
  /** `false` = ADA sumber kanal legacy yang belum tercakup di sini (lihat docblock di atas) — FE wajib menampilkan catatan, bukan diam-diam menganggap kanal itu lengkap. */
  lengkap: boolean;
}

const kanalItem = (kode: string, label: string, gmv: number | null, gmvTotal: number): PdtLaporanKanalItem => ({
  kode,
  label,
  gmv: bulat(gmv),
  persen: gmv == null || gmvTotal === 0 ? null : persen5(gmv / gmvTotal),
});

/** Agregat `pdt_fact_shop_daily`(basis `'net'`) + `pdt_fact_content` untuk satu periode. `live`/`video` `null` = nol baris `pdt_fact_content` jenis terkait (tidak diketahui, BUKAN nol GMV — cermin null-aware mix `baseline/metrik.ts`). */
export interface PdtLaporanKanalInputTiktok {
  gmvTotal: number;
  live: number | null;
  video: number | null;
}

/** Rakit "kanal" TikTok. `kartu` (sisa) hanya dihitung bila `live` DAN `video` KEDUANYA diketahui — mengurangkan komponen yang tidak diketahui akan membesar-kecilkan sisa secara palsu (cermin `other` null-aware `baseline/metrik.ts`). */
export function bangunKanalTiktok(input: PdtLaporanKanalInputTiktok | null): PdtLaporanKanal {
  if (input == null) return { gmvTotal: null, items: [], lengkap: true };
  const kartu = input.live == null || input.video == null ? null : Math.max(0, input.gmvTotal - input.live - input.video);
  return {
    gmvTotal: bulat(input.gmvTotal),
    items: [
      kanalItem('live', 'LIVE', input.live, input.gmvTotal),
      kanalItem('video', 'Video', input.video, input.gmvTotal),
      kanalItem('kartu', 'Kartu Produk / Shop Tab', kartu, input.gmvTotal),
    ],
    lengkap: true,
  };
}

/** Agregat `pdt_fact_shop_daily`(basis `'dibuat'`) + `pdt_fact_ads` + `pdt_fact_creator_period`. `shopeeAds`/`affiliate` `null` = nol baris sumber terkait di periode ini (tidak diketahui, BUKAN nol). */
export interface PdtLaporanKanalInputShopee {
  gmvTotal: number;
  shopeeAds: number | null;
  affiliate: number | null;
}

/** Rakit "kanal" Shopee — SELALU `lengkap: false` (lihat docblock tipe `PdtLaporanKanal` di atas untuk empat sumber legacy yang belum tercakup). */
export function bangunKanalShopee(input: PdtLaporanKanalInputShopee | null): PdtLaporanKanal {
  if (input == null) return { gmvTotal: null, items: [], lengkap: false };
  return {
    gmvTotal: bulat(input.gmvTotal),
    items: [
      kanalItem('shopee_ads', 'Shopee Ads', input.shopeeAds, input.gmvTotal),
      kanalItem('affiliate', 'Affiliate', input.affiliate, input.gmvTotal),
    ],
    lengkap: false,
  };
}

const desimal2 = (v: number | null | undefined): number | null =>
  v == null || !isFinite(v) ? null : Math.round(v * 100) / 100;

/**
 * Bagian "live" (Live Streaming) — keputusan pemilik via `AskUserQuestion`
 * 2026-09-16 (bagian keempat, setelah kpi/kanal/skor): SATU bentuk BERSAMA
 * untuk TikTok+Shopee (beda dari "kanal", yang butuh dua bentuk berbeda) —
 * investigasi menemukan `pdt_fact_content` jenis `'live'` (`tt_live`/
 * `shopee_live`, keduanya sudah punya penulis fakta sejak G1-09) membawa
 * KOLOM YANG SAMA PERSIS untuk kedua platform, dan SAMA-SAMA tipis: hanya
 * `vv`+`gmv` yang pernah diisi kedua penulis; `durasi_detik` (jam siaran)
 * HANYA diisi `tt_live`, `shopee_live` menulis `null` literal (nol kolom
 * durasi di sumbernya) — `likes`/`komentar`/`produk_dilihat`/`pengikut_baru`
 * ada di skema tapi TIDAK PERNAH diisi kedua penulis, jadi TIDAK diikutkan
 * di sini (mengarang 0 dari kolom yang genuinely kosong melanggar aturan
 * rumah #7). Nol asimetri PLATFORM (beda dari "kanal"/nanti "iklan") —
 * `lengkap` TIDAK dibutuhkan, TikTok dan Shopee mendapat bentuk yang SAMA,
 * cuma `jam`/`gmvPerJam` akan `null` untuk Shopee (kolom sumbernya memang
 * kosong permanen, bukan kekurangan cakupan platform).
 *
 * Whole-object `null` saat nol sesi live sama sekali di periode ini — cermin
 * `rakitInputSkorTiktok`'s dimensi LIVE (`liveRow.sesi === 0 ? null : {...}`,
 * Rule 12), BUKAN "sesi: 0" yang mengarang aktivitas yang tidak diketahui.
 */
export interface PdtLaporanLive {
  sesi: number;
  gmv: number | null;
  vv: number | null;
  /** Jam siaran (durasi_detik / 3600) — `null` untuk SELURUH baris Shopee (kolom sumbernya kosong permanen), terisi untuk TikTok. */
  jam: number | null;
  gmvPerSesi: number | null;
  /** `null` bila `gmv`/`jam` `null` ATAU `jam` 0. */
  gmvPerJam: number | null;
}

/** Agregat `pdt_fact_content` jenis `'live'` untuk satu periode. `gmv`/`vv`/`jam` `null` = nol baris dengan kolom itu terisi (tidak diketahui, BUKAN nol). */
export interface PdtLaporanLiveInput {
  sesi: number;
  gmv: number | null;
  vv: number | null;
  jam: number | null;
}

/** Rakit "live". `null` (whole object) bila `input` `null` ATAU `sesi` 0 — lihat docblock tipe di atas. */
export function bangunLaporanLive(input: PdtLaporanLiveInput | null): PdtLaporanLive | null {
  if (input == null || input.sesi === 0) return null;
  const gmv = bulat(input.gmv);
  const jam = desimal2(input.jam);
  return {
    sesi: input.sesi,
    gmv,
    vv: bulat(input.vv),
    jam,
    gmvPerSesi: gmv == null ? null : bulat(gmv / input.sesi),
    gmvPerJam: gmv == null || jam == null || jam === 0 ? null : bulat(gmv / jam),
  };
}

export interface PdtLaporanTiktok {
  schema: 'cdps.pdt.laporan.tiktok.v1';
  platform: 'tiktok';
  clientPlatformId: number;
  periodeAwalBulan: string;
  generatedAt: string;
  kpi: PdtLaporanKpiRingkas;
  kanal: PdtLaporanKanal;
  live: PdtLaporanLive | null;
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
  kanal: PdtLaporanKanal;
  live: PdtLaporanLive | null;
  skor: PdtSkorHasilShopee;
}

export interface PdtLaporanTiktokOptions {
  clientPlatformId: number;
  periodeAwalBulan: string;
  generatedAt: string;
  kpi: PdtLaporanKpiInput | null;
  kanal: PdtLaporanKanalInputTiktok | null;
  live: PdtLaporanLiveInput | null;
  skor: PdtSkorHasilTiktok;
  benchmarkVersi: number;
}

export interface PdtLaporanShopeeOptions {
  clientPlatformId: number;
  periodeAwalBulan: string;
  generatedAt: string;
  kpi: PdtLaporanKpiInput | null;
  kanal: PdtLaporanKanalInputShopee | null;
  live: PdtLaporanLiveInput | null;
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
    kanal: bangunKanalTiktok(opts.kanal),
    live: bangunLaporanLive(opts.live),
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
    kanal: bangunKanalShopee(opts.kanal),
    live: bangunLaporanLive(opts.live),
    skor: opts.skor,
  };
}
