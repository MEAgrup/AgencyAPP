/**
 * Master Service List administration + read (S0-09), ported to the Supabase
 * stack from Go's `internal/admin/master_service.go`.
 *
 * The MSL is Sales-owned (DECISIONS OD-2): a logical `master_services` row with
 * an append-only chain of immutable `master_service_versions`. Every edit is a
 * NEW version — nothing is mutated in place — so a Qualified/Closing snapshot
 * that pinned an older version stays reproducible forever (CLAUDE.md #3/#4).
 *
 * This module owns the canonical MSL READ (`effectiveAt` / `listEffectiveAt` +
 * `ServiceView`) that `sales.ts` consumes for pricing, and the write path
 * (`createService` / `updateService`) gated to Sales Head/SPV + Director. Kept
 * as a sibling of `sales` (not importing it) so the pricing calculator and the
 * catalog admin never form an import cycle — mirroring the Go package split.
 *
 * House rules honored here:
 *   - MSV id minted ONLY after the mandatory-field gate passes.
 *   - Immutable versions (INSERT-only); every create/version appends to audit.
 *   - Exact BI `[...]`: the house default gate + the edit-denied message.
 *
 * Reference: backend/internal/admin/master_service.go.
 */

import { money, permission } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
// `plangate_rules` is pure (its only import is @cdps/core), so taking the tier
// vocabulary from it cannot form a cycle — unlike `sales`, which this module
// deliberately never imports.
import {
  TIER_DITENTUKAN_AM,
  TIER_PLAN_WAJIB,
  TIER_TANPA_PLAN,
  type PlanTier,
} from './plangate_rules';
// Same reasoning for the commission grammar: `commission_rule` is pure (its only
// import is @cdps/core), so the catalog admin can enforce the rule the pricing
// calculator will later read WITHOUT importing `sales` (DECISIONS O73).
import { parseCommissionRule } from './commission_rule';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

/** The CDPS division that owns the Master Service List (DECISIONS OD-2). */
export const SALES_DIVISION = 'Sales';

/** Exact BI message for an unauthorized MSL edit. */
export const MSG_MASTER_SERVICE_DENIED = '[anda tidak memiliki akses untuk mengubah master service list]';

// Pricing modes / frequencies (local literals — this module never imports
// `sales` so the two never form a cycle; the sets mirror the calculator).
const PRICING_FLAT = 'flat';
const PRICING_MIN_FLOOR = 'min_floor';
const PRICING_BATCH_CEILING = 'batch_ceiling';
const PRICING_PASSTHROUGH = 'passthrough';
const PRICING_MODES = new Set([PRICING_FLAT, PRICING_MIN_FLOOR, PRICING_BATCH_CEILING, PRICING_PASSTHROUGH]);
const FREQUENCIES = new Set(['Monthly', 'One-time', 'Campaign']);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Mandatory-field gate failure (house default BI message). */
export class IncompleteError extends Error {
  constructor() {
    super('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
    this.name = 'MslIncompleteError';
  }
}

/** Actor may not edit the Master Service List (carries the verbatim BI message). */
export class ForbiddenError extends Error {
  constructor() {
    super(MSG_MASTER_SERVICE_DENIED);
    this.name = 'MslForbiddenError';
  }
}

/** No MSL version applies (unknown service, or none effective at the date). */
export class ServiceNotFoundError extends Error {
  constructor(serviceId: string) {
    super(`master service not found: ${serviceId}`);
    this.name = 'ServiceNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

/** The effective view of one service at a date (id = service id). */
export interface ServiceView {
  id: string;
  name: string;
  standardPrice: string;
  commissionRule: string;
  category: string;
  unit: string;
  minQty: string;
  pricingMode: string;
  applyPPN: boolean;
  frequency: string;
  priceNote: string;
  description: string;
  active: boolean;
  requiresStrategyPlan: boolean;
  /**
   * Catalog tier (M6C S4 / §3). This is the field the Sales Head actually sets;
   * `requiresStrategyPlan` is the legacy boolean kept in lockstep with it by
   * `reconcileTier` (and, at the DB layer, by the `normalize_plan_tier` trigger).
   *
   * O54 (DECISIONS 2026-08-07): tier is settable per catalog entry HERE, not in
   * a migration — MEA's services are created dynamically per client need, so a
   * new service that needs a Plan must not have to wait for an engineering
   * release.
   */
  planTier: PlanTier;
  /**
   * Durasi jasa dalam HARI KALENDER (M16 LT-42 / M17 §5.4) — dipakai Ads
   * Management Date (`ads.ts computeAdsManagementEndDate`) untuk service Ads,
   * dan sebagai masa langganan biasa untuk item lain (mis. AI Video/Optimasi
   * SKU). `null` = tidak berlaku untuk layanan ini (mis. Komisi/passthrough).
   */
  durasiJasa: number | null;
  versionNo: number;
  effectiveFrom: string;
}

interface VersionRow {
  service_id: string;
  name: string;
  standard_price: string;
  commission_rule: string;
  category: string | null;
  unit: string | null;
  min_qty: string | null;
  pricing_mode: string;
  apply_ppn: boolean;
  frequency: string | null;
  price_note: string | null;
  description: string | null;
  active: boolean;
  requires_strategy_plan: boolean;
  plan_tier: string;
  durasi_jasa: number | null;
  version_no: number;
  effective_from: Date | string;
}

function toView(r: VersionRow): ServiceView {
  return {
    id: r.service_id, name: r.name, standardPrice: r.standard_price, commissionRule: r.commission_rule,
    category: r.category ?? '', unit: r.unit ?? '', minQty: r.min_qty ?? '', pricingMode: r.pricing_mode,
    applyPPN: r.apply_ppn, frequency: r.frequency ?? '', priceNote: r.price_note ?? '',
    description: r.description ?? '', active: r.active, requiresStrategyPlan: r.requires_strategy_plan,
    planTier: r.plan_tier as PlanTier,
    durasiJasa: r.durasi_jasa,
    versionNo: r.version_no,
    effectiveFrom: r.effective_from instanceof Date
      ? r.effective_from.toISOString().slice(0, 10)
      : String(r.effective_from),
  };
}

const VERSION_COLUMNS = `service_id, name, standard_price, commission_rule, category, unit, min_qty,
  pricing_mode, apply_ppn, frequency, price_note, description, active, requires_strategy_plan,
  plan_tier, durasi_jasa, version_no, effective_from`;

/**
 * effectiveAt returns the MSL version effective on `date` (YYYY-MM-DD, WIB) for a
 * service — the latest version with effective_from ≤ date. Throws
 * ServiceNotFoundError when none applies.
 */
export async function effectiveAt(sql: Queryable, serviceId: string, date: string): Promise<ServiceView> {
  const rows = await sql<VersionRow[]>`
    select service_id, name, standard_price, commission_rule, category, unit, min_qty,
           pricing_mode, apply_ppn, frequency, price_note, description, active,
           requires_strategy_plan, plan_tier, durasi_jasa, version_no, effective_from
    from master_service_versions
    where service_id = ${serviceId} and effective_from <= ${date}
    order by effective_from desc, version_no desc limit 1`;
  if (rows.length === 0) {
    throw new ServiceNotFoundError(serviceId);
  }
  return toView(rows[0]);
}

/**
 * listEffectiveAt returns every service's version effective at `date`
 * (YYYY-MM-DD, WIB), newest-effective per service. Services with no version yet
 * effective at the date are omitted.
 */
export async function listEffectiveAt(sql: Queryable, date: string): Promise<ServiceView[]> {
  const rows = await sql<VersionRow[]>`
    select distinct on (service_id)
           service_id, name, standard_price, commission_rule, category, unit, min_qty,
           pricing_mode, apply_ppn, frequency, price_note, description, active,
           requires_strategy_plan, plan_tier, durasi_jasa, version_no, effective_from
    from master_service_versions
    where effective_from <= ${date}
    order by service_id, effective_from desc, version_no desc`;
  return rows.map(toView);
}

/** listVersions returns the full immutable version chain for one service. */
export async function listVersions(sql: Queryable, serviceId: string): Promise<ServiceView[]> {
  const rows = await sql<VersionRow[]>`
    select service_id, name, standard_price, commission_rule, category, unit, min_qty,
           pricing_mode, apply_ppn, frequency, price_note, description, active,
           requires_strategy_plan, plan_tier, durasi_jasa, version_no, effective_from
    from master_service_versions
    where service_id = ${serviceId}
    order by version_no desc`;
  return rows.map(toView);
}

// ---------------------------------------------------------------------------
// Write path (Sales Head/SPV + Director only)
// ---------------------------------------------------------------------------

/**
 * canEditMasterServices reports whether the actor may add/edit master services.
 * Restricted to Sales division level=lead (Sales Head/SPV); Director is full; a
 * plain salesperson (Sales staff) is denied (edit rights sit one level above the
 * closer so commission math stays non-fudgeable — CLAUDE.md #6 / DECISIONS OD-2).
 */
export function canEditMasterServices(a: Actor): boolean {
  if (a.role.director) {
    return true;
  }
  return a.role.division === SALES_DIVISION && a.role.level === permission.LevelLead;
}

/** Create/update fields for one master-service version. */
export interface ServiceInput {
  name: string;
  standardPrice: string;
  commissionRule: string;
  category?: string;
  unit?: string;
  minQty?: string;
  pricingMode?: string;
  applyPPN?: boolean;
  frequency?: string;
  priceNote?: string;
  description?: string;
  active?: boolean;
  requiresStrategyPlan?: boolean;
  /**
   * Catalog tier (O54). Optional so every pre-M6C caller (seeder, fixtures,
   * older clients that only know the boolean) keeps working unchanged —
   * `reconcileTier` derives it from `requiresStrategyPlan` when absent.
   */
  planTier?: PlanTier;
  /**
   * Durasi jasa dalam HARI KALENDER (M16 LT-42 / M17 §5.4). Optional/undefined
   * = tidak berlaku untuk layanan ini (disimpan NULL) — kebanyakan layanan
   * lama tidak mendeklarasikan ini.
   */
  durasiJasa?: number;
  effectiveFrom: string; // YYYY-MM-DD
}

/** The three catalog tiers, as an input-validation set. */
const PLAN_TIERS = new Set<string>([TIER_PLAN_WAJIB, TIER_DITENTUKAN_AM, TIER_TANPA_PLAN]);

/**
 * reconcileTier keeps `plan_tier` and the legacy `requires_strategy_plan`
 * boolean in agreement, and is a LINE-FOR-LINE mirror of the DB trigger
 * `normalize_plan_tier` (migration 20260806061000). The migration calls that
 * agreement a frozen invariant: "predikat TS dan DB tidak boleh menyimpang".
 *
 * The branch order matters and is not arbitrary — it decides which column wins
 * when the two disagree, by asking which one the caller actually spoke through:
 *
 *   - tier `ditentukan_am`      ⇒ boolean false. The effective gate for this
 *                                 tier comes from `service_plan_gate`, never
 *                                 from the catalog.
 *   - tier `plan_wajib`         ⇒ boolean true. An M6C-era caller spoke via tier.
 *   - tier left at the default  ⇒ a pre-M6C caller spoke via the boolean, so a
 *     and boolean true            true boolean promotes the tier to `plan_wajib`.
 *
 * Keep this identical to the trigger. If they ever diverge, the row is still
 * rejected by `ck_msv_tier_matches_flag` — but the error surfaces at INSERT
 * time as a constraint violation instead of as a validation message, which is
 * a much worse place to find out.
 */
export function reconcileTier(
  planTier: PlanTier | undefined,
  requiresStrategyPlan: boolean,
): { planTier: PlanTier; requiresStrategyPlan: boolean } {
  let tier: PlanTier = planTier ?? TIER_TANPA_PLAN;
  let requires = requiresStrategyPlan;
  if (tier === TIER_DITENTUKAN_AM) {
    requires = false;
  } else if (tier === TIER_PLAN_WAJIB) {
    requires = true;
  } else if (requires) {
    tier = TIER_PLAN_WAJIB;
  }
  return { planTier: tier, requiresStrategyPlan: requires };
}

/** A normalized (validated) input ready to persist. */
interface NormalizedInput extends Required<Omit<ServiceInput, 'category' | 'unit' | 'minQty' | 'frequency' | 'priceNote' | 'description' | 'durasiJasa'>> {
  category: string;
  unit: string;
  minQty: string;
  frequency: string;
  priceNote: string;
  description: string;
  /** null = tidak berlaku untuk layanan ini (disimpan SQL NULL). */
  durasiJasa: number | null;
}

/**
 * normalizeInput validates the MSL v2 calculator fields, applying the flat
 * default and normalizing passthrough's unit price to "0". Invalid input throws
 * IncompleteError (the house default — no new strings invented), EXCEPT for a
 * malformed `commission_rule`, which throws BadCommissionRuleError so the Sales
 * Head is told what shape to type instead of "lengkapi pertanyaan wajib" for a
 * field they did fill in (DECISIONS O73).
 */
function normalizeInput(inp: ServiceInput): NormalizedInput {
  const name = (inp.name ?? '').trim();
  const commissionRule = (inp.commissionRule ?? '').trim();
  const effectiveFrom = (inp.effectiveFrom ?? '').trim();
  if (name === '' || commissionRule === '' || effectiveFrom === '') {
    throw new IncompleteError();
  }
  // Grammar gate (DECISIONS O14/O73). Before O73 this module accepted ANY
  // non-empty string, and 56 of the 96 catalog versions in `CDPS SG` were saved
  // with rules the calculator cannot read ("0", free prose). The cost landed on
  // the wrong person: the row saved fine here, then the Qualified Lead Form
  // refused every one of those services in front of a salesperson. Reject at the
  // keyboard of the one who can actually fix it.
  parseCommissionRule(commissionRule);
  const pricingMode = (inp.pricingMode ?? '') === '' ? PRICING_FLAT : (inp.pricingMode as string);
  if (!PRICING_MODES.has(pricingMode)) {
    throw new IncompleteError();
  }
  const frequency = inp.frequency ?? '';
  if (frequency !== '' && !FREQUENCIES.has(frequency)) {
    throw new IncompleteError();
  }
  // An unknown tier is rejected rather than silently coerced: the whole point of
  // O54 is that the Sales Head chooses this value, and a typo that quietly
  // became `tanpa_plan` would take the Strategi path off the table without
  // anyone being told.
  if (inp.planTier !== undefined && !PLAN_TIERS.has(inp.planTier)) {
    throw new IncompleteError();
  }
  const tier = reconcileTier(inp.planTier, inp.requiresStrategyPlan ?? false);

  let standardPrice = inp.standardPrice ?? '';
  if (pricingMode === PRICING_PASSTHROUGH) {
    // Unit price is ignored for passthrough; normalize "" / "0" to "0".
    if (standardPrice.trim() === '') {
      standardPrice = '0';
    }
    let p: money.Money;
    try {
      p = money.parse(standardPrice);
    } catch {
      throw new IncompleteError();
    }
    if (p < 0n) {
      throw new IncompleteError();
    }
  } else {
    let p: money.Money;
    try {
      p = money.parse(standardPrice);
    } catch {
      throw new IncompleteError();
    }
    if (p <= 0n) {
      throw new IncompleteError();
    }
  }

  let minQty = inp.minQty ?? '';
  if (pricingMode === PRICING_MIN_FLOOR || pricingMode === PRICING_BATCH_CEILING) {
    const norm = wholePositive(minQty);
    if (norm === null) {
      throw new IncompleteError();
    }
    minQty = norm;
  }

  // durasi_jasa (M16 LT-42 / M17 §5.4): undefined = tidak berlaku (NULL). Kalau
  // diberikan, wajib bilangan bulat positif (hari kalender) — bukan 0/negatif,
  // yang tidak berarti sebagai durasi.
  let durasiJasa: number | null = null;
  if (inp.durasiJasa !== undefined) {
    if (!Number.isInteger(inp.durasiJasa) || inp.durasiJasa <= 0) {
      throw new IncompleteError();
    }
    durasiJasa = inp.durasiJasa;
  }

  return {
    name, standardPrice, commissionRule, effectiveFrom, pricingMode,
    category: inp.category ?? '', unit: inp.unit ?? '', minQty, frequency,
    priceNote: inp.priceNote ?? '', description: inp.description ?? '',
    applyPPN: inp.applyPPN ?? false, requiresStrategyPlan: tier.requiresStrategyPlan,
    planTier: tier.planTier,
    durasiJasa,
    active: inp.active ?? false,
  };
}

/**
 * wholePositive validates that s is a whole positive integer (DECIMAL string),
 * returning it normalized to a DECIMAL(15,2) string, or null when invalid.
 */
function wholePositive(s: string): string | null {
  let m: money.Money;
  try {
    m = money.parse(s);
  } catch {
    return null;
  }
  if (m <= 0n || m % 100n !== 0n) {
    return null;
  }
  return money.decimal(m);
}

async function insertVersion(
  tx: Queryable,
  serviceId: string,
  versionNo: number,
  inp: NormalizedInput,
  actorId: string,
): Promise<void> {
  await tx`
    insert into master_service_versions
      (service_id, version_no, name, standard_price, commission_rule, category, unit,
       min_qty, pricing_mode, apply_ppn, frequency, price_note, description,
       active, requires_strategy_plan, plan_tier, durasi_jasa, effective_from, created_by)
    values
      (${serviceId}, ${versionNo}, ${inp.name}, ${inp.standardPrice}, ${inp.commissionRule},
       ${nullText(inp.category)}, ${nullText(inp.unit)}, ${nullText(inp.minQty)}, ${inp.pricingMode},
       ${inp.applyPPN}, ${nullText(inp.frequency)}, ${nullText(inp.priceNote)}, ${nullText(inp.description)},
       ${inp.active}, ${inp.requiresStrategyPlan}, ${inp.planTier}, ${inp.durasiJasa}, ${inp.effectiveFrom}, ${actorId})`;
}

/**
 * createService creates a new master service with version 1 — mints the MSV id
 * ONLY after validation passes, inserts master_services + version 1 + audit, all
 * in one transaction. Sales Head/SPV or Director only.
 */
export async function createService(sql: Sql, actor: Actor, inp: ServiceInput, now: Date = new Date()): Promise<string> {
  if (!canEditMasterServices(actor)) {
    throw new ForbiddenError();
  }
  const norm = normalizeInput(inp);
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const id = await ex.ident.identNext('MSV', now);
    await tx`insert into master_services (id, created_by) values (${id}, ${actor.employeeId})`;
    await insertVersion(tx, id, 1, norm, actor.employeeId);
    await ex.audit.insertAudit({
      entityType: 'master_service', entityId: id, actorEmployeeId: actor.employeeId,
      action: 'create', beforeJson: null,
      afterJson: { version_no: 1, name: norm.name, standard_price: norm.standardPrice, pricing_mode: norm.pricingMode },
      createdBy: actor.employeeId,
    });
    return id;
  });
}

/**
 * updateService appends a new immutable version to an existing service (+ audit).
 * Every change is a new version; nothing is mutated in place. Throws
 * ServiceNotFoundError when the service id has no versions yet.
 */
export async function updateService(sql: Sql, actor: Actor, serviceId: string, inp: ServiceInput): Promise<number> {
  if (!canEditMasterServices(actor)) {
    throw new ForbiddenError();
  }
  const norm = normalizeInput(inp);
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const rows = await tx<{ max: number | null }[]>`
      select max(version_no) as max from master_service_versions where service_id = ${serviceId}`;
    const max = rows[0]?.max;
    if (max === null || max === undefined) {
      throw new ServiceNotFoundError(serviceId);
    }
    const next = Number(max) + 1;
    await insertVersion(tx, serviceId, next, norm, actor.employeeId);
    await ex.audit.insertAudit({
      entityType: 'master_service', entityId: serviceId, actorEmployeeId: actor.employeeId,
      action: 'new_version', beforeJson: null,
      afterJson: { version_no: next, name: norm.name, standard_price: norm.standardPrice, pricing_mode: norm.pricingMode },
      createdBy: actor.employeeId,
    });
    return next;
  });
}

/** nullText stores empty optional strings as SQL NULL. */
function nullText(s: string): string | null {
  return s.trim() === '' ? null : s;
}
