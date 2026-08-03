/**
 * Commission-rule grammar (DECISIONS O14, ported from Go
 * `internal/module0_sales/commission.go`).
 *
 * O14 is RESOLVED and deliberately narrow: exactly two shapes exist, and
 * anything else is REJECTED rather than guessed.
 *
 *   "<N>% of standard price"   percentage of the line deal value
 *   "flat Rp <N>"              fixed rupiah amount (dots = thousands separators)
 *
 * WHY THIS IS ITS OWN MODULE. Two callers need the same grammar and they must
 * not import each other: `sales` (the pricing calculator, which reads the MSL)
 * and `msl` (the catalog admin, whose write door has to reject a rule the
 * calculator could never parse). `msl` importing `sales` would close an import
 * cycle — `sales` already imports `msl.effectiveAt`. Copying the regexes into
 * both would be worse: two versions of one business rule, which is exactly what
 * CLAUDE.md forbids. So the grammar lives here, in a leaf both can import.
 *
 * Historically the grammar sat inside `sales.ts` and the write door only checked
 * `commission_rule !== ''`. A service saved through the MSL admin with, say,
 * "10%" therefore persisted happily and then blew up EVERY later pricing read
 * (quote preview, Qualified Lead Form submit, negotiation, closing) with an
 * unmapped throw → opaque HTTP 500. Extracting the grammar is what lets the
 * catalog door enforce it at write time.
 */

import { money } from '@cdps/core';

const RE_PCT = /^(\d+)(?:\.(\d+))?% of standard price$/;
const RE_FLAT = /^flat Rp (\d+|\d{1,3}(?:\.\d{3})+)$/;

/** A parsed, immutable commission rule for one service. */
export interface CommissionRule {
  raw: string;
  isFlat: boolean;
  flat: money.Money;
  pctNum: bigint;
  pctScale: number;
}

/**
 * Thrown when a commission_rule string is not one of the two documented shapes.
 *
 * Internal sentinel, not a user prompt: reaching it means a `master_service_versions`
 * row is malformed, which the MSL write gate (`msl.normalizeInput`) now prevents.
 * The API maps it to 400 with the house BI default rather than leaking this text.
 */
export class BadCommissionRuleError extends Error {
  /** The offending rule string, for the server-side log line. */
  readonly rule: string;

  constructor(rule: string) {
    super(`module0_sales: unrecognized commission_rule: ${JSON.stringify(rule)}`);
    this.name = 'BadCommissionRuleError';
    this.rule = rule;
  }
}

/** parseCommissionRule parses an MSL commission_rule string (DECISIONS O14). */
export function parseCommissionRule(rule: string): CommissionRule {
  const r = rule.trim();
  const pct = RE_PCT.exec(r);
  if (pct) {
    const whole = pct[1];
    const frac = pct[2] ?? '';
    return { raw: r, isFlat: false, flat: 0n, pctNum: BigInt(whole + frac), pctScale: frac.length };
  }
  const flat = RE_FLAT.exec(r);
  if (flat) {
    const digits = flat[1].replace(/\./g, ''); // dots are thousands separators
    return { raw: r, isFlat: true, flat: money.parse(digits), pctNum: 0n, pctScale: 0 };
  }
  throw new BadCommissionRuleError(rule);
}

/**
 * isValidCommissionRule reports whether the calculator would be able to price a
 * service carrying this rule. The MSL write door uses it so a rule that fails
 * here never reaches the catalog in the first place.
 */
export function isValidCommissionRule(rule: string): boolean {
  try {
    parseCommissionRule(rule);
    return true;
  } catch {
    return false;
  }
}

/** computeCommission returns the commission for one service given its deal value. */
export function computeCommission(rule: CommissionRule, dealValue: money.Money): money.Money {
  if (rule.isFlat) {
    return rule.flat;
  }
  return money.percentOf(dealValue, rule.pctNum, rule.pctScale);
}
