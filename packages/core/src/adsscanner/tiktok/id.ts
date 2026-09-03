/**
 * TikTok Ads Scanner engine — product/video ID repair.
 * Ported VERBATIM from the tool `normId`/`fullId`/`pidFromProduk`
 * (`docs/design/TIKTOK_ADS_SCANNER.html:355-377`).
 *
 * ⛔ This is NOT the same problem as `../../baseline/angka.ts`'s `n(v,raw)`
 * (Rupiah-vs-decimal ambiguity). TikTok product/video/creator IDs are
 * 18-19-digit integers that Excel/Sheets silently coerce to float and
 * re-serialize as `1.729643540462601638e+18` on export, losing precision
 * past ~15-16 significant digits. There is no house helper for this
 * elsewhere in `packages/core` (checked `baseline/`, `report/` — neither
 * handles scientific-notation ID repair; both work with IDs that survive
 * their own exports intact). This is a new, TikTok-Ads-Scanner-specific
 * utility, deliberately kept separate from the general number parser.
 *
 * `normId` truncates to the first 15 digits so two IDs mangled by the same
 * float precision loss still match on join (Analitik Produk vs Ads Produk
 * vs Video exports do not all mangle consistently, but they agree on the
 * leading digits). `fullId` recovers the best-effort FULL id for display
 * only — never for joining, since its trailing digits may already be lost.
 */

/** Normalize a possibly float-mangled ID to its first 15 digits, for JOIN keys. Null when too short to be a real product ID. */
export function normId(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  if (!s) return null;
  if (/e\+/i.test(s)) {
    const f = parseFloat(s);
    if (!isFinite(f)) return null;
    s = f.toFixed(0);
  }
  s = s.replace(/\D/g, '');
  return s.length >= 10 ? s.slice(0, 15) : null;
}

/** Best-effort full-length ID for DISPLAY only (never for joining — see module doc). */
export function fullId(v: unknown): string {
  let s = String(v == null ? '' : v).trim();
  if (/e\+/i.test(s)) {
    const f = parseFloat(s);
    if (isFinite(f)) s = f.toFixed(0);
  }
  return s.replace(/\D/g, '');
}

/** Extract the product ID embedded in a "Nama produk (1729643540462601638)" cell (Video export's `Produk` column). */
export function pidFromProduk(s: unknown): string | null {
  const m = String(s == null ? '' : s).match(/\((\d{10,})\)/);
  return m ? normId(m[1]) : null;
}
