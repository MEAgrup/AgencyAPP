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
export type PdtKuadranSku = 'bintang' | 'hidden_gem' | 'bocor_traffic' | 'evaluasi' | 'tidur' | 'tidak_tayang';

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
