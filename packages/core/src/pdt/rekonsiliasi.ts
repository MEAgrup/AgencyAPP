/**
 * PDT (Pusat Data Toko) — rekonsiliasi (G1-07, PRD §3.3 Rule 13-16, PDT-16).
 *
 * Fungsi murni saja — nol I/O, nol DB. Pemanggil (belum ada, G1-09) yang
 * menulis `pdt_upload_batch.status`/`reconcile_delta_pct` dan baris
 * `pdt_fact_shop_daily`/`pdt_fact_sku_period`. Pola sama dengan G1-02..06:
 * engine murni lebih dulu, penulis DB menyusul saat pipa batch lengkap.
 *
 * **`parseShopeeShopStatsPerBasis` adalah salinan ALGORITMA (bukan impor)
 * dari `report/shopee/metrik.ts` `parseBisnisHome`/`parseHomeSection`/
 * `findRow`** — mesin LAMA itu sudah membaca ketiga basis dengan benar sejak
 * perbaikan SHP-1 (`docs/DECISIONS.md` 2026-09-03, `UAT_SHOPEE_FIM_MOTOR_20260903.md`),
 * termasuk pagar penting: mencari `'pesanan siap dikirim'`/`'pesanan dibayar'`
 * MULAI SETELAH kemunculan sebelumnya, supaya sheet lain di workbook yang
 * SAMA (`"(pesanan dibayar)Asal Penjualan"`, dst.) tidak salah tertangkap
 * sebagai section-nya. PDT sengaja TIDAK mengimpor modul lama itu (PDT-17
 * strangler: PDT adalah pengganti, bukan pemakai, mesin lama) — versi di
 * sini pakai `parsePdtAngka` (G1-03) alih-alih `pn()` legacy, dan hanya
 * mengambil `gmv`/`pesanan` (yang Rule 13 sebut), bukan 14 metrik penuh.
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
 */
import { parsePdtAngka } from './angka';

export type PdtBasisShopee = 'dibuat' | 'siap_dikirim' | 'dibayar';

const MARKER_BASIS: readonly { marker: string; basis: PdtBasisShopee }[] = [
  { marker: 'pesanan dibuat', basis: 'dibuat' },
  { marker: 'pesanan siap dikirim', basis: 'siap_dikirim' },
  { marker: 'pesanan dibayar', basis: 'dibayar' },
];

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

/** Cermin `findRow` (`report/shopee/metrik.ts`) — cari baris yang kolom pertamanya MEMUAT `needle`, mulai dari `start`. */
function cariBaris(aoa: readonly (readonly unknown[])[], needle: string, start: number): number {
  const n = needle.toLowerCase();
  for (let i = start; i < aoa.length; i++) {
    if (norm(aoa[i]?.[0]).includes(n)) return i;
  }
  return -1;
}

export interface PdtShopStatsTotal {
  gmv: number;
  pesanan: number;
}

/**
 * Baca SATU section basis `shopee_shop_stats` mulai dari baris marker
 * (`markerIdx`, baris yang isi kolom pertamanya `'Pesanan Dibuat'`/dst. —
 * Rule 7, header sesudahnya dicari dalam 6 baris berikut, bukan diasumsikan
 * posisi tetap). Baris TOTAL = baris tepat sesudah header (cermin
 * `parseHomeSection`: baris pertama sesudah header adalah ringkasan
 * shop-level, baik berlabel `'Total'` atau tidak — labelnya sendiri tidak
 * dibaca).
 */
function parseShopStatsSection(aoa: readonly (readonly unknown[])[], markerIdx: number): PdtShopStatsTotal | null {
  let hi = -1;
  for (let i = markerIdx; i < Math.min(markerIdx + 6, aoa.length); i++) {
    const c0 = norm(aoa[i]?.[0]);
    if (c0 === 'tanggal' || c0 === 'periode waktu') { hi = i; break; }
  }
  if (hi < 0) return null;
  const header = aoa[hi] ?? [];
  const totalRow = aoa[hi + 1];
  if (!totalRow) return null;
  const idxGmv = header.findIndex((c) => norm(c) === 'total penjualan (idr)' || norm(c).includes('total penjualan'));
  const idxPesanan = header.findIndex((c) => norm(c).includes('total pesanan'));
  if (idxGmv === -1 || idxPesanan === -1) return null;
  return { gmv: parsePdtAngka(totalRow[idxGmv]), pesanan: parsePdtAngka(totalRow[idxPesanan]) };
}

/**
 * Baca ketiga basis `shopee_shop_stats` sekaligus. Basis yang section-nya
 * tidak ditemukan di berkas ⇒ absen dari map (bukan `0` — sel absen ≠ sel
 * kosong, house rule #4/aturan-rumah pembagi-nol/ketiadaan).
 */
export function parseShopeeShopStatsPerBasis(aoa: readonly (readonly unknown[])[]): Partial<Record<PdtBasisShopee, PdtShopStatsTotal>> {
  const hasil: Partial<Record<PdtBasisShopee, PdtShopStatsTotal>> = {};
  let cari = 0;
  for (const { marker, basis } of MARKER_BASIS) {
    const idx = cariBaris(aoa, marker, cari);
    if (idx === -1) continue;
    const section = parseShopStatsSection(aoa, idx);
    if (section) hasil[basis] = section;
    cari = idx + 1; // Rule 7 + temuan SHP-1: cari section BERIKUTNYA setelah ini, supaya sheet lain di workbook yang sama (mis. "(pesanan dibayar)Asal Penjualan") tidak tertangkap sebagai section shop-level.
  }
  return hasil;
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
