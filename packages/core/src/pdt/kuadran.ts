/**
 * PDT (Pusat Data Toko) — klasifikasi kuadran SKU, TikTok (G2-01-KUADRAN-SKU
 * langkah 2). Fungsi murni saja — nol I/O, nol DB. Pemanggil
 * (`packages/domain/src/pdt.ts`, `klasifikasiUlangKuadranSkuTiktok`) yang
 * membaca baris `pdt_fact_sku_period` + benchmark aktif, memanggil fungsi di
 * sini, lalu menulis kolom `kuadran`.
 *
 * Formula DISALIN (bukan diimpor) dari `report/metrik.ts` `kuadranProduk`
 * — konvensi "copy, don't cross-import" yang sudah dipakai `skor.ts`
 * (`renormalisasiDimensi`) dan `insight-edit.ts` (batas/pesan): `report/`
 * (mesin lama) sedang di-strangle (PDT-17) dan harus berevolusi independen
 * dari `pdt/`, meski nilainya identik hari ini.
 *
 * **Mode BENCHMARK SAJA** (bukan `relatif`/percentile mesin lama) — keputusan
 * desain, bukan tebakan: kolom `pdt_fact_sku_period.kuadran` ada untuk Rule 19
 * "pelacakan lintas bulan" (lihat komentar migrasi G1-01). Ambang `relatif`
 * mesin lama di-recompute SETIAP kali dari distribusi katalog periode itu
 * sendiri (percentile klik/CVR SKU aktif bulan ini) — dua bulan dengan
 * komposisi katalog berbeda akan punya ambang BERBEDA, membuat "SKU pindah
 * kuadran" tidak bisa dibedakan dari "ambang bergeser". Ambang `benchmark`
 * (`quad_klik`/`quad_cvr`, `pdt_benchmark` versi TikTok) TETAP antar periode
 * sampai direkalibrasi (Rule 25, append-only) — satu-satunya mode yang
 * kuadran-nya sungguh sebanding lintas bulan.
 *
 * `KLIK_MIN_UJI` (nilai `10`, disalin `report/metrik.ts`) — SKU dengan klik
 * di bawah ambang ini belum "diuji secara adil" (istilah mesin lama: tool
 * `SLEEP`), diklasifikasi `tidur` alih-alih dipaksa masuk salah satu dari
 * empat kuadran aktif berdasarkan CVR yang sample-size-nya terlalu kecil
 * untuk berarti.
 *
 * `cvr` per SKU: `ctor` (kolom `pdt_fact_sku_period.ctor`, kalau ada) —
 * fallback `pesananSku / klik` bila `ctor` tidak terpanen — cermin PERSIS
 * `kuadranProduk`: `cvr: ctor ?? (pesanan == null ? null : div(pesanan, klik))`.
 */
export type PdtKuadranSku =
  | 'bintang' | 'hidden_gem' | 'bocor_traffic' | 'evaluasi' | 'tidur' | 'tidak_tayang'
  /** SHOPEE SAJA — trafik ada tapi CR tidak bisa dihitung (`pesanan_dibuat` tak terpanen). TikTok tidak pernah menghasilkannya: di sana CVR `null` dengan klik cukup jatuh ke `tidur`, bukan ember sendiri. */
  | 'no_data';

export const KLIK_MIN_UJI = 10;

export interface PdtBenchmarkKuadranTiktok {
  quad_klik: { good: number; warn: number };
  quad_cvr: { good: number; warn: number };
}

export interface PdtBarisUntukKuadranSku {
  id: number;
  klik: number | null;
  ctor: number | null;
  pesananSku: number | null;
}

export interface PdtKuadranSkuHasil {
  id: number;
  kuadran: PdtKuadranSku;
}

function cvrBaris(b: PdtBarisUntukKuadranSku): number | null {
  if (b.ctor != null) return b.ctor;
  if (b.pesananSku == null || b.klik == null || b.klik === 0) return null;
  return b.pesananSku / b.klik;
}

/**
 * Klasifikasi kuadran SEJUMLAH baris SKU sekaligus — satu panggilan per
 * (client_platform_id, periode), bench SAMA untuk seluruh baris (satu
 * benchmark versi aktif per periode klasifikasi, bukan per SKU).
 */
export function klasifikasikanKuadranSkuTiktok(
  baris: readonly PdtBarisUntukKuadranSku[],
  bench: PdtBenchmarkKuadranTiktok,
): PdtKuadranSkuHasil[] {
  return baris.map((b): PdtKuadranSkuHasil => {
    const klik = b.klik ?? 0;
    if (!klik) return { id: b.id, kuadran: 'tidak_tayang' };
    const cvr = cvrBaris(b);
    if (klik < KLIK_MIN_UJI || cvr == null) return { id: b.id, kuadran: 'tidur' };
    const klikTinggi = klik >= bench.quad_klik.good;
    const cvrTinggi = cvr >= bench.quad_cvr.good;
    const kuadran: PdtKuadranSku =
      klikTinggi && cvrTinggi ? 'bintang' : !klikTinggi && cvrTinggi ? 'hidden_gem' : klikTinggi ? 'bocor_traffic' : 'evaluasi';
    return { id: b.id, kuadran };
  });
}

// ===========================================================================
// SHOPEE — `computeQuadrants` mesin lama (`report/shopee/metrik.ts`), mode
// ABSOLUTE. Algoritma yang BERBEDA dari TikTok di atas, bukan varian
// parameternya: sumbu-X-nya PENGUNJUNG produk (bukan klik), CR-nya
// `pesanan_dibuat ÷ pengunjung` (bukan CTOR/klik), ambangnya TIGA band
// (low/medium/high) dengan promosi `medium` bersyarat, sleeper-nya 50 (bukan
// 10), dan ia punya ember ketujuh `no_data` yang TikTok tidak punya.
//
// **Mode ABSOLUTE saja** — alasan IDENTIK dengan "benchmark saja" TikTok di
// atas: `pdt_fact_sku_period.kuadran` ada untuk Rule 19 "pelacakan lintas
// bulan", dan ambang percentile yang bergeser tiap periode membuat "SKU
// pindah kuadran" tak bisa dibedakan dari "ambang bergeser". Mode `relatif`
// mesin lama TETAP dihitung — tapi saat laporan dirakit, dari baris yang sama,
// TANPA disimpan (lihat `ambangRelatifKuadran` di bawah).
//
// Ambangnya KONSTANTA di sini, bukan baris `pdt_benchmark`: mesin skor Shopee
// (`report/shopee/skor.ts`) memang tidak menerima parameter benchmark sama
// sekali — asimetri NYATA terhadap TikTok yang sudah dicatat migrasi
// `20261031010000` dan `docs/DECISIONS.md` 2026-09-15, bukan celah untuk
// "diperbaiki" diam-diam di sini. Nilainya disalin dari
// `report/shopee/bench.ts` `REPORT_BENCH_SHOPEE_V1.kuadran` (tool `CONFIG`).
// ===========================================================================

/** Salinan `REPORT_BENCH_SHOPEE_V1.kuadran` — lihat komentar blok di atas untuk alasan ia konstanta, bukan baris `pdt_benchmark`. */
export const PDT_KUADRAN_SHOPEE = {
  /** Pengunjung produk minimum supaya SKU dianggap "sudah diuji adil" (tool `sleeper_visitor_max`). Di bawah ini ⇒ `tidur`. */
  pengunjungMinUji: 50,
  trafficRendah: 150,
  trafficTinggi: 500,
  crRendah: 0.02,
  crTinggi: 0.04,
} as const;

/** Percentile linear-interpolated — cermin persis `percentile()` mesin lama (`report/metrik.ts` dan `report/shopee/metrik.ts` memakai implementasi yang identik). `null` bila daftar kosong. */
export function percentileKuadran(terurut: readonly number[], p: number): number | null {
  if (terurut.length === 0) return null;
  if (terurut.length === 1) return terurut[0];
  const k = p * (terurut.length - 1);
  const f = Math.floor(k);
  const c = Math.min(f + 1, terurut.length - 1);
  return terurut[f] + (terurut[c] - terurut[f]) * (k - f);
}

export interface PdtAmbangKuadran {
  trafficRendah: number | null;
  trafficTinggi: number | null;
  crRendah: number | null;
  crTinggi: number | null;
  /** Cacah baris AKTIF yang membentuk percentile ini — nol ⇒ seluruh ambang `null` dan mode relatif tidak bisa dipakai. */
  n: number;
}

/** Ambang ABSOLUT Shopee dalam bentuk `PdtAmbangKuadran` — `n` `-1` menandai "bukan hasil percentile" (tidak ada baris yang membentuknya; ia konstanta). */
export const AMBANG_ABSOLUT_SHOPEE: PdtAmbangKuadran = {
  trafficRendah: PDT_KUADRAN_SHOPEE.trafficRendah,
  trafficTinggi: PDT_KUADRAN_SHOPEE.trafficTinggi,
  crRendah: PDT_KUADRAN_SHOPEE.crRendah,
  crTinggi: PDT_KUADRAN_SHOPEE.crTinggi,
  n: -1,
};

export interface PdtBarisUntukKuadranSkuShopee {
  id: number;
  /** `Pengunjung Produk (Kunjungan)` — BUKAN `Jumlah Produk Dilihat`. Dua kolom berbeda di berkas yang sama; pada Fim Motor Juli 2026 satu produk mencatat 32.949 vs 1.383.429, jadi memakai yang salah menggeser SELURUH katalog ke `evaluasi`. */
  pengunjung: number | null;
  pesananDibuat: number | null;
}

type Band = 'low' | 'medium' | 'high';

function band(v: number, rendah: number, tinggi: number): Band {
  if (v <= rendah) return 'low';
  if (v >= tinggi) return 'high';
  return 'medium';
}

/**
 * Cermin `resolveBand` mesin lama. `medium` TIDAK punya kuadran sendiri — ia
 * dipromosikan ke `high` hanya bila sumbu SEBELAHNYA sudah `high`, kalau tidak
 * turun ke `low`. Inilah yang membuat produk trafik sedang ber-CR bagus tetap
 * terbaca `bintang` alih-alih terbuang ke `hidden_gem`, dan sebaliknya.
 */
function selesaikanBand(
  tB: Band, cB: Band, traffic: number, cr: number, trafficTinggi: number, crTinggi: number,
): PdtKuadranSku {
  const tHi = tB === 'high' ? true : tB === 'medium' ? cr >= crTinggi : false;
  const cHi = cB === 'high' ? true : cB === 'medium' ? traffic >= trafficTinggi : false;
  return tHi && cHi ? 'bintang' : !tHi && cHi ? 'hidden_gem' : tHi ? 'bocor_traffic' : 'evaluasi';
}

/** CR yang dipakai kuadran Shopee: `pesanan_dibuat ÷ pengunjung` (tool `cr_basis: 'pesanan_per_pengunjung'`). `null` bila salah satu sisi tidak diketahui — Rule 12, bukan 0. */
export function crKuadranShopee(b: PdtBarisUntukKuadranSkuShopee): number | null {
  if (b.pengunjung == null || b.pengunjung === 0 || b.pesananDibuat == null) return null;
  return b.pesananDibuat / b.pengunjung;
}

/**
 * Klasifikasi kuadran SEJUMLAH baris SKU Shopee sekaligus — satu panggilan per
 * (client_platform_id, periode), ambang SAMA untuk seluruh baris.
 *
 * Urutan penyaring SAMA PERSIS mesin lama dan urutannya BERARTI: `tidak_tayang`
 * (nol pengunjung) mendahului `no_data` (pengunjung ada, CR tidak bisa
 * dihitung), yang mendahului `tidur` (pengunjung di bawah `pengunjungMinUji`).
 * Menukar dua yang terakhir akan menyembunyikan produk tanpa data pesanan di
 * dalam `tidur`.
 *
 * `ambang` default = ambang ABSOLUT (mode yang disimpan). Pemanggil laporan
 * mengoper ambang PERCENTILE (`ambangRelatifKuadran`) untuk panel kedua —
 * fungsi yang SAMA, karena mesin lama pun memakai `classify()` yang sama untuk
 * kedua mode dan hanya menukar keempat ambangnya. Band `medium` karena itu
 * hidup di kedua mode, tidak cuma di absolut.
 */
export function klasifikasikanKuadranSkuShopee(
  baris: readonly PdtBarisUntukKuadranSkuShopee[],
  ambang: PdtAmbangKuadran = AMBANG_ABSOLUT_SHOPEE,
): PdtKuadranSkuHasil[] {
  const tRendah = ambang.trafficRendah ?? 0, tTinggi = ambang.trafficTinggi ?? 0;
  const cRendah = ambang.crRendah ?? 0, cTinggi = ambang.crTinggi ?? 0;
  return baris.map((b): PdtKuadranSkuHasil => {
    const pengunjung = b.pengunjung;
    if (pengunjung == null || pengunjung === 0) return { id: b.id, kuadran: 'tidak_tayang' };
    const cr = crKuadranShopee(b);
    if (cr == null) return { id: b.id, kuadran: 'no_data' };
    if (pengunjung < PDT_KUADRAN_SHOPEE.pengunjungMinUji) return { id: b.id, kuadran: 'tidur' };
    return {
      id: b.id,
      kuadran: selesaikanBand(
        band(pengunjung, tRendah, tTinggi), band(cr, cRendah, cTinggi),
        pengunjung, cr, tTinggi, cTinggi,
      ),
    };
  });
}

// ===========================================================================
// Mode RELATIF (percentile) — panel kedua mesin lama, "dua sudut pandang:
// relatif antar produk, dan versus benchmark ideal".
//
// TIDAK PERNAH disimpan ke `pdt_fact_sku_period.kuadran` (lihat dua blok di
// atas); ia dihitung ulang setiap kali laporan dirakit, dari baris periode itu
// sendiri. Itulah yang membuatnya berguna DAN tidak berbahaya: berguna karena
// menjawab "SKU mana yang menonjol DI KATALOG INI", tidak berbahaya karena
// tidak ada satu pun perbandingan lintas bulan yang bersandar padanya.
// ===========================================================================

export interface PdtBarisUntukKuadranRelatif {
  id: number;
  /** Sumbu-X: `klik` untuk TikTok, `pengunjung` untuk Shopee. */
  traffic: number | null;
  cr: number | null;
}

/**
 * Ambang percentile p25/p75 atas baris AKTIF (traffic ≥ `trafficMinUji` DAN
 * `cr` diketahui).
 *
 * `crPositifSaja` membedakan kedua platform, dan perbedaannya SENGAJA (bukan
 * penyeragaman yang terlewat): mesin TikTok mengambil percentile CVR dari
 * SKU yang PERNAH closing saja, karena katalog ekor-panjang membuat p25 dan
 * p75 sama-sama runtuh ke 0 dan SETIAP produk terbaca "closing tinggi";
 * mesin Shopee mengambil percentile dari SELURUH CR aktif. Menyamakan
 * keduanya akan mengubah angka salah satu mesin.
 */
export function ambangRelatifKuadran(
  baris: readonly PdtBarisUntukKuadranRelatif[],
  trafficMinUji: number,
  crPositifSaja: boolean,
): PdtAmbangKuadran {
  const aktif = baris.filter((b) => (b.traffic ?? 0) >= trafficMinUji && b.cr != null);
  const t = aktif.map((b) => b.traffic as number).sort((a, b) => a - b);
  const cSemua = aktif.map((b) => b.cr as number);
  const c = (crPositifSaja ? cSemua.filter((v) => v > 0) : cSemua).sort((a, b) => a - b);
  return {
    trafficRendah: percentileKuadran(t, 0.25),
    trafficTinggi: percentileKuadran(t, 0.75),
    crRendah: percentileKuadran(c, 0.25),
    crTinggi: percentileKuadran(c, 0.75),
    n: aktif.length,
  };
}

/**
 * Klasifikasi DUA-BAND TikTok memakai ambang percentile — cermin
 * `classify('relatif')` mesin lama. Hanya `trafficTinggi`/`crTinggi` yang
 * memutuskan; `trafficRendah`/`crRendah` ikut dibawa `PdtAmbangKuadran` untuk
 * DITAMPILKAN saja, persis seperti `ambang.relatif` mesin lama.
 *
 * **Shopee TIDAK memakai fungsi ini** — di sana mode relatif adalah
 * `klasifikasikanKuadranSkuShopee` dengan ambang percentile, karena band
 * `medium` mesin Shopee hidup di kedua mode.
 *
 * Ambang `null` (nol baris aktif) ⇒ seluruh baris aktif jatuh ke `evaluasi`
 * lewat perbandingan terhadap 0 — perilaku yang SAMA dengan mesin lama
 * (`TH || 0`), bukan lemparan error.
 */
export function klasifikasikanKuadranRelatifTiktok(
  baris: readonly PdtBarisUntukKuadranRelatif[],
  trafficMinUji: number,
  ambang: PdtAmbangKuadran,
): PdtKuadranSkuHasil[] {
  const tHi = ambang.trafficTinggi ?? 0;
  const cHi = ambang.crTinggi ?? 0;
  return baris.map((b): PdtKuadranSkuHasil => {
    const traffic = b.traffic ?? 0;
    if (!traffic) return { id: b.id, kuadran: 'tidak_tayang' };
    if (traffic < trafficMinUji || b.cr == null) return { id: b.id, kuadran: 'tidur' };
    const t = traffic >= tHi, c = b.cr >= cHi;
    return { id: b.id, kuadran: t && c ? 'bintang' : !t && c ? 'hidden_gem' : t ? 'bocor_traffic' : 'evaluasi' };
  });
}
