// Declarative machine configuration, transcribed from docs/STATE_MACHINES.md.
//
// Ported 1:1 from backend/internal/core/statemachine/config.go. Do not invent
// statuses or edges not in that document.
//
// §B.2 of the migration appendix recommends these same edges live in DB tables
// (sm_machines / sm_edges) so the SQL transition function `sm_transition` reads
// them, and docs/STATE_MACHINES.md can seed them directly. This TypeScript config
// is the early/UX gate + the source for that seed; the two must stay identical.

import { DefaultBlockMessage } from "../bi-messages.js";
import { Machine, type EdgeDef } from "./machine.js";

// Machine names (stable identifiers).
export const MProspectAttempt = "prospect_attempt";
export const MLeadRecord = "lead_record";
export const MCampaign = "campaign";
export const MTransactionPayment = "transaction_payment";
export const MInstallment = "installment";
export const MService = "service";
export const MStrategyPlan = "strategy_plan";
export const MBriefTask = "brief_task";
export const MCreatorBooking = "creator_booking";
export const MCreatorPaymentReq = "creator_payment_request";
export const MLiveStreamSession = "live_stream_session";
export const MComplaint = "complaint";
export const MDependency = "dependency";
export const MAdCampaign = "ad_campaign";

interface MachineDef {
  name: string;
  initial: string;
  terminal?: string[];
  flags?: string[];
  autoComputed?: boolean;
  blockMessage?: string;
  edges?: EdgeDef[];
}

const DEFS: MachineDef[] = [
  // §1 Prospect attempt (M0/M1). Negotiation approval = Superior only.
  {
    name: MProspectAttempt,
    initial: "Pending Validation",
    terminal: ["Not Qualified", "Closed-Success", "Closed-Lost", "Blocked", "[Closed - Kalah Kompetisi]"],
    edges: [
      { from: "Pending Validation", to: "New Lead" },
      { from: "New Lead", to: "Contacted" },
      { from: "Contacted", to: "Qualified" },
      { from: "Contacted", to: "Not Qualified" },
      { from: "Qualified", to: "Negotiation - Pending Approval" },
      { from: "Qualified", to: "Negotiation - Auto Approved" },
      { from: "Negotiation - Pending Approval", to: "Negotiation - Approved", requireLead: true },
      { from: "Negotiation - Pending Approval", to: "Negotiation - Revision Required", requireLead: true },
      { from: "Negotiation - Pending Approval", to: "Negotiation - Rejected", requireLead: true },
      // DECISIONS O18 (stream A): "accept counter-offer" is the SALESPERSON's
      // action (M0 §5 line 122), not the superior's — so NOT lead-restricted.
      { from: "Negotiation - Revision Required", to: "Negotiation - Approved" },
      { from: "Negotiation - Revision Required", to: "Negotiation - Pending Approval" },
      // DECISIONS O16 (stream B) == O21 (stream A): a rejected proposal may be
      // resubmitted by the salesperson (new version) or the attempt closed as lost.
      { from: "Negotiation - Rejected", to: "Negotiation - Pending Approval" },
      { from: "Negotiation - Rejected", to: "Closed-Lost" },
      { from: "Negotiation - Approved", to: "Closed-Success" },
      { from: "Negotiation - Approved", to: "Closed-Lost" },
      { from: "Negotiation - Auto Approved", to: "Closed-Success" },
      { from: "Negotiation - Auto Approved", to: "Closed-Lost" },
      // Pool-competition auto-loss (M1 §6 rule 5 / STATE_MACHINES §1): every open
      // pursuit state may be closed as [Closed - Kalah Kompetisi] when a competitor
      // wins the lead. Driven only by win resolution (system actor).
      { from: "New Lead", to: "[Closed - Kalah Kompetisi]" },
      { from: "Contacted", to: "[Closed - Kalah Kompetisi]" },
      { from: "Qualified", to: "[Closed - Kalah Kompetisi]" },
      { from: "Negotiation - Pending Approval", to: "[Closed - Kalah Kompetisi]" },
      { from: "Negotiation - Revision Required", to: "[Closed - Kalah Kompetisi]" },
      { from: "Negotiation - Approved", to: "[Closed - Kalah Kompetisi]" },
      { from: "Negotiation - Auto Approved", to: "[Closed - Kalah Kompetisi]" },
    ],
  },
  // §2 Lead record (M1). Only the representable transitions.
  {
    name: MLeadRecord,
    initial: "[Pool]",
    terminal: [],
    edges: [
      { from: "[Rejected]", to: "[Pool]" }, // reopen
      { from: "[Not Qualified]", to: "[Pool]" }, // reopen
      { from: "[Pool]", to: "active" }, // claim
      { from: "active", to: "[Rejected]" },
      { from: "active", to: "[Not Qualified]" },
    ],
  },
  // §3 Campaign (M3).
  {
    name: MCampaign,
    initial: "Draft",
    terminal: ["Archived"],
    edges: [
      { from: "Draft", to: "Active" },
      { from: "Active", to: "Paused" },
      { from: "Paused", to: "Active" },
      { from: "Active", to: "Closed" },
      { from: "Paused", to: "Closed" },
      { from: "Closed", to: "Archived" },
    ],
  },
  // §4 Transaction payment status (M5). [Jatuh Tempo]/[Bermasalah] = flags.
  {
    name: MTransactionPayment,
    initial: "[Menunggu Verifikasi]",
    terminal: ["[Lunas]"],
    flags: ["[Jatuh Tempo]", "[Bermasalah]"],
    edges: [
      { from: "[Menunggu Verifikasi]", to: "[Terverifikasi - Sebagian]" },
      { from: "[Menunggu Verifikasi]", to: "[Lunas]" },
      { from: "[Terverifikasi - Sebagian]", to: "[Lunas]" },
    ],
  },
  // §5 Installment (M5).
  {
    name: MInstallment,
    initial: "[Belum Jatuh Tempo]",
    terminal: ["[Terverifikasi]"],
    flags: ["[Jatuh Tempo]"],
    edges: [
      { from: "[Belum Jatuh Tempo]", to: "[Jatuh Tempo]" },
      { from: "[Jatuh Tempo]", to: "[Terverifikasi]" },
      { from: "[Belum Jatuh Tempo]", to: "[Terverifikasi]" },
    ],
  },
  // §6 Service (M6). Void = SPV/Account Lead approval.
  {
    name: MService,
    initial: "[Awaiting Onboarding]",
    terminal: ["Done", "[Cancelled — Service Voided]"],
    edges: [
      { from: "[Awaiting Onboarding]", to: "[Strategy Approved]" },
      { from: "[Awaiting Onboarding]", to: "[Briefed]" }, // Direct services skip strategy
      { from: "[Strategy Approved]", to: "[Briefed]" },
      { from: "[Briefed]", to: "[In Execution]" },
      { from: "[In Execution]", to: "Done" },
      { from: "[Awaiting Onboarding]", to: "[Cancelled — Service Voided]", requireLead: true },
      { from: "[Strategy Approved]", to: "[Cancelled — Service Voided]", requireLead: true },
      { from: "[Briefed]", to: "[Cancelled — Service Voided]", requireLead: true },
      { from: "[In Execution]", to: "[Cancelled — Service Voided]", requireLead: true },
    ],
  },
  // §6a Strategy & Plan (M6 §4) — plan-gated services only. Submit is the owning
  // AM's action (owner-scoped in code, not lead); approve / request-revision are
  // SPV/Head Account (requireLead here, plus a division-specific Account-lead check
  // in module6_account — mirrors the Void-Service gate). On approval the parent
  // Service is also driven [Awaiting Onboarding] -> [Strategy Approved] in the SAME
  // transaction (see module6_account).
  {
    name: MStrategyPlan,
    initial: "[Strategy Drafting]",
    terminal: ["[Strategy Approved]"],
    edges: [
      { from: "[Strategy Drafting]", to: "[Strategy Submitted for Approval]" },
      { from: "[Strategy Submitted for Approval]", to: "[Strategy Approved]", requireLead: true },
      { from: "[Strategy Submitted for Approval]", to: "[Strategy Drafting]", requireLead: true }, // revision loop
    ],
  },
  // §7 Brief (M6) — canonical Task machine (M12), used by demo_tasks.
  {
    name: MBriefTask,
    initial: "[To Do]",
    terminal: ["[Approved]", "[Cancelled — Service Voided]"],
    edges: [
      { from: "[To Do]", to: "[In Progress]" },
      { from: "[In Progress]", to: "[Submitted]" },
      { from: "[Submitted]", to: "[In Review]" },
      { from: "[In Review]", to: "[Approved]" },
      { from: "[In Review]", to: "[Revision Requested]" },
      { from: "[Revision Requested]", to: "[In Progress]" },
      // [Blocked] = SPV/Lead-only (M12 §5.3a).
      { from: "[In Progress]", to: "[Blocked]", requireLead: true },
      { from: "[Blocked]", to: "[In Progress]", requireLead: true },
      // Void cascade (terminal), SPV/Account Lead approval.
      { from: "[To Do]", to: "[Cancelled — Service Voided]", requireLead: true },
      { from: "[In Progress]", to: "[Cancelled — Service Voided]", requireLead: true },
      { from: "[Submitted]", to: "[Cancelled — Service Voided]", requireLead: true },
      { from: "[In Review]", to: "[Cancelled — Service Voided]", requireLead: true },
      { from: "[Revision Requested]", to: "[Cancelled — Service Voided]", requireLead: true },
      { from: "[Blocked]", to: "[Cancelled — Service Voided]", requireLead: true },
    ],
  },
  // §8 Creator Booking (M9).
  {
    name: MCreatorBooking,
    initial: "[Sourcing]",
    terminal: ["[QC Passed]", "[Dropped]"],
    edges: [
      { from: "[Sourcing]", to: "[Booked]" },
      { from: "[Booked]", to: "[Content In Progress]" },
      { from: "[Content In Progress]", to: "[Content Submitted]" },
      { from: "[Content Submitted]", to: "[QC Review]" },
      { from: "[QC Review]", to: "[QC Passed]" },
      { from: "[QC Review]", to: "[QC Failed - Revision Requested]" },
      { from: "[QC Review]", to: "[Escalated - Creator Unresponsive]", requireLead: true },
      { from: "[QC Failed - Revision Requested]", to: "[Content Submitted]" },
      { from: "[Escalated - Creator Unresponsive]", to: "[Dropped]", requireLead: true },
      { from: "[Escalated - Creator Unresponsive]", to: "[Content Submitted]" },
      { from: "[Booked]", to: "[Dropped]", requireLead: true },
      { from: "[Sourcing]", to: "[Dropped]", requireLead: true },
    ],
  },
  // §9 Creator Payment Request (M9).
  {
    name: MCreatorPaymentReq,
    initial: "[Requested]",
    terminal: ["[Paid]", "[Rejected]"],
    edges: [
      { from: "[Requested]", to: "[Received by Finance]" },
      { from: "[Received by Finance]", to: "[Paid]" },
      { from: "[Received by Finance]", to: "[Rejected]" },
    ],
  },
  // §10 Live Stream Session (M10).
  {
    name: MLiveStreamSession,
    initial: "[Requested]",
    terminal: ["[Reconciled]"],
    edges: [
      { from: "[Requested]", to: "[Confirmed by Vendor]" },
      { from: "[Confirmed by Vendor]", to: "[Completed]" },
      { from: "[Completed]", to: "[Reconciled]" },
      { from: "[Completed]", to: "[Discrepancy Flagged]" },
      { from: "[Discrepancy Flagged]", to: "[Reconciled]" },
    ],
  },
  // §11 Complaint (M6).
  {
    name: MComplaint,
    initial: "[Open]",
    terminal: ["[Closed]"],
    edges: [
      { from: "[Open]", to: "[In Progress]" },
      { from: "[In Progress]", to: "[Resolved]" },
      { from: "[Resolved]", to: "[Closed]" },
    ],
  },
  // §12 Dependency (M11) — status auto-computed, no manual transitions.
  {
    name: MDependency,
    initial: "Pending",
    autoComputed: true,
    edges: [],
  },
  // §14 Ad Campaign (M8) — the ongoing paid-media record, born [Paused] (held, no
  // real spend) and outliving its setup Brief. Exactly three statuses (§9.3). The
  // [Paused]->[Active] Launch/Resume dependency (parent Brief + linked Assets
  // [Approved], §12) is a CODE guard in module8_ads, not an engine rule — the engine
  // cannot see those foreign statuses; the pause/resume edges themselves carry no
  // requireLead (routine optimization needs no approval gate, §6 Rule 3).
  {
    name: MAdCampaign,
    initial: "[Paused]",
    terminal: ["[Ended]"],
    edges: [
      { from: "[Paused]", to: "[Active]" }, // Launch / Resume
      { from: "[Active]", to: "[Paused]" }, // Pause / held on revision
      { from: "[Active]", to: "[Ended]" },
      { from: "[Paused]", to: "[Ended]" },
    ],
  },
];

/** defaultMachines returns the canonical machine set keyed by name. */
export function defaultMachines(): Map<string, Machine> {
  const out = new Map<string, Machine>();
  for (const d of DEFS) {
    out.set(
      d.name,
      new Machine({
        name: d.name,
        initial: d.initial,
        flags: d.flags ?? [],
        autoComputed: d.autoComputed ?? false,
        blockMessage: d.blockMessage && d.blockMessage !== "" ? d.blockMessage : DefaultBlockMessage,
        terminal: d.terminal ?? [],
        edges: d.edges ?? [],
      }),
    );
  }
  return out;
}
