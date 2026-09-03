/**
 * R06 — CPC Maksimum, market-CPC comparison override, and the anti-rule.
 *
 *   CPC Maksimum = AOV × (CR/100 × faktor_CR_iklan) ÷ target_ROAS
 *   Jika CPC Maksimum < CPC Pasar Kategori (bila diisi): rute KANDIDAT IKLAN
 *     dan SCALE ditimpa 'TAHAN — CPC max terlalu rendah, naikkan CR atau AOV
 *     dulu'.
 *   Anti-rule absolut: Views ≥ 2.000 DAN CR < 0,5% → 'ANTI-RULE — jangan
 *     diiklankan', mengalahkan rute apapun (including TAHAN).
 *
 * `docs/design/README.md` calls out that the shipped HTML folds the anti-rule
 * into the ordinary PARKIR-ish path (`kelas` stays whatever the base route
 * decided, with no separate label) — this port makes the anti-rule a
 * VISIBLY DISTINCT tag instead, per the PRD's own "mengalahkan rute apapun".
 */
import { Rute, routeSku, RouteInput, RouteMedians } from './route';

/** R06's exact override label for KANDIDAT IKLAN/SCALE routes priced under the market CPC. */
export const LABEL_TAHAN_CPC_RENDAH = 'TAHAN — CPC max terlalu rendah, naikkan CR atau AOV dulu';

/** R06's exact anti-rule label — a tag distinct from the ordinary PARKIR route (per `docs/design/README.md`). */
export const LABEL_ANTI_RULE = 'ANTI-RULE — jangan diiklankan';

export interface CpcMaksimumInput {
  /** NaN when there is no AOV (orders = 0) — `cpcMaksimum` then returns NaN, never a fabricated Rp figure. */
  aov: number;
  /** Organic CR, percent. NaN when absent. */
  crPercent: number;
  /** CR iklan ÷ CR organik (PRD default 1.0 — A09; the shipped tool's UI default is also 1). */
  faktorCrIklan: number;
  targetRoas: number;
}

/**
 * R06 — CPC Maksimum. Returns NaN when there is no basis to compute it (no
 * AOV, no organic CR, or target ROAS not a positive number) — house rule #7:
 * no basis, not a silent 0/Infinity.
 */
export function cpcMaksimum({ aov, crPercent, faktorCrIklan, targetRoas }: CpcMaksimumInput): number {
  if (!isFinite(aov) || !isFinite(crPercent) || !(targetRoas > 0)) return NaN;
  const crIklan = (crPercent / 100) * faktorCrIklan;
  if (!(crIklan > 0)) return NaN;
  return (aov * crIklan) / targetRoas;
}

/** R06 anti-rule: Views ≥ 2.000 AND CR < 0.5% — absolute, beats every route. */
export function isAntiRule(views: number, crPercent: number): boolean {
  return views >= 2000 && isFinite(crPercent) && crPercent < 0.5;
}

export type MarketCpcVerdict = 'ok' | 'tahan' | 'tanpa-pembanding';

export interface MarketCpcResult {
  /** cpcMax ÷ cpcPasar. null when there's no market CPC to compare against, or cpcMax has no basis. */
  ratio: number | null;
  verdict: MarketCpcVerdict;
}

/**
 * R06 — compare CPC Maksimum against the (optional) category-market CPC.
 * `cpcPasar == null` (not filled — it's optional per Flow A3) → 'tanpa-pembanding',
 * never a false 'tahan'.
 */
export function evaluateMarketCpc(cpcMax: number, cpcPasar: number | null): MarketCpcResult {
  if (cpcPasar == null || !(cpcPasar > 0) || !isFinite(cpcMax)) {
    return { ratio: null, verdict: 'tanpa-pembanding' };
  }
  const ratio = cpcMax / cpcPasar;
  return { ratio, verdict: ratio < 1 ? 'tahan' : 'ok' };
}

export interface ClassifySkuInput extends RouteInput {
  aov: number;
}

export interface ClassifySkuResult {
  /** The R05 route before any R06 override. */
  baseRoute: Rute;
  /** What actually gets shown/stored: `baseRoute`, or one of the two R06 override labels. */
  label: Rute | typeof LABEL_TAHAN_CPC_RENDAH | typeof LABEL_ANTI_RULE;
  isAntiRule: boolean;
  isTahanCpcRendah: boolean;
  cpcMax: number;
  marketCpc: MarketCpcResult;
}

/**
 * The full per-SKU decision: R05 base route, then R06's two overrides layered
 * on top. Anti-rule is applied LAST so it beats TAHAN too, matching "anti-rule
 * … mengalahkan rute apapun" literally (apapun = including the TAHAN override
 * itself, not just the five base routes).
 */
export function classifySku(
  input: ClassifySkuInput,
  medians: RouteMedians,
  cpcInputs: { faktorCrIklan: number; targetRoas: number; cpcPasar: number | null },
): ClassifySkuResult {
  const baseRoute = routeSku(input, medians);
  const cpcMax = cpcMaksimum({
    aov: input.aov,
    crPercent: input.cr,
    faktorCrIklan: cpcInputs.faktorCrIklan,
    targetRoas: cpcInputs.targetRoas,
  });
  const marketCpc = evaluateMarketCpc(cpcMax, cpcInputs.cpcPasar);
  const antiRule = isAntiRule(input.views, input.cr);

  // R06: TAHAN only overrides KANDIDAT IKLAN / SCALE (mirrors the shipped
  // tool's `kelas!=='img'&&kelas!=='desc'` — an SKU already routed to
  // optimasi doesn't need a second "don't advertise yet" label).
  const tahan = marketCpc.verdict === 'tahan' && (baseRoute === 'SCALE' || baseRoute === 'KANDIDAT IKLAN');

  let label: ClassifySkuResult['label'] = baseRoute;
  if (tahan) label = LABEL_TAHAN_CPC_RENDAH;
  if (antiRule) label = LABEL_ANTI_RULE; // absolute — overrides TAHAN too.

  return {
    baseRoute,
    label,
    isAntiRule: antiRule,
    isTahanCpcRendah: tahan && !antiRule,
    cpcMax,
    marketCpc,
  };
}
