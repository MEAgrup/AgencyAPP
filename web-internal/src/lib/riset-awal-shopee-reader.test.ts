/**
 * O78 — Riset Awal harus memakai pembaca Shopee untuk platform Shopee.
 *
 * KENAPA TES INI ADA. Export Seller Centre menaruh tiap section di WORKSHEET
 * terpisah ("Pesanan Dibuat", "Pesanan Siap Dikirim", "Pesanan Dibayar"),
 * sementara `@cdps/core` `report/shopee/metrik.ts` mencari section itu lewat
 * BARIS yang menyebut namanya — baris yang cuma ada kalau pembacanya menulis
 * penanda `__SHEET__:<nama>` per sheet. Kontrak itu tertulis di
 * `report/shopee/detect.ts` ("the browser-side reader is expected to
 * concatenate them with a `__SHEET__:name` marker row"), tapi `RisetAwalPanel`
 * memakai `parseExportFile` — pembaca TikTok, sheet PERTAMA saja, tanpa
 * penanda — untuk SEMUA platform. Akibatnya setiap unggahan Shopee di Riset
 * Awal mati dengan `[Home: section pesanan tidak dikenali]`, padahal berkasnya
 * benar dan mesinnya benar. Terlihat di produksi 2026-09-19 dengan export asli
 * Fim Motor Juli 2026 (`docs/DECISIONS.md` O78).
 *
 * Dua sisi di-assert, karena yang rusak adalah PASANGANnya — bukan salah
 * satunya:
 *
 *  1. **Perilaku** — pembaca TikTok memang membuang section Shopee, pembaca
 *     Shopee memang mempertahankannya. Ini yang membuat tes ini tidak lulus
 *     hanya karena kebetulan.
 *  2. **Pemasangan** — `RisetAwalPanel` benar-benar memilih pembaca per
 *     platform. Tanpa ini, seseorang bisa menyeragamkan panggilannya lagi ke
 *     `parseExportFile` dan semua tes lain tetap hijau, persis seperti sebelum
 *     O78 ditemukan.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseExportFile, parseShopeeExportFile } from '@/lib/riset-awal';

const ROOT = resolve(__dirname, '..', '..');

/** Penanda yang dicari `@cdps/core` `report/shopee/detect.ts` (`SHEET_MARK`). */
const SHEET_MARK = '__SHEET__:';

/**
 * Bentuk SETIA export `<toko>.shopee-shop-stats.<rentang>.xlsx`: tiga section
 * sebagai tiga sheet, masing-masing baris ringkasan lalu baris harian. Nama
 * section TIDAK pernah muncul sebagai isi sel — hanya sebagai nama sheet.
 * Di situlah seluruh masalahnya.
 */
function shopeeShopStatsFile(): File {
  const tabel = [
    ['Tanggal', 'Total Penjualan (IDR)', 'Total Pesanan', 'Total Pengunjung'],
    ['01-07-2026-31-07-2026', '1.624.937.476', '13568', '361197'],
    ['', '', '', ''],
    ['Tanggal', 'Total Penjualan (IDR)', 'Total Pesanan', 'Total Pengunjung'],
    ['01-07-2026', '56.385.206', '459', '15095'],
  ];
  const wb = XLSX.utils.book_new();
  for (const nama of ['Pesanan Dibuat', 'Pesanan Siap Dikirim', 'Pesanan Dibayar']) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tabel), nama);
  }
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([bytes], 'fim_motor.shopee-shop-stats.20260701-20260731.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** Teks gabungan tiap baris — cara mesin mencari nama section. */
const teksBaris = (aoa: unknown[][]): string[] =>
  aoa.map((r) => (r ?? []).map((c) => String(c ?? '').toLowerCase()).join(' '));

describe('O78 — pembaca export Riset Awal dipilih per platform', () => {
  it('pembaca TikTok membuang dua dari tiga section, dan tidak menulis satu pun penanda sheet', async () => {
    const { aoa } = await parseExportFile(shopeeShopStatsFile());
    const baris = teksBaris(aoa);

    expect(baris.some((b) => b.includes(SHEET_MARK.toLowerCase()))).toBe(false);
    // Inilah `findRow(rows, 'pesanan dibuat')` di `metrik.ts` yang gagal.
    expect(baris.some((b) => b.includes('pesanan dibuat'))).toBe(false);
    expect(baris.some((b) => b.includes('pesanan dibayar'))).toBe(false);
  });

  it('pembaca Shopee menyimpan ketiga section, masing-masing didahului penandanya', async () => {
    const { aoa } = await parseShopeeExportFile(shopeeShopStatsFile());
    const baris = teksBaris(aoa);

    for (const section of ['pesanan dibuat', 'pesanan siap dikirim', 'pesanan dibayar']) {
      expect(baris.some((b) => b.includes(`${SHEET_MARK.toLowerCase()}${section}`))).toBe(true);
    }
    // Penanda mendahului tabelnya, bukan menyusul — `parseHomeSection` mencari
    // header 'Tanggal' dalam 6 baris SESUDAH posisi section.
    const iDibuat = baris.findIndex((b) => b.includes(`${SHEET_MARK.toLowerCase()}pesanan dibuat`));
    expect(String(aoa[iDibuat + 1]?.[0] ?? '').toLowerCase()).toBe('tanggal');
  });

  it('RisetAwalPanel memilih pembacanya dari platform, bukan satu pembaca untuk semua', () => {
    const src = readFileSync(
      join(ROOT, 'src', 'components', 'interview', 'RisetAwalPanel.tsx'),
      'utf8',
    );
    expect(src).toContain('parseShopeeExportFile');
    expect(src).toMatch(/mesin === 'shopee'\s*\?\s*parseShopeeExportFile\s*:\s*parseExportFile/);
    // Panggilan langsung `parseExportFile(` berarti pilihannya di-bypass lagi.
    expect(src).not.toMatch(/await parseExportFile\(/);
  });
});
