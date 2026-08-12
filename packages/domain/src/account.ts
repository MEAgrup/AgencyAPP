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

import { bi, notification, permission, statemachine } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql, type TransactionSql } from '@cdps/db';
import { onBriefReachedTerminal, validateBriefApproval } from './board';
import {
  effectiveGate,
  type GateDecision,
  type PlanTier,
} from './plangate_rules';

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

/**
 * QA revisi 2026-08-12 — the ±20% tolerance band the AM may adjust the client's
 * target GMV within before Head/SPV sign-off is required (DECISIONS.md
 * 2026-08-12). Measured against `clients.target_gmv`, the expectation Sales
 * captured at intake.
 */
export const GMV_TOLERANCE = 0.2;

/** The three states of the GMV adjustment gate (mirrors the DB CHECK). */
export const GMV_ADJ_IN_TOLERANCE = 'dalam_toleransi';
export const GMV_ADJ_PENDING = 'menunggu_persetujuan';
export const GMV_ADJ_APPROVED = 'disetujui';

/**
 * The fixed per-division task-satuan catalog (QA revisi 2026-08-12). Each
 * involved division commits to unit-of-work quotas that the AM later turns into
 * Briefs (M6B P3: Briefs are created manually from the plan). `money: true`
 * marks a Rupiah amount (Ads spend) rather than a plain count.
 */
export const TASK_CATALOG: Record<
  string,
  { readonly jenis: string; readonly label: string; readonly money?: boolean }[]
> = {
  Creative: [
    { jenis: 'video_seller', label: 'Jumlah video seller' },
    { jenis: 'sku_optimize', label: 'Jumlah SKU optimize' },
  ],
  KOL: [
    { jenis: 'video_creator', label: 'Jumlah video creator' },
    { jenis: 'live_stream_creator', label: 'Jumlah live stream creator' },
  ],
  Ads: [{ jenis: 'ads_spent', label: 'Ads spent (Rp)', money: true }],
  'Live Stream': [{ jenis: 'live_stream', label: 'Jumlah live stream' }],
};

/** One planned unit-of-work quota for a division (jumlah is exact numeric-as-string). */
export interface DivisionTask {
  divisi: string;
  jenis: string;
  jumlah: string;
}

/** The value type postgres.js `sql.json` accepts (jsonb serializer) — see plan.ts. */
type JsonParam = Parameters<TransactionSql['json']>[0];

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
/** M6C Rule 1: `ditentukan_am` tier with no recorded G-B decision blocks Brief creation. */
export const MSG_PLAN_DETERMINATION_REQUIRED =
  '[penentuan kebutuhan Plan wajib diselesaikan sebelum Brief dapat dibuat]';
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
/** A structured Target KPI value (GMV/ROAS/CTR/CVR) or a task quota is not a valid number. */
export const MSG_INVALID_KPI = '[nilai Target KPI tidak valid]';
/** A division task-satuan references a division/jenis outside TASK_CATALOG. */
export const MSG_INVALID_TASK = '[task satuan divisi tidak valid]';
/** A task-satuan targets a division not in Divisi Terlibat. */
export const MSG_TASK_DIVISION_NOT_INVOLVED = '[task satuan hanya untuk divisi yang terlibat]';
/** Adjusting target GMV beyond ±20% of the client's figure needs a written reason. */
export const MSG_GMV_ADJUSTMENT_REASON_REQUIRED =
  '[penyesuaian target GMV di luar toleransi 20% wajib disertai alasan]';
/** A Plan with a pending (out-of-tolerance) GMV adjustment cannot be submitted yet (§ QA revisi). */
export const MSG_GMV_ADJUSTMENT_PENDING =
  '[penyesuaian target GMV di luar toleransi 20% menunggu persetujuan Head/SPV]';
/** approveGmvAdjustment on a Plan whose GMV is not awaiting approval. */
export const MSG_GMV_ADJUSTMENT_NOT_PENDING =
  '[tidak ada penyesuaian target GMV yang menunggu persetujuan]';
/** Actor may not approve a GMV adjustment (not Account lead / Director). */
export const MSG_GMV_APPROVE_FORBIDDEN =
  '[anda tidak memiliki akses untuk menyetujui penyesuaian target GMV]';

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

// --- Types ---

/**
 * The Strategy & Plan content fields (M6 §9.3 + QA revisi 2026-08-12).
 * `targetKpi` is now an optional free-text catatan; the mandatory KPI is the four
 * structured points below. `targetGmv` defaults to the client's `target_gmv` when
 * omitted; adjusting it beyond ±20% requires `gmvAdjustmentReason`.
 */
export interface StrategyInput {
  objective: string;
  targetKpi?: string;
  targetGmv?: string | null;
  targetRoas?: string | null;
  targetCtr?: string | null;
  targetCvr?: string | null;
  gmvAdjustmentReason?: string | null;
  divisionTasks?: DivisionTask[];
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
  /** Structured Target KPI (QA revisi). GMV is Rp; the rest are ratios/percents. */
  targetGmv: string | null;
  targetRoas: string | null;
  targetCtr: string | null;
  targetCvr: string | null;
  /** The client's target GMV snapshot the ±20% band is measured against. */
  clientTargetGmv: string | null;
  gmvAdjustmentStatus: string;
  gmvAdjustmentReason: string | null;
  gmvAdjustmentApprovedBy: string | null;
  divisionTasks: DivisionTask[];
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

/** The normalized, validated content of a Strategy submission. */
interface NormalizedStrategy {
  /** ", "-joined canonical divisions string, as stored. */
  divisions: string;
  /** the involved-division set, for task-scope validation. */
  involved: Set<string>;
  kpi: { gmv: string | null; roas: string | null; ctr: string | null; cvr: string | null };
  tasks: DivisionTask[];
}

/** parseKpiNum trims and validates a non-negative numeric string, or null when blank. */
function parseKpiNum(v: string | null | undefined): string | null {
  const s = (v ?? '').toString().trim();
  if (s === '') return null;
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new ValidationError(MSG_INVALID_KPI);
  }
  return s;
}

/**
 * normalizeTasks validates each division task against TASK_CATALOG, rejects any
 * division not in `involved` (Divisi Terlibat), dedups, and returns the list in
 * canonical (division, then catalog) order. Blank rows are dropped, not rejected,
 * so the form can send an empty row per catalog slot without failing.
 */
function normalizeTasks(raw: DivisionTask[], involved: Set<string>): DivisionTask[] {
  const out: DivisionTask[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    const divisi = (t?.divisi ?? '').trim();
    const jenis = (t?.jenis ?? '').trim();
    const jumlah = (t?.jumlah ?? '').toString().trim();
    if (divisi === '' && jenis === '' && jumlah === '') continue;
    const catalog = TASK_CATALOG[divisi];
    if (!catalog || !catalog.some((c) => c.jenis === jenis)) {
      throw new ValidationError(MSG_INVALID_TASK);
    }
    if (!involved.has(divisi)) {
      throw new ValidationError(MSG_TASK_DIVISION_NOT_INVOLVED);
    }
    if (!/^\d+(\.\d+)?$/.test(jumlah)) {
      throw new ValidationError(MSG_INVALID_TASK);
    }
    const key = `${divisi}|${jenis}`;
    if (seen.has(key)) {
      throw new ValidationError(MSG_INVALID_TASK);
    }
    seen.add(key);
    out.push({ divisi, jenis, jumlah });
  }
  out.sort((a, b) => {
    const dd =
      ALLOWED_DIVISIONS.indexOf(a.divisi as (typeof ALLOWED_DIVISIONS)[number]) -
      ALLOWED_DIVISIONS.indexOf(b.divisi as (typeof ALLOWED_DIVISIONS)[number]);
    if (dd !== 0) return dd;
    return (
      TASK_CATALOG[a.divisi].findIndex((c) => c.jenis === a.jenis) -
      TASK_CATALOG[b.divisi].findIndex((c) => c.jenis === b.jenis)
    );
  });
  return out;
}

/**
 * normalizeAndValidate checks mandatory fields, validates the timeline as a valid
 * date range (start <= end), canonicalizes Divisions Involved against
 * ALLOWED_DIVISIONS (dedup, canonical order), parses the four structured KPI
 * points, and validates the per-division task-satuan. `targetKpi` is no longer
 * mandatory (QA revisi): the structured GMV/ROAS/CTR/CVR replace it as the KPI.
 */
function normalizeAndValidate(input: StrategyInput): NormalizedStrategy {
  const objective = (input.objective ?? '').trim();
  const outline = (input.plannedBriefOutline ?? '').trim();
  const start = (input.timelineStart ?? '').trim();
  const end = (input.timelineEnd ?? '').trim();
  if (
    objective === '' || outline === '' || start === '' || end === '' ||
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
  const divisions = ALLOWED_DIVISIONS.filter((d) => want.has(d)).join(', ');
  const kpi = {
    gmv: parseKpiNum(input.targetGmv),
    roas: parseKpiNum(input.targetRoas),
    ctr: parseKpiNum(input.targetCtr),
    cvr: parseKpiNum(input.targetCvr),
  };
  const tasks = normalizeTasks(input.divisionTasks ?? [], want);
  return { divisions, involved: want, kpi, tasks };
}

/**
 * gmvGate resolves the ±20% tolerance status of the AM's `targetGmv` against the
 * client's expectation (`clientTargetGmv`). A client target of 0/null means Sales
 * recorded no expectation, so there is no baseline and any figure is in tolerance
 * (no gate — division-by-zero is never surfaced, house rule #7). Out of tolerance
 * requires a reason, thrown here when absent.
 */
function gmvGate(
  targetGmv: string | null,
  clientTargetGmv: string | null,
  reason: string,
): { status: string; reason: string | null } {
  const client = clientTargetGmv === null ? 0 : Number(clientTargetGmv);
  const target = targetGmv === null ? client : Number(targetGmv);
  if (!(client > 0)) {
    return { status: GMV_ADJ_IN_TOLERANCE, reason: null };
  }
  const deviation = Math.abs(target - client) / client;
  if (deviation <= GMV_TOLERANCE + 1e-9) {
    return { status: GMV_ADJ_IN_TOLERANCE, reason: null };
  }
  const why = (reason ?? '').trim();
  if (why === '') {
    throw new ValidationError(MSG_GMV_ADJUSTMENT_REASON_REQUIRED);
  }
  return { status: GMV_ADJ_PENDING, reason: why };
}

/** parseTasks tolerates postgres.js returning a jsonb column parsed or as text. */
function parseTasks(v: unknown): DivisionTask[] {
  const arr = typeof v === 'string' ? (JSON.parse(v || '[]') as unknown) : v;
  return Array.isArray(arr) ? (arr as DivisionTask[]) : [];
}

/** numOrNull normalizes a postgres numeric (string|null) to string|null. */
function numOrNull(v: string | number | null | undefined): string | null {
  return v === null || v === undefined ? null : String(v);
}

/** splitDivisions parses a stored ", "-joined divisions string back to a list. */
function splitDivisions(s: string): string[] {
  if ((s ?? '').trim() === '') {
    return [];
  }
  return s.split(', ').filter((p) => p !== '');
}

/**
 * effectiveRequiresPlan resolves the execution gate.
 *
 * Since M6C the answer is no longer "override, else the pin": the catalog carries
 * a three-value TIER, and for the middle tier (`ditentukan_am`) the gate is the
 * AM's recorded G-B decision. Precedence is override (M6-OA-1) → recorded
 * decision → tier, and the resolution itself lives in `plangate_rules.ts` so
 * this file and the M6C module cannot drift apart.
 *
 * `pin` is still passed because the two locked tiers are bound to it by DB CHECK
 * (`ck_services_tier_matches_flag`); it is the fallback when a row predates the
 * tier column, which the migration's backfill makes impossible but which costs
 * nothing to tolerate.
 */
function effectiveRequiresPlan(
  pin: boolean,
  override: boolean | null,
  tier?: string | null,
  gateDecision?: string | null,
): boolean {
  if (!tier) return override === null ? pin : override;
  return effectiveGate({
    tier: tier as PlanTier,
    override: override ?? null,
    keputusanAm: (gateDecision ?? null) as GateDecision | null,
  }).requiresPlan;
}

/**
 * planDeterminationPending is M6C Rule 1: a `ditentukan_am` Service with no G-B
 * answer yet is not Direct, it is UNANSWERED — and Brief creation is blocked
 * until the form is filled. Treating it as Direct is the exact failure M6C §1 is
 * written against, because "no Plan" is the cheaper answer and nothing else
 * checks it.
 */
function planDeterminationPending(
  override: boolean | null,
  tier: string | null,
  gateDecision: string | null,
): boolean {
  if (!tier) return false;
  return effectiveGate({
    tier: tier as PlanTier,
    override: override ?? null,
    keputusanAm: gateDecision as GateDecision | null,
  }).perluPenentuan;
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
  const norm = normalizeAndValidate(input);
  const now = new Date();

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const rows = await tx<
      {
        status: string; requires_strategy_plan: boolean; requires_strategy_plan_override: boolean | null;
        assigned_am_id: string | null; target_gmv: string | null;
      }[]
    >`
      select sv.status, sv.requires_strategy_plan, sv.requires_strategy_plan_override,
             c.assigned_am_id, c.target_gmv
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

    // GMV anchors on the client's expectation Sales captured at intake; the AM's
    // figure defaults to it and may move within ±20% freely (Rule QA revisi).
    const clientTargetGmv = numOrNull(svc.target_gmv);
    const targetGmv = norm.kpi.gmv ?? clientTargetGmv;
    const gate = gmvGate(targetGmv, clientTargetGmv, input.gmvAdjustmentReason ?? '');
    const targetKpi = (input.targetKpi ?? '').trim();

    const id = await ex.ident.identNext('STR', now);
    await tx`
      insert into strategy_plans
        (id, service_id, objective, target_kpi, divisions_involved, planned_brief_outline,
         timeline_start, timeline_end, status, created_by,
         target_gmv, target_roas, target_ctr, target_cvr, client_target_gmv,
         gmv_adjustment_status, gmv_adjustment_reason, division_tasks)
      values (${id}, ${serviceId}, ${input.objective.trim()}, ${targetKpi}, ${norm.divisions},
        ${input.plannedBriefOutline.trim()}, ${input.timelineStart.trim()}, ${input.timelineEnd.trim()},
        ${STRATEGY_STATUS_DRAFTING}, ${actor.employeeId},
        ${targetGmv}, ${norm.kpi.roas}, ${norm.kpi.ctr}, ${norm.kpi.cvr}, ${clientTargetGmv},
        ${gate.status}, ${gate.reason}, ${tx.json(norm.tasks as unknown as JsonParam)})`;
    await ex.audit.insertAudit({
      entityType: 'strategy_plan', entityId: id, actorEmployeeId: actor.employeeId, action: 'create',
      beforeJson: null,
      afterJson: {
        status: STRATEGY_STATUS_DRAFTING, service_id: serviceId,
        target_gmv: targetGmv, client_target_gmv: clientTargetGmv, gmv_adjustment_status: gate.status,
      },
      createdBy: actor.employeeId,
    });
    return {
      id, serviceId, objective: input.objective.trim(), targetKpi,
      targetGmv, targetRoas: norm.kpi.roas, targetCtr: norm.kpi.ctr, targetCvr: norm.kpi.cvr,
      clientTargetGmv, gmvAdjustmentStatus: gate.status, gmvAdjustmentReason: gate.reason,
      gmvAdjustmentApprovedBy: null, divisionTasks: norm.tasks,
      divisionsInvolved: splitDivisions(norm.divisions), plannedBriefOutline: input.plannedBriefOutline.trim(),
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
  const norm = normalizeAndValidate(input);
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const locked = await lockStrategy(tx, strategyId);
    if (!actor.role.director && locked.ownerAm !== actor.employeeId) {
      throw new ForbiddenError(MSG_NOT_OWNER_AM);
    }
    if (locked.status !== STRATEGY_STATUS_DRAFTING) {
      throw new ConflictError(MSG_NOT_DRAFT);
    }
    // The ±20% baseline is the snapshot taken at draft time, not a re-read of the
    // client (the client's figure could drift; the yardstick must not). Any draft
    // edit re-opens the gate — `gmv_adjustment_approved_by` is cleared, so an
    // out-of-tolerance figure needs Head/SPV sign-off again.
    const targetGmv = norm.kpi.gmv ?? locked.clientTargetGmv;
    const gate = gmvGate(targetGmv, locked.clientTargetGmv, input.gmvAdjustmentReason ?? '');
    const targetKpi = (input.targetKpi ?? '').trim();
    await tx`
      update strategy_plans set objective=${input.objective.trim()}, target_kpi=${targetKpi},
        divisions_involved=${norm.divisions}, planned_brief_outline=${input.plannedBriefOutline.trim()},
        timeline_start=${input.timelineStart.trim()}, timeline_end=${input.timelineEnd.trim()},
        target_gmv=${targetGmv}, target_roas=${norm.kpi.roas}, target_ctr=${norm.kpi.ctr},
        target_cvr=${norm.kpi.cvr}, gmv_adjustment_status=${gate.status},
        gmv_adjustment_reason=${gate.reason}, gmv_adjustment_approved_by=null,
        division_tasks=${tx.json(norm.tasks as unknown as JsonParam)}
       where id=${strategyId}`;
    await ex.audit.insertAudit({
      entityType: 'strategy_plan', entityId: strategyId, actorEmployeeId: actor.employeeId, action: 'update_draft',
      beforeJson: null,
      afterJson: {
        objective: input.objective.trim(), divisions_involved: norm.divisions,
        target_gmv: targetGmv, gmv_adjustment_status: gate.status,
      },
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
    // QA revisi: an out-of-tolerance GMV adjustment must be cleared by Head/SPV
    // before the Plan can be submitted — the gate blocks here, not the machine.
    if (locked.gmvAdjustmentStatus === GMV_ADJ_PENDING) {
      throw new ConflictError(MSG_GMV_ADJUSTMENT_PENDING);
    }
    return statemachine.transition(ex.sm, {
      machine: MACHINE_STRATEGY_PLAN, entityType: 'strategy_plan', table: 'strategy_plans',
      entityId: strategyId, to: STRATEGY_STATUS_SUBMITTED, actor,
    });
  });
}

/**
 * approveGmvAdjustment clears a pending (out-of-tolerance) GMV adjustment (QA
 * revisi). Account lead (SPV / Head of Account) or Director only — the "ACC
 * Head/SPV" gate. The before→after edit is audit-logged (the "ada lognya"
 * requirement); no new notification event is minted (the catalog is a frozen
 * invariant pending sign-off), the SPV sees the pending status on the queue.
 */
export async function approveGmvAdjustment(sql: Sql, actor: Actor, strategyId: string): Promise<void> {
  if (!canApproveStrategy(actor)) {
    throw new ForbiddenError(MSG_GMV_APPROVE_FORBIDDEN);
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const locked = await lockStrategy(tx, strategyId);
    if (locked.gmvAdjustmentStatus !== GMV_ADJ_PENDING) {
      throw new ConflictError(MSG_GMV_ADJUSTMENT_NOT_PENDING);
    }
    await tx`
      update strategy_plans
         set gmv_adjustment_status=${GMV_ADJ_APPROVED}, gmv_adjustment_approved_by=${actor.employeeId}
       where id=${strategyId}`;
    await ex.audit.insertAudit({
      entityType: 'strategy_plan', entityId: strategyId, actorEmployeeId: actor.employeeId,
      action: 'gmv_adjustment_approved',
      beforeJson: { gmv_adjustment_status: GMV_ADJ_PENDING },
      afterJson: { gmv_adjustment_status: GMV_ADJ_APPROVED, approved_by: actor.employeeId },
      createdBy: actor.employeeId,
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
  const cols = strategyCols(sql);
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

// ---------------------------------------------------------------------------
// The AM's Service queue (§3 Rule 4) — the only door into §4/§5.
//
// §3 Rule 4: "Once assigned, the client and all its Services move from the
// Unassigned queue into that AM's personal queue; every Service still starts at
// [Awaiting Onboarding]". That personal queue had no read model at all: the
// intake queue (§3 Rule 1) lists only clients still WITHOUT an AM and goes blind
// the moment one is assigned, and every §4/§5 door (createStrategy /
// setStrategyRequirement / createBrief) is keyed by a Service ID the AM had no
// way to obtain — `clientDetailToWire` carries `services[].id` but the client
// page never rendered it, so onboarding was unreachable in the UI even though
// every write endpoint behind it worked.
//
// A FACT-ONLY projection on purpose: which step comes next is presentation, and
// deriving it here would put a second copy of the §4/§5 gate order next to the
// one the write paths already enforce. The FE renders the call-to-action from
// these fields (`nextOnboardingStep`, unit-tested there); the server keeps
// deciding what is actually allowed.
// ---------------------------------------------------------------------------

/** Actor may not read the Account service queue (not Account, OD or Director). */
export const MSG_SERVICE_QUEUE_FORBIDDEN = '[anda tidak memiliki akses ke antrean layanan Account]';

/**
 * ServiceQueueRow is one Service in an AM's personal queue, joined to the client
 * it belongs to plus the two facts that decide what may happen next: the
 * EFFECTIVE plan gate (override ∨ MSL pin, M6-OA-1) and the Strategy & Plan
 * behind it, if any. `briefCount` distinguishes "briefed" from "not started"
 * without a second round-trip.
 */
export interface ServiceQueueRow {
  serviceId: string;
  clientId: string;
  toko: string;
  namaPic: string;
  name: string;
  status: string;
  /** effective gate: the M6-OA-1 override if set, else the pinned MSL flag. */
  requiresStrategyPlan: boolean;
  /** the immutable MSL pin, so the UI can show that the default was overridden. */
  pinnedRequiresStrategyPlan: boolean;
  overridden: boolean;
  /** M6C: the catalog tier pinned at closing — which of the three paths applies. */
  planTier: PlanTier;
  /** the recorded G-B decision, null when the middle tier is still unanswered. */
  gateDecision: GateDecision | null;
  /** true when the tier is `ditentukan_am` and nobody has answered G-B yet. */
  planDeterminationPending: boolean;
  assignedAmId: string | null;
  strategyId: string | null;
  strategyStatus: string | null;
  briefCount: number;
  /** the client's target GMV — the anchor + ±20% baseline for a new Strategy (QA revisi). */
  clientTargetGmv: string | null;
  releasedToAccountAt: Date | null;
}

interface ServiceQueueDbRow {
  id: string;
  client_id: string;
  toko: string;
  nama_pic: string;
  name: string;
  status: string;
  requires_strategy_plan: boolean;
  requires_strategy_plan_override: boolean | null;
  plan_tier: string;
  gate_decision: string | null;
  assigned_am_id: string | null;
  strategy_id: string | null;
  strategy_status: string | null;
  brief_count: string;
  client_target_gmv: string | null;
  released_to_account_at: Date | null;
}

function rowToServiceQueue(r: ServiceQueueDbRow): ServiceQueueRow {
  return {
    serviceId: r.id,
    clientId: r.client_id,
    toko: r.toko,
    namaPic: r.nama_pic,
    name: r.name,
    status: r.status,
    requiresStrategyPlan: effectiveRequiresPlan(
      r.requires_strategy_plan, r.requires_strategy_plan_override, r.plan_tier, r.gate_decision,
    ),
    pinnedRequiresStrategyPlan: r.requires_strategy_plan,
    overridden: r.requires_strategy_plan_override !== null,
    planTier: r.plan_tier as PlanTier,
    gateDecision: r.gate_decision as GateDecision | null,
    planDeterminationPending: planDeterminationPending(
      r.requires_strategy_plan_override, r.plan_tier, r.gate_decision,
    ),
    assignedAmId: r.assigned_am_id,
    strategyId: r.strategy_id,
    strategyStatus: r.strategy_status,
    briefCount: Number(r.brief_count),
    clientTargetGmv: numOrNull(r.client_target_gmv),
    releasedToAccountAt: r.released_to_account_at,
  };
}

/** The projection shared by the queue list and the single-Service read. */
function serviceQueueCols(sql: Queryable) {
  return sql`sv.id, sv.client_id, c.toko, c.nama_pic, sv.name, sv.status,
    sv.requires_strategy_plan, sv.requires_strategy_plan_override, sv.plan_tier,
    (select g.keputusan_am from service_plan_gate g where g.service_id = sv.id) as gate_decision,
    c.assigned_am_id,
    sp.id as strategy_id, sp.status as strategy_status,
    (select count(*) from briefs b where b.service_id = sv.id) as brief_count,
    c.target_gmv as client_target_gmv,
    c.released_to_account_at`;
}

/**
 * serviceQueue returns the Services visible to the actor, longest-waiting client
 * first (same ordering rationale as `intakeQueue`). Scope mirrors
 * `listStrategies` exactly (§3 visibility): Account lead / OD / Director see all,
 * an Account-staff AM sees the Services of the clients they own, anyone else is
 * forbidden. Status filtering stays in the UI — one honest list, filtered where
 * it is displayed (same as the Strategy inbox toggle), rather than a second
 * server-side notion of "still open" that could drift from the §4/§5 gates.
 *
 * RLS is the second wall, not the first: an Account lead only sees these rows at
 * all because of the division arms added in 20260805060000; before that this
 * read returned an empty list for the very role §3 Rule 1 puts in charge.
 */
export async function serviceQueue(sql: Queryable, actor: Actor): Promise<ServiceQueueRow[]> {
  const cols = serviceQueueCols(sql);
  let rows: ServiceQueueDbRow[];
  if (permission.canReadDivision(actor, ACCOUNT_DIVISION)) {
    // Services of clients Finance has not released yet are still Sales/Finance
    // stage work (M5 §5) — they are not in anybody's Account queue.
    rows = await sql<ServiceQueueDbRow[]>`
      select ${cols}
        from services sv
        join clients c on c.id = sv.client_id
        left join strategy_plans sp on sp.service_id = sv.id
       where c.released_to_account_at is not null
       order by c.released_to_account_at asc, sv.id asc`;
  } else if (actor.role.division === ACCOUNT_DIVISION && actor.role.level === permission.LevelStaff) {
    rows = await sql<ServiceQueueDbRow[]>`
      select ${cols}
        from services sv
        join clients c on c.id = sv.client_id
        left join strategy_plans sp on sp.service_id = sv.id
       where c.assigned_am_id = ${actor.employeeId}
       order by c.released_to_account_at asc, sv.id asc`;
  } else {
    throw new ForbiddenError(MSG_SERVICE_QUEUE_FORBIDDEN);
  }
  return rows.map(rowToServiceQueue);
}

/**
 * getService returns one Service with the same facts as a queue row — what the
 * Service hub page needs in order to show the REAL execution path instead of
 * guessing it from whether a Strategy row happens to exist (a plan-gated Service
 * that has not been drafted yet looks Direct under that guess, so the page
 * offered a Brief form the server was always going to reject with
 * MSG_STRATEGY_REQUIRED).
 *
 * Read gate identical to `listServiceBriefs`, the sibling read on that same page:
 * the owning AM, Account lead, OD or Director.
 *
 * NOTE on the status an outsider actually gets: over HTTP the read runs under
 * `readAsActor`, so RLS removes the row before this gate is reached and the caller
 * sees 404, not 403. That is the stricter answer (existence is not disclosed) and
 * it is deliberate — the ForbiddenError below is what a privileged/service-role
 * caller (and therefore the integration tests) hits. Do not "fix" the 404.
 */
export async function getService(sql: Queryable, actor: Actor, serviceId: string): Promise<ServiceQueueRow> {
  const cols = serviceQueueCols(sql);
  const rows = await sql<ServiceQueueDbRow[]>`
    select ${cols}
      from services sv
      join clients c on c.id = sv.client_id
      left join strategy_plans sp on sp.service_id = sv.id
     where sv.id = ${serviceId}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_SERVICE_NOT_FOUND);
  }
  const row = rowToServiceQueue(rows[0]);
  if (!(permission.canReadDivision(actor, ACCOUNT_DIVISION) || row.assignedAmId === actor.employeeId)) {
    throw new ForbiddenError(MSG_SERVICE_QUEUE_FORBIDDEN);
  }
  return row;
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
    {
      status: string;
      requires_strategy_plan: boolean;
      requires_strategy_plan_override: boolean | null;
      plan_tier: string | null;
      keputusan_am: string | null;
    }[]
  >`
    select sv.status, sv.requires_strategy_plan, sv.requires_strategy_plan_override,
           sv.plan_tier, g.keputusan_am
      from services sv
      left join service_plan_gate g on g.service_id = sv.id
     where sv.id = ${serviceId}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_SERVICE_NOT_FOUND);
  }
  const svc = rows[0];
  // M6C Rule 1: the middle tier must be ANSWERED before any Brief. This is a
  // distinct rejection from MSG_STRATEGY_REQUIRED — the AM's next action is
  // "fill the G-B form", not "get the Strategy approved", and one message that
  // covers both would send them to the wrong screen.
  if (
    planDeterminationPending(
      svc.requires_strategy_plan_override,
      svc.plan_tier,
      svc.keputusan_am,
    )
  ) {
    throw new ConflictError(MSG_PLAN_DETERMINATION_REQUIRED);
  }
  if (
    effectiveRequiresPlan(
      svc.requires_strategy_plan,
      svc.requires_strategy_plan_override,
      svc.plan_tier,
      svc.keputusan_am,
    ) &&
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
  target_gmv: string | null;
  target_roas: string | null;
  target_ctr: string | null;
  target_cvr: string | null;
  client_target_gmv: string | null;
  gmv_adjustment_status: string;
  gmv_adjustment_reason: string | null;
  gmv_adjustment_approved_by: string | null;
  division_tasks: unknown;
}

function rowToStrategy(r: StrategyRow): Strategy {
  return {
    id: r.id, serviceId: r.service_id, objective: r.objective, targetKpi: r.target_kpi ?? '',
    targetGmv: numOrNull(r.target_gmv), targetRoas: numOrNull(r.target_roas),
    targetCtr: numOrNull(r.target_ctr), targetCvr: numOrNull(r.target_cvr),
    clientTargetGmv: numOrNull(r.client_target_gmv), gmvAdjustmentStatus: r.gmv_adjustment_status,
    gmvAdjustmentReason: r.gmv_adjustment_reason ?? null,
    gmvAdjustmentApprovedBy: r.gmv_adjustment_approved_by ?? null, divisionTasks: parseTasks(r.division_tasks),
    divisionsInvolved: splitDivisions(r.divisions_involved), plannedBriefOutline: r.planned_brief_outline,
    timelineStart: dateStr(r.timeline_start), timelineEnd: dateStr(r.timeline_end), status: r.status,
    approvedBy: r.approved_by, revisionNotes: r.revision_notes, revisionCount: 0,
    createdBy: r.created_by, createdAt: r.created_at,
  };
}

/** The full projection for a Strategy read — shared by loadStrategy and listStrategies. */
function strategyCols(sql: Queryable) {
  return sql`sp.id, sp.service_id, sp.objective, sp.target_kpi, sp.divisions_involved,
    sp.planned_brief_outline, sp.timeline_start, sp.timeline_end, sp.status,
    coalesce(sp.approved_by,'') as approved_by, coalesce(sp.revision_notes,'') as revision_notes,
    sp.created_by, sp.created_at,
    sp.target_gmv, sp.target_roas, sp.target_ctr, sp.target_cvr, sp.client_target_gmv,
    sp.gmv_adjustment_status, sp.gmv_adjustment_reason, sp.gmv_adjustment_approved_by, sp.division_tasks`;
}

interface LockedStrategy {
  status: string;
  ownerAm: string | null;
  serviceId: string;
  clientTargetGmv: string | null;
  gmvAdjustmentStatus: string;
}

/** lockStrategy takes the row lock and returns the fields the write gates need. */
async function lockStrategy(tx: Queryable, strategyId: string): Promise<LockedStrategy> {
  const rows = await tx<
    {
      status: string; service_id: string; assigned_am_id: string | null;
      client_target_gmv: string | null; gmv_adjustment_status: string;
    }[]
  >`
    select sp.status, sp.service_id, c.assigned_am_id, sp.client_target_gmv, sp.gmv_adjustment_status
      from strategy_plans sp
      join services sv on sv.id = sp.service_id
      join clients c on c.id = sv.client_id
     where sp.id = ${strategyId} for update`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_STRATEGY_NOT_FOUND);
  }
  return {
    status: rows[0].status, ownerAm: rows[0].assigned_am_id, serviceId: rows[0].service_id,
    clientTargetGmv: numOrNull(rows[0].client_target_gmv), gmvAdjustmentStatus: rows[0].gmv_adjustment_status,
  };
}

/** loadStrategy reads one Strategy (no lock) plus its owning AM, for the read path. */
async function loadStrategy(sql: Queryable, strategyId: string): Promise<{ strategy: Strategy; ownerAm: string | null }> {
  const rows = await sql<(StrategyRow & { assigned_am_id: string | null })[]>`
    select ${strategyCols(sql)}, c.assigned_am_id
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

// ===========================================================================
// Cluster 3 — Service → Brief breakdown (§5) and dispatch (§6).
// Ported from backend/internal/module6_account/brief.go.
// ===========================================================================

/** Brief lifecycle + Service target states (STATE_MACHINES §6/§7). */
export const BRIEF_STATUS_TODO = '[To Do]';
/** Off-machine marker for a Live Stream Brief (§6 Rule 2) — tracked in M10, not the Kanban. */
export const BRIEF_STATUS_VENDOR_DISPATCHED = '[Dispatched to Vendor]';
export const BRIEF_STATUS_SUBMITTED = '[Submitted]';
export const BRIEF_STATUS_IN_REVIEW = '[In Review]';
export const BRIEF_STATUS_APPROVED = '[Approved]';
export const BRIEF_STATUS_REVISION_REQ = '[Revision Requested]';

const SERVICE_STATUS_BRIEFED = '[Briefed]';
const SERVICE_STATUS_IN_EXECUTION = '[In Execution]';

/** The outsourced-vendor division (§6 Rule 2). */
export const DIVISION_LIVE_STREAM = 'Live Stream';
/** §7 Rule 4 / M6-OA-3: a Brief crossing 3 revisions is surfaced for SPV visibility. */
const BRIEF_REVISION_FLAG_THRESHOLD = 3;

const MACHINE_BRIEF_TASK = 'brief_task';

const ALLOWED_PRIORITIES = new Set(['Low', 'Medium', 'High']);

// --- Verbatim BI messages (M6 §5/§6/§7). Each mirrors a Go sentinel 1:1. ---

export const MSG_BRIEF_NOT_FOUND = '[brief tidak ditemukan]';
export const MSG_BRIEF_FORBIDDEN = '[anda tidak memiliki akses ke brief ini]';
export const MSG_BRIEF_CREATE_FORBIDDEN =
  '[hanya Account Manager pemilik klien yang dapat membuat Brief untuk layanan ini]';
export const MSG_SERVICE_NOT_BRIEFABLE = '[brief tidak dapat dibuat untuk layanan pada status ini]';
export const MSG_INVALID_DIVISION = '[divisi tujuan tidak valid]';
export const MSG_INVALID_PRIORITY = '[prioritas tidak valid]';
export const MSG_BRIEF_STRATEGY_MISMATCH =
  '[Strategy ID brief harus menunjuk Strategy & Plan yang disetujui untuk layanan ini]';
export const MSG_BRIEF_STRATEGY_NOT_ALLOWED = '[layanan Direct tidak boleh memiliki Strategy ID pada brief]';
export const MSG_QUEUE_FORBIDDEN = '[anda tidak memiliki akses ke antrean brief divisi ini]';
export const MSG_BRIEF_REVIEW_FORBIDDEN =
  '[hanya Account Manager pemilik klien yang dapat mereview Brief layanan ini]';

// --- Types ---

/** The M6 §9.4 Brief fields (mandatory: title, division, deliverableType, quantityTarget, dueDate, priority). */
export interface BriefInput {
  title: string;
  strategyId?: string;
  assignedDivision: string;
  assignedPic?: string;
  deliverableType: string;
  quantityTarget: number;
  dueDate: string; // YYYY-MM-DD
  priority: string;
  recurring?: boolean;
  recurringFrequency?: string;
  recurringCount?: number;
  recurringEndDate?: string; // YYYY-MM-DD
  instructions?: string;
  referenceAttachments?: string;
  isAddendum?: boolean;
}

/** A Brief record (BRF-). */
export interface Brief {
  id: string;
  serviceId: string;
  strategyId: string;
  assignedDivision: string;
  assignedPic: string;
  deliverableType: string;
  quantityTarget: number;
  dueDate: string;
  priority: string;
  recurring: boolean;
  recurringFrequency: string;
  recurringCount: number;
  recurringEndDate: string;
  instructions: string;
  referenceAttachments: string;
  title: string;
  status: string;
  revisionCount: number;
  /** Derived §7 Rule 4 / M6-OA-3 flag (revisionCount >= 3), set where the count is derived. */
  revisionFlagged: boolean;
  createdBy: string;
  createdAt: Date;
}

// --- Input validation ---

/** validateBrief checks the §9.4 mandatory fields BEFORE any id is minted. */
function validateBrief(input: BriefInput): void {
  const title = (input.title ?? '').trim();
  const deliverable = (input.deliverableType ?? '').trim();
  const due = (input.dueDate ?? '').trim();
  const division = (input.assignedDivision ?? '').trim();
  const priority = (input.priority ?? '').trim();
  if (title === '' || deliverable === '' || due === '' || (input.quantityTarget ?? 0) <= 0 || division === '') {
    throw new ValidationError(bi.INCOMPLETE_DATA);
  }
  if (!ALLOWED_DIVISIONS.includes(division as (typeof ALLOWED_DIVISIONS)[number])) {
    throw new ValidationError(MSG_INVALID_DIVISION);
  }
  if (priority === '') {
    throw new ValidationError(bi.INCOMPLETE_DATA);
  }
  if (!ALLOWED_PRIORITIES.has(priority)) {
    throw new ValidationError(MSG_INVALID_PRIORITY);
  }
  if (!RE_DATE.test(due) || Number.isNaN(Date.parse(`${due}T00:00:00Z`))) {
    throw new ValidationError(bi.INCOMPLETE_DATA);
  }
  // Recurring toggle: when on, its sub-fields become mandatory (§9.4).
  if (input.recurring) {
    const freq = (input.recurringFrequency ?? '').trim();
    const end = (input.recurringEndDate ?? '').trim();
    if (freq === '' || (input.recurringCount ?? 0) <= 0 || end === '') {
      throw new ValidationError(bi.INCOMPLETE_DATA);
    }
    if (!RE_DATE.test(end) || Number.isNaN(Date.parse(`${end}T00:00:00Z`))) {
      throw new ValidationError(bi.INCOMPLETE_DATA);
    }
  }
}

/** orNull stores an empty/absent optional string as SQL NULL. */
function orNull(s: string | undefined): string | null {
  return s && s.trim() !== '' ? s.trim() : null;
}

/**
 * createBrief breaks a Service down into one Brief for a target division (§5).
 * Owning AM (or Director) only; the Strategy gate is enforced by guardBriefCreation.
 * The first Brief advances the Service to [Briefed] in the same transaction. A
 * Live Stream Brief is born off-machine ([Dispatched to Vendor], §6 Rule 2).
 */
export async function createBrief(sql: Sql, actor: Actor, serviceId: string, input: BriefInput): Promise<Brief> {
  validateBrief(input);
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
    if (!actor.role.director && svc.assigned_am_id !== actor.employeeId) {
      throw new ForbiddenError(MSG_BRIEF_CREATE_FORBIDDEN);
    }
    // Briefable only on the live path; terminal Services (Done / Voided) reject.
    if (
      svc.status !== SERVICE_STATUS_AWAITING_ONBOARDING && svc.status !== SERVICE_STATUS_STRATEGY_APPROVED &&
      svc.status !== SERVICE_STATUS_BRIEFED && svc.status !== SERVICE_STATUS_IN_EXECUTION
    ) {
      throw new ConflictError(MSG_SERVICE_NOT_BRIEFABLE);
    }
    // §5 Rule 5 gate: plan-gated + still [Awaiting Onboarding] is rejected.
    await guardBriefCreation(tx, serviceId);

    const planGated = effectiveRequiresPlan(svc.requires_strategy_plan, svc.requires_strategy_plan_override);
    const strategyId = await resolveBriefStrategy(tx, serviceId, planGated, (input.strategyId ?? '').trim());

    const id = await ex.ident.identNext('BRF', now);
    const birth = input.assignedDivision === DIVISION_LIVE_STREAM ? BRIEF_STATUS_VENDOR_DISPATCHED : BRIEF_STATUS_TODO;
    const recurring = input.recurring === true;
    const recCount = recurring && (input.recurringCount ?? 0) > 0 ? input.recurringCount! : null;

    await tx`
      insert into briefs
        (id, service_id, strategy_id, assigned_division, assigned_pic, deliverable_type,
         quantity_target, due_date, priority, recurring, recurring_frequency, recurring_count,
         recurring_end_date, instructions, reference_attachments, title, status, created_by)
      values (${id}, ${serviceId}, ${strategyId}, ${input.assignedDivision}, ${orNull(input.assignedPic)},
        ${input.deliverableType}, ${input.quantityTarget}, ${input.dueDate.trim()}, ${input.priority}, ${recurring},
        ${orNull(input.recurringFrequency)}, ${recCount}, ${orNull(input.recurringEndDate)},
        ${orNull(input.instructions)}, ${orNull(input.referenceAttachments)}, ${input.title.trim()}, ${birth},
        ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: 'brief', entityId: id, actorEmployeeId: actor.employeeId, action: 'create',
      beforeJson: null, afterJson: { status: birth, service_id: serviceId, assigned_division: input.assignedDivision },
      createdBy: actor.employeeId,
    });

    // §5 Flow 2: the FIRST Brief advances the Service to [Briefed].
    if (svc.status === SERVICE_STATUS_AWAITING_ONBOARDING || svc.status === SERVICE_STATUS_STRATEGY_APPROVED) {
      const res = await statemachine.transition(ex.sm, {
        machine: MACHINE_SERVICE, entityType: 'service', table: 'services',
        entityId: serviceId, to: SERVICE_STATUS_BRIEFED, actor,
      });
      if (!res.ok) {
        throw transitionError(res);
      }
    }
    // §5 Rule 2 / M6-OA-5: a Brief beyond the approved outline is logged as a Plan addendum.
    if (planGated && input.isAddendum && strategyId !== null) {
      await ex.audit.insertAudit({
        entityType: 'strategy_plan', entityId: strategyId, actorEmployeeId: actor.employeeId, action: 'plan_addendum',
        beforeJson: null, afterJson: { brief_id: id, title: input.title.trim() }, createdBy: actor.employeeId,
      });
    }

    return {
      id, serviceId, strategyId: strategyId ?? '', assignedDivision: input.assignedDivision,
      assignedPic: (input.assignedPic ?? '').trim(), deliverableType: input.deliverableType,
      quantityTarget: input.quantityTarget, dueDate: input.dueDate.trim(), priority: input.priority,
      recurring, recurringFrequency: (input.recurringFrequency ?? '').trim(), recurringCount: recCount ?? 0,
      recurringEndDate: (input.recurringEndDate ?? '').trim(), instructions: (input.instructions ?? '').trim(),
      referenceAttachments: (input.referenceAttachments ?? '').trim(), title: input.title.trim(), status: birth,
      revisionCount: 0, revisionFlagged: false, createdBy: actor.employeeId, createdAt: now,
    };
  });
}

/**
 * resolveBriefStrategy returns the strategy_id to store for a new Brief. Direct
 * Service → NULL (a supplied id is rejected); plan-gated Service → must equal the
 * Service's approved Strategy id (§5 Rule 2).
 */
async function resolveBriefStrategy(
  tx: Queryable,
  serviceId: string,
  planGated: boolean,
  inStrategyId: string,
): Promise<string | null> {
  if (!planGated) {
    if (inStrategyId !== '') {
      throw new ValidationError(MSG_BRIEF_STRATEGY_NOT_ALLOWED);
    }
    return null;
  }
  const rows = await tx<{ id: string; status: string }[]>`
    select id, status from strategy_plans where service_id = ${serviceId}`;
  if (rows.length === 0) {
    throw new ConflictError(MSG_STRATEGY_REQUIRED); // unreachable past the guard, defensive
  }
  if (rows[0].status !== STRATEGY_STATUS_APPROVED || inStrategyId !== rows[0].id) {
    throw new ValidationError(MSG_BRIEF_STRATEGY_MISMATCH);
  }
  return rows[0].id;
}

/**
 * onBriefLeavesToDo advances the parent Service [Briefed] → [In Execution] when
 * one of its Briefs leaves [To Do] (§5 Flow 3). The M12 Task machine calls this
 * inside its own transaction after moving a Brief out of [To Do]; idempotent (a
 * Service already [In Execution] is a no-op) and defensively no-ops otherwise.
 */
export async function onBriefLeavesToDo(tx: Queryable, actor: Actor, serviceId: string): Promise<void> {
  const rows = await tx<{ status: string }[]>`select status from services where id = ${serviceId} for update`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_SERVICE_NOT_FOUND);
  }
  if (rows[0].status !== SERVICE_STATUS_BRIEFED) {
    return; // already [In Execution], or not yet briefed — nothing to do
  }
  const ex = executors(tx);
  const res = await statemachine.transition(ex.sm, {
    machine: MACHINE_SERVICE, entityType: 'service', table: 'services',
    entityId: serviceId, to: SERVICE_STATUS_IN_EXECUTION, actor,
  });
  if (!res.ok) {
    throw transitionError(res);
  }
}

// --- Brief reads ---

/**
 * getBrief returns one Brief with its derived revision count + flag, if the actor
 * may see it (§6/§9.1): OD/Director everywhere; Account lead (division-wide); the
 * owning AM; and staff/lead of the Brief's target division.
 */
export async function getBrief(sql: Queryable, actor: Actor, briefId: string): Promise<Brief> {
  const { brief, ownerAm } = await loadBrief(sql, briefId);
  if (!canSeeBrief(actor, ownerAm, brief.assignedDivision)) {
    throw new ForbiddenError(MSG_BRIEF_FORBIDDEN);
  }
  brief.revisionCount = await deriveBriefRevisionCount(sql, briefId);
  brief.revisionFlagged = brief.revisionCount >= BRIEF_REVISION_FLAG_THRESHOLD;
  return brief;
}

/** canSeeBrief is the shared §6/§9.1 read predicate. */
export function canSeeBrief(actor: Actor, ownerAm: string | null, division: string): boolean {
  if (permission.canReadAll(actor)) {
    return true; // OD / Director
  }
  if (permission.canReadDivision(actor, ACCOUNT_DIVISION)) {
    return true; // Account lead (division-wide)
  }
  if (actor.employeeId === ownerAm) {
    return true; // owning AM
  }
  return (
    actor.role.division === division &&
    (actor.role.level === permission.LevelStaff || actor.role.level === permission.LevelLead)
  );
}

/**
 * listDivisionQueue returns the Brief queue for a target division (§6 Rule 1),
 * oldest first. Readable by staff/lead of that division, Account lead (monitor
 * dispatch, decision Nerissa 2026-07-12), and OD/Director.
 */
export async function listDivisionQueue(sql: Queryable, actor: Actor, division: string): Promise<Brief[]> {
  if (!ALLOWED_DIVISIONS.includes(division as (typeof ALLOWED_DIVISIONS)[number])) {
    throw new ValidationError(MSG_INVALID_DIVISION);
  }
  const allowed =
    permission.canReadAll(actor) ||
    permission.isLead(actor, ACCOUNT_DIVISION) ||
    (actor.role.division === division &&
      (actor.role.level === permission.LevelStaff || actor.role.level === permission.LevelLead));
  if (!allowed) {
    throw new ForbiddenError(MSG_QUEUE_FORBIDDEN);
  }
  const rows = await sql<BriefRow[]>`
    select ${briefCols(sql)} from briefs b where b.assigned_division = ${division} order by b.id asc`;
  return rows.map(rowToBrief);
}

/**
 * listServiceBriefs returns all Briefs of a Service (§5 fan-out), readable by the
 * owning AM, Account lead, and OD/Director. Division staff use listDivisionQueue.
 */
export async function listServiceBriefs(sql: Queryable, actor: Actor, serviceId: string): Promise<Brief[]> {
  const owner = await sql<{ assigned_am_id: string | null }[]>`
    select c.assigned_am_id from services sv join clients c on c.id = sv.client_id where sv.id = ${serviceId}`;
  if (owner.length === 0) {
    throw new NotFoundError(MSG_SERVICE_NOT_FOUND);
  }
  if (!(permission.canReadDivision(actor, ACCOUNT_DIVISION) || owner[0].assigned_am_id === actor.employeeId)) {
    throw new ForbiddenError(MSG_BRIEF_FORBIDDEN);
  }
  const rows = await sql<BriefRow[]>`
    select ${briefCols(sql)} from briefs b where b.service_id = ${serviceId} order by b.id asc`;
  return rows.map(rowToBrief);
}

// ===========================================================================
// Cluster 4 part A — Revision routing / AM-side review edges (§7).
// Ported from backend/internal/module6_account/brief_review.go.
// ===========================================================================

/**
 * reviewBrief pulls a [Submitted] Brief into [In Review] (§6 Rule 1). Owning AM
 * (or Director). A wrong-state or Live Stream Brief is rejected by the engine.
 */
export async function reviewBrief(sql: Sql, actor: Actor, briefId: string): Promise<statemachine.TransitionResult> {
  return driveReviewEdge(sql, actor, briefId, BRIEF_STATUS_IN_REVIEW);
}

/**
 * approveBrief approves a Brief under review ([In Review] → [Approved], §6 Flow
 * 3). Owning AM (or Director). (The M11 Blocking-Dependency approval gate is
 * DEFERRED until M11 is ported — nil-safe, same as the Go default.)
 */
export async function approveBrief(sql: Sql, actor: Actor, briefId: string): Promise<statemachine.TransitionResult> {
  return driveReviewEdge(sql, actor, briefId, BRIEF_STATUS_APPROVED);
}

/** Shared owner-gated engine driver for the two no-notes AM review edges. */
async function driveReviewEdge(
  sql: Sql,
  actor: Actor,
  briefId: string,
  to: string,
): Promise<statemachine.TransitionResult> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await lockBriefOwner(tx, actor, briefId);
    // M11 §6.3: a Blocking Dependency locks the Target Brief's final [Approved] edge
    // until its Source is terminal (throws a board ConflictError; nothing changes).
    if (to === BRIEF_STATUS_APPROVED) {
      await validateBriefApproval(tx, briefId);
    }
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_BRIEF_TASK, entityType: 'brief', table: 'briefs', entityId: briefId, to, actor,
    });
    // M11 §5.5: on reaching terminal, fire EvDependencySatisfied once per sourced Dependency.
    if (res.ok && to === BRIEF_STATUS_APPROVED) {
      await onBriefReachedTerminal(tx, actor, briefId);
    }
    return res;
  });
}

/**
 * requestBriefRevision sends a Brief under review back to the division with
 * mandatory written feedback ([In Review] → [Revision Requested], §7). Owning AM
 * (or Director). The counter derives from the audit log; on the exact 3rd
 * revision the SPV-visibility flag fires (§7 Rule 4 / M6-OA-3).
 */
export async function requestBriefRevision(
  sql: Sql,
  actor: Actor,
  briefId: string,
  feedback: string,
): Promise<statemachine.TransitionResult> {
  const why = (feedback ?? '').trim();
  if (why === '') {
    throw new ValidationError(MSG_REVISION_NOTES_REQUIRED); // §7 Rule 2
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const { division } = await lockBriefOwner(tx, actor, briefId);
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_BRIEF_TASK, entityType: 'brief', table: 'briefs',
      entityId: briefId, to: BRIEF_STATUS_REVISION_REQ, actor,
    });
    if (!res.ok) {
      return res;
    }
    // §7 Rule 2: the mandatory feedback recorded immutably in the audit log.
    await ex.audit.insertAudit({
      entityType: 'brief', entityId: briefId, actorEmployeeId: actor.employeeId, action: 'revision_feedback',
      beforeJson: null, afterJson: { feedback: why }, createdBy: actor.employeeId,
    });
    // §7 Rule 4 / M6-OA-3: fire the SPV-visibility flag on the exact crossing (once).
    const count = await deriveBriefRevisionCount(tx, briefId);
    if (count === BRIEF_REVISION_FLAG_THRESHOLD) {
      await notification.emit(ex.notify, {
        event: notification.EVENTS.RevisionCountFlag, entityType: 'brief', entityId: briefId,
        actor: actor.employeeId, division,
      });
    }
    return res;
  });
}

/**
 * lockBriefOwner row-locks a Brief and returns its (assigned_division, owner AM),
 * enforcing the §6 Rule 3 review gate: owning AM or Director only.
 */
async function lockBriefOwner(
  tx: Queryable,
  actor: Actor,
  briefId: string,
): Promise<{ division: string; ownerAm: string | null }> {
  const rows = await tx<{ assigned_division: string; assigned_am_id: string | null }[]>`
    select b.assigned_division, c.assigned_am_id
      from briefs b
      join services sv on sv.id = b.service_id
      join clients c on c.id = sv.client_id
     where b.id = ${briefId} for update`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_BRIEF_NOT_FOUND);
  }
  if (!actor.role.director && rows[0].assigned_am_id !== actor.employeeId) {
    throw new ForbiddenError(MSG_BRIEF_REVIEW_FORBIDDEN);
  }
  return { division: rows[0].assigned_division, ownerAm: rows[0].assigned_am_id };
}

// --- Brief helpers ---

interface BriefRow {
  id: string;
  service_id: string;
  strategy_id: string | null;
  assigned_division: string;
  assigned_pic: string | null;
  deliverable_type: string;
  quantity_target: number;
  due_date: string | Date;
  priority: string;
  recurring: boolean;
  recurring_frequency: string | null;
  recurring_count: number | null;
  recurring_end_date: string | Date | null;
  instructions: string | null;
  reference_attachments: string | null;
  title: string;
  status: string;
  created_by: string;
  created_at: Date;
  assigned_am_id?: string | null;
}

/** briefCols is the shared Brief column list (nested sql fragment). */
function briefCols(sql: Queryable) {
  return sql`b.id, b.service_id, b.strategy_id, b.assigned_division, b.assigned_pic, b.deliverable_type,
    b.quantity_target, b.due_date, b.priority, b.recurring, b.recurring_frequency, b.recurring_count,
    b.recurring_end_date, b.instructions, b.reference_attachments, b.title, b.status, b.created_by, b.created_at`;
}

function rowToBrief(r: BriefRow): Brief {
  return {
    id: r.id, serviceId: r.service_id, strategyId: r.strategy_id ?? '', assignedDivision: r.assigned_division,
    assignedPic: r.assigned_pic ?? '', deliverableType: r.deliverable_type, quantityTarget: r.quantity_target,
    dueDate: dateStr(r.due_date), priority: r.priority, recurring: r.recurring,
    recurringFrequency: r.recurring_frequency ?? '', recurringCount: r.recurring_count ?? 0,
    recurringEndDate: r.recurring_end_date === null ? '' : dateStr(r.recurring_end_date),
    instructions: r.instructions ?? '', referenceAttachments: r.reference_attachments ?? '', title: r.title,
    status: r.status, revisionCount: 0, revisionFlagged: false, createdBy: r.created_by, createdAt: r.created_at,
  };
}

/**
 * loadBrief reads one Brief (no lock) plus the owning AM, for the read path.
 *
 * O52: the owning AM comes from `private.brief_owner_am`, not from
 * `join services join clients`. Those two policies have no execution-division
 * arm, so the join dropped the row entirely and the page answered **404** for
 * the very division the Brief was assigned to — while `canSeeBrief` below was
 * saying yes. The Brief row itself survives RLS on its own (`briefs` has the
 * division arm), so the only thing that ever needed opening was this one column.
 */
async function loadBrief(sql: Queryable, briefId: string): Promise<{ brief: Brief; ownerAm: string | null }> {
  const rows = await sql<BriefRow[]>`
    select ${briefCols(sql)}, private.brief_owner_am(b.id) as assigned_am_id
      from briefs b
     where b.id = ${briefId}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_BRIEF_NOT_FOUND);
  }
  return { brief: rowToBrief(rows[0]), ownerAm: rows[0].assigned_am_id ?? null };
}

/**
 * deriveBriefRevisionCount counts [In Review] → [Revision Requested] transitions
 * in the immutable audit log (§6 Rule 4 — derived, never stored).
 */
async function deriveBriefRevisionCount(sql: Queryable, briefId: string): Promise<number> {
  const action = `transition:${BRIEF_STATUS_IN_REVIEW}->${BRIEF_STATUS_REVISION_REQ}`;
  const rows = await sql<{ n: string }[]>`
    select count(*) as n from audit_log
     where entity_type = 'brief' and entity_id = ${briefId} and action = ${action}`;
  return Number(rows[0].n);
}

// ===========================================================================
// Cluster 4 part B — Complaint door #2 (§8), the AM-via-WhatsApp channel.
// Ported from backend/internal/module6_account/complaint.go.
// ===========================================================================

/** Complaint Source values (§9.5). Only door #2 is wired here. */
export const COMPLAINT_SOURCE_WHATSAPP = 'WhatsApp (AM-logged)';

/** Complaint lifecycle states (STATE_MACHINES §11). */
export const COMPLAINT_STATUS_OPEN = '[Open]';
export const COMPLAINT_STATUS_IN_PROGRESS = '[In Progress]';
export const COMPLAINT_STATUS_RESOLVED = '[Resolved]';
export const COMPLAINT_STATUS_CLOSED = '[Closed]';

const MACHINE_COMPLAINT = 'complaint';
const ALLOWED_SEVERITIES = new Set(['Low', 'Medium', 'High']);

// --- Verbatim BI messages (M6 §8/§9.5). ---

export const MSG_COMPLAINT_NOT_FOUND = '[komplain tidak ditemukan]';
export const MSG_COMPLAINT_FORBIDDEN = '[anda tidak memiliki akses ke komplain ini]';
export const MSG_LOG_COMPLAINT_FORBIDDEN =
  '[hanya Account Manager pemilik klien yang dapat mencatat komplain untuk klien ini]';
export const MSG_COMPLAINT_MANAGE_FORBIDDEN = '[anda tidak memiliki akses untuk mengelola komplain ini]';
export const MSG_INVALID_SEVERITY = '[tingkat keparahan tidak valid]';
export const MSG_INVALID_RELATED_REF = '[referensi layanan atau brief tidak valid]';
export const MSG_RESOLUTION_NOTES_REQUIRED = '[catatan penyelesaian wajib diisi]';

// --- Types ---

/** The §9.5 caller-supplied Complaint fields (mandatory: description, severity). */
export interface ComplaintInput {
  description: string;
  severity: string;
  relatedRef?: string;
}

/** A Complaint record (CPL-). */
export interface Complaint {
  id: string;
  clientId: string;
  relatedRef: string;
  source: string;
  description: string;
  severity: string;
  status: string;
  assignedTo: string;
  resolutionNotes: string;
  createdBy: string;
  createdAt: Date;
}

/** canManageComplaint is the §8 Rule 4 / §9.1 write gate: owning AM, Account lead/SPV or Director. */
export function canManageComplaint(actor: Actor, ownerAm: string | null): boolean {
  return permission.isLead(actor, ACCOUNT_DIVISION) || actor.employeeId === ownerAm;
}

/** canSeeComplaint is the §8 Rule 4 read predicate. */
export function canSeeComplaint(actor: Actor, ownerAm: string | null, relatedBriefDivision: string): boolean {
  if (permission.canReadAll(actor)) {
    return true; // OD / Director
  }
  if (permission.canReadDivision(actor, ACCOUNT_DIVISION)) {
    return true; // Account lead (division-wide)
  }
  if (actor.employeeId === ownerAm) {
    return true; // owning AM
  }
  return (
    relatedBriefDivision !== '' && actor.role.division === relatedBriefDivision &&
    (actor.role.level === permission.LevelStaff || actor.role.level === permission.LevelLead)
  );
}

function validateComplaint(input: ComplaintInput): void {
  if ((input.description ?? '').trim() === '' || (input.severity ?? '').trim() === '') {
    throw new ValidationError(bi.INCOMPLETE_DATA);
  }
  if (!ALLOWED_SEVERITIES.has(input.severity)) {
    throw new ValidationError(MSG_INVALID_SEVERITY);
  }
}

/**
 * logComplaint records a WhatsApp complaint against a released client (door #2,
 * §8). Owning AM (or Director) only; Source fixed to WhatsApp (AM-logged); CPL-
 * id minted after validation; assigned_to defaults to the owning AM; birth
 * status [Open]. Fires EvComplaintLogged → AM + SPV Account.
 */
export async function logComplaint(sql: Sql, actor: Actor, clientId: string, input: ComplaintInput): Promise<Complaint> {
  validateComplaint(input);
  const now = new Date();

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const rows = await tx<{ released_to_account_at: Date | null; assigned_am_id: string | null }[]>`
      select released_to_account_at, assigned_am_id from clients where id = ${clientId} for update`;
    if (rows.length === 0 || rows[0].released_to_account_at === null) {
      throw new NotFoundError(MSG_NOT_FOUND); // missing or pre-release → invisible (M5 §5 Rule 2)
    }
    const ownerAm = rows[0].assigned_am_id;
    if (!actor.role.director && ownerAm !== actor.employeeId) {
      throw new ForbiddenError(MSG_LOG_COMPLAINT_FORBIDDEN);
    }
    const relatedRef = (input.relatedRef ?? '').trim();
    if (relatedRef !== '') {
      await validateRelatedRef(tx, clientId, relatedRef);
    }

    const id = await ex.ident.identNext('CPL', now);
    await tx`
      insert into complaints
        (id, client_id, related_ref, source, description, severity, status, assigned_to, created_by)
      values (${id}, ${clientId}, ${orNull(relatedRef)}, ${COMPLAINT_SOURCE_WHATSAPP}, ${input.description.trim()},
        ${input.severity}, ${COMPLAINT_STATUS_OPEN}, ${ownerAm}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: 'complaint', entityId: id, actorEmployeeId: actor.employeeId, action: 'create',
      beforeJson: null,
      afterJson: { status: COMPLAINT_STATUS_OPEN, client_id: clientId, severity: input.severity, source: COMPLAINT_SOURCE_WHATSAPP },
      createdBy: actor.employeeId,
    });
    // EvComplaintLogged (FROZEN catalog) → AM + SPV Account (explicitOrLeads).
    await notification.emit(ex.notify, {
      event: notification.EVENTS.ComplaintLogged, entityType: 'complaint', entityId: id,
      actor: actor.employeeId, division: ACCOUNT_DIVISION,
      explicitRecipients: ownerAm ? [ownerAm] : [],
    });

    return {
      id, clientId, relatedRef, source: COMPLAINT_SOURCE_WHATSAPP, description: input.description.trim(),
      severity: input.severity, status: COMPLAINT_STATUS_OPEN, assignedTo: ownerAm ?? '', resolutionNotes: '',
      createdBy: actor.employeeId, createdAt: now,
    };
  });
}

/** startComplaint moves a Complaint [Open] → [In Progress] (§8 Rule 5). */
export async function startComplaint(sql: Sql, actor: Actor, complaintId: string): Promise<statemachine.TransitionResult> {
  return transitionComplaint(sql, actor, complaintId, COMPLAINT_STATUS_IN_PROGRESS, '', false);
}

/**
 * resolveComplaint moves a Complaint [In Progress] → [Resolved] (§8 Rule 5).
 * Resolution notes mandatory (§9.5).
 */
export async function resolveComplaint(
  sql: Sql,
  actor: Actor,
  complaintId: string,
  notes: string,
): Promise<statemachine.TransitionResult> {
  const why = (notes ?? '').trim();
  if (why === '') {
    throw new ValidationError(MSG_RESOLUTION_NOTES_REQUIRED);
  }
  return transitionComplaint(sql, actor, complaintId, COMPLAINT_STATUS_RESOLVED, why, true);
}

/** closeComplaint moves a Complaint [Resolved] → [Closed] (§8 Rule 5). */
export async function closeComplaint(sql: Sql, actor: Actor, complaintId: string): Promise<statemachine.TransitionResult> {
  return transitionComplaint(sql, actor, complaintId, COMPLAINT_STATUS_CLOSED, '', false);
}

/** Shared owner/lead-gated engine driver for the CPL- status moves. */
async function transitionComplaint(
  sql: Sql,
  actor: Actor,
  complaintId: string,
  to: string,
  notes: string,
  storeNotes: boolean,
): Promise<statemachine.TransitionResult> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const ownerAm = await lockComplaintOwner(tx, complaintId);
    if (!canManageComplaint(actor, ownerAm)) {
      throw new ForbiddenError(MSG_COMPLAINT_MANAGE_FORBIDDEN);
    }
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_COMPLAINT, entityType: 'complaint', table: 'complaints', entityId: complaintId, to, actor,
    });
    if (!res.ok) {
      return res;
    }
    if (storeNotes) {
      await tx`update complaints set resolution_notes = ${notes} where id = ${complaintId}`;
      await ex.audit.insertAudit({
        entityType: 'complaint', entityId: complaintId, actorEmployeeId: actor.employeeId, action: 'resolution_notes',
        beforeJson: null, afterJson: { resolution_notes: notes }, createdBy: actor.employeeId,
      });
    }
    return res;
  });
}

/**
 * getComplaint returns one Complaint if the actor may see it (§8 Rule 4 / §9.1):
 * OD/Director everywhere; Account lead; the owning AM; and — when tied to a Brief
 * — that Brief's division staff/lead (read-only context).
 */
export async function getComplaint(sql: Queryable, actor: Actor, complaintId: string): Promise<Complaint> {
  const { complaint, ownerAm, relatedBriefDivision } = await loadComplaint(sql, complaintId);
  if (!canSeeComplaint(actor, ownerAm, relatedBriefDivision)) {
    throw new ForbiddenError(MSG_COMPLAINT_FORBIDDEN);
  }
  return complaint;
}

/**
 * listClientComplaints returns a client's complaints (visibility follows the
 * client, §8 Rule 3): owning AM, Account lead, OD and Director.
 */
export async function listClientComplaints(sql: Queryable, actor: Actor, clientId: string): Promise<Complaint[]> {
  const rows = await sql<{ released_to_account_at: Date | null; assigned_am_id: string | null }[]>`
    select released_to_account_at, assigned_am_id from clients where id = ${clientId}`;
  if (rows.length === 0 || rows[0].released_to_account_at === null) {
    throw new NotFoundError(MSG_NOT_FOUND);
  }
  if (!(permission.canReadDivision(actor, ACCOUNT_DIVISION) || rows[0].assigned_am_id === actor.employeeId)) {
    throw new ForbiddenError(MSG_COMPLAINT_FORBIDDEN);
  }
  const list = await sql<ComplaintRow[]>`
    select ${complaintCols(sql)} from complaints c where c.client_id = ${clientId} order by c.id desc`;
  return list.map(rowToComplaint);
}

// --- Complaint helpers ---

interface ComplaintRow {
  id: string;
  client_id: string;
  related_ref: string | null;
  source: string;
  description: string;
  severity: string;
  status: string;
  assigned_to: string | null;
  resolution_notes: string | null;
  created_by: string;
  created_at: Date;
}

function complaintCols(sql: Queryable) {
  return sql`c.id, c.client_id, c.related_ref, c.source, c.description, c.severity, c.status,
    c.assigned_to, c.resolution_notes, c.created_by, c.created_at`;
}

function rowToComplaint(r: ComplaintRow): Complaint {
  return {
    id: r.id, clientId: r.client_id, relatedRef: r.related_ref ?? '', source: r.source,
    description: r.description, severity: r.severity, status: r.status, assignedTo: r.assigned_to ?? '',
    resolutionNotes: r.resolution_notes ?? '', createdBy: r.created_by, createdAt: r.created_at,
  };
}

/**
 * validateRelatedRef checks the optional Related Service/Brief points at a
 * Service OR a Brief of this client (§8 Rule 3).
 */
async function validateRelatedRef(tx: Queryable, clientId: string, ref: string): Promise<void> {
  const svc = await tx<{ one: number }[]>`select 1 as one from services where id = ${ref} and client_id = ${clientId}`;
  if (svc.length > 0) {
    return;
  }
  const brf = await tx<{ one: number }[]>`
    select 1 as one from briefs b join services sv on sv.id = b.service_id
     where b.id = ${ref} and sv.client_id = ${clientId}`;
  if (brf.length === 0) {
    throw new ValidationError(MSG_INVALID_RELATED_REF);
  }
}

/** lockComplaintOwner row-locks a Complaint and returns its owning AM. */
async function lockComplaintOwner(tx: Queryable, complaintId: string): Promise<string | null> {
  const rows = await tx<{ assigned_am_id: string | null }[]>`
    select c.assigned_am_id from complaints cp join clients c on c.id = cp.client_id
     where cp.id = ${complaintId} for update`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_COMPLAINT_NOT_FOUND);
  }
  return rows[0].assigned_am_id;
}

/**
 * loadComplaint reads a Complaint plus the owning AM and, when the related ref is
 * a Brief, that Brief's division (for the §8 Rule 4 read predicate).
 */
async function loadComplaint(
  sql: Queryable,
  complaintId: string,
): Promise<{ complaint: Complaint; ownerAm: string | null; relatedBriefDivision: string }> {
  const rows = await sql<(ComplaintRow & { owner_am: string | null; brief_division: string | null })[]>`
    select ${complaintCols(sql)}, cl.assigned_am_id as owner_am, b.assigned_division as brief_division
      from complaints c
      join clients cl on cl.id = c.client_id
      left join briefs b on b.id = c.related_ref
     where c.id = ${complaintId}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_COMPLAINT_NOT_FOUND);
  }
  return {
    complaint: rowToComplaint(rows[0]), ownerAm: rows[0].owner_am ?? null,
    relatedBriefDivision: rows[0].brief_division ?? '',
  };
}
