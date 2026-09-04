/**
 * `parseShopeeExportFile` — the ONE piece of Shopee logic that lives in the
 * browser (SH-06 UI).
 *
 * Worth its own test because a silent failure here is invisible from both
 * sides: the POST succeeds, the engine scores something, and the numbers are
 * just wrong. Two properties carry the whole contract:
 *
 *  1. Every worksheet reaches the server. Reading only the first (what
 *     `parseExportFile` does for TikTok) would drop most of a Shopee export.
 *  2. A `__SHEET__:` marker row precedes each sheet. `@cdps/core`
 *     `report/shopee` breaks its section scans on `isSheetMarker`, so without
 *     the markers one sheet's table is read straight into the next one's rows —
 *     a wrong total, not an error.
 *
 * The detection, the scoring and every threshold stay server-side; this test
 * asserts the transport shape only.
 */
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseShopeeExportFile } from '@/lib/report';

/** The marker prefix `@cdps/core` `report/shopee/detect.ts` `SHEET_MARK` looks for. */
const SHEET_MARK = '__SHEET__:';

/** Build a real .xlsx byte stream from named sheets, wrapped as a File. */
function workbookFile(name: string, sheets: Array<{ name: string; rows: unknown[][] }>): File {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name);
  }
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([bytes], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

const firstCells = (aoa: unknown[][]): string[] => aoa.map((r) => String(r[0] ?? ''));

describe('parseShopeeExportFile', () => {
  it('reads EVERY worksheet, each preceded by its own __SHEET__ marker', async () => {
    const file = workbookFile('[bisnis]-Home && Juni 2026 && Klien && 2026-07-01.xlsx', [
      { name: 'Ringkasan', rows: [['Periode Waktu', 'Total Penjualan (IDR)'], ['Total', 'Rp1.000']] },
      { name: 'Harian', rows: [['Tanggal', 'Nilai'], ['01/06/2026', 'Rp250']] },
    ]);
    const parsed = await parseShopeeExportFile(file);

    expect(firstCells(parsed.aoa)).toEqual([
      `${SHEET_MARK}Ringkasan`,
      'Periode Waktu',
      'Total',
      `${SHEET_MARK}Harian`,
      'Tanggal',
      '01/06/2026',
    ]);
    // The second sheet's rows are genuinely present — not merely marked.
    expect(parsed.aoa[5]?.[1]).toBe('Rp250');
  });

  it('marks the FIRST sheet too, so a 1-sheet and a 3-sheet export have the same shape', async () => {
    const one = await parseShopeeExportFile(
      workbookFile('a.xlsx', [{ name: 'Data', rows: [['Nama Iklan', 'Biaya']] }]),
    );
    expect(String(one.aoa[0]?.[0])).toBe(`${SHEET_MARK}Data`);
    expect(String(one.aoa[1]?.[0])).toBe('Nama Iklan');
  });

  it('carries the provenance the server stores: filename, byte size, and a 64-hex sha256', async () => {
    const file = workbookFile('[ads]-Toko && Juni 2026 && Klien && 2026-07-01.xlsx', [
      { name: 'Ads', rows: [['Nama Iklan', 'Biaya'], ['Kampanye A', '5.000']] },
    ]);
    const parsed = await parseShopeeExportFile(file);
    expect(parsed.filename).toBe('[ads]-Toko && Juni 2026 && Klien && 2026-07-01.xlsx');
    expect(parsed.ukuran_bytes).toBe(file.size);
    expect(parsed.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes the bytes, not the name — two different exports never share provenance', async () => {
    const a = await parseShopeeExportFile(workbookFile('same.xlsx', [{ name: 'S', rows: [['x', '1']] }]));
    const b = await parseShopeeExportFile(workbookFile('same.xlsx', [{ name: 'S', rows: [['x', '2']] }]));
    expect(a.sha256).not.toBe(b.sha256);
  });

  it('keeps cells as strings — Indonesian thousand separators must survive to the server parser', async () => {
    const parsed = await parseShopeeExportFile(
      workbookFile('c.xlsx', [{ name: 'S', rows: [['Total Penjualan (IDR)'], ['1.234.567']] }]),
    );
    expect(parsed.aoa[2]?.[0]).toBe('1.234.567');
  });
});
