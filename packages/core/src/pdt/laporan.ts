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
 * tidak simetris, ditandai `lengkap: false`), "live" (lihat docblock
 * `PdtLaporanLive` di bawah — keputusan pemilik via `AskUserQuestion`
 * KETIGA, 2026-09-16: SATU bentuk bersama, nol asimetri platform kali ini),
 * "video" (lihat docblock `PdtLaporanVideo` di bawah — keputusan pemilik
 * via `AskUserQuestion` KEEMPAT, 2026-09-16: TikTok-only, Shopee `null`
 * permanen karena `shopee_video` nol penulis fakta), dan sekarang "iklan"
 * (lihat docblock `PdtLaporanIklan` di bawah — keputusan pemilik via
 * `AskUserQuestion` KELIMA, 2026-09-16, setelah `tt_ads_product`/
 * `tt_ads_live` akhirnya punya penulis fakta di PR #413: KEDUA platform
 * dibangun sekaligus, TikTok `lengkap: true`, Shopee `lengkap: false`
 * PERMANEN karena `ads_banner` legacy tidak pernah punya modul PDT), dan
 * sekarang "afiliasi" (lihat docblock `PdtLaporanAfiliasi` di bawah —
 * keputusan pemilik via `AskUserQuestion` KEENAM, 2026-09-16: RINGKASAN saja
 * untuk KEDUA platform, BUKAN daftar per-kreator, karena `pdt_fact_creator_
 * period` tidak pernah punya kolom `refund`/`komisi`/`roiKomisi` yang
 * dibawa mesin lama), dan sekarang "tahap" (lihat docblock `PdtLaporanTahap`
 * di bawah — keputusan pemilik via `AskUserQuestion` KETUJUH, dua ronde,
 * 2026-09-16: TikTok-ONLY, Shopee `null` PERMANEN karena mesin lama Shopee
 * tidak pernah punya konsep buyer-journey sama sekali — bukan gap data
 * seperti "video"; v1 SENGAJA menerima banyak `null` per field karena
 * `ttam`/TikTok Ads Manager belum punya modul PDT sama sekali), dan sekarang
 * "insight" (lihat docblock `PdtLaporanInsight` di bawah — keputusan pemilik
 * via `AskUserQuestion` KEDELAPAN dan KESEMBILAN, dua keputusan terpisah,
 * 2026-09-16: KEDUA platform SATU bentuk, rekomendasi generik dari
 * `skor.dimensi` BUKAN porting penuh aturan per-metrik mesin lama; dan
 * penyuntingan teks oleh AM terjadi di layar pratinjau FE sebelum kirim,
 * BUKAN lewat state machine draft/publikasi/revisi terpisah seperti mesin
 * lama — PDT-21 "snapshot beku HANYA saat dikirim" tetap utuh) sudah bisa
 * dibangun dari `pdt_fact_*` — TIGA bagian lain (produk, tokopedia,
 * ads_manager) butuh fungsi agregasi fakta BARU per bagian (pola sama
 * `rakitInputSkorTiktok`/`rakitInputSkorShopee`) yang belum ada satupun,
 * pekerjaan multi-sesi. Tiga bagian sisanya TETAP di luar cakupan,
 * ditambahkan satu-per-satu sesi berikutnya seperti pola G1-09 fact-writer,
 * TIDAK ditebak/dibangun sekaligus di sini.
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

import { dec, num, pct, rp } from '../baseline/angka';
import type { PdtDimensiSkorHasil } from './parsestatus';
import { SKOR_PERHATIAN_MIN, SKOR_SEHAT_MIN, type PdtBenchmarkTiktok, type PdtSkorHasilShopee, type PdtSkorHasilTiktok } from './skor';

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
 * Bagian "iklan" — dibangun 2026-09-16 setelah `tt_ads_product`/`tt_ads_live`
 * AKHIRNYA punya penulis fakta (PR #413, sebelumnya nol writer TikTok sama
 * sekali, root cause yang memblokir bagian ini). Keputusan pemilik via
 * `AskUserQuestion`: KEDUA platform dibangun SEKALIGUS (beda dari "video"
 * yang harus TikTok-only karena Shopee genuinely nol writer) — TAPI TETAP
 * TIDAK SIMETRIS, alasan BEDA dari "kanal": bukan writer yang belum
 * dibangun, tapi mesin lama Shopee (`report/shopee/detect.ts`/`metrik.ts`)
 * py EMPAT sumber iklan asli (`ads_toko`/`ads_produk`/`ads_banner`/
 * `ads_live`) dan `ads_banner` TIDAK PERNAH punya modul PDT sama sekali
 * (bukan modul terdaftar seperti `shopee_video` — nol jejak sama sekali).
 * TikTok sebaliknya HANYA punya DUA sumber iklan asli (`tt_ads_product`/
 * `tt_ads_live`, Ads Manager) — keduanya SUDAH lengkap sejak PR #413, jadi
 * `lengkap: true` PERMANEN untuk TikTok, `lengkap: false` PERMANEN untuk
 * Shopee (mirip pola "kanal", beda root cause).
 *
 * `roas` PER ITEM dan TOTAL diturunkan `Σgmv ÷ Σbiaya` (bukan rata-rata
 * kolom `roas` mentah per baris) — cermin pola `tt_ads_product`/
 * `tt_ads_live` writer (`fakta.ts`) dan preseden `rakitInputSkorShopee`'s
 * dimensi `ads` (biaya/omzet dijumlah dulu, rasio dihitung SETELAHNYA).
 *
 * Whole-object `null` saat nol baris iklan SELURUH sumber platform ini di
 * periode ini (cermin Rule 12/pola "live"/"video"), BUKAN objek kosong
 * ber-`items: []` — beda dari "kanal" yang selalu objek ada (dekomposisi
 * GMV toko yang selalu ada), "iklan" adalah dimensi aktivitas (klien bisa
 * genuinely tidak beriklan sama sekali di suatu bulan).
 */
export interface PdtLaporanIklanItem {
  kode: string;
  label: string;
  biaya: number | null;
  gmv: number | null;
  /** `null` bila `gmv` `null` (belum diketahui) ATAU `biaya` 0. */
  roas: number | null;
}

export interface PdtLaporanIklan {
  biaya: number | null;
  gmv: number | null;
  roas: number | null;
  items: PdtLaporanIklanItem[];
  /** `false` = ADA sumber iklan legacy yang tidak pernah punya modul PDT (SELALU false untuk Shopee — `ads_banner`) — FE wajib menampilkan catatan. */
  lengkap: boolean;
}

const iklanItem = (kode: string, label: string, biaya: number | null, gmv: number | null): PdtLaporanIklanItem => ({
  kode,
  label,
  biaya: bulat(biaya),
  gmv: bulat(gmv),
  roas: biaya == null || gmv == null || biaya === 0 ? null : desimal2(gmv / biaya),
});

/** Agregat `pdt_fact_ads` sumber `tt_ads_product`/`tt_ads_live` untuk satu periode. `null` per sumber = nol baris sumber itu (tidak diketahui, BUKAN nol). */
export interface PdtLaporanIklanInputTiktok {
  product: { biaya: number; gmv: number | null } | null;
  live: { biaya: number; gmv: number | null } | null;
}

/** Rakit "iklan" TikTok — SELALU `lengkap: true` (dua sumber asli, keduanya sudah punya penulis fakta). `null` (whole object) bila kedua sumber nol baris. */
export function bangunIklanTiktok(input: PdtLaporanIklanInputTiktok | null): PdtLaporanIklan | null {
  if (input == null || (input.product == null && input.live == null)) return null;
  const biayaTotal = (input.product?.biaya ?? 0) + (input.live?.biaya ?? 0);
  const gmvDiketahui = input.product?.gmv != null || input.live?.gmv != null;
  const gmvTotal = gmvDiketahui ? (input.product?.gmv ?? 0) + (input.live?.gmv ?? 0) : null;
  return {
    biaya: bulat(biayaTotal),
    gmv: gmvTotal == null ? null : bulat(gmvTotal),
    roas: gmvTotal == null || biayaTotal === 0 ? null : desimal2(gmvTotal / biayaTotal),
    items: [
      iklanItem('tt_ads_product', 'Iklan Produk', input.product?.biaya ?? null, input.product?.gmv ?? null),
      iklanItem('tt_ads_live', 'Iklan Live', input.live?.biaya ?? null, input.live?.gmv ?? null),
    ],
    lengkap: true,
  };
}

/** Agregat `pdt_fact_ads` sumber `shopee_ads_cpc`/`search`/`live` untuk satu periode. `null` per sumber = nol baris sumber itu (tidak diketahui, BUKAN nol). */
export interface PdtLaporanIklanInputShopee {
  cpc: { biaya: number; gmv: number | null } | null;
  search: { biaya: number; gmv: number | null } | null;
  live: { biaya: number; gmv: number | null } | null;
}

/** Rakit "iklan" Shopee — SELALU `lengkap: false` (`ads_banner` tidak pernah punya modul PDT, lihat docblock tipe di atas). `null` (whole object) bila ketiga sumber nol baris. */
export function bangunIklanShopee(input: PdtLaporanIklanInputShopee | null): PdtLaporanIklan | null {
  if (input == null || (input.cpc == null && input.search == null && input.live == null)) return null;
  const biayaTotal = (input.cpc?.biaya ?? 0) + (input.search?.biaya ?? 0) + (input.live?.biaya ?? 0);
  const gmvDiketahui = input.cpc?.gmv != null || input.search?.gmv != null || input.live?.gmv != null;
  const gmvTotal = gmvDiketahui ? (input.cpc?.gmv ?? 0) + (input.search?.gmv ?? 0) + (input.live?.gmv ?? 0) : null;
  return {
    biaya: bulat(biayaTotal),
    gmv: gmvTotal == null ? null : bulat(gmvTotal),
    roas: gmvTotal == null || biayaTotal === 0 ? null : desimal2(gmvTotal / biayaTotal),
    items: [
      iklanItem('shopee_ads_cpc', 'Iklan Toko (CPC)', input.cpc?.biaya ?? null, input.cpc?.gmv ?? null),
      iklanItem('shopee_ads_search', 'Iklan Pencarian', input.search?.biaya ?? null, input.search?.gmv ?? null),
      iklanItem('shopee_ads_live', 'Iklan Live', input.live?.biaya ?? null, input.live?.gmv ?? null),
    ],
    lengkap: false,
  };
}

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

/**
 * Bagian "video" (Video/Konten) — bagian KELIMA, keputusan pemilik via
 * `AskUserQuestion` 2026-09-16: TikTok-only. `pdt_fact_content` jenis
 * `'video'` HANYA punya penulis fakta `tt_video` (G1-09) — `shopee_video`
 * cuma modul parser TERDAFTAR di `PDT_MODULES`, NOL baris pernah ditulis
 * (beda dari "kanal": bukan cakupan parsial, memang kosong permanen sampai
 * ada yang membangun writer-nya, pekerjaan terpisah di luar cakupan ini).
 *
 * Query di sini TETAP platform-agnostic (SATU fungsi baca, sama pola
 * `bangunLaporanLive`) — Shopee otomatis dapat `null` karena nol baris,
 * BUKAN karena filter platform eksplisit. FE yang membedakan pesannya:
 * TikTok nol video di periode ini vs Shopee belum didukung sama sekali
 * (FE sudah tahu platform dari `laporan.platform`).
 *
 * SELURUH baris (toko + afiliasi) diikutkan, TIDAK difilter `is_akun_toko`
 * — cermin persis dimensi skor Video (`rakitInputSkorTiktok`, docblock di
 * atasnya: "`videoReport` mesin lama menerima `vid_toko` DAN `vid_aff`
 * sekaligus"), beda dari dimensi skor LIVE yang sengaja memisah toko vs
 * afiliasi.
 *
 * Hanya kolom yang benar-benar diisi `tt_video` yang diikutkan: `vv`,
 * `likes`, `dibagikan`, `klik_produk`, `gmv`. `komentar`/`pengikut_baru`/
 * `produk_dilihat` ada di skema tapi TIDAK PERNAH diisi modul ini — TIDAK
 * diikutkan (aturan rumah #7, sama alasan "live" mengecualikan kolom
 * serupa).
 *
 * Whole-object `null` saat nol baris video di periode ini — cermin
 * `bangunLaporanLive`/Rule 12, BUKAN `total: 0` yang mengarang aktivitas.
 */
export interface PdtLaporanVideo {
  total: number;
  gmv: number | null;
  vv: number | null;
  likes: number | null;
  dibagikan: number | null;
  klikProduk: number | null;
  gmvPerVideo: number | null;
  /** `null` bila `vv` `null`. */
  vvPerVideo: number | null;
}

/** Agregat `pdt_fact_content` jenis `'video'` untuk satu periode. `gmv`/`vv`/`likes`/`dibagikan`/`klikProduk` `null` = nol baris dengan kolom itu terisi (tidak diketahui, BUKAN nol). */
export interface PdtLaporanVideoInput {
  total: number;
  gmv: number | null;
  vv: number | null;
  likes: number | null;
  dibagikan: number | null;
  klikProduk: number | null;
}

/** Rakit "video". `null` (whole object) bila `input` `null` ATAU `total` 0 — lihat docblock tipe di atas. */
export function bangunLaporanVideo(input: PdtLaporanVideoInput | null): PdtLaporanVideo | null {
  if (input == null || input.total === 0) return null;
  const gmv = bulat(input.gmv);
  const vv = bulat(input.vv);
  return {
    total: input.total,
    gmv,
    vv,
    likes: bulat(input.likes),
    dibagikan: bulat(input.dibagikan),
    klikProduk: bulat(input.klikProduk),
    gmvPerVideo: gmv == null ? null : bulat(gmv / input.total),
    vvPerVideo: vv == null ? null : bulat(vv / input.total),
  };
}

/**
 * Bagian "afiliasi" (ringkasan) — bagian KEENAM, keputusan pemilik via
 * `AskUserQuestion` 2026-09-16: RINGKASAN saja untuk KEDUA platform sekaligus,
 * BUKAN daftar per-kreator (`top`/`nempelList` mesin lama, `report/metrik.ts`
 * `affiliateReport`). Mesin lama juga membawa `refund`/`komisi`/`roiKomisi`
 * per kreator (`KreatorRec`) — `pdt_fact_creator_period` TIDAK PERNAH punya
 * kolom itu sama sekali (bukan kekurangan writer, skema migrasi
 * `20261011010000` §5e memang tidak menyediakannya; `komisi`/`ROI` Shopee
 * sengaja tidak dipetakan ke tabel ini sejak awal — lihat docblock
 * `ekstrakBarisKreatorShopeeAmsAfiliasi`, `PDT_KOLOM_DIPANEN.md` §2.10, milik
 * PX Flow D, konsumen domain lain yang belum dibangun) — jadi `refund`/
 * `netGmv`/`refundRate`/`komisi`/`roiKomisi` TIDAK bisa direplikasi di PDT
 * hari ini, TIDAK ditebak di sini.
 *
 * Query di sini TETAP platform-agnostic (SATU fungsi baca, SATU bentuk —
 * pola sama "live"): `pdt_fact_creator_period` punya kolom yang SAMA PERSIS
 * untuk kedua platform, TikTok (`tt_transaction_creator`) mengisi
 * `pesananTeratribusi`/`jumlahLive`/`jumlahVideo`, Shopee (`shopee_ams_
 * afiliasi`) HANYA `gmv`/`pesananTeratribusi` — Shopee otomatis dapat
 * `jumlahLive`/`jumlahVideo` `null` karena nol baris berkolom itu, BUKAN
 * filter platform eksplisit (nol `lengkap` flag dibutuhkan, sama alasan
 * "live"/"video": null-aware per-field sudah cukup mengomunikasikan celah).
 *
 * `produktif` = jumlah baris ber-`gmv > 0` — cermin PERSIS
 * `rakitInputSkorTiktok`'s dimensi Affiliate (`coalesce(gmv, 0) > 0`,
 * `KreatorRec.produktif` mesin lama) dan `affiliateReport`'s
 * `produktif: gmv > 0`. `aov` (rata-rata nilai pesanan) SELALU DITURUNKAN
 * `Σgmv ÷ Σpesanan` SETELAH dijumlah (konvensi `roas`/`cvr` yang sama,
 * BUKAN dibaca dari kolom mentah `aov` per-baris yang TikTok bawa — rata-
 * rata dari rata-rata membiaskan kreator kecil). `ctor` (per-kreator, tidak
 * pernah punya agregat toko-level di mesin lama sekalipun) SENGAJA TIDAK
 * diikutkan — nol preseden cara menjumlahkannya secara bermakna.
 *
 * Whole-object `null` saat nol baris kreator sama sekali di periode ini —
 * cermin Rule 12/`bangunLaporanLive`/`bangunLaporanVideo`.
 */
export interface PdtLaporanAfiliasi {
  totalKreator: number;
  produktif: number;
  gmv: number | null;
  pesanan: number | null;
  /** Σgmv ÷ Σpesanan — `null` bila `gmv`/`pesanan` `null` ATAU `pesanan` 0. */
  aov: number | null;
  jumlahLive: number | null;
  jumlahVideo: number | null;
}

/** Agregat `pdt_fact_creator_period` untuk satu periode. `gmv`/`pesanan`/`jumlahLive`/`jumlahVideo` `null` = nol baris berkolom itu (tidak diketahui, BUKAN nol) — lihat docblock tipe di atas. */
export interface PdtLaporanAfiliasiInput {
  totalKreator: number;
  produktif: number;
  gmv: number | null;
  pesanan: number | null;
  jumlahLive: number | null;
  jumlahVideo: number | null;
}

/** Rakit "afiliasi". `null` (whole object) bila `input` `null` ATAU `totalKreator` 0 — lihat docblock tipe di atas. */
export function bangunLaporanAfiliasi(input: PdtLaporanAfiliasiInput | null): PdtLaporanAfiliasi | null {
  if (input == null || input.totalKreator === 0) return null;
  const gmv = bulat(input.gmv);
  const pesanan = bulat(input.pesanan);
  return {
    totalKreator: input.totalKreator,
    produktif: input.produktif,
    gmv,
    pesanan,
    aov: gmv == null || pesanan == null || pesanan === 0 ? null : bulat(gmv / pesanan),
    jumlahLive: bulat(input.jumlahLive),
    jumlahVideo: bulat(input.jumlahVideo),
  };
}

/**
 * Bagian "tahap" (buyer-journey Awareness→Consideration→Conversion) — bagian
 * KETUJUH, keputusan pemilik via `AskUserQuestion` KETUJUH (dua ronde,
 * 2026-09-16): TikTok-ONLY, Shopee `null` PERMANEN — BUKAN gap data seperti
 * "video" (Shopee `shopee_video` sekadar belum punya writer), tapi mesin
 * lama Shopee (`report/shopee/`) TIDAK PERNAH punya konsep buyer-journey
 * SAMA SEKALI: `report/shopee/insight.ts` eksplisit "Shopee has no
 * buyer-journey layer yet (that engine's exports carry a different
 * funnel)... the day Shopee gets its own stages, only this line moves."
 * `funnel`/`blok`/`tahapFokus` adalah konsep TikTok-only di produksi —
 * membangun bentuk Shopee di sini berarti MENGARANG section yang tidak
 * pernah dirancang di sistem manapun, bukan porting.
 *
 * **v1 SENGAJA menerima banyak `null`** (ronde pertama `AskUserQuestion`):
 * mesin lama (`report/tahap.ts`) adalah reprojection MURNI atas
 * `ReportMetrics` — tapi field-nya banyak bersumber dari `M.ttam`
 * (TikTok Ads Manager 4-tipe export: consideration/follows/showcase/
 * videoviews), yang SAMA SEKALI belum punya modul PDT (sekelas "produk"
 * kuadran — tabel+parser+writer baru, bukan sekadar agregasi). Setiap
 * field yang bergantung `ttam` PERMANEN `null` di sini sampai modul itu
 * dibangun (pekerjaan terpisah, TIDAK ditebak).
 *
 * **`flag`/`band` (pewarnaan hijau/kuning/merah per metrik) SENGAJA TIDAK
 * diikutkan v1 ini** — keputusan desain, bukan gap data: mesin lama
 * mengambil band dari `pdt_benchmark`/ambang hardcode yang SUDAH dipakai
 * `skor` (dimensi `Conversion & Retention`/`ROAS & Channel` di
 * `laporan.skor.dimensi`), jadi AM tetap bisa menilai warna dari situ.
 * Menduplikasi pipa `pdt_benchmark` ke konsumen KEDUA sebelum ada
 * kebutuhan nyata menambah kompleksitas tanpa fakta baru. Bisa ditambah
 * sesi lain kalau AM benar-benar butuh warna di level tahap.
 *
 * **Empat sumber data BARU (bukan reuse murni bagian lain)**, diverifikasi
 * satu-per-satu terhadap skema (bukan ditebak):
 *  - **Impresi produk** (rung funnel pertama) — mesin lama membacanya dari
 *    kolom `Impresi produk` sheet ringkasan toko (`baseline/metrik.ts`
 *    `toko()`). Kolom itu TIDAK ADA di `pdt_fact_shop_daily` sama sekali
 *    (hanya `produk_diklik`, bukan `impresi`) — `pdt_fact_sku_period.impresi`
 *    ADA tapi grain-nya PER SKU untuk tujuan kuadran, menjumlahkannya jadi
 *    "impresi toko" adalah asumsi FK-lookup kelas sama `G1-09-2BII-ADS-CPC-
 *    SKU` yang sudah terbukti salah sekali — TIDAK dicoba di sini. Rung ini
 *    PERMANEN `null` dengan `catatan` eksplisit, sama pola rung "Add to
 *    Cart" mesin lama sendiri (kolom genuinely tidak ada, bukan 0).
 *  - **Klik ke halaman produk** — `pdt_fact_shop_daily.produk_diklik`
 *    (basis `'net'`, SAMA basis dengan KPI ringkas TikTok) SUDAH ditulis
 *    writer sejak G1-09, tapi belum pernah dibaca laporan manapun — query
 *    baru `bacaTahapTiktok`.
 *  - **CPA (Biaya per pesanan, GMV Max)** — `pdt_fact_ads.pesanan_sku`
 *    SUDAH ditulis KELIMA modul ads (termasuk `tt_ads_product`/
 *    `tt_ads_live`) tapi bagian "iklan" tidak pernah membacanya (cuma
 *    biaya/gmv). Query baru menjumlah `biaya`/`pesanan_sku` sumber
 *    `tt_ads_*` — TERPISAH dari `bacaIklanTiktok` (tidak mengubah bentuk
 *    "iklan" yang sudah merge, blast radius minimal).
 *  - **Kreator memposting konten** (`aff_posting`) — hitungan BARU: baris
 *    `pdt_fact_creator_period` ber-`jumlah_live>0 OR jumlah_video>0`.
 *    `null` bila nol baris kreator sama sekali (cermin konvensi
 *    `bacaAfiliasi`), BUKAN 0 kreator posting.
 *
 * Sisanya REUSE LANGSUNG bagian lain yang sudah dibangun (nol query baru):
 * `gmv`/`pesanan`/`cvr` dari `kpi`, `aov` diturunkan `gmv÷pesanan` (konvensi
 * `roas`/`aov` afiliasi — SETELAH dijumlah, bukan dibaca mentah), `roi` dari
 * `iklan.roas`, `aff_total`/`aff_produktif` dari `afiliasi.totalKreator`/
 * `.produktif`, `konten_n`/`konten_vv` dari `video.total`/`.vv`.
 * `konten_follower`/semua field awareness selain `konten_n`/`konten_vv`
 * PERMANEN `null` — `pengikut_baru` (`pdt_fact_content`) TIDAK PERNAH diisi
 * `tt_video`/`shopee_live` (literal `null` di setiap INSERT, diverifikasi
 * baris kode, sama alasan "video" mengecualikannya). `tp_gmv` (Tokopedia)
 * PERMANEN `null` (PDT-22, di luar cakupan PDT).
 *
 * `belanjaTotal`/`belanjaPersen` per blok: pola SAMA mesin lama (spend
 * dikelompokkan per TUJUAN campaign, bukan per hasil) — tapi karena
 * awareness/consideration spend SELURUHNYA dari `ttam` (permanen null),
 * `belanjaTotal` PRAKTIKNYA = `iklan.biaya` (spend conversion/GMV Max saja)
 * sampai `ttam` dibangun — `belanjaPersen` conversion akan selalu 100% untuk
 * sementara, itu JUJUR terhadap data yang ada, bukan bug.
 *
 * Whole-object `null` saat `kpi` seluruhnya `null` (nol baris
 * `pdt_fact_shop_daily` basis `'net'` periode ini) — cermin Rule 12/pola
 * bagian lain, tidak ada apa pun untuk direproyeksikan.
 */
export type PdtTahapKey = 'awareness' | 'consideration' | 'conversion';

/** Satu rung funnel. `lolos` = share dari rung SEBELUMNYA yang punya nilai (bukan rung persis di atasnya) — `null` bila salah satu sisi tidak diketahui, TIDAK PERNAH 0 (aturan rumah #7: "tidak terukur" ≠ "nol"). */
export interface PdtLaporanFunnelLangkah {
  kode: string;
  label: string;
  nilai: number | null;
  lolos: number | null;
  /** Label rung yang jadi pembanding `lolos`; `null` untuk rung pertama yang punya nilai. */
  lolosDari: string | null;
  /** Kenapa rung ini `null` — `null` bila rung ini punya nilai. */
  catatan: string | null;
}

export type PdtTahapSatuan = 'rupiah' | 'angka' | 'persen' | 'kali';

export interface PdtLaporanTahapMetrik {
  kode: string;
  label: string;
  nilai: number | null;
  satuan: PdtTahapSatuan;
}

export interface PdtLaporanTahapBlok {
  kode: PdtTahapKey;
  label: string;
  /** `true` untuk blok yang jadi fokus AM (`client_platforms.tahap_fokus`). Seluruhnya `false` bila belum diset. */
  fokus: boolean;
  belanja: number | null;
  belanjaPersen: number | null;
  metrik: PdtLaporanTahapMetrik[];
}

export interface PdtLaporanTahap {
  fokus: PdtTahapKey | null;
  funnel: PdtLaporanFunnelLangkah[];
  /** Σpesanan÷Σpengunjung — SATU rate di layer ini yang jadi acuan (rung funnel sendiri tidak dinilai, lihat docblock tipe di atas). */
  konversiTotal: { nilai: number | null };
  belanjaTotal: number | null;
  blok: PdtLaporanTahapBlok[];
}

const TAHAP_LABEL: Record<PdtTahapKey, string> = { awareness: 'Awareness', consideration: 'Consideration', conversion: 'Conversion' };
const ALL_TAHAP: readonly PdtTahapKey[] = ['awareness', 'consideration', 'conversion'];

function isPdtTahapKey(v: string | null): v is PdtTahapKey {
  return v === 'awareness' || v === 'consideration' || v === 'conversion';
}

const tm = (kode: string, label: string, nilai: number | null, satuan: PdtTahapSatuan): PdtLaporanTahapMetrik =>
  ({ kode, label, nilai, satuan });

function buildFunnelTiktok(kpi: PdtLaporanKpiRingkas, klik: number | null): PdtLaporanFunnelLangkah[] {
  const rows: Omit<PdtLaporanFunnelLangkah, 'lolos' | 'lolosDari'>[] = [
    { kode: 'impresi', label: 'Impresi produk', nilai: null, catatan: 'kolom impresi toko belum ada di skema PDT saat ini' },
    { kode: 'klik', label: 'Klik ke halaman produk', nilai: klik, catatan: klik == null ? 'tidak ada di export Analitik Toko periode ini' : null },
    { kode: 'pengunjung', label: 'Pengunjung toko', nilai: kpi.pengunjung, catatan: null },
    { kode: 'atc', label: 'Add to Cart', nilai: null, catatan: 'hanya terbaca dari export Ads Manager Showcase — belum dibangun' },
    { kode: 'pesanan', label: 'Pesanan', nilai: kpi.pesanan, catatan: null },
  ];

  const out: PdtLaporanFunnelLangkah[] = [];
  let prev: { label: string; nilai: number } | null = null;
  for (const r of rows) {
    const lolos = prev && r.nilai != null ? r.nilai / prev.nilai : null;
    out.push({ ...r, lolos: lolos == null ? null : persen5(lolos), lolosDari: lolos == null ? null : prev!.label });
    if (r.nilai != null) prev = { label: r.label, nilai: r.nilai };
  }
  return out;
}

/** Agregat BARU khusus "tahap" TikTok — lihat docblock `PdtLaporanTahap` untuk sumber tiap field. */
export interface PdtLaporanTahapInput {
  tahapFokus: string | null;
  klik: number | null;
  cpaInput: { biaya: number; pesanan: number | null } | null;
  affPosting: number | null;
}

/**
 * Rakit "tahap" TikTok dari input BARU + bagian lain yang sudah dibangun
 * (kpi/iklan/afiliasi/video — nol query ulang, lihat docblock tipe
 * `PdtLaporanTahap`). `null` (whole object) bila `kpi` seluruhnya `null`
 * (nol baris `pdt_fact_shop_daily` basis `'net'` periode ini).
 */
export function bangunLaporanTahap(
  input: PdtLaporanTahapInput,
  kpi: PdtLaporanKpiRingkas,
  iklan: PdtLaporanIklan | null,
  afiliasi: PdtLaporanAfiliasi | null,
  video: PdtLaporanVideo | null,
): PdtLaporanTahap | null {
  if (kpi.gmv == null && kpi.pesanan == null && kpi.pengunjung == null) return null;

  const fokus = isPdtTahapKey(input.tahapFokus) ? input.tahapFokus : null;
  const aov = kpi.gmv == null || kpi.pesanan == null || kpi.pesanan === 0 ? null : bulat(kpi.gmv / kpi.pesanan);
  const cpa = input.cpaInput == null || input.cpaInput.pesanan == null || input.cpaInput.pesanan === 0
    ? null : bulat(input.cpaInput.biaya / input.cpaInput.pesanan);

  const belanja: Record<PdtTahapKey, number | null> = {
    awareness: null,
    consideration: null,
    conversion: iklan == null ? null : iklan.biaya,
  };
  const belanjaTotal = ALL_TAHAP.some((k) => belanja[k] != null)
    ? ALL_TAHAP.reduce((a, k) => a + (belanja[k] ?? 0), 0)
    : null;

  const metrik: Record<PdtTahapKey, PdtLaporanTahapMetrik[]> = {
    awareness: [
      tm('vv_impresi', 'Impresi iklan awareness', null, 'angka'),
      tm('vv_views', 'Video views (iklan)', null, 'angka'),
      tm('vv_cpm', 'CPM', null, 'rupiah'),
      tm('vv_per1k', 'Biaya per 1.000 views', null, 'rupiah'),
      tm('fol_follows', 'Follower dari campaign', null, 'angka'),
      tm('fol_cost', 'Biaya per follower', null, 'rupiah'),
      tm('konten_n', 'Konten diproduksi & tayang', video?.total ?? null, 'angka'),
      tm('konten_vv', 'Total views konten', video?.vv ?? null, 'angka'),
      tm('konten_follower', 'Follower baru dari konten', null, 'angka'),
    ],
    consideration: [
      tm('sc_impresi', 'Impresi iklan showcase', null, 'angka'),
      tm('sc_klik', 'Klik ke halaman produk (iklan)', null, 'angka'),
      tm('sc_ctr', 'CTR showcase', null, 'persen'),
      tm('sc_atc', 'Add to cart (iklan showcase)', null, 'angka'),
      tm('sc_cost_atc', 'Biaya per add to cart', null, 'rupiah'),
      tm('toko_impresi', 'Impresi produk (toko)', null, 'angka'),
      tm('toko_klik', 'Klik produk (toko)', input.klik, 'angka'),
      tm('aff_total', 'Kreator afiliasi terdaftar', afiliasi?.totalKreator ?? null, 'angka'),
      tm('aff_posting', 'Kreator memposting konten', input.affPosting, 'angka'),
    ],
    conversion: [
      tm('gmv', 'GMV', kpi.gmv, 'rupiah'),
      tm('pesanan', 'Pesanan', kpi.pesanan, 'angka'),
      tm('cvr', 'Conversion rate toko', kpi.cvr, 'persen'),
      tm('aov', 'Nilai rata-rata per pesanan', aov, 'rupiah'),
      tm('roi', 'ROI iklan konversi (GMV Max)', iklan?.roas ?? null, 'kali'),
      tm('cpa', 'Biaya per pesanan (GMV Max)', cpa, 'rupiah'),
      tm('aff_produktif', 'Kreator menghasilkan penjualan', afiliasi?.produktif ?? null, 'angka'),
      tm('tp_gmv', 'GMV ShopTokopedia', null, 'rupiah'),
    ],
  };

  return {
    fokus,
    funnel: buildFunnelTiktok(kpi, input.klik),
    konversiTotal: { nilai: kpi.cvr },
    belanjaTotal: belanjaTotal == null ? null : bulat(belanjaTotal),
    blok: ALL_TAHAP.map((kode) => ({
      kode,
      label: TAHAP_LABEL[kode],
      fokus: fokus === kode,
      belanja: belanja[kode] == null ? null : bulat(belanja[kode] as number),
      belanjaPersen: belanja[kode] == null || !belanjaTotal ? null : persen5((belanja[kode] as number) / belanjaTotal),
      metrik: metrik[kode],
    })),
  };
}

/**
 * Bagian "insight" (narasi + rekomendasi) — bagian KEDELAPAN dari sebelas
 * yang tadinya di luar cakupan v1 (lihat docblock berkas). Keputusan pemilik
 * via `AskUserQuestion` KEDELAPAN, dua ronde, 2026-09-16: KEDUA platform,
 * SATU bentuk (`PdtLaporanInsight`) — mesin lama (`report/insight.ts`
 * `buildInsights`, `report/shopee/insight.ts` `buildInsights`) py PULUHAN
 * aturan rekomendasi ber-ambang PER METRIK (mis. "ROI GMV Max < warn →
 * rekomendasi tinggi", "burn rate > 30% → rekomendasi tinggi") yang ditulis
 * ULANG per platform dan membaca bagian yang PDT belum punya sama sekali
 * (`kuadran`, `meta_cpas`, `kesehatan_toko` khusus Shopee, dll) — memPORT
 * seluruhnya tanpa verifikasi ambang per metrik untuk grain data PDT adalah
 * MENEBAK, bukan porting (preseden `G1-09-2BII-ADS-CPC-SKU`).
 *
 * **v1 SENGAJA lebih tipis**, ambang tunggal yang SUDAH diverifikasi dipakai
 * PRODUKSI untuk KEDUA platform simetris: `skor.dimensi` (`PdtDimensiSkorHasil[]`,
 * `parsestatus.ts`, sudah dipakai `computeSkorTiktok`/`computeSkorShopee`) plus
 * pita `SKOR_SEHAT_MIN`/`SKOR_PERHATIAN_MIN` (`skor.ts`, SUDAH dipakai
 * `labelSkorPdt`) — dimensi ber-`nilai < SKOR_PERHATIAN_MIN` (6) jadi
 * rekomendasi TINGGI, `< SKOR_SEHAT_MIN` (8) jadi SEDANG. Rekomendasi generik
 * per-dimensi ("perbaiki dimensi X"), BUKAN rekomendasi kaya per-metrik mesin
 * lama — v2 yang memperkaya per-metrik butuh verifikasi ambang terpisah per
 * platform, dicatat `PDT_BACKLOG.md`.
 *
 * `poin` murni MERANGKUM bagian yang SUDAH dibangun (kpi/kanal/iklan/live/
 * video/afiliasi/tahap) — nol pembacaan fakta baru, nol angka yang tidak
 * sudah ada di payload yang sama. `indikator` TikTok memakai
 * `PdtBenchmarkTiktok` yang SUDAH diverifikasi (dipakai `computeSkorTiktok`);
 * Shopee TIDAK py bench serupa (ambang skornya hardcode di `skor.ts`, lihat
 * docblock `computeSkorShopee`) jadi `indikator` Shopee HANYA skor total —
 * asimetri asli, bukan kekurangan implementasi.
 *
 * **AM tidak bisa menyunting teks ini dari sini** — keputusan pemilik via
 * `AskUserQuestion` KESEMBILAN, 2026-09-16: penyuntingan (kalau AM mau ganti
 * kalimat sebelum kirim ke klien) terjadi di LAYAR PRATINJAU (FE) sebelum
 * tombol "Kirim ke Klien" ditekan, BUKAN lewat tabel revisi/status seperti
 * `client_report_insight`/`client_report_publikasi` mesin lama — PDT-21 ("
 * snapshot beku HANYA saat dikirim") tetap utuh, `kirimLaporanPdt` tetap SATU
 * aksi atomik, nol state machine baru. Wiring override teks AM ke
 * `kirimLaporanPdt` adalah tiket TERPISAH (di luar cakupan PR ini),
 * `PDT_BACKLOG.md`.
 */
export interface PdtLaporanRekomendasi {
  judul: string;
  target: string;
  dampak: string;
  timeline: string;
}

export interface PdtLaporanInsight {
  ringkasan: string;
  poin: string[];
  rekomendasiTinggi: PdtLaporanRekomendasi[];
  rekomendasiSedang: PdtLaporanRekomendasi[];
  outlook: string;
  indikator: { nama: string; target: string }[];
}

export interface PdtLaporanInsightInput {
  platform: 'tiktok' | 'shopee';
  kpi: PdtLaporanKpiRingkas;
  kanal: PdtLaporanKanal;
  iklan: PdtLaporanIklan | null;
  live: PdtLaporanLive | null;
  video: PdtLaporanVideo | null;
  afiliasi: PdtLaporanAfiliasi | null;
  tahap: PdtLaporanTahap | null;
  skor: PdtSkorHasilTiktok | PdtSkorHasilShopee;
  benchTiktok: PdtBenchmarkTiktok | null;
}

function rekomendasiDariDimensi(dimensi: readonly PdtDimensiSkorHasil[]): { tinggi: PdtLaporanRekomendasi[]; sedang: PdtLaporanRekomendasi[] } {
  const tinggi: PdtLaporanRekomendasi[] = [];
  const sedang: PdtLaporanRekomendasi[] = [];
  for (const d of dimensi) {
    if (!d.disertakan || d.nilai == null) continue;
    if (d.nilai < SKOR_PERHATIAN_MIN) {
      tinggi.push({
        judul: `Benahi dimensi "${d.label}"`,
        target: `Skor dimensi ≥${SKOR_PERHATIAN_MIN}/10 (kini ${dec(d.nilai, 1)}/10)`,
        dampak: `Dimensi ini berbobot ${pct(d.bobotEfektif, 0)} dari skor performa total — perbaikan di sini paling terasa di skor akhir.`,
        timeline: 'Mulai periode berikutnya',
      });
    } else if (d.nilai < SKOR_SEHAT_MIN) {
      sedang.push({
        judul: `Naikkan dimensi "${d.label}" ke SEHAT`,
        target: `Skor dimensi ≥${SKOR_SEHAT_MIN}/10 (kini ${dec(d.nilai, 1)}/10)`,
        dampak: `Dimensi ini berbobot ${pct(d.bobotEfektif, 0)} dari skor performa total.`,
        timeline: 'Mulai periode berikutnya',
      });
    }
  }
  return { tinggi, sedang };
}

function poinLaporanInsight(input: PdtLaporanInsightInput): string[] {
  const { kpi, kanal, iklan, live, video, afiliasi, tahap, platform } = input;
  const poin: string[] = [];

  if (kpi.gmv != null) {
    poin.push(`GMV ${rp(kpi.gmv)}${kpi.pesanan != null ? ` dari ${num(kpi.pesanan)} pesanan` : ''}${kpi.cvr != null ? ` (CVR ${pct(kpi.cvr, 2)})` : ''}.`);
  }

  const kanalTerukur = kanal.items.filter((x) => x.gmv != null);
  if (kanalTerukur.length) {
    const top = [...kanalTerukur].sort((a, b) => (b.gmv as number) - (a.gmv as number))[0];
    poin.push(`${top.label} jadi kanal terbesar: ${rp(top.gmv)}${top.persen != null ? ` (${pct(top.persen, 1)} dari GMV)` : ''}.`);
  }
  if (!kanal.lengkap) {
    poin.push('Catatan: rincian kanal belum lengkap — sebagian sumber GMV belum punya penulis fakta PDT.');
  }

  if (iklan) {
    poin.push(`Iklan: belanja ${rp(iklan.biaya)} → GMV ${rp(iklan.gmv)}${iklan.roas != null ? ` (ROAS ${dec(iklan.roas, 2)}x)` : ''}.`);
    if (!iklan.lengkap) poin.push('Catatan: rincian iklan belum lengkap — sebagian sumber iklan legacy belum punya modul PDT.');
  }

  if (live) {
    poin.push(`LIVE: ${live.sesi} sesi${live.jam != null ? `/${dec(live.jam, 1)} jam` : ''} → ${rp(live.gmv)}${live.gmvPerJam != null ? ` (${rp(live.gmvPerJam)}/jam)` : ''}.`);
  }

  if (video) {
    poin.push(`Video: ${video.total} video → ${rp(video.gmv)}${video.vv != null ? ` dari ${num(video.vv)} views` : ''}${video.gmvPerVideo != null ? ` (${rp(video.gmvPerVideo)}/video)` : ''}.`);
  }

  if (afiliasi) {
    poin.push(`Afiliasi: ${afiliasi.produktif} dari ${afiliasi.totalKreator} kreator produktif${afiliasi.gmv != null ? `, GMV ${rp(afiliasi.gmv)}` : ''}.`);
  }

  if (platform === 'tiktok' && tahap?.fokus) {
    poin.push(`Fokus tahap buyer-journey periode ini: ${TAHAP_LABEL[tahap.fokus]}.`);
  }

  return poin;
}

function indikatorLaporanInsight(input: PdtLaporanInsightInput): { nama: string; target: string }[] {
  const arr: { nama: string; target: string }[] = [];
  if (input.skor.total != null) {
    arr.push({ nama: 'Target Skor Performa', target: `≥${SKOR_SEHAT_MIN}/10 (kini ${dec(input.skor.total, 1)}/10)` });
  }
  if (input.platform === 'tiktok' && input.benchTiktok) {
    const b = input.benchTiktok;
    arr.push({ nama: 'Target ROAS Iklan (GMV Max)', target: `≥${b.roi_gmvmax.good}x (kini ${input.iklan?.roas != null ? `${dec(input.iklan.roas, 2)}x` : '—'})` });
    arr.push({ nama: 'Target GMV/jam LIVE', target: `${rp(b.gmv_per_jam_live.warn)}+ (kini ${rp(input.live?.gmvPerJam ?? null)})` });
  }
  return arr;
}

/** Rakit "insight" v1 — nol query ulang, dirangkai dari bagian yang SUDAH dibangun (lihat docblock tipe). Tidak pernah `null` (beda dari `iklan`/`live`/`video`/`afiliasi`/`tahap`) karena `ringkasan`/`outlook` selalu punya sesuatu untuk dikatakan bahkan saat `kpi` seluruhnya `null`. */
export function bangunLaporanInsight(input: PdtLaporanInsightInput): PdtLaporanInsight {
  const { kpi, skor } = input;
  const { tinggi, sedang } = rekomendasiDariDimensi(skor.dimensi);

  const ringkasan = kpi.gmv == null
    ? 'Belum ada data GMV untuk periode ini.'
    : `GMV ${rp(kpi.gmv)}${kpi.pesanan != null ? ` dari ${num(kpi.pesanan)} pesanan` : ''}.${skor.total != null ? ` Skor performa ${dec(skor.total, 1)}/10 — ${skor.label}.` : ' Skor performa belum bisa dihitung — belum ada dimensi yang punya data periode ini.'}`;

  const outlook = kpi.gmv == null
    ? 'Target GMV bulan depan belum bisa ditentukan — GMV periode ini tidak diketahui.'
    : `Target GMV bulan depan: ${rp(kpi.gmv * 1.15)}–${rp(kpi.gmv * 1.3)} (+15–30%). Fokus: tindak lanjuti rekomendasi prioritas tinggi di atas.`;

  return {
    ringkasan,
    poin: poinLaporanInsight(input),
    rekomendasiTinggi: tinggi,
    rekomendasiSedang: sedang,
    outlook,
    indikator: indikatorLaporanInsight(input),
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
  iklan: PdtLaporanIklan | null;
  live: PdtLaporanLive | null;
  video: PdtLaporanVideo | null;
  afiliasi: PdtLaporanAfiliasi | null;
  tahap: PdtLaporanTahap | null;
  skor: PdtSkorHasilTiktok;
  benchmarkVersi: number;
  insight: PdtLaporanInsight;
}

export interface PdtLaporanShopee {
  schema: 'cdps.pdt.laporan.shopee.v1';
  platform: 'shopee';
  clientPlatformId: number;
  periodeAwalBulan: string;
  generatedAt: string;
  kpi: PdtLaporanKpiRingkas;
  kanal: PdtLaporanKanal;
  iklan: PdtLaporanIklan | null;
  live: PdtLaporanLive | null;
  video: PdtLaporanVideo | null;
  afiliasi: PdtLaporanAfiliasi | null;
  /** SELALU `null` — mesin lama Shopee tidak punya konsep buyer-journey sama sekali, lihat docblock `PdtLaporanTahap`. */
  tahap: PdtLaporanTahap | null;
  skor: PdtSkorHasilShopee;
  insight: PdtLaporanInsight;
}

export interface PdtLaporanTiktokOptions {
  clientPlatformId: number;
  periodeAwalBulan: string;
  generatedAt: string;
  kpi: PdtLaporanKpiInput | null;
  kanal: PdtLaporanKanalInputTiktok | null;
  iklan: PdtLaporanIklanInputTiktok | null;
  live: PdtLaporanLiveInput | null;
  video: PdtLaporanVideoInput | null;
  afiliasi: PdtLaporanAfiliasiInput | null;
  tahap: PdtLaporanTahapInput;
  skor: PdtSkorHasilTiktok;
  benchmarkVersi: number;
  /** Bench aktif yang SAMA dipakai `computeSkorTiktok` — dipakai `indikator` bagian "insight", nol query ulang. */
  benchTiktok: PdtBenchmarkTiktok;
}

export interface PdtLaporanShopeeOptions {
  clientPlatformId: number;
  periodeAwalBulan: string;
  generatedAt: string;
  kpi: PdtLaporanKpiInput | null;
  kanal: PdtLaporanKanalInputShopee | null;
  iklan: PdtLaporanIklanInputShopee | null;
  live: PdtLaporanLiveInput | null;
  video: PdtLaporanVideoInput | null;
  afiliasi: PdtLaporanAfiliasiInput | null;
  skor: PdtSkorHasilShopee;
}

/** Rakit payload laporan TikTok v1 — KPI basis `'net'` (Rule 15, GMV−refund; pemanggil sudah menyerahkan gmv yang SUDAH di-net-kan). */
export function bangunLaporanTiktok(opts: PdtLaporanTiktokOptions): PdtLaporanTiktok {
  const kpi = bangunKpiRingkas(opts.kpi);
  const iklan = bangunIklanTiktok(opts.iklan);
  const afiliasi = bangunLaporanAfiliasi(opts.afiliasi);
  const video = bangunLaporanVideo(opts.video);
  const kanal = bangunKanalTiktok(opts.kanal);
  const live = bangunLaporanLive(opts.live);
  const tahap = bangunLaporanTahap(opts.tahap, kpi, iklan, afiliasi, video);
  return {
    schema: 'cdps.pdt.laporan.tiktok.v1',
    platform: 'tiktok',
    clientPlatformId: opts.clientPlatformId,
    periodeAwalBulan: opts.periodeAwalBulan,
    generatedAt: opts.generatedAt,
    kpi,
    kanal,
    iklan,
    live,
    video,
    afiliasi,
    tahap,
    skor: opts.skor,
    benchmarkVersi: opts.benchmarkVersi,
    insight: bangunLaporanInsight({
      platform: 'tiktok', kpi, kanal, iklan, live, video, afiliasi, tahap, skor: opts.skor, benchTiktok: opts.benchTiktok,
    }),
  };
}

/** Rakit payload laporan Shopee v1 — KPI basis `'siap_dikirim'` (Rule 16, "Basis default untuk laporan klien Shopee"). Nol `benchmarkVersi` (asimetri asli, `computeSkorShopee` tidak menerima benchmark). */
export function bangunLaporanShopee(opts: PdtLaporanShopeeOptions): PdtLaporanShopee {
  const kpi = bangunKpiRingkas(opts.kpi);
  const kanal = bangunKanalShopee(opts.kanal);
  const iklan = bangunIklanShopee(opts.iklan);
  const live = bangunLaporanLive(opts.live);
  const video = bangunLaporanVideo(opts.video);
  const afiliasi = bangunLaporanAfiliasi(opts.afiliasi);
  return {
    schema: 'cdps.pdt.laporan.shopee.v1',
    platform: 'shopee',
    clientPlatformId: opts.clientPlatformId,
    periodeAwalBulan: opts.periodeAwalBulan,
    generatedAt: opts.generatedAt,
    kpi,
    kanal,
    iklan,
    live,
    video,
    afiliasi,
    tahap: null,
    skor: opts.skor,
    insight: bangunLaporanInsight({
      platform: 'shopee', kpi, kanal, iklan, live, video, afiliasi, tahap: null, skor: opts.skor, benchTiktok: null,
    }),
  };
}
