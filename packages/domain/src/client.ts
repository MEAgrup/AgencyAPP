/**
 * Client Record domain service (M4) — the lock matrix (§4), the integrity
 * contract over a born Client Record. Ported from Go's `internal/module4_client`.
 *
 * The Client Record is born at closing (sales.close) with identity/baseline
 * inherited-locked from the winning attempt's Qualified form, the Service set,
 * and the OD-1 fields (Sales PIC / Commission & Payment PIC / Sales Allocation).
 * This module is the ONLY write path onto that row post-close, and it blocks
 * every edit the lock matrix does not permit — each permitted change is audited
 * before→after (house rule #3), never a silent update.
 *
 * Lock matrix (M4 §4), by field → who may edit post-close:
 *   - Profile (Nama PIC, Toko, Kota, Link Toko, Kategori): Account Lead / OD /
 *     Director — correction only, logged (M4-OA-4).
 *   - GMV baseline: OD / Director only (exceptional correction), logged.
 *   - Target GMV, Marketing Budget: Account (staff or lead) / Director — revisable
 *     during the engagement, logged (M4-OA-6).
 *   - Sales PIC, Commission & Payment PIC: Sales Lead / Director — reassign, logged.
 *   - Client ID, Origin Campaign, Sales Allocation, Total Sales, Service List:
 *     NOT editable here (immutable / system-computed / Void-Service path M4-OA-5).
 *
 * House rules honored: locked/system fields are unreachable (blocked server-side
 * with the verbatim BI message); every permitted edit appends an audit row; money
 * fields go through @cdps/core money; permission predicates mirror the §4 matrix.
 *
 * Also here now: the payment-intent handoff write (§5 — see setPaymentIntent) and
 * the §6 visibility read model (row scope enforced by RLS).
 *
 * Reference: backend/internal/module4_client/{edit,locks,reads,intent}.go.
 */

import { bi, money, permission, statemachine } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import * as finance from './finance';

/** Authenticated employee + resolved role (from @cdps/core permission). */
export type Actor = permission.Actor;

export const SALES_DIVISION = 'Sales';
export const ACCOUNT_DIVISION = 'Account';

// ---------------------------------------------------------------------------
// Verbatim BI messages (M4 §4). Module-local per bi.ts scope note.
// ---------------------------------------------------------------------------

/** The actor's role may not edit this field (lock matrix §4). */
export const MSG_FIELD_ROLE_DENIED = '[anda tidak memiliki akses untuk mengubah field ini]';
/** The field is immutable / system-computed and cannot be edited here (§4). */
export const MSG_FIELD_LOCKED = '[field ini terkunci dan tidak dapat diubah]';
/**
 * The payment-intent handoff is past Sales' control — the scheme now belongs to
 * Finance (M5 §8.3). NOT a PRD-verbatim string: the PRD states the rule but no
 * message. Ported byte-for-byte from Go `module4_client.MsgIntentLocked`, which
 * was approved under the W1-09/W1-14 engineering-authored-BI precedent and is
 * logged in `docs/DECISIONS.md` (Decided 2026-07-10, W1-13) — so this is a port
 * of an approved string, not a new one.
 */
export const MSG_INTENT_LOCKED =
  '[transaksi sudah diverifikasi, perubahan skema pembayaran selanjutnya melalui Finance]';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Mandatory-field / bad-value gate failure (carries the exact global BI message). */
export class IncompleteError extends Error {
  constructor() {
    super(bi.INCOMPLETE_DATA);
    this.name = 'ClientIncompleteError';
  }
}

/** Requested client does not exist (→ 404). */
export class NotFoundError extends Error {
  constructor(message = 'client not found') {
    super(message);
    this.name = 'ClientNotFoundError';
  }
}

/**
 * The actor's role may not perform the requested edit/action (verbatim BI, →
 * 403). Defaults to the field-edit message; the Void-Service path passes the
 * generic transition-denied message instead (it is a state transition).
 */
export class ForbiddenError extends Error {
  constructor(message = MSG_FIELD_ROLE_DENIED) {
    super(message);
    this.name = 'ClientForbiddenError';
  }
}

/** The requested field is immutable / system-computed (verbatim BI, → 409). */
export class LockedFieldError extends Error {
  constructor() {
    super(MSG_FIELD_LOCKED);
    this.name = 'LockedFieldError';
  }
}

/**
 * A Service state transition was requested from a state that does not allow it —
 * e.g. Hold from a Service that is not [In Execution], or Resume from one that is
 * not [On Hold] (verbatim BI, → 409). Distinct from LockedFieldError so the
 * message names the real problem (a bad transition, not a locked field).
 */
export class ServiceStateError extends Error {
  constructor(message = bi.TRANSITION_NOT_ALLOWED) {
    super(message);
    this.name = 'ServiceStateError';
  }
}

/**
 * The payment-intent handoff has already passed out of Sales' control — Finance
 * recorded a verification, or the Transaction left `[Menunggu Verifikasi]`
 * (verbatim BI, → 409). Distinct from LockedFieldError: this one points the
 * caller at `finance.changeScheme` (M5-OA-6) rather than saying "immutable".
 */
export class IntentLockedError extends Error {
  constructor() {
    super(MSG_INTENT_LOCKED);
    this.name = 'IntentLockedError';
  }
}

// ---------------------------------------------------------------------------
// Lock-matrix authorization predicates (M4 §4).
// ---------------------------------------------------------------------------

/** Profile corrections: Account Lead, OD, or Director (M4-OA-4). */
export function canEditProfile(actor: Actor): boolean {
  return actor.role.director || actor.role.od ||
    (actor.role.division === ACCOUNT_DIVISION && actor.role.level === permission.LevelLead);
}

/** GMV baseline: OD or Director only (exceptional correction). */
export function canEditBaseline(actor: Actor): boolean {
  return actor.role.director || actor.role.od;
}

/** Target GMV / Marketing Budget: Account (any level) or Director (M4-OA-6). */
export function canEditAccountRevisable(actor: Actor): boolean {
  return actor.role.director || actor.role.division === ACCOUNT_DIVISION;
}

/** Sales / Commission PIC reassign: Sales Lead or Director. */
export function canReassignPic(actor: Actor): boolean {
  return actor.role.director ||
    (actor.role.division === SALES_DIVISION && actor.role.level === permission.LevelLead);
}

// ---------------------------------------------------------------------------
// Field registry — the lock matrix as data.
// ---------------------------------------------------------------------------

type FieldKind = 'text' | 'money' | 'employee';

interface FieldSpec {
  column: string;
  kind: FieldKind;
  authorize: (actor: Actor) => boolean;
}

/** The editable fields and their §4 matrix cell. Keys are the wire patch names. */
const FIELDS: Record<string, FieldSpec> = {
  namaPic: { column: 'nama_pic', kind: 'text', authorize: canEditProfile },
  toko: { column: 'toko', kind: 'text', authorize: canEditProfile },
  kota: { column: 'kota', kind: 'text', authorize: canEditProfile },
  linkToko: { column: 'link_toko', kind: 'text', authorize: canEditProfile },
  kategori: { column: 'kategori', kind: 'text', authorize: canEditProfile },
  gmvBaseline: { column: 'gmv_baseline', kind: 'money', authorize: canEditBaseline },
  targetGmv: { column: 'target_gmv', kind: 'money', authorize: canEditAccountRevisable },
  marketingBudget: { column: 'marketing_budget', kind: 'money', authorize: canEditAccountRevisable },
  salesPicId: { column: 'sales_pic_id', kind: 'employee', authorize: canReassignPic },
  commissionPaymentPicId: { column: 'commission_payment_pic_id', kind: 'employee', authorize: canReassignPic },
};

/** normalizeValue validates a patch value by kind and returns its stored form. */
function normalizeValue(kind: FieldKind, raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new IncompleteError();
  }
  const v = raw.trim();
  if (v === '') {
    throw new IncompleteError();
  }
  if (kind === 'money') {
    let amt: money.Money;
    try {
      amt = money.parse(v);
    } catch {
      throw new IncompleteError();
    }
    if (amt < 0n) {
      throw new IncompleteError();
    }
    return money.decimal(amt);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Edit (transactional).
// ---------------------------------------------------------------------------

/** A partial edit of a Client Record — only lock-matrix-editable fields. */
export interface ClientPatch {
  namaPic?: string;
  toko?: string;
  kota?: string;
  linkToko?: string;
  kategori?: string;
  gmvBaseline?: string;
  targetGmv?: string;
  marketingBudget?: string;
  salesPicId?: string;
  commissionPaymentPicId?: string;
}

/**
 * updateClient applies a lock-matrix-checked edit to a born Client Record (M4
 * §4). Every field in the patch is validated against the matrix BEFORE any write:
 * a field not in the registry is locked/system-computed (LockedFieldError); a
 * field the actor's role may not edit is denied (ForbiddenError); a bad value is
 * IncompleteError. The whole patch is atomic — a single rejected field rolls back
 * all of it — and each applied change appends a before→after audit row (house
 * rule #3). An empty patch is IncompleteError.
 */
export async function updateClient(sql: Sql, actor: Actor, clientId: string, patch: ClientPatch): Promise<void> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as [string, string][];
  if (entries.length === 0) {
    throw new IncompleteError();
  }

  // Validate + authorize every field first (atomic all-or-nothing, no writes yet).
  const planned: { key: string; spec: FieldSpec; stored: string }[] = [];
  for (const [key, raw] of entries) {
    const spec = FIELDS[key];
    if (!spec) {
      throw new LockedFieldError(); // unknown / immutable / system-computed field
    }
    if (!spec.authorize(actor)) {
      throw new ForbiddenError();
    }
    planned.push({ key, spec, stored: normalizeValue(spec.kind, raw) });
  }

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const rows = await tx<Record<string, string | null>[]>`
      select nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
             marketing_budget, sales_pic_id, commission_payment_pic_id
      from clients where id = ${clientId} for update`;
    if (rows.length === 0) {
      throw new NotFoundError();
    }
    const before = rows[0];

    for (const { key, spec, stored } of planned) {
      await tx`update clients set ${tx(spec.column)} = ${stored} where id = ${clientId}`;
      await ex.audit.insertAudit({
        entityType: 'client', entityId: clientId, actorEmployeeId: actor.employeeId,
        action: 'client_field_edited', beforeJson: { field: key, value: before[spec.column] },
        afterJson: { field: key, value: stored }, createdBy: actor.employeeId,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Platform List (M4 §3/§4) — the client's platforms are a Qualified-captured list
// correctable post-close by Account Lead / OD / Director (same §4 cell as the
// profile fields). Each platform is a client_platforms row (born at closing with
// the primary platform); this is add / correct / deactivate over that list.
// ---------------------------------------------------------------------------

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A new platform on the client's Platform List. */
export interface PlatformInput {
  platform: string;
  storeLink?: string;
  managedSince?: string; // YYYY-MM-DD
}

/** A correction to one platform (any subset; `active:false` deactivates it). */
export interface PlatformPatch {
  storeLink?: string;
  managedSince?: string; // YYYY-MM-DD
  active?: boolean;
}

function validDateOpt(s: string | undefined): void {
  if (s !== undefined && s.trim() !== '' && !RE_DATE.test(s.trim())) {
    throw new IncompleteError();
  }
}

/**
 * addPlatform appends a platform to a client's Platform List (M4 §3/§4). Account
 * Lead / OD / Director only. `platform` is mandatory; the row is born active and
 * the add is audited. Returns the new platform row id.
 */
export async function addPlatform(sql: Sql, actor: Actor, clientId: string, input: PlatformInput): Promise<number> {
  if (!canEditProfile(actor)) {
    throw new ForbiddenError();
  }
  const platform = (input.platform ?? '').trim();
  if (platform === '') {
    throw new IncompleteError();
  }
  validDateOpt(input.managedSince);

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const exists = await tx<{ id: string }[]>`select id from clients where id = ${clientId} for update`;
    if (exists.length === 0) {
      throw new NotFoundError();
    }
    const rows = await tx<{ id: string }[]>`
      insert into client_platforms (client_id, platform, store_link, managed_since, active, created_by)
      values (${clientId}, ${platform}, ${nullTrim(input.storeLink)}, ${nullTrim(input.managedSince)}, true, ${actor.employeeId})
      returning id`;
    // A bigint IDENTITY comes back from postgres.js as a string; the API wants a number.
    const id = Number(rows[0].id);
    await ex.audit.insertAudit({
      entityType: 'client', entityId: clientId, actorEmployeeId: actor.employeeId,
      action: 'platform_added', beforeJson: null,
      afterJson: { platform_id: id, platform, store_link: nullTrim(input.storeLink) }, createdBy: actor.employeeId,
    });
    return id;
  });
}

/**
 * updatePlatform corrects one platform on a client's list (M4 §4): store link,
 * managed-since, or the active flag (deactivation = removal from the list, never
 * a delete). Account Lead / OD / Director only; at least one field; audited
 * before→after. The platform must belong to the client.
 */
export async function updatePlatform(
  sql: Sql,
  actor: Actor,
  clientId: string,
  platformId: number,
  patch: PlatformPatch,
): Promise<void> {
  if (!canEditProfile(actor)) {
    throw new ForbiddenError();
  }
  const setsLink = patch.storeLink !== undefined;
  const setsSince = patch.managedSince !== undefined;
  const setsActive = patch.active !== undefined;
  if (!setsLink && !setsSince && !setsActive) {
    throw new IncompleteError();
  }
  validDateOpt(patch.managedSince);

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const rows = await tx<{ store_link: string | null; managed_since: Date | null; active: boolean }[]>`
      select store_link, managed_since, active
      from client_platforms where id = ${platformId} and client_id = ${clientId} for update`;
    if (rows.length === 0) {
      throw new NotFoundError('platform not found');
    }
    const before = rows[0];

    if (setsLink) {
      await tx`update client_platforms set store_link = ${nullTrim(patch.storeLink)} where id = ${platformId}`;
    }
    if (setsSince) {
      await tx`update client_platforms set managed_since = ${nullTrim(patch.managedSince)} where id = ${platformId}`;
    }
    if (setsActive) {
      await tx`update client_platforms set active = ${patch.active as boolean} where id = ${platformId}`;
    }
    await ex.audit.insertAudit({
      entityType: 'client', entityId: clientId, actorEmployeeId: actor.employeeId,
      action: 'platform_updated', beforeJson: { platform_id: platformId, ...before },
      afterJson: {
        platform_id: platformId,
        ...(setsLink ? { store_link: nullTrim(patch.storeLink) } : {}),
        ...(setsSince ? { managed_since: nullTrim(patch.managedSince) } : {}),
        ...(setsActive ? { active: patch.active } : {}),
      },
      createdBy: actor.employeeId,
    });
  });
}

/** nullTrim stores an empty/absent optional string as SQL NULL. */
function nullTrim(s: string | undefined): string | null {
  return s && s.trim() !== '' ? s.trim() : null;
}

/** editableFields lists the lock-matrix-editable field keys (for the API/UI). */
export function editableFields(): string[] {
  return Object.keys(FIELDS);
}

/** isEditableField reports whether a field key is editable via the lock matrix. */
export function isEditableField(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(FIELDS, key);
}

// ---------------------------------------------------------------------------
// Void Service + cascade (M4-OA-5 / STATE_MACHINES §6). A Sales-input error on
// the Service List is corrected NOT by a silent edit but by voiding the Service
// (SPV/Account Lead approval, logged) — which cascade-cancels its child Briefs
// that are not yet [Approved]. The Transaction Total Agreed Value stays immutable
// (house rule); the voided Service is excluded from commission achievement
// (finance.commissionAchievement) so no commission accrues for undelivered work.
// ---------------------------------------------------------------------------

/** Terminal Service statuses (a voided/done Service cannot be re-voided). */
export const SERVICE_VOIDED = '[Cancelled — Service Voided]';
export const SERVICE_DONE = 'Done';
/** A Brief already [Approved] is NOT cascade-cancelled (STATE_MACHINES §6). */
export const BRIEF_APPROVED = '[Approved]';

/** canVoidService: SPV/Account Lead or Director (M4-OA-5). */
export function canVoidService(actor: Actor): boolean {
  return actor.role.director ||
    (actor.role.division === ACCOUNT_DIVISION && actor.role.level === permission.LevelLead);
}

/**
 * The result of a void: the service, the child briefs that were cancelled, and
 * the ones deliberately LEFT ALONE because they are already [Approved].
 *
 * `skippedApprovedBriefs` is not bookkeeping — it is the answer to "what did this
 * void NOT undo", which is the one thing the person who just voided a Service
 * needs to see. Go reports it (`skipped_approved_briefs`) and the client renders
 * it; omitting it made the list render as `undefined`.
 */
export interface VoidResult {
  serviceId: string;
  voidedBriefs: string[];
  skippedApprovedBriefs: string[];
}

/**
 * voidService voids a Service (M4-OA-5) and cascade-cancels its child Briefs that
 * are not yet [Approved]. SPV/Account Lead or Director only, reason mandatory,
 * fully audited. The Service and each affected Brief move to [Cancelled — Service
 * Voided] through the engine (the division-specific Account-Lead gate is a code
 * guard here, stricter than the engine's division-agnostic requireLead). An
 * already voided/Done Service cannot be re-voided (LockedFieldError).
 */
export async function voidService(sql: Sql, actor: Actor, serviceId: string, reason: string): Promise<VoidResult> {
  if (!canVoidService(actor)) {
    throw new ForbiddenError(bi.TRANSITION_ROLE_DENIED);
  }
  const why = (reason ?? '').trim();
  if (why === '') {
    throw new IncompleteError();
  }

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const svc = await tx<{ id: string; status: string; client_id: string }[]>`
      select id, status, client_id from services where id = ${serviceId} for update`;
    if (svc.length === 0) {
      throw new NotFoundError('service not found');
    }
    if (svc[0].status === SERVICE_VOIDED || svc[0].status === SERVICE_DONE) {
      throw new LockedFieldError(); // already terminal — nothing to void
    }

    const sres = await statemachine.transition(ex.sm, {
      machine: 'service', entityType: 'service', table: 'services', entityId: serviceId, to: SERVICE_VOIDED, actor,
    });
    if (!sres.ok) {
      throw new LockedFieldError();
    }

    // Cascade: child Briefs not yet [Approved] (nor already voided) → cancelled.
    const briefs = await tx<{ id: string; status: string }[]>`
      select id, status from briefs where service_id = ${serviceId} for update`;
    const voidedBriefs: string[] = [];
    const skippedApprovedBriefs: string[] = [];
    for (const b of briefs) {
      if (b.status === BRIEF_APPROVED) {
        // Approved work is not undone by voiding the Service — it is reported back
        // so the actor can see what survived (Go's SkippedApproved).
        skippedApprovedBriefs.push(b.id);
        continue;
      }
      if (b.status === SERVICE_VOIDED) {
        continue; // already cancelled by an earlier pass
      }
      const bres = await statemachine.transition(ex.sm, {
        machine: 'brief_task', entityType: 'brief', table: 'briefs', entityId: b.id, to: SERVICE_VOIDED, actor,
      });
      if (!bres.ok) {
        throw new Error(`void cascade ${b.id} -> ${SERVICE_VOIDED} failed: ${bres.message}`);
      }
      voidedBriefs.push(b.id);
    }

    await ex.audit.insertAudit({
      entityType: 'service', entityId: serviceId, actorEmployeeId: actor.employeeId,
      action: 'service_voided', beforeJson: { status: svc[0].status },
      afterJson: {
        status: SERVICE_VOIDED, reason: why, voided_briefs: voidedBriefs,
        skipped_approved_briefs: skippedApprovedBriefs,
      },
      createdBy: actor.employeeId,
    });
    return { serviceId, voidedBriefs, skippedApprovedBriefs };
  });
}

// ---------------------------------------------------------------------------
// Hold Service (T-2 / RM-2). A running Service can be paused ("On Hold") when a
// client asks to suspend delivery. The whole point of the state is RM-2: a Client
// whose services are ALL On Hold is no longer "active", so the weekly-recap job
// (D-06, `wrr_monday_job`) stops opening recaps for it — the exclusion lives in
// that SQL job. A held Service does NOT cascade to its child Briefs/Assets/
// Campaigns: hold only suspends the recap/scoring obligation, it does not force
// terminal transitions on in-flight work (that would destroy real progress).
//
// Approval sits with the Head of Account (Account Lead / Director), mirroring the
// Void-Service gate (M4-OA-5): the engine edge is require_lead, and this
// division-specific gate is the stricter code guard on top. Reason is mandatory
// on hold (an audit trail for why delivery was suspended); resume needs none.
// ---------------------------------------------------------------------------

export const SERVICE_ON_HOLD = '[On Hold]';
export const SERVICE_IN_EXECUTION = '[In Execution]';

/** canHoldService: Head of Account (Account Lead) or Director (mirrors canVoidService). */
export function canHoldService(actor: Actor): boolean {
  return actor.role.director ||
    (actor.role.division === ACCOUNT_DIVISION && actor.role.level === permission.LevelLead);
}

/**
 * holdService moves a Service [In Execution] → [On Hold] (T-2). Head of Account /
 * Director only, reason mandatory, fully audited. No cascade to child entities.
 * A Service not [In Execution] is rejected (ServiceStateError → 409).
 */
export async function holdService(sql: Sql, actor: Actor, serviceId: string, reason: string): Promise<void> {
  if (!canHoldService(actor)) {
    throw new ForbiddenError(bi.TRANSITION_ROLE_DENIED);
  }
  const why = (reason ?? '').trim();
  if (why === '') {
    throw new IncompleteError();
  }
  await withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const svc = await tx<{ id: string; status: string }[]>`
      select id, status from services where id = ${serviceId} for update`;
    if (svc.length === 0) {
      throw new NotFoundError('service not found');
    }
    if (svc[0].status !== SERVICE_IN_EXECUTION) {
      throw new ServiceStateError(); // only a running Service can be held
    }
    const sres = await statemachine.transition(ex.sm, {
      machine: 'service', entityType: 'service', table: 'services', entityId: serviceId, to: SERVICE_ON_HOLD, actor,
    });
    if (!sres.ok) {
      throw new ServiceStateError();
    }
    await ex.audit.insertAudit({
      entityType: 'service', entityId: serviceId, actorEmployeeId: actor.employeeId,
      action: 'service_held', beforeJson: { status: svc[0].status },
      afterJson: { status: SERVICE_ON_HOLD, reason: why }, createdBy: actor.employeeId,
    });
  });
}

/**
 * resumeService moves a Service [On Hold] → [In Execution] (T-2). Same gate as
 * holdService. A Service not [On Hold] is rejected (ServiceStateError → 409).
 */
export async function resumeService(sql: Sql, actor: Actor, serviceId: string, reason: string): Promise<void> {
  if (!canHoldService(actor)) {
    throw new ForbiddenError(bi.TRANSITION_ROLE_DENIED);
  }
  const why = (reason ?? '').trim();
  await withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const svc = await tx<{ id: string; status: string }[]>`
      select id, status from services where id = ${serviceId} for update`;
    if (svc.length === 0) {
      throw new NotFoundError('service not found');
    }
    if (svc[0].status !== SERVICE_ON_HOLD) {
      throw new ServiceStateError(); // only a held Service can resume
    }
    const sres = await statemachine.transition(ex.sm, {
      machine: 'service', entityType: 'service', table: 'services', entityId: serviceId, to: SERVICE_IN_EXECUTION, actor,
    });
    if (!sres.ok) {
      throw new ServiceStateError();
    }
    await ex.audit.insertAudit({
      entityType: 'service', entityId: serviceId, actorEmployeeId: actor.employeeId,
      action: 'service_resumed', beforeJson: { status: svc[0].status },
      afterJson: { status: SERVICE_IN_EXECUTION, reason: why === '' ? null : why }, createdBy: actor.employeeId,
    });
  });
}

// ---------------------------------------------------------------------------
// Payment-intent handoff (M4 §5) — Sales → Admin & Finance.
//
// The Sales PIC's single client-level declaration that routes the Client Record
// into Finance's queue. A bridge, not a duplicate of M5: the scheme is stamped on
// BOTH `clients.payment_intent` (M4's own field) and the linked
// `transactions.payment_intent_scheme` (M5 §8.3 — "Set by Sales (Module 4 §5);
// changeable by Finance with logged reason") in ONE DB transaction, each with its
// own before→after audit row (house rule #3).
//
// Setting the intent does NOT confirm money received (§5 Rule 3) and does NOT
// release the client to Account — it only records which scheme Finance should
// expect to verify against. The Transaction is already in Finance's queue from
// the moment closing created it at `[Menunggu Verifikasi]` (M5 §3 Rule 1), so no
// routing write is needed here.
//
// No notification fires: M4 §5 Flow 2 says "system … notifies Finance", but the
// FROZEN notification catalog has no matching event and cannot be extended
// unilaterally. The deferral is the logged W1-13 decision (same precedent as
// W1-16's released-to-Account deferral) — nothing is functionally lost because
// the Transaction is already visible to Finance.
//
// Installment schedules for Termin / Bayar di Belakang are built through M5's
// `finance.createSchedule`; this module never creates installments.
//
// Port of backend/internal/module4_client/intent.go.
// ---------------------------------------------------------------------------

/**
 * Payment Intent options — verbatim M4 §5 Rule 2 (`[Bayar Penuh (Lunas)]` is the
 * UI default; the other three are equally valid). These alias the M5 scheme
 * constants — the exact same stored string seen from two modules — rather than
 * re-typing them, so the two can never silently drift (mirrors how Go aliases
 * `module5_finance.Scheme*`).
 */
export const INTENT_LUNAS = finance.SCHEME_LUNAS;
export const INTENT_SEBAGIAN = finance.SCHEME_SEBAGIAN;
export const INTENT_TERMIN = finance.SCHEME_TERMIN;
export const INTENT_DI_BELAKANG = finance.SCHEME_DI_BELAKANG;

const VALID_INTENTS = new Set<string>([INTENT_LUNAS, INTENT_SEBAGIAN, INTENT_TERMIN, INTENT_DI_BELAKANG]);

/**
 * §5 Flow 1 authority: the client's Primary Sales PIC (identity match) or a
 * Director. Deliberately NOT level-gated — a Sales Lead who is not this client's
 * PIC is denied exactly like any other non-owning salesperson, because §5 Flow 1
 * names "the Sales PIC" specifically and the §4 lock matrix treats "Sales PIC"
 * and "Sales Lead" as separate authorities. Members of the Sales Allocation are
 * likewise denied (they get read access, not the handoff). Decided 2026-07-10
 * (W1-13) in `docs/DECISIONS.md`.
 */
export function canSetPaymentIntent(actor: Actor, salesPicId: string): boolean {
  if (actor.role.director) {
    return true;
  }
  return actor.role.division === SALES_DIVISION && actor.employeeId === salesPicId;
}

/**
 * setPaymentIntent performs the M4 §5 handoff: the Primary Sales PIC (or a
 * Director) declares the payment scheme on the Client Record and its linked
 * Transaction.
 *
 * Blocked (IntentLockedError → 409) once Finance has recorded ANY verification or
 * the Transaction has moved off `[Menunggu Verifikasi]`: from that point the
 * scheme is Finance's, and `finance.changeScheme` (M5-OA-6) is the only path.
 * This module refuses rather than duplicating that logic.
 *
 * Both rows are locked FOR UPDATE before the checks so a concurrent Finance
 * verification cannot slip between the read and the write.
 */
export async function setPaymentIntent(
  sql: Sql,
  actor: Actor,
  clientId: string,
  intent: string,
): Promise<void> {
  if (!VALID_INTENTS.has(intent)) {
    throw new IncompleteError();
  }

  await withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const rows = await tx<{ sales_pic_id: string | null; transaction_id: string | null; payment_intent: string | null }[]>`
      select sales_pic_id, transaction_id, payment_intent
        from clients where id = ${clientId} for update`;
    if (rows.length === 0) {
      throw new NotFoundError();
    }
    const { sales_pic_id: salesPicId, transaction_id: transactionId, payment_intent: beforeIntent } = rows[0];

    if (!canSetPaymentIntent(actor, salesPicId ?? '')) {
      throw new ForbiddenError(bi.TRANSITION_ROLE_DENIED);
    }
    if (transactionId === null || transactionId === '') {
      // Every client is born with a linked Transaction at closing (M4 §2), so
      // this guards a malformed/legacy row — not a reachable user path.
      throw new NotFoundError('client has no linked transaction');
    }

    const trxRows = await tx<{ payment_status: string; payment_intent_scheme: string }[]>`
      select payment_status, payment_intent_scheme
        from transactions where id = ${transactionId} for update`;
    if (trxRows.length === 0) {
      throw new NotFoundError('transaction not found');
    }
    const { payment_status: trxStatus, payment_intent_scheme: beforeScheme } = trxRows[0];
    if (trxStatus !== finance.PAYMENT_MENUNGGU) {
      throw new IntentLockedError();
    }

    const ver = await tx<{ n: string }[]>`
      select count(*)::text as n from payment_verifications where transaction_id = ${transactionId}`;
    if (ver[0].n !== '0') {
      throw new IntentLockedError();
    }

    await tx`update clients set payment_intent = ${intent} where id = ${clientId}`;
    await tx`update transactions set payment_intent_scheme = ${intent} where id = ${transactionId}`;

    await ex.audit.insertAudit({
      entityType: 'client', entityId: clientId, actorEmployeeId: actor.employeeId,
      action: 'payment_intent:set',
      beforeJson: { payment_intent: beforeIntent ?? '' },
      afterJson: { payment_intent: intent },
      createdBy: actor.employeeId,
    });
    await ex.audit.insertAudit({
      entityType: 'transaction', entityId: transactionId, actorEmployeeId: actor.employeeId,
      action: 'payment_intent_scheme:set',
      beforeJson: { payment_intent_scheme: beforeScheme },
      afterJson: { payment_intent_scheme: intent },
      createdBy: actor.employeeId,
    });
  });
}

// ---------------------------------------------------------------------------
// Visibility read (M4 §6). Row scope is enforced by RLS (own / allocation /
// division / OD / Director), as with the other reads — the domain shapes rows.
// ---------------------------------------------------------------------------

/** One row in the client roster (M4 §6). */
export interface ClientListRow {
  id: string;
  toko: string;
  namaPic: string;
  kota: string;
  kategori: string;
  salesPicId: string;
  salesPicNama: string;
  assignedAmId: string | null;
  paymentIntent: string | null;
  releasedToAccountAt: Date | null;
  createdAt: Date;
}

/** listClients returns the client roster (RLS-scoped per §6), newest first. */
export async function listClients(sql: Queryable): Promise<ClientListRow[]> {
  const rows = await sql<
    {
      id: string; toko: string; nama_pic: string; kota: string; kategori: string;
      sales_pic_id: string; sales_pic_nama: string; assigned_am_id: string | null;
      payment_intent: string | null; released_to_account_at: Date | null; created_at: Date;
    }[]
  >`
    select c.id, c.toko, c.nama_pic, c.kota, c.kategori, c.sales_pic_id,
           coalesce(e.nama, c.sales_pic_id) as sales_pic_nama, c.assigned_am_id,
           c.payment_intent, c.released_to_account_at, c.created_at
    from clients c
    left join employees e on e.employee_id = c.sales_pic_id
    order by c.created_at desc, c.id desc`;
  return rows.map((r) => ({
    id: r.id, toko: r.toko, namaPic: r.nama_pic, kota: r.kota, kategori: r.kategori,
    salesPicId: r.sales_pic_id, salesPicNama: r.sales_pic_nama, assignedAmId: r.assigned_am_id,
    paymentIntent: r.payment_intent, releasedToAccountAt: r.released_to_account_at, createdAt: r.created_at,
  }));
}

// Re-export a shared read (M4 basic Client Record) from the sales read model, so
// M4 callers have one import surface. The detail shape lives in `sales.getClient`.
export { getClient } from './sales';
export type { ClientDetail } from './sales';
