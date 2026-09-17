/**
 * G4-02 · Satuan bertipe (docs/backlog/PDT_BACKLOG.md G4-02, Rule 27-28).
 *
 * `plan_row.satuan`/`strategi_resource.satuan` are free-text unit LABELS
 * ("video", "sesi", "Rp", "jam live", …) — they double as a display label AND,
 * for divisions with a `plantask` catalog, an identity key (`jenisBySatuan`).
 * That role is UNCHANGED by this module.
 *
 * What was missing (Rule 27) is a typed MEASUREMENT CATEGORY that a single
 * formatter (Rule 28) can dispatch on — the gap that let "20 sesi live" print
 * as "Rp 20,00" and a CTOR percentage print as Rupiah. `kategoriDariSatuanLabel`
 * derives that category from the existing free-text label; `formatNilaiSatuan`
 * is the one formatter every plan_row.kuota / strategi_resource.jumlah display
 * must go through. Reuses `pdt_satuan_t` (born G1-01 for `pdt_usulan_katalog`)
 * rather than inventing a second enum for the same concept.
 */
import { rp, num, dec, nil, DASH } from './baseline/angka';

export const PDT_SATUAN_KATEGORI = [
  'rupiah',
  'persen',
  'hitungan',
  'jam',
  'hari',
  'views',
  'rasio',
] as const;

export type PdtSatuanKategori = (typeof PDT_SATUAN_KATEGORI)[number];

/**
 * Label → kategori, ejaan yang SUNGGUH beredar hari ini (`plantask.ts`
 * PLAN_TASK_CATALOG + label bebas yang sudah diverifikasi terhadap data live
 * G4-02, docs/DECISIONS.md 2026-09-17). Tidak lengkap secara desain — label
 * yang tidak dikenal jatuh ke `hitungan` (lihat `kategoriDariSatuanLabel`),
 * bukan galat, karena mayoritas satuan bebas ("SKU", "kasus", "promo",
 * "konten", "sku", …) memang sebuah HITUNGAN, dan divisi tanpa katalog
 * (Account/Ops) tidak pernah memakai satuan Rupiah/persen/jam/rasio.
 */
const KATEGORI_DARI_LABEL: Readonly<Record<string, PdtSatuanKategori>> = {
  rp: 'rupiah',
  rupiah: 'rupiah',
  persen: 'persen',
  '%': 'persen',
  jam: 'jam',
  'jam live': 'jam',
  hari: 'hari',
  views: 'views',
  vv: 'views',
  x: 'rasio',
  rasio: 'rasio',
  kali: 'rasio',
};

/**
 * Turunkan kategori pengukuran dari label satuan bebas — dipakai SETIAP jalur
 * tulis `plan_row.satuan_kategori`/`strategi_resource.jumlah_satuan_kategori`
 * (createPlanRow/seedRowsFromPillars/copyRowToPeriod, saveResources), supaya
 * label baru yang belum terdaftar tetap dapat kategori yang aman
 * (`hitungan`), bukan gagal menulis.
 */
export function kategoriDariSatuanLabel(label: string): PdtSatuanKategori {
  return KATEGORI_DARI_LABEL[label.trim().toLowerCase()] ?? 'hitungan';
}

/**
 * Formatter TUNGGAL (Rule 28) — setiap tampilan plan_row.kuota/
 * strategi_resource.jumlah WAJIB lewat ini, bukan menebak dari nama
 * divisi/jenis task seperti `taskIsMoney` lama. `persen`/`rasio` menganggap
 * `nilai` SUDAH dalam skala tampil (mis. 1.5 untuk "1,5%"), sama seperti
 * `parseTargetKuota` menuliskannya — BUKAN pecahan 0..1 (beda skala dari
 * `baseline/angka.ts` `pct()`, yang punya kontrak input berbeda untuk
 * metrik export platform).
 */
export function formatNilaiSatuan(
  nilai: number | null | undefined,
  kategori: PdtSatuanKategori,
): string {
  if (nil(nilai)) return DASH;
  const v = nilai as number;
  switch (kategori) {
    case 'rupiah':
      return rp(v);
    case 'persen':
      return dec(v) + '%';
    case 'rasio':
      return dec(v) + 'x';
    case 'jam':
      return num(v) + ' jam';
    case 'hari':
      return num(v) + ' hari';
    case 'views':
      return num(v) + ' views';
    case 'hitungan':
      return num(v);
    default:
      return num(v);
  }
}
