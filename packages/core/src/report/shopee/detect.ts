/**
 * Shopee report engine — file-type detection (tool `parseFilename` + `MODULE_MAP`).
 *
 * ⚠️ DUAL PATH, PRIMARY-BY-FILENAME — the deliberate exception to the house
 * convention `../detect.ts` (TikTok) established, and required fix #6 from
 * `docs/design/README.md`:
 *
 *  1. **Filename convention FIRST.** `[prefix]-subtype && period && client &&
 *     date.ext` is not incidental — it is a manual renaming convention the
 *     owner's advertiser team ALREADY follows for every export this tool
 *     reads (`docs/design/README.md` §SHOPEE_REPORT_ENGINE.html item 7). It is
 *     also the ONLY way to tell apart file types whose column schema is
 *     otherwise identical (see the note on `ads_toko`/`ads_produk`/`ads_banner`
 *     below) — so unlike TikTok, content signature cannot simply replace it.
 *  2. **Content signature as FALLBACK**, for the CDPS case the tool never had
 *     to handle: a file re-uploaded through CDPS without the team's manual
 *     rename, or renamed inconsistently. Only for modules whose columns are
 *     actually distinguishable — see `CONTENT_SIGNATURES` below.
 *
 * ⛔ Known, unavoidable limitation — NOT a bug to "fix" here: `ads_toko`,
 * `ads_produk` and `ads_banner` are exported from Shopee Ads Center as the
 * IDENTICAL column layout (nama iklan/status/dilihat/klik/biaya/omzet/roas).
 * The owner's own tool cannot and does not distinguish them by content either
 * — it relies on the filename 100% of the time for this trio. Same story for
 * `bisnis_live`, `promo_diskon`, `promo_flashsale`, `layanan_broadcast`: the
 * tool's own parser for these is `genericZero` (a raw activity counter with no
 * defined column signature at all). Content-fallback for these 7 modules
 * returns null by design — a file of one of these types with a broken
 * filename is genuinely unrecognisable, exactly as it is in the shipped tool.
 */
import type { Aoa } from '../../baseline/types';
import type { ShopeeModule } from './types';

// ---------------------------------------------------------------------------
// Filename convention (primary)
// ---------------------------------------------------------------------------
/** `[prefix]-subtype` → module. Verbatim from the tool's `MODULE_MAP`. */
const MODULE_MAP: Record<string, ShopeeModule> = {
  'bisnis|home': 'bisnis_home',
  'bisnis|produk': 'bisnis_produk',
  'bisnis|live': 'bisnis_live',
  'bisnis|kesehatan': 'bisnis_kesehatan',
  'bisnis|video': 'bisnis_video',
  'ads|toko': 'ads_toko',
  'ads|produk': 'ads_produk',
  'ads|live': 'ads_live',
  'ads|banner': 'ads_banner',
  'aff|product': 'aff_product',
  'aff|creator': 'aff_creator',
  'promo|diskon': 'promo_diskon',
  'promo|voucher': 'promo_voucher',
  'promo|flashsale': 'promo_flashsale',
  'layanan|chat': 'layanan_chat',
  'layanan|chatbroadcast': 'layanan_broadcast',
  'meta|': 'meta',
};

export interface ParsedFilename {
  module: ShopeeModule;
  client: string | null;
  period: string | null;
  date: string | null;
  ext: 'xlsx' | 'csv';
  filename: string;
}

/**
 * Parse the owner's manual naming convention:
 * `[bisnis]-Home && Juni 2026 && EzzyConnect && 2026-07-01.xlsx`. Returns null
 * for anything that does not match — the caller then tries content detection.
 */
export function parseFilename(name: string): ParsedFilename | null {
  const dot = name.lastIndexOf('.');
  const base = dot >= 0 ? name.slice(0, dot) : name;
  const ext = (dot >= 0 ? name.slice(dot + 1).toLowerCase() : '') as 'xlsx' | 'csv' | '';
  if (ext !== 'xlsx' && ext !== 'csv') return null;
  const m = base.match(/\[(\w+)\](?:-(\w+))?/);
  if (!m) return null;
  const prefix = m[1].toLowerCase();
  const subtype = m[2] ? m[2].toLowerCase() : '';
  const module = MODULE_MAP[`${prefix}|${subtype}`];
  if (!module) return null;
  const parts = base.split('&&').map((p) => p.trim());
  let client: string | null = null, date: string | null = null, period: string | null = null;
  if (parts.length >= 3) {
    date = parts[parts.length - 1];
    client = parts[parts.length - 2];
    period = parts.length >= 4 ? parts[parts.length - 3] : parts[1];
  }
  return { module, client, period, date, ext, filename: name };
}

// ---------------------------------------------------------------------------
// Content signature (fallback)
// ---------------------------------------------------------------------------
const cell = (v: unknown): string => (v == null ? '' : String(v).trim());
const cellLc = (v: unknown): string => cell(v).toLowerCase();
const rowJoined = (row: unknown[] | undefined): string => (row ?? []).map(cellLc).join(' ');

/** True when some row's joined text contains every keyword (AND). */
function anyRowHas(aoa: Aoa, ...keywords: string[]): boolean {
  return aoa.some((row) => {
    const j = rowJoined(row);
    return keywords.every((k) => j.includes(k));
  });
}

/** True when some cell (anywhere) equals one of the given labels exactly. */
function anyCellEquals(aoa: Aoa, ...labels: string[]): boolean {
  const set = new Set(labels.map((l) => l.toLowerCase()));
  return aoa.some((row) => (row ?? []).some((c) => set.has(cellLc(c))));
}

/**
 * Modules with a genuinely distinguishable content signature. The 7 modules
 * NOT listed here (`ads_toko`, `ads_produk`, `ads_banner`, `bisnis_live`,
 * `promo_diskon`, `promo_flashsale`, `layanan_broadcast`) fall through to
 * "unrecognised" when the filename doesn't match — see file header.
 *
 * Order matters: more specific checks are tried before broader ones so e.g.
 * `ads_live`'s "penonton" column is checked before it could be mistaken for
 * the ambiguous ads trio (which this map deliberately excludes anyway).
 */
const CONTENT_SIGNATURES: Partial<Record<ShopeeModule, (aoa: Aoa) => boolean>> = {
  bisnis_home: (aoa) => anyRowHas(aoa, 'pesanan dibuat') && anyRowHas(aoa, 'total pengunjung'),
  bisnis_produk: (aoa) => anyRowHas(aoa, 'kode produk', 'variasi'),
  bisnis_kesehatan: (aoa) => anyRowHas(aoa, 'poin pinalti') || anyRowHas(aoa, 'poin penalti'),
  bisnis_video: (aoa) => anyCellEquals(aoa, 'periode data'),
  promo_voucher: (aoa) => anyCellEquals(aoa, 'nama voucher') || (anyRowHas(aoa, 'periode waktu') && anyRowHas(aoa, 'klaim')),
  layanan_chat: (aoa) => anyRowHas(aoa, 'grafik kriteria') || (anyRowHas(aoa, 'periode waktu') && (anyRowHas(aoa, 'csat') || anyRowHas(aoa, 'jumlah chat'))),
  meta: (aoa) => anyRowHas(aoa, 'minggu', 'dibelanjakan'),
  // "penonton" is what separates a LIVE ads export from the toko/produk/banner
  // trio, which report "pesanan" instead — the ONE ads sub-type that content
  // alone can tell apart.
  ads_live: (aoa) => anyRowHas(aoa, 'nama iklan', 'penonton'),
  aff_creator: (aoa) => anyRowHas(aoa, 'omzet') && (anyRowHas(aoa, 'username') || anyRowHas(aoa, 'kreator') || anyRowHas(aoa, 'creator')),
  // Deliberately the NARROW keyword ('nama produk'), not the loose 'produk'
  // `parseAffCsv`'s own fallback name-column search also accepts — an Ads CSV
  // export routinely has BOTH "Omzet Penjualan" and "Produk Terjual" columns,
  // and the loose keyword would misfire on every one of those.
  aff_product: (aoa) => anyRowHas(aoa, 'omzet') && anyRowHas(aoa, 'nama produk') && !(anyRowHas(aoa, 'username') || anyRowHas(aoa, 'kreator') || anyRowHas(aoa, 'creator')),
};

/** Try every signature; first match wins (map iteration order = declared order). */
export function detectModuleFromContent(aoa: Aoa): ShopeeModule | null {
  for (const [mod, sig] of Object.entries(CONTENT_SIGNATURES) as [ShopeeModule, (aoa: Aoa) => boolean][]) {
    if (sig(aoa)) return mod;
  }
  return null;
}

/** Filename convention first, content signature as fallback. */
export function detectModule(filename: string, aoa: Aoa): { module: ShopeeModule; info: ParsedFilename | null } | null {
  const info = parseFilename(filename);
  if (info) return { module: info.module, info };
  const byContent = detectModuleFromContent(aoa);
  return byContent ? { module: byContent, info: null } : null;
}

// ---------------------------------------------------------------------------
// Multi-sheet marker (tool `__SHEET__:` fix — "baca SEMUA sheet + marker nama
// sheet"). A workbook read into one Aoa may bundle several worksheets; the
// browser-side reader is expected to concatenate them with a `__SHEET__:name`
// marker row between each (out of scope for this pass — no `web-internal`
// upload UI is being built here), and every section-scanning parser in
// `metrik.ts` stops at the next marker so it never reads past its own table
// into the next sheet's.
// ---------------------------------------------------------------------------
export const SHEET_MARK = '__SHEET__:';

export function isSheetMarker(row: unknown[] | undefined): boolean {
  return !!row && row.length >= 1 && typeof row[0] === 'string' && row[0].startsWith(SHEET_MARK);
}
