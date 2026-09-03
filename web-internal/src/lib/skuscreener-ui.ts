/**
 * MEA SKU Screener — presentation helpers for `/ads/screening`.
 *
 * Framework-free and pure on purpose, so every rendering rule that could be
 * wrong in a way a reader would not notice is unit-tested (`nav.ts` follows the
 * same split). Nothing here decides anything: routes, verdicts, deltas and
 * medians all arrive already computed in the run payload — this file only
 * chooses how they read.
 *
 * ## Units, stated once
 *
 * `ctr`/`cr` in the payload are PERCENT NUMBERS (`2.0` means 2%), because
 * `parseIndonesianNumber` strips the `%` from the export cell and R04's floors
 * are literally `2.0` and `0.5`. `delta*Pct` are RELATIVE changes, also in
 * percent (`+34.4` means "34,4% better than before"). Rendering either as a
 * fraction would be off by 100× — hence the separate formatters and their
 * tests.
 *
 * House rule #7 holds throughout: a value that has no basis renders `—`, never
 * `0`, `NaN` or an error.
 */

/** Every value that is missing, non-finite, or has no basis renders as this. */
export const EMPTY = '—';

function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** id-ID integer with thousand dots: `1.234.567`. `—` when there is no number. */
export function fmtInt(v: number | null | undefined): string {
  return isNum(v) ? Math.round(v).toLocaleString('id-ID') : EMPTY;
}

/**
 * A plain number, id-ID separators, decimals only when it has them: `4` → `4`,
 * `3.57` → `3,57`.
 *
 * Metrics in the Decision Log are not all integers — a ROAS target of 3,57
 * rounded to `4` would misreport what the advertiser actually decided against,
 * so this is used for every metric value and never `fmtInt`.
 */
export function fmtDec(v: number | null | undefined, digits = 2): string {
  if (!isNum(v)) return EMPTY;
  return v.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

/**
 * A percent-number as a percentage: `2` → `2,00%`.
 *
 * NOT multiplied by 100 — the payload value already IS the percentage. This is
 * the single most costly mistake available on this page, so it has a test.
 */
export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (!isNum(v)) return EMPTY;
  return `${v.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

/** A relative change: `34.4` → `+34,4%`, `-10` → `-10,0%`, `0` → `0,0%`. */
export function fmtDeltaPct(v: number | null | undefined, digits = 1): string {
  if (!isNum(v)) return EMPTY;
  const body = `${v.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
  return v > 0 ? `+${body}` : body;
}

/**
 * IDR in house format (rule #7): `Rp. 1.234.567,00`.
 *
 * These payload figures are plain rupiah floats (not the minor-unit `Money`
 * that `@cdps/core` money.format takes), so the cents are formatted from the
 * value itself rather than hardcoded — a CPC maximum of `Rp. 1.234,56` must not
 * be displayed as `Rp. 1.234,00`.
 */
export function fmtRupiah(v: number | null | undefined): string {
  if (!isNum(v)) return EMPTY;
  const neg = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  const rupiah = Math.floor(abs);
  const sen = Math.round((abs - rupiah) * 100);
  // Rounding cents can carry into the rupiah (1.999,999 → 2.000,00).
  const carried = sen === 100 ? rupiah + 1 : rupiah;
  const cents = sen === 100 ? 0 : sen;
  return `${neg}Rp. ${carried.toLocaleString('id-ID')},${String(cents).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Tones. Badge classes are the ones globals.css actually defines
// (`badge-green` … `badge-darkgray`) — not the `badgeSuccess` family, which is
// styled nowhere.
// ---------------------------------------------------------------------------
export type Tone = 'green' | 'blue' | 'amber' | 'red' | 'gray' | 'darkgray' | 'purple';

/**
 * Tone for an R05 route / R06 override label.
 *
 * The two override labels are matched by PREFIX, not equality: their full text
 * is a sentence of advice (`ANTI-RULE — jangan diiklankan`) owned by
 * `@cdps/core`, and pinning the whole string here would make a wording fix in
 * the engine silently fall through to the default tone.
 */
export function routeTone(label: string): Tone {
  if (label.startsWith('ANTI-RULE')) return 'red';
  if (label.startsWith('TAHAN')) return 'darkgray';
  switch (label) {
    case 'SCALE': return 'green';
    case 'KANDIDAT IKLAN': return 'blue';
    case 'OPTIMASI GAMBAR/JUDUL':
    case 'OPTIMASI DESKRIPSI/HARGA': return 'amber';
    case 'PARKIR': return 'gray';
    default: return 'gray';
  }
}

/**
 * Tone for a comparison / optimization verdict.
 *
 * Modul B says MEMBAIK where Modul D says BERHASIL — two vocabularies for the
 * same idea (`@cdps/core` compare.ts flags this explicitly), so both are
 * handled here rather than in two near-identical copies at the call sites.
 */
export function verdictTone(verdict: string): Tone {
  switch (verdict) {
    case 'MEMBAIK':
    case 'BERHASIL': return 'green';
    case 'MEMBURUK': return 'red';
    case 'TIDAK BERUBAH': return 'gray';
    case 'BELUM CUKUP DATA': return 'amber';
    default: return 'gray';
  }
}

/** Tone for `status_vs_target` (Modul C). Above target is good news, not a warning. */
export function statusVsTargetTone(status: string): Tone {
  switch (status) {
    case 'SESUAI': return 'green';
    case 'DI ATAS TARGET': return 'blue';
    case 'DI BAWAH TARGET': return 'red';
    default: return 'gray';
  }
}

/** Human label for a `momen` code, falling back to the raw code so an unmapped value is visible rather than blank. */
export function momenLabel(code: string, options: ReadonlyArray<{ value: string; label: string }>): string {
  return options.find((o) => o.value === code)?.label ?? code;
}

/**
 * Is this SKU worth offering as a Tracker row (Modul D)?
 *
 * The two OPTIMASI routes are exactly the ones whose next step is "change
 * something, then measure" — which is what a Tracker row records. SCALE and
 * KANDIDAT IKLAN go to the Decision Log instead, and PARKIR / ANTI-RULE / TAHAN
 * are not being touched at all. A convenience, not a gate: the server accepts
 * any of the five `initial_route` values, and the form lets the advertiser pick
 * another SKU deliberately.
 */
export function suggestsTracker(label: string): boolean {
  return label === 'OPTIMASI GAMBAR/JUDUL' || label === 'OPTIMASI DESKRIPSI/HARGA';
}
