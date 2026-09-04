/**
 * The DB-touching half of mslseed — port of `archive/backend-go/cmd/mslseed/engine.go`.
 *
 * Given already-parsed rows and an actor, `execute`:
 *   1. validates EVERY row (format-level, via `rowToServiceInput`) and aborts
 *      before touching the DB if any row fails;
 *   2. builds an idempotent create / new-version / skip plan by matching each
 *      row's NAME against the MSL version effective at that row's
 *      `effective_from` (`msl.listEffectiveAt`);
 *   3. either prints the plan (dry-run) or executes it through the domain layer
 *      (apply — `msl.createService` / `msl.updateService` only, so every write is
 *      validated, versioned and audited by the same code the admin UI calls).
 *
 * Idempotency key = service NAME at the row's `effective_from`. "Identical"
 * means every seeded field (including `effective_from`) matches the existing
 * effective version; any difference appends a NEW version — never a mutation, so
 * an older Qualified/Closing snapshot stays reproducible (CLAUDE.md #3/#4).
 */

import { money } from '@cdps/core';
import { msl } from '@cdps/domain';
import type { Sql } from '@cdps/db';
import type { Row } from './csv';
import { rowToServiceInput } from './validate';

/** Tallies the outcome of one execute run (dry-run or apply). */
export interface Report {
  created: number;
  newVersion: number;
  skipped: number;
  errors: number;
}

/** Sink for progress output (stdout in the CLI, a buffer in tests). */
export type Logger = (line: string) => void;

const ACTION_CREATE = 'create';
const ACTION_UPDATE = 'update';
const ACTION_SKIP = 'skip';

interface Item {
  row: Row;
  input: msl.ServiceInput;
}

interface Planned extends Item {
  action: typeof ACTION_CREATE | typeof ACTION_UPDATE | typeof ACTION_SKIP;
  existing?: msl.ServiceView;
}

/**
 * execute validates rows, builds the plan against the DB, and — iff `apply` —
 * writes through `msl.createService`/`msl.updateService`. Progress and the final
 * plan go to `log`.
 *
 * Throws on: permission denied (`msl.ForbiddenError`), a row-validation failure
 * (checked first — nothing is touched), a DB error while planning, or at least
 * one write failure during apply.
 */
export async function execute(
  sql: Sql,
  actor: msl.Actor,
  rows: Row[],
  apply: boolean,
  log: Logger,
): Promise<Report> {
  const rep: Report = { created: 0, newVersion: 0, skipped: 0, errors: 0 };

  // The domain layer re-checks this on every write; checking up front means a
  // denied actor never sees a plan built from data they may not edit.
  if (!msl.canEditMasterServices(actor)) {
    throw new msl.ForbiddenError();
  }

  // --- Phase 1: validate every row before touching the DB at all. ------------
  const items: Item[] = [];
  let badRows = 0;
  for (const row of rows) {
    try {
      items.push({ row, input: rowToServiceInput(row) });
    } catch (e) {
      badRows++;
      log(`ERROR ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (badRows > 0) {
    rep.errors = badRows;
    throw new Error(
      `validasi CSV gagal: ${badRows} dari ${rows.length} baris tidak valid — dibatalkan sebelum menyentuh DB`,
    );
  }

  // --- Phase 2: idempotency plan (read-only). -------------------------------
  // Cache listEffectiveAt per distinct effective_from: a seed run normally
  // shares one date across all rows, so this is a single query in practice.
  const cache = new Map<string, Map<string, msl.ServiceView>>();
  const effectiveByName = async (date: string): Promise<Map<string, msl.ServiceView>> => {
    const hit = cache.get(date);
    if (hit) {
      return hit;
    }
    const views = await msl.listEffectiveAt(sql, date);
    const byName = new Map<string, msl.ServiceView>();
    for (const v of views) {
      byName.set(v.name, v);
    }
    cache.set(date, byName);
    return byName;
  };

  const plan: Planned[] = [];
  for (const it of items) {
    let byName: Map<string, msl.ServiceView>;
    try {
      byName = await effectiveByName(it.input.effectiveFrom);
    } catch (e) {
      throw new Error(
        `baris ${it.row.line} (${it.row.serviceKey}): lookup MSL efektif @ ${it.input.effectiveFrom}: ` +
        `${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const existing = byName.get(it.input.name);
    if (!existing) {
      plan.push({ ...it, action: ACTION_CREATE });
      continue;
    }
    plan.push({
      ...it,
      action: sameService(existing, it.input) ? ACTION_SKIP : ACTION_UPDATE,
      existing,
    });
  }

  // --- Phase 3: report the plan, and (iff apply) execute it. -----------------
  for (const p of plan) {
    if (p.action === ACTION_CREATE) {
      if (!apply) {
        rep.created++;
        log(`[DRY-RUN] akan dibuat  baris ${p.row.line} (${p.row.serviceKey}): ${p.input.name}`);
        continue;
      }
      try {
        const id = await msl.createService(sql, actor, p.input);
        rep.created++;
        log(`dibuat        baris ${p.row.line} (${p.row.serviceKey}): ${p.input.name} -> ${id} v1`);
      } catch (e) {
        rep.errors++;
        log(`ERROR baris ${p.row.line} (${p.row.serviceKey}) create: ${e instanceof Error ? e.message : String(e)}`);
      }
      continue;
    }

    if (p.action === ACTION_UPDATE) {
      const existing = p.existing!;
      if (!apply) {
        rep.newVersion++;
        log(
          `[DRY-RUN] versi baru  baris ${p.row.line} (${p.row.serviceKey}): ${p.input.name} ` +
          `(${existing.id} v${existing.versionNo} -> v${existing.versionNo + 1})`,
        );
        continue;
      }
      try {
        const ver = await msl.updateService(sql, actor, existing.id, p.input);
        rep.newVersion++;
        log(`versi baru    baris ${p.row.line} (${p.row.serviceKey}): ${p.input.name} -> ${existing.id} v${ver}`);
      } catch (e) {
        rep.errors++;
        log(`ERROR baris ${p.row.line} (${p.row.serviceKey}) update: ${e instanceof Error ? e.message : String(e)}`);
      }
      continue;
    }

    rep.skipped++;
    log(`sama, dilewati baris ${p.row.line} (${p.row.serviceKey}): ${p.input.name}`);
  }

  const mode = apply ? 'apply' : 'dry-run';
  log('');
  log(
    `ringkasan (${mode}): dibuat=${rep.created} versi_baru=${rep.newVersion} ` +
    `dilewati=${rep.skipped} error=${rep.errors}`,
  );

  if (rep.errors > 0) {
    throw new Error(`${rep.errors} error saat ${mode}`);
  }
  return rep;
}

/**
 * sameService reports whether every seeded field of an existing effective
 * version matches a candidate input exactly — the idempotency "no-op" check.
 * Money-ish fields compare by parsed value (the DB round-trips "6000000" as
 * "6000000.00"), everything else by exact string/boolean equality.
 *
 * `requiresStrategyPlan` is deliberately NOT compared: it is not a seeded column
 * (the CSV has no such field, and M6 owns it), so comparing it would make every
 * rerun append a spurious version.
 */
export function sameService(existing: msl.ServiceView, want: msl.ServiceInput): boolean {
  const wantPrice = want.standardPrice === '' ? '0' : want.standardPrice;
  let wp: money.Money;
  let ep: money.Money;
  try {
    wp = money.parse(wantPrice);
  } catch (e) {
    throw new Error(`standard_price baru ${JSON.stringify(want.standardPrice)}: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    ep = money.parse(existing.standardPrice);
  } catch (e) {
    throw new Error(`standard_price existing ${JSON.stringify(existing.standardPrice)}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (wp !== ep) {
    return false;
  }
  if (!sameOptionalQty(existing.minQty, want.minQty ?? '')) {
    return false;
  }
  return existing.name === want.name &&
    existing.commissionRule === want.commissionRule &&
    existing.category === (want.category ?? '') &&
    existing.unit === (want.unit ?? '') &&
    existing.pricingMode === (want.pricingMode || 'flat') && // domain defaults "" -> flat
    existing.applyPPN === (want.applyPPN ?? false) &&
    existing.frequency === (want.frequency ?? '') &&
    existing.priceNote === (want.priceNote ?? '') &&
    existing.description === (want.description ?? '') &&
    existing.active === (want.active ?? false) &&
    existing.effectiveFrom === want.effectiveFrom;
}

/**
 * sameOptionalQty compares an optional DECIMAL(15,2)-ish quantity field (empty
 * string = not set) by parsed value when both are set.
 */
function sameOptionalQty(a: string, b: string): boolean {
  if (a === '' || b === '') {
    return a === b;
  }
  try {
    return money.parse(a) === money.parse(b);
  } catch {
    return a === b;
  }
}
