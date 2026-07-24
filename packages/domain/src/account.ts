/**
 * Account & Service domain service (M6). Ported from Go's
 * `internal/module6_account/*`. One module namespace, per the TS-port convention
 * (finance.ts / sales.ts cover a whole module in one file).
 *
 * Cluster 1 — Client intake & AM assignment (§3): once Finance's routing gate
 * releases a paid client to Account (M5 §5, released_to_account_at IS NOT NULL),
 * the client enters the Unassigned Intake Queue until SPV/Head Account manually
 * assigns an Account Manager (§3 Rule 2 — not round-robin, not self-claim).
 * Exactly one AM owns the whole client relationship (M6-OA-6); reassignment
 * (§3 Rule 3) is the only way to change it and requires a logged reason.
 *
 * Cluster 2 — Strategy & Plan (§2/§4): the plan-gated execution path. A
 * Strategy & Plan (STR-) is drafted by the owning AM for each Service whose
 * effective `requires_strategy_plan` flag is Yes (1:1), runs the STR- machine
 * ([Strategy Drafting] → [Strategy Submitted for Approval] → [Strategy
 * Approved]), and on approval drives the parent Service [Awaiting Onboarding] →
 * [Strategy Approved] in the SAME transaction — unlocking Brief creation.
 *
 * House rules honoured here (mirroring the Go source):
 *   - assignment is a RELATIONSHIP (a current-AM pointer on the Client Record),
 *     not a lifecycle status, so it is written by a plain guarded UPDATE, never
 *     the state-machine engine (there is no "assignment" status machine);
 *   - a status field is only ever written through the transition engine (never a
 *     raw UPDATE); the STR- ID is minted only after mandatory-field validation;
 *   - revision count is DERIVED from the immutable audit log, never stored;
 *   - every assignment / edit / transition appends an immutable before→after
 *     audit row (house rule #3); history lives in the audit log;
 *   - the read/write authority split mirrors M4 §6 / the global role matrix.
 *
 * Deferred to later clusters (same file): Briefs (§5/§6), Brief review, and
 * Complaints (§8).
 *
 * Reference: backend/internal/module6_account/{account,strategy}.go.
 */

import { bi, permission, statemachine } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';

/** Authenticated employee + resolved role (from @cdps/core permission). */
export type Actor = permission.Actor;

/** The CDPS division that owns intake & AM assignment. */
export const ACCOUNT_DIVISION = 'Account';

// ---------------------------------------------------------------------------
// Verbatim BI messages (M6 §3). Each mirrors a Go sentinel error 1:1; the
// strings follow the W1-09 precedent (logged in DECISIONS.md).
// ---------------------------------------------------------------------------

/** Actor may not read the Account intake queue / workload (not SPV/Head Account, OD or Director). */
export const MSG_INTAKE_FORBIDDEN = '[anda tidak memiliki akses ke antrean intake Account]';
/** Actor may not assign/reassign an AM (only SPV/Head Account or Director; §3 Rule 2). */
export const MSG_ASSIGN_FORBIDDEN = '[anda tidak memiliki akses untuk menugaskan Account Manager]';
/** Client does not exist OR is not yet released to Account (M5 §5 Rule 2 → invisible). */
export const MSG_NOT_FOUND = '[klien tidak ditemukan]';
/** AssignAM on a client that already has an AM — use reassignment (§3 Rule 3). */
export const MSG_ALREADY_ASSIGNED = '[klien sudah memiliki Account Manager, gunakan reassignment]';
/** ReassignAM on a client that has no AM yet — assign first. */
export const MSG_NOT_ASSIGNED = '[klien belum memiliki Account Manager]';
/** The chosen assignee is not an active Account-division staff. */
export const MSG_INVALID_AM = '[Account Manager tidak valid: harus staff divisi Account yang aktif]';
/** Reassignment target equals the current AM (no-op rejected). */
export const MSG_SAME_AM = '[Account Manager tujuan sama dengan yang sekarang]';
/** Reassignment reason is mandatory (§3 Rule 3, logged). */
export const MSG_REASON_REQUIRED = '[alasan reassignment wajib diisi]';

// ---------------------------------------------------------------------------
// Errors — each carries the verbatim BI message. Status mapping follows the
// Fase 1 REST-conventional normalization (see apps/api http.ts): validation →
// 400, forbidden → 403, not-found → 404, lifecycle conflict → 409.
// ---------------------------------------------------------------------------

/** Bad/missing input on an assign/reassign call (→ 400): invalid AM, missing reason. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountValidationError';
  }
}

/** The actor's role may not perform the requested read/action (verbatim BI, → 403). */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountForbiddenError';
  }
}

/** The client does not exist or is not yet released to Account (verbatim BI, → 404). */
export class NotFoundError extends Error {
  constructor(message = MSG_NOT_FOUND) {
    super(message);
    this.name = 'AccountNotFoundError';
  }
}

/** The assignment state forbids the action (already/not assigned, same AM) (→ 409). */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountConflictError';
  }
}

// ---------------------------------------------------------------------------
// Authorization predicates (M6 §3).
// ---------------------------------------------------------------------------

/**
 * canManageAssignment is the §3 Rule 2 write gate: SPV/Head Account (Account
 * lead) or Director. OD (read-only) and any staff/AM are denied.
 */
export function canManageAssignment(a: Actor): boolean {
  return permission.isLead(a, ACCOUNT_DIVISION);
}

/**
 * canReadIntake is the §3 Rule 1 read gate: SPV/Head Account, plus OD/Director
 * (read-everywhere). Individual AMs (Account staff) and other divisions cannot
 * see the unassigned queue.
 */
export function canReadIntake(a: Actor): boolean {
  return permission.canReadDivision(a, ACCOUNT_DIVISION);
}

// ---------------------------------------------------------------------------
// Read models (§3 Rule 1 / Rule 5).
// ---------------------------------------------------------------------------

/**
 * IntakeClient is one row of the Unassigned Intake Queue (§3 Rule 1) — the slim
 * projection SPV needs to pick an AM (client profile + when it was released).
 */
export interface IntakeClient {
  clientId: string;
  namaPic: string;
  toko: string;
  kota: string;
  kategori: string;
  serviceCount: number;
  releasedToAccountAt: Date | null;
}

/**
 * AMWorkload is one AM's active-client count for the SPV dashboard (§3 Rule 5).
 * It is a soft signal only — no hard capacity cap (M6-OA-2).
 */
export interface AMWorkload {
  amEmployeeId: string;
  activeClientCount: number;
}

/** Assignment reports the outcome of an assign / reassign action. */
export interface Assignment {
  clientId: string;
  previousAm?: string;
  assignedAm: string;
  assignedBy: string;
  reason?: string;
}

/**
 * intakeQueue returns every released-but-unassigned client (§3 Rule 1), oldest
 * release first so the longest-waiting client surfaces at the top. Read gate:
 * SPV/Head Account or OD/Director.
 */
export async function intakeQueue(sql: Queryable, actor: Actor): Promise<IntakeClient[]> {
  if (!canReadIntake(actor)) {
    throw new ForbiddenError(MSG_INTAKE_FORBIDDEN);
  }
  const rows = await sql<
    {
      id: string; nama_pic: string; toko: string; kota: string; kategori: string;
      service_count: string; released_to_account_at: Date | null;
    }[]
  >`
    select c.id, c.nama_pic, c.toko, c.kota, c.kategori,
           (select count(*) from services s where s.client_id = c.id) as service_count,
           c.released_to_account_at
      from clients c
     where c.released_to_account_at is not null
       and c.assigned_am_id is null
       and c.dormant_at is null
     order by c.released_to_account_at asc, c.id asc`;
  return rows.map((r) => ({
    clientId: r.id, namaPic: r.nama_pic, toko: r.toko, kota: r.kota, kategori: r.kategori,
    serviceCount: Number(r.service_count), releasedToAccountAt: r.released_to_account_at,
  }));
}

/**
 * workload returns each AM's active-client count (§3 Rule 5), highest first.
 * "Active" = a released, non-dormant client currently owned by that AM. Read
 * gate: SPV/Head Account or OD/Director.
 */
export async function workload(sql: Queryable, actor: Actor): Promise<AMWorkload[]> {
  if (!canReadIntake(actor)) {
    throw new ForbiddenError(MSG_INTAKE_FORBIDDEN);
  }
  const rows = await sql<{ assigned_am_id: string; active_count: string }[]>`
    select assigned_am_id, count(*) as active_count
      from clients
     where assigned_am_id is not null
       and released_to_account_at is not null
       and dormant_at is null
     group by assigned_am_id
     order by active_count desc, assigned_am_id asc`;
  return rows.map((r) => ({ amEmployeeId: r.assigned_am_id, activeClientCount: Number(r.active_count) }));
}

// ---------------------------------------------------------------------------
// Assign / reassign (transactional; §3 Rules 2–4).
// ---------------------------------------------------------------------------

/** The row read under lock by the assignment gates. */
interface LockedClient {
  released: boolean;
  current: string | null;
}

/**
 * lockClientForAssignment takes the row lock and reads the two fields the
 * assignment gates need: whether the client is released to Account, and its
 * current AM pointer. A missing client is reported as not-found.
 */
async function lockClientForAssignment(tx: Queryable, clientId: string): Promise<LockedClient> {
  const rows = await tx<{ released_to_account_at: Date | null; assigned_am_id: string | null }[]>`
    select released_to_account_at, assigned_am_id from clients where id = ${clientId} for update`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  return { released: rows[0].released_to_account_at !== null, current: rows[0].assigned_am_id };
}

/**
 * validateAMCandidate enforces that the chosen assignee is an ACTIVE employee
 * whose resolved CDPS division is Account and whose level is staff (§3 Rule 2 —
 * an AM is Account staff; Lead/SPV are the assigners, not candidates). It
 * mirrors the divisi+jabatan → division join used by auth.ResolveActor.
 */
async function validateAMCandidate(tx: Queryable, amId: string): Promise<void> {
  const rows = await tx<{ status_aktif: number | boolean; division: string | null; level: string | null }[]>`
    select e.status_aktif, rm.division, rm.level
      from employees e
      left join role_mappings rm on rm.divisi = e.divisi and rm.jabatan = e.jabatan
     where e.employee_id = ${amId}`;
  if (rows.length === 0) {
    throw new ValidationError(MSG_INVALID_AM);
  }
  const r = rows[0];
  const active = r.status_aktif === true || r.status_aktif === 1;
  if (!active || r.division !== ACCOUNT_DIVISION || r.level !== permission.LevelStaff) {
    throw new ValidationError(MSG_INVALID_AM);
  }
}

/**
 * assignAM assigns an AM to a released, currently-unassigned client (§3 Rules
 * 2–4). One AM owns the entire client relationship (M6-OA-6). The pointer write
 * and its immutable audit row commit together.
 */
export async function assignAM(sql: Sql, actor: Actor, clientId: string, amId: string): Promise<Assignment> {
  if (!canManageAssignment(actor)) {
    throw new ForbiddenError(MSG_ASSIGN_FORBIDDEN);
  }
  const am = (amId ?? '').trim();
  if (am === '') {
    throw new ValidationError(MSG_INVALID_AM);
  }

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const { released, current } = await lockClientForAssignment(tx, clientId);
    if (!released) {
      throw new NotFoundError();
    }
    if (current !== null) {
      throw new ConflictError(MSG_ALREADY_ASSIGNED);
    }
    await validateAMCandidate(tx, am);

    await tx`update clients set assigned_am_id = ${am} where id = ${clientId}`;
    await ex.audit.insertAudit({
      entityType: 'client', entityId: clientId, actorEmployeeId: actor.employeeId, action: 'am_assigned',
      beforeJson: { assigned_am_id: null },
      afterJson: { assigned_am_id: am, assigned_by: actor.employeeId },
      createdBy: actor.employeeId,
    });
    return { clientId, assignedAm: am, assignedBy: actor.employeeId };
  });
}

/**
 * reassignAM moves a client from its current AM to a new one (§3 Rule 3,
 * M6-OA-6 coverage mechanism). Reason is mandatory and logged. The target must
 * be a valid, active Account AM and differ from the current owner.
 */
export async function reassignAM(
  sql: Sql,
  actor: Actor,
  clientId: string,
  newAmId: string,
  reason: string,
): Promise<Assignment> {
  if (!canManageAssignment(actor)) {
    throw new ForbiddenError(MSG_ASSIGN_FORBIDDEN);
  }
  const newAm = (newAmId ?? '').trim();
  if (newAm === '') {
    throw new ValidationError(MSG_INVALID_AM);
  }
  const why = (reason ?? '').trim();
  if (why === '') {
    throw new ValidationError(MSG_REASON_REQUIRED);
  }

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const { released, current } = await lockClientForAssignment(tx, clientId);
    if (!released) {
      throw new NotFoundError();
    }
    if (current === null) {
      throw new ConflictError(MSG_NOT_ASSIGNED);
    }
    if (current === newAm) {
      throw new ConflictError(MSG_SAME_AM);
    }
    await validateAMCandidate(tx, newAm);

    await tx`update clients set assigned_am_id = ${newAm} where id = ${clientId}`;
    await ex.audit.insertAudit({
      entityType: 'client', entityId: clientId, actorEmployeeId: actor.employeeId, action: 'am_reassigned',
      beforeJson: { assigned_am_id: current },
      afterJson: { assigned_am_id: newAm, assigned_by: actor.employeeId, reason: why },
      createdBy: actor.employeeId,
    });
    return { clientId, previousAm: current, assignedAm: newAm, assignedBy: actor.employeeId, reason: why };
  });
}

// ===========================================================================
// Cluster 2 — Strategy & Plan (§2 / §4), the plan-gated execution path.
// Ported from backend/internal/module6_account/strategy.go.
// ===========================================================================

/** STR- machine states (STATE_MACHINES §6a) and the parent-Service targets. */
export const STRATEGY_STATUS_DRAFTING = '[Strategy Drafting]';
export const STRATEGY_STATUS_SUBMITTED = '[Strategy Submitted for Approval]';
export const STRATEGY_STATUS_APPROVED = '[Strategy Approved]';

const SERVICE_STATUS_AWAITING_ONBOARDING = '[Awaiting Onboarding]';
const SERVICE_STATUS_STRATEGY_APPROVED = '[Strategy Approved]';

/** State-machine names (mirror the SQL seed / Go config.go). */
const MACHINE_STRATEGY_PLAN = 'strategy_plan';
const MACHINE_SERVICE = 'service';

/**
 * The M6 §4 "Divisions Involved" multi-select set, in canonical order (used both
 * to validate input and to store it deterministically as a ", "-joined string).
 */
export const ALLOWED_DIVISIONS = ['Creative', 'Ads', 'KOL', 'Live Stream'] as const;

// --- Verbatim BI messages (M6 §2/§4). Each mirrors a Go sentinel 1:1. ---

/** The referenced Service does not exist. */
export const MSG_SERVICE_NOT_FOUND = '[layanan tidak ditemukan]';
/** The referenced Strategy & Plan does not exist. */
export const MSG_STRATEGY_NOT_FOUND = '[Strategy & Plan tidak ditemukan]';
/** Actor is not the AM who owns this Service's client (§4 Rule 1). */
export const MSG_NOT_OWNER_AM =
  '[hanya Account Manager pemilik klien yang dapat mengelola Strategy & Plan layanan ini]';
/** Service's effective plan flag is No — no Strategy exists (§4 Rule 6). */
export const MSG_NOT_PLAN_GATED = '[layanan ini tidak memerlukan Strategy & Plan]';
/** A Strategy can only be drafted for an Awaiting-Onboarding Service. */
export const MSG_SERVICE_NOT_AWAITING =
  '[Strategy & Plan hanya dapat dibuat saat layanan berstatus Awaiting Onboarding]';
/** A Strategy already exists for this Service (1:1, §4 Rule 1). */
export const MSG_STRATEGY_EXISTS = '[Strategy & Plan untuk layanan ini sudah ada]';
/** Draft edits allowed only in [Strategy Drafting]. */
export const MSG_NOT_DRAFT = '[Strategy & Plan hanya dapat diubah saat berstatus Strategy Drafting]';
/** Actor may not approve / request revision (not Account lead / Director). */
export const MSG_APPROVE_FORBIDDEN =
  '[anda tidak memiliki akses untuk menyetujui atau meminta revisi Strategy & Plan]';
/** Revision notes are mandatory when requesting a revision (§4 Rule 4). */
export const MSG_REVISION_NOTES_REQUIRED = '[catatan revisi wajib diisi]';
/** Divisions Involved contains a value outside the allowed set. */
export const MSG_INVALID_DIVISIONS = '[divisi yang terlibat tidak valid]';
/** Actor may not read this Strategy & Plan (not owner AM / Account lead / OD / Director). */
export const MSG_STRATEGY_FORBIDDEN = '[anda tidak memiliki akses ke Strategy & Plan ini]';
/** A plan-gated Service must reach [Strategy Approved] before any Brief (§6 guard). */
export const MSG_STRATEGY_REQUIRED =
  '[layanan ini wajib memiliki Strategy & Plan yang disetujui sebelum dibuatkan Brief]';
/** Actor may not override this Service's plan-flag (M6-OA-1). */
export const MSG_OVERRIDE_FORBIDDEN =
  '[anda tidak memiliki akses untuk mengubah kebutuhan Strategy & Plan layanan ini]';
/** The override reason is mandatory (M6-OA-1 "logged reason"). */
export const MSG_OVERRIDE_REASON_REQUIRED = '[alasan perubahan kebutuhan Strategy & Plan wajib diisi]';
/** The plan-flag may only be overridden while the Service is [Awaiting Onboarding]. */
export const MSG_OVERRIDE_NOT_AWAITING =
  '[kebutuhan Strategy & Plan hanya dapat diubah saat layanan berstatus Awaiting Onboarding]';

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

// --- Types ---

/** The mandatory Strategy & Plan content fields (M6 §9.3). */
export interface StrategyInput {
  objective: string;
  targetKpi: string;
  divisionsInvolved: string[];
  plannedBriefOutline: string;
  timelineStart: string; // YYYY-MM-DD
  timelineEnd: string; // YYYY-MM-DD
}

/** A Strategy & Plan record. */
export interface Strategy {
  id: string;
  serviceId: string;
  objective: string;
  targetKpi: string;
  divisionsInvolved: string[];
  plannedBriefOutline: string;
  timelineStart: string;
  timelineEnd: string;
  status: string;
  approvedBy: string;
  revisionNotes: string;
  revisionCount: number;
  createdBy: string;
  createdAt: Date;
}

/**
 * The outcome of a per-engagement plan-flag override (M6-OA-1). Both the
 * effective value and the underlying pin are returned so the caller can show
 * whether/how the catalog default was overridden.
 */
export interface StrategyRequirement {
  serviceId: string;
  requiresStrategyPlan: boolean; // effective value after override
  pinnedRequirement: boolean; // the immutable MSL pin
  overridden: boolean; // true once an explicit override is set
  setBy: string;
  reason: string;
}

// --- Authorization ---

/**
 * canApproveStrategy is the §4 Rule 4 gate: Account lead (SPV/Head Account) or
 * Director (isLead grants Directors lead authority everywhere).
 */
export function canApproveStrategy(a: Actor): boolean {
  return permission.isLead(a, ACCOUNT_DIVISION);
}

// --- Input validation ---

/**
 * normalizeAndValidate checks mandatory fields, validates the timeline as a
 * valid date range (start <= end), and canonicalizes Divisions Involved against
 * ALLOWED_DIVISIONS (dedup, canonical order). Returns the ", "-joined string.
 * Throws ValidationError (incomplete) or ValidationError (invalid divisions).
 */
function normalizeAndValidate(input: StrategyInput): string {
  const objective = (input.objective ?? '').trim();
  const targetKpi = (input.targetKpi ?? '').trim();
  const outline = (input.plannedBriefOutline ?? '').trim();
  const start = (input.timelineStart ?? '').trim();
  const end = (input.timelineEnd ?? '').trim();
  if (
    objective === '' || targetKpi === '' || outline === '' || start === '' || end === '' ||
    (input.divisionsInvolved ?? []).length === 0
  ) {
    throw new ValidationError(bi.INCOMPLETE_DATA);
  }
  // Timeline must be valid dates with start <= end (§9.3).
  if (!RE_DATE.test(start) || !RE_DATE.test(end)) {
    throw new ValidationError(bi.INCOMPLETE_DATA);
  }
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    throw new ValidationError(bi.INCOMPLETE_DATA);
  }
  // Validate + canonicalize the multi-select against the allowed set.
  const want = new Set<string>();
  for (const raw of input.divisionsInvolved) {
    const d = (raw ?? '').trim();
    if (d === '' || !ALLOWED_DIVISIONS.includes(d as (typeof ALLOWED_DIVISIONS)[number])) {
      throw new ValidationError(MSG_INVALID_DIVISIONS);
    }
    want.add(d);
  }
  return ALLOWED_DIVISIONS.filter((d) => want.has(d)).join(', ');
}

/** splitDivisions parses a stored ", "-joined divisions string back to a list. */
function splitDivisions(s: string): string[] {
  if ((s ?? '').trim() === '') {
    return [];
  }
  return s.split(', ').filter((p) => p !== '');
}

/** effectiveRequiresPlan resolves the execution gate: override (M6-OA-1) if set, else the pin. */
function effectiveRequiresPlan(pin: boolean, override: boolean | null): boolean {
  return override === null ? pin : override;
}

/** dateStr normalizes a postgres `date` value (string or Date) to YYYY-MM-DD. */
function dateStr(v: string | Date): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

// --- Create / edit draft ---

/**
 * createStrategy drafts a Strategy & Plan for a plan-gated Service (§4 Rules 1,
 * 6). Only the owning AM (or Director), only while the Service is [Awaiting
 * Onboarding], only once (1:1). The STR- ID is minted after validation passes.
 */
export async function createStrategy(
  sql: Sql,
  actor: Actor,
  serviceId: string,
  input: StrategyInput,
): Promise<Strategy> {
  const divisions = normalizeAndValidate(input);
  const now = new Date();

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const rows = await tx<
      { status: string; requires_strategy_plan: boolean; requires_strategy_plan_override: boolean | null; assigned_am_id: string | null }[]
    >`
      select sv.status, sv.requires_strategy_plan, sv.requires_strategy_plan_override, c.assigned_am_id
        from services sv join clients c on c.id = sv.client_id
       where sv.id = ${serviceId} for update`;
    if (rows.length === 0) {
      throw new NotFoundError(MSG_SERVICE_NOT_FOUND);
    }
    const svc = rows[0];
    // Owner AM only — except Director (full access, precedent W1-13).
    if (!actor.role.director && svc.assigned_am_id !== actor.employeeId) {
      throw new ForbiddenError(MSG_NOT_OWNER_AM);
    }
    if (!effectiveRequiresPlan(svc.requires_strategy_plan, svc.requires_strategy_plan_override)) {
      throw new ConflictError(MSG_NOT_PLAN_GATED);
    }
    if (svc.status !== SERVICE_STATUS_AWAITING_ONBOARDING) {
      throw new ConflictError(MSG_SERVICE_NOT_AWAITING);
    }
    const existing = await tx<{ id: string }[]>`select id from strategy_plans where service_id = ${serviceId}`;
    if (existing.length > 0) {
      throw new ConflictError(MSG_STRATEGY_EXISTS);
    }

    const id = await ex.ident.identNext('STR', now);
    await tx`
      insert into strategy_plans
        (id, service_id, objective, target_kpi, divisions_involved, planned_brief_outline,
         timeline_start, timeline_end, status, created_by)
      values (${id}, ${serviceId}, ${input.objective.trim()}, ${input.targetKpi.trim()}, ${divisions},
        ${input.plannedBriefOutline.trim()}, ${input.timelineStart.trim()}, ${input.timelineEnd.trim()},
        ${STRATEGY_STATUS_DRAFTING}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: 'strategy_plan', entityId: id, actorEmployeeId: actor.employeeId, action: 'create',
      beforeJson: null, afterJson: { status: STRATEGY_STATUS_DRAFTING, service_id: serviceId },
      createdBy: actor.employeeId,
    });
    return {
      id, serviceId, objective: input.objective.trim(), targetKpi: input.targetKpi.trim(),
      divisionsInvolved: splitDivisions(divisions), plannedBriefOutline: input.plannedBriefOutline.trim(),
      timelineStart: input.timelineStart.trim(), timelineEnd: input.timelineEnd.trim(),
      status: STRATEGY_STATUS_DRAFTING, approvedBy: '', revisionNotes: '', revisionCount: 0,
      createdBy: actor.employeeId, createdAt: now,
    };
  });
}

/**
 * updateDraft edits a Strategy's content while it is still in draft. Only the
 * owning AM (or Director), only in [Strategy Drafting].
 */
export async function updateDraft(sql: Sql, actor: Actor, strategyId: string, input: StrategyInput): Promise<void> {
  const divisions = normalizeAndValidate(input);
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const locked = await lockStrategy(tx, strategyId);
    if (!actor.role.director && locked.ownerAm !== actor.employeeId) {
      throw new ForbiddenError(MSG_NOT_OWNER_AM);
    }
    if (locked.status !== STRATEGY_STATUS_DRAFTING) {
      throw new ConflictError(MSG_NOT_DRAFT);
    }
    await tx`
      update strategy_plans set objective=${input.objective.trim()}, target_kpi=${input.targetKpi.trim()},
        divisions_involved=${divisions}, planned_brief_outline=${input.plannedBriefOutline.trim()},
        timeline_start=${input.timelineStart.trim()}, timeline_end=${input.timelineEnd.trim()}
       where id=${strategyId}`;
    await ex.audit.insertAudit({
      entityType: 'strategy_plan', entityId: strategyId, actorEmployeeId: actor.employeeId, action: 'update_draft',
      beforeJson: null, afterJson: { objective: input.objective.trim(), divisions_involved: divisions },
      createdBy: actor.employeeId,
    });
  });
}

// --- Lifecycle transitions ---

/**
 * submitStrategy moves the Plan [Strategy Drafting] → [Strategy Submitted for
 * Approval] (§4 Rule 3). Owning AM (or Director). Driven through the engine; the
 * returned TransitionResult renders via the shared transitionResponse (an
 * invalid edge → 409, nothing written).
 */
export async function submitStrategy(
  sql: Sql,
  actor: Actor,
  strategyId: string,
): Promise<statemachine.TransitionResult> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const locked = await lockStrategy(tx, strategyId);
    if (!actor.role.director && locked.ownerAm !== actor.employeeId) {
      throw new ForbiddenError(MSG_NOT_OWNER_AM);
    }
    return statemachine.transition(ex.sm, {
      machine: MACHINE_STRATEGY_PLAN, entityType: 'strategy_plan', table: 'strategy_plans',
      entityId: strategyId, to: STRATEGY_STATUS_SUBMITTED, actor,
    });
  });
}

/**
 * approveStrategy approves a submitted Plan (§4 Rule 4). Account lead / Director
 * only. On approval the STR- transitions to [Strategy Approved] AND the parent
 * Service is driven [Awaiting Onboarding] → [Strategy Approved] in the SAME
 * transaction (§4 Rule 3); Approved By is recorded. An invalid edge (e.g. the
 * Plan is still Drafting) rolls back everything (ConflictError, nothing moves).
 */
export async function approveStrategy(sql: Sql, actor: Actor, strategyId: string): Promise<void> {
  if (!canApproveStrategy(actor)) {
    throw new ForbiddenError(MSG_APPROVE_FORBIDDEN);
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const locked = await lockStrategy(tx, strategyId);
    // 1) STR- [Strategy Submitted for Approval] → [Strategy Approved].
    const sres = await statemachine.transition(ex.sm, {
      machine: MACHINE_STRATEGY_PLAN, entityType: 'strategy_plan', table: 'strategy_plans',
      entityId: strategyId, to: STRATEGY_STATUS_APPROVED, actor,
    });
    if (!sres.ok) {
      throw transitionError(sres);
    }
    // 2) Parent Service [Awaiting Onboarding] → [Strategy Approved], same tx (§4 Rule 3).
    const svcRes = await statemachine.transition(ex.sm, {
      machine: MACHINE_SERVICE, entityType: 'service', table: 'services',
      entityId: locked.serviceId, to: SERVICE_STATUS_STRATEGY_APPROVED, actor,
    });
    if (!svcRes.ok) {
      throw transitionError(svcRes);
    }
    // 3) Record Approved By.
    await tx`update strategy_plans set approved_by=${actor.employeeId} where id=${strategyId}`;
    await ex.audit.insertAudit({
      entityType: 'strategy_plan', entityId: strategyId, actorEmployeeId: actor.employeeId, action: 'strategy_approved',
      beforeJson: null, afterJson: { approved_by: actor.employeeId, service_id: locked.serviceId },
      createdBy: actor.employeeId,
    });
  });
}

/**
 * requestRevision sends a submitted Plan back to [Strategy Drafting] (§4 Rule 4).
 * Account lead / Director only; revision notes mandatory. Revision count is
 * DERIVED from the audit log (the count of these revision transitions).
 */
export async function requestRevision(sql: Sql, actor: Actor, strategyId: string, notes: string): Promise<void> {
  const why = (notes ?? '').trim();
  if (why === '') {
    throw new ValidationError(MSG_REVISION_NOTES_REQUIRED);
  }
  if (!canApproveStrategy(actor)) {
    throw new ForbiddenError(MSG_APPROVE_FORBIDDEN);
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await lockStrategy(tx, strategyId);
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_STRATEGY_PLAN, entityType: 'strategy_plan', table: 'strategy_plans',
      entityId: strategyId, to: STRATEGY_STATUS_DRAFTING, actor,
    });
    if (!res.ok) {
      throw transitionError(res);
    }
    // Latest revision note for display; the immutable per-event record is the
    // audit row below (revision count derives from these).
    await tx`update strategy_plans set revision_notes=${why} where id=${strategyId}`;
    await ex.audit.insertAudit({
      entityType: 'strategy_plan', entityId: strategyId, actorEmployeeId: actor.employeeId, action: 'revision_requested',
      beforeJson: null, afterJson: { revision_notes: why }, createdBy: actor.employeeId,
    });
  });
}

// --- Reads ---

/**
 * getStrategy returns one Strategy & Plan with its derived revision count, if the
 * actor may see it (owning AM, or Account lead / OD / Director).
 */
export async function getStrategy(sql: Queryable, actor: Actor, strategyId: string): Promise<Strategy> {
  const { strategy, ownerAm } = await loadStrategy(sql, strategyId);
  if (!(permission.canReadDivision(actor, ACCOUNT_DIVISION) || ownerAm === actor.employeeId)) {
    throw new ForbiddenError(MSG_STRATEGY_FORBIDDEN);
  }
  strategy.revisionCount = await deriveRevisionCount(sql, strategyId);
  return strategy;
}

/**
 * listStrategies returns the Strategies visible to the actor (§3 visibility):
 * Account lead / OD / Director see all; an Account staff AM sees those on clients
 * they own; anyone else is forbidden.
 */
export async function listStrategies(sql: Queryable, actor: Actor): Promise<Strategy[]> {
  const cols = sql`sp.id, sp.service_id, sp.objective, sp.target_kpi, sp.divisions_involved,
    sp.planned_brief_outline, sp.timeline_start, sp.timeline_end, sp.status,
    coalesce(sp.approved_by,'') as approved_by, coalesce(sp.revision_notes,'') as revision_notes,
    sp.created_by, sp.created_at`;
  let rows: StrategyRow[];
  if (permission.canReadDivision(actor, ACCOUNT_DIVISION)) {
    rows = await sql<StrategyRow[]>`select ${cols} from strategy_plans sp order by sp.id desc`;
  } else if (actor.role.division === ACCOUNT_DIVISION && actor.role.level === permission.LevelStaff) {
    rows = await sql<StrategyRow[]>`
      select ${cols} from strategy_plans sp
        join services sv on sv.id = sp.service_id
        join clients c on c.id = sv.client_id
       where c.assigned_am_id = ${actor.employeeId}
       order by sp.id desc`;
  } else {
    throw new ForbiddenError(MSG_STRATEGY_FORBIDDEN);
  }
  return rows.map(rowToStrategy);
}

/**
 * guardBriefCreation is the §6 data-dependent guard the Brief-creation cluster
 * must call BEFORE driving a Service's [Awaiting Onboarding] → [Briefed] edge. A
 * plan-gated Service still at [Awaiting Onboarding] has not cleared its Strategy
 * gate, so Brief creation is rejected (ConflictError, MSG_STRATEGY_REQUIRED).
 * Direct Services (flag = No), or plan-gated Services already past [Strategy
 * Approved], pass. A missing Service is NotFoundError.
 */
export async function guardBriefCreation(sql: Queryable, serviceId: string): Promise<void> {
  const rows = await sql<
    { status: string; requires_strategy_plan: boolean; requires_strategy_plan_override: boolean | null }[]
  >`
    select status, requires_strategy_plan, requires_strategy_plan_override
      from services where id = ${serviceId}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_SERVICE_NOT_FOUND);
  }
  const svc = rows[0];
  if (
    effectiveRequiresPlan(svc.requires_strategy_plan, svc.requires_strategy_plan_override) &&
    svc.status === SERVICE_STATUS_AWAITING_ONBOARDING
  ) {
    throw new ConflictError(MSG_STRATEGY_REQUIRED);
  }
}

/**
 * setStrategyRequirement overrides a Service's "Requires Strategy Plan" flag for
 * this engagement (M6-OA-1). The pinned MSL flag is never mutated; an explicit
 * per-Service override column supersedes it. Permitted for the owning AM, the
 * Account lead/SPV, or a Director. Only while the Service is still [Awaiting
 * Onboarding] and before any Strategy & Plan exists (exempting a drafted Plan
 * would orphan it). An audited before→after field edit (+ reason), not a machine.
 */
export async function setStrategyRequirement(
  sql: Sql,
  actor: Actor,
  serviceId: string,
  requires: boolean,
  reason: string,
): Promise<StrategyRequirement> {
  const why = (reason ?? '').trim();
  if (why === '') {
    throw new ValidationError(MSG_OVERRIDE_REASON_REQUIRED);
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const rows = await tx<
      { status: string; requires_strategy_plan: boolean; requires_strategy_plan_override: boolean | null; assigned_am_id: string | null }[]
    >`
      select sv.status, sv.requires_strategy_plan, sv.requires_strategy_plan_override, c.assigned_am_id
        from services sv join clients c on c.id = sv.client_id
       where sv.id = ${serviceId} for update`;
    if (rows.length === 0) {
      throw new NotFoundError(MSG_SERVICE_NOT_FOUND);
    }
    const svc = rows[0];
    // M6-OA-1: owning AM OR Account lead/SPV OR Director. OD is read-only.
    const isOwnerAm = svc.assigned_am_id === actor.employeeId;
    if (!(permission.isLead(actor, ACCOUNT_DIVISION) || isOwnerAm)) {
      throw new ForbiddenError(MSG_OVERRIDE_FORBIDDEN);
    }
    if (svc.status !== SERVICE_STATUS_AWAITING_ONBOARDING) {
      throw new ConflictError(MSG_OVERRIDE_NOT_AWAITING);
    }
    const existing = await tx<{ id: string }[]>`select id from strategy_plans where service_id = ${serviceId}`;
    if (existing.length > 0) {
      throw new ConflictError(MSG_STRATEGY_EXISTS);
    }

    const before = effectiveRequiresPlan(svc.requires_strategy_plan, svc.requires_strategy_plan_override);
    await tx`update services set requires_strategy_plan_override = ${requires} where id = ${serviceId}`;
    await ex.audit.insertAudit({
      entityType: 'service', entityId: serviceId, actorEmployeeId: actor.employeeId,
      action: 'strategy_requirement_override',
      beforeJson: { requires_strategy_plan: before },
      afterJson: { requires_strategy_plan: requires, set_by: actor.employeeId, reason: why },
      createdBy: actor.employeeId,
    });
    return {
      serviceId, requiresStrategyPlan: requires, pinnedRequirement: svc.requires_strategy_plan,
      overridden: true, setBy: actor.employeeId, reason: why,
    };
  });
}

// --- Helpers ---

interface StrategyRow {
  id: string;
  service_id: string;
  objective: string;
  target_kpi: string;
  divisions_involved: string;
  planned_brief_outline: string;
  timeline_start: string | Date;
  timeline_end: string | Date;
  status: string;
  approved_by: string;
  revision_notes: string;
  created_by: string;
  created_at: Date;
}

function rowToStrategy(r: StrategyRow): Strategy {
  return {
    id: r.id, serviceId: r.service_id, objective: r.objective, targetKpi: r.target_kpi,
    divisionsInvolved: splitDivisions(r.divisions_involved), plannedBriefOutline: r.planned_brief_outline,
    timelineStart: dateStr(r.timeline_start), timelineEnd: dateStr(r.timeline_end), status: r.status,
    approvedBy: r.approved_by, revisionNotes: r.revision_notes, revisionCount: 0,
    createdBy: r.created_by, createdAt: r.created_at,
  };
}

interface LockedStrategy {
  status: string;
  ownerAm: string | null;
  serviceId: string;
}

/** lockStrategy takes the row lock and returns (status, owning-AM, service_id). */
async function lockStrategy(tx: Queryable, strategyId: string): Promise<LockedStrategy> {
  const rows = await tx<{ status: string; service_id: string; assigned_am_id: string | null }[]>`
    select sp.status, sp.service_id, c.assigned_am_id
      from strategy_plans sp
      join services sv on sv.id = sp.service_id
      join clients c on c.id = sv.client_id
     where sp.id = ${strategyId} for update`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_STRATEGY_NOT_FOUND);
  }
  return { status: rows[0].status, ownerAm: rows[0].assigned_am_id, serviceId: rows[0].service_id };
}

/** loadStrategy reads one Strategy (no lock) plus its owning AM, for the read path. */
async function loadStrategy(sql: Queryable, strategyId: string): Promise<{ strategy: Strategy; ownerAm: string | null }> {
  const rows = await sql<(StrategyRow & { assigned_am_id: string | null })[]>`
    select sp.id, sp.service_id, sp.objective, sp.target_kpi, sp.divisions_involved,
           sp.planned_brief_outline, sp.timeline_start, sp.timeline_end, sp.status,
           coalesce(sp.approved_by,'') as approved_by, coalesce(sp.revision_notes,'') as revision_notes,
           sp.created_by, sp.created_at, c.assigned_am_id
      from strategy_plans sp
      join services sv on sv.id = sp.service_id
      join clients c on c.id = sv.client_id
     where sp.id = ${strategyId}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_STRATEGY_NOT_FOUND);
  }
  return { strategy: rowToStrategy(rows[0]), ownerAm: rows[0].assigned_am_id };
}

/**
 * deriveRevisionCount counts revision-request transitions in the immutable audit
 * log (§4 Rule 4 — revision count is derived, never a stored tally). The engine
 * writes the action `transition:<from>-><to>` (SQL sm_transition), so we count
 * the [Strategy Submitted for Approval] → [Strategy Drafting] edge.
 */
async function deriveRevisionCount(sql: Queryable, strategyId: string): Promise<number> {
  const action = `transition:${STRATEGY_STATUS_SUBMITTED}->${STRATEGY_STATUS_DRAFTING}`;
  const rows = await sql<{ n: string }[]>`
    select count(*) as n from audit_log
     where entity_type = 'strategy_plan' and entity_id = ${strategyId} and action = ${action}`;
  return Number(rows[0].n);
}

/**
 * transitionError maps a rejected engine transition to the account error taxonomy:
 * a role gate → ForbiddenError (403), any other rejection (blocked edge / not
 * found) → ConflictError (409). Both carry the engine's verbatim BI message.
 */
function transitionError(res: statemachine.TransitionResult & { ok: false }): Error {
  if (res.code === 'role_denied') {
    return new ForbiddenError(res.message);
  }
  return new ConflictError(res.message);
}
