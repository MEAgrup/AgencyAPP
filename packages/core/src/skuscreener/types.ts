/**
 * MEA SKU Screener — shared types (Gelombang 3, `docs/plan/PLAN_KONSOLIDASI_ALAT_ADVERTISER.md`
 * §6). Pure and DOM-free, exactly like `../baseline` and `../report`: consumes
 * already-parsed sheets (`Aoa` — an already-`XLSX.utils.sheet_to_json(ws,{header:1})`
 * array-of-arrays, browser side) and CSV rows (already-split, browser side), never
 * touches xlsx/DOM itself.
 *
 * Spec sources (see `docs/design/README.md` for the exact resolution of every
 * place the two disagree):
 *  - `docs/design/PRD_MEA_SKU_SCREENER_v1.0.md` — R01-R16, the formal spec.
 *  - `docs/design/MEA_SKU_SCREENER_v2.html` — the shipped tool (Module A/B),
 *    ground truth for exact formulas/parsing/fallback behaviour.
 */
import type { Aoa } from '../baseline/types';

/** A workbook sheet with its name, exactly what `wb.SheetNames`/`wb.Sheets` yields. */
export interface NamedSheet {
  name: string;
  aoa: Aoa;
}

/**
 * One parent-SKU row from "Bisnis Saya → Performa Produk" (R02: `Kode Variasi
 * = '-'` rows only — variant rows are dropped upstream in `readPerformaProduk`
 * to prevent GMV double-counting).
 *
 * `ctr`/`cr` are percentages already (e.g. `5.24` means 5.24%), NOT fractions —
 * mirrors the export's own "Persentase Klik"/"Tingkat Konversi Pesanan" columns
 * and the shipped tool's arithmetic (`s.ctr>=mCTR` compares percent-to-percent).
 * `NaN` on any of `ctr`/`cr`/`aov` means "no basis to compute this", never a
 * silent 0 — every consumer that would otherwise misread that as "0%" must
 * check `isFinite()` first (house rule #7: no basis → `—`, never a fabricated
 * number).
 */
export interface SkuRecord {
  /** "Kode Produk" — may be '' when the column is absent/blank (A03: optional, name is the fallback key). */
  kode: string;
  produk: string;
  /** "Total Penjualan" (GMV), Rp. R03: kept as parsed, negative values (refund-heavy SKUs) stay negative. */
  gmv: number;
  orders: number;
  views: number;
  clicks: number;
  /** "Persentase Klik", percent. NaN if the cell is blank/absent for this row. */
  ctr: number;
  /** "Tingkat Konversi Pesanan", percent. NaN if the cell is blank/absent for this row. */
  cr: number;
  /** gmv / orders. NaN when orders <= 0 — there is no AOV to speak of, not Rp 0. */
  aov: number;
}

/** Thrown by the parse/read functions in `./parse.ts` (R01/A02/A03/A06 error paths). */
export class SkuScreenerParseError extends Error {}
