// In-app notification center — event catalog (S0-10).
//
// Ported from backend/internal/core/notification/notification.go
// (SUPABASE_MIGRATION_TECH_APPENDIX §B.6). The event catalog is Phase 0 v2 §9 and
// is FROZEN at 15 events (the 13 Phase 0 events, the M1 dedup-v2 co-pursuit event,
// and the Wave-3-catalog-opening Hours Logged reminder — DECISIONS O29 / W3-CAT-1).
//
// Split per §B.6: the catalog (event ids, descriptions, resolver kind) and the
// recipient-selection semantics (de-dup, actor exclusion) are PURE and live here.
// The recipient RESOLVERS (leadsOfDivision = employees JOIN role_mappings) and the
// INSERT into `notifications` are SQL, run inside the SAME transaction as the
// triggering `sm_transition` so the notification is atomic and derived-from the
// transition (never best-effort). MarkRead/List/UnreadCount are plain reads under
// RLS (no special function needed).

/** The 15 cataloged events (FROZEN). Values are the stable event_type strings. */
export const EventType = {
  NegotiationPendingApproval: "m0.negotiation.pending_approval", // -> Sales Head/SPV
  NegotiationDecision: "m0.negotiation.decision", // -> Salesperson
  InstallmentDue: "m0m5.installment.due", // -> Sales PIC + Finance
  ContractNotReceived: "m5.contract.not_received", // -> Finance + SPV
  ComplaintLogged: "m6.complaint.logged", // -> AM + SPV Account
  KOLQCFailedOrEscalated: "m9.kol.qc_failed_or_escalated", // -> KOL Lead
  SessionDiscrepancyFlagged: "m10.session.discrepancy_flagged", // -> SPV Account
  DependencySatisfied: "m11.dependency.satisfied", // -> Target Brief PIC
  BlockRequestSubmitted: "m12.block_request.submitted", // -> SPV/Lead
  BlockRequestDecided: "m12.block_request.decided", // -> Requester
  RevisionCountFlag: "m12.revision_count.flag", // -> Team Leader/SPV
  ClientBandDrop: "m13.client.band_drop", // -> SPV
  PerformancePublished: "m14.performance.published", // -> Each staff
  LeadCoPursuit: "m1.lead.co_pursuit", // -> co-pursuit owners + registrant
  // M7-OA-2, DECISIONS O29 / W3-CAT-1: end-of-day nudge for an Asset's assigned PIC
  // who has not logged Hours today (WIB). Explicit; non-punitive, supplementary.
  HoursLoggedReminder: "m7.hours_logged.reminder", // -> the Asset's assigned PIC
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

/** How a cataloged event resolves its recipients (SQL-side, §B.6). */
export type ResolverKind = "leadsOfDivision" | "explicit" | "explicitOrLeads";

export interface CatalogEntry {
  description: string;
  resolver: ResolverKind;
}

/** The frozen catalog: event -> description + recipient resolver kind. */
export const CATALOG: Record<EventType, CatalogEntry> = {
  [EventType.NegotiationPendingApproval]: { description: "Negotiation Pending Approval submitted", resolver: "leadsOfDivision" },
  [EventType.NegotiationDecision]: { description: "Negotiation decision", resolver: "explicit" },
  [EventType.InstallmentDue]: { description: "Installment due/overdue", resolver: "explicitOrLeads" },
  [EventType.ContractNotReceived]: { description: "Contract not received 7 days after routing", resolver: "explicitOrLeads" },
  [EventType.ComplaintLogged]: { description: "Complaint logged (any door)", resolver: "explicitOrLeads" },
  [EventType.KOLQCFailedOrEscalated]: { description: "QC Failed / Booking Escalated", resolver: "leadsOfDivision" },
  [EventType.SessionDiscrepancyFlagged]: { description: "Session Discrepancy Flagged", resolver: "leadsOfDivision" },
  [EventType.DependencySatisfied]: { description: "Blocking Dependency Satisfied", resolver: "explicit" },
  [EventType.BlockRequestSubmitted]: { description: "Block request submitted", resolver: "leadsOfDivision" },
  [EventType.BlockRequestDecided]: { description: "Block request approved/rejected", resolver: "explicit" },
  [EventType.RevisionCountFlag]: { description: "Revision Count >= 3 (Quality flag)", resolver: "leadsOfDivision" },
  [EventType.ClientBandDrop]: { description: "Client band drop", resolver: "leadsOfDivision" },
  [EventType.PerformancePublished]: { description: "Monthly Performance Score published", resolver: "explicit" },
  [EventType.LeadCoPursuit]: { description: "Lead dikerjakan lebih dari satu sales", resolver: "explicit" },
  [EventType.HoursLoggedReminder]: { description: "Hours Logged end-of-day reminder", resolver: "explicit" },
};

/** events returns all registered event types (introspection/tests). */
export function events(): EventType[] {
  return Object.keys(CATALOG) as EventType[];
}

/** isEvent reports whether e is a cataloged event (guards against "wild" strings). */
export function isEvent(e: string): e is EventType {
  return Object.prototype.hasOwnProperty.call(CATALOG, e);
}

/** Emission is one notification-generating occurrence (mirrors Go Emission). */
export interface Emission {
  event: EventType;
  entityType: string;
  entityId: string;
  actor: string; // actor employee id
  deepLink?: string; // optional; defaulted from entity if empty
  division?: string; // CDPS division for role-based recipient resolution
  explicitRecipients?: string[]; // used when the caller already knows recipients
  notifyActor?: boolean; // include the actor as a recipient (default: exclude)
}

/** deepLinkFor returns the emission's deep link, defaulted from the entity. */
export function deepLinkFor(em: Emission): string {
  return em.deepLink && em.deepLink !== "" ? em.deepLink : `/${em.entityType}/${em.entityId}`;
}

/**
 * selectRecipients applies the PURE recipient filter the Go Emit loop applies to
 * the resolver's candidates before inserting one notification per recipient:
 *   - drop empty ids,
 *   - de-duplicate (first occurrence wins, order preserved),
 *   - drop the actor unless notifyActor is set.
 * The candidate list itself comes from the SQL resolver (leadsOfDivision / explicit
 * / explicitOrLeads); this function decides who actually gets a row.
 */
export function selectRecipients(candidates: readonly string[], em: Emission): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of candidates) {
    if (r === "" || seen.has(r)) continue;
    if (r === em.actor && !em.notifyActor) continue;
    seen.add(r);
    out.push(r);
  }
  return out;
}
