/**
 * @cdps/core px/gerbang — mesin MURNI gerbang admisi Product Exchange M3-B,
 * empat lapis berurutan (PRD `CDPS_ProductExchange_M3.md` §3.1, Rule 1-3).
 *
 * Nol I/O di sini: `packages/domain/src/productexchange-m3.ts` membaca
 * seluruh fakta (volume, kategori, harga, snapshot) dari DB dan menyerahkan
 * satu `PxEvaluasiInput` sudah-jadi per produk; modul ini hanya memutuskan
 * verdict. `bacaVokabPlatform` DIDUPLIKASI kecil dari
 * `packages/domain/src/pdt.ts` `platformKeVokabPdt` — sengaja, bukan lupa:
 * `@cdps/core` tidak boleh mengimpor dari `@cdps/domain` (arah dependensi
 * terbalik), dan pemetaan tiga baris ini jauh lebih murah untuk dijaga dua
 * kali daripada membalik arsitektur paket.
 */

/** Kosakata platform PX (sama dengan `pdt.PdtPlatform`, diduplikasi — lihat header). */
export type PxPlatform = 'tiktok' | 'shopee';

/** `client_platforms.platform` (Title Case) → kosakata PX. `null` = platform di luar cakupan PX sama sekali. */
export function bacaVokabPlatform(platform: string): PxPlatform | null {
  if (platform === 'Shopee') return 'shopee';
  if (platform === 'TikTok Shop') return 'tiktok';
  return null;
}

/**
 * jendelaBulanPenuh — PX-M3-02: "jendela 30 hari tertutup penuh" diketok
 * ulang sebagai "batch verified terakhir menutup satu bulan kalender penuh"
 * (fakta `pdt_fact_sku_period` bergranularitas bulanan, bukan harian).
 * `periodeMulai`/`periodeSelesai` adalah string `YYYY-MM-DD`. Parsing manual
 * (bukan `Date` lokal) supaya tidak ada penggeseran zona waktu — pola sama
 * `bridge.ts` `monthsBetween`.
 */
export function jendelaBulanPenuh(periodeMulai: string, periodeSelesai: string): boolean {
  const [y1, m1, d1] = periodeMulai.split('-').map(Number);
  const [y2, m2, d2] = periodeSelesai.split('-').map(Number);
  if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return false;
  if (d1 !== 1) return false;
  if (y1 !== y2 || m1 !== m2) return false;
  const hariTerakhirBulan = new Date(Date.UTC(y1, m1, 0)).getUTCDate();
  return d2 === hariTerakhirBulan;
}

/** Satu band `price_segment_bands` dari `px_eligibility_policy.nilai` (PX-M3-06). */
export interface PriceSegmentBand {
  segment: string;
  /** `null` = tak terbatas — harus band TERAKHIR (urut ascending, diperiksa `validasiNilai` domain). */
  maxIdr: number | null;
}

/**
 * hitungPriceSegment — Rule 12 PRD: `price_segment` DIHITUNG dari
 * `harga_satuan_terakhir`, tidak pernah diketik. Band harga BATAS ATAS
 * INKLUSIF (`hargaSatuan <= maxIdr`); band pertama yang cocok, urut ascending,
 * `maxIdr: null` di akhir selalu cocok. `null` hanya bila `bands` kosong
 * (config kosong — seharusnya dicegah `validasiNilai`, bukan alasan untuk
 * melempar exception di mesin murni ini).
 */
export function hitungPriceSegment(hargaSatuan: number, bands: readonly PriceSegmentBand[]): string | null {
  for (const b of bands) {
    if (b.maxIdr === null || hargaSatuan <= b.maxIdr) return b.segment;
  }
  return null;
}

export type PxVerdict =
  | 'lolos'
  | 'volume_kurang'
  | 'tanpa_agency_plan'
  | 'platform_belum_didukung'
  | 'kategori_belum_dikonfirmasi'
  | 'kreator_kosong'
  | 'data_tidak_lengkap';

/** Volume 30 hari (bulan kalender) yang domain sudah baca dari `px_sku_volume`, atau `null` bila belum pernah dihitung. */
export interface PxVolumeInput {
  gmv30d: number;
  jendelaMulai: string;
  jendelaSelesai: string;
}

/** Satu produk siap dievaluasi — domain sudah membaca seluruh fakta, mesin ini nol query. */
export interface PxEvaluasiInput {
  /** `client_platforms.shop_id` — `null` ⇒ gagal L1 (`tanpa_agency_plan`). */
  shopId: string | null;
  /** `client_platforms.platform`, Title Case (mis. `'TikTok Shop'`). */
  platform: string;
  /** `px_eligibility_policy.nilai.platforms`, kosakata PX (`'tiktok'`/`'shopee'`). */
  policyPlatforms: readonly string[];
  salesThresholdIdr: number;
  volume: PxVolumeInput | null;
  /** `px_sku_kategori.level2_category` — `null` ⇒ belum dikonfirmasi AM. */
  level2Category: string | null;
  /** `pdt_sku_master.harga_satuan_terakhir` (max non-null antar varian produk) — `null` ⇒ L3 gagal juga. */
  hargaSatuanTerakhir: number | null;
  priceSegmentBands: readonly PriceSegmentBand[];
  /** Status baris `px_coverage_snapshot` terbaru untuk `(level2Category, priceSegment)` — `null` = nol baris snapshot. */
  coverageStatus: 'covered' | 'kosong' | null;
}

export interface PxEvaluasiResult {
  verdict: PxVerdict;
  /** `null` ⇔ `verdict === 'lolos'` (CHECK `ck_px_sku_eligibility_lapis`, migrasi 20261101010000). */
  lapisGagal: 1 | 2 | 3 | 4 | null;
  /** Provenans — nilai yang DIPAKAI saat evaluasi ini (null sebelum L3 lolos). */
  levelCategory: string | null;
  priceSegment: string | null;
}

function gagal(
  verdict: Exclude<PxVerdict, 'lolos'>,
  lapisGagal: 1 | 2 | 3 | 4,
  levelCategory: string | null = null,
  priceSegment: string | null = null,
): PxEvaluasiResult {
  return { verdict, lapisGagal, levelCategory, priceSegment };
}

/**
 * evaluasiLapis — gerbang empat lapis, urutan WAJIB dipertahankan (Rule 1
 * PRD §3.1): L3 tidak pernah dievaluasi untuk produk yang sudah gagal L2, dst.
 * Verdict TIDAK PERNAH memuat angka volume (D-06) — hanya lapisGagal +
 * kategori/segmen sebagai provenans keputusan L3/L4.
 */
export function evaluasiLapis(input: PxEvaluasiInput): PxEvaluasiResult {
  // L1 — client_platforms.shop_id + platform (ketokan 6, D-23/PX-M3-11 seed policy).
  if (input.shopId === null) return gagal('tanpa_agency_plan', 1);
  const vokab = bacaVokabPlatform(input.platform);
  if (vokab === null || !input.policyPlatforms.includes(vokab)) return gagal('platform_belum_didukung', 1);

  // L2 — volume 30 hari (bulan kalender penuh, PX-M3-02), basis dibayar.
  if (input.volume === null) return gagal('data_tidak_lengkap', 2);
  if (!jendelaBulanPenuh(input.volume.jendelaMulai, input.volume.jendelaSelesai)) {
    return gagal('data_tidak_lengkap', 2);
  }
  if (input.volume.gmv30d < input.salesThresholdIdr) return gagal('volume_kurang', 2);

  // L3 — kategori dikonfirmasi AM (D-24) + harga satuan ⇒ price_segment.
  if (input.level2Category === null || input.hargaSatuanTerakhir === null) {
    return gagal('kategori_belum_dikonfirmasi', 3, input.level2Category);
  }
  const priceSegment = hitungPriceSegment(input.hargaSatuanTerakhir, input.priceSegmentBands);
  if (priceSegment === null) return gagal('kategori_belum_dikonfirmasi', 3, input.level2Category);

  // L4 — coverage snapshot MCN terbaru (D-20).
  if (input.coverageStatus !== 'covered') {
    return gagal('kreator_kosong', 4, input.level2Category, priceSegment);
  }

  return { verdict: 'lolos', lapisGagal: null, levelCategory: input.level2Category, priceSegment };
}
