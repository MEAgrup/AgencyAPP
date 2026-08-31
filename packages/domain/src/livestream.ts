/**
 * Live Stream domain service (M10) — the Live Stream Session (LSS-) vendor
 * tracker, ported from Go's `internal/module10_livestream`.
 *
 * Live Stream is the confirmed exception to the execution-division pattern
 * (M10 §1/§2): MEA does NOT run the stream — an outsourced sister-company vendor
 * with NO CDPS access does. So a Session is a TRACKER, not an execution system:
 * it records on ONE row what the AM REQUESTED from the vendor and what the vendor
 * actually DELIVERED. There is no internal Kanban; the owning AM (not an internal
 * PIC) creates the request, logs the vendor-reported result, reconciles
 * requested-vs-actual, and flags a discrepancy. The vendor is represented
 * entirely through AM-entered data (§6.1).
 *
 * Parent = a Live Stream Brief, which is OFF-MACHINE: born [Dispatched to Vendor]
 * it skips the canonical brief_task machine entirely (STATE_MACHINES §7; DECISIONS
 * W2-M6-C3). A single Brief holds MANY Sessions across a recurring package's life
 * (M10-OA-4). When every Session of a Brief reaches [Reconciled] the Brief closes
 * to [Approved] via an audited off-machine UPDATE (action `ls_brief_reconciled` —
 * the same off-machine precedent as the M4 void cascade, NOT the engine). An
 * [Approved] Brief may be reopened to add Sessions (action `ls_brief_reopened`,
 * DECISIONS O27 / W2-M10-C2).
 *
 * House rules honored (CLAUDE.md §Non-negotiable):
 *   - the LSS- id is minted (ident_next) ONLY after the §6.3 mandatory REQUEST
 *     fields validate (rule #1); the birth status [Requested] is set at INSERT (a
 *     creation, not a transition), every later move goes through sm_transition —
 *     machine `live_stream_session` (STATE_MACHINES §10) — never a raw UPDATE (#2);
 *   - GMV / Data Confidence Tier are read-only vendor-reported facts; GMV is stored
 *     in DECIMAL rupiah (money bigint) and rendered "Rp. X.XXX.XXX,00" (#7); the
 *     confidence tier is the auto Vendor-Reported badge (§5 Rule 2 / M10-OA-5) —
 *     full value, never numerically discounted;
 *   - every create / transition / reconcile / reopen appends an immutable audit row
 *     (#3); the [Discrepancy Flagged] transition emits the SPV-Account notification
 *     (M10-OA-3), atomic with the transition.
 *
 * Note on the discrepancy notification: the Go backend emits it from the engine's
 * `onTransition` hook (httpapi.onTransition). The TS engine is the SQL function
 * `sm_transition`, which carries no per-machine hook — so this module emits it
 * explicitly inside the same transaction as the transition (finance/demo/sales
 * precedent), which is the identical atomic guarantee.
 *
 * Reference: backend/internal/module10_livestream/{livestream,session,lifecycle,
 * rollup,reopen,read}.go.
 */

import { bi, money, notification, permission, statemachine, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import { STRATEGI_AKTIF } from './strategi';

/** Authenticated employee + resolved role (from @cdps/core permission). */
export type Actor = permission.Actor;

// ---------------------------------------------------------------------------
// Divisions + machine.
// ---------------------------------------------------------------------------

/** The outsourced-vendor division whose Briefs are born off-machine (M6 §6 Rule 2). */
export const LIVE_STREAM_DIVISION = 'Live Stream';
/** The client-owning division; its lead has division-wide read + vendor follow-up. */
export const ACCOUNT_DIVISION = 'Account';

/** live_stream_session machine (seeded in 20260723055732_statemachine.sql). */
export const LIVE_STREAM_MACHINE = 'live_stream_session';

// ---------------------------------------------------------------------------
// Statuses (live_stream_session machine, STATE_MACHINES §10).
// ---------------------------------------------------------------------------

export const LSS_REQUESTED = '[Requested]';
export const LSS_CONFIRMED = '[Confirmed by Vendor]';
export const LSS_COMPLETED = '[Completed]';
export const LSS_RECONCILED = '[Reconciled]'; // terminal
export const LSS_DISCREPANCY = '[Discrepancy Flagged]';

// ---------------------------------------------------------------------------
// Off-machine Brief statuses this module observes (mirror M6/M4 constants).
// ---------------------------------------------------------------------------

/** The LS Brief's off-machine birth status (§6 Rule 2). */
export const BRIEF_VENDOR_DISPATCHED = '[Dispatched to Vendor]';
/** Where the LS Brief closes once all its Sessions reconcile. */
export const BRIEF_APPROVED = '[Approved]';
/** The void-cascade terminal (M4-OA-5); a voided Brief takes no new Sessions. */
export const BRIEF_VOIDED = '[Cancelled — Service Voided]';

// ---------------------------------------------------------------------------
// Platform enum (§6.3) + confidence tier (§5 Rule 2 / M10-OA-5).
// ---------------------------------------------------------------------------

export const PLATFORM_TIKTOK = 'TikTok Shop Live';
export const PLATFORM_SHOPEE = 'Shopee Live';
const VALID_PLATFORMS = new Set<string>([PLATFORM_TIKTOK, PLATFORM_SHOPEE]);

/**
 * The default (and only) confidence tier for a Live Stream Session's numbers: the
 * GMV is self-reported by the vendor, so it is BADGED Vendor-Reported — but it
 * still counts at full value toward the client's GMV signal, never discounted.
 */
export const DATA_CONFIDENCE_VENDOR_REPORTED = 'Vendor-Reported';

// ---------------------------------------------------------------------------
// Verbatim Bahasa Indonesia messages (house rule #5). Module-local per bi.ts scope.
// ---------------------------------------------------------------------------

/** The Brief is not a Live Stream Brief (analogue of M9's KOL-division message). */
export const MSG_NOT_LIVE_STREAM_BRIEF = '[brief ini bukan brief divisi Live Stream]';
/** The Brief is not accepting new Sessions (already [Approved]). */
export const MSG_BRIEF_NOT_OPEN = '[sesi tidak dapat dibuat untuk brief pada status ini]';
/** The parent Brief has been cancelled via the void cascade. */
export const MSG_BRIEF_VOIDED = '[brief untuk sesi ini telah dibatalkan]';
/** Platform is outside the §6.3 enum. */
export const MSG_INVALID_PLATFORM = '[platform tidak valid]';
/** A duration (target/actual) must be a positive number of hours. */
export const MSG_INVALID_DURATION = '[durasi harus lebih dari 0 jam]';
/** A datetime field could not be parsed. */
export const MSG_BAD_DATETIME = '[format tanggal/waktu tidak valid]';
/** A money field could not be parsed. */
export const MSG_BAD_AMOUNT = '[nilai uang tidak valid]';
/** A Vendor Report Link is mandatory before [Completed] (§6.3 — audit trail). */
export const MSG_VENDOR_REPORT_LINK_REQUIRED = '[link laporan vendor wajib diisi sebelum sesi selesai]';
/** Reconciliation Notes are mandatory on [Discrepancy Flagged] (§4 Rule 3). */
export const MSG_RECON_NOTES_REQUIRED = '[catatan rekonsiliasi wajib diisi]';
/** The parent Brief does not exist. */
export const MSG_BRIEF_NOT_FOUND = '[brief tidak ditemukan]';
/** The referenced Session does not exist. */
export const MSG_SESSION_NOT_FOUND = '[sesi tidak ditemukan]';
/** Actor may not read this Session (§6.1 read gate). */
export const MSG_SESSION_VIEW_FORBIDDEN = '[anda tidak memiliki akses ke sesi ini]';
/** Actor may not create/log/reconcile/flag this Session (owning AM + Director). */
export const MSG_SESSION_MANAGE_FORBIDDEN = '[anda tidak memiliki akses untuk mengelola sesi live stream ini]';
/** Actor may not reopen this Brief (owning AM + Director only). */
export const MSG_BRIEF_REOPEN_FORBIDDEN = '[anda tidak memiliki akses untuk membuka kembali brief ini]';
/** The Brief's current status does not permit reopening (only [Approved]). */
export const MSG_BRIEF_NOT_REOPENABLE = '[brief tidak dapat dibuka kembali pada status ini]';

// ---------------------------------------------------------------------------
// Errors — one class per HTTP shape, each carrying the verbatim BI message.
// ---------------------------------------------------------------------------

/** Mandatory-field gate failure (carries the exact global BI message → 400). */
export class IncompleteError extends Error {
  constructor(message: string = bi.INCOMPLETE_DATA) {
    super(message);
    this.name = 'LiveStreamIncompleteError';
  }
}

/** A field value failed validation (verbatim BI, → 400). */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveStreamValidationError';
  }
}

/** Requested Brief / Session does not exist (verbatim BI, → 404). */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveStreamNotFoundError';
  }
}

/** Actor may not perform the requested read/write (verbatim BI, → 403). */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveStreamForbiddenError';
  }
}

/**
 * A lifecycle-state conflict (verbatim BI, → 409): the Brief is the wrong kind /
 * closed / voided / not reopenable, or a Session transition is not permitted from
 * its current status (the pinned-source-state guard, or the engine's own reject).
 */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveStreamConflictError';
  }
}

// ---------------------------------------------------------------------------
// Permission gates (§6.1). This is a TRACKER the owning AM owns, NOT an execution
// division. Every WRITE edge is the owning AM or Director; the read gate adds
// OD/Director (everywhere) and Account lead/SPV (division-wide, incl. discrepancies).
//
// LT-61 adds a SECOND, narrower write gate (`canVendorWriteSession`) for the
// vendor Actor itself, additive to (never replacing) the AM/Director gate above.
// It is deliberately its own function, not folded into `canManageSession`,
// because it must NOT apply to every edge: `edge()` below takes an explicit
// `allowVendor` opt-in per caller, so reconcile/flagDiscrepancy — the AM
// checking the vendor's own numbers — stay unreachable by construction for a
// vendor Actor, no matter how this file's gates evolve. See
// docs/prd/CDPS_Module10_Addendum_LT61_Vendor_Portal_Spec.md §4.
// ---------------------------------------------------------------------------

/** canManageSession: create/results/reconcile/flag/reopen — owning AM or Director. */
export function canManageSession(actor: Actor, ownerAM: string | null): boolean {
  return actor.role.director || (!!ownerAM && actor.employeeId === ownerAM);
}

/**
 * canVendorWriteSession (LT-61): the vendor Actor assigned to this Session's
 * `vendor_id`. `actor.vendorId` is undefined for every employee Actor, so this
 * is always false for the AM/Director population — purely additive.
 */
export function canVendorWriteSession(actor: Actor, sessionVendorId: string | null): boolean {
  return !!sessionVendorId && !!actor.vendorId && actor.vendorId === sessionVendorId;
}

/**
 * canSeeSession: OD/Director everywhere; Account lead/SPV division-wide; owning
 * AM; OR (LT-61) the vendor Actor this Session belongs to.
 */
export function canSeeSession(actor: Actor, ownerAM: string | null, sessionVendorId: string | null = null): boolean {
  if (permission.canReadAll(actor)) {
    return true; // OD / Director
  }
  if (permission.isLead(actor, ACCOUNT_DIVISION)) {
    return true; // Account lead / SPV (division-wide)
  }
  if (canVendorWriteSession(actor, sessionVendorId)) {
    return true; // LT-61: the assigned vendor reads its own Session
  }
  return !!ownerAM && actor.employeeId === ownerAM;
}

// ---------------------------------------------------------------------------
// Session shape (request + result on one record).
// ---------------------------------------------------------------------------

/** The §6.3 REQUEST fields supplied at creation. */
export interface SessionInput {
  platform: string; // mandatory: TikTok Shop Live / Shopee Live
  requestedDatetime: string; // mandatory: "YYYY-MM-DD HH:MM:SS" or RFC3339
  targetDurationHours: string; // mandatory: decimal hours, e.g. "2" or "1.5"
  productsTalent?: string; // optional
  specialInstructions?: string; // optional
}

/** The vendor-reported RESULT fields (§4 Rule 1 / §6.3). */
export interface ResultInput {
  actualDatetime: string; // mandatory: when the stream was actually held
  actualDurationHours: string; // mandatory: decimal hours actually streamed
  viewersPeak?: number | null; // optional
  viewersAvg?: number | null; // optional
  ordersGenerated?: number | null; // mandatory: orders generated in the session
  gmv: string; // mandatory: GMV from live (Rp), money core
  vendorReportLink: string; // mandatory: the vendor's own report/proof (audit trail)
}

/** One Live Stream Session (LSS-). Money renders both raw decimal + house display. */
export interface Session {
  id: string;
  briefId: string;
  /** VND- id of the vendor entitled to self-serve this Session (LT-61), or null
   *  when unresolved at creation (e.g. no Aktif Strategi live pillar yet) —
   *  the AM keeps entering results on the vendor's behalf in that case. */
  vendorId: string | null;
  platform: string;
  requestedDatetime: Date;
  targetDurationHours: number;
  productsTalent: string;
  specialInstructions: string;
  status: string;
  actualDatetime: Date | null;
  actualDurationHours: number | null;
  viewersPeak: number | null;
  viewersAvg: number | null;
  ordersGenerated: number | null;
  /** DECIMAL(20,2) rupiah string ("5000000.00"), or null before [Completed]. */
  gmv: string | null;
  /** "Rp. X.XXX.XXX,00" (house rule #7), or "" before [Completed]. */
  gmvDisplay: string;
  vendorReportLink: string;
  reconciliationNotes: string;
  dataConfidenceTier: string;
  createdBy: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Session creation (M10 §3).
// ---------------------------------------------------------------------------

/**
 * createSession records a request to the vendor for one live-stream broadcast
 * (§3). Creatable by the owning AM or Director (§6.1) while the parent Live Stream
 * Brief is dispatched ([Dispatched to Vendor]). The LSS- id is minted only after
 * the §6.3 mandatory REQUEST fields validate (house rule #1); born [Requested].
 */
export async function createSession(
  sql: Sql,
  actor: Actor,
  briefId: string,
  input: SessionInput,
  now: Date = new Date(),
): Promise<Session> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);

    // Lock the parent Brief and join up to the owning AM (the §6.1 authority).
    const rows = await tx<{ assigned_division: string; status: string; assigned_am_id: string | null; client_id: string }[]>`
      select b.assigned_division, b.status, c.assigned_am_id, c.id as client_id
      from briefs b
      join services sv on sv.id = b.service_id
      join clients c on c.id = sv.client_id
      where b.id = ${briefId} for update`;
    if (rows.length === 0) {
      throw new NotFoundError(MSG_BRIEF_NOT_FOUND);
    }
    const { assigned_division: division, status: briefStatus, assigned_am_id: ownerAM, client_id: clientId } = rows[0];
    if (division !== LIVE_STREAM_DIVISION) {
      throw new ConflictError(MSG_NOT_LIVE_STREAM_BRIEF);
    }
    // A voided Brief accepts no new Sessions; an [Approved] Brief is closed. Only a
    // dispatched Brief takes Sessions.
    if (briefStatus === BRIEF_VOIDED) {
      throw new ConflictError(MSG_BRIEF_VOIDED);
    }
    if (briefStatus !== BRIEF_VENDOR_DISPATCHED) {
      throw new ConflictError(MSG_BRIEF_NOT_OPEN);
    }
    // LT-61: resolve the client's live-stream vendor BEFORE the gate check, so a
    // vendor Actor creating its own Session request is judged against it too.
    const vendorId = await resolveLiveVendorId(tx, clientId);
    if (!canManageSession(actor, ownerAM) && !canVendorWriteSession(actor, vendorId)) {
      throw new ForbiddenError(MSG_SESSION_MANAGE_FORBIDDEN);
    }

    // §6.3 mandatory REQUEST-field validation BEFORE any id is minted (rule #1).
    const platform = (input.platform ?? '').trim();
    if (platform === '' || (input.requestedDatetime ?? '').trim() === '' || (input.targetDurationHours ?? '').trim() === '') {
      throw new IncompleteError();
    }
    if (!VALID_PLATFORMS.has(platform)) {
      throw new ValidationError(MSG_INVALID_PLATFORM);
    }
    const requestedAt = parseDatetime(input.requestedDatetime);
    const targetDur = parseDuration(input.targetDurationHours);

    const id = await ex.ident.identNext('LSS', now);
    await tx`
      insert into live_stream_sessions
        (id, brief_id, platform, requested_datetime, target_duration_hours,
         products_talent, special_instructions, status, data_confidence_tier, vendor_id, created_by)
      values
        (${id}, ${briefId}, ${platform}, ${requestedAt}, ${targetDur},
         ${nullTrim(input.productsTalent)}, ${nullTrim(input.specialInstructions)}, ${LSS_REQUESTED},
         ${DATA_CONFIDENCE_VENDOR_REPORTED}, ${vendorId}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: 'live_stream_session', entityId: id, actorEmployeeId: actor.employeeId, action: 'create',
      beforeJson: null, afterJson: { status: LSS_REQUESTED, brief_id: briefId, platform },
      createdBy: actor.employeeId,
    });

    return {
      id, briefId, vendorId, platform, requestedDatetime: requestedAt, targetDurationHours: targetDur,
      productsTalent: (input.productsTalent ?? '').trim(), specialInstructions: (input.specialInstructions ?? '').trim(),
      status: LSS_REQUESTED, actualDatetime: null, actualDurationHours: null, viewersPeak: null, viewersAvg: null,
      ordersGenerated: null, gmv: null, gmvDisplay: '', vendorReportLink: '', reconciliationNotes: '',
      dataConfidenceTier: DATA_CONFIDENCE_VENDOR_REPORTED, createdBy: actor.employeeId, createdAt: now,
    };
  });
}

/**
 * resolveLiveVendorId (LT-61) looks up the client's assigned live-stream vendor:
 * the `vendor_id` on the `live` pillar of the client's Aktif Strategi, if any.
 *
 * A client is assumed to have AT MOST ONE live-stream vendor at a time — a
 * genuinely multi-vendor live setup (e.g. one per channel) is a known,
 * documented gap (spec §2), not solved here; `limit 1` picks the most recently
 * touched `live` pillar row deterministically rather than erroring. Returns
 * null when there is no Aktif Strategi, no `live` pillar, or no vendor on it —
 * the Session is then created with `vendor_id = null` and only the owning
 * AM/Director can act on it (the pre-LT-61 path, unchanged).
 */
async function resolveLiveVendorId(tx: Queryable, clientId: string): Promise<string | null> {
  const rows = await tx<{ vendor_id: string }[]>`
    select sp.vendor_id
    from strategi_pillar sp
    join strategi s on s.id = sp.strategi_id
    where s.client_id = ${clientId} and s.status = ${STRATEGI_AKTIF}
      and sp.jenis = 'live' and sp.vendor_id is not null
    order by sp.updated_at desc
    limit 1`;
  return rows.length > 0 ? rows[0].vendor_id : null;
}

// ---------------------------------------------------------------------------
// Lifecycle (M10 §3/§4) — driven through sm_transition (house rule #2). The chain:
//   [Requested] → [Confirmed by Vendor] → [Completed] → { [Reconciled] (terminal)
//                                                        | [Discrepancy Flagged] → [Reconciled] }
// Every edge is the owning AM or Director (§6.1).
// ---------------------------------------------------------------------------

/** The slim locked projection the gates + roll-up need. */
interface SessionRow {
  id: string;
  briefId: string;
  status: string;
  briefStatus: string;
  ownerAM: string | null;
  vendorId: string | null;
}

/** lockSession row-locks a Session and joins up to the parent Brief + owning AM. */
async function lockSession(tx: Queryable, id: string): Promise<SessionRow> {
  const rows = await tx<{ id: string; brief_id: string; status: string; brief_status: string; assigned_am_id: string | null; vendor_id: string | null }[]>`
    select ls.id, ls.brief_id, ls.status, b.status as brief_status, c.assigned_am_id, ls.vendor_id
    from live_stream_sessions ls
    join briefs b on b.id = ls.brief_id
    join services sv on sv.id = b.service_id
    join clients c on c.id = sv.client_id
    where ls.id = ${id} for update`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_SESSION_NOT_FOUND);
  }
  const r = rows[0];
  return {
    id: r.id, briefId: r.brief_id, status: r.status, briefStatus: r.brief_status,
    ownerAM: r.assigned_am_id, vendorId: r.vendor_id,
  };
}

/** A hook run inside the transaction with the locked row (pre- or post-transition). */
type Hook = (tx: Queryable, ex: ReturnType<typeof executors>, r: SessionRow) => Promise<void>;

/**
 * edge is the shared, gated driver for one Session transition. It locks the row,
 * freezes Sessions of a voided Brief (scope: void interaction — no further moves),
 * applies the §6.1 owning-AM/Director gate — plus (LT-61) the assigned vendor's own
 * gate when the caller opts in via `allowVendor` — pins the allowed source states
 * (so each caller means exactly its edge(s)), runs an optional `mutate` (field
 * write / gate) BEFORE the status changes, drives the engine, runs an optional
 * `post` hook, and — for a move into [Reconciled] — recomputes the parent Brief
 * roll-up. All atomic.
 *
 * `allowVendor` defaults to false: reconcile/flagDiscrepancy never pass it, so a
 * vendor Actor cannot reach them no matter how `canVendorWriteSession` evolves.
 */
async function edge(
  sql: Sql,
  actor: Actor,
  id: string,
  from: string[],
  to: string,
  mutate?: Hook,
  post?: Hook,
  opts?: { allowVendor?: boolean },
): Promise<statemachine.TransitionResult> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockSession(tx, id);
    // A Session whose parent Brief was voided is frozen: no further lifecycle moves.
    if (r.briefStatus === BRIEF_VOIDED) {
      throw new ConflictError(MSG_BRIEF_VOIDED);
    }
    const vendorAllowed = !!opts?.allowVendor && canVendorWriteSession(actor, r.vendorId);
    if (!canManageSession(actor, r.ownerAM) && !vendorAllowed) {
      throw new ForbiddenError(MSG_SESSION_MANAGE_FORBIDDEN);
    }
    if (!from.includes(r.status)) {
      throw new ConflictError(bi.TRANSITION_NOT_ALLOWED);
    }
    if (mutate) {
      await mutate(tx, ex, r);
    }
    const res = await statemachine.transition(ex.sm, {
      machine: LIVE_STREAM_MACHINE, entityType: 'live_stream_session', table: 'live_stream_sessions',
      entityId: id, to, actor,
    });
    if (!res.ok) {
      // Pre-checks pin a valid edge, so a rejection here is a race or role gate;
      // surface the engine's verbatim message.
      throw new ConflictError(res.message);
    }
    if (post) {
      await post(tx, ex, r);
    }
    if (to === LSS_RECONCILED) {
      await rollupBriefOnReconcile(tx, ex, actor, r.briefId);
    }
    return res;
  });
}

/**
 * confirmByVendor logs the schedule being confirmed: [Requested] → [Confirmed by
 * Vendor] (§3 Rule 3). Two ways in as of LT-61: the owning AM/Director records a
 * vendor confirmation that arrived out-of-system (the original, still-supported
 * path — a vendor without a CDPS account), OR the assigned vendor itself
 * confirms directly (`allowVendor: true`).
 */
export async function confirmByVendor(sql: Sql, actor: Actor, id: string): Promise<statemachine.TransitionResult> {
  return edge(sql, actor, id, [LSS_REQUESTED], LSS_CONFIRMED, undefined, undefined, { allowVendor: true });
}

/**
 * logResults enters the vendor-reported result and completes the Session:
 * [Confirmed by Vendor] → [Completed] (§4 Flow 2). Gate (§4 Rule 2 / §6.3): actual
 * datetime, actual duration, orders, GMV and the Vendor Report Link are all
 * mandatory; viewers optional. As of LT-61 the assigned vendor may enter its own
 * result directly (`allowVendor: true`), additive to the owning AM/Director path
 * (still needed for a vendor without a CDPS account).
 */
export async function logResults(sql: Sql, actor: Actor, id: string, input: ResultInput): Promise<statemachine.TransitionResult> {
  return edge(sql, actor, id, [LSS_CONFIRMED], LSS_COMPLETED, async (tx) => {
    // Vendor Report Link is called out specifically (§6.3 — audit trail).
    const link = (input.vendorReportLink ?? '').trim();
    if (link === '') {
      throw new ValidationError(MSG_VENDOR_REPORT_LINK_REQUIRED);
    }
    // Remaining result fields: all required before [Completed].
    if (
      (input.actualDatetime ?? '').trim() === '' ||
      (input.actualDurationHours ?? '').trim() === '' ||
      input.ordersGenerated === undefined || input.ordersGenerated === null ||
      (input.gmv ?? '').trim() === ''
    ) {
      throw new IncompleteError();
    }
    const actualAt = parseDatetime(input.actualDatetime);
    const actualDur = parseDuration(input.actualDurationHours);
    if (input.ordersGenerated < 0) {
      throw new IncompleteError();
    }
    const gmv = parseGmv(input.gmv);
    await tx`
      update live_stream_sessions
      set actual_datetime = ${actualAt}, actual_duration_hours = ${actualDur},
          viewers_peak = ${input.viewersPeak ?? null}, viewers_avg = ${input.viewersAvg ?? null},
          orders_generated = ${input.ordersGenerated}, gmv = ${money.decimal(gmv)}, vendor_report_link = ${link}
      where id = ${id}`;
  }, undefined, { allowVendor: true });
}

/**
 * reconcile closes the requested-vs-actual review with a match: → [Reconciled]
 * (terminal, §4 Rule 3). Valid from [Completed] (matched straight away) or from
 * [Discrepancy Flagged] (a flagged gap addressed/accepted after the off-system
 * vendor conversation, §4 Flow 4 — non-blocking). Rolls the parent Brief up.
 */
export async function reconcile(sql: Sql, actor: Actor, id: string): Promise<statemachine.TransitionResult> {
  return edge(sql, actor, id, [LSS_COMPLETED, LSS_DISCREPANCY], LSS_RECONCILED);
}

/**
 * flagDiscrepancy raises a meaningful requested-vs-actual gap: [Completed] →
 * [Discrepancy Flagged] (§4 Rule 3), with mandatory Reconciliation Notes.
 * Non-blocking (§4 Rule 4): the Session may still reach [Reconciled] later. The
 * real-time SPV-Account notification (M10-OA-3) is emitted here, atomic with the
 * transition (the Go engine hook's TS equivalent).
 */
export async function flagDiscrepancy(sql: Sql, actor: Actor, id: string, notes: string): Promise<statemachine.TransitionResult> {
  const trimmed = (notes ?? '').trim();
  return edge(
    sql, actor, id, [LSS_COMPLETED], LSS_DISCREPANCY,
    async (tx) => {
      if (trimmed === '') {
        throw new ValidationError(MSG_RECON_NOTES_REQUIRED);
      }
      await tx`update live_stream_sessions set reconciliation_notes = ${trimmed} where id = ${id}`;
    },
    async (_tx, ex) => {
      await notification.emit(ex.notify, {
        event: notification.EVENTS.SessionDiscrepancyFlagged,
        entityType: 'live_stream_session', entityId: id, actor: actor.employeeId,
        division: ACCOUNT_DIVISION, notifyActor: false,
      });
    },
  );
}

// ---------------------------------------------------------------------------
// Session → Live Stream Brief roll-up (M10 §2/§4). The Brief is OFF-MACHINE, so
// its close to [Approved] is a direct audited UPDATE (action ls_brief_reconciled),
// NOT an engine transition — the same off-machine precedent as the M4 void cascade.
// ---------------------------------------------------------------------------

/**
 * rollupBriefOnReconcile closes the parent Live Stream Brief to [Approved] when
 * every one of its Sessions has reached [Reconciled] (and there is at least one),
 * inside the caller's transaction. Idempotent + forward-only: it fires only while
 * the Brief is still [Dispatched to Vendor]; a voided or already-approved Brief is
 * left alone.
 */
async function rollupBriefOnReconcile(
  tx: Queryable,
  ex: ReturnType<typeof executors>,
  actor: Actor,
  briefId: string,
): Promise<void> {
  if (!briefId) {
    return;
  }
  const brief = await tx<{ status: string }[]>`select status from briefs where id = ${briefId} for update`;
  if (brief.length === 0) {
    throw new NotFoundError(MSG_BRIEF_NOT_FOUND);
  }
  // Only a still-dispatched Brief closes here. A voided Brief never rolls up; an
  // already-[Approved] Brief is a no-op.
  if (brief[0].status !== BRIEF_VENDOR_DISPATCHED) {
    return;
  }

  const counts = await tx<{ total: number; reconciled: number }[]>`
    select count(*)::int as total,
           coalesce(sum(case when status = ${LSS_RECONCILED} then 1 else 0 end), 0)::int as reconciled
    from live_stream_sessions where brief_id = ${briefId}`;
  const { total, reconciled } = counts[0];
  if (total === 0 || reconciled !== total) {
    return; // not every Session reconciled yet (need >= 1 and all)
  }

  await tx`update briefs set status = ${BRIEF_APPROVED} where id = ${briefId}`;
  await ex.audit.insertAudit({
    entityType: 'brief', entityId: briefId, actorEmployeeId: actor.employeeId, action: 'ls_brief_reconciled',
    beforeJson: { status: BRIEF_VENDOR_DISPATCHED }, afterJson: { status: BRIEF_APPROVED, reconciled_sessions: total },
    createdBy: actor.employeeId,
  });
}

// ---------------------------------------------------------------------------
// Brief reopen (DECISIONS O27 / W2-M10-C2).
// ---------------------------------------------------------------------------

/**
 * reopenBrief reopens an [Approved] Live Stream Brief back to [Dispatched to
 * Vendor] to add Sessions for a recurring package's running period (M10-OA-4). An
 * off-machine audited action (ls_brief_reopened, symmetric to ls_brief_reconciled),
 * allowed ONLY from [Approved], ONLY for a Live-Stream-division Brief, NEVER for a
 * voided Brief; actor gate = owning AM or Director. After reopen the existing
 * roll-up re-closes the Brief once ALL Sessions (old + new) are [Reconciled].
 */
export async function reopenBrief(sql: Sql, actor: Actor, briefId: string): Promise<void> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const rows = await tx<{ assigned_division: string; status: string; assigned_am_id: string | null }[]>`
      select b.assigned_division, b.status, c.assigned_am_id
      from briefs b
      join services sv on sv.id = b.service_id
      join clients c on c.id = sv.client_id
      where b.id = ${briefId} for update`;
    if (rows.length === 0) {
      throw new NotFoundError(MSG_BRIEF_NOT_FOUND);
    }
    const { assigned_division: division, status: briefStatus, assigned_am_id: ownerAM } = rows[0];
    if (division !== LIVE_STREAM_DIVISION) {
      throw new ConflictError(MSG_NOT_LIVE_STREAM_BRIEF);
    }
    if (briefStatus === BRIEF_VOIDED) {
      throw new ConflictError(MSG_BRIEF_VOIDED);
    }
    if (!canManageSession(actor, ownerAM)) {
      throw new ForbiddenError(MSG_BRIEF_REOPEN_FORBIDDEN);
    }
    if (briefStatus !== BRIEF_APPROVED) {
      throw new ConflictError(MSG_BRIEF_NOT_REOPENABLE);
    }

    await tx`update briefs set status = ${BRIEF_VENDOR_DISPATCHED} where id = ${briefId}`;
    await ex.audit.insertAudit({
      entityType: 'brief', entityId: briefId, actorEmployeeId: actor.employeeId, action: 'ls_brief_reopened',
      beforeJson: { status: BRIEF_APPROVED }, afterJson: { status: BRIEF_VENDOR_DISPATCHED }, createdBy: actor.employeeId,
    });
  });
}

// ---------------------------------------------------------------------------
// Reads (§6.1). GMV renders in the house IDR format at full vendor-reported value;
// the Data Confidence Tier is the auto Vendor-Reported badge.
// ---------------------------------------------------------------------------

interface SessionScanRow {
  id: string;
  brief_id: string;
  vendor_id: string | null;
  platform: string;
  requested_datetime: Date;
  target_duration_hours: string;
  products_talent: string;
  special_instructions: string;
  status: string;
  actual_datetime: Date | null;
  actual_duration_hours: string | null;
  viewers_peak: number | null;
  viewers_avg: number | null;
  orders_generated: number | null;
  gmv: string | null;
  vendor_report_link: string;
  reconciliation_notes: string;
  data_confidence_tier: string;
  created_by: string;
  created_at: Date;
  assigned_am_id: string | null;
}

/** scanSession maps a DB row into a Session (+ the owning AM for the read gate). */
function scanSession(r: SessionScanRow): { session: Session; ownerAM: string | null } {
  let gmv: string | null = null;
  let gmvDisplay = '';
  if (r.gmv !== null) {
    const amt = money.parse(r.gmv);
    gmv = money.decimal(amt);
    gmvDisplay = money.format(amt);
  }
  return {
    session: {
      id: r.id, briefId: r.brief_id, vendorId: r.vendor_id, platform: r.platform, requestedDatetime: r.requested_datetime,
      targetDurationHours: Number(r.target_duration_hours), productsTalent: r.products_talent,
      specialInstructions: r.special_instructions, status: r.status, actualDatetime: r.actual_datetime,
      actualDurationHours: r.actual_duration_hours === null ? null : Number(r.actual_duration_hours),
      viewersPeak: r.viewers_peak, viewersAvg: r.viewers_avg, ordersGenerated: r.orders_generated,
      gmv, gmvDisplay, vendorReportLink: r.vendor_report_link, reconciliationNotes: r.reconciliation_notes,
      dataConfidenceTier: r.data_confidence_tier, createdBy: r.created_by, createdAt: r.created_at,
    },
    ownerAM: r.assigned_am_id,
  };
}

/**
 * getSession returns one Session if the actor may see it (§6.1): OD/Director;
 * Account lead/SPV (division-wide); or the owning AM.
 */
export async function getSession(sql: Queryable, actor: Actor, sessionId: string): Promise<Session> {
  const rows = await sql<SessionScanRow[]>`
    select ls.id, ls.brief_id, ls.vendor_id, ls.platform, ls.requested_datetime, ls.target_duration_hours,
           coalesce(ls.products_talent, '') as products_talent,
           coalesce(ls.special_instructions, '') as special_instructions, ls.status,
           ls.actual_datetime, ls.actual_duration_hours, ls.viewers_peak, ls.viewers_avg,
           ls.orders_generated, ls.gmv, coalesce(ls.vendor_report_link, '') as vendor_report_link,
           coalesce(ls.reconciliation_notes, '') as reconciliation_notes, ls.data_confidence_tier,
           ls.created_by, ls.created_at, c.assigned_am_id
    from live_stream_sessions ls
    join briefs b on b.id = ls.brief_id
    join services sv on sv.id = b.service_id
    join clients c on c.id = sv.client_id
    where ls.id = ${sessionId}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_SESSION_NOT_FOUND);
  }
  const { session, ownerAM } = scanSession(rows[0]);
  if (!canSeeSession(actor, ownerAM, session.vendorId)) {
    throw new ForbiddenError(MSG_SESSION_VIEW_FORBIDDEN);
  }
  return session;
}

/**
 * listBriefSessions returns every Session of a Live Stream Brief (fan-out
 * progress), ordered by id. Same read gate, resolved from the parent Brief's AM.
 */
export async function listBriefSessions(sql: Queryable, actor: Actor, briefId: string): Promise<Session[]> {
  const meta = await sql<{ assigned_division: string; assigned_am_id: string | null; client_id: string }[]>`
    select b.assigned_division, c.assigned_am_id, c.id as client_id
    from briefs b join services sv on sv.id = b.service_id join clients c on c.id = sv.client_id
    where b.id = ${briefId}`;
  if (meta.length === 0) {
    throw new NotFoundError(MSG_BRIEF_NOT_FOUND);
  }
  if (meta[0].assigned_division !== LIVE_STREAM_DIVISION) {
    throw new ConflictError(MSG_NOT_LIVE_STREAM_BRIEF);
  }
  // LT-61: a Brief's Sessions all share the same client, so the client's live
  // vendor (resolveLiveVendorId) is a single, brief-level read gate — same
  // "one vendor per client" simplification `createSession` stamps rows with.
  const vendorId = await resolveLiveVendorId(sql, meta[0].client_id);
  if (!canSeeSession(actor, meta[0].assigned_am_id, vendorId)) {
    throw new ForbiddenError(MSG_SESSION_VIEW_FORBIDDEN);
  }
  const rows = await sql<SessionScanRow[]>`
    select ls.id, ls.brief_id, ls.vendor_id, ls.platform, ls.requested_datetime, ls.target_duration_hours,
           coalesce(ls.products_talent, '') as products_talent,
           coalesce(ls.special_instructions, '') as special_instructions, ls.status,
           ls.actual_datetime, ls.actual_duration_hours, ls.viewers_peak, ls.viewers_avg,
           ls.orders_generated, ls.gmv, coalesce(ls.vendor_report_link, '') as vendor_report_link,
           coalesce(ls.reconciliation_notes, '') as reconciliation_notes, ls.data_confidence_tier,
           ls.created_by, ls.created_at, c.assigned_am_id
    from live_stream_sessions ls
    join briefs b on b.id = ls.brief_id
    join services sv on sv.id = b.service_id
    join clients c on c.id = sv.client_id
    where ls.brief_id = ${briefId} order by ls.id asc`;
  return rows.map((r) => scanSession(r).session);
}

/**
 * listVendorSessions (LT-61) — every Session assigned to the calling vendor
 * Actor, across all Briefs/clients, newest request first. The vendor-facing
 * counterpart to `listBriefSessions` (which needs a Brief id the vendor has no
 * way to already know). Read-only; the AM/Director list path is unaffected.
 */
export async function listVendorSessions(sql: Queryable, actor: Actor): Promise<Session[]> {
  const vendorId = actor.vendorId;
  if (!vendorId) {
    return [];
  }
  const rows = await sql<SessionScanRow[]>`
    select ls.id, ls.brief_id, ls.vendor_id, ls.platform, ls.requested_datetime, ls.target_duration_hours,
           coalesce(ls.products_talent, '') as products_talent,
           coalesce(ls.special_instructions, '') as special_instructions, ls.status,
           ls.actual_datetime, ls.actual_duration_hours, ls.viewers_peak, ls.viewers_avg,
           ls.orders_generated, ls.gmv, coalesce(ls.vendor_report_link, '') as vendor_report_link,
           coalesce(ls.reconciliation_notes, '') as reconciliation_notes, ls.data_confidence_tier,
           ls.created_by, ls.created_at, null as assigned_am_id
    from live_stream_sessions ls
    where ls.vendor_id = ${vendorId}
    order by ls.requested_datetime desc`;
  return rows.map((r) => scanSession(r).session);
}

/** One open Live Stream Brief a vendor may create a new Session under (LT-61 FE). */
export interface VendorBrief {
  id: string;
  clientToko: string;
}

/**
 * listVendorBriefs (LT-61 FE) — every Live Stream Brief the calling vendor Actor
 * may create a new Session under via the existing `POST /briefs/{id}/sessions`.
 *
 * Solves a discovery gap the FE-only work surfaces: the vendor has
 * `listVendorSessions` for its own Sessions, but a Session does not exist
 * until a Brief id is known, and a vendor has no other way to learn one
 * (HANDOFF_LT61_CORE_SELESAI_FE_VENDOR_20260830.md §3.2). Read-only; no new
 * write scope. A Brief qualifies when it is open for new Sessions
 * (`assigned_division = Live Stream`, `status = [Dispatched to Vendor]` —
 * `createSession`'s own gate, MSG_BRIEF_NOT_OPEN) AND `resolveLiveVendorId`
 * — the SAME client-vendor resolution `createSession` itself uses — picks
 * this vendor. Reusing that resolver (rather than a second query) keeps this
 * list from ever showing a Brief `createSession` would then reject.
 */
export async function listVendorBriefs(sql: Queryable, actor: Actor): Promise<VendorBrief[]> {
  const vendorId = actor.vendorId;
  if (!vendorId) {
    return [];
  }
  const rows = await sql<{ id: string; client_id: string; toko: string }[]>`
    select b.id, c.id as client_id, c.toko
    from briefs b
    join services sv on sv.id = b.service_id
    join clients c on c.id = sv.client_id
    where b.assigned_division = ${LIVE_STREAM_DIVISION} and b.status = ${BRIEF_VENDOR_DISPATCHED}
    order by b.id desc`;
  const out: VendorBrief[] = [];
  for (const r of rows) {
    const resolved = await resolveLiveVendorId(sql, r.client_id);
    if (resolved === vendorId) {
      out.push({ id: r.id, clientToko: r.toko });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** parseGmv parses a non-negative IDR amount, else ValidationError (verbatim BI). */
function parseGmv(s: string): money.Money {
  let amt: money.Money;
  try {
    amt = money.parse(s);
  } catch {
    throw new ValidationError(MSG_BAD_AMOUNT);
  }
  if (amt < 0n) {
    throw new ValidationError(MSG_BAD_AMOUNT);
  }
  return amt;
}

/** parseDuration parses positive decimal hours; else ValidationError (verbatim BI). */
function parseDuration(s: string): number {
  const f = Number((s ?? '').trim());
  if (!Number.isFinite(f) || f <= 0) {
    throw new ValidationError(MSG_INVALID_DURATION);
  }
  return f;
}

/**
 * parseDatetime accepts a "YYYY-MM-DD HH:MM[:SS]" / RFC3339 timestamp and returns
 * an absolute Date, else ValidationError (verbatim BI). A zoneless literal is read
 * as UTC (mirroring Go's time.Parse of a zoneless layout) so round-trips are
 * deterministic and independent of the host timezone.
 */
function parseDatetime(raw: string): Date {
  const s = (raw ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (!m) {
    throw new ValidationError(MSG_BAD_DATETIME);
  }
  const [, y, mo, d, h, mi, se, zone] = m;
  let dt: Date;
  if (zone) {
    dt = new Date(`${y}-${mo}-${d}T${h}:${mi}:${se ?? '00'}${zone}`);
  } else {
    dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, se ? +se : 0));
  }
  if (Number.isNaN(dt.getTime())) {
    throw new ValidationError(MSG_BAD_DATETIME);
  }
  // Reject values that rolled over (e.g. month 13, day 32) for a strict parse.
  if (!zone && (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +mo - 1 || dt.getUTCDate() !== +d)) {
    throw new ValidationError(MSG_BAD_DATETIME);
  }
  return dt;
}

/** nullTrim stores an empty/absent optional string as SQL NULL. */
function nullTrim(s: string | undefined): string | null {
  return s && s.trim() !== '' ? s.trim() : null;
}
