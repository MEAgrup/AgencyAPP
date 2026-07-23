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
 * Deferred to their own clusters: Platform List editing (child table), Void
 * Service + cascade (M4-OA-5, needs the Wave-2 Brief machine), the payment-intent
 * handoff write (§5 — Sales sets Payment Intent; the M5 verify path already reads
 * it), and the visibility read model (§6 — RLS-enforced).
 *
 * Reference: backend/internal/module4_client/{edit,locks,reads}.go.
 */

import { bi, money, permission } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';

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

/** The actor's role may not edit the requested field (verbatim BI, → 403). */
export class ForbiddenError extends Error {
  constructor() {
    super(MSG_FIELD_ROLE_DENIED);
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

/** editableFields lists the lock-matrix-editable field keys (for the API/UI). */
export function editableFields(): string[] {
  return Object.keys(FIELDS);
}

/** isEditableField reports whether a field key is editable via the lock matrix. */
export function isEditableField(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(FIELDS, key);
}

// Re-export a shared read (M4 basic Client Record) from the sales read model, so
// M4 callers have one import surface. The detail shape lives in `sales.getClient`.
export { getClient } from './sales.js';
export type { ClientDetail } from './sales.js';
