/**
 * In-app notification center — TypeScript catalog + wrapper over the SQL
 * function `notify_emit` (migration 20260102000002_statemachine.sql).
 *
 * Ported from backend/internal/core/notification. The event catalog is FROZEN
 * (Phase 0 v2 §9 = 15 events: the 13 Phase 0 events + M1 dedup-v2 co-pursuit +
 * the Wave-3 catalog-opening Hours Logged reminder, DECISIONS O29 / W3-CAT-1).
 * The recipient resolution + per-recipient INSERT happen in `notify_emit`,
 * called inside the SAME transaction as the triggering change (atomic, never
 * best-effort). Notifications are never deletable (BEFORE DELETE trigger); the
 * only mutation is mark-as-read via `mark_notification_read`.
 */

/** How an event's recipients are resolved (mirror of the Go resolvers). */
export type Resolver = 'explicit' | 'leadsOfDivision' | 'explicitOrLeads';

/**
 * The 15 cataloged event types (stable identifiers, FROZEN). Values mirror the
 * Go `EventType` string constants verbatim.
 */
export const EVENTS = {
  NegotiationPendingApproval: 'm0.negotiation.pending_approval', // -> Sales Head/SPV
  NegotiationDecision: 'm0.negotiation.decision', // -> Salesperson
  InstallmentDue: 'm0m5.installment.due', // -> Sales PIC + Finance
  ContractNotReceived: 'm5.contract.not_received', // -> Finance + SPV
  ComplaintLogged: 'm6.complaint.logged', // -> AM + SPV Account
  KOLQCFailedOrEscalated: 'm9.kol.qc_failed_or_escalated', // -> KOL Lead
  SessionDiscrepancyFlagged: 'm10.session.discrepancy_flagged', // -> SPV Account
  DependencySatisfied: 'm11.dependency.satisfied', // -> Target Brief PIC
  BlockRequestSubmitted: 'm12.block_request.submitted', // -> SPV/Lead
  BlockRequestDecided: 'm12.block_request.decided', // -> Requester
  RevisionCountFlag: 'm12.revision_count.flag', // -> Team Leader/SPV
  ClientBandDrop: 'm13.client.band_drop', // -> SPV
  PerformancePublished: 'm14.performance.published', // -> Each staff
  LeadCoPursuit: 'm1.lead.co_pursuit', // -> co-pursuit owners + registrant
  HoursLoggedReminder: 'm7.hours_logged.reminder', // -> Asset's assigned PIC
  // Lead-delete approval (owner decision 2026-07-29, DECISIONS.md). The two
  // entries below are the ONLY additions past the Go catalog: the ACC flow
  // cannot function if the Head is never told a request is waiting.
  LeadDeleteRequested: 'm1.lead.delete_requested', // -> Head of the lead's origin division
  LeadDeleteDecided: 'm1.lead.delete_decided', // -> Requester
} as const;

/** A cataloged event type. */
export type EventType = (typeof EVENTS)[keyof typeof EVENTS];

/** One catalog entry: human description + recipient resolver. */
export interface CatalogEntry {
  description: string;
  resolver: Resolver;
}

/**
 * The catalog — event → {description, resolver}. Must stay identical to the
 * `notif_events` seed in the migrations.
 *
 * The first 15 entries are FROZEN (Phase 0 v2 §9) and identical to Go's
 * NewCatalog. The two `m1.lead.delete_*` entries are a logged deviation
 * (DECISIONS.md 2026-07-29, seeded in 20260102000012_lead_delete_request.sql):
 * they postdate the Go build, which is being decommissioned in this cutover.
 */
export const CATALOG: Record<EventType, CatalogEntry> = {
  [EVENTS.NegotiationPendingApproval]: { description: 'Negotiation Pending Approval submitted', resolver: 'leadsOfDivision' },
  [EVENTS.NegotiationDecision]: { description: 'Negotiation decision', resolver: 'explicit' },
  [EVENTS.InstallmentDue]: { description: 'Installment due/overdue', resolver: 'explicitOrLeads' },
  [EVENTS.ContractNotReceived]: { description: 'Contract not received 7 days after routing', resolver: 'explicitOrLeads' },
  [EVENTS.ComplaintLogged]: { description: 'Complaint logged (any door)', resolver: 'explicitOrLeads' },
  [EVENTS.KOLQCFailedOrEscalated]: { description: 'QC Failed / Booking Escalated', resolver: 'leadsOfDivision' },
  [EVENTS.SessionDiscrepancyFlagged]: { description: 'Session Discrepancy Flagged', resolver: 'leadsOfDivision' },
  [EVENTS.DependencySatisfied]: { description: 'Blocking Dependency Satisfied', resolver: 'explicit' },
  [EVENTS.BlockRequestSubmitted]: { description: 'Block request submitted', resolver: 'leadsOfDivision' },
  [EVENTS.BlockRequestDecided]: { description: 'Block request approved/rejected', resolver: 'explicit' },
  [EVENTS.RevisionCountFlag]: { description: 'Revision Count >= 3 (Quality flag)', resolver: 'leadsOfDivision' },
  [EVENTS.ClientBandDrop]: { description: 'Client band drop', resolver: 'leadsOfDivision' },
  [EVENTS.PerformancePublished]: { description: 'Monthly Performance Score published', resolver: 'explicit' },
  [EVENTS.LeadCoPursuit]: { description: 'Lead dikerjakan lebih dari satu sales', resolver: 'explicit' },
  [EVENTS.HoursLoggedReminder]: { description: 'Hours Logged end-of-day reminder', resolver: 'explicit' },
  [EVENTS.LeadDeleteRequested]: { description: 'Permintaan hapus lead diajukan', resolver: 'leadsOfDivision' },
  [EVENTS.LeadDeleteDecided]: { description: 'Permintaan hapus lead di-ACC/tolak', resolver: 'explicit' },
};

/** All registered event types (introspection / tests). */
export function events(): EventType[] {
  return Object.keys(CATALOG) as EventType[];
}

/** isEventType reports whether s is a cataloged event. */
export function isEventType(s: string): s is EventType {
  return Object.prototype.hasOwnProperty.call(CATALOG, s);
}

/** One notification-generating occurrence (mirror of Go's Emission). */
export interface Emission {
  event: EventType;
  entityType: string;
  entityId: string;
  actor: string;
  /** optional; defaulted to `/entityType/entityId` by the SQL function. */
  deepLink?: string;
  /** CDPS division for role-based recipient resolution. */
  division?: string;
  /** used when the caller already knows recipients. */
  explicitRecipients?: string[];
  /** include the actor as a recipient (default: exclude). */
  notifyActor?: boolean;
}

/** Arguments passed straight through to the SQL function `notify_emit`. */
export interface NotifyEmitArgs {
  event: string;
  entityType: string;
  entityId: string;
  actor: string;
  deepLink: string;
  division: string;
  explicit: string[];
  notifyActor: boolean;
}

/**
 * Executor over the atomic SQL emitter. The real implementation wraps
 * postgres.js/drizzle and runs inside the caller's transaction:
 *
 *   sql`select notify_emit(${event}, ...) as r`.then(r => r[0].r)
 */
export interface NotifyExecutor {
  notifyEmit(args: NotifyEmitArgs): Promise<{ ok: true; notified: string[] }>;
}

/**
 * emit resolves recipients and inserts one notification per recipient via
 * `notify_emit`, inside the caller's transaction. Returns the recipient ids
 * actually notified. Rejects an uncataloged event before touching the DB
 * (mirror of Go's "unknown event" error).
 */
export async function emit(exec: NotifyExecutor, em: Emission): Promise<string[]> {
  if (!isEventType(em.event)) {
    throw new Error(`notification: unknown event ${JSON.stringify(em.event)}`);
  }
  const res = await exec.notifyEmit({
    event: em.event,
    entityType: em.entityType,
    entityId: em.entityId,
    actor: em.actor,
    deepLink: em.deepLink ?? '',
    division: em.division ?? '',
    explicit: em.explicitRecipients ?? [],
    notifyActor: em.notifyActor ?? false,
  });
  return res.notified;
}
