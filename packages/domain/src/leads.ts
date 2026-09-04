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

import { bi, ident, notification, page, permission, statemachine } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
// Single source of truth for the CDPS division label (Go keeps a module-local
// copy in module1_leads/bulk.go; here one exported constant serves both).
import { MARKETING_DIVISION } from './campaign';

/** Authenticated employee + resolved role (from @cdps/core permission). */
export type Actor = permission.Actor;

/** lead_record machine (seeded in 20260723055732_statemachine.sql). */
export const LEAD_MACHINE = 'lead_record';

/** Lead record birth status (active) and the Pool waypoint on the reopen path. */
export const RECORD_ACTIVE = 'active';
export const RECORD_POOL = '[Pool]';

/**
 * Terminal record status for a lead deleted with Head approval (owner decision
 * 2026-07-29 — `docs/DECISIONS.md`; edges seeded in
 * 20260729162101_lead_delete_request.sql). There is NO `delete from leads`
 * anywhere: house rule #3 makes history immutable, and a real row delete would
 * orphan the lead's audit trail and break the prospect_attempts FK. "Deleted"
 * is a state the lead is driven INTO, through the engine, by a Head.
 */
export const RECORD_DELETED = '[Deleted]';

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
/** Batch registration carrying more than MAX_REGISTER_BATCH prospects (QA revisi 2026-08-07). */
export const MSG_MAX_REGISTER_BATCH = '[maksimal 5 lead per pendaftaran!]';

// Delete-with-Head-ACC messages. NOT from the PRD (M1 has no delete door) — new
// strings introduced by the owner decision of 2026-07-29 and logged verbatim in
// docs/DECISIONS.md so they are as fixed as the PRD ones from here on.

/** The lead is already deleted — every door refuses it. */
export const MSG_LEAD_DELETED = '[lead sudah dihapus]';
/** A pending request already awaits the Head; a second one is refused. */
export const MSG_DELETE_ALREADY_PENDING = '[permintaan hapus untuk lead ini sudah diajukan]';
/** A won lead has money descendants (CLI/TRX/INST) — never deletable. */
export const MSG_DELETE_CLIENT_BLOCKED = '[lead sudah menjadi klien, tidak bisa dihapus]';
/** The request was already approved/rejected; a second decision is refused. */
export const MSG_DELETE_ALREADY_RESOLVED = '[permintaan hapus sudah diputuskan]';

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

/**
 * More than MAX_REGISTER_BATCH prospects in one batch registration — carries the
 * verbatim BI message; maps to HTTP 400 (a malformed submission, not a lifecycle
 * conflict, so it is NOT a BlockedError/409).
 */
export class TooManyProspectsError extends Error {
  constructor() {
    super(MSG_MAX_REGISTER_BATCH);
    this.name = 'LeadTooManyProspectsError';
  }
}

/**
 * Read denied by the role matrix — maps to HTTP 403.
 *
 * Carries `bi.TRANSITION_ROLE_DENIED` verbatim because that is the exact string
 * the Go original returns for a denied read (`module1_leads/reads.go` →
 * `forbidden()` → `statemachine.RoleDeniedMessage`). The port keeps it
 * bit-for-bit rather than inventing a read-specific message (CLAUDE.md §5).
 */
export class ForbiddenError extends Error {
  constructor(message = bi.TRANSITION_ROLE_DENIED) {
    super(message);
    this.name = 'LeadForbiddenError';
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
const STATUS_DELETED = RECORD_DELETED;

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

  // A deleted record is invisible to dedup: a Head deleted it, so the phone is
  // free again and a fresh intake mints a NEW lead rather than resurrecting the
  // deleted one ([Deleted] is terminal — there is no edge back out of it).
  // matchByPhone already filters these out; this arm keeps the pure table
  // correct for any caller that matched a row some other way.
  if (match.recordStatus === STATUS_DELETED) {
    return base; // outcome 'create'
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
  /**
   * Origin Campaign (CMP-) the lead is attributed to — the M1 §9.3 link, picked
   * from `campaign.listSelectableCampaigns` at the intake door. Empty = none
   * picked, which is only legal together with `outsideCampaign` for the sources
   * listed in CAMPAIGN_REQUIRED_SOURCES.
   */
  campaignId?: string;
  /**
   * Explicit "this lead did not come from a Marketing campaign" declaration —
   * the escape hatch for scouted/self-sourced leads (owner decision 2026-08-04).
   * It is what distinguishes "outside any campaign" from "the salesperson
   * skipped the field", which is the whole reason the campaign link was empty on
   * nearly every Sales-registered lead before this.
   */
  outsideCampaign?: boolean;
}

/**
 * Sources whose lead MUST carry an Origin Campaign (M1 §9.3: "mandatory when
 * Source ∈ {Leads-Iklan, Broadcast, Event, Kulwa}"). Spelled with the canonical
 * §9.3 Source-list values, not the PRD prose's abbreviation.
 *
 * A lead from one of these four cannot have appeared without a campaign behind
 * it: they are Marketing's own channels, so an empty link there is missing data,
 * not an absent campaign — and it silently zeroes that campaign's CPL/ROAS
 * (M2 §5). `outsideCampaign` is the one way to satisfy the rule without a link.
 */
export const CAMPAIGN_REQUIRED_SOURCES: readonly string[] = [
  'Leads - Iklan',
  'Broadcast',
  'Event',
  'Kulwa',
];

/**
 * campaignRequiredForSource reports whether M1 §9.3 makes Origin Campaign
 * mandatory for `source`. Pure — the FE marks the field required with the same
 * predicate, so the two halves cannot disagree about which sources they are.
 */
export function campaignRequiredForSource(source: string): boolean {
  return CAMPAIGN_REQUIRED_SOURCES.includes((source ?? '').trim());
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
 *
 * CAMPAIGN LINKAGE (added 2026-08-04). The wire has carried `campaign_id` since
 * the M0 workspace shipped, and NOTHING read it: the route dropped the field and
 * this function had no parameter for it, so every Sales-registered lead landed
 * with `origin_campaign_id = NULL` — M2's Lead-by-Dashboard / CPL / ROAS counted
 * zero for campaigns that had really produced the leads. The link is now stored
 * on all three outcomes, with the same first-touch rule the import door uses:
 *   - create → origin_campaign_id AND last_touch_campaign_id (first touch);
 *   - reopen/join → last_touch only (origin is immutable, M1 §9.3).
 * Unlike the import door this NEVER auto-activates a campaign: registration is
 * not an import, and `requireSelectableCampaign` only reads.
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
  const campaignId = input.campaignId?.trim() ?? '';
  // A picked campaign is authoritative: "outside any campaign" only describes a
  // lead that carries no link, so the flag is dropped (not an error) when both
  // arrive — the picker is one control and cannot produce that combination.
  const outsideCampaign = campaignId === '' && input.outsideCampaign === true;
  // M1 §9.3 conditional-mandatory gate. Runs with the other mandatory-field
  // checks, BEFORE any id is minted, so a lead missing its campaign burns no
  // LEAD/PRSP sequence number (house rule 1).
  if (campaignId === '' && !outsideCampaign && campaignRequiredForSource(source)) {
    throw new IncompleteError();
  }
  const now = new Date();

  // Discriminated result so a block can COMMIT its audit yet still surface an
  // error to the caller (a throw inside the tx would roll the audit back).
  type Committed =
    | { kind: 'blocked'; message: string }
    | { kind: 'ok'; result: RegisterResult };

  const committed = await withTransaction(sql, async (tx): Promise<Committed> => {
    const ex = executors(tx);
    // Campaign gate FIRST — before dedup, before any id. A rejected campaign
    // throws, which rolls this transaction back having written nothing at all.
    if (campaignId !== '') {
      await requireSelectableCampaign(tx, campaignId);
    }
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
        // The campaign TOUCHED an existing record; its origin stays whatever it
        // was (M1 §9.3 first-touch is immutable). Same call the import door makes.
        await updateLastTouch(tx, ex, decision.reopenLeadId, campaignId, actor);
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
        // A second salesperson pursuing the same lead from a campaign is a fresh
        // touch on that lead — last-touch moves, origin does not (M1 §5 / §9.3).
        await updateLastTouch(tx, ex, decision.joinLeadId, campaignId, actor);
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
        // First touch: origin AND last-touch are the same campaign on birth
        // (mirrors the import door); NULL when the lead is outside any campaign.
        const campaignArg = campaignId === '' ? null : campaignId;
        await tx`
          insert into leads
            (id, lead_name, phone_number, phone_norm, email, source, origin_division,
             origin_campaign_id, last_touch_campaign_id, record_status, created_by)
          values
            (${leadId}, ${leadName}, ${phoneNumber}, ${phoneNorm}, ${email === '' ? null : email},
             ${source}, ${SALES_DIVISION}, ${campaignArg}, ${campaignArg}, ${RECORD_ACTIVE},
             ${actor.employeeId})`;
        await ex.audit.insertAudit({
          entityType: 'lead', entityId: leadId, actorEmployeeId: actor.employeeId,
          action: 'create', beforeJson: null,
          // `outside_campaign` is logged even when false: when it is true it is
          // the DECLARATION that satisfied the §9.3 mandatory gate, so why the
          // link is empty has to be recoverable from the log (house rule 3).
          afterJson: {
            record_status: RECORD_ACTIVE, source,
            origin_campaign_id: campaignArg, outside_campaign: outsideCampaign,
          },
          createdBy: actor.employeeId,
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

// ---------------------------------------------------------------------------
// Batch registration door (QA revisi 2026-08-07, arahan Nerissa).
//
// One Source (and one Origin Campaign decision) covers up to MAX_REGISTER_BATCH
// prospects, so a salesperson who scouted five contacts in one sitting registers
// them with one click instead of retyping the Source five times.
//
// It is a LOOP OVER `register`, deliberately — not a second registration door:
//   1. Every row gets the FULL M1 §5 dedup decision table, the §9.3 campaign
//      rule, its own LEAD/PRSP ids and its own audit rows. There is exactly one
//      set of registration rules in this file and batch does not fork it.
//   2. ONE TRANSACTION PER ROW (as the import door, §3 rule 5): a duplicate on
//      row 3 rejects itself and leaves rows 1, 2, 4, 5 committed. Wrapping the
//      batch in one transaction would throw away four good leads over one
//      duplicate — which is exactly what the salesperson was avoiding by
//      batching.
//   3. Two rows carrying the SAME phone need no new rule: the first mints the
//      attempt, and the second meets the actor's own open attempt and is
//      refused with MSG_ALREADY_OWN_ATTEMPT by `decide` — verbatim, per row.
// ---------------------------------------------------------------------------

/** Batch-registration cap: one Source, up to five prospects (QA revisi 2026-08-07). */
export const MAX_REGISTER_BATCH = 5;

/** One prospect line of a batch registration (Source/Campaign are batch-level). */
export interface BatchProspect {
  leadName: string;
  phoneNumber: string;
  email?: string;
}

/** A batch registration: the shared Source/Campaign + its prospect lines. */
export interface BatchRegisterInput {
  source?: string;
  campaignId?: string;
  outsideCampaign?: boolean;
  prospects: BatchProspect[];
}

/** Per-row verdict of a batch registration (shaped like BulkRowResult). */
export interface BatchRegisterRowResult {
  rowNumber: number;
  leadName: string;
  phoneNumber: string;
  registered: boolean;
  leadId: string;
  attemptId: string;
  /** MSG_LEAD_CO_WORKED on a co-pursuit join; '' otherwise. */
  notice: string;
  /** verbatim BI rejection reason; '' for registered rows. */
  reason: string;
}

/** The batch report: counts, summary line, all rows, and the rejects. */
export interface BatchRegisterReport {
  registered: number;
  rejected: number;
  summary: string;
  rows: BatchRegisterRowResult[];
  rejections: BatchRegisterRowResult[];
}

/** Renders the batch summary line (mirrors bulkSummary's shape). */
export function batchSummary(registered: number, rejected: number): string {
  return `[${registered} lead berhasil didaftarkan, ${rejected} ditolak]`;
}

/**
 * registerBatch registers 1..MAX_REGISTER_BATCH prospects under ONE Source (M0
 * §3 / M1 §4). Every row runs through `register`, so each carries the full dedup
 * decision table, its own transaction, its own ids and its own audit trail.
 *
 * Batch-level failures throw and nothing is attempted: an empty/over-cap list
 * (IncompleteError / MSG_MAX_REGISTER_BATCH) and the two campaign gates — the
 * §9.3 conditional-mandatory rule and "the picked campaign does not exist" —
 * because both describe the WHOLE submission, not one row. Checking them once up
 * front is also what stops a stale campaign picker from producing five identical
 * `[data tidak ditemukan]` rejections.
 *
 * Row-level failures never throw: a blocked duplicate or an incomplete line is a
 * verdict in the report, and the other rows stay committed.
 */
export async function registerBatch(
  sql: Sql,
  actor: Actor,
  input: BatchRegisterInput,
): Promise<BatchRegisterReport> {
  const prospects = input.prospects ?? [];
  if (prospects.length === 0) {
    throw new IncompleteError();
  }
  if (prospects.length > MAX_REGISTER_BATCH) {
    throw new TooManyProspectsError();
  }
  const source = input.source?.trim() ?? '';
  const campaignId = input.campaignId?.trim() ?? '';
  const outsideCampaign = campaignId === '' && input.outsideCampaign === true;
  // Same gate `register` applies per row, hoisted to the batch: the Source is
  // shared, so a missing mandatory campaign is a property of the submission.
  if (campaignId === '' && !outsideCampaign && campaignRequiredForSource(source)) {
    throw new IncompleteError();
  }
  if (campaignId !== '') {
    await requireSelectableCampaign(sql, campaignId);
  }

  const rows: BatchRegisterRowResult[] = [];
  let registered = 0;
  let rejected = 0;
  for (let i = 0; i < prospects.length; i++) {
    const p = prospects[i];
    const base: BatchRegisterRowResult = {
      rowNumber: i + 1,
      leadName: (p.leadName ?? '').trim(),
      phoneNumber: (p.phoneNumber ?? '').trim(),
      registered: false,
      leadId: '',
      attemptId: '',
      notice: '',
      reason: '',
    };
    try {
      const res = await register(sql, actor, {
        leadName: p.leadName ?? '',
        phoneNumber: p.phoneNumber ?? '',
        email: p.email,
        source,
        campaignId: campaignId === '' ? undefined : campaignId,
        outsideCampaign: outsideCampaign ? true : undefined,
      });
      registered++;
      rows.push({
        ...base,
        registered: true,
        leadId: res.lead.id,
        attemptId: res.attempt.id,
        notice: res.notice,
      });
    } catch (err) {
      // BlockedError (dedup) and IncompleteError (missing name/phone) both carry
      // the verbatim BI string the row must show. Anything else is degraded to
      // the house default rather than leaking a driver error into the report —
      // one broken row must not fail the batch (importOneRow does the same).
      const reason = err instanceof BlockedError || err instanceof IncompleteError
        ? err.message
        : bi.INCOMPLETE_DATA;
      rejected++;
      rows.push({ ...base, reason });
    }
  }

  return {
    registered,
    rejected,
    summary: batchSummary(registered, rejected),
    rows,
    rejections: rows.filter((r) => !r.registered),
  };
}

/**
 * requireSelectableCampaign re-checks server-side that `campaignId` names a
 * campaign that EXISTS. That is the whole gate, and the narrowness is deliberate.
 *
 * Status is NOT gated here (owner decision 2026-08-04, logged in DECISIONS.md —
 * a recorded deviation from M3 §5 rule 5, which restricts *import* to Active).
 * Every M2 performance number starts at the campaign a salesperson picks during
 * registration, so refusing a status here does not protect the data — it destroys
 * it: the lead is registered anyway (Sales will not abandon a real lead over a
 * campaign status) and lands with NO campaign at all, which reads as "this
 * campaign produced nothing" rather than "this lead arrived late". A late lead on
 * a Closed campaign is exactly the case M3-OA-4 already contemplates.
 *
 * Registration still has NO lifecycle side effect: unlike the import door
 * (resolveCampaignForIntake, which auto-activates Draft/Paused), this only reads.
 * Picking a Draft campaign attributes the lead without launching the campaign.
 *
 * A missing campaign is still refused with the frozen `[data tidak ditemukan]`
 * (404) — an id that names nothing is a bug or a stale form, not an attribution.
 */
async function requireSelectableCampaign(tx: Queryable, campaignId: string): Promise<void> {
  const rows = await tx<{ id: string }[]>`select id from campaigns where id = ${campaignId}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_CAMPAIGN_NOT_FOUND);
  }
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
// Pool claim (M1 §6) — Sales self-claims a [Pool] lead, spawning a competing
// attempt. The same pool lead may be claimed by several salespeople by design
// (M1-OA-1); whoever closes wins (resolveWin, §6 rule 5).
// ---------------------------------------------------------------------------

/** Claim outcomes: attach directly, reopen a terminal record first, or block. */
export type ClaimOutcome = 'claim' | 'reclaim' | 'block';

/** Result of the pure claim decision. */
export interface ClaimDecision {
  outcome: ClaimOutcome;
  /** verbatim BI `[...]` when blocked ("" otherwise). */
  message: string;
}

/**
 * decideClaim runs the Pool-claim decision (M1 §6) against an already-matched
 * lead record:
 *   - a won lead is already a client → block (MSG_ALREADY_CLIENT);
 *   - a lead the actor already holds an open attempt on cannot be double-claimed
 *     → block (MSG_ALREADY_OWN_ATTEMPT);
 *   - a Head-deleted lead is not claimable → block (MSG_LEAD_DELETED);
 *   - a `[Pool]` lead is claimed directly;
 *   - a `[Rejected]`/`[Not Qualified]` lead is re-claimed by first reopening it
 *     to `[Pool]` (§6 rule 7 / reference rule 9);
 *   - anything else is a scouted-exclusive record the Pool flow may not touch
 *     → block (`[lead sedang diproses oleh sales lain (nama)]`, competition is
 *     pool-only — §2, M1-OA-1).
 */
export function decideClaim(match: ExistingLead, actor: string): ClaimDecision {
  if (match.recordStatus === STATUS_CLOSED_WIN) {
    return { outcome: 'block', message: MSG_ALREADY_CLIENT };
  }
  // A Head-deleted lead is off the board: unlike the intake door (which mints a
  // fresh lead), the Pool flow targets THIS id, so there is nothing to claim.
  if (match.recordStatus === STATUS_DELETED) {
    return { outcome: 'block', message: MSG_LEAD_DELETED };
  }
  if (actorHoldsOpenAttempt(match, actor)) {
    return { outcome: 'block', message: MSG_ALREADY_OWN_ATTEMPT };
  }
  switch (match.recordStatus) {
    case STATUS_POOL:
      return { outcome: 'claim', message: '' };
    case STATUS_REJECTED:
    case STATUS_NOT_QUALIFIED:
      return { outcome: 'reclaim', message: '' };
    default:
      // active / scouted-exclusive (or any other record status): not claimable.
      return { outcome: 'block', message: interpolateOwner(MSG_ACTIVE_OTHER_SALES_IMPORT, ownerName(match)) };
  }
}

/** claim result: the (now-Pool) lead + the claimant's new attempt. */
export interface ClaimResult {
  lead: Lead;
  attempt: Attempt;
}

/**
 * claim is Sales self-claim of a `[Pool]` lead (M1 §6). It locks the lead record
 * FOR UPDATE (so two racing claimants serialize), decides via decideClaim, and
 * either attaches a fresh PRSP attempt (New Lead) to the pool lead, re-claims a
 * terminal record by reopening it to `[Pool]` first, or blocks with the verbatim
 * BI message (BlockedError). The claim is logged on the lead record (§6 rule 4);
 * a block still COMMITS its audit row before the error surfaces (as register).
 *
 * Multiple salespeople may hold competing attempts on the same pool lead by
 * design (M1-OA-1); the winner is resolved at closing (resolveWin, §6 rule 5).
 */
export async function claim(sql: Sql, actor: Actor, leadId: string): Promise<ClaimResult> {
  const now = new Date();

  // Discriminated result so a block can COMMIT its audit yet still surface an
  // error to the caller (a throw inside the tx would roll the audit back).
  type Committed =
    | { kind: 'blocked'; message: string }
    | { kind: 'ok'; result: ClaimResult };

  const committed = await withTransaction(sql, async (tx): Promise<Committed> => {
    const ex = executors(tx);
    const match = await matchByLeadId(tx, leadId); // locks the lead row FOR UPDATE
    if (match === null) {
      throw new NotFoundError();
    }
    const decision = decideClaim(match, actor.employeeId);

    if (decision.outcome === 'block') {
      await ex.audit.insertAudit({
        entityType: 'lead', entityId: leadId, actorEmployeeId: actor.employeeId,
        action: 'claim_blocked', beforeJson: null,
        afterJson: { message: decision.message }, createdBy: actor.employeeId,
      });
      return { kind: 'blocked', message: decision.message };
    }

    if (decision.outcome === 'reclaim') {
      // Terminal -> [Pool]: the pool lead becomes claimable again (§6 rule 7).
      await reopen(ex.sm, leadId, RECORD_POOL, actor);
    }

    const attempt = await insertAttempt(tx, ex, leadId, actor, now);
    await ex.audit.insertAudit({
      entityType: 'lead', entityId: leadId, actorEmployeeId: actor.employeeId,
      action: 'claim', beforeJson: null,
      afterJson: { attempt_id: attempt.id, reclaimed: decision.outcome === 'reclaim' },
      createdBy: actor.employeeId,
    });
    const lead = await loadLead(tx, leadId);
    return { kind: 'ok', result: { lead, attempt } };
  });

  if (committed.kind === 'blocked') {
    throw new BlockedError(committed.message);
  }
  return committed.result;
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

// ---------------------------------------------------------------------------
// FE read models (contract HANDOFF_SESSION_20260719_FE_M0M1 §3/§4/§5): the Sales
// Pool board, the Leads Database, and lead detail — ported from Go
// module1_leads/reads.go. camelCase here; the API route maps to the snake_case
// wire shape web-internal expects. Row scope stays the RLS/service-role concern
// (as leads.list / leads.get); these do NOT re-implement the permission matrix.
// `actorEmployeeId` is used only to mark the caller's own rows (my_open_attempt).
// ---------------------------------------------------------------------------

/** The terminal attempt statuses as an array, for the "open attempt" filter
 *  (`status <> all(...)`), single-sourced from TERMINAL_ATTEMPT_STATUSES. */
const OPEN_ATTEMPT_TERMINAL: string[] = [...TERMINAL_ATTEMPT_STATUSES];

// ---------------------------------------------------------------------------
// Read-scope gates (DECISIONS O37, opsi (c) — app-layer half).
//
// Ported 1:1 from `backend/internal/module1_leads/reads.go` (canReadPool /
// leadListScope / canReadLead). RLS filters ROWS; these gates decide whether the
// caller may reach the endpoint at all, so a wrong-division actor gets a 403
// with the exact BI message instead of a silently empty list — the behaviour the
// Go build shipped and W1/W3 UAT signed off on.
// ---------------------------------------------------------------------------

/**
 * canReadPool — the Sales Pool board is visible to Sales (any level), plus the
 * read-everywhere layered roles. Mirrors Go `canReadPool`.
 */
export function canReadPool(actor: permission.Actor): boolean {
  return actor.role.director || actor.role.od || actor.role.division === SALES_DIVISION;
}

/** Resolved list scope for the Leads Database (Go `leadListScope`). */
export interface LeadListScope {
  /** Marketing staff see only leads they own (created / own-campaign origin). */
  marketingStaffScope: boolean;
}

/**
 * leadListScope resolves how much of the Leads Database an actor may list, or
 * null when the actor has no access at all. Mirrors Go `leadListScope`:
 * Director/OD and Marketing-lead and Sales-lead see everything; Marketing staff
 * are narrowed to their own leads; everyone else is denied.
 *
 * SALES STAFF (added 2026-08-06, QA pemilik). Go denied them outright, and that
 * port was faithful but wrong in practice: a salesperson who registers a lead
 * through the M1 §4 door has NOWHERE to see it again. The lead lands `active`
 * (scouted, exclusive), so it never appears on the Pool board — Pool is `[Pool]`
 * only, by design (§6 rule 3) — and this gate answered 403 on the Database. The
 * only trace was the derived PRSP row in the Sales workspace.
 *
 * Opening the endpoint does NOT widen what they can read: `leadsDatabase` runs
 * through `readAsActor`, so `leads_select` still narrows the rows to leads they
 * created or hold an attempt on (RLS baseline + 20260729031525). "Staff = own
 * data only" is therefore still enforced where it was already enforced — one
 * place, not two (CLAUDE.md: the two sides must never disagree).
 */
export function leadListScope(actor: permission.Actor): LeadListScope | null {
  if (actor.role.director || actor.role.od) {
    return { marketingStaffScope: false };
  }
  if (actor.role.division === MARKETING_DIVISION) {
    if (actor.role.level === permission.LevelLead) {
      return { marketingStaffScope: false };
    }
    return { marketingStaffScope: true };
  }
  if (actor.role.division === SALES_DIVISION) {
    return { marketingStaffScope: false };
  }
  return null;
}

// Go's third gate, `canReadLead`, is ROW-level (own lead / own-campaign origin /
// holds an attempt). It is intentionally NOT re-implemented here: row visibility
// is the `leads_select` RLS policy's job, and a second copy in TS could only
// diverge from it (CLAUDE.md — the two sides must never disagree). Migration
// 20260729031525 adds the own-campaign-origin arm that the baseline policy was
// missing, so RLS now matches Go's predicate exactly.

/** One Sales Pool board row (contract §3). */
export interface PoolBoardRow {
  id: string;
  leadName: string;
  phoneNumber: string;
  source: string;
  originCampaignId: string | null;
  createdAt: Date;
  stale: boolean;
  openAttemptCount: number;
  myOpenAttempt: boolean;
}

/**
 * poolBoard returns every `[Pool]` lead with its contest counts and the M1-OA-7
 * stale flag (unclaimed > 24h). Multiple salespeople compete on one pool lead
 * by design (M1-OA-1); `myOpenAttempt` marks rows the caller already holds.
 *
 * `q` (nama/telepon substring) and `source` narrow the board the same way they
 * narrow `leadsDatabase` — same predicate shape, same parameter no-op when empty
 * (`'' = ''` short-circuits), so there is no dynamic SQL to inject into. Added
 * 2026-08-06 (QA pemilik): a pool that only ever grows is unusable without them.
 */
export async function poolBoard(
  sql: Queryable,
  actorEmployeeId: string,
  filter: { q?: string; source?: string } = {},
): Promise<PoolBoardRow[]> {
  const q = filter.q?.trim() ?? '';
  const like = `%${q}%`;
  const source = filter.source?.trim() ?? '';
  const rows = await sql<{
    id: string; lead_name: string; phone_number: string; source: string;
    origin_campaign_id: string | null; created_at: Date;
    stale: boolean; open_attempt_count: string; my_open_attempt: boolean;
  }[]>`
    select l.id, l.lead_name, l.phone_number, l.source, l.origin_campaign_id, l.created_at,
           (l.created_at < now() - interval '24 hours') as stale,
           (select count(*) from prospect_attempts pa
             where pa.lead_id = l.id and pa.status <> all(${OPEN_ATTEMPT_TERMINAL})) as open_attempt_count,
           exists(select 1 from prospect_attempts pa2
             where pa2.lead_id = l.id and pa2.owner_employee_id = ${actorEmployeeId}
               and pa2.status <> all(${OPEN_ATTEMPT_TERMINAL})) as my_open_attempt
    from leads l
    where l.record_status = ${RECORD_POOL}
      and (${q} = '' or l.lead_name ilike ${like} or l.phone_number ilike ${like})
      and (${source} = '' or l.source = ${source})
    order by l.created_at desc, l.id desc`;
  return rows.map((r) => ({
    id: r.id, leadName: r.lead_name, phoneNumber: r.phone_number, source: r.source,
    originCampaignId: r.origin_campaign_id, createdAt: r.created_at,
    stale: r.stale, openAttemptCount: Number(r.open_attempt_count), myOpenAttempt: r.my_open_attempt,
  }));
}

/**
 * How "my lead" is resolved for the Lead Saya board (keputusan pemilik
 * 2026-08-06). See `leadsDatabase`.
 */
export const MINE_REGISTERED = 'registered';
export const MINE_CLAIMED = 'claimed';
export const MINE_ANY = 'any';
export type MineMode = typeof MINE_REGISTERED | typeof MINE_CLAIMED | typeof MINE_ANY;

/**
 * parseMineMode maps a wire value onto the closed set, defaulting to `any`.
 * Unknown values are NOT an error: this is a view filter, and the safe reading
 * of an unrecognised one is the widest of the three (which RLS still narrows).
 */
export function parseMineMode(raw: string | null | undefined): MineMode {
  const v = (raw ?? '').trim();
  if (v === MINE_REGISTERED) return MINE_REGISTERED;
  if (v === MINE_CLAIMED) return MINE_CLAIMED;
  return MINE_ANY;
}

/** One Leads Database row (contract §4). */
export interface LeadsDbRow {
  id: string;
  leadName: string;
  phoneNumber: string;
  email: string | null;
  source: string;
  originDivision: string;
  originCampaignId: string | null;
  lastTouchCampaignId: string | null;
  recordStatus: string;
  winningAttemptId: string | null;
  createdAt: Date;
  openAttemptCount: number;
  /**
   * Whether the CALLER created this lead record, and whether they hold an
   * attempt on it. Both are always computed (false for an anonymous read), not
   * only when a `mine` filter is applied: the Lead Saya board renders them as a
   * "Peran" column, and a column that exists only under one filter is a column
   * that renders blank under every other one.
   */
  registeredByMe: boolean;
  claimedByMe: boolean;
}

/**
 * leadsDatabase returns leads newest-first, optionally filtered by an exact
 * record_status, a name/phone substring, an exact Source, and "mine only".
 * Filters are parameter no-ops when empty (`'' = ''` short-circuits), so there
 * is no dynamic SQL to inject into.
 *
 * `source` (added 2026-08-06, QA pemilik) is the "lead ini datang dari aktivitas
 * mana" cut — Scouting / Event / Leads - Iklan / … — the dimension M1 §8 already
 * evaluates lead quality by, but which the board had no way to slice.
 *
 * `mineEmployeeId` + `mineMode` back the "Lead Saya" board (keputusan pemilik
 * 2026-08-06). The mode matters because "my lead" has two genuinely different
 * meanings in M1 and collapsing them hides work:
 *   - `registered` — the actor CREATED the lead record (M1 §4 scouted intake, or
 *     a Marketing import). This is the tab's default and the literal ask.
 *   - `claimed`    — the actor holds a PRSP attempt on someone else's lead (a
 *     Pool claim, §6). Not registered by them, but theirs to work.
 *   - `any`        — either of the above.
 * All three are a CONVENIENCE, never a security boundary: row visibility is
 * `leads_select`'s job, and these can only ever subtract from what RLS already
 * allows. `mineEmployeeId` is empty for callers that do not use it.
 *
 * Head-deleted leads are hidden from the unfiltered list — that is what "delete"
 * has to mean to the people using the board — but remain reachable by asking for
 * `status='[Deleted]'` explicitly, and by id, because the row and its audit trail
 * are never destroyed (house rule #3).
 *
 * `page` (P2 §6) makes this a keyset page over the SAME `created_at desc, id
 * desc` ordering the P1 index covers. It is OPTIONAL and absent means unbounded
 * — the CSV export reads through this very function and must still get every
 * row (up to its own explicit cap), so bounding by default here would silently
 * truncate an export. The request path (`GET /leads`) always passes one.
 * Filters compose with the cursor because they are all server-side: narrowing
 * by status/q/source simply pages a smaller result set.
 */
export async function leadsDatabase(
  sql: Queryable,
  filter: {
    status?: string; q?: string; source?: string;
    mineEmployeeId?: string; mineMode?: MineMode;
    page?: page.PageRequest;
  } = {},
): Promise<page.Page<LeadsDbRow>> {
  const status = filter.status?.trim() ?? '';
  const q = filter.q?.trim() ?? '';
  const like = `%${q}%`;
  const source = filter.source?.trim() ?? '';
  const mine = filter.mineEmployeeId?.trim() ?? '';
  const mode: MineMode = filter.mineMode ?? MINE_ANY;
  // Split into two independent booleans so the SQL below stays a fixed string
  // with fixed parameters — no branch builds a different query.
  const wantRegistered = mine !== '' && (mode === MINE_ANY || mode === MINE_REGISTERED);
  const wantClaimed = mine !== '' && (mode === MINE_ANY || mode === MINE_CLAIMED);
  const b = page.sqlBounds(filter.page);
  const rows = await sql<{
    id: string; lead_name: string; phone_number: string; email: string | null;
    source: string; origin_division: string; origin_campaign_id: string | null;
    last_touch_campaign_id: string | null; record_status: string;
    winning_attempt_id: string | null; created_at: Date; open_attempt_count: string;
    registered_by_me: boolean; claimed_by_me: boolean;
  }[]>`
    select l.id, l.lead_name, l.phone_number, l.email, l.source, l.origin_division,
           l.origin_campaign_id, l.last_touch_campaign_id, l.record_status, l.winning_attempt_id, l.created_at,
           (select count(*) from prospect_attempts pa
             where pa.lead_id = l.id and pa.status <> all(${OPEN_ATTEMPT_TERMINAL})) as open_attempt_count,
           (${mine} <> '' and l.created_by = ${mine}) as registered_by_me,
           (${mine} <> '' and exists(
              select 1 from prospect_attempts pa4
               where pa4.lead_id = l.id and pa4.owner_employee_id = ${mine})) as claimed_by_me
    from leads l
    where (${status} = '' or l.record_status = ${status})
      and (${status} = ${RECORD_DELETED} or l.record_status <> ${RECORD_DELETED})
      and (${q} = '' or l.lead_name ilike ${like} or l.phone_number ilike ${like})
      and (${source} = '' or l.source = ${source})
      and (${mine} = ''
           or (${wantRegistered} and l.created_by = ${mine})
           or (${wantClaimed} and exists(
                 select 1 from prospect_attempts pa3
                  where pa3.lead_id = l.id and pa3.owner_employee_id = ${mine})))
      and (l.created_at, l.id) < (${b.at}, ${b.id})
    order by l.created_at desc, l.id desc
    limit ${b.limit}::bigint`;
  const mapped = rows.map((r) => ({
    id: r.id, leadName: r.lead_name, phoneNumber: r.phone_number, email: r.email,
    source: r.source, originDivision: r.origin_division, originCampaignId: r.origin_campaign_id,
    lastTouchCampaignId: r.last_touch_campaign_id, recordStatus: r.record_status,
    winningAttemptId: r.winning_attempt_id, createdAt: r.created_at,
    openAttemptCount: Number(r.open_attempt_count),
    registeredByMe: r.registered_by_me, claimedByMe: r.claimed_by_me,
  }));
  return page.paginate(mapped, filter.page, (r) => ({ createdAt: r.createdAt, id: r.id }));
}

/** The lead block of the detail view (contract §5) — LeadsDbRow minus the rollup. */
export interface LeadCoreView {
  id: string;
  leadName: string;
  phoneNumber: string;
  email: string | null;
  source: string;
  originDivision: string;
  originCampaignId: string | null;
  lastTouchCampaignId: string | null;
  recordStatus: string;
  winningAttemptId: string | null;
  createdAt: Date;
}

/** Lead detail: the record plus its attempt contest (oldest first). */
export interface LeadDetailView {
  lead: LeadCoreView;
  attempts: LeadAttemptRow[];
}

/** leadDetailView returns a lead + its attempt contest (NotFoundError if absent). */
export async function leadDetailView(sql: Queryable, id: string): Promise<LeadDetailView> {
  const rows = await sql<{
    id: string; lead_name: string; phone_number: string; email: string | null;
    source: string; origin_division: string; origin_campaign_id: string | null;
    last_touch_campaign_id: string | null; record_status: string;
    winning_attempt_id: string | null; created_at: Date;
  }[]>`
    select id, lead_name, phone_number, email, source, origin_division,
           origin_campaign_id, last_touch_campaign_id, record_status, winning_attempt_id, created_at
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
    lead: {
      id: r.id, leadName: r.lead_name, phoneNumber: r.phone_number, email: r.email,
      source: r.source, originDivision: r.origin_division, originCampaignId: r.origin_campaign_id,
      lastTouchCampaignId: r.last_touch_campaign_id, recordStatus: r.record_status,
      winningAttemptId: r.winning_attempt_id, createdAt: r.created_at,
    },
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
 *
 * Head-deleted records are excluded, not just deprioritised: `[Deleted]` has no
 * outgoing edge, so had the newest match been a deleted row the intake would
 * have had no legal move. Skipping it lets an older live record still match, and
 * a phone whose ONLY record was deleted reads as brand new.
 */
export async function matchByPhone(q: Queryable, phoneNorm: string): Promise<ExistingLead | null> {
  if (phoneNorm === '') {
    return null;
  }
  const leadRows = await q<{ id: string; record_status: string }[]>`
    select id, record_status from leads
    where phone_norm = ${phoneNorm} and record_status <> ${RECORD_DELETED}
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

/**
 * matchByLeadId returns a specific lead (locked FOR UPDATE) with its OPEN
 * (non-terminal) attempts, or null when the id is unknown. It mirrors
 * matchByPhone's shape so the pure claim decision can run over it; the row lock
 * serializes racing claimants on the same pool lead.
 */
async function matchByLeadId(tx: Queryable, leadId: string): Promise<ExistingLead | null> {
  const leadRows = await tx<{ id: string; record_status: string }[]>`
    select id, record_status from leads where id = ${leadId} for update`;
  if (leadRows.length === 0) {
    return null;
  }
  const m: ExistingLead = { id: leadRows[0].id, recordStatus: leadRows[0].record_status, openAttempts: [] };
  const attemptRows = await tx<{ owner_employee_id: string; owner_name: string; status: string }[]>`
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

// ---------------------------------------------------------------------------
// Lead delete, gated on Head approval (owner decision 2026-07-29, logged in
// docs/DECISIONS.md — M1 has no delete door of its own).
//
// Two doors, never one: a salesperson AJUKAN (requests), a Head ACC (approves).
// Nothing is destroyed at either step. Approval drives the lead_record machine
// into the terminal `[Deleted]` state through sm_transition, whose edges are
// `require_lead = true`, so the Head gate is enforced by the SQL function itself
// and not only by the TypeScript check below — a direct service-role call cannot
// route around it.
//
// Shape mirrors the demo vertical's staff-submits / SPV-approves flow
// (demo.submitBlockRequest / approveBlockRequest) so there is one pattern to
// learn, not two.
// ---------------------------------------------------------------------------

/** `lead_delete_requests.status` — the request row's own lifecycle, not a machine. */
export const DELETE_PENDING = 'pending';
export const DELETE_APPROVED = 'approved';
export const DELETE_REJECTED = 'rejected';

/** Whether a delete request may be raised at all. */
export type DeleteRequestOutcome = 'request' | 'block';

/** Result of the pure delete-request decision. */
export interface DeleteRequestDecision {
  outcome: DeleteRequestOutcome;
  /** verbatim BI `[...]` when blocked ("" otherwise). */
  message: string;
}

/**
 * decideDeleteRequest is the pure gate on raising a delete request:
 *   - `[Closed-Success]` (or any lead with a resolved win) is a CLIENT and has
 *     money descendants — never deletable (MSG_DELETE_CLIENT_BLOCKED);
 *   - an already-deleted record cannot be deleted twice (MSG_LEAD_DELETED);
 *   - one pending request per lead — the second is refused
 *     (MSG_DELETE_ALREADY_PENDING), matching the `uq_ldr_one_pending` index that
 *     enforces the same thing under a race;
 *   - anything else may be requested, and waits for a Head.
 */
export function decideDeleteRequest(
  lead: { recordStatus: string; winningAttemptId?: string | null },
  hasPending: boolean,
): DeleteRequestDecision {
  if (lead.recordStatus === STATUS_CLOSED_WIN || (lead.winningAttemptId ?? '') !== '') {
    return { outcome: 'block', message: MSG_DELETE_CLIENT_BLOCKED };
  }
  if (lead.recordStatus === STATUS_DELETED) {
    return { outcome: 'block', message: MSG_LEAD_DELETED };
  }
  if (hasPending) {
    return { outcome: 'block', message: MSG_DELETE_ALREADY_PENDING };
  }
  return { outcome: 'request', message: '' };
}

/** One delete-request row. */
export interface DeleteRequest {
  id: string;
  leadId: string;
  reason: string;
  status: string;
  decisionNote: string;
  requestedBy: string;
  resolvedBy: string;
  resolvedAt: Date | null;
  createdAt: Date;
}

interface DeleteRequestRow {
  id: string;
  lead_id: string;
  reason: string;
  status: string;
  decision_note: string | null;
  requested_by: string;
  resolved_by: string | null;
  resolved_at: Date | null;
  created_at: Date;
}

function toDeleteRequest(r: DeleteRequestRow): DeleteRequest {
  return {
    id: r.id, leadId: r.lead_id, reason: r.reason, status: r.status,
    decisionNote: r.decision_note ?? '', requestedBy: r.requested_by,
    resolvedBy: r.resolved_by ?? '', resolvedAt: r.resolved_at, createdAt: r.created_at,
  };
}

/**
 * canRequestDelete — who may raise the request.
 *
 * Read-only OD accounts never write (permission.canWrite). Beyond that the actor
 * must be connected to the lead the same way `jwt_owns_lead` / the `leads_select`
 * policy defines connection: they created it, they hold an attempt on it, or they
 * are the Head of its origin division (Director everywhere). Writes go through
 * the service-role handle, which bypasses RLS, so this gate is the only thing
 * standing between an unrelated employee and someone else's lead.
 */
export function canRequestDelete(
  actor: permission.Actor,
  lead: { createdBy: string; originDivision: string },
  holdsAttempt: boolean,
): boolean {
  if (!permission.canWrite(actor)) {
    return false;
  }
  if (actor.role.director) {
    return true;
  }
  if (lead.createdBy === actor.employeeId || holdsAttempt) {
    return true;
  }
  return permission.isLead(actor, lead.originDivision);
}

/**
 * requestDelete raises a pending delete request on a lead (AJUKAN).
 *
 * Validates the mandatory reason FIRST — the LDR- id is minted only after the
 * gate passes (house rule #1) — then locks the lead, runs the pure decision,
 * inserts the request, audits it on the LEAD, and notifies the Heads of the
 * lead's origin division so the ACC queue is not something anyone has to poll.
 * No status changes here: the lead stays exactly where it was until a Head acts.
 */
export async function requestDelete(
  sql: Sql,
  actor: Actor,
  leadId: string,
  reason: string,
): Promise<DeleteRequest> {
  if ((reason ?? '').trim() === '') {
    throw new IncompleteError();
  }
  const trimmed = reason.trim();
  const now = new Date();

  // As register/claim: a block must COMMIT its audit row yet still surface an
  // error, so the refusal is carried out of the transaction rather than thrown
  // inside it (a throw would roll the audit back).
  type Committed =
    | { kind: 'blocked'; message: string }
    | { kind: 'ok'; request: DeleteRequest };

  const committed = await withTransaction(sql, async (tx): Promise<Committed> => {
    const ex = executors(tx);
    const leadRows = await tx<{
      record_status: string; winning_attempt_id: string | null;
      created_by: string; origin_division: string;
    }[]>`
      select record_status, winning_attempt_id, created_by, origin_division
      from leads where id = ${leadId} for update`;
    if (leadRows.length === 0) {
      throw new NotFoundError();
    }
    const lead = leadRows[0];

    const attemptRows = await tx<{ n: string }[]>`
      select count(*) as n from prospect_attempts
      where lead_id = ${leadId} and owner_employee_id = ${actor.employeeId}`;
    const holdsAttempt = Number(attemptRows[0].n) > 0;
    if (!canRequestDelete(actor, { createdBy: lead.created_by, originDivision: lead.origin_division }, holdsAttempt)) {
      throw new ForbiddenError();
    }

    const pendingRows = await tx<{ n: string }[]>`
      select count(*) as n from lead_delete_requests
      where lead_id = ${leadId} and status = ${DELETE_PENDING}`;
    const decision = decideDeleteRequest(
      { recordStatus: lead.record_status, winningAttemptId: lead.winning_attempt_id },
      Number(pendingRows[0].n) > 0,
    );
    if (decision.outcome === 'block') {
      await ex.audit.insertAudit({
        entityType: 'lead', entityId: leadId, actorEmployeeId: actor.employeeId,
        action: 'delete_request_blocked', beforeJson: null,
        afterJson: { message: decision.message, reason: trimmed },
        createdBy: actor.employeeId,
      });
      return { kind: 'blocked', message: decision.message };
    }

    const reqId = await ident.nextId(ex.ident, 'LDR', now);
    await tx`
      insert into lead_delete_requests (id, lead_id, reason, status, requested_by, created_by)
      values (${reqId}, ${leadId}, ${trimmed}, ${DELETE_PENDING}, ${actor.employeeId}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: 'lead', entityId: leadId, actorEmployeeId: actor.employeeId,
      action: 'delete_requested', beforeJson: null,
      afterJson: { request_id: reqId, reason: trimmed }, createdBy: actor.employeeId,
    });
    await notification.emit(ex.notify, {
      event: notification.EVENTS.LeadDeleteRequested,
      entityType: 'lead', entityId: leadId, actor: actor.employeeId,
      division: lead.origin_division, deepLink: `/leads/${leadId}`,
    });
    return {
      kind: 'ok',
      request: {
        id: reqId, leadId, reason: trimmed, status: DELETE_PENDING, decisionNote: '',
        requestedBy: actor.employeeId, resolvedBy: '', resolvedAt: null, createdAt: now,
      },
    };
  });

  if (committed.kind === 'blocked') {
    throw new BlockedError(committed.message);
  }
  return committed.request;
}

/** approveDelete / rejectDelete return the request row plus the engine verdict. */
export interface DeleteDecisionResult {
  request: DeleteRequest;
  /** present only on approve — the [Deleted] transition's result. */
  transition?: statemachine.TransitionResult;
}

/**
 * Locks a pending request together with its lead, and refuses anything already
 * decided. Shared by approve and reject so the two cannot drift apart on which
 * requests they consider actionable.
 */
async function lockPendingRequest(
  tx: Queryable,
  reqId: string,
): Promise<{ row: DeleteRequestRow; originDivision: string; recordStatus: string }> {
  const rows = await tx<DeleteRequestRow[]>`
    select id, lead_id, reason, status, decision_note,
           requested_by, resolved_by, resolved_at, created_at
    from lead_delete_requests where id = ${reqId} for update`;
  if (rows.length === 0) {
    throw new NotFoundError('lead delete request not found');
  }
  if (rows[0].status !== DELETE_PENDING) {
    throw new BlockedError(MSG_DELETE_ALREADY_RESOLVED);
  }
  const leadRows = await tx<{ origin_division: string; record_status: string }[]>`
    select origin_division, record_status from leads where id = ${rows[0].lead_id} for update`;
  if (leadRows.length === 0) {
    throw new NotFoundError();
  }
  return { row: rows[0], originDivision: leadRows[0].origin_division, recordStatus: leadRows[0].record_status };
}

/**
 * approveDelete is the Head's ACC (M1 delete door, step 2).
 *
 * Requires Head authority over the lead's ORIGIN division (Director everywhere);
 * a Sales Head cannot approve a Marketing-origin lead. It then drives the lead to
 * `[Deleted]` via sm_transition — the one path that writes a status column, and
 * the second, SQL-side enforcement of the same Head gate — marks the request
 * approved, audits it, and notifies the requester.
 *
 * A rejected transition (e.g. someone won the lead in the meantime) returns
 * without committing, so the request stays pending rather than being silently
 * consumed against a lead that never moved.
 */
export async function approveDelete(
  sql: Sql,
  actor: Actor,
  reqId: string,
  note = '',
): Promise<DeleteDecisionResult> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const { row, originDivision } = await lockPendingRequest(tx, reqId);
    if (!permission.isLead(actor, originDivision)) {
      throw new ForbiddenError();
    }

    const transition = await statemachine.transition(ex.sm, {
      machine: LEAD_MACHINE,
      entityType: 'lead',
      table: 'leads',
      statusColumn: 'record_status',
      entityId: row.lead_id,
      to: RECORD_DELETED,
      actor,
    });
    if (!transition.ok) {
      // Surface the engine's verbatim message; the request is left pending.
      return { request: toDeleteRequest(row), transition };
    }

    const updated = await tx<DeleteRequestRow[]>`
      update lead_delete_requests
         set status = ${DELETE_APPROVED}, resolved_by = ${actor.employeeId},
             resolved_at = now(), decision_note = ${note.trim() === '' ? null : note.trim()}
       where id = ${reqId}
      returning id, lead_id, reason, status, decision_note,
                requested_by, resolved_by, resolved_at, created_at`;
    await ex.audit.insertAudit({
      entityType: 'lead', entityId: row.lead_id, actorEmployeeId: actor.employeeId,
      action: 'delete_request_approved', beforeJson: null,
      afterJson: { request_id: reqId, note: note.trim() }, createdBy: actor.employeeId,
    });
    await notification.emit(ex.notify, {
      event: notification.EVENTS.LeadDeleteDecided,
      entityType: 'lead', entityId: row.lead_id, actor: actor.employeeId,
      explicitRecipients: [row.requested_by], deepLink: `/leads/${row.lead_id}`,
    });
    return { request: toDeleteRequest(updated[0]), transition };
  });
}

/**
 * rejectDelete is the Head refusing the request (M1 delete door, step 2b). Same
 * Head gate as approveDelete; the lead is left untouched, and the requester is
 * notified through the same event so both verdicts reach them the same way.
 */
export async function rejectDelete(
  sql: Sql,
  actor: Actor,
  reqId: string,
  note = '',
): Promise<DeleteDecisionResult> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const { row, originDivision } = await lockPendingRequest(tx, reqId);
    if (!permission.isLead(actor, originDivision)) {
      throw new ForbiddenError();
    }
    const updated = await tx<DeleteRequestRow[]>`
      update lead_delete_requests
         set status = ${DELETE_REJECTED}, resolved_by = ${actor.employeeId},
             resolved_at = now(), decision_note = ${note.trim() === '' ? null : note.trim()}
       where id = ${reqId}
      returning id, lead_id, reason, status, decision_note,
                requested_by, resolved_by, resolved_at, created_at`;
    await ex.audit.insertAudit({
      entityType: 'lead', entityId: row.lead_id, actorEmployeeId: actor.employeeId,
      action: 'delete_request_rejected', beforeJson: null,
      afterJson: { request_id: reqId, note: note.trim() }, createdBy: actor.employeeId,
    });
    await notification.emit(ex.notify, {
      event: notification.EVENTS.LeadDeleteDecided,
      entityType: 'lead', entityId: row.lead_id, actor: actor.employeeId,
      explicitRecipients: [row.requested_by], deepLink: `/leads/${row.lead_id}`,
    });
    return { request: toDeleteRequest(updated[0]) };
  });
}

/** One row of the Head's ACC queue — the request plus who/what it is about. */
export interface DeleteRequestQueueRow extends DeleteRequest {
  leadName: string;
  phoneNumber: string;
  recordStatus: string;
  originDivision: string;
  requestedByNama: string;
  resolvedByNama: string;
}

/**
 * deleteRequestQueue lists delete requests (default: only pending), newest
 * first, joined to the lead and to employee names. Row scope is the
 * `lead_delete_requests_select` policy's job when read through readAsActor —
 * this only shapes the projection (as poolBoard / leadsDatabase).
 */
export async function deleteRequestQueue(
  sql: Queryable,
  filter: { status?: string; leadId?: string } = {},
): Promise<DeleteRequestQueueRow[]> {
  const status = filter.status?.trim() ?? DELETE_PENDING;
  const leadId = filter.leadId?.trim() ?? '';
  const rows = await sql<(DeleteRequestRow & {
    lead_name: string; phone_number: string; record_status: string;
    origin_division: string; requested_by_nama: string; resolved_by_nama: string | null;
  })[]>`
    select r.id, r.lead_id, r.reason, r.status, r.decision_note,
           r.requested_by, r.resolved_by, r.resolved_at, r.created_at,
           l.lead_name, l.phone_number, l.record_status, l.origin_division,
           coalesce(req.nama, r.requested_by) as requested_by_nama,
           coalesce(res.nama, r.resolved_by)  as resolved_by_nama
    from lead_delete_requests r
    join leads l on l.id = r.lead_id
    left join employees req on req.employee_id = r.requested_by
    left join employees res on res.employee_id = r.resolved_by
    where (${status} = '' or r.status = ${status})
      and (${leadId} = '' or r.lead_id = ${leadId})
    order by r.created_at desc, r.id desc`;
  return rows.map((r) => ({
    ...toDeleteRequest(r),
    leadName: r.lead_name, phoneNumber: r.phone_number, recordStatus: r.record_status,
    originDivision: r.origin_division, requestedByNama: r.requested_by_nama,
    resolvedByNama: r.resolved_by_nama ?? '',
  }));
}

// ---------------------------------------------------------------------------
// Marketing bulk import (M1 §3) — O41. Ported from Go module1_leads/bulk.go +
// campaign_link.go (resolveCampaignForIntake / deriveSource / updateLastTouch).
//
// Import-door semantics differ from single registration in three ways that must
// NOT be "unified" with register():
//   1. ONE TRANSACTION PER ROW (§3 rule 5) — a bad row rejects itself and leaves
//      every other row committed. Wrapping the file in one transaction would make
//      a single duplicate roll back a whole import.
//   2. NO ATTEMPT IS SPAWNED. Imported leads land in [Pool] with no owner; the
//      Marketing door hands leads to Sales, it does not prospect them.
//   3. decide() is called with an EMPTY actor id on CHANNEL_IMPORT, so any open
//      attempt blocks the row regardless of who holds it, and the import never
//      joins as a co-pursuit (M1-OA-6 — dedup v2 join is single-reg only).
// ---------------------------------------------------------------------------

/** A row rejected for missing mandatory fields (verbatim BI, per row). */
export const MSG_ROW_INCOMPLETE = '[data tidak lengkap, baris tidak diimport]';

/** Import gate: the Campaign cannot accept leads (Closed/Archived) — §3 Rule 5. */
export const MSG_CAMPAIGN_NOT_ACTIVE = '[campaign belum/tidak aktif, lead tidak bisa diimport]';

/** Import gate: the selected Campaign does not exist (reuses the generic string). */
export const MSG_CAMPAIGN_NOT_FOUND = '[data tidak ditemukan]';

/** Campaign statuses, mirrored verbatim from M3 (the engine stores them unbracketed). */
const CAMPAIGN_DRAFT = 'Draft';
const CAMPAIGN_ACTIVE = 'Active';
const CAMPAIGN_PAUSED = 'Paused';

/**
 * Known Campaign Channel → M1 Source. M3-OA-2 keeps this taxonomy free-text and
 * INCREMENTAL, so only the PRD-confirmed entry lives here and anything unmapped
 * falls through as the Channel string verbatim (leads.source is a free varchar).
 */
const CHANNEL_TO_SOURCE = new Map<string, string>([['TikTok Ads', 'Leads - Iklan']]);

/** deriveSource maps a Campaign Channel to a Source, else returns it verbatim. */
export function deriveSource(channel: string): string {
  return CHANNEL_TO_SOURCE.get(channel) ?? channel;
}

/** One row of a bulk import request. */
export interface BulkRow {
  leadName: string;
  phoneNumber: string;
  email?: string;
  source?: string;
}

/** Per-row verdict (Go BulkRowResult). */
export interface BulkRowResult {
  rowNumber: number;
  leadName: string;
  phoneNumber: string;
  imported: boolean;
  reopened: boolean;
  leadId: string;
  /** verbatim BI rejection reason; '' for imported rows. */
  reason: string;
}

/** The §3 Flow-7 report: counts, summary line, all rows, and the rejects. */
export interface BulkReport {
  imported: number;
  rejected: number;
  summary: string;
  rows: BulkRowResult[];
  rejections: BulkRowResult[];
}

/**
 * canBulkImport gates the Marketing bulk-import door (M1 §9.1: Marketing
 * staff/lead import leads; Director full). A pure-OD account is read-only and
 * therefore denied even though it can see everything.
 */
export function canBulkImport(actor: Actor): boolean {
  return actor.role.director || actor.role.division === MARKETING_DIVISION;
}

/** Renders the byte-exact §3 Flow step 7 summary line. */
export function bulkSummary(imported: number, rejected: number): string {
  return `[${imported} lead berhasil diimport, ${rejected} ditolak (duplikat/data tidak lengkap)]`;
}

/**
 * bulkImport runs the Marketing import door over `rows` (M1 §3). `campaignId` is
 * the OPTIONAL origin Campaign for the whole file: when set, the Campaign gate
 * runs per row (missing → reject, Draft/Paused → auto-activate through the
 * engine per O13, Closed/Archived → reject) and the Channel-derived Source WINS
 * over whatever the row carried.
 *
 * The whole request is refused (ForbiddenError) when the actor may not import;
 * otherwise every row is processed independently and the report reconciles:
 * imported + rejected === rows.length.
 */
export async function bulkImport(
  sql: Sql,
  actor: Actor,
  campaignId: string,
  rows: BulkRow[],
  now: Date = new Date(),
): Promise<BulkReport> {
  if (!canBulkImport(actor)) {
    throw new ForbiddenError();
  }
  const results: BulkRowResult[] = [];
  let imported = 0;
  let rejected = 0;
  for (let i = 0; i < rows.length; i++) {
    const res = await importOneRow(sql, actor, i + 1, rows[i], campaignId, now);
    if (res.imported) {
      imported++;
    } else {
      rejected++;
    }
    results.push(res);
  }
  return {
    imported,
    rejected,
    summary: bulkSummary(imported, rejected),
    rows: results,
    rejections: results.filter((r) => !r.imported),
  };
}

/**
 * importOneRow processes a single row in its OWN transaction. It never throws for
 * a row-level problem — it returns the verdict, so one bad row cannot abort the
 * file. Infrastructure failures are caught for the same reason and reported as
 * the row-incomplete BI message, matching Go, which likewise degrades a failed
 * row rather than failing the request.
 */
async function importOneRow(
  sql: Sql,
  actor: Actor,
  rowNumber: number,
  row: BulkRow,
  campaignId: string,
  now: Date,
): Promise<BulkRowResult> {
  const leadName = (row.leadName ?? '').trim();
  const phoneNumber = (row.phoneNumber ?? '').trim();
  const rowSource = (row.source ?? '').trim();
  const email = (row.email ?? '').trim();
  const base: BulkRowResult = {
    rowNumber, leadName, phoneNumber, imported: false, reopened: false, leadId: '', reason: '',
  };

  // Mandatory fields BEFORE any id is minted (§3 Flow 2/4, house rule #1). A
  // campaign supplies the Source, so a row needs its own only when there is none.
  if (leadName === '' || phoneNumber === '' || (rowSource === '' && campaignId === '')) {
    return { ...base, reason: MSG_ROW_INCOMPLETE };
  }
  const phoneNorm = normalizePhone(phoneNumber);
  if (phoneNorm === '') {
    return { ...base, reason: MSG_ROW_INCOMPLETE };
  }

  try {
    return await withTransaction(sql, async (tx): Promise<BulkRowResult> => {
      const ex = executors(tx);

      // Campaign gate + Source derivation runs FIRST: a rejected campaign must
      // not leave a lead behind.
      let source = rowSource;
      if (campaignId !== '') {
        const gate = await resolveCampaignForIntake(tx, ex, campaignId, actor);
        if (gate.blocked !== '') {
          return { ...base, reason: gate.blocked };
        }
        source = gate.source;
      }

      const match = await matchByPhone(tx, phoneNorm);
      // Empty actor id on purpose — see the section header (M1-OA-6).
      const decision = decide(CHANNEL_IMPORT, match, '');
      const campaignArg = campaignId === '' ? null : campaignId;

      switch (decision.outcome) {
        case 'reopen': {
          // Terminal -> [Pool] only; the Marketing door spawns no attempt.
          const moved = await statemachine.transition(ex.sm, {
            machine: LEAD_MACHINE, entityType: 'lead', table: 'leads',
            statusColumn: 'record_status', entityId: decision.reopenLeadId,
            to: RECORD_POOL, actor,
          });
          if (!moved.ok) {
            return { ...base, reason: MSG_ROW_INCOMPLETE };
          }
          await ex.audit.insertAudit({
            entityType: 'lead', entityId: decision.reopenLeadId, actorEmployeeId: actor.employeeId,
            action: 'dedup_reopen', beforeJson: null,
            afterJson: { channel: 'bulk_import', source }, createdBy: actor.employeeId,
          });
          // M1 §5: a campaign-scoped reopen TOUCHES an existing lead, so it moves
          // last-touch only — origin stays whatever it was born under.
          await updateLastTouch(tx, ex, decision.reopenLeadId, campaignId, actor);
          return { ...base, imported: true, reopened: true, leadId: decision.reopenLeadId };
        }

        case 'block': {
          // Attribution attempt is LOGGED on the existing record but never
          // counted (M1-OA-6); the existing record itself is not mutated.
          if (match !== null) {
            await ex.audit.insertAudit({
              entityType: 'lead', entityId: match.id, actorEmployeeId: actor.employeeId,
              action: 'dedup_blocked', beforeJson: null,
              afterJson: { channel: 'bulk_import', row_index: rowNumber, message: decision.message },
              createdBy: actor.employeeId,
            });
          }
          return { ...base, reason: decision.message };
        }

        default: {
          // Create: a lead born under a Campaign gets origin = last-touch = that
          // Campaign (origin immutable hereafter); both NULL without one.
          const leadId = await ex.ident.identNext('LEAD', now);
          await tx`
            insert into leads
              (id, lead_name, phone_number, phone_norm, email, source, origin_division,
               origin_campaign_id, last_touch_campaign_id, record_status, created_by)
            values
              (${leadId}, ${leadName}, ${phoneNumber}, ${phoneNorm}, ${email === '' ? null : email},
               ${source}, ${MARKETING_DIVISION}, ${campaignArg}, ${campaignArg}, ${RECORD_POOL},
               ${actor.employeeId})`;
          await ex.audit.insertAudit({
            entityType: 'lead', entityId: leadId, actorEmployeeId: actor.employeeId,
            action: 'create', beforeJson: null,
            afterJson: {
              record_status: RECORD_POOL, source, channel: 'bulk_import',
              origin_campaign_id: campaignArg,
            },
            createdBy: actor.employeeId,
          });
          return { ...base, imported: true, leadId };
        }
      }
    });
  } catch {
    return { ...base, reason: MSG_ROW_INCOMPLETE };
  }
}

/** Outcome of the campaign import gate: either a blocking BI message or a Source. */
interface CampaignGate {
  /** verbatim BI `[...]` when the row must be rejected; '' when the gate passed. */
  blocked: string;
  source: string;
}

/**
 * resolveCampaignForIntake enforces the O13 import gate and returns the
 * Channel-derived Source. The Campaign row is locked FOR UPDATE so two
 * concurrent imports cannot race the auto-activation.
 *
 *   Active          → proceed.
 *   Draft / Paused  → auto-activate to Active THROUGH THE ENGINE (the only path
 *                     that writes status) plus a distinct `campaign_auto_activated`
 *                     audit row naming the importer as actor.
 *   Closed/Archived → blocked: the campaign machine has no edge back to Active.
 *   missing         → blocked (not-found).
 */
async function resolveCampaignForIntake(
  tx: Queryable,
  ex: ReturnType<typeof executors>,
  campaignId: string,
  actor: Actor,
): Promise<CampaignGate> {
  const rows = await tx<{ channel: string; status: string }[]>`
    select channel, status from campaigns where id = ${campaignId} for update`;
  if (rows.length === 0) {
    return { blocked: MSG_CAMPAIGN_NOT_FOUND, source: '' };
  }
  const { channel, status } = rows[0];

  if (status === CAMPAIGN_DRAFT || status === CAMPAIGN_PAUSED) {
    const moved = await statemachine.transition(ex.sm, {
      machine: 'campaign', entityType: 'campaign', table: 'campaigns',
      entityId: campaignId, to: CAMPAIGN_ACTIVE, actor,
    });
    if (!moved.ok) {
      return { blocked: MSG_CAMPAIGN_NOT_ACTIVE, source: '' };
    }
    await ex.audit.insertAudit({
      entityType: 'campaign', entityId: campaignId, actorEmployeeId: actor.employeeId,
      action: 'campaign_auto_activated', beforeJson: { status },
      afterJson: { status: CAMPAIGN_ACTIVE, trigger: 'lead_intake' }, createdBy: actor.employeeId,
    });
  } else if (status !== CAMPAIGN_ACTIVE) {
    return { blocked: MSG_CAMPAIGN_NOT_ACTIVE, source: '' };
  }
  return { blocked: '', source: deriveSource(channel) };
}

/**
 * updateLastTouch records that `campaignId` touched an EXISTING lead (M1 §5 /
 * §9.3) when it differs from the value on file, and audits the change. It NEVER
 * touches origin_campaign_id — that is the immutable first-touch record. No-op
 * when there is no campaign or it is already the current last-touch (idempotent).
 */
async function updateLastTouch(
  tx: Queryable,
  ex: ReturnType<typeof executors>,
  leadId: string,
  campaignId: string,
  actor: Actor,
): Promise<void> {
  if (campaignId === '') {
    return;
  }
  const rows = await tx<{ last_touch_campaign_id: string | null }[]>`
    select last_touch_campaign_id from leads where id = ${leadId}`;
  const current = rows[0]?.last_touch_campaign_id ?? null;
  if (current === campaignId) {
    return;
  }
  await tx`update leads set last_touch_campaign_id = ${campaignId} where id = ${leadId}`;
  await ex.audit.insertAudit({
    entityType: 'lead', entityId: leadId, actorEmployeeId: actor.employeeId,
    action: 'last_touch_updated', beforeJson: { last_touch_campaign_id: current },
    afterJson: { last_touch_campaign_id: campaignId }, createdBy: actor.employeeId,
  });
}
