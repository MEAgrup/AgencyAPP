/**
 * Shopee report engine — per-module parsers + section metrics.
 *
 * Ported from the tool's `parse*`/`build*` functions. Same three rules that
 * govern TikTok's `../metrik.ts`, restated for Shopee's own failure modes:
 *
 *  1. **A missing/NA cell is `null`, never a silent 0.** The tool itself
 *     already gets this half right at the CELL level (`parseNumber` returns
 *     `null` for `"-"`, `"n/a"`, `"tidak terbatas"`, …) — see `pn()` below.
 *     Where it loses the distinction is every AGGREGATION site written
 *     `.reduce((a,i)=>a+(i.omzet||0),0)` or `s.roas||0`: a null there silently
 *     becomes 0 and a store with NO ads data reads as "ROAS 0", indistinguishable
 *     from "ROAS zero because ads ran and made nothing". Every sum here uses
 *     `sumOpt` (stays null when nothing had the field) instead.
 *  2. **Division by zero is `null`, not 0 and not an error** (`div`, house rule #7).
 *  3. **Number parsing delegates to the house parser, not a second locale engine.**
 *     See `pn()`.
 *
 * ⚠️ Shape choice: this module works on raw `Aoa` (array-of-arrays), NOT
 * TikTok's column-keyed `Sheet`. See `./types.ts` file header for why — Shopee
 * exports carry multi-section files with header rows found by scanning, not
 * one fixed header per file.
 */
import { div, n as nBase } from '../../baseline/angka';
import type { Aoa } from '../../baseline/types';
import { isSheetMarker } from './detect';
import type { Flag, ShopeeBench } from './types';

// ---------------------------------------------------------------------------
// Number parsing — NA-aware wrapper over the house parser
// ---------------------------------------------------------------------------
/**
 * Cell values the export uses to mean "no data", distinct from a genuine 0.
 * Verbatim from the tool's `NA` set (`docs/design/SHOPEE_REPORT_ENGINE.html:78`).
 */
const NA_TOKENS = new Set(['-', '--', '', 'n/a', 'tidak terbatas', 'null', 'undefined']);

/**
 * Parse one cell. `raw=true` for Ads-Center/CSV exports (dot = decimal, comma
 * = thousands — the tool's `locale='en'`), `raw=false`/omitted for Seller
 * Center xlsx exports (dot = thousands, comma = decimal — tool `locale='id'`).
 * Same `raw` contract as `baseline/angka.ts:n()`, and for good reason: once
 * the NA-sentinel check below is done, the tool's own id/en locale branches
 * are — cell for cell — the SAME disambiguation `n()` already implements
 * (compared by hand against every branch; see the code review that ported
 * this). Re-deriving that logic here would be parser #4 in this codebase
 * (TikTok baseline, TikTok report reader, and now two Shopee copies) — so this
 * delegates the actual numeric parsing to `n()` and adds only what `n()`
 * cannot know:
 *   (a) which tokens mean "no data" here (broader than `n()`'s own `-`/`—`/`N/A`,
 *       and — the actual divergence from `n()` — MEANS null, not 0), and
 *   (b) an `H:MM:SS` duration cell (Shopee's average chat response time),
 *       a shape `n()` has no reason to know about.
 */
export function pn(v: unknown, raw?: boolean): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s0 = String(v).trim();
  if (NA_TOKENS.has(s0.toLowerCase())) return null;
  const m = s0.match(/^(\d{1,3}):(\d{2}):(\d{2})$/);
  if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
  return nBase(v, raw);
}

export function pnInt(v: unknown, raw?: boolean): number | null {
  const x = pn(v, raw);
  return x === null ? null : Math.round(x);
}

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

const sum = <T,>(a: T[], f: (x: T) => number | null): number =>
  a.reduce((acc, x) => acc + (f(x) ?? 0), 0);

/** Sum that stays null when NO item carried the field at all (rule 1). */
const sumOpt = <T,>(a: T[], f: (x: T) => number | null): number | null => {
  let seen = false, t = 0;
  for (const x of a) { const v = f(x); if (v != null) { seen = true; t += v; } }
  return seen ? t : null;
};

// ---------------------------------------------------------------------------
// Row scanning helpers (tool `findRow`/`mapHeader`/`wideRowdict`)
// ---------------------------------------------------------------------------
const cellLc = (v: unknown): string => (v == null ? '' : String(v).trim().toLowerCase());
const rowEmpty = (row: unknown[] | undefined): boolean => !row || row.every((c) => c == null || String(c).trim() === '');

/** First row index at/after `start` whose column `col` contains `needle` (case-insensitive). */
export function findRow(rows: Aoa, needle: string, start = 0, col = 0): number {
  const nl = needle.toLowerCase();
  for (let i = start; i < rows.length; i++) {
    const c = rows[i]?.[col];
    if (c != null && String(c).toLowerCase().includes(nl)) return i;
  }
  return -1;
}

/**
 * Map a header row to column indices by KEY, given `{key: [candidate labels]}`.
 * Exact match first (across all keys), then substring match — same two-pass
 * order as the tool, so a label that is a substring of another key's exact
 * label never steals its column.
 */
export function mapHeader(headerRow: unknown[], keyCols: Record<string, string[]>): Record<string, number> {
  const hmap: Record<string, number> = {};
  const used = new Set<number>();
  const lowered = headerRow.map(cellLc);
  for (const key in keyCols) {
    let found = false;
    for (const kw of keyCols[key]) {
      for (let j = 0; j < lowered.length; j++) {
        if (lowered[j] === kw && !used.has(j)) { hmap[key] = j; used.add(j); found = true; break; }
      }
      if (found) break;
    }
    if (found) continue;
    for (const kw of keyCols[key]) {
      for (let j = 0; j < lowered.length; j++) {
        if (lowered[j].includes(kw) && !used.has(j)) { hmap[key] = j; used.add(j); found = true; break; }
      }
      if (found) break;
    }
    // Column genuinely absent from this export. Recorded as -1, not left out of
    // the map entirely, so every caller's `for (const key in hmap)` loop still
    // visits it — `row[-1]` reads as `undefined`, and every reader here
    // (`pn`/`str`) treats `undefined` the same as `null` (rule 1: an absent
    // column is `null`, never silently skipped and never `0`).
    if (!found) hmap[key] = -1;
  }
  return hmap;
}

type NumRow = Record<string, number | null>;

/**
 * A dated row from a daily-breakdown table. Kept as `{tanggal, nilai}` rather
 * than merging `tanggal` into the numeric dict itself — TS index signatures
 * (what makes `hmap`-driven parsing possible without naming every column)
 * cannot coexist with a named string property in the same object type, so the
 * date is carried alongside the dict instead of inside it.
 */
interface DailyRow { tanggal: string | null; nilai: NumRow }

function wideRowdict(row: unknown[], hmap: Record<string, number>, strKeys: string[] = []): Record<string, number | null | string> {
  const d: Record<string, number | null | string> = {};
  for (const key in hmap) {
    const j = hmap[key];
    const v = j < row.length ? row[j] : null;
    d[key] = strKeys.includes(key) ? str(v) : pn(v);
  }
  return d;
}

// ---------------------------------------------------------------------------
// Bisnis — Home (two sections: Pesanan Dibuat / Pesanan Siap Dikirim)
// ---------------------------------------------------------------------------
const HOME_HDR: Record<string, string[]> = {
  penjualan: ['total penjualan (idr)', 'total penjualan'], pesanan: ['total pesanan'],
  penjualan_per_pesanan: ['penjualan per pesanan'], produk_diklik: ['produk diklik'],
  pengunjung: ['total pengunjung'], tingkat_konversi: ['tingkat konversi pesanan', 'tingkat konversi'],
  pesanan_batal: ['pesanan dibatalkan'], penjualan_batal: ['penjualan dibatalkan'],
  pesanan_retur: ['pesanan dikembalikan'], penjualan_retur: ['penjualan dikembalikan'],
  total_pembeli: ['pembeli'], pembeli_baru: ['total pembeli baru'], pembeli_lama: ['total pembeli saat ini'],
  potensi_pembeli: ['total potensi pembeli'], persen_pembeli_kembali: ['tingkat pembelian berulang'],
};

export interface HomeSection { summary: NumRow; daily: DailyRow[] }

function parseHomeSection(rows: Aoa, startIdx: number): HomeSection {
  let hi = -1;
  for (let i = startIdx; i < Math.min(startIdx + 6, rows.length); i++) {
    const c0 = cellLc(rows[i]?.[0]);
    if (c0 === 'tanggal' || c0 === 'periode waktu') { hi = i; break; }
  }
  if (hi < 0) throw new Error("[header 'Tanggal' tidak ditemukan di Bisnis — Home]");
  const hmap = mapHeader(rows[hi], HOME_HDR);
  const rowdict = (r: unknown[]): NumRow => {
    const d: NumRow = {};
    for (const key in hmap) d[key] = pn(r[hmap[key]]);
    return d;
  };
  const summary = rowdict(rows[hi + 1] ?? []);
  const daily: DailyRow[] = [];
  for (let i = hi + 2; i < rows.length; i++) {
    const r = rows[i];
    if (isSheetMarker(r)) break;
    const c0 = str(r?.[0]);
    if (!c0) continue;
    const lc = c0.toLowerCase();
    if (lc === 'tanggal' || lc === 'periode waktu') continue;
    if (!/^\d/.test(c0)) break;
    daily.push({ tanggal: c0, nilai: rowdict(r) });
  }
  return { summary, daily };
}

/**
 * The Bisnis — Home export carries the SAME table three times, once per order
 * status. All three are read (SHP-1):
 *
 *  - `pesanan_dibuat` — orders CREATED. The headline figure Seller Centre's own
 *    dashboard shows, and what the report calls GMV kotor.
 *  - `pesanan_siap_dikirim` — orders ready to ship.
 *  - `pesanan_dibayar` — orders PAID. Money that actually arrived, and what the
 *    report calls GMV bersih.
 *
 * Reading only the first two (as this parser did until the Fim Motor UAT,
 * `docs/handoff/UAT_SHOPEE_FIM_MOTOR_20260903.md`) meant the paid figure did not
 * exist anywhere in CDPS, so `gmv_kotor` and `gmv_net` were filled with the
 * identical number and `clients.total_sales` counted cancelled orders as sales.
 * For that export the gap was Rp 295.710.122 — 18,2%.
 *
 * `pesanan_dibayar` stays NULLABLE: older exports (and the engine's own
 * fixtures) legitimately have only two sections, and a missing section must read
 * as "not stated", never as zero.
 */
export interface BisnisHome {
  pesanan_dibuat: HomeSection | null;
  pesanan_siap_dikirim: HomeSection | null;
  pesanan_dibayar: HomeSection | null;
}

export function parseBisnisHome(rows: Aoa): BisnisHome {
  const iD = findRow(rows, 'pesanan dibuat');
  const iS = findRow(rows, 'pesanan siap dikirim', (iD >= 0 ? iD : 0) + 1);
  // Searched AFTER the "siap dikirim" section on purpose: the same workbook
  // later carries sheets named "(pesanan dibayar)Asal Penjualan" and
  // "(pesanan dibayar)Kontribusi …", which also contain the phrase. Starting
  // past the earlier sections keeps the FIRST hit the summary table itself.
  const iB = findRow(rows, 'pesanan dibayar', (iS >= 0 ? iS : iD >= 0 ? iD : 0) + 1);
  const out: BisnisHome = { pesanan_dibuat: null, pesanan_siap_dikirim: null, pesanan_dibayar: null };
  if (iD >= 0) out.pesanan_dibuat = parseHomeSection(rows, iD);
  if (iS >= 0) out.pesanan_siap_dikirim = parseHomeSection(rows, iS);
  if (iB >= 0) out.pesanan_dibayar = parseHomeSection(rows, iB);
  if (!out.pesanan_dibuat && !out.pesanan_siap_dikirim) throw new Error('[Home: section pesanan tidak dikenali]');
  return out;
}

// ---------------------------------------------------------------------------
// Bisnis — Produk (4-kuadran source)
// ---------------------------------------------------------------------------
const PRODUK_HDR: Record<string, string[]> = {
  kode_produk: ['kode produk'], nama_produk: ['produk'], nama_variasi: ['nama variasi'],
  status: ['status produk saat ini', 'status produk'],
  produk_dilihat: ['jumlah produk dilihat', 'dilihat'], produk_diklik: ['produk diklik'],
  pengunjung_produk: ['pengunjung produk (kunjungan)', 'pengunjung produk'],
  pesanan_dibuat: ['pesanan dibuat'],
  penjualan_dibuat: ['total penjualan (pesanan dibuat) (idr)', 'total penjualan (pesanan dibuat)'],
  pembeli_dibuat: ['total pembeli (pesanan dibuat)'],
  cr_pesanan_dibuat: ['tingkat konversi (pesanan yang dibuat)'],
  pesanan_siap: ['pesanan siap dikirim'],
  penjualan_siap: ['penjualan (pesanan siap dikirim) (idr)', 'penjualan (pesanan siap dikirim)'],
  cr_siap: ['tingkat konversi (pesanan siap dikirim)'],
};

export interface ProdukShopeeRec {
  kode_produk: string; nama_produk: string | null; nama_variasi: string;
  status: string | null; produk_dilihat: number | null; produk_diklik: number | null;
  pengunjung_produk: number | null; pesanan_dibuat: number | null; penjualan_dibuat: number | null;
  pembeli_dibuat: number | null; cr_pesanan_dibuat: number | null;
  pesanan_siap: number | null; penjualan_siap: number | null; cr_siap: number | null;
}

export function parseBisnisProduk(rows: Aoa): { products: ProdukShopeeRec[]; variations: ProdukShopeeRec[] } {
  let hi = -1;
  for (let i = 0; i < rows.length; i++) {
    const joined = (rows[i] ?? []).map(cellLc).join(' ');
    if (joined.includes('kode produk') && joined.includes('variasi')) { hi = i; break; }
  }
  if (hi < 0) throw new Error('[header tabel Produk tidak ditemukan]');
  const hmap = mapHeader(rows[hi], PRODUK_HDR);
  const products: ProdukShopeeRec[] = [], variations: ProdukShopeeRec[] = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (isSheetMarker(r)) break; // only the FIRST product table — stop at the next sheet
    if (rowEmpty(r)) continue;
    const get = (k: string): unknown => (k in hmap && hmap[k] < r.length) ? r[hmap[k]] : null;
    const namaVar = str(get('nama_variasi')) ?? '-';
    const kode = str(get('kode_produk'));
    if (!kode) continue;
    const rec: ProdukShopeeRec = {
      kode_produk: kode, nama_produk: str(get('nama_produk')), nama_variasi: namaVar, status: str(get('status')),
      produk_dilihat: pnInt(get('produk_dilihat')), produk_diklik: pnInt(get('produk_diklik')),
      pengunjung_produk: pnInt(get('pengunjung_produk')), pesanan_dibuat: pnInt(get('pesanan_dibuat')),
      penjualan_dibuat: pn(get('penjualan_dibuat')), pembeli_dibuat: pnInt(get('pembeli_dibuat')),
      cr_pesanan_dibuat: pn(get('cr_pesanan_dibuat')), pesanan_siap: pnInt(get('pesanan_siap')),
      penjualan_siap: pn(get('penjualan_siap')), cr_siap: pn(get('cr_siap')),
    };
    if (namaVar === '-' || namaVar === '' || namaVar === 'None') products.push(rec); else variations.push(rec);
  }
  return { products, variations };
}

// ---------------------------------------------------------------------------
// Generic "did anything happen" module (tool `genericZero`) — bisnis_live,
// promo_diskon, promo_flashsale, layanan_broadcast: the tool never defined a
// real column signature for these, only "is there non-zero activity at all".
// ---------------------------------------------------------------------------
export interface ActivitySummary { raw_rows: number; has_activity: boolean }

export function genericZero(rows: Aoa): ActivitySummary {
  let total = 0;
  for (const r of rows) {
    for (let j = 1; j < (r ?? []).length; j++) {
      const v = pn(r[j]);
      if (v) total += Math.abs(v);
    }
  }
  return { raw_rows: rows.length, has_activity: total > 0 };
}

// ---------------------------------------------------------------------------
// Promo — Voucher
// ---------------------------------------------------------------------------
const VOUCHER_HDR: Record<string, string[]> = {
  penjualan_dibuat: ['penjualan (pesanan dibuat) (idr)', 'penjualan (pesanan dibuat)'], klaim: ['klaim'],
  pesanan_dibuat: ['pesanan (pesanan dibuat)'], usage_dibuat: ['tingkat penggunaan (pesanan dibuat)'],
  pembeli_dibuat: ['pembeli (pesanan dibuat)'],
  biaya_dibuat: ['total biaya (pesanan dibuat) (idr)', 'total biaya (pesanan dibuat)'],
};
const VOUCHER_DET: Record<string, string[]> = {
  nama: ['nama voucher'], klaim: ['klaim'], pesanan_dibuat: ['pesanan (pesanan dibuat)'],
  penjualan_dibuat: ['penjualan (pesanan dibuat) (idr)', 'penjualan (pesanan dibuat)'],
  biaya_dibuat: ['total biaya (pesanan dibuat) (idr)', 'total biaya'],
};

export interface VoucherReport { summary: NumRow; vouchers: Record<string, number | null | string>[]; daily: DailyRow[] }

export function parseVoucher(rows: Aoa): VoucherReport {
  const out: VoucherReport = { summary: {}, vouchers: [], daily: [] };
  const iH = findRow(rows, 'periode waktu');
  if (iH >= 0) out.summary = wideRowdict(rows[iH + 1] ?? [], mapHeader(rows[iH], VOUCHER_HDR)) as NumRow;
  const iD = findRow(rows, 'waktu promo');
  if (iD >= 0) {
    const hmap = mapHeader(rows[iD], VOUCHER_HDR);
    for (let i = iD + 1; i < rows.length; i++) {
      const r = rows[i];
      if (isSheetMarker(r)) break;
      const c0 = str(r?.[0]);
      if (!c0 || !/^\d/.test(c0)) break;
      const d = wideRowdict(r, hmap) as NumRow;
      out.daily.push({ tanggal: c0, nilai: d });
    }
  }
  let iV = -1;
  for (let i = 0; i < rows.length; i++) { if (cellLc(rows[i]?.[0]) === 'nama voucher') { iV = i; break; } }
  if (iV >= 0) {
    const hmap = mapHeader(rows[iV], VOUCHER_DET);
    for (let i = iV + 1; i < rows.length; i++) {
      const r = rows[i];
      if (isSheetMarker(r)) break;
      const c0 = str(r?.[0]);
      if (!c0) break;
      out.vouchers.push(wideRowdict(r, hmap, ['nama']));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Layanan — Chat
// ---------------------------------------------------------------------------
const CHAT_HDR: Record<string, string[]> = {
  pengunjung: ['pengunjung'], chat_masuk: ['jumlah chat'], pengunjung_bertanya: ['pengunjung bertanya'],
  pertanyaan_diajukan: ['pertanyaan diajukan'], chat_dibalas: ['chat dibalas'], chat_belum_dibalas: ['chat belum dibalas'],
  waktu_respon_detik: ['waktu respon rata-rata'], csat: ['csat %', 'csat'],
  response_rate: ['tingkat konversi (jumlah chat yang direspon)', 'persentase chat dibalas'],
  pembeli_dari_chat: ['total pembeli'], pesanan_dari_chat: ['total pesanan'],
  penjualan_dari_chat: ['penjualan (idr)', 'penjualan'], konversi_chat_dibalas: ['tingkat konversi (chat dibalas)'],
};

export interface ChatReport { summary: NumRow; daily: DailyRow[] }

export function parseChat(rows: Aoa): ChatReport {
  const out: ChatReport = { summary: {}, daily: [] };
  const iH = findRow(rows, 'periode waktu');
  if (iH >= 0) out.summary = wideRowdict(rows[iH + 1] ?? [], mapHeader(rows[iH], CHAT_HDR)) as NumRow;
  const iG = findRow(rows, 'grafik kriteria');
  if (iG >= 0) {
    let iD = -1;
    for (let i = iG; i < Math.min(iG + 4, rows.length); i++) { if (cellLc(rows[i]?.[0]) === 'tanggal') { iD = i; break; } }
    if (iD >= 0) {
      const hmap = mapHeader(rows[iD], CHAT_HDR);
      for (let i = iD + 1; i < rows.length; i++) {
        const r = rows[i];
        if (isSheetMarker(r)) break;
        const c0 = str(r?.[0]);
        if (!c0 || !/^\d/.test(c0)) break;
        const d = wideRowdict(r, hmap) as NumRow;
        out.daily.push({ tanggal: c0, nilai: d });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Meta CPAS
// ---------------------------------------------------------------------------
const META_HDR: Record<string, string[]> = {
  minggu: ['minggu'], kampanye: ['nama kampanye'], spend: ['jumlah yang dibelanjakan'],
  purchase_value: ['nilai konversi pembelian khusus'], roas: ['roas pembelian'],
  purchases: ['pembelian dengan item bersama'], impressions: ['impresi'], clicks: ['klik tautan'],
  ctr: ['ctr'], atc: ['penambahan ke keranjang belanja dengan item'],
};

export interface MetaWeek { minggu: string | null; kampanye: string | null; [k: string]: number | string | null }
export interface MetaReport { summary: NumRow; weekly: MetaWeek[] }

export function parseMeta(rows: Aoa): MetaReport {
  const out: MetaReport = { summary: {}, weekly: [] };
  let hi = -1;
  for (let i = 0; i < rows.length; i++) {
    const joined = (rows[i] ?? []).map(cellLc).join(' ');
    if (joined.includes('minggu') && joined.includes('dibelanjakan')) { hi = i; break; }
  }
  if (hi < 0) throw new Error('[header Meta CPAS tidak ditemukan]');
  const hmap = mapHeader(rows[hi], META_HDR);
  const rowdict = (r: unknown[]): MetaWeek => {
    const d: MetaWeek = { minggu: null, kampanye: null };
    for (const key in hmap) {
      const v = hmap[key] < r.length ? r[hmap[key]] : null;
      d[key] = (key === 'minggu' || key === 'kampanye') ? str(v) : pn(v, true); // en/raw locale, tool locale='en'
    }
    return d;
  };
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (isSheetMarker(r)) break;
    if (rowEmpty(r)) continue;
    const d = rowdict(r);
    if (!d.minggu) { if (d.spend != null) out.summary = d as unknown as NumRow; } else out.weekly.push(d);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ads CSV — Toko / Produk / Banner (identical column layout — see detect.ts)
// ---------------------------------------------------------------------------
export interface AdsItem {
  nama: string; status: string | null; dilihat: number | null; klik: number | null; ctr: number | null;
  omzet: number | null; biaya: number | null; roas: number | null; acos: number | null;
  pesanan: number | null; produk_terjual: number | null;
}

export function parseAdsCsv(rows: Aoa): { items: AdsItem[] } {
  let hi = -1;
  for (let i = 0; i < rows.length; i++) {
    const low = (rows[i] ?? []).map(cellLc).join(',');
    if ((low.includes('iklan') || low.includes('nama')) && (low.includes('dilihat') || low.includes('impress'))) { hi = i; break; }
  }
  if (hi < 0) throw new Error('[header CSV iklan tidak ditemukan]');
  const header = rows[hi].map((h) => cellLc(h));
  const col = (...kws: string[]): number => { for (const kw of kws) for (let j = 0; j < header.length; j++) if (header[j].includes(kw)) return j; return -1; };
  const colExact = (...names: string[]): number => { for (const nm of names) for (let j = 0; j < header.length; j++) if (header[j] === nm) return j; return -1; };
  const cNama = colExact('nama iklan') >= 0 ? colExact('nama iklan') : col('nama iklan', 'nama');
  const cStatus = colExact('status'), cDilihat = colExact('dilihat'), cKlik = colExact('jumlah klik');
  const cCtr = colExact('persentase klik'), cOmzet = colExact('omzet penjualan'), cBiaya = colExact('biaya');
  const cPesanan = colExact('pesanan'), cTerjual = colExact('produk terjual');
  const cRoas = colExact('efektifitas iklan', 'efektivitas iklan');
  let cAcos = -1;
  for (let j = 0; j < header.length; j++) { if (header[j].includes('(acos)') && !header[j].includes('langsung')) { cAcos = j; break; } }
  const items: AdsItem[] = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (rowEmpty(r)) continue;
    const nama = cNama >= 0 && cNama < r.length ? str(r[cNama]) : null;
    if (!nama) continue;
    const g = (ci: number): number | null => (ci >= 0 && ci < r.length) ? pn(r[ci], true) : null;
    items.push({
      nama, status: cStatus >= 0 && cStatus < r.length ? str(r[cStatus]) : null,
      dilihat: g(cDilihat), klik: g(cKlik), ctr: g(cCtr), omzet: g(cOmzet), biaya: g(cBiaya),
      roas: g(cRoas), acos: g(cAcos), pesanan: g(cPesanan), produk_terjual: g(cTerjual),
    });
  }
  return { items };
}

// ---------------------------------------------------------------------------
// Affiliate CSV — Product / Creator
// ---------------------------------------------------------------------------
export interface AffItem {
  nama: string; omzet: number | null; produk_terjual: number | null; pesanan: number | null;
  clicks: number | null; komisi: number | null; roi: number | null; total_pembeli: number | null; pembeli_baru: number | null;
}

export function parseAffCsv(rows: Aoa, nameKws: string[]): { items: AffItem[] } {
  let hi = -1;
  for (let i = 0; i < rows.length; i++) {
    const low = (rows[i] ?? []).map(cellLc).join(',');
    if (low.includes('omzet') && nameKws.some((k) => low.includes(k))) { hi = i; break; }
  }
  if (hi < 0) hi = 0;
  const header = (rows[hi] ?? []).map((h) => cellLc(h));
  const col = (...kws: string[]): number => { for (const kw of kws) for (let j = 0; j < header.length; j++) if (header[j].includes(kw)) return j; return -1; };
  const cName = col(...nameKws), cOmzet = col('omzet'), cTerjual = col('terjual'), cPesanan = col('pesanan');
  const cClicks = col('click', 'klik'), cKomisi = col('komisi'), cRoi = col('roi');
  const cPembeli = col('total pembeli'), cBaru = col('pembeli baru');
  const items: AffItem[] = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (rowEmpty(r)) continue;
    const nm = cName >= 0 && cName < r.length ? str(r[cName]) : null;
    if (!nm) continue;
    const g = (ci: number): number | null => (ci >= 0 && ci < r.length) ? pn(r[ci], true) : null;
    items.push({ nama: nm, omzet: g(cOmzet), produk_terjual: g(cTerjual), pesanan: g(cPesanan), clicks: g(cClicks), komisi: g(cKomisi), roi: g(cRoi), total_pembeli: g(cPembeli), pembeli_baru: g(cBaru) });
  }
  return { items };
}

// ---------------------------------------------------------------------------
// Bisnis — Kesehatan Toko (penalty points)
// ---------------------------------------------------------------------------
export interface Penalti { poin: number; deskripsi: string; durasi: string }
export interface KesehatanToko { poin_total: number; penalti: Penalti[]; uploaded: true }

export function parseKesehatan(rows: Aoa): KesehatanToko {
  let hi = -1;
  for (let i = 0; i < rows.length; i++) {
    const j = (rows[i] ?? []).map(cellLc).join(' ');
    if (j.includes('poin pinalti') || j.includes('poin penalti')) { hi = i; break; }
  }
  const penalti: Penalti[] = [];
  if (hi >= 0) {
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i];
      if (isSheetMarker(r)) break;
      if (rowEmpty(r)) continue;
      const poin = pn(r[0]);
      const desk = str(r.length > 1 ? r[1] : null) ?? '';
      const dur = str(r.length > 2 ? r[2] : null) ?? '';
      if (poin == null && !desk) continue;
      penalti.push({ poin: poin ?? 0, deskripsi: desk, durasi: dur });
    }
  }
  return { poin_total: sum(penalti, (x) => x.poin), penalti, uploaded: true };
}

// ---------------------------------------------------------------------------
// Bisnis — Shopee Video
// ---------------------------------------------------------------------------
const VIDEO_HDR: Record<string, string[]> = {
  penjualan_dibuat: ['penjualan(pesanan dibuat)'], penjualan_siap: ['penjualan(pesanan siap dikirim)'],
  pesanan_dibuat: ['pesanan(pesanan dibuat)'], pesanan_siap: ['pesanan(pesanan siap dikirim)'],
  produk_terjual: ['produk terjual(pesanan dibuat)'], penonton: ['penonton'], ditonton: ['ditonton'],
  penonton_efektif: ['penonton efektif'], ctr: ['persentase klik'], pembeli: ['pembeli(pesanan dibuat)'],
  atc: ['tambah ke keranjang'], klik_produk: ['klik produk'], suka: ['suka'], share: ['share'],
  komentar: ['komentar'], follower_baru: ['pengikut baru dari video'], completion: ['tingkat video selesai ditonton'],
};

export interface VideoSumber { label: string; ditonton: number | null; penonton: number | null; penonton_efektif: number | null }
export interface VideoReport { summary: NumRow; sumber: VideoSumber[]; has_activity: boolean }

export function parseVideo(rows: Aoa): VideoReport {
  let hi = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (r.some((c) => cellLc(c) === 'periode data')) { hi = i; break; }
  }
  if (hi < 0) throw new Error('[header Shopee Video tidak ditemukan]');
  const hmap = mapHeader(rows[hi], VIDEO_HDR);
  let dataRow: unknown[] | null = null;
  for (let i = hi + 1; i < Math.min(hi + 5, rows.length); i++) {
    const r = rows[i];
    if (r && r[0] != null && String(r[0]).trim() !== '') { dataRow = r; break; }
  }
  const summary: NumRow = {};
  if (dataRow) for (const key in hmap) { const j = hmap[key]; summary[key] = pn(j < dataRow.length ? dataRow[j] : null); }
  const sumber: VideoSumber[] = [];
  const PREFIX = 'kunjungan - sumber penonton - ';
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    for (let j = 0; j < r.length; j++) {
      const c = str(r[j]) ?? '';
      const lc = c.toLowerCase();
      if (lc.startsWith(PREFIX) && !lc.includes('semua sumber')) {
        const label = c.slice(PREFIX.length);
        const hr = rows[i + 1] ?? [], vr = rows[i + 2] ?? [];
        const find = (kw: string): number => {
          for (let x = 0; x < hr.length; x++) { if (cellLc(hr[x]) === kw) return x; }
          for (let x = 0; x < hr.length; x++) { if (cellLc(hr[x]).includes(kw)) return x; }
          return -1;
        };
        const g = (x: number): number | null => x >= 0 && x < vr.length ? pn(vr[x]) : null;
        sumber.push({ label, ditonton: g(find('ditonton')), penonton: g(find('penonton')), penonton_efektif: g(find('penonton efektif')) });
      }
    }
  }
  const hasActivity = (summary.ditonton ?? 0) > 0 || (summary.penjualan_dibuat ?? 0) > 0;
  return { summary, sumber, has_activity: hasActivity };
}

// ---------------------------------------------------------------------------
// Ads — Live (distinct signature: "penonton" column)
// ---------------------------------------------------------------------------
export interface AdsLiveItem { nama: string; status: string | null; penonton: number | null; pesanan: number | null; cr: number | null; omzet: number | null; biaya: number | null; roas: number | null }

export function parseAdsLive(rows: Aoa): { items: AdsLiveItem[] } {
  let hi = -1;
  for (let i = 0; i < rows.length; i++) {
    const low = (rows[i] ?? []).map(cellLc).join(',');
    if (low.includes('nama iklan') && low.includes('penonton')) { hi = i; break; }
  }
  if (hi < 0) throw new Error('[header CSV Iklan Live tidak ditemukan]');
  const header = rows[hi].map((h) => cellLc(h));
  const cx = (...names: string[]): number => { for (const nm of names) for (let j = 0; j < header.length; j++) if (header[j] === nm) return j; return -1; };
  const cNama = cx('nama iklan'), cStatus = cx('status'), cPenonton = cx('penonton'), cPesanan = cx('pesanan');
  const cCr = cx('tingkat konversi'), cOmzet = cx('omzet penjualan'), cBiaya = cx('biaya');
  const cRoas = cx('efektifitas iklan', 'efektivitas iklan');
  const items: AdsLiveItem[] = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (rowEmpty(r)) continue;
    const nama = cNama >= 0 && cNama < r.length ? str(r[cNama]) : null;
    if (!nama) continue;
    const g = (ci: number): number | null => (ci >= 0 && ci < r.length) ? pn(r[ci], true) : null;
    items.push({ nama, status: cStatus >= 0 && cStatus < r.length ? str(r[cStatus]) : null, penonton: g(cPenonton), pesanan: g(cPesanan), cr: g(cCr), omzet: g(cOmzet), biaya: g(cBiaya), roas: g(cRoas) });
  }
  return { items };
}

// ---------------------------------------------------------------------------
// Store identity guardrail (tool `extractIdentity`) — pure, no cross-file
// dedupe here (that orchestration belongs to the caller/domain layer, which
// already has `clients`/`client_platforms` as the real identity source; this
// only reads what a Seller-Center export itself claims).
// ---------------------------------------------------------------------------
export interface TokoIdentitas { id: string | null; nama: string | null }

export function extractIdentity(rows: Aoa): TokoIdentitas | null {
  let id: string | null = null, nama: string | null = null, seen = 0;
  for (let i = 0; i < rows.length && seen < 14; i++) {
    const r = rows[i];
    if (!r || isSheetMarker(r)) continue;
    seen++;
    const c0 = cellLc(r[0]);
    if (c0 === 'id toko' && r.length > 1 && r[1] != null) id = String(r[1]).trim();
    if (c0 === 'nama toko' && r.length > 1 && r[1] != null) nama = String(r[1]).trim();
  }
  if (!id && !nama) return null;
  return { id: id ?? (nama ? nama.toLowerCase() : null), nama };
}

// ---------------------------------------------------------------------------
// Parser registry (tool `PARSERS`)
// ---------------------------------------------------------------------------
export type ParsedModule =
  | BisnisHome | { products: ProdukShopeeRec[]; variations: ProdukShopeeRec[] } | ActivitySummary
  | { items: AdsItem[] } | { items: AffItem[] } | VoucherReport | ChatReport | MetaReport
  | KesehatanToko | VideoReport | { items: AdsLiveItem[] };

export const SHOPEE_PARSERS: Record<string, (rows: Aoa) => ParsedModule> = {
  bisnis_home: parseBisnisHome,
  bisnis_produk: parseBisnisProduk,
  bisnis_live: genericZero,
  ads_toko: parseAdsCsv,
  ads_produk: parseAdsCsv,
  aff_product: (rows) => parseAffCsv(rows, ['nama produk', 'produk']),
  aff_creator: (rows) => parseAffCsv(rows, ['username', 'kreator', 'creator', 'nama']),
  promo_diskon: genericZero,
  promo_voucher: parseVoucher,
  promo_flashsale: genericZero,
  layanan_chat: parseChat,
  layanan_broadcast: genericZero,
  meta: parseMeta,
  bisnis_kesehatan: parseKesehatan,
  bisnis_video: parseVideo,
  ads_live: parseAdsLive,
  ads_banner: parseAdsCsv,
};

export interface ParsedShopee {
  bisnis_home?: BisnisHome;
  bisnis_produk?: { products: ProdukShopeeRec[]; variations: ProdukShopeeRec[] };
  bisnis_live?: ActivitySummary;
  ads_toko?: { items: AdsItem[] };
  ads_produk?: { items: AdsItem[] };
  ads_live?: { items: AdsLiveItem[] };
  ads_banner?: { items: AdsItem[] };
  aff_product?: { items: AffItem[] };
  aff_creator?: { items: AffItem[] };
  promo_diskon?: ActivitySummary;
  promo_voucher?: VoucherReport;
  promo_flashsale?: ActivitySummary;
  layanan_chat?: ChatReport;
  layanan_broadcast?: ActivitySummary;
  meta?: MetaReport;
  bisnis_kesehatan?: KesehatanToko;
  bisnis_video?: VideoReport;
}

// ---------------------------------------------------------------------------
// 4-kuadran produk (tool `computeQuadrants`)
// ---------------------------------------------------------------------------
export type KuadranShopee = 'bintang' | 'hidden_gem' | 'bocor_traffic' | 'evaluasi' | 'tidur' | 'tidak_tayang' | 'no_data';
export const ALL_KUADRAN_SHOPEE: readonly KuadranShopee[] = ['bintang', 'hidden_gem', 'bocor_traffic', 'evaluasi', 'tidur', 'tidak_tayang', 'no_data'];

export interface ProdukKuadranRec extends ProdukShopeeRec { cr_dipakai: number | null }
export interface Ambang { trafficRendah: number | null; trafficTinggi: number | null; crRendah: number | null; crTinggi: number | null; n: number }
export interface Kuadrans {
  mode_relatif: Record<KuadranShopee, ProdukKuadranRec[]>;
  mode_absolute: Record<KuadranShopee, ProdukKuadranRec[]>;
  thresholds: { relatif: Ambang; absolute: Ambang };
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const k = p * (sorted.length - 1), f = Math.floor(k), c = Math.min(f + 1, sorted.length - 1);
  return sorted[f] + (sorted[c] - sorted[f]) * (k - f);
}

function emptyBuckets(): Record<KuadranShopee, ProdukKuadranRec[]> {
  return { bintang: [], hidden_gem: [], bocor_traffic: [], evaluasi: [], tidur: [], tidak_tayang: [], no_data: [] };
}

function bandFrom(v: number | null, low: number, high: number): 'low' | 'medium' | 'high' | null {
  if (v == null) return null;
  if (v <= low) return 'low';
  if (v >= high) return 'high';
  return 'medium';
}

function resolveBand(
  tB: 'low' | 'medium' | 'high' | null, cB: 'low' | 'medium' | 'high' | null,
  traffic: number | null, cr: number | null, tHigh: number, cHigh: number, kc: ShopeeBench['kuadran'],
): KuadranShopee {
  let tRes: 'low' | 'high' = tB === 'high' ? 'high' : 'low';
  if (tB === 'medium') tRes = (kc.medium_traffic_high_if_cr_high && cr != null && cr >= cHigh) ? 'high' : 'low';
  let cRes: 'low' | 'high' = cB === 'high' ? 'high' : 'low';
  if (cB === 'medium') cRes = (kc.medium_cr_high_if_traffic_high && traffic != null && traffic >= tHigh) ? 'high' : 'low';
  const map: Record<string, KuadranShopee> = { 'high|high': 'bintang', 'low|high': 'hidden_gem', 'high|low': 'bocor_traffic', 'low|low': 'evaluasi' };
  return map[`${tRes}|${cRes}`];
}

/** CR basis is fixed to `pesanan_per_pengunjung` (the only mode the bench supports — see `ShopeeBench.kuadran.cr_basis`). */
export function computeQuadrants(produk: { products: ProdukShopeeRec[] }, bench: ShopeeBench): Kuadrans {
  const kc = bench.kuadran, sleeper = kc.sleeper_visitor_max;
  const recs: ProdukKuadranRec[] = produk.products.map((p) => {
    const traffic = p.pengunjung_produk;
    const cr = (traffic && p.pesanan_dibuat != null) ? div(p.pesanan_dibuat, traffic) : null;
    return { ...p, cr_dipakai: cr };
  });
  const aktif = recs.filter((r) => (r.pengunjung_produk ?? 0) >= sleeper && r.cr_dipakai != null);
  const tVals = aktif.map((r) => r.pengunjung_produk as number).sort((a, b) => a - b);
  const cVals = aktif.map((r) => r.cr_dipakai as number).sort((a, b) => a - b);
  const pc = kc.percentile;
  const tLowP = percentile(tVals, pc.traffic_low_pct), tHighP = percentile(tVals, pc.traffic_high_pct);
  const cLowP = percentile(cVals, pc.cr_low_pct), cHighP = percentile(cVals, pc.cr_high_pct);
  const ab = kc.absolute;

  const classify = (mode: 'relatif' | 'absolute'): Record<KuadranShopee, ProdukKuadranRec[]> => {
    const b = emptyBuckets();
    for (const r of recs) {
      const traffic = r.pengunjung_produk, cr = r.cr_dipakai;
      if (traffic == null || traffic === 0) { b.tidak_tayang.push(r); continue; }
      if (cr == null) { b.no_data.push(r); continue; }
      if (traffic < sleeper) { b.tidur.push(r); continue; }
      let tLow: number, tHigh: number, cLow: number, cHigh: number;
      if (mode === 'relatif') { tLow = tLowP ?? 0; tHigh = tHighP ?? 0; cLow = cLowP ?? 0; cHigh = cHighP ?? 0; }
      else { tLow = ab.traffic_low_max; tHigh = ab.traffic_high_min; cLow = ab.conversion_low_max; cHigh = ab.conversion_high_min; }
      const tB = bandFrom(traffic, tLow, tHigh), cB = bandFrom(cr, cLow, cHigh);
      b[resolveBand(tB, cB, traffic, cr, tHigh, cHigh, kc)].push(r);
    }
    for (const k of ALL_KUADRAN_SHOPEE) b[k].sort((x, y) => (y.penjualan_dibuat ?? 0) - (x.penjualan_dibuat ?? 0));
    return b;
  };

  return {
    mode_relatif: classify('relatif'),
    mode_absolute: classify('absolute'),
    thresholds: {
      relatif: { trafficRendah: tLowP, trafficTinggi: tHighP, crRendah: cLowP, crTinggi: cHighP, n: aktif.length },
      absolute: { trafficRendah: ab.traffic_low_max, trafficTinggi: ab.traffic_high_min, crRendah: ab.conversion_low_max, crTinggi: ab.conversion_high_min, n: recs.length },
    },
  };
}

// ---------------------------------------------------------------------------
// Health (tool `computeHealth`) — traffic-light per metric, Flag-typed
// ---------------------------------------------------------------------------
function flag(v: number | null, good: number, warn: number, higher = true): Flag {
  if (v == null) return 'kosong';
  if (higher) { if (v >= good) return 'hijau'; if (v >= warn) return 'kuning'; return 'merah'; }
  if (v <= good) return 'hijau'; if (v <= warn) return 'kuning'; return 'merah';
}

export interface HealthCrToko { nilai: number | null; flag: Flag }
export interface HealthAds { spend: number; omzet: number | null; roas: number | null; acos: number | null; ctr: number | null; flag_roas: Flag; flag_acos: Flag; flag_ctr: Flag }
export interface HealthChat {
  response_rate: number | null; flag_response_rate: Flag;
  order_conversion: number | null; order_conversion_pembeli: number | null; order_conversion_penanya: number | null; flag_order_conversion: Flag;
  csat: number | null; flag_csat: Flag;
  respon_detik: number | null; flag_respon: Flag;
}
export interface HealthMeta { roas: number | null; flag_roas: Flag }
export interface Health { cr_toko: HealthCrToko | null; ads: HealthAds | null; chat: HealthChat | null; meta: HealthMeta | null }

export function computeHealth(parsed: ParsedShopee, bench: ShopeeBench): Health {
  const h = bench.health;
  const out: Health = { cr_toko: null, ads: null, chat: null, meta: null };
  const s = parsed.bisnis_home?.pesanan_dibuat?.summary;
  if (s && Object.keys(s).length) out.cr_toko = { nilai: s.tingkat_konversi, flag: flag(s.tingkat_konversi, h.cr_good, h.cr_good * 0.6) };

  const adsItems: AdsItem[] = [];
  if (parsed.ads_toko) adsItems.push(...parsed.ads_toko.items);
  if (parsed.ads_produk) adsItems.push(...parsed.ads_produk.items);
  if (parsed.ads_banner) adsItems.push(...parsed.ads_banner.items);
  if (parsed.ads_live) {
    // Ads Live carries `penonton` not `dilihat`/`klik` — folded into the same
    // health rollup via its `omzet`/`biaya`/`roas` only (CTR stays
    // Toko/Produk/Banner-only, same as the tool's own `computeHealth`).
    for (const it of parsed.ads_live.items) {
      adsItems.push({ nama: it.nama, status: it.status, dilihat: null, klik: null, ctr: null, omzet: it.omzet, biaya: it.biaya, roas: it.roas, acos: null, pesanan: it.pesanan, produk_terjual: null });
    }
  }
  if (adsItems.length) {
    const spend = sum(adsItems, (i) => i.biaya), omzet = sumOpt(adsItems, (i) => i.omzet);
    // omzet==null means no item carried the column at all — a real "no basis",
    // not the same as "omzet 0". ROAS/ACOS stay null (⇒ `—`) rather than reading
    // omzet as 0 and reporting a confident-looking "ROAS 0,00x".
    const roas = (spend && omzet != null) ? div(omzet, spend) : null;
    const acos = (omzet != null && omzet > 0) ? div(spend, omzet) : null;
    const dilihat = sumOpt(adsItems, (i) => i.dilihat), klik = sumOpt(adsItems, (i) => i.klik);
    const ctr = (dilihat != null && klik != null) ? div(klik, dilihat) : null;
    out.ads = { spend, omzet, roas, acos, ctr, flag_roas: flag(roas, h.roas_good, h.roas_warn), flag_acos: flag(acos, h.acos_good, h.acos_warn, false), flag_ctr: flag(ctr, h.ctr_good, h.ctr_good * 0.5) };
  }

  const chat = parsed.layanan_chat?.summary;
  if (chat && Object.keys(chat).length) {
    const lay = bench.layanan;
    const rr = chat.response_rate, pb = chat.pengunjung_bertanya, pembeli = chat.pembeli_dari_chat;
    const oc = (pb && pembeli != null) ? div(pembeli, pb) : null;
    out.chat = {
      response_rate: rr, flag_response_rate: flag(rr, lay.chat_response_rate_good, lay.chat_response_rate_good * 0.9),
      order_conversion: oc, order_conversion_pembeli: pembeli ?? null, order_conversion_penanya: pb ?? null,
      flag_order_conversion: flag(oc, lay.chat_order_conversion_good, lay.chat_order_conversion_good * 0.6),
      csat: chat.csat, flag_csat: flag(chat.csat, lay.csat_good, lay.csat_good * 0.85),
      respon_detik: chat.waktu_respon_detik, flag_respon: flag(chat.waktu_respon_detik, lay.chat_respon_max_detik, lay.chat_respon_max_detik * 2, false),
    };
  }

  const meta = parsed.meta?.summary;
  if (meta && Object.keys(meta).length) out.meta = { roas: (meta.roas as number | null) ?? null, flag_roas: flag((meta.roas as number | null) ?? null, 2, 1) };

  return out;
}

// ---------------------------------------------------------------------------
// Channel mix (tool `computeChannels`)
// ---------------------------------------------------------------------------
export interface KanalItemShopee { nilai: number; persen: number | null }
export interface KanalShopee { gmv_total: number | null; kanal: Record<string, KanalItemShopee> }

export function computeChannels(parsed: ParsedShopee): KanalShopee {
  const gmv = parsed.bisnis_home?.pesanan_dibuat?.summary?.penjualan ?? null;
  const ch: KanalShopee = { gmv_total: gmv, kanal: {} };
  if (!gmv) return ch;
  const add = (name: string, val: number | null): void => { if (val) ch.kanal[name] = { nilai: val, persen: div(val, gmv) }; };
  let adsOmzet = 0;
  if (parsed.ads_toko) adsOmzet += sum(parsed.ads_toko.items, (i) => i.omzet);
  if (parsed.ads_produk) adsOmzet += sum(parsed.ads_produk.items, (i) => i.omzet);
  if (parsed.ads_banner) adsOmzet += sum(parsed.ads_banner.items, (i) => i.omzet);
  if (parsed.ads_live) adsOmzet += sum(parsed.ads_live.items, (i) => i.omzet);
  add('shopee_ads', adsOmzet || null);
  add('affiliate', parsed.aff_product ? sum(parsed.aff_product.items, (i) => i.omzet) : null);
  add('voucher', parsed.promo_voucher?.summary.penjualan_dibuat ?? null);
  add('chat', parsed.layanan_chat?.summary.penjualan_dari_chat ?? null);
  add('meta_cpas', (parsed.meta?.summary.purchase_value as number | null) ?? null);
  add('shopee_video', parsed.bisnis_video?.summary.penjualan_dibuat ?? null);
  return ch;
}

// ---------------------------------------------------------------------------
// Bundle (tool `buildReportData`)
// ---------------------------------------------------------------------------
export interface KpiPesananDibuat {
  gmv: number | null; pesanan: number | null; aov: number | null; pengunjung: number | null; cr: number | null;
  produk_diklik: number | null; pembeli: number | null; pembeli_baru: number | null; repeat_rate: number | null;
  batal_pesanan: number | null; batal_nilai: number | null; retur_pesanan: number | null; retur_nilai: number | null;
}
export interface KpiPesananSiap { gmv: number | null; pesanan: number | null; cr: number | null }
/** SHP-1 — orders PAID. `null` (the whole object) when the export has no such section; never a fabricated 0. */
export interface KpiPesananDibayar { gmv: number | null; pesanan: number | null; cr: number | null }
export interface AffiliateRingkasan {
  top_products: AffItem[]; top_creators: AffItem[]; total_omzet: number | null; total_komisi: number | null;
  total_creators: number; total_products: number;
}
export interface ShopeeMetrics {
  kpi_utama: { pesanan_dibuat: KpiPesananDibuat; pesanan_siap_dikirim: KpiPesananSiap; pesanan_dibayar: KpiPesananDibayar | null };
  daily: DailyRow[];
  kuadran: Kuadrans | null;
  health: Health;
  kanal: KanalShopee;
  voucher: VoucherReport | null;
  chat: ChatReport | null;
  meta: MetaReport | null;
  ads: { toko: AdsItem[]; produk: AdsItem[]; live: AdsLiveItem[]; banner: AdsItem[] };
  affiliate: AffiliateRingkasan;
  kesehatan_toko: KesehatanToko | null;
  video: VideoReport | null;
  /** Modules present but with zero recorded activity — tool `zero_activity`. */
  zero_activity: string[];
  /** Whether the `bisnis_live` file was uploaded at all (distinct from zero-activity — see `skor.ts:scoreLive`). */
  live_uploaded: boolean;
}

/** Modules whose PRESENCE is judged by activity, not a specific parser (`genericZero` outputs). */
const ZERO_ACTIVITY_MODULES = ['bisnis_live', 'promo_diskon', 'layanan_broadcast', 'bisnis_video'] as const;

export function buildShopeeMetrics(parsed: ParsedShopee, bench: ShopeeBench): ShopeeMetrics {
  const sd = parsed.bisnis_home?.pesanan_dibuat?.summary ?? {};
  const ss = parsed.bisnis_home?.pesanan_siap_dikirim?.summary ?? {};
  // NOT `?? {}` like the two above: the ABSENCE of this section has to stay
  // distinguishable from a section full of nulls, because `gmv_net` falls back
  // to the gross figure only when the section is genuinely missing (SHP-1).
  const sb = parsed.bisnis_home?.pesanan_dibayar?.summary ?? null;
  const kuadran = parsed.bisnis_produk ? computeQuadrants(parsed.bisnis_produk, bench) : null;
  const zero = ZERO_ACTIVITY_MODULES.filter((m) => {
    const mod = parsed[m];
    return mod != null && 'has_activity' in mod && !(mod as ActivitySummary | VideoReport).has_activity;
  });

  const affProd = parsed.aff_product?.items ?? [];
  const affCre = [...(parsed.aff_creator?.items ?? [])].sort((a, b) => (b.omzet ?? 0) - (a.omzet ?? 0));
  const totalOmzet = affProd.length ? sumOpt(affProd, (i) => i.omzet) : sumOpt(affCre, (i) => i.omzet);
  const totalKomisi = affProd.length ? sumOpt(affProd, (i) => i.komisi) : sumOpt(affCre, (i) => i.komisi);

  return {
    kpi_utama: {
      pesanan_dibuat: {
        gmv: sd.penjualan ?? null, pesanan: sd.pesanan ?? null, aov: sd.penjualan_per_pesanan ?? null,
        pengunjung: sd.pengunjung ?? null, cr: sd.tingkat_konversi ?? null, produk_diklik: sd.produk_diklik ?? null,
        pembeli: sd.total_pembeli ?? null, pembeli_baru: sd.pembeli_baru ?? null, repeat_rate: sd.persen_pembeli_kembali ?? null,
        batal_pesanan: sd.pesanan_batal ?? null, batal_nilai: sd.penjualan_batal ?? null,
        retur_pesanan: sd.pesanan_retur ?? null, retur_nilai: sd.penjualan_retur ?? null,
      },
      pesanan_siap_dikirim: { gmv: ss.penjualan ?? null, pesanan: ss.pesanan ?? null, cr: ss.tingkat_konversi ?? null },
      pesanan_dibayar: sb ? { gmv: sb.penjualan ?? null, pesanan: sb.pesanan ?? null, cr: sb.tingkat_konversi ?? null } : null,
    },
    daily: parsed.bisnis_home?.pesanan_dibuat?.daily ?? [],
    kuadran, health: computeHealth(parsed, bench), kanal: computeChannels(parsed),
    voucher: parsed.promo_voucher ?? null, chat: parsed.layanan_chat ?? null, meta: parsed.meta ?? null,
    ads: {
      toko: parsed.ads_toko?.items ?? [], produk: parsed.ads_produk?.items ?? [],
      live: parsed.ads_live?.items ?? [], banner: parsed.ads_banner?.items ?? [],
    },
    affiliate: {
      top_products: [...affProd].sort((a, b) => (b.omzet ?? 0) - (a.omzet ?? 0)).slice(0, 10),
      top_creators: affCre.slice(0, 10), total_omzet: totalOmzet, total_komisi: totalKomisi,
      total_creators: affCre.length, total_products: affProd.length,
    },
    kesehatan_toko: parsed.bisnis_kesehatan ?? null, video: parsed.bisnis_video ?? null, zero_activity: zero,
    live_uploaded: parsed.bisnis_live != null,
  };
}

export { sum, sumOpt };
