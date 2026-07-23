/**
 * Leads-database domain service (M1 registration door + M0 §3 Lead Registration),
 * ported to the Supabase stack from Go's `internal/module1_leads`.
 *
 * This is the ENTRY POINT of the whole CDPS money path: a salesperson registers
 * (or claims) a lead, which mints a central LEAD- record and the salesperson's
 * PRSP- prospect attempt. It exercises all four core executors through one
 * @cdps/db transaction — ident (LEAD + PRSP), sm_transition (lead_record, on the
 * reopen path), audit, and notify (co-pursuit) — so an @cdps/api route handler is
 * a thin shell over `register`.
 *
 * House rules honored here (CLAUDE.md §Non-negotiable):
 *   - IDs (LEAD/PRSP) minted ONLY after the mandatory-field gate passes.
 *   - record_status / attempt status written ONLY through sm_transition on the
 *     reopen path; the birth insert seeds the initial state directly (as the
 *     demo vertical seeds [To Do]) — never a raw UPDATE of a status column.
 *   - Every decision — create, reopen, join, AND block — appends to the audit log
 *     (M1 §5 Rule 6); a co-pursuit join emits the frozen m1.lead.co_pursuit event.
 *
 * Dedup v2 (collaborative, DECISIONS 2026-07-10, arahan Nerissa): a single
 * registration on a phone another salesperson already holds is NOT blocked — the
 * system records every salesperson pursuing the lead (multi-attempt) and notifies
 * "lead juga sedang dikerjakan sales lain".
 *
 * Deferred to their own waves (kept out of this money-path slice, matching build
 * order): campaign linkage / Source auto-derivation (M3, Wave 3) and the
 * Marketing bulk-import door (M1 §3).
 *
 * Reference: backend/internal/module1_leads/{leads,dedup,normalize,reads}.go.
 */

import { bi, notification, permission, statemachine } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';

/** Authenticated employee + resolved role (from @cdps/core permission). */
export type Actor = permission.Actor;

/** lead_record machine (seeded in 20260102000002_statemachine.sql). */
export const LEAD_MACHINE = 'lead_record';

/** Lead record birth status (active) and the Pool waypoint on the reopen path. */
export const RECORD_ACTIVE = 'active';
export const RECORD_POOL = '[Pool]';

/** Prospect attempt birth status (post-validation; PRSP id minted here). */
export const ATTEMPT_NEW_LEAD = 'New Lead';

/** The CDPS division that owns scouted leads / attempts. */
export const SALES_DIVISION = 'Sales';

// ---------------------------------------------------------------------------
// Verbatim BI messages (M1 §3/§4/§5, quoted per originating section). These are
// module-local per bi.ts scope note (only engine-shared strings live in core).
// ---------------------------------------------------------------------------

/** A won lead is already a client — blocks on every door. */
export const MSG_ALREADY_CLIENT = '[lead sudah menjadi klien]';
/** A Pool record is claimed through the Pool flow, not re-registered. */
export const MSG_DUPLICATE_POOL = '[lead sudah ada & sedang diproses, tidak diimport]';
/** The actor already holds an open attempt on this lead (cannot double-open). */
export const MSG_ALREADY_OWN_ATTEMPT = '[anda sudah memiliki prospek aktif untuk lead ini]';
/** Import-door block wording (kept for the pure decision table; not used by the single-reg door). */
export const MSG_ACTIVE_OTHER_SALES_IMPORT = '[lead sedang diproses oleh sales lain (nama)]';
/** NON-error notice returned on a co-pursuit join when others already pursue the lead. */
export const MSG_LEAD_CO_WORKED = '[lead juga sedang dikerjakan sales lain]';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Mandatory-field gate failure (carries the exact global BI message). */
export class IncompleteError extends Error {
  constructor() {
    super(bi.INCOMPLETE_DATA);
    this.name = 'LeadIncompleteError';
  }
}

/** Requested lead does not exist. */
export class NotFoundError extends Error {
  constructor(message = 'lead not found') {
    super(message);
    this.name = 'LeadNotFoundError';
  }
}

/** Dedup block — carries the verbatim BI `[...]` message; maps to HTTP 409. */
export class BlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeadBlockedError';
  }
}

// ---------------------------------------------------------------------------
// Phone normalization — the dedup PRIMARY key (M1 §5, §9.4).
// ---------------------------------------------------------------------------

/**
 * normalizePhone returns the canonical dedup key: strip every non-digit, then
 * drop a leading "62" country code (else a single leading "0"). "+62 812-3456",
 * "0812 3456" and "812.3456" all collapse to "8123456". Empty / digit-less → "".
 */
export function normalizePhone(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('62') && digits.length > 2) {
    return digits.slice(2);
  }
  if (digits.startsWith('0')) {
    return digits.replace(/^0+/, '');
  }
  return digits;
}

// ---------------------------------------------------------------------------
// Pure dedup decision table (M1 §5 Rule 4, dedup v2).
// ---------------------------------------------------------------------------

/** Intake door: affects active-lead wording and single-reg co-pursuit joins. */
export const CHANNEL_IMPORT = 'import';
export const CHANNEL_SINGLE_REG = 'single_reg';
export type Channel = typeof CHANNEL_IMPORT | typeof CHANNEL_SINGLE_REG;

/** Record statuses the dedup table branches on (subset of the machine). */
const STATUS_POOL = '[Pool]';
const STATUS_REJECTED = '[Rejected]';
const STATUS_NOT_QUALIFIED = '[Not Qualified]';
const STATUS_CLOSED_WIN = '[Closed-Success]';

/** Terminal attempt statuses — an attempt in one no longer marks a lead worked. */
const TERMINAL_ATTEMPT_STATUSES = new Set<string>([
  'Not Qualified',
  'Closed-Success',
  'Closed-Lost',
  'Blocked',
  '[Closed - Kalah Kompetisi]',
]);

/** isTerminalAttemptStatus reports whether a status counts as "not actively worked". */
export function isTerminalAttemptStatus(status: string): boolean {
  return TERMINAL_ATTEMPT_STATUSES.has(status);
}

/** One holder of a non-terminal attempt on the matched lead. */
export interface OpenAttempt {
  ownerEmployeeId: string;
  /** resolved employee name, or the raw id when unsynced (O19). */
  ownerName: string;
}

/** The record a new intake matched on normalized phone + its open attempts. */
export interface ExistingLead {
  id: string;
  recordStatus: string;
  openAttempts: OpenAttempt[];
}

export type Outcome = 'create' | 'block' | 'reopen' | 'join';

/** Result of the dedup table. */
export interface Decision {
  outcome: Outcome;
  /** BI message when blocked ("" otherwise). */
  message: string;
  /** set when outcome === 'reopen'. */
  reopenLeadId: string;
  /** set when outcome === 'join'. */
  joinLeadId: string;
  /** outcome === 'join': other open-attempt owners (notification recipients). */
  coOwners: string[];
}

function actorHoldsOpenAttempt(m: ExistingLead, actor: string): boolean {
  return actor !== '' && m.openAttempts.some((a) => a.ownerEmployeeId === actor);
}

function otherOwners(m: ExistingLead, actor: string): string[] {
  return m.openAttempts
    .map((a) => a.ownerEmployeeId)
    .filter((id) => id !== '' && id !== actor);
}

function interpolateOwner(msg: string, owner: string): string {
  return owner === '' ? msg : msg.replace('(nama)', `(${owner})`);
}

/**
 * decide runs the registration-door decision table (M1 §5 Rule 4, v2).
 *
 * actorEmployeeId identifies the registering salesperson: single registration
 * passes it so "my own open attempt" (block) is told apart from "another sales"
 * (join); the import door passes "" (any holder blocks — M1-OA-6).
 */
export function decide(channel: Channel, match: ExistingLead | null, actor: string): Decision {
  const base: Decision = { outcome: 'create', message: '', reopenLeadId: '', joinLeadId: '', coOwners: [] };
  if (match === null) {
    return base;
  }

  // A won lead is already a client — blocks on every door.
  if (match.recordStatus === STATUS_CLOSED_WIN) {
    return { ...base, outcome: 'block', message: MSG_ALREADY_CLIENT };
  }

  // Someone is actively working this lead.
  if (match.openAttempts.length > 0) {
    if (channel === CHANNEL_SINGLE_REG) {
      if (actorHoldsOpenAttempt(match, actor)) {
        return { ...base, outcome: 'block', message: MSG_ALREADY_OWN_ATTEMPT };
      }
      // Held only by other salespeople — collaborative co-pursuit (v2).
      return { ...base, outcome: 'join', joinLeadId: match.id, coOwners: otherOwners(match, actor) };
    }
    // Import never distinguishes the actor: any open attempt blocks (M1-OA-6).
    return { ...base, outcome: 'block', message: interpolateOwner(MSG_ACTIVE_OTHER_SALES_IMPORT, ownerName(match)) };
  }

  // Nobody is holding an open attempt: fall back to the record status.
  switch (match.recordStatus) {
    case STATUS_POOL:
      // Pool is claimed through the Pool flow (§6), so a fresh intake is blocked.
      return { ...base, outcome: 'block', message: MSG_DUPLICATE_POOL };
    case STATUS_REJECTED:
    case STATUS_NOT_QUALIFIED:
      return { ...base, outcome: 'reopen', reopenLeadId: match.id };
    default:
      // An active record with nobody holding it: single-reg attaches an attempt.
      if (channel === CHANNEL_SINGLE_REG) {
        return { ...base, outcome: 'join', joinLeadId: match.id };
      }
      return { ...base, outcome: 'block', message: interpolateOwner(MSG_ACTIVE_OTHER_SALES_IMPORT, ownerName(match)) };
  }
}

function ownerName(m: ExistingLead): string {
  return m.openAttempts.length > 0 ? m.openAttempts[0].ownerName : '';
}

// ---------------------------------------------------------------------------
// Registration door (transactional).
// ---------------------------------------------------------------------------

/** Sales single-registration fields (snake_case wire contract). */
export interface RegisterInput {
  leadName: string;
  phoneNumber: string;
  email?: string;
  source?: string;
}

/** A lead record row (subset). */
export interface Lead {
  id: string;
  leadName: string;
  phoneNumber: string;
  email: string;
  source: string;
  recordStatus: string;
}

/** A prospect attempt row (subset). */
export interface Attempt {
  id: string;
  leadId: string;
  owner: string;
  status: string;
}

/** register result: the lead, the actor's attempt, and a NON-error BI notice. */
export interface RegisterResult {
  lead: Lead;
  attempt: Attempt;
  /** MSG_LEAD_CO_WORKED on a co-pursuit join with other active owners; "" otherwise. */
  notice: string;
}

/** valid is the single-registration mandatory-field gate (name + phone). */
function valid(input: RegisterInput): boolean {
  return (input.leadName?.trim() ?? '') !== '' && (input.phoneNumber?.trim() ?? '') !== '';
}

/**
 * register is Sales single registration of a scouted lead (M1 §4 / M0 §3, dedup
 * v2). It runs the dedup door and either creates a fresh active LEAD + PRSP,
 * reopens a terminal record and attaches an attempt, joins an already-worked lead
 * as a co-pursuit, or blocks with the verbatim BI message (BlockedError).
 *
 * Everything runs in one transaction so a rolled-back lead insert consumes no
 * LEAD/PRSP sequence number and writes no audit. A block still commits its
 * audit row (the blocked attempt is recorded) before the BlockedError surfaces.
 */
export async function register(sql: Sql, actor: Actor, input: RegisterInput): Promise<RegisterResult> {
  if (!valid(input)) {
    throw new IncompleteError();
  }
  const leadName = input.leadName.trim();
  const phoneNumber = input.phoneNumber.trim();
  const phoneNorm = normalizePhone(phoneNumber);
  const email = input.email?.trim() ?? '';
  const source = input.source?.trim() ?? '';
  const now = new Date();

  // Discriminated result so a block can COMMIT its audit yet still surface an
  // error to the caller (a throw inside the tx would roll the audit back).
  type Committed =
    | { kind: 'blocked'; message: string }
    | { kind: 'ok'; result: RegisterResult };

  const committed = await withTransaction(sql, async (tx): Promise<Committed> => {
    const ex = executors(tx);
    const match = await matchByPhone(tx, phoneNorm);
    const decision = decide(CHANNEL_SINGLE_REG, match, actor.employeeId);

    switch (decision.outcome) {
      case 'block': {
        // Audit the blocked attempt on the matched record (M1 §5 Rule 6).
        await ex.audit.insertAudit({
          entityType: 'lead', entityId: match!.id, actorEmployeeId: actor.employeeId,
          action: 'dedup_blocked', beforeJson: null,
          afterJson: { channel: CHANNEL_SINGLE_REG, message: decision.message },
          createdBy: actor.employeeId,
        });
        return { kind: 'blocked', message: decision.message };
      }

      case 'reopen': {
        // Terminal -> [Pool] -> active, then attach this salesperson's attempt.
        await reopen(ex.sm, decision.reopenLeadId, RECORD_POOL, actor);
        await reopen(ex.sm, decision.reopenLeadId, RECORD_ACTIVE, actor);
        const attempt = await insertAttempt(tx, ex, decision.reopenLeadId, actor, now);
        const lead = await loadLead(tx, decision.reopenLeadId);
        return { kind: 'ok', result: { lead, attempt, notice: '' } };
      }

      case 'join': {
        // Co-pursuit: attach a new attempt WITHOUT any record_status transition
        // (the lead stays active; status only ever moves through the engine).
        const attempt = await insertAttempt(tx, ex, decision.joinLeadId, actor, now);
        await ex.audit.insertAudit({
          entityType: 'lead', entityId: decision.joinLeadId, actorEmployeeId: actor.employeeId,
          action: 'dedup_join', beforeJson: null,
          afterJson: { channel: CHANNEL_SINGLE_REG, attempt_id: attempt.id, co_owners: decision.coOwners },
          createdBy: actor.employeeId,
        });
        let notice = '';
        if (decision.coOwners.length > 0) {
          await notification.emit(ex.notify, {
            event: notification.EVENTS.LeadCoPursuit,
            entityType: 'lead', entityId: decision.joinLeadId, actor: actor.employeeId,
            explicitRecipients: decision.coOwners, notifyActor: true,
            deepLink: `/leads/${decision.joinLeadId}`,
          });
          notice = MSG_LEAD_CO_WORKED;
        }
        const lead = await loadLead(tx, decision.joinLeadId);
        return { kind: 'ok', result: { lead, attempt, notice } };
      }

      default: {
        // OutcomeCreate: mint a fresh active LEAD + the actor's attempt.
        const leadId = await ex.ident.identNext('LEAD', now);
        await tx`
          insert into leads
            (id, lead_name, phone_number, phone_norm, email, source, origin_division, record_status, created_by)
          values
            (${leadId}, ${leadName}, ${phoneNumber}, ${phoneNorm}, ${email === '' ? null : email},
             ${source}, ${SALES_DIVISION}, ${RECORD_ACTIVE}, ${actor.employeeId})`;
        await ex.audit.insertAudit({
          entityType: 'lead', entityId: leadId, actorEmployeeId: actor.employeeId,
          action: 'create', beforeJson: null,
          afterJson: { record_status: RECORD_ACTIVE, source }, createdBy: actor.employeeId,
        });
        const attempt = await insertAttempt(tx, ex, leadId, actor, now);
        const lead: Lead = {
          id: leadId, leadName, phoneNumber, email, source, recordStatus: RECORD_ACTIVE,
        };
        return { kind: 'ok', result: { lead, attempt, notice: '' } };
      }
    }
  });

  if (committed.kind === 'blocked') {
    throw new BlockedError(committed.message);
  }
  return committed.result;
}

/** insertAttempt mints a PRSP owned by actor at New Lead (post-validation). */
async function insertAttempt(
  tx: Queryable,
  ex: ReturnType<typeof executors>,
  leadId: string,
  actor: Actor,
  now: Date,
): Promise<Attempt> {
  const id = await ex.ident.identNext('PRSP', now);
  await tx`
    insert into prospect_attempts (id, lead_id, owner_employee_id, status, created_by)
    values (${id}, ${leadId}, ${actor.employeeId}, ${ATTEMPT_NEW_LEAD}, ${actor.employeeId})`;
  await ex.audit.insertAudit({
    entityType: 'prospect_attempt', entityId: id, actorEmployeeId: actor.employeeId,
    action: 'create', beforeJson: null,
    afterJson: { status: ATTEMPT_NEW_LEAD, lead_id: leadId }, createdBy: actor.employeeId,
  });
  return { id, leadId, owner: actor.employeeId, status: ATTEMPT_NEW_LEAD };
}

/**
 * reopen drives the lead_record machine one edge on the birth reopen path. These
 * edges ([Rejected]/[Not Qualified] -> [Pool] -> active) are always valid, so a
 * rejection here means concurrent modification — throw to roll the whole door back.
 */
async function reopen(
  sm: statemachine.SmExecutor,
  leadId: string,
  to: string,
  actor: Actor,
): Promise<void> {
  const res = await statemachine.transition(sm, {
    machine: LEAD_MACHINE,
    entityType: 'lead',
    table: 'leads',
    statusColumn: 'record_status',
    entityId: leadId,
    to,
    actor,
  });
  if (!res.ok) {
    throw new Error(`lead reopen ${leadId} -> ${to} failed: ${res.message}`);
  }
}

// ---------------------------------------------------------------------------
// Reads. Scope is enforced by RLS (as with the demo vertical); these shape the
// row for the API and are safe over a service-role or user-scoped handle.
// ---------------------------------------------------------------------------

/** One attempt in a lead's contest (detail view). */
export interface LeadAttemptRow {
  id: string;
  ownerEmployeeId: string;
  ownerNama: string;
  status: string;
  claimedAt: Date;
}

/** Lead detail: the record plus every attempt on it, oldest first. */
export interface LeadDetail extends Lead {
  originDivision: string;
  winningAttemptId: string | null;
  createdAt: Date;
  attempts: LeadAttemptRow[];
}

interface LeadListRow {
  id: string;
  lead_name: string;
  phone_number: string;
  email: string | null;
  source: string;
  origin_division: string;
  record_status: string;
  winning_attempt_id: string | null;
  created_at: Date;
}

function toLead(r: LeadListRow): Lead {
  return {
    id: r.id, leadName: r.lead_name, phoneNumber: r.phone_number,
    email: r.email ?? '', source: r.source, recordStatus: r.record_status,
  };
}

/** list returns lead records, newest first. */
export async function list(sql: Queryable): Promise<(Lead & { originDivision: string; createdAt: Date })[]> {
  const rows = await sql<LeadListRow[]>`
    select id, lead_name, phone_number, email, source, origin_division,
           record_status, winning_attempt_id, created_at
    from leads order by created_at desc, id desc`;
  return rows.map((r) => ({ ...toLead(r), originDivision: r.origin_division, createdAt: r.created_at }));
}

/** get returns a lead + its attempt contest (throws NotFoundError if absent). */
export async function get(sql: Queryable, id: string): Promise<LeadDetail> {
  const rows = await sql<LeadListRow[]>`
    select id, lead_name, phone_number, email, source, origin_division,
           record_status, winning_attempt_id, created_at
    from leads where id = ${id}`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  const r = rows[0];
  const attempts = await sql<
    { id: string; owner_employee_id: string; owner_nama: string; status: string; claimed_at: Date }[]
  >`
    select pa.id, pa.owner_employee_id,
           coalesce(e.nama, pa.owner_employee_id) as owner_nama,
           pa.status, pa.claimed_at
    from prospect_attempts pa
    left join employees e on e.employee_id = pa.owner_employee_id
    where pa.lead_id = ${id}
    order by pa.created_at, pa.id`;
  return {
    ...toLead(r),
    originDivision: r.origin_division,
    winningAttemptId: r.winning_attempt_id,
    createdAt: r.created_at,
    attempts: attempts.map((a) => ({
      id: a.id, ownerEmployeeId: a.owner_employee_id, ownerNama: a.owner_nama,
      status: a.status, claimedAt: a.claimed_at,
    })),
  };
}

/**
 * matchByPhone returns the most-recent lead matching phoneNorm (or null), with
 * every OPEN (non-terminal) attempt on it. employees is LEFT JOINed and the owner
 * name COALESCEd to the raw id, so an attempt owned by an unsynced employee is
 * still counted for dedup (O19).
 */
export async function matchByPhone(q: Queryable, phoneNorm: string): Promise<ExistingLead | null> {
  if (phoneNorm === '') {
    return null;
  }
  const leadRows = await q<{ id: string; record_status: string }[]>`
    select id, record_status from leads
    where phone_norm = ${phoneNorm}
    order by created_at desc, id desc limit 1`;
  if (leadRows.length === 0) {
    return null;
  }
  const m: ExistingLead = { id: leadRows[0].id, recordStatus: leadRows[0].record_status, openAttempts: [] };
  const attemptRows = await q<{ owner_employee_id: string; owner_name: string; status: string }[]>`
    select pa.owner_employee_id,
           coalesce(e.nama, pa.owner_employee_id) as owner_name,
           pa.status
    from prospect_attempts pa
    left join employees e on e.employee_id = pa.owner_employee_id
    where pa.lead_id = ${m.id}`;
  for (const a of attemptRows) {
    if (!isTerminalAttemptStatus(a.status)) {
      m.openAttempts.push({ ownerEmployeeId: a.owner_employee_id, ownerName: a.owner_name });
    }
  }
  return m;
}

async function loadLead(tx: Queryable, id: string): Promise<Lead> {
  const rows = await tx<LeadListRow[]>`
    select id, lead_name, phone_number, email, source, origin_division,
           record_status, winning_attempt_id, created_at
    from leads where id = ${id}`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  return toLead(rows[0]);
}

// ---------------------------------------------------------------------------
// Win resolution (M1 §6 rule 5) — fired from M0 Closing inside the closing tx.
// ---------------------------------------------------------------------------

/** Auto pool-competition loss status. */
export const ATTEMPT_CLOSED_KALAH = '[Closed - Kalah Kompetisi]';

/** A lead's win was already resolved (a second resolution is rejected). */
export class AlreadyResolvedError extends Error {
  constructor() {
    super('lead win already resolved');
    this.name = 'LeadAlreadyResolvedError';
  }
}

/**
 * SYSTEM_ACTOR drives the auto competition-loss transitions. Director authority
 * lets it pass any role gate; the audit row records SYSTEM as the actor.
 */
const SYSTEM_ACTOR: Actor = { employeeId: 'SYSTEM', role: permission.makeRole({ director: true }) };

/**
 * resolveWin records the winning attempt on a lead and closes every OTHER open
 * attempt as [Closed - Kalah Kompetisi] (M1 §6 rule 5). It MUST run inside the
 * caller's transaction (the M0 Closing tx) so the win is atomic with the
 * winner's Closed-Success transition — there is never more than one winner. The
 * lead row is locked FOR UPDATE; a lead already resolved throws AlreadyResolvedError.
 */
export async function resolveWin(
  tx: Queryable,
  leadId: string,
  winningAttemptId: string,
  winnerEmployeeId: string,
): Promise<void> {
  const leadRows = await tx<{ winning_attempt_id: string | null }[]>`
    select winning_attempt_id from leads where id = ${leadId} for update`;
  if (leadRows.length === 0) {
    throw new IncompleteError();
  }
  if (leadRows[0].winning_attempt_id) {
    throw new AlreadyResolvedError();
  }
  await tx`update leads set winning_attempt_id = ${winningAttemptId} where id = ${leadId}`;

  const others = await tx<{ id: string; status: string }[]>`
    select id, status from prospect_attempts where lead_id = ${leadId} and id <> ${winningAttemptId}`;
  const ex = executors(tx);
  const losers: string[] = [];
  for (const o of others) {
    if (isTerminalAttemptStatus(o.status)) {
      continue;
    }
    const res = await statemachine.transition(ex.sm, {
      machine: 'prospect_attempt',
      entityType: 'prospect_attempt',
      table: 'prospect_attempts',
      entityId: o.id,
      to: ATTEMPT_CLOSED_KALAH,
      actor: SYSTEM_ACTOR,
    });
    if (!res.ok) {
      throw new Error(`win-resolution ${o.id} -> ${ATTEMPT_CLOSED_KALAH} failed: ${res.message}`);
    }
    losers.push(o.id);
  }

  await ex.audit.insertAudit({
    entityType: 'lead', entityId: leadId, actorEmployeeId: 'SYSTEM',
    action: 'win_resolved', beforeJson: null,
    afterJson: {
      winning_attempt_id: winningAttemptId, winner: winnerEmployeeId, losers,
      note: '[lead dimenangkan oleh sales lain (nama)]',
    },
    createdBy: 'SYSTEM',
  });
}
