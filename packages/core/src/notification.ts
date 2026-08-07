/**
 * In-app notification center — TypeScript catalog + wrapper over the SQL
 * function `notify_emit` (migration 20260723055732_statemachine.sql).
 *
 * Ported from backend/internal/core/notification. The event catalog is FROZEN,
 * and since O55 (DECISIONS 2026-08-07) "frozen" means VERSIONED rather than
 * "pinned to a literal": every event belongs to a catalog version, each version
 * is a registered row in `notif_catalog_versions`, and the invariant asserts the
 * catalog against that registry instead of against a hard-coded count. Adding an
 * event without registering it still fails; adding one together with its version
 * row is a visible amendment. v1 rows are frozen structurally (DB trigger).
 * The recipient resolution + per-recipient INSERT happen in `notify_emit`,
 * called inside the SAME transaction as the triggering change (atomic, never
 * best-effort). Notifications are never deletable (BEFORE DELETE trigger); the
 * only mutation is mark-as-read via `mark_notification_read`.
 */

/** How an event's recipients are resolved (mirror of the Go resolvers). */
export type Resolver = 'explicit' | 'leadsOfDivision' | 'explicitOrLeads';

/**
 * The cataloged event types (stable identifiers). v1 values mirror the Go
 * `EventType` string constants verbatim; v2 values are written exactly as the
 * M6A/6B/6C PRDs spell them (`strategi_diajukan`, not `m6a.strategi.diajukan`).
 * The convention break is deliberate — the PRD wrote those identifiers, and
 * re-coining them would be the rename the house rules forbid.
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

  // ----- catalog v2 (O55) — 4 Strategi (M6A §7 D12) -----
  StrategiDiajukan: 'strategi_diajukan', // -> SPV / Head of Account
  StrategiDisetujui: 'strategi_disetujui', // -> AM + execution division leads + Finance
  StrategiDikembalikan: 'strategi_dikembalikan', // -> AM
  StrategiRevisiDisarankan: 'strategi_revisi_disarankan', // -> AM + SPV
  // ----- catalog v2 — 6 Plan (M6B §9) -----
  PlanPeriodeAktif: 'plan_periode_aktif', // -> AM + division leads with rows
  PlanTargetDiturunkan: 'plan_target_diturunkan', // -> SPV
  PlanBarisBelumDieksekusi: 'plan_baris_belum_dieksekusi', // -> AM + SPV
  PlanKeberatanKapasitas: 'plan_keberatan_kapasitas', // -> AM + SPV
  PlanRealisasiBelumLengkap: 'plan_realisasi_belum_lengkap', // -> AM + SPV
  PlanPeriodeDitutup: 'plan_periode_ditutup', // -> AM + SPV + Finance
  // ----- catalog v2 — 3 Gate (M6C §10) -----
  GateOverrideDicatat: 'gate_override_dicatat', // -> SPV
  PlanSekarangDisarankan: 'plan_sekarang_disarankan', // -> AM + SPV
  GateDeeskalasiDiminta: 'gate_deeskalasi_diminta', // -> SPV
  // ----- catalog v2 — 1 Account (O53) -----
  ClientAssigned: 'm6.client.assigned', // -> the assigned AM
} as const;

/** A cataloged event type. */
export type EventType = (typeof EVENTS)[keyof typeof EVENTS];

/** A registered catalog version (mirror of a `notif_catalog_versions` row). */
export interface CatalogVersion {
  version: number;
  description: string;
  /** How many events THIS version introduces (not cumulative). */
  eventCount: number;
  decisionRef: string;
}

/**
 * The registered catalog versions. This is the replacement for the literal the
 * invariant test used to assert: `eventCount` here is the number the test now
 * checks the catalog against, and it must equal the `notif_catalog_versions`
 * rows in the DB.
 */
export const CATALOG_VERSIONS: readonly CatalogVersion[] = [
  {
    version: 1,
    description: 'Fase 0 v2 §9 — 15 event beku + 2 deviasi lead-delete tercatat',
    eventCount: 17,
    decisionRef: 'docs/DECISIONS.md 2026-07-29 (lead delete) + Phase 0 v2 §9',
  },
  {
    version: 2,
    description: 'M6A §7 D12 + M6B §9 + M6C §10 — 4 Strategi, 6 Plan, 3 Gate; + m6.client.assigned (O53)',
    eventCount: 14,
    decisionRef: 'docs/DECISIONS.md 2026-08-07 (O55 pilihan a; menutup O53)',
  },
] as const;

/** The catalog version currently in force. */
export const CATALOG_VERSION = CATALOG_VERSIONS[CATALOG_VERSIONS.length - 1].version;

/**
 * registeredEventCount is the total the catalog MUST have, derived from the
 * registry. The invariant asserts against this, never against a literal (O55).
 */
export function registeredEventCount(): number {
  return CATALOG_VERSIONS.reduce((n, v) => n + v.eventCount, 0);
}

/** One catalog entry: human description + recipient resolver + its version. */
export interface CatalogEntry {
  description: string;
  resolver: Resolver;
  /** Catalog version that introduced this event. */
  version: number;
}

/**
 * The catalog — event → {description, resolver, version}. Must stay identical to
 * the `notif_events` seed in the migrations, including the version column.
 *
 * v1 (17): the 15 FROZEN Phase 0 v2 §9 entries, identical to Go's NewCatalog,
 * plus the two `m1.lead.delete_*` entries — a logged deviation (DECISIONS
 * 2026-07-29, seeded in 20260729162101_lead_delete_request.sql) that postdates
 * the Go build. These are frozen structurally: the DB rejects UPDATE/DELETE on
 * any v1 row.
 *
 * v2 (14): the single M6A/6B/6C amendment (O55, seeded in
 * 20260807010000_notif_catalog_v2.sql) plus `m6.client.assigned` (O53).
 */
export const CATALOG: Record<EventType, CatalogEntry> = {
  [EVENTS.NegotiationPendingApproval]: { description: 'Negotiation Pending Approval submitted', resolver: 'leadsOfDivision', version: 1 },
  [EVENTS.NegotiationDecision]: { description: 'Negotiation decision', resolver: 'explicit', version: 1 },
  [EVENTS.InstallmentDue]: { description: 'Installment due/overdue', resolver: 'explicitOrLeads', version: 1 },
  [EVENTS.ContractNotReceived]: { description: 'Contract not received 7 days after routing', resolver: 'explicitOrLeads', version: 1 },
  [EVENTS.ComplaintLogged]: { description: 'Complaint logged (any door)', resolver: 'explicitOrLeads', version: 1 },
  [EVENTS.KOLQCFailedOrEscalated]: { description: 'QC Failed / Booking Escalated', resolver: 'leadsOfDivision', version: 1 },
  [EVENTS.SessionDiscrepancyFlagged]: { description: 'Session Discrepancy Flagged', resolver: 'leadsOfDivision', version: 1 },
  [EVENTS.DependencySatisfied]: { description: 'Blocking Dependency Satisfied', resolver: 'explicit', version: 1 },
  [EVENTS.BlockRequestSubmitted]: { description: 'Block request submitted', resolver: 'leadsOfDivision', version: 1 },
  [EVENTS.BlockRequestDecided]: { description: 'Block request approved/rejected', resolver: 'explicit', version: 1 },
  [EVENTS.RevisionCountFlag]: { description: 'Revision Count >= 3 (Quality flag)', resolver: 'leadsOfDivision', version: 1 },
  [EVENTS.ClientBandDrop]: { description: 'Client band drop', resolver: 'leadsOfDivision', version: 1 },
  [EVENTS.PerformancePublished]: { description: 'Monthly Performance Score published', resolver: 'explicit', version: 1 },
  [EVENTS.LeadCoPursuit]: { description: 'Lead dikerjakan lebih dari satu sales', resolver: 'explicit', version: 1 },
  [EVENTS.HoursLoggedReminder]: { description: 'Hours Logged end-of-day reminder', resolver: 'explicit', version: 1 },
  [EVENTS.LeadDeleteRequested]: { description: 'Permintaan hapus lead diajukan', resolver: 'leadsOfDivision', version: 1 },
  [EVENTS.LeadDeleteDecided]: { description: 'Permintaan hapus lead di-ACC/tolak', resolver: 'explicit', version: 1 },

  // --- v2 (O55) — descriptions and resolvers must match the migration seed ---
  [EVENTS.StrategiDiajukan]: { description: 'Strategi diajukan AM (v1 atau revisi) — ke SPV/Head of Account', resolver: 'leadsOfDivision', version: 2 },
  [EVENTS.StrategiDisetujui]: { description: 'Strategi disetujui reviewer — ke AM, lead divisi eksekusi, Finance', resolver: 'explicitOrLeads', version: 2 },
  [EVENTS.StrategiDikembalikan]: { description: 'Strategi dikembalikan reviewer dengan catatan — ke AM', resolver: 'explicit', version: 2 },
  [EVENTS.StrategiRevisiDisarankan]: { description: 'Pemicu H-2 menyala atau asumsi D-8 flip ke Gugur — ke AM + SPV', resolver: 'explicitOrLeads', version: 2 },
  [EVENTS.PlanPeriodeAktif]: { description: 'Periode Plan aktif (manual atau otomatis) — ke AM + lead divisi yang punya baris', resolver: 'explicitOrLeads', version: 2 },
  [EVENTS.PlanTargetDiturunkan]: { description: 'Penyesuaian target ke bawah — ke SPV (>10% = permintaan persetujuan)', resolver: 'leadsOfDivision', version: 2 },
  [EVENTS.PlanBarisBelumDieksekusi]: { description: 'Baris tanpa Brief di tengah periode — ke AM + SPV', resolver: 'explicitOrLeads', version: 2 },
  [EVENTS.PlanKeberatanKapasitas]: { description: 'Divisi mengajukan keberatan kapasitas — ke AM + SPV', resolver: 'explicitOrLeads', version: 2 },
  [EVENTS.PlanRealisasiBelumLengkap]: { description: 'GMV manual belum diisi 5 hari setelah tutup — ke AM + SPV', resolver: 'explicitOrLeads', version: 2 },
  [EVENTS.PlanPeriodeDitutup]: { description: 'Periode ditutup (termasuk auto-close, dengan flag) — ke AM, SPV, Finance', resolver: 'explicitOrLeads', version: 2 },
  [EVENTS.GateOverrideDicatat]: { description: 'Keputusan AM menyimpang dari rekomendasi gerbang — ke SPV', resolver: 'leadsOfDivision', version: 2 },
  [EVENTS.PlanSekarangDisarankan]: { description: 'Pemicu keras muncul pada service tanpa Plan — ke AM + SPV', resolver: 'explicitOrLeads', version: 2 },
  [EVENTS.GateDeeskalasiDiminta]: { description: 'AM minta mematikan Plan di tengah service — ke SPV (butuh persetujuan)', resolver: 'leadsOfDivision', version: 2 },
  [EVENTS.ClientAssigned]: { description: 'Klien di-assign ke AM — ke AM bersangkutan', resolver: 'explicit', version: 2 },
};

/** All registered event types (introspection / tests). */
export function events(): EventType[] {
  return Object.keys(CATALOG) as EventType[];
}

/** The event types introduced by one catalog version. */
export function eventsOfVersion(version: number): EventType[] {
  return events().filter((e) => CATALOG[e].version === version);
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
