/**
 * Baseline engine — number parsing + formatters, ported VERBATIM from the owner's
 * tool (`docs/design/BASELINE_TOOL_TIKTOK_v1.html:304-336`).
 *
 * ⛔ JANGAN ubah `n(v,raw)` (RAB-02): Seller Center mengirim string
 * `"Rp10.945.407"` (titik = ribuan) sementara Ads Manager mengirim float
 * `335164.77` (titik = desimal). Perbedaannya dibedakan lewat flag `raw`.
 * Mengubahnya = menggeser SETIAP angka iklan.
 */

/**
 * Parse a Seller-Center / Ads-Manager cell into a plain number.
 *   raw=false (Seller Center): "Rp10.945.407" → 10945407 (dot = thousands),
 *                              "5,37%" → 0.0537 (comma = decimal, % → /100).
 *   raw=true  (Ads Manager)  : 335164.77 → 335164.77 (dot = decimal, comma = thousands).
 * Empty / "-" / "—" / "N/A" → 0. This is the VALUE parser: a present-but-empty
 * cell is 0. Absence of the whole COLUMN is a different thing — see metrik.ts.
 */
export function n(v: unknown, raw?: boolean): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).trim();
  if (s === '-' || s === '—' || s === 'N/A') return 0;
  s = s.replace(/rp/gi, '').replace(/\s| /g, '');
  const pct = s.includes('%');
  s = s.replace('%', '');
  if (raw) {
    s = s.replace(/,/g, '');
  } else {
    const hasC = s.includes(',');
    const hasD = s.includes('.');
    if (hasC && hasD) s = s.replace(/\./g, '').replace(',', '.');
    else if (hasC) s = s.replace(',', '.');
    else if (hasD) {
      const p = s.split('.');
      if (p.length > 1 && p.slice(1).every((x) => x.length === 3)) s = p.join('');
    }
  }
  const f = parseFloat(s);
  if (!isFinite(f)) return 0;
  return pct ? f / 100 : f;
}

export const DASH = '—';

export const nil = (v: unknown): boolean => v == null || typeof v !== 'number' || !isFinite(v);

/** House IDR format: `Rp. 10.945.407,00`. Div-by-zero / null → `—` (house rule #7). */
export const rp = (v: number | null | undefined): string =>
  nil(v) ? DASH : 'Rp. ' + Math.round(v as number).toLocaleString('id-ID') + ',00';

export const num = (v: number | null | undefined): string =>
  nil(v) ? DASH : Math.round(v as number).toLocaleString('id-ID');

export const dec = (v: number | null | undefined, d = 1): string =>
  nil(v) ? DASH : (v as number).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });

export const pct = (v: number | null | undefined, d = 1): string => (nil(v) ? DASH : dec((v as number) * 100, d) + '%');

/** Denominator 0 = no basis to divide, NOT zero. null so it renders `—`, not `0%`. */
export const div = (a: number, b: number): number | null => (b ? a / b : null);

/** null-safe multiply — `null * k` must stay null, not become 0 (handoff §2.2 #1). */
export const mul = (v: number | null | undefined, k: number): number | null => (v == null ? null : v * k);

export const fx = (v: number | null | undefined, d: number): number | null => (nil(v) ? null : +(v as number).toFixed(d));

export const median = (a: number[]): number => {
  const s = a.filter((x) => isFinite(x)).sort((x, y) => x - y);
  if (!s.length) return 0;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const esc = (s: unknown): string =>
  String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
