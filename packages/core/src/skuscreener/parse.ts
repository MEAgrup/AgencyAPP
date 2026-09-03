/**
 * R01-R03, A02, A03, A06 — number parsing + the "Bisnis Saya → Performa Produk"
 * / ads-CPC readers. Ported from `docs/design/MEA_SKU_SCREENER_v2.html`
 * (`idNum`, `bacaBiz`, `cpcAds`, `parseCSV`).
 *
 * ── Why `parseIndonesianNumber` is NOT `../baseline/angka.ts`'s `n(v,raw)` ──
 * This is the OWNER'S THIRD Indonesian-number parser to reach this repo
 * (`n(v,raw)` in baseline is the first, Shopee Report Engine's `parseNumber`
 * the second — `docs/design/README.md`). Per CLAUDE.md ("jangan tulis versi
 * kedua dari aturan bisnis yang sama") the default is reuse, so this was
 * compared carefully against `n(v,raw)` before writing a fourth — and the two
 * are NOT behaviourally equivalent for what this module needs:
 *
 *   1. Absent/blank/'-'/'nan' → `n()` returns `0` (it is documented as "the
 *      VALUE parser: a present-but-empty cell is 0" — absence of the whole
 *      column is a different, separate concern handled by its callers).
 *      `idNum`/`parseIndonesianNumber` returns `NaN`. That distinction is
 *      load-bearing HERE: `SkuRecord.ctr`/`.cr` stay `NaN` when a row has no
 *      CTR/CR, and R05's routing (`route.ts`) and R06's CPC-max formula
 *      (`cpc.ts`) both branch on `isFinite(ctr)`/`isFinite(cr)` to tell "no
 *      data for this SKU" apart from "a real 0%". Reusing `n()` would collapse
 *      that distinction silently (every missing CTR/CR would read as a real
 *      0%, changing routing outcomes).
 *   2. `n()` has no support for parenthesised negatives (`"(1.234)"` → -1234),
 *      which R03 (refunds/negative GMV must stay negative, never `.abs()`)
 *      needs and Shopee's own export uses for negative figures.
 *   3. `n()`'s `raw` flag exists for TikTok Ads Manager's float-with-comma-
 *      thousands format — never present in a Shopee Seller Centre export, so
 *      every call site here would hardcode `raw=false` anyway; carrying the
 *      flag through would be dead API surface.
 *
 * Net: same "titik = ribuan, koma = desimal" core algorithm, different
 * absent-value contract that this module's NaN-based branching depends on.
 * Keeping it as a NAMED, documented difference (this comment) rather than
 * silently forking `n()` is the point — see CLAUDE.md's warning about
 * "menciptakan versi kedua dari aturan bisnis yang sama".
 */
import { NamedSheet, SkuRecord, SkuScreenerParseError } from './types';

/**
 * R01 — parse a single Shopee-export cell into a number.
 *  - "740.900" (one dot, all post-dot segments exactly 3 digits) → thousands → 740900.
 *  - "249.535.512" (two+ dots) → thousands → 249535512.
 *  - "3,21" (single comma) → decimal → 3.21.
 *  - "1.234,56" (dot AND comma) → dot=thousands, comma=decimal → 1234.56.
 *  - '', '-', 'nan', 'None', null, undefined → NaN (never 0 — R01 explicit).
 *  - "(1.234)" → parenthesised negative → -1234.
 *  - DILARANG (R01): never hand this string to `parseFloat()` directly without
 *    the preprocessing below.
 */
export function parseIndonesianNumber(v: unknown): number {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'number') return v;
  let s = String(v).trim();
  if (s === '' || s === '-' || s.toLowerCase() === 'nan' || s.toLowerCase() === 'none') return NaN;
  s = s.replace(/\s/g, '').replace(/%/g, '').replace(/^Rp/i, '');
  const neg = /^\(.*\)$/.test(s);
  if (neg) s = s.slice(1, -1);
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    s = s.replace(',', '.');
  } else if (hasDot) {
    const parts = s.split('.');
    if (parts.length > 1 && parts.slice(1).every((x) => x.length === 3)) s = parts.join('');
  }
  const n = parseFloat(s);
  if (!isFinite(n)) return NaN;
  return neg ? -n : n;
}

/**
 * Minimal RFC4180-ish CSV parser (quoted fields, `""` escape, BOM strip) —
 * ported verbatim from the tool's `parseCSV`. Pure string handling, no DOM,
 * so it stays in `packages/core` alongside the reader that consumes its
 * output (`readAdsCpc`) rather than living in a browser-only adapter.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inQuotes) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * A02 — pick the "Performa Produk" sheet by name (case-insensitive substring
 * match), falling back to the FIRST sheet in the workbook when no sheet name
 * contains "performa" (owner tools already ship exports whose sheet name
 * doesn't literally say "Performa" in every Seller Centre locale — the
 * shipped HTML's own defensive fallback, mirrored per `docs/design/README.md`).
 */
export function pickPerformaSheet(sheets: readonly NamedSheet[]): NamedSheet {
  if (!sheets.length) {
    throw new SkuScreenerParseError('Tidak ada sheet yang ditemukan pada berkas ini.');
  }
  return sheets.find((s) => s.name.toLowerCase().includes('performa')) ?? sheets[0];
}

/**
 * R01/R02/R03/A02/A03 — read "Bisnis Saya → Performa Produk" (.xlsx, already
 * parsed to AoA by the browser) into parent-SKU records.
 *
 *  - A02: sheet picked by `pickPerformaSheet` (name fallback).
 *  - Header row is literally the sheet's FIRST row (mirrors `bacaBiz` — this
 *    export has no meta/filter rows above the header, unlike the TikTok
 *    baseline/report exports that need `readSheet`'s 8-row scan).
 *  - Columns matched by PREFIX (`h.startsWith(prefix)`), not exact string —
 *    mirrors the tool verbatim so column-name suffix variants across Seller
 *    Centre versions keep matching.
 *  - A03: "Kode Produk" is OPTIONAL — its absence degrades `kode` to `''`
 *    (fallback to normalized `produk` name happens downstream in `compare.ts`,
 *    R09), it does NOT fail the whole read.
 *  - R02: only `Kode Variasi === '-'` (or literally blank — defensive, same
 *    as the shipped tool) rows are kept; variant rows are dropped so GMV is
 *    never double-counted.
 *  - R03: `gmv`/`orders` etc. are the parsed value as-is — no `.abs()` is
 *    ever applied, so refund-heavy SKUs (negative GMV) stay negative.
 *  - A rule this module does NOT relax: only SKUs with `views > 0` are kept
 *    (R05's precondition — "Setiap SKU yang punya Views > 0 dirutekan…").
 */
export function readPerformaProduk(sheets: readonly NamedSheet[]): SkuRecord[] {
  const sheet = pickPerformaSheet(sheets);
  const rows = sheet.aoa;
  if (!rows.length) {
    throw new SkuScreenerParseError('Sheet performa produk kosong.');
  }
  const header = (rows[0] ?? []).map((x) => String(x ?? '').trim());
  const colIndex = (prefix: string): number => header.findIndex((h) => h.startsWith(prefix));

  const iVariasi = colIndex('Kode Variasi');
  const iProduk = colIndex('Produk');
  const iKode = colIndex('Kode Produk'); // A03: optional
  const iGmv = colIndex('Total Penjualan');
  const iViews = colIndex('Jumlah Produk Dilihat');
  const iClicks = colIndex('Produk Diklik');
  const iCtr = colIndex('Persentase Klik');
  const iCr = colIndex('Tingkat Konversi Pesanan');
  const iOrders = colIndex('Pesanan Dibuat');

  if (iGmv < 0 || iOrders < 0 || iViews < 0) {
    throw new SkuScreenerParseError(
      'Kolom Total Penjualan / Pesanan Dibuat / Jumlah Produk Dilihat tidak ditemukan. Pastikan ini ekspor Bisnis Saya → Performa Produk.',
    );
  }

  const out: SkuRecord[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.length) continue;

    // R02 — parent-SKU rows only (defensive: blank counts as parent too, A01).
    const kodeVariasi = String(row[iVariasi] ?? '').trim();
    if (kodeVariasi !== '-' && kodeVariasi !== '') continue;

    const views = parseIndonesianNumber(row[iViews]);
    if (!(views > 0)) continue;

    const orders = parseIndonesianNumber(row[iOrders]) || 0;
    // R03 — never .abs(): a refund-heavy SKU's negative GMV stays negative.
    const gmv = parseIndonesianNumber(row[iGmv]) || 0;

    out.push({
      kode: iKode >= 0 ? String(row[iKode] ?? '').trim() : '',
      produk: String(row[iProduk] ?? '(tanpa nama)').trim(),
      gmv,
      orders,
      views,
      clicks: parseIndonesianNumber(row[iClicks]) || 0,
      ctr: parseIndonesianNumber(row[iCtr]),
      cr: parseIndonesianNumber(row[iCr]),
      aov: orders > 0 ? gmv / orders : NaN,
    });
  }

  if (!out.length) {
    throw new SkuScreenerParseError('Tidak ada SKU induk dengan views di file ini.');
  }
  return out;
}

/**
 * A06 — read "Laporan Iklan Produk / CPC" (.csv, already split into rows by
 * the browser via `parseCsv`) and return the store-wide actual CPC
 * (Σ Biaya ÷ Σ Jumlah Klik).
 *
 * The header row is searched DYNAMICALLY in the first 20 rows for a row that
 * contains BOTH "Biaya" and "Jumlah Klik" — never hardcoded to row 7 (PRD
 * A06's assumption), because the shipped tool's dynamic search is what
 * actually survives real exports (`docs/design/README.md`).
 */
export function readAdsCpc(rows: readonly (readonly unknown[])[]): number {
  let headerRow = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = (rows[i] ?? []).map((c) => String(c ?? '').trim());
    if (cells.includes('Biaya') && cells.includes('Jumlah Klik')) {
      headerRow = i;
      break;
    }
  }
  if (headerRow < 0) {
    throw new SkuScreenerParseError('Ini sepertinya bukan Laporan Iklan Produk/CPC Shopee.');
  }
  const header = (rows[headerRow] ?? []).map((c) => String(c ?? '').trim());
  const iBiaya = header.indexOf('Biaya');
  const iKlik = header.indexOf('Jumlah Klik');

  let totalBiaya = 0;
  let totalKlik = 0;
  for (let r = headerRow + 1; r < rows.length; r++) {
    const biaya = parseIndonesianNumber(rows[r]?.[iBiaya]);
    const klik = parseIndonesianNumber(rows[r]?.[iKlik]);
    if (isFinite(biaya)) totalBiaya += biaya;
    if (isFinite(klik)) totalKlik += klik;
  }
  if (!(totalKlik > 0)) {
    throw new SkuScreenerParseError('Total klik nol, CPC tidak bisa dihitung.');
  }
  return totalBiaya / totalKlik;
}
