/**
 * Field-level validation of one seed CSV row into an `msl.ServiceInput`.
 *
 * Port of `archive/backend-go/cmd/mslseed/validate.go`. Pure (no DB): the same enums and
 * rules as `msl.normalizeInput` — which stays the authoritative server-side gate
 * — but reported per row so a bad seed CSV fails fast with a usable line number
 * instead of a bare `[data tidak lengkap, silahkan lengkapi semua pertanyaan
 * wajib!]` thrown from deep inside the domain layer.
 *
 * The messages here are operator diagnostics for a CLI, NOT user-facing
 * validation strings: they are the verbatim Indonesian text Go's mslseed already
 * printed, so house rule #5 (exact BI `[...]` messages) is untouched — no new
 * bracketed string is invented.
 *
 * As in Go, this file may import both `msl` and `sales`: it is a leaf, while
 * `msl` deliberately never imports `sales` so the catalog admin and the pricing
 * calculator cannot form a cycle.
 */

import { money } from '@cdps/core';
import { msl, sales } from '@cdps/domain';
import type { Row } from './csv';

const PRICING_FLAT = 'flat';
const PRICING_MIN_FLOOR = 'min_floor';
const PRICING_BATCH_CEILING = 'batch_ceiling';
const PRICING_PASSTHROUGH = 'passthrough';

const VALID_PRICING_MODES = new Set([
  PRICING_FLAT, PRICING_MIN_FLOOR, PRICING_BATCH_CEILING, PRICING_PASSTHROUGH,
]);

const VALID_FREQUENCIES = new Set(['Monthly', 'One-time', 'Campaign']);

/** A row-addressable seed validation failure (line number + service_key). */
export class SeedRowError extends Error {
  readonly line: number;
  readonly serviceKey: string;

  constructor(row: Row, detail: string) {
    super(`baris ${row.line} (${row.serviceKey}): ${detail}`);
    this.name = 'SeedRowError';
    this.line = row.line;
    this.serviceKey = row.serviceKey;
  }
}

/** q renders a value the way Go's %q verb did, for identical CLI output. */
function q(s: string): string {
  return JSON.stringify(s);
}

/**
 * rowToServiceInput validates one raw CSV row and converts it to an
 * `msl.ServiceInput`. It is the single source of truth for "is this row
 * well-formed" — both dry-run and apply call it before touching the DB.
 */
export function rowToServiceInput(row: Row): msl.ServiceInput {
  const name = row.name.trim();
  if (name === '') {
    throw new SeedRowError(row, 'name kosong');
  }

  let mode = row.pricingMode.trim();
  if (mode === '') {
    mode = PRICING_FLAT;
  }
  if (!VALID_PRICING_MODES.has(mode)) {
    throw new SeedRowError(row, `pricing_mode tidak dikenal: ${q(row.pricingMode)}`);
  }

  const frequency = row.frequency.trim();
  if (frequency !== '' && !VALID_FREQUENCIES.has(frequency)) {
    throw new SeedRowError(row, `frequency tidak dikenal: ${q(row.frequency)}`);
  }

  const minQty = row.minQty.trim();
  const needsMinQty = mode === PRICING_MIN_FLOOR || mode === PRICING_BATCH_CEILING;
  if (needsMinQty && minQty === '') {
    throw new SeedRowError(row, `min_qty wajib diisi untuk pricing_mode=${mode}`);
  }
  if (!needsMinQty && minQty !== '') {
    throw new SeedRowError(
      row,
      `min_qty harus kosong untuk pricing_mode=${mode} (hanya berlaku untuk min_floor/batch_ceiling)`,
    );
  }
  if (needsMinQty) {
    let m: money.Money;
    try {
      m = money.parse(minQty);
    } catch {
      throw new SeedRowError(row, `min_qty bukan bilangan bulat positif: ${q(row.minQty)}`);
    }
    if (m <= 0n || m % 100n !== 0n) {
      throw new SeedRowError(row, `min_qty bukan bilangan bulat positif: ${q(row.minQty)}`);
    }
  }

  let priceRaw = row.unitPrice.trim();
  if (priceRaw === '') {
    priceRaw = '0';
  }
  let price: money.Money;
  try {
    price = money.parse(priceRaw);
  } catch {
    throw new SeedRowError(row, `unit_price tidak valid: ${q(row.unitPrice)}`);
  }
  if (mode === PRICING_PASSTHROUGH) {
    if (price < 0n) {
      throw new SeedRowError(row, `unit_price tidak boleh negatif untuk passthrough: ${q(row.unitPrice)}`);
    }
  } else if (price <= 0n) {
    throw new SeedRowError(row, `unit_price harus > 0 untuk pricing_mode=${mode}: ${q(row.unitPrice)}`);
  }

  const applyPPN = parseZeroOne(row.applyPPN);
  if (applyPPN === null) {
    throw new SeedRowError(row, `apply_ppn harus "0" atau "1": ${q(row.applyPPN)}`);
  }

  const active = parseTrueFalse(row.active);
  if (active === null) {
    throw new SeedRowError(row, `active harus "true" atau "false": ${q(row.active)}`);
  }

  // Grammar gate (DECISIONS O14): only "<N>% of standard price" or "flat Rp <N>".
  const commissionRule = row.commissionRule.trim();
  try {
    sales.parseCommissionRule(commissionRule);
  } catch {
    throw new SeedRowError(row, `commission_rule tidak dikenal (grammar DECISIONS O14): ${q(commissionRule)}`);
  }

  const effectiveFrom = row.effectiveFrom.trim();
  if (!isCalendarDate(effectiveFrom)) {
    throw new SeedRowError(row, `effective_from harus YYYY-MM-DD: ${q(row.effectiveFrom)}`);
  }

  return {
    name,
    standardPrice: money.decimal(price),
    commissionRule,
    category: row.category.trim(),
    unit: row.unit.trim(),
    minQty,
    pricingMode: mode,
    applyPPN,
    frequency,
    priceNote: row.priceNote.trim(),
    description: row.description.trim(),
    active,
    effectiveFrom,
  };
}

/** parseZeroOne parses the CSV boolean convention for apply_ppn ("0"/"1"). */
function parseZeroOne(s: string): boolean | null {
  switch (s.trim()) {
    case '0': return false;
    case '1': return true;
    default: return null;
  }
}

/** parseTrueFalse parses the CSV boolean convention for active ("true"/"false"). */
function parseTrueFalse(s: string): boolean | null {
  switch (s.trim()) {
    case 'true': return true;
    case 'false': return false;
    default: return null;
  }
}

/**
 * isCalendarDate reports whether s is a real YYYY-MM-DD calendar date — the
 * equivalent of Go's `time.Parse("2006-01-02", s)`, which rejects both a wrong
 * shape and an out-of-range day such as 2026-02-30. A plain regex would accept
 * the latter, so the parsed date is round-tripped back to a string.
 */
function isCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return false;
  }
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
