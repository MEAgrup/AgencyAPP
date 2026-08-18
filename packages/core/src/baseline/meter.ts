/**
 * Baseline engine — `meter()` render helper (RAB-02, fix #1).
 * Ported from the tool (lines 765-775). Pure (returns an HTML string, no DOM).
 *
 * FIX #1 (handoff §2.2): a null metric MUST NOT render. In the tool the bug was
 * the CALL SITE (`T.refundRate*100`, where `null*100 === 0` in JS) sneaking a 0
 * past this guard, painting a green "0% ok" bar for a store with no GMV. Call
 * sites now pass `mul(x,100)` (null-preserving), so a null value reaches here as
 * null and yields `''` — nothing rendered.
 */
import { clamp } from './angka';

export function meter(
  label: string,
  val: number | null | undefined,
  target: number,
  fmt: (v: number) => string,
  invert?: boolean,
): string {
  if (val == null || !isFinite(val)) return '';
  const over = val > target;
  // mirror the tool: div(a,b) is null when b==0, and `null*100 === 0` in JS.
  const d = (a: number, b: number): number => (b ? a / b : 0);
  const fill = over ? 100 : clamp(d(val, target) * 100, 1.5, 100);
  const tick = over ? clamp(d(target, val) * 100, 2, 98) : 100;
  const ratio = d(val, target);
  const cls = invert ? (ratio <= 1 ? 'ok' : ratio <= 1.5 ? 'mid' : 'bad') : ratio >= 1 ? 'ok' : ratio >= 0.6 ? 'mid' : 'bad';
  return `<div class="meter"><div class="meter-lb"><span>${label}</span><b>${fmt(val)}</b></div>
    <div class="track"><div class="fill ${cls}" style="width:${fill}%"></div>
    <div class="tick" data-t="target ${fmt(target)}" style="left:${tick}%"></div></div></div>`;
}
