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
import {
  ambangRelatifKuadran,
  klasifikasikanKuadranRelatifTiktok,
  klasifikasikanKuadranSkuShopee,
  KLIK_MIN_UJI,
  PDT_KUADRAN_SHOPEE,
  type PdtAmbangKuadran,
  type PdtKuadranSku,
} from './kuadran';
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
  /** Σ `produk_diklik` — `null` bila kolomnya tidak terpanen periode ini (Shopee `shopee_shop_stats` membawanya; TikTok tidak). */
  produkDiklik: number | null;
}

/**
 * Berapa BARANG yang dibuka satu pengunjung toko, rata-rata
 * (`produk_diklik ÷ pengunjung`).
 *
 * **Ini metrik NIAT, bukan metrik trafik**, dan pembacaannya datang dari
 * pemilik (2026-09-22): satu pengunjung membuka lebih dari satu barang adalah
 * hal yang NORMAL dan justru BAGUS — artinya ia belum menemukan yang pas tapi
 * masih mau melihat-lihat, atau tokonya cukup menarik untuk ditelusuri. Angka
 * mendekati 1,00 berarti pengunjung membuka satu barang lalu pergi.
 *
 * Ia melengkapi CR, tidak menggantikannya, dan dua-duanya harus dibaca
 * BERSAMA — itulah gunanya:
 *
 *   dalam + CR tinggi  → toko sehat, jangan diutak-atik
 *   dalam + CR rendah  → traffic-nya berkualitas, MASALAHNYA DI PRODUK/HARGA
 *                        (pengunjung mau melihat-lihat tapi tidak menemukan
 *                        alasan membeli) — bukan di iklan
 *   dangkal + CR tinggi→ pembeli datang sudah tahu mau apa; katalognya belum
 *                        dimanfaatkan untuk menaikkan basket
 *   dangkal + CR rendah→ trafiknya memang salah orang; perbaiki targeting dulu,
 *                        bukan halaman produk
 *
 * ## Penyebutnya KUNJUNGAN HARIAN, bukan pengunjung unik sebulan
 *
 * Angka ini dihitung Σ`produk_diklik` ÷ Σ`pengunjung` atas baris HARIAN
 * `pdt_fact_shop_daily` — pengunjung yang datang di lima hari berbeda terhitung
 * lima kali. Itu disengaja dan bukan cacat: (1) hanya baris harian yang ada di
 * fakta, ringkasan bulanan platform tidak pernah disimpan; (2) penyebut yang
 * sama dipakai `cvr`, jadi kedua KPI bisa dibaca berdampingan; dan (3) "berapa
 * barang dibuka dalam SATU kunjungan" memang pertanyaan yang lebih berguna
 * untuk menilai toko daripada "berapa sepanjang bulan".
 *
 * Bedanya besar, jadi jangan dibandingkan dengan angka di dasbor platform:
 * Shopee men-dedup pengunjung bulanan, dan pada Fim Motor Juli 2026 baris
 * ringkasannya menulis 361.197 pengunjung sementara Σ harian 482.408 — klik
 * yang sama (552.545) karena itu terbaca 1,53 per pengunjung unik tapi
 * **1,15 per kunjungan**. Yang dipakai laporan ini adalah yang kedua.
 *
 * ## Ambang — dari enam toko nyata, pada penyebut yang BENAR
 *
 * Kalibrasi pertama memakai 1,53 (penyebut unik-bulanan) padahal laporan
 * menghitung per-kunjungan; ambangnya karena itu diturunkan ulang dari sebaran
 * enam toko sample pada penyebut yang sungguh dipakai (Juli 2026):
 *
 *   Fim Motor (Shopee) 1,15 · Avitaskin 1,32 · Juragan Acc 1,35
 *   Octatrix 1,56 · Sajira 1,60 · Evebag 1,78
 *
 * `DALAM_MIN` 1,5 memisahkan sepertiga teratas; `DANGKAL_MAKS` 1,20 (bukan
 * 1,15) supaya batasnya tidak duduk PERSIS di atas satu titik data — pada 1,15
 * Fim Motor jatuh ke `dangkal` hanya karena pembulatan desimal kedua.
 *
 * Enam toko adalah dasar yang tipis dan angka ini akan ditinjau ulang begitu
 * lebih banyak periode masuk; yang penting ia tidak lagi dikalibrasi ke
 * penyebut yang berbeda dari yang dihitung.
 */
export const KEDALAMAN_DALAM_MIN = 1.5;
export const KEDALAMAN_DANGKAL_MAKS = 1.2;

export type PdtKedalamanJelajah = 'dalam' | 'sedang' | 'dangkal';

export interface PdtLaporanKpiRingkas {
  gmv: number | null;
  pesanan: number | null;
  pengunjung: number | null;
  /** Σ pesanan / Σ pengunjung periode ini — `null` bila pengunjung tidak diketahui (BUKAN 0 sungguhan, dibedakan pemanggil). */
  cvr: number | null;
  /** Σ produk_diklik / Σ pengunjung (basis KUNJUNGAN harian — lihat docblock `KEDALAMAN_DALAM_MIN`). `null` = kolom sumbernya nol baris terisi, bukan 0. */
  barangPerPengunjung: number | null;
  /** Pembacaan `barangPerPengunjung` terhadap ambang. `null` bila angkanya `null` — TIDAK PERNAH ditebak 'sedang'. */
  kedalaman: PdtKedalamanJelajah | null;
}

/** Rakit `PdtLaporanKpiRingkas` dari agregat mentah. `null` input ⇒ seluruh field `null` (nol baris basis terkait — Rule 12/aturan rumah #7, bukan 0 yang mengarang). */
export function bangunKpiRingkas(input: PdtLaporanKpiInput | null): PdtLaporanKpiRingkas {
  if (input == null) {
    return { gmv: null, pesanan: null, pengunjung: null, cvr: null, barangPerPengunjung: null, kedalaman: null };
  }
  const barangPerPengunjung = input.produkDiklik == null || input.pengunjung === 0
    ? null : Math.round((input.produkDiklik / input.pengunjung) * 100) / 100;
  return {
    gmv: bulat(input.gmv),
    pesanan: bulat(input.pesanan),
    pengunjung: bulat(input.pengunjung),
    cvr: input.pengunjung === 0 ? null : persen5(input.pesanan / input.pengunjung),
    barangPerPengunjung,
    kedalaman: barangPerPengunjung == null ? null
      : barangPerPengunjung >= KEDALAMAN_DALAM_MIN ? 'dalam'
      : barangPerPengunjung <= KEDALAMAN_DANGKAL_MAKS ? 'dangkal' : 'sedang',
  };
}

/**
 * Bagian "harian" (tren GMV per hari) — bagian §2 di KEDUA laporan HTML lama
 * ("2. Tren GMV Harian" Shopee, "2. Tren Harian" TikTok), dan satu-satunya
 * bagian di keduanya yang PDT belum punya sama sekali sampai hari ini
 * (feedback pemilik 2026-09-21: "hasilnya masih kurang detail … lengkapi
 * termasuk grafik dan chart").
 *
 * Sumbernya `pdt_fact_shop_daily` — tabel yang SUDAH diisi kedua platform
 * (`tt_shop_analytics`, `shopee_shop_stats`) dan sudah dibaca bagian "kpi",
 * hanya saja di sana ia langsung di-`sum()` jadi satu angka bulanan. Bagian
 * ini membaca baris HARIANNYA apa adanya — nol tabel baru, nol modul parser
 * baru, nol migrasi.
 *
 * **Hari yang tidak ada barisnya TIDAK diisi nol.** Ini bukan kelalaian:
 * "toko tidak jualan hari itu" dan "berkas tidak memuat hari itu" adalah dua
 * hal berbeda, dan Rule 12 melarang yang kedua menyamar jadi yang pertama.
 * `titik` hanya memuat hari yang benar-benar ada barisnya (terurut tanggal),
 * dan `hariTerisi` menyebut jumlahnya supaya pembaca laporan tahu grafiknya
 * menutup berapa hari dari bulan itu. Konsekuensinya grafik garis bisa punya
 * jeda — itu INFORMASI, bukan cacat render.
 *
 * Basis per platform mengikuti bagian "kpi" (pemanggil yang memilih, sama
 * seperti `bacaKpiShopDaily`/`bacaKpiTiktokNet`): TikTok `'net'` dengan GMV
 * yang SUDAH dikurangi refund (Rule 15), Shopee `'siap_dikirim'` (Rule 16).
 * Menjumlahkan `titik[].gmv` HARUS menghasilkan `kpi.gmv` — keduanya membaca
 * baris yang sama dengan basis yang sama.
 */
export interface PdtLaporanHarianInputBaris {
  /** `YYYY-MM-DD`. */
  tanggal: string;
  /** TikTok: sudah GMV−refund (Rule 15) — pemanggil yang menetralkan, sama seperti `bacaKpiTiktokNet`. */
  gmv: number | null;
  pesanan: number | null;
  pengunjung: number | null;
}

/** `null` = nol baris `pdt_fact_shop_daily` di periode ini (bukan array kosong) — bagian "harian" seluruhnya `null`. */
export type PdtLaporanHarianInput = readonly PdtLaporanHarianInputBaris[] | null;

export interface PdtLaporanHarianTitik {
  tanggal: string;
  gmv: number | null;
  pesanan: number | null;
  pengunjung: number | null;
  /** pesanan ÷ pengunjung HARI ITU — `null` bila pengunjung tidak diketahui atau 0 (aturan rumah #7: bagi-nol jadi `—`, bukan galat). */
  cvr: number | null;
}

export interface PdtLaporanHarian {
  /** Terurut tanggal menaik. HANYA hari yang benar-benar ada barisnya — lihat docblock. */
  titik: PdtLaporanHarianTitik[];
  /** Jumlah hari yang benar-benar terisi (= `titik.length`), dinamai eksplisit supaya pembaca laporan tidak menyangka grafiknya menutup sebulan penuh. */
  hariTerisi: number;
  /** Hari ber-GMV tertinggi/terendah di antara hari yang GMV-nya DIKETAHUI (`gmv != null`) — `null` bila nol hari begitu. */
  gmvTertinggi: PdtLaporanHarianTitik | null;
  gmvTerendah: PdtLaporanHarianTitik | null;
  /** Σ gmv ÷ `hariTerisi` — rata-rata atas hari yang ADA datanya, BUKAN atas jumlah hari kalender bulan itu. */
  gmvRataHarian: number | null;
}

/**
 * Rakit `PdtLaporanHarian` dari baris harian mentah. `null`/array kosong ⇒
 * `null` (nol dasar untuk digambar sama sekali), konsisten dengan
 * `bangunLaporanLive`/`bangunLaporanVideo`.
 */
export function bangunLaporanHarian(input: PdtLaporanHarianInput): PdtLaporanHarian | null {
  if (input == null || input.length === 0) return null;

  const titik: PdtLaporanHarianTitik[] = [...input]
    .sort((a, b) => (a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : 0))
    .map((b) => ({
      tanggal: b.tanggal,
      gmv: bulat(b.gmv),
      pesanan: bulat(b.pesanan),
      pengunjung: bulat(b.pengunjung),
      cvr: b.pesanan == null || b.pengunjung == null || b.pengunjung === 0 ? null : persen5(b.pesanan / b.pengunjung),
    }));

  const berGmv = titik.filter((t) => t.gmv != null);
  const totalGmv = berGmv.reduce((a, t) => a + (t.gmv as number), 0);
  return {
    titik,
    hariTerisi: titik.length,
    gmvTertinggi: berGmv.length === 0 ? null : berGmv.reduce((a, t) => ((t.gmv as number) > (a.gmv as number) ? t : a)),
    gmvTerendah: berGmv.length === 0 ? null : berGmv.reduce((a, t) => ((t.gmv as number) < (a.gmv as number) ? t : a)),
    gmvRataHarian: berGmv.length === 0 ? null : bulat(totalGmv / berGmv.length),
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
 * Bagian "produk" (Portfolio Produk/kuadran) — TikTok-ONLY, keputusan
 * pemilik via `AskUserQuestion` (2026-09-16, "G2-01-KUADRAN-SKU (produk)"):
 * Shopee methodology kuadran beda total dari TikTok (visitor/CR dari sheet
 * "Bisnis — Produk"/`parentskudetail`, bukan klik/CVR "Analitik Produk") dan
 * belum punya modul PDT sumber data terdaftar — sama gap "tahap", `null`
 * PERMANEN untuk Shopee sampai modul itu ada (bukan tebakan/interpolasi).
 *
 * **Mode BENCHMARK SAJA** (lihat docblock `kuadran.ts` — keputusan desain
 * SUDAH diambil sebelum bagian laporan ini dibangun, bukan keputusan baru di
 * sini) — TIDAK ada panel "Mode Relatif" seperti mesin lama (`kuadranProduk`
 * `relatif`, percentile per-periode); `pdt_fact_sku_period.kuadran` sudah
 * ditulis benchmark-only oleh `klasifikasikanKuadranSkuTiktok`/
 * `klasifikasiUlangKuadranSkuTiktok` (langkah 2, PR sebelumnya) SEBELUM
 * fungsi ini dipanggil (pemanggil, `@cdps/domain` `pdt.ts`, menjamin
 * urutan — lihat docblock `hitungSkorTiktok`).
 *
 * `distribusi` — jumlah SKU + Σgmv per KEENAM kuadran (`PdtKuadranSku`),
 * cermin bar distribusi mesin lama (`report/render.ts` `seksiProduk` `dist`)
 * tapi tanpa warna/persen (urusan tampilan FE, bukan payload). `topAksi` —
 * HANYA tiga kuadran actionable (`bintang`/`bocor_traffic`/`hidden_gem`,
 * `evaluasi`/`tidur`/`tidak_tayang` DIKELUARKAN — cermin PERSIS "Top Produk
 * by GMV" mesin lama, `report/render.ts` `seksiProduk`: `Q.benchmark.bintang.
 * produk.concat(bocor_traffic, hidden_gem)`), diurutkan GMV desc, dipotong
 * `TOP_PRODUK_N = 12` (angka SAMA mesin lama — `slice(0, 12)` — bukan ambang
 * baru yang ditebak).
 *
 * `namaProduk` bisa `null` untuk baris lama (sebelum `G2-01-KUADRAN-SKU`
 * lanjutan memanen kolom `'Nama'`) — TAMPILAN UI SAJA, bukan filter (baris
 * tanpa nama TETAP masuk `topAksi`, FE yang memutuskan fallback tampilan,
 * mis. `platformProductId`).
 *
 * Whole-object `null` saat nol baris `pdt_fact_sku_period` (basis `'net'`,
 * `sku_id is null`) periode ini — cermin Rule 12/`bangunLaporanLive`/
 * `bangunLaporanVideo`.
 */
const TOP_PRODUK_N = 12;
const KUADRAN_AKSI: readonly PdtKuadranSku[] = ['bintang', 'bocor_traffic', 'hidden_gem'];
const SEMUA_KUADRAN: readonly PdtKuadranSku[] = ['bintang', 'hidden_gem', 'bocor_traffic', 'evaluasi', 'tidur', 'tidak_tayang', 'no_data'];

export interface PdtLaporanProdukItem {
  namaProduk: string | null;
  platformProductId: string | null;
  gmv: number | null;
  klik: number | null;
  cvr: number | null;
  kuadran: PdtKuadranSku;
}

export interface PdtLaporanProdukDistribusi {
  jumlah: number;
  gmv: number | null;
}

/**
 * Satu baris "Top Produk by GMV" — LINTAS kuadran, `kuadran` `null` untuk
 * produk yang belum/tidak terklasifikasi.
 *
 * Membawa funnel LENGKAP per produk, bukan cuma ujungnya: `impresi` (tayangan
 * kartu) → `ctr` → `traffic` (kunjungan halaman) → `cvr` (pesanan ÷ kunjungan).
 * Sebelumnya hanya `klik` dan `cvr` yang keluar, sehingga produk beriklan berat
 * tapi tidak diklik terlihat identik dengan produk yang tidak pernah muncul
 * sama sekali — dua masalah yang perbaikannya berlawanan.
 */
export interface PdtLaporanProdukTopItem {
  namaProduk: string | null;
  platformProductId: string | null;
  gmv: number | null;
  klik: number | null;
  /** Sumbu-X kuadran: klik (TikTok) / kunjungan halaman produk (Shopee). */
  traffic: number | null;
  /** Tayangan kartu produk di feed/pencarian — lihat docblock `PdtLaporanProdukInputBaris.impresi`. */
  impresi: number | null;
  /** `klik ÷ impresi` — seberapa sering kartu yang tampil benar-benar dibuka. `null` bila salah satu sisi tidak diketahui. */
  ctr: number | null;
  cvr: number | null;
  kuadran: PdtKuadranSku | null;
}

/** Panel "Mode Relatif" mesin lama — distribusi kedua atas baris yang SAMA, ambangnya percentile katalog periode ini alih-alih benchmark/absolut. */
export interface PdtLaporanProdukRelatif {
  distribusi: Record<PdtKuadranSku, PdtLaporanProdukDistribusi>;
  ambang: PdtAmbangKuadran;
}

export interface PdtLaporanProduk {
  /** `null` bila NOL baris periode ini punya kuadran (belum pernah diklasifikasi). Distribusi tujuh-bucket yang seluruhnya nol akan terbaca sebagai "semua produk tidak tayang", padahal artinya lain. */
  distribusi: Record<PdtKuadranSku, PdtLaporanProdukDistribusi> | null;
  /** HANYA tiga kuadran actionable — kosong bila `distribusi` `null`. */
  topAksi: PdtLaporanProdukItem[];
  /** "Top Produk by GMV" mesin lama — SELURUH produk diurut GMV desc, tidak disaring kuadran. */
  top: PdtLaporanProdukTopItem[];
  /** Panel kedua mesin lama. `null` bila nol baris AKTIF periode ini (`ambang.n === 0`) — percentile atas himpunan kosong tidak berarti apa-apa, dan enam ember nol akan berbohong. */
  relatif: PdtLaporanProdukRelatif | null;
}

/** Satu baris `pdt_fact_sku_period` (TikTok, `sku_id is null`, `basis='net'`) mentah untuk bagian laporan "produk". `kuadran` `null` = belum sempat diklasifikasi (struktural tidak seharusnya terjadi bila dipanggil SETELAH `klasifikasiUlangKuadranSkuTiktok` — dikeluarkan dari `distribusi`/`topAksi` bila terjadi, bukan dipaksa masuk salah satu bucket). */
export interface PdtLaporanProdukInputBaris {
  kuadran: PdtKuadranSku | null;
  namaProduk: string | null;
  platformProductId: string | null;
  gmv: number | null;
  klik: number | null;
  /**
   * Sumbu-X kuadran platform ini: `klik` untuk TikTok, `pengunjung` untuk
   * Shopee. Dipisah dari `klik` dengan sengaja — pada Shopee keduanya kolom
   * berbeda (`Produk Diklik` vs `Pengunjung Produk (Kunjungan)`) dan hanya
   * yang kedua yang boleh masuk kuadran.
   */
  traffic: number | null;
  /**
   * `pdt_fact_sku_period.impresi` — Shopee `'Jumlah Produk Dilihat'`, TikTok
   * `'Impresi produk'`. Ini TAYANGAN kartu produk di feed/pencarian, BUKAN
   * kunjungan halaman: dibuktikan ke berkas asli, `klik ÷ impresi` = 5,50%
   * yang sama persis dengan kolom `'Persentase Klik'` yang Shopee terbitkan
   * sendiri. Karena itu ia jauh lebih besar dari `traffic` (Fim Motor: 1.383.429
   * vs 32.949 untuk satu produk yang sama) — itu selisih antar TAHAP FUNNEL,
   * bukan dua versi angka yang sama.
   */
  impresi: number | null;
  cvr: number | null;
}

export type PdtLaporanProdukInput = readonly PdtLaporanProdukInputBaris[] | null;

/** Distribusi tujuh-ember dari daftar baris yang SUDAH ber-kuadran. */
function distribusiKuadran(
  berkuadran: readonly (PdtLaporanProdukInputBaris & { kuadran: PdtKuadranSku })[],
): Record<PdtKuadranSku, PdtLaporanProdukDistribusi> {
  return Object.fromEntries(
    SEMUA_KUADRAN.map((k) => {
      const baris = berkuadran.filter((b) => b.kuadran === k);
      const gmvDiketahui = baris.some((b) => b.gmv != null);
      return [k, { jumlah: baris.length, gmv: gmvDiketahui ? bulat(baris.reduce((a, b) => a + (b.gmv ?? 0), 0)) : null }];
    }),
  ) as Record<PdtKuadranSku, PdtLaporanProdukDistribusi>;
}

/**
 * Panel "Mode Relatif" — dihitung di sini, TIDAK disimpan (lihat komentar blok
 * mode relatif di `kuadran.ts`). Kedua platform memakai percentile p25/p75,
 * tapi TIGA parameternya berbeda dan perbedaannya diwarisi dari mesin lama,
 * bukan diseragamkan di sini:
 *
 *              ambang uji   percentile CVR        klasifikasi
 *   TikTok     klik ≥ 10    CVR POSITIF saja      dua band
 *   Shopee     peng. ≥ 50   SELURUH CR aktif      tiga band + promosi medium
 *
 * `null` saat nol baris aktif: percentile atas himpunan kosong bukan angka,
 * dan mengembalikan tujuh ember nol akan terbaca sebagai "semua produk tidak
 * tayang" — kekeliruan yang sama yang `distribusi: null` sudah cegah.
 */
function bangunLaporanProdukRelatif(
  input: readonly PdtLaporanProdukInputBaris[],
  platform: 'tiktok' | 'shopee',
): PdtLaporanProdukRelatif | null {
  const minUji = platform === 'tiktok' ? KLIK_MIN_UJI : PDT_KUADRAN_SHOPEE.pengunjungMinUji;
  const untukAmbang = input.map((b, i) => ({ id: i, traffic: b.traffic, cr: b.cvr }));
  const ambang = ambangRelatifKuadran(untukAmbang, minUji, platform === 'tiktok');
  if (ambang.n === 0) return null;

  const hasil = platform === 'tiktok'
    ? klasifikasikanKuadranRelatifTiktok(untukAmbang, minUji, ambang)
    // Shopee: fungsi yang SAMA dengan mode absolut, hanya ambangnya ditukar —
    // `cr` di-rekonstruksi jadi `pesananDibuat` sintetis atas `pengunjung` yang
    // sama, karena `crKuadranShopee` membaginya kembali persis dengan angka itu.
    : klasifikasikanKuadranSkuShopee(
        input.map((b, i) => ({ id: i, pengunjung: b.traffic, pesananDibuat: b.cvr == null || b.traffic == null ? null : b.cvr * b.traffic })),
        ambang,
      );

  const berkuadran = hasil.map((h) => ({ ...input[h.id], kuadran: h.kuadran }));
  return { distribusi: distribusiKuadran(berkuadran), ambang };
}

/** Rakit "produk". `null` (whole object) bila `input` `null` ATAU nol baris — lihat docblock tipe di atas. */
export function bangunLaporanProduk(
  input: PdtLaporanProdukInput,
  platform: 'tiktok' | 'shopee',
): PdtLaporanProduk | null {
  if (input == null || input.length === 0) return null;
  const berkuadran = input.filter((b): b is PdtLaporanProdukInputBaris & { kuadran: PdtKuadranSku } => b.kuadran != null);

  const distribusi = berkuadran.length === 0 ? null : distribusiKuadran(berkuadran);

  const topAksi: PdtLaporanProdukItem[] = berkuadran
    .filter((b) => KUADRAN_AKSI.includes(b.kuadran))
    .sort((a, b) => (b.gmv ?? 0) - (a.gmv ?? 0))
    .slice(0, TOP_PRODUK_N)
    .map((b) => ({
      namaProduk: b.namaProduk,
      platformProductId: b.platformProductId,
      gmv: bulat(b.gmv),
      klik: b.klik,
      cvr: persen5(b.cvr),
      kuadran: b.kuadran,
    }));

  const top: PdtLaporanProdukTopItem[] = [...input]
    .sort((a, b) => (b.gmv ?? 0) - (a.gmv ?? 0))
    .slice(0, TOP_PRODUK_N)
    .map((b) => ({
      namaProduk: b.namaProduk,
      platformProductId: b.platformProductId,
      gmv: bulat(b.gmv),
      klik: b.klik,
      traffic: b.traffic,
      impresi: b.impresi,
      ctr: b.impresi == null || b.impresi === 0 || b.klik == null ? null : persen5(b.klik / b.impresi),
      cvr: persen5(b.cvr),
      kuadran: b.kuadran,
    }));

  return { distribusi, topAksi, top, relatif: bangunLaporanProdukRelatif(input, platform) };
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
  /**
   * Σ `tayangan`/`klik` `pdt_fact_ads` sumber TikTok Ads Manager
   * (`tt_ads_product` `'Impresi iklan produk'`/`'Jumlah klik iklan produk'`,
   * `tt_ads_live` `'Tayangan LIVE'`). `null` = nol baris iklan Ads Manager
   * periode ini, BUKAN nol tayangan.
   */
  ttamFunnel: { tayangan: number | null; klik: number | null } | null;
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
  const tf = input.ttamFunnel;
  const ttamCtr = tf == null || tf.klik == null || tf.tayangan == null || tf.tayangan === 0
    ? null : persen5(tf.klik / tf.tayangan);

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
      // Ketiganya DULU hardcode `null` dengan catatan "modul TikTok Ads Manager
      // belum dibangun" — keliru: `tt_ads_product`/`tt_ads_live` sudah punya
      // modul, ekstraktor, dan penulis `pdt_fact_ads` sejak 2026-09-16
      // (`G1-09-2BII-TTADS-SAMPLE`), dan angkanya memang ada di berkas unggahan.
      tm('sc_impresi', 'Impresi iklan showcase', input.ttamFunnel?.tayangan ?? null, 'angka'),
      tm('sc_klik', 'Klik ke halaman produk (iklan)', input.ttamFunnel?.klik ?? null, 'angka'),
      tm('sc_ctr', 'CTR showcase', ttamCtr, 'persen'),
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

/**
 * Satu kalimat yang membaca kedalaman jelajah BERSAMA CR toko.
 *
 * Kenapa keduanya, bukan kedalaman saja: "1,60 barang per kunjungan" sendirian
 * tidak menyuruh siapa pun melakukan apa pun. Dipasangkan dengan CR, ia menunjuk
 * ke DIVISI yang harus bergerak — penjelajahan dalam tapi CR rendah berarti
 * traffic-nya sudah benar dan masalahnya di produk/harga, jadi menaikkan budget
 * iklan justru membakar uang; penjelajahan dangkal dengan CR rendah berarti
 * sebaliknya.
 *
 * `null` bila salah satu sisi tidak diketahui — Rule 12, bukan kalimat yang
 * mengarang separuh fakta.
 */
function bacaanKedalamanJelajah(kpi: PdtLaporanKpiRingkas): string | null {
  if (kpi.barangPerPengunjung == null || kpi.kedalaman == null) return null;
  const angka = `Pengunjung membuka ${dec(kpi.barangPerPengunjung, 2)} barang rata-rata`;
  if (kpi.cvr == null) {
    return kpi.kedalaman === 'dangkal'
      ? `${angka} — hampir satu barang lalu pergi; katalog belum sempat dilihat.`
      : `${angka} — pengunjung menelusuri lebih dari satu barang, tanda niat beli yang sehat.`;
  }
  const crSehat = kpi.cvr >= 0.02;
  if (kpi.kedalaman === 'dalam') {
    return crSehat
      ? `${angka} dan CVR ${pct(kpi.cvr, 2)} — pengunjung menelusuri katalog DAN membeli; pola toko yang sehat, jangan diutak-atik.`
      : `${angka}, tapi CVR baru ${pct(kpi.cvr, 2)} — pengunjungnya berkualitas dan mau melihat-lihat, yang belum meyakinkan ada di PRODUK/HARGA, bukan di iklan. Menambah budget iklan sekarang membakar trafik yang sudah benar.`;
  }
  if (kpi.kedalaman === 'dangkal') {
    return crSehat
      ? `${angka} dengan CVR ${pct(kpi.cvr, 2)} — pembeli datang sudah tahu mau apa; katalog lain belum dimanfaatkan untuk menaikkan nilai keranjang.`
      : `${angka} dan CVR baru ${pct(kpi.cvr, 2)} — pengunjung membuka satu barang lalu pergi. Perbaiki dulu ketepatan trafik (targeting/kata kunci), bukan halaman produknya.`;
  }
  return `${angka} dengan CVR ${pct(kpi.cvr, 2)} — penjelajahan sedang; masih ada ruang mengarahkan pengunjung ke produk terkait.`;
}

function poinLaporanInsight(input: PdtLaporanInsightInput): string[] {
  const { kpi, kanal, iklan, live, video, afiliasi, tahap, platform } = input;
  const poin: string[] = [];

  if (kpi.gmv != null) {
    poin.push(`GMV ${rp(kpi.gmv)}${kpi.pesanan != null ? ` dari ${num(kpi.pesanan)} pesanan` : ''}${kpi.cvr != null ? ` (CVR ${pct(kpi.cvr, 2)})` : ''}.`);
  }

  // Kedalaman jelajah DIBACA BERSAMA CR, tidak sendiri — itulah yang membuatnya
  // berguna. Lihat tabel empat kombinasi di docblock `KEDALAMAN_DALAM_MIN`.
  const bacaanKedalaman = bacaanKedalamanJelajah(kpi);
  if (bacaanKedalaman) poin.push(bacaanKedalaman);

  const kanalTerukur = kanal.items.filter((x) => x.gmv != null);
  if (kanalTerukur.length) {
    const top = [...kanalTerukur].sort((a, b) => (b.gmv as number) - (a.gmv as number))[0];
    poin.push(`${top.label} jadi kanal terbesar: ${rp(top.gmv)}${top.persen != null ? ` (${pct(top.persen, 1)} dari GMV)` : ''}.`);
  }

  if (iklan) {
    poin.push(`Iklan: belanja ${rp(iklan.biaya)} → GMV ${rp(iklan.gmv)}${iklan.roas != null ? ` (ROAS ${dec(iklan.roas, 2)}x)` : ''}.`);
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

/**
 * "Leading metrics" bagian Outlook — EMPAT per platform, cermin mesin lama
 * (`leading` di KEDUA berkas engine), bukan dua seperti v1.
 *
 * Targetnya ditarik dari BENCHMARK aktif (TikTok) atau dari angka periode ini
 * sendiri (Shopee, yang nol benchmark — `computeSkorShopee` memang tidak
 * menerimanya), memakai pengali yang SAMA PERSIS dengan mesin lama:
 * pengunjung +35%, CR +1 poin persen, ROAS ads `max(6, roas+0,5)`. Nol
 * ambang baru ditebak di sini.
 *
 * Satu indikator mesin lama SENGAJA TIDAK ADA: "Target Cancel Rate <7%"
 * (Shopee) — `pdt_fact_shop_daily` tidak punya kolom pembatalan, jadi "kini"
 * -nya tidak bisa dihitung ulang dari fakta dan targetnya jadi angka yang
 * menggantung tanpa dasar. Alasan yang sama membuat "% Video Jual" TikTok
 * diganti "GPM Video" — bench `gpm_video` ADA dan `gmv`/`vv` video ADA,
 * sedangkan "berapa persen video yang menghasilkan penjualan" butuh baris
 * per-video yang bagian "video" sudah menjumlah habis.
 */
function indikatorLaporanInsight(input: PdtLaporanInsightInput): { nama: string; target: string }[] {
  const arr: { nama: string; target: string }[] = [];
  if (input.skor.total != null) {
    arr.push({ nama: 'Target Skor Performa', target: `≥${SKOR_SEHAT_MIN}/10 (kini ${dec(input.skor.total, 1)}/10)` });
  }

  if (input.platform === 'tiktok' && input.benchTiktok) {
    const b = input.benchTiktok;
    arr.push({ nama: 'Target ROAS Iklan (GMV Max)', target: `≥${b.roi_gmvmax.good}x (kini ${input.iklan?.roas != null ? `${dec(input.iklan.roas, 2)}x` : '—'})` });
    arr.push({ nama: 'Target GMV/jam LIVE', target: `${rp(b.gmv_per_jam_live.warn)}+ (kini ${rp(input.live?.gmvPerJam ?? null)})` });
    const cvrKini = input.kpi.cvr;
    // Mesin lama: `max(bench.warn, cvr + 0,003)` — toko yang SUDAH di atas
    // ambang tetap diberi target naik, bukan target yang sudah dilewatinya.
    const cvrTarget = cvrKini == null ? b.cvr_toko.warn : Math.max(b.cvr_toko.warn, cvrKini + 0.003);
    arr.push({ nama: 'Target CVR Toko', target: `${pct(cvrTarget, 2)} (kini ${pct(cvrKini, 2)})` });
    const v = input.video;
    const gpmKini = v == null || v.gmv == null || v.vv == null || v.vv === 0 ? null : (v.gmv / v.vv) * 1000;
    arr.push({ nama: 'Target GPM Video', target: `${rp(b.gpm_video.warn)}+ per 1.000 views (kini ${rp(gpmKini)})` });
    return arr;
  }

  if (input.platform === 'shopee') {
    const peng = input.kpi.pengunjung;
    if (peng != null) arr.push({ nama: 'Target Pengunjung Toko', target: `${num(Math.round(peng * 1.35))} (+35% dari ${num(peng)})` });
    const cvrKini = input.kpi.cvr;
    if (cvrKini != null) arr.push({ nama: 'Target CR Toko', target: `${pct(cvrKini + 0.01, 2)} (kini ${pct(cvrKini, 2)})` });
    // Hanya bila toko ini MEMANG beriklan periode ini. Mesin lama memakai
    // `adsH.roas||5` — yaitu mengarang baseline 5x untuk toko yang nol iklan,
    // lalu memasang target di atas angka karangan itu. Target untuk kanal yang
    // tidak dipakai bukan indikator, cuma baris kosong yang menuntut.
    const roasKini = input.iklan?.roas ?? null;
    if (input.iklan != null) {
      arr.push({
        nama: 'Target ROAS Iklan',
        target: `>${dec(Math.max(6, (roasKini ?? 5) + 0.5), 1)}x (kini ${roasKini != null ? `${dec(roasKini, 2)}x` : '—'})`,
      });
    }
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

/**
 * Bagian "promo" (Voucher & Promo) — §8 mesin Shopee lama, dibangun
 * 2026-09-21 atas feedback pemilik "lengkapi hasil report supaya menyerupai
 * hasil html".
 *
 * **SHOPEE-ONLY.** `pdt_fact_promo` hanya punya penulis fakta
 * `shopee_diskon`/`shopee_flash_sale` (G4-03 aksi 4); TikTok nol modul promo
 * terdaftar, jadi `null` PERMANEN di sana — pola sama "tahap" yang
 * TikTok-only ke arah sebaliknya.
 *
 * **Isinya BUKAN voucher.** §8 mesin lama membaca `report.voucher.summary`
 * (klaim, biaya voucher, usage rate) dari modul `promo_voucher`. PDT TIDAK
 * PUNYA modul parser voucher sama sekali (nol hasil pencarian di
 * `modules.ts` selain satu komentar) — jadi biaya/klaim/usage-rate voucher
 * TIDAK bisa direplikasi dan TIDAK ditebak di sini. Yang PDT panen justru
 * dua saudaranya yang mesin lama juga punya (`promo_diskon`,
 * `promo_flashsale`), dan itulah isi bagian ini apa adanya.
 *
 * **Baris `tipePromosi='Semua'` adalah TOTAL yang sudah di-dedup Shopee,
 * bukan salah satu komponen** (lihat docblock `ekstrakBarisPromoDiskonShopee`,
 * `pdt/fakta.ts`) — ia dipisah jadi `diskonTotal`, dan komponen-komponennya
 * ('Diskon'/'Paket Diskon'/'Kombo Hemat', yang BOLEH saling tumpang tindih)
 * jadi `diskonPerTipe`. Menjumlah `diskonPerTipe` untuk mendapatkan total
 * adalah dobel-hitung; `diskonTotal` sudah menjawabnya.
 *
 * **`kontribusiGmv` dipisah per jenis, TIDAK dijumlah.** Satu produk bisa
 * ikut flash sale DAN berdiskon di bulan yang sama, jadi
 * `diskonTotal + flashSale` bukan "GMV dari promo" melainkan angka yang
 * menghitung sebagian pesanan dua kali. Dua rasio terpisah menyatakan apa
 * yang benar-benar diketahui.
 */
export interface PdtLaporanPromoInputBaris {
  jenis: 'diskon' | 'flash_sale';
  tipePromosi: string | null;
  penjualanDibuat: number | null;
  penjualanSiapDikirim: number | null;
  pesananDibuat: number | null;
  pesananSiapDikirim: number | null;
  produkDilihat: number | null;
  produkDiklik: number | null;
}

export type PdtLaporanPromoInput = readonly PdtLaporanPromoInputBaris[] | null;

export interface PdtLaporanPromoAngka {
  penjualanDibuat: number | null;
  penjualanSiapDikirim: number | null;
  pesananDibuat: number | null;
  pesananSiapDikirim: number | null;
}

export interface PdtLaporanPromoTipe extends PdtLaporanPromoAngka {
  tipe: string;
}

export interface PdtLaporanPromoFlashSale extends PdtLaporanPromoAngka {
  produkDilihat: number | null;
  produkDiklik: number | null;
  /** `produkDiklik ÷ produkDilihat` — `null` bila salah satunya `null` ATAU `produkDilihat` 0. */
  ctr: number | null;
  /** `pesananSiapDikirim ÷ produkDiklik` — `null` bila salah satunya `null` ATAU `produkDiklik` 0. */
  cvr: number | null;
}

export interface PdtLaporanPromo {
  /** Baris `Tipe Promosi='Semua'` — total periode yang SUDAH di-dedup Shopee. `null` bila berkas diskon tidak membawanya. */
  diskonTotal: PdtLaporanPromoAngka | null;
  /** Komponen yang BOLEH saling tumpang tindih — JANGAN dijumlah (lihat docblock). Urut penjualan siap-dikirim desc. */
  diskonPerTipe: PdtLaporanPromoTipe[];
  flashSale: PdtLaporanPromoFlashSale | null;
  /** `diskonTotal.penjualanSiapDikirim ÷ gmv toko` — basis SAMA dengan KPI Shopee (Rule 16). */
  kontribusiGmvDiskon: number | null;
  /** `flashSale.penjualanSiapDikirim ÷ gmv toko`. TIDAK boleh dijumlah dengan yang di atas. */
  kontribusiGmvFlashSale: number | null;
}

const angkaPromo = (b: PdtLaporanPromoInputBaris): PdtLaporanPromoAngka => ({
  penjualanDibuat: bulat(b.penjualanDibuat),
  penjualanSiapDikirim: bulat(b.penjualanSiapDikirim),
  pesananDibuat: bulat(b.pesananDibuat),
  pesananSiapDikirim: bulat(b.pesananSiapDikirim),
});

/** Rakit "promo". `null` (whole object) bila `input` `null` ATAU nol baris — cermin Rule 12, bukan nol yang mengarang. */
export function bangunLaporanPromo(input: PdtLaporanPromoInput, gmvToko: number | null): PdtLaporanPromo | null {
  if (input == null || input.length === 0) return null;

  const diskon = input.filter((b) => b.jenis === 'diskon');
  const barisTotal = diskon.find((b) => (b.tipePromosi ?? '').trim().toLowerCase() === 'semua') ?? null;
  const diskonTotal = barisTotal == null ? null : angkaPromo(barisTotal);

  const diskonPerTipe: PdtLaporanPromoTipe[] = diskon
    .filter((b) => b !== barisTotal && (b.tipePromosi ?? '').trim() !== '')
    .map((b) => ({ tipe: (b.tipePromosi as string).trim(), ...angkaPromo(b) }))
    .sort((a, b) => (b.penjualanSiapDikirim ?? 0) - (a.penjualanSiapDikirim ?? 0));

  const barisFs = input.find((b) => b.jenis === 'flash_sale') ?? null;
  const flashSale: PdtLaporanPromoFlashSale | null = barisFs == null ? null : (() => {
    const a = angkaPromo(barisFs);
    const dilihat = bulat(barisFs.produkDilihat);
    const diklik = bulat(barisFs.produkDiklik);
    return {
      ...a,
      produkDilihat: dilihat,
      produkDiklik: diklik,
      ctr: dilihat == null || diklik == null || dilihat === 0 ? null : persen5(diklik / dilihat),
      cvr: diklik == null || a.pesananSiapDikirim == null || diklik === 0 ? null : persen5(a.pesananSiapDikirim / diklik),
    };
  })();

  const kontribusi = (v: number | null): number | null =>
    v == null || gmvToko == null || gmvToko === 0 ? null : persen5(v / gmvToko);

  return {
    diskonTotal,
    diskonPerTipe,
    flashSale,
    kontribusiGmvDiskon: kontribusi(diskonTotal?.penjualanSiapDikirim ?? null),
    kontribusiGmvFlashSale: kontribusi(flashSale?.penjualanSiapDikirim ?? null),
  };
}

/**
 * Bagian "layanan" (Layanan & Kesehatan Toko) — §9 mesin Shopee lama.
 *
 * **SHOPEE-ONLY**, alasan sama "promo": `pdt_fact_layanan_chat` (G3-02a) dan
 * `pdt_fact_kesehatan_penalti` (G2-01) hanya punya penulis fakta Shopee.
 *
 * **Cancel rate dan retur SENGAJA TIDAK ADA di sini.** Mesin lama §9
 * menampilkan keduanya dari `k.batal_pesanan`/`k.retur_pesanan`;
 * `pdt_fact_shop_daily` TIDAK PERNAH punya kolom pembatalan/retur sama
 * sekali (skema `20261011010000` §5a) — jadi keduanya tidak bisa dihitung
 * ulang dari fakta PDT dan TIDAK ditebak. Menampilkan "0%" untuk angka yang
 * tidak diketahui persis melanggar Rule 12.
 *
 * **Satuan persen dinormalkan jadi PECAHAN di sini.** Kolom sumbernya
 * literal "CSAT %" dan "Tingkat Konversi (Chat Dibalas)" dan disimpan APA
 * ADANYA (0..100) di `pdt_fact_layanan_chat`; seluruh rasio lain di payload
 * laporan ini pecahan (`cvr`, `ctr`, `kontribusi`), jadi keduanya dibagi 100
 * SATU KALI di sini supaya FE punya satu aturan format, bukan dua.
 *
 * **`responseRate` DITURUNKAN `chatDibalas ÷ chatMasuk`, bukan dibaca.** Itu
 * keputusan yang sudah diambil saat tabelnya lahir (docblock
 * `ekstrakBarisLayananChatShopee`: "disimpan MENTAH, bukan rasio pra-hitung
 * … pola sama seluruh rasio PDT lain"), dan `tingkatKonversiChatDibalas`
 * SENGAJA bukan penggantinya — semantiknya beda.
 *
 * **Lebih dari satu baris chat** terjadi bila satu batch memuat lebih dari
 * satu berkas "Performa Chat". Hitungan (`chatMasuk`, `chatDibalas`,
 * `pengunjung`, `totalPesanan`, `penjualan`) DIJUMLAH; tiga kolom yang sudah
 * berupa rata-rata/rasio di sumbernya (`waktuResponDetik`, `csat`,
 * `konversiChatDibalas`) dirata-rata polos antar baris yang mengisinya —
 * `barisSumber` menyebut berapa baris yang dirangkum supaya pembaca tahu
 * kapan rata-rata itu berlaku.
 */
export interface PdtLaporanLayananChatInput {
  barisSumber: number;
  pengunjung: number | null;
  chatMasuk: number | null;
  chatDibalas: number | null;
  waktuResponDetik: number | null;
  csatPersen: number | null;
  totalPesanan: number | null;
  penjualan: number | null;
  tingkatKonversiChatDibalasPersen: number | null;
}

export interface PdtLaporanPenaltiInput {
  poin: number;
  deskripsi: string;
  durasi: string;
}

export interface PdtLaporanLayananInput {
  chat: PdtLaporanLayananChatInput | null;
  penalti: readonly PdtLaporanPenaltiInput[];
}

export interface PdtLaporanLayananChat {
  /** Berapa baris `pdt_fact_layanan_chat` dirangkum — >1 berarti kolom rasio di bawah adalah rata-rata antar berkas. */
  barisSumber: number;
  pengunjung: number | null;
  chatMasuk: number | null;
  chatDibalas: number | null;
  /** `chatDibalas ÷ chatMasuk` — PECAHAN. `null` bila salah satunya `null` ATAU `chatMasuk` 0. */
  responseRate: number | null;
  waktuResponDetik: number | null;
  /** Kolom "CSAT %" ÷ 100 — PECAHAN. */
  csat: number | null;
  totalPesanan: number | null;
  penjualan: number | null;
  /** Kolom "Tingkat Konversi (Chat Dibalas)" ÷ 100 — PECAHAN. BUKAN `responseRate`. */
  konversiChatDibalas: number | null;
}

export interface PdtLaporanPenalti {
  poin: number;
  deskripsi: string;
  durasi: string;
}

export interface PdtLaporanLayanan {
  chat: PdtLaporanLayananChat | null;
  /** Σ poin seluruh penalti aktif periode ini. `0` adalah angka SUNGGUHAN di sini ("toko bersih"), bukan "tidak diketahui" — baris kesehatan toko memang ditulis walau nol penalti. `null` hanya bila nol baris kesehatan sama sekali. */
  poinPenaltiTotal: number | null;
  /** Urut poin desc. Kosong = nol penalti aktif (bukan "tidak diketahui"). */
  penalti: PdtLaporanPenalti[];
}

/** Rakit "layanan". `null` (whole object) bila nol baris chat DAN nol baris penalti. */
export function bangunLaporanLayanan(input: PdtLaporanLayananInput | null): PdtLaporanLayanan | null {
  if (input == null || (input.chat == null && input.penalti.length === 0)) return null;

  const c = input.chat;
  const pecahanPersen = (v: number | null | undefined): number | null =>
    v == null || !isFinite(v) ? null : persen5(v / 100);

  const chat: PdtLaporanLayananChat | null = c == null ? null : {
    barisSumber: c.barisSumber,
    pengunjung: bulat(c.pengunjung),
    chatMasuk: bulat(c.chatMasuk),
    chatDibalas: bulat(c.chatDibalas),
    responseRate: c.chatMasuk == null || c.chatDibalas == null || c.chatMasuk === 0
      ? null
      : persen5(c.chatDibalas / c.chatMasuk),
    waktuResponDetik: bulat(c.waktuResponDetik),
    csat: pecahanPersen(c.csatPersen),
    totalPesanan: bulat(c.totalPesanan),
    penjualan: bulat(c.penjualan),
    konversiChatDibalas: pecahanPersen(c.tingkatKonversiChatDibalasPersen),
  };

  const penalti = [...input.penalti]
    .sort((a, b) => b.poin - a.poin)
    .map((p) => ({ poin: p.poin, deskripsi: p.deskripsi, durasi: p.durasi }));

  return {
    chat,
    poinPenaltiTotal: input.penalti.length === 0 ? null : bulat(input.penalti.reduce((a, p) => a + p.poin, 0)),
    penalti,
  };
}

/**
 * Bagian "kreator" (Top 10 Creator) — "Top 10 Creator" §7 mesin Shopee lama
 * dan "Top Kreator by GMV" mesin TikTok lama.
 *
 * Melengkapi bagian "afiliasi" yang SENGAJA ringkasan-saja saat dibangun
 * (keputusan pemilik KEENAM 2026-09-16, lihat docblock `PdtLaporanAfiliasi`):
 * ringkasannya menjawab "seberapa besar afiliasi", bagian ini menjawab
 * "siapa" — dan "siapa" adalah satu-satunya yang bisa ditindaklanjuti tim
 * Creator Management.
 *
 * `komisi`/`roiKomisi` mesin lama TETAP tidak ada — `pdt_fact_creator_period`
 * tidak pernah punya kolomnya (alasan lengkap di docblock
 * `PdtLaporanAfiliasi`, tidak diulang di sini). Yang ditambahkan bagian ini
 * hanyalah kolom yang tabel itu MEMANG punya.
 *
 * Platform-agnostic, pola sama "afiliasi"/"live": Shopee otomatis dapat
 * `jumlahLive`/`jumlahVideo` `null` karena writer-nya tidak mengisi kolom
 * itu, BUKAN karena filter platform.
 */
const TOP_KREATOR_N = 10;

export interface PdtLaporanKreatorInputBaris {
  handle: string;
  gmv: number | null;
  gmvLive: number | null;
  gmvVideo: number | null;
  pesanan: number | null;
  jumlahLive: number | null;
  jumlahVideo: number | null;
}

export type PdtLaporanKreatorInput = readonly PdtLaporanKreatorInputBaris[] | null;

export interface PdtLaporanKreatorItem {
  handle: string;
  gmv: number | null;
  gmvLive: number | null;
  gmvVideo: number | null;
  pesanan: number | null;
  /** `gmv ÷ pesanan` — `null` bila salah satunya `null` ATAU `pesanan` 0. */
  aov: number | null;
  jumlahLive: number | null;
  jumlahVideo: number | null;
}

export interface PdtLaporanKreator {
  top: PdtLaporanKreatorItem[];
  /** Berapa kreator SELURUHNYA di periode ini (bukan cuma yang masuk `top`). */
  totalKreator: number;
  /** Σ gmv `top` ÷ Σ gmv SELURUH kreator — `null` bila Σ seluruhnya `null`/0. */
  kontribusiTop: number | null;
}

/** Rakit "kreator". `null` (whole object) bila `input` `null` ATAU nol baris. */
export function bangunLaporanKreator(input: PdtLaporanKreatorInput): PdtLaporanKreator | null {
  if (input == null || input.length === 0) return null;

  const top: PdtLaporanKreatorItem[] = [...input]
    .sort((a, b) => (b.gmv ?? 0) - (a.gmv ?? 0))
    .slice(0, TOP_KREATOR_N)
    .map((b) => {
      const gmv = bulat(b.gmv);
      const pesanan = bulat(b.pesanan);
      return {
        handle: b.handle,
        gmv,
        gmvLive: bulat(b.gmvLive),
        gmvVideo: bulat(b.gmvVideo),
        pesanan,
        aov: gmv == null || pesanan == null || pesanan === 0 ? null : bulat(gmv / pesanan),
        jumlahLive: bulat(b.jumlahLive),
        jumlahVideo: bulat(b.jumlahVideo),
      };
    });

  const adaGmv = input.some((b) => b.gmv != null);
  const totalGmv = input.reduce((a, b) => a + (b.gmv ?? 0), 0);
  const gmvTop = top.reduce((a, b) => a + (b.gmv ?? 0), 0);

  return {
    top,
    totalKreator: input.length,
    kontribusiTop: !adaGmv || totalGmv === 0 ? null : persen5(gmvTop / totalGmv),
  };
}

/**
 * Bagian "sesiLive" (Top 10 Sesi LIVE) — "Top 10 Sesi"/"Top Sesi GMV Max
 * LIVE" mesin TikTok lama.
 *
 * Melengkapi bagian "live" yang ringkasan-saja (sesi, jam, GMV/jam toko):
 * ringkasannya menjawab "seberapa sehat LIVE bulan ini", bagian ini
 * menjawab "sesi mana yang bekerja" — yang menentukan jam tayang dan host
 * bulan depan.
 *
 * Sumbernya `pdt_fact_content` `jenis='live'`, baris yang SAMA yang sudah
 * di-`sum()` bagian "live" — nol tabel baru, nol query mahal baru.
 *
 * Platform-agnostic seperti "live": Shopee punya baris sesi tapi
 * `durasiDetik` kosong permanen (kolom sumbernya tidak ada di
 * `shopee_live`), jadi `gmvPerJam` otomatis `null` di sana tanpa filter
 * platform.
 *
 * `is_akun_toko` DIBAWA APA ADANYA (`akunToko`) — memisahkan LIVE toko dari
 * LIVE afiliasi adalah pembacaan yang mesin lama lakukan eksplisit ("LIVE
 * Affiliate vs LIVE Toko"), dan sesi afiliasi yang menang besar berarti hal
 * yang sangat berbeda dari sesi toko yang menang besar.
 */
const TOP_SESI_LIVE_N = 10;

export interface PdtLaporanSesiLiveInputBaris {
  platformContentId: string;
  creatorHandle: string | null;
  akunToko: boolean;
  waktuPosting: string | null;
  durasiDetik: number | null;
  vv: number | null;
  gmv: number | null;
  pengikutBaru: number | null;
  klikProduk: number | null;
}

export type PdtLaporanSesiLiveInput = readonly PdtLaporanSesiLiveInputBaris[] | null;

export interface PdtLaporanSesiLiveItem {
  platformContentId: string;
  creatorHandle: string | null;
  akunToko: boolean;
  waktuPosting: string | null;
  durasiDetik: number | null;
  vv: number | null;
  gmv: number | null;
  /** `gmv ÷ (durasiDetik/3600)` — `null` bila salah satunya `null` ATAU durasi 0. */
  gmvPerJam: number | null;
  pengikutBaru: number | null;
  klikProduk: number | null;
}

export interface PdtLaporanSesiLive {
  top: PdtLaporanSesiLiveItem[];
  totalSesi: number;
  /** Σ gmv `top` ÷ Σ gmv SELURUH sesi — `null` bila Σ seluruhnya `null`/0. */
  kontribusiTop: number | null;
}

/** Rakit "sesiLive". `null` (whole object) bila `input` `null` ATAU nol baris. */
export function bangunLaporanSesiLive(input: PdtLaporanSesiLiveInput): PdtLaporanSesiLive | null {
  if (input == null || input.length === 0) return null;

  const top: PdtLaporanSesiLiveItem[] = [...input]
    .sort((a, b) => (b.gmv ?? 0) - (a.gmv ?? 0))
    .slice(0, TOP_SESI_LIVE_N)
    .map((b) => {
      const gmv = bulat(b.gmv);
      const jam = b.durasiDetik == null ? null : b.durasiDetik / 3600;
      return {
        platformContentId: b.platformContentId,
        creatorHandle: b.creatorHandle,
        akunToko: b.akunToko,
        waktuPosting: b.waktuPosting,
        durasiDetik: bulat(b.durasiDetik),
        vv: bulat(b.vv),
        gmv,
        gmvPerJam: gmv == null || jam == null || jam === 0 ? null : bulat(gmv / jam),
        pengikutBaru: bulat(b.pengikutBaru),
        klikProduk: bulat(b.klikProduk),
      };
    });

  const adaGmv = input.some((b) => b.gmv != null);
  const totalGmv = input.reduce((a, b) => a + (b.gmv ?? 0), 0);
  const gmvTop = top.reduce((a, b) => a + (b.gmv ?? 0), 0);

  return {
    top,
    totalSesi: input.length,
    kontribusiTop: !adaGmv || totalGmv === 0 ? null : persen5(gmvTop / totalGmv),
  };
}

/**
 * Bagian "kampanye" (rincian iklan PER KAMPANYE) — "Per Kampanye (Product
 * Ads)" mesin TikTok lama dan "Rincian per Sumber" yang di mesin Shopee lama
 * turun sampai baris kampanye.
 *
 * Bagian "iklan" yang sudah ada menjumlah seluruh kampanye jadi satu angka
 * per SUMBER. Itu menjawab "apakah iklan untung", tapi tidak pernah "iklan
 * yang MANA" — dan satu kampanye rugi yang tersembunyi di balik rata-rata
 * sumber yang sehat adalah persis anggaran yang harus dimatikan minggu
 * depan.
 *
 * `tanpaHasil` (biaya > 0 DAN GMV ≤ 0 atau tidak diketahui) memakai ambang
 * yang SAMA dengan dimensi skor Ads TikTok (`PdtSkorInputAdsTiktok`
 * `biayaTanpaHasil`) — bukan ambang baru yang ditebak di sini.
 *
 * Platform-agnostic: `pdt_fact_ads` memuat kelima sumber (`tt_ads_product`,
 * `tt_ads_live`, `shopee_ads_cpc`, `shopee_ads_search`, `shopee_ads_live`)
 * dengan bentuk baris yang sama.
 */
const TOP_KAMPANYE_N = 15;

export interface PdtLaporanKampanyeInputBaris {
  sumber: string;
  kampanyeId: string;
  biaya: number;
  gmv: number | null;
  tayangan: number | null;
  klik: number | null;
  pesanan: number | null;
}

export type PdtLaporanKampanyeInput = readonly PdtLaporanKampanyeInputBaris[] | null;

export interface PdtLaporanKampanyeItem {
  sumber: string;
  kampanyeId: string;
  biaya: number;
  gmv: number | null;
  /** `gmv ÷ biaya` — `null` bila `gmv` `null` ATAU `biaya` 0. DITURUNKAN, bukan dibaca kolom `roas` (aturan rumah #4). */
  roas: number | null;
  tayangan: number | null;
  klik: number | null;
  pesanan: number | null;
  /** `klik ÷ tayangan` — `null` bila salah satunya `null` ATAU `tayangan` 0. */
  ctr: number | null;
  /** `biaya ÷ klik` — `null` bila `klik` `null` ATAU 0. */
  cpc: number | null;
}

export interface PdtLaporanKampanye {
  /** Urut biaya desc — yang paling banyak membakar anggaran dibaca lebih dulu. */
  top: PdtLaporanKampanyeItem[];
  totalKampanye: number;
  /** Kampanye ber-`biaya > 0` yang GMV-nya ≤ 0 atau tidak diketahui. */
  tanpaHasil: number;
  /** Σ biaya kampanye `tanpaHasil` — `null` bila nol kampanye seperti itu. */
  biayaTanpaHasil: number | null;
}

/** Rakit "kampanye". `null` (whole object) bila `input` `null` ATAU nol baris. */
export function bangunLaporanKampanye(input: PdtLaporanKampanyeInput): PdtLaporanKampanye | null {
  if (input == null || input.length === 0) return null;

  const top: PdtLaporanKampanyeItem[] = [...input]
    .sort((a, b) => b.biaya - a.biaya)
    .slice(0, TOP_KAMPANYE_N)
    .map((b) => {
      const gmv = bulat(b.gmv);
      return {
        sumber: b.sumber,
        kampanyeId: b.kampanyeId,
        biaya: bulat(b.biaya) as number,
        gmv,
        roas: gmv == null || b.biaya === 0 ? null : desimal2(gmv / b.biaya),
        tayangan: bulat(b.tayangan),
        klik: bulat(b.klik),
        pesanan: bulat(b.pesanan),
        ctr: b.klik == null || b.tayangan == null || b.tayangan === 0 ? null : persen5(b.klik / b.tayangan),
        cpc: b.klik == null || b.klik === 0 ? null : bulat(b.biaya / b.klik),
      };
    });

  const nihil = input.filter((b) => b.biaya > 0 && (b.gmv == null || b.gmv <= 0));

  return {
    top,
    totalKampanye: input.length,
    tanpaHasil: nihil.length,
    biayaTanpaHasil: nihil.length === 0 ? null : bulat(nihil.reduce((a, b) => a + b.biaya, 0)),
  };
}

export interface PdtLaporanTiktok {
  schema: 'cdps.pdt.laporan.tiktok.v1';
  platform: 'tiktok';
  clientPlatformId: number;
  periodeAwalBulan: string;
  generatedAt: string;
  kpi: PdtLaporanKpiRingkas;
  /** `null` = nol baris `pdt_fact_shop_daily` di periode ini. */
  harian: PdtLaporanHarian | null;
  kanal: PdtLaporanKanal;
  iklan: PdtLaporanIklan | null;
  live: PdtLaporanLive | null;
  video: PdtLaporanVideo | null;
  produk: PdtLaporanProduk | null;
  afiliasi: PdtLaporanAfiliasi | null;
  /** Daftar per-kreator di balik ringkasan `afiliasi`. `null` = nol baris kreator periode ini. */
  kreator: PdtLaporanKreator | null;
  /** Daftar per-sesi di balik ringkasan `live`. `null` = nol sesi periode ini. */
  sesiLive: PdtLaporanSesiLive | null;
  /** Daftar per-kampanye di balik ringkasan `iklan`. `null` = nol baris iklan periode ini. */
  kampanye: PdtLaporanKampanye | null;
  /** SELALU `null` — `pdt_fact_promo` nol penulis fakta TikTok (lihat docblock `bangunLaporanPromo`). */
  promo: PdtLaporanPromo | null;
  /** SELALU `null` — `pdt_fact_layanan_chat`/`pdt_fact_kesehatan_penalti` nol penulis fakta TikTok. */
  layanan: PdtLaporanLayanan | null;
  tahap: PdtLaporanTahap | null;
  skor: PdtSkorHasilTiktok;
  benchmarkVersi: number;
  insight: PdtLaporanInsight;
  /** M20 R2 — catatan kelengkapan data. Mode render `klien` TIDAK membangunnya. */
  kelengkapan: PdtLaporanKelengkapan;
}

export interface PdtLaporanShopee {
  schema: 'cdps.pdt.laporan.shopee.v1';
  platform: 'shopee';
  clientPlatformId: number;
  periodeAwalBulan: string;
  generatedAt: string;
  kpi: PdtLaporanKpiRingkas;
  /** `null` = nol baris `pdt_fact_shop_daily` di periode ini. */
  harian: PdtLaporanHarian | null;
  kanal: PdtLaporanKanal;
  iklan: PdtLaporanIklan | null;
  live: PdtLaporanLive | null;
  video: PdtLaporanVideo | null;
  /** `distribusi` SELALU `null` sisi Shopee (nol klasifikator kuadran); `top` (Top Produk by GMV) terisi dari `pdt_fact_sku_period` basis `siap_dikirim` — lihat docblock `bangunLaporanProduk`. */
  produk: PdtLaporanProduk | null;
  afiliasi: PdtLaporanAfiliasi | null;
  /** Daftar per-kreator di balik ringkasan `afiliasi`. `null` = nol baris kreator periode ini. */
  kreator: PdtLaporanKreator | null;
  /** Daftar per-sesi di balik ringkasan `live`. `null` = nol sesi periode ini. */
  sesiLive: PdtLaporanSesiLive | null;
  /** Daftar per-kampanye di balik ringkasan `iklan`. `null` = nol baris iklan periode ini. */
  kampanye: PdtLaporanKampanye | null;
  /** §8 mesin lama. `null` = nol baris `pdt_fact_promo` periode ini. */
  promo: PdtLaporanPromo | null;
  /** §9 mesin lama. `null` = nol baris chat DAN nol baris kesehatan toko periode ini. */
  layanan: PdtLaporanLayanan | null;
  /** SELALU `null` — mesin lama Shopee tidak punya konsep buyer-journey sama sekali, lihat docblock `PdtLaporanTahap`. */
  tahap: PdtLaporanTahap | null;
  skor: PdtSkorHasilShopee;
  insight: PdtLaporanInsight;
  /** M20 R2 — catatan kelengkapan data. Mode render `klien` TIDAK membangunnya. */
  kelengkapan: PdtLaporanKelengkapan;
}

// ---------------------------------------------------------------------------
// Kelengkapan data (M20 R2) — caveat sebagai DATA, bukan prosa
// ---------------------------------------------------------------------------

/**
 * Bagian laporan yang bisa berstatus "belum lengkap".
 *
 * Sengaja union sempit, bukan `string`: penambahan bagian baru harus menyentuh
 * tipe ini, jadi bagian yang lahir tanpa penjelasan kelengkapannya tidak bisa
 * lolos diam-diam.
 */
export type PdtKelengkapanBagian = 'kanal' | 'iklan' | 'tahap';

/**
 * Satu baris kelengkapan. `alasan` ditulis untuk MATA AM, bukan mata klien —
 * ia menyebut modul parser, penulis fakta, dan istilah internal.
 */
export interface PdtLaporanKelengkapanBaris {
  bagian: PdtKelengkapanBagian;
  lengkap: boolean;
  /** Kalimat penjelas. String kosong kalau `lengkap` — nol kalimat untuk dibaca. */
  alasan: string;
  /** Modul parser PDT yang belum punya penulis fakta. Kosong kalau `lengkap`. */
  modulHilang: string[];
}

/**
 * Blok `kelengkapan` — M20 R2.
 *
 * ## Kenapa ini ada, dan kenapa ia BUKAN kalimat di `insight.poin`
 *
 * Sampai 2026-09-22 kelengkapan hidup sebagai dua kalimat prosa yang didorong
 * ke `insight.poin` ("Catatan: rincian kanal belum lengkap — …") plus tiga
 * banner yang teksnya ditulis tangan di JSX halaman internal. Dua bentuk, satu
 * makna, dan keduanya bocor ke audiens yang salah:
 *
 *  - `insight` ikut dibekukan ke `pdt_laporan_kiriman.payload`, jadi begitu
 *    permukaan laporan klien dibangun, kalimat itu **terbit ke klien**;
 *  - teks banner yang hidup di JSX tidak bisa dibaca mesin, jadi renderer
 *    manapun harus menebak ulang mana yang internal.
 *
 * Bagi klien kalimat itu beracun: ia terbaca "agensinya sendiri tidak tahu
 * angkanya", kebalikan dari maksudnya — yang sebenarnya menegakkan Rule 12
 * (tidak diketahui BUKAN nol).
 *
 * Maka kelengkapan pindah ke SINI, sebagai data terstruktur: mode `internal`
 * merendernya, mode `klien` tidak merendernya sama sekali (bukan CSS, bukan
 * `display:none` — stringnya tidak dibangun). `insight.poin` kembali murni
 * narasi performa.
 *
 * Ia TIDAK menghilangkan informasinya. Satu-satunya yang berubah adalah siapa
 * yang boleh membacanya.
 */
export interface PdtLaporanKelengkapan {
  /** `true` kalau SETIAP baris `lengkap`. Jalan pintas untuk penanya "ada yang perlu dijelaskan?". */
  semuaLengkap: boolean;
  baris: PdtLaporanKelengkapanBaris[];
}

/** Modul parser PDT yang belum punya penulis fakta, per celah yang diketahui. */
const MODUL_KANAL_SHOPEE = ['shopee_voucher', 'shopee_chat', 'meta_ads', 'shopee_video'];
const MODUL_IKLAN_SHOPEE = ['ads_banner'];
const MODUL_TAHAP_TIKTOK = [
  'tt_ads_manager_consideration', 'tt_ads_manager_follows',
  'tt_ads_manager_showcase', 'tt_ads_manager_videoviews',
];

export interface PdtLaporanKelengkapanInput {
  platform: 'tiktok' | 'shopee';
  kanal: PdtLaporanKanal;
  iklan: PdtLaporanIklan | null;
  tahap: PdtLaporanTahap | null;
}

/**
 * Rakit blok `kelengkapan` dari bagian yang SUDAH dibangun — nol query, nol
 * pengetahuan tentang DB.
 *
 * Status `tahap` diturunkan dari DATANYA (ada langkah funnel ber-`nilai: null`),
 * bukan dari daftar platform yang ditulis tangan. Begitu modul Ads Manager
 * mendarat dan funnel terisi, baris ini jadi `lengkap` **dengan sendirinya** —
 * tidak ada konstanta yang harus diingat untuk diubah.
 */
export function bangunLaporanKelengkapan(input: PdtLaporanKelengkapanInput): PdtLaporanKelengkapan {
  const baris: PdtLaporanKelengkapanBaris[] = [];

  baris.push(
    input.kanal.lengkap
      ? { bagian: 'kanal', lengkap: true, alasan: '', modulHilang: [] }
      : {
          bagian: 'kanal',
          lengkap: false,
          alasan: input.platform === 'shopee'
            ? 'Rincian kanal baru memuat Shopee Ads dan Affiliate. Voucher, Chat, Meta Ads, dan Video belum diproses PDT — GMV dari sumber itu TIDAK berarti nol, hanya belum terhitung di sini.'
            : 'Rincian kanal hanya memuat sumber yang sudah punya penulis fakta PDT. GMV dari sumber lain TIDAK berarti nol, hanya belum terhitung di sini.',
          modulHilang: input.platform === 'shopee' ? [...MODUL_KANAL_SHOPEE] : [],
        },
  );

  if (input.iklan) {
    baris.push(
      input.iklan.lengkap
        ? { bagian: 'iklan', lengkap: true, alasan: '', modulHilang: [] }
        : {
            bagian: 'iklan',
            lengkap: false,
            alasan: input.platform === 'shopee'
              ? 'Rincian iklan baru memuat Iklan Toko, Pencarian, dan Live. Banner Ads belum punya modul PDT — biaya/pendapatan dari sumber itu TIDAK berarti nol, hanya belum terhitung di sini.'
              : 'Sebagian sumber iklan belum punya modul PDT — biaya/pendapatan dari sumber itu TIDAK berarti nol, hanya belum terhitung di sini.',
            modulHilang: input.platform === 'shopee' ? [...MODUL_IKLAN_SHOPEE] : [],
          },
    );
  }

  if (input.tahap) {
    const kosong = input.tahap.funnel.filter((f) => f.nilai === null).map((f) => f.label);
    baris.push(
      kosong.length === 0
        ? { bagian: 'tahap', lengkap: true, alasan: '', modulHilang: [] }
        : {
            bagian: 'tahap',
            lengkap: false,
            alasan: `Langkah funnel berikut belum dipanen ke fakta, jadi ditandai "—", BUKAN nol aktivitas: ${kosong.join(', ')}. Sumbernya ekspor TikTok Ads Manager, yang belum punya modul PDT.`,
            modulHilang: [...MODUL_TAHAP_TIKTOK],
          },
    );
  }

  return { semuaLengkap: baris.every((b) => b.lengkap), baris };
}

export interface PdtLaporanTiktokOptions {
  clientPlatformId: number;
  periodeAwalBulan: string;
  generatedAt: string;
  kpi: PdtLaporanKpiInput | null;
  harian: PdtLaporanHarianInput;
  kanal: PdtLaporanKanalInputTiktok | null;
  iklan: PdtLaporanIklanInputTiktok | null;
  live: PdtLaporanLiveInput | null;
  video: PdtLaporanVideoInput | null;
  produk: PdtLaporanProdukInput;
  afiliasi: PdtLaporanAfiliasiInput | null;
  kreator: PdtLaporanKreatorInput;
  sesiLive: PdtLaporanSesiLiveInput;
  kampanye: PdtLaporanKampanyeInput;
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
  harian: PdtLaporanHarianInput;
  kanal: PdtLaporanKanalInputShopee | null;
  iklan: PdtLaporanIklanInputShopee | null;
  live: PdtLaporanLiveInput | null;
  video: PdtLaporanVideoInput | null;
  produk: PdtLaporanProdukInput;
  afiliasi: PdtLaporanAfiliasiInput | null;
  kreator: PdtLaporanKreatorInput;
  sesiLive: PdtLaporanSesiLiveInput;
  kampanye: PdtLaporanKampanyeInput;
  promo: PdtLaporanPromoInput;
  layanan: PdtLaporanLayananInput | null;
  skor: PdtSkorHasilShopee;
}

/** Rakit payload laporan TikTok v1 — KPI basis `'net'` (Rule 15, GMV−refund; pemanggil sudah menyerahkan gmv yang SUDAH di-net-kan). */
export function bangunLaporanTiktok(opts: PdtLaporanTiktokOptions): PdtLaporanTiktok {
  const kpi = bangunKpiRingkas(opts.kpi);
  const iklan = bangunIklanTiktok(opts.iklan);
  const afiliasi = bangunLaporanAfiliasi(opts.afiliasi);
  const video = bangunLaporanVideo(opts.video);
  const produk = bangunLaporanProduk(opts.produk, 'tiktok');
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
    harian: bangunLaporanHarian(opts.harian),
    kanal,
    iklan,
    live,
    video,
    produk,
    afiliasi,
    kreator: bangunLaporanKreator(opts.kreator),
    sesiLive: bangunLaporanSesiLive(opts.sesiLive),
    kampanye: bangunLaporanKampanye(opts.kampanye),
    promo: null,
    layanan: null,
    tahap,
    skor: opts.skor,
    benchmarkVersi: opts.benchmarkVersi,
    insight: bangunLaporanInsight({
      platform: 'tiktok', kpi, kanal, iklan, live, video, afiliasi, tahap, skor: opts.skor, benchTiktok: opts.benchTiktok,
    }),
    kelengkapan: bangunLaporanKelengkapan({ platform: 'tiktok', kanal, iklan, tahap }),
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
  const produk = bangunLaporanProduk(opts.produk, 'shopee');
  return {
    schema: 'cdps.pdt.laporan.shopee.v1',
    platform: 'shopee',
    clientPlatformId: opts.clientPlatformId,
    periodeAwalBulan: opts.periodeAwalBulan,
    generatedAt: opts.generatedAt,
    kpi,
    harian: bangunLaporanHarian(opts.harian),
    kanal,
    iklan,
    live,
    video,
    produk,
    afiliasi,
    kreator: bangunLaporanKreator(opts.kreator),
    sesiLive: bangunLaporanSesiLive(opts.sesiLive),
    kampanye: bangunLaporanKampanye(opts.kampanye),
    promo: bangunLaporanPromo(opts.promo, kpi.gmv),
    layanan: bangunLaporanLayanan(opts.layanan),
    tahap: null,
    skor: opts.skor,
    insight: bangunLaporanInsight({
      platform: 'shopee', kpi, kanal, iklan, live, video, afiliasi, tahap: null, skor: opts.skor, benchTiktok: null,
    }),
    kelengkapan: bangunLaporanKelengkapan({ platform: 'shopee', kanal, iklan, tahap: null }),
  };
}
