/**
 * The `commission_rule` grammar — ONE source of truth, shared by the Master
 * Service List admin (`msl.ts`, the WRITE side) and the pricing calculator
 * (`sales.ts` / `finance.ts` / `renewal.ts`, the READ side).
 *
 * Why this lives in its own file rather than inside `sales.ts` where it was
 * born: `msl.ts` deliberately does not import `sales.ts` (see its header — the
 * catalog admin and the pricing calculator must never form an import cycle,
 * mirroring the Go package split). Until O73 that meant the write side had NO
 * grammar gate at all: the MSL form accepted any non-empty string, and the
 * unparseable value only blew up later, in front of a salesperson filling the
 * Qualified Lead Form. Duplicating the two regexes in `msl.ts` would have made
 * it worse — a money rule with two definitions is exactly the drift CLAUDE.md
 * forbids — so the rule moved here instead, the same structural move
 * `plangate_rules.ts` made for the Plan gate.
 *
 * Everything here is pure: its only import is `@cdps/core`, so it cannot form a
 * cycle with anything.
 *
 * Grammar (provisional — DECISIONS.md O14). Exactly two shapes are accepted;
 * anything else is REJECTED rather than guessed, because a guess here silently
 * mis-pays a salesperson:
 *
 *   "<N>% of standard price"   percentage of that line's deal value
 *   "flat Rp <N>"              fixed rupiah amount (dots = thousands separators)
 *
 * Reference: backend/internal/module0_sales/commission.go (parity oracle).
 */

import { money } from '@cdps/core';

const RE_PCT = /^(\d+)(?:\.(\d+))?% of standard price$/;
// Amount is either a plain digit run ("500000") or properly thousands-grouped
// ("500.000", "1.250.000"). Malformed dot patterns ("500.00", "1.5") are rejected.
const RE_FLAT = /^flat Rp (\d+|\d{1,3}(?:\.\d{3})+)$/;

/**
 * The canonical way to write "this service earns no commission from its own
 * standard price". Used by the O73 backfill to normalize the bare "0" that the
 * ungated MSL form let through, and by services whose real commission is
 * settled outside the calculator (DECISIONS 2026-08-06, the `Komisi` line).
 */
export const RULE_ZERO_PCT = '0% of standard price';

/** A parsed, immutable commission rule for one service. */
export interface CommissionRule {
  raw: string;
  isFlat: boolean;
  flat: money.Money;
  pctNum: bigint;
  pctScale: number;
}

/**
 * describeRule renders the offending value for a user-facing message: collapsed
 * to one line, stripped of the square brackets that would break the house
 * `[...]` invariant (bi.isBracketed), and truncated so a pasted paragraph does
 * not become the whole alert.
 */
function describeRule(rule: string): string {
  const flat = rule.replace(/\s+/g, ' ').replace(/[[\]]/g, '').trim();
  if (flat === '') {
    return '(kosong)';
  }
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat;
}

/**
 * Thrown when a commission_rule string is not one of the two documented shapes.
 *
 * The message is Bahasa Indonesia in `[...]` (CLAUDE.md #5) and names the fix,
 * because both audiences it can reach need to act on it: the Sales Head typing
 * a rule into the MSL form (who gets it immediately, at the field), and — only
 * if a bad row somehow survives the write gate — a salesperson on the Qualified
 * Lead Form, who must be told the catalog is wrong rather than sent back to
 * re-check questions they already answered correctly. It is NOT the house
 * default `[data tidak lengkap...]` for exactly that reason (DECISIONS O73).
 */
export class BadCommissionRuleError extends Error {
  /** The rejected value, verbatim — for logs/tests, not for the UI. */
  readonly rule: string;

  constructor(rule: string) {
    super(
      `[aturan komisi "${describeRule(rule)}" tidak dikenal, perbaiki di Master Service List ` +
        `(format: "<N>% of standard price" atau "flat Rp <N>")]`,
    );
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
 * isCommissionRule reports whether a string parses, without throwing. For call
 * sites that only need the predicate (validators, tests, backfill checks).
 */
export function isCommissionRule(rule: string): boolean {
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
