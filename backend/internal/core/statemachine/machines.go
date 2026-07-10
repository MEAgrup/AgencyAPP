// Package statemachine is the CDPS status-transition engine (Sprint 0, S0-05).
//
// It is the ONLY path allowed to change a lifecycle entity's status
// (CLAUDE.md convention #2): no status field is ever set by a raw UPDATE.
// The transition tables below are transcribed from docs/STATE_MACHINES.md,
// which is itself extracted verbatim from the PRD modules. Every from->to
// pair that is not listed is blocked server-side and returns the machine's
// configured Bahasa Indonesia message (default: msg.TransisiTidakDiizinkan);
// a blocked transition changes NOTHING (no status write, no audit row, no
// event).
//
// The engine persists status through a caller-supplied Store (S0-05 keeps no
// migrations of its own; a status column lives on each entity's own table in
// later waves). Every successful transition appends one immutable audit row
// (S0-04) and publishes one events.Bus event for notification fan-out /
// derived-field recompute (S0-10).
//
// Scope of the machine registry (docs/STATE_MACHINES.md):
//   - Encoded: §1 Prospect attempt, §3 Campaign, §4 Transaction payment
//     status, §5 Installment, §6 Service, §7 Brief/canonical Task, §8 Creator
//     Booking, §9 Creator Payment Request, §10 Live Stream Session,
//     §11 Complaint.
//   - EXCLUDED §2 Lead record: not a transition table. It is flag/dedup/pool
//     logic (import gate, duplicate detection, reopen-to-pool) owned by M1;
//     modelling it as a status machine here would be an invention.
//   - EXCLUDED §12 Dependency: status is AUTO-COMPUTED from the source
//     entity's progress (Pending/Blocking/Satisfied) with NO manual
//     transitions, plus create-time graph validations (cycle/duplicate). It
//     belongs to M11's dependency resolver, not this generic engine.
//   - EXCLUDED §13 No-status entities: CHR-/PERF- snapshots are created
//     immutable by a monthly batch and never transition; Notification records
//     only flip unread->read (owned by S0-10's notification center).
package statemachine

import "github.com/meagrup/agencyapp/backend/internal/core/msg"

// EntityType selects which Machine governs an entity. Values are stable
// storage keys (they appear in audit rows and event payloads).
type EntityType string

const (
	EntityProspect              EntityType = "prospect"                // §1
	EntityCampaign              EntityType = "campaign"                // §3
	EntityTransaction           EntityType = "transaction"             // §4
	EntityInstallment           EntityType = "installment"             // §5
	EntityService               EntityType = "service"                 // §6
	EntityBrief                 EntityType = "brief"                   // §7 (canonical task machine, M12)
	EntityCreatorBooking        EntityType = "creator_booking"         // §8
	EntityCreatorPaymentRequest EntityType = "creator_payment_request" // §9
	EntityLiveStreamSession     EntityType = "live_stream_session"     // §10
	EntityComplaint             EntityType = "complaint"               // §11
)

// Status is a status label. Values are byte-exact from docs/STATE_MACHINES.md,
// including the square brackets / parentheses used there — those glyphs are
// part of the label the PRD renders, and CLAUDE.md forbids renaming BI labels.
type Status string

// Role is a CDPS role string used to gate role-restricted transitions.
// Lead and SPV share one division-wide role bucket per PERMISSIONS.md.
type Role = string

const RoleLeadSPV Role = "lead_spv"

// ---- §1 Prospect attempt statuses -----------------------------------------
const (
	ProspectPendingValidation Status = "Pending Validation"
	ProspectNewLead           Status = "New Lead"
	ProspectContacted         Status = "Contacted"
	ProspectQualified         Status = "Qualified"
	ProspectNotQualified      Status = "Not Qualified"
	ProspectBlocked           Status = "Blocked"
	ProspectNegPendingApprove Status = "Negotiation - Pending Approval"
	ProspectNegApproved       Status = "Negotiation - Approved"
	ProspectNegRevisionReq    Status = "Negotiation - Revision Required"
	ProspectNegRejected       Status = "Negotiation - Rejected"
	ProspectNegAutoApproved   Status = "Negotiation - Auto Approved"
	ProspectClosedSuccess     Status = "Closed-Success"
	ProspectClosedLost        Status = "Closed-Lost"
	ProspectClosedKalah       Status = "[Closed - Kalah Kompetisi]" // auto, pool-competition loss
)

// ---- §3 Campaign statuses --------------------------------------------------
const (
	CampaignDraft    Status = "Draft"
	CampaignActive   Status = "Active"
	CampaignPaused   Status = "Paused"
	CampaignClosed   Status = "Closed"
	CampaignArchived Status = "Archived"
)

// ---- §4 Transaction payment statuses --------------------------------------
const (
	TxnMenungguVerifikasi    Status = "[Menunggu Verifikasi]"
	TxnTerverifikasiSebagian Status = "[Terverifikasi - Sebagian]"
	TxnLunas                 Status = "[Lunas]"
)

// ---- §5 Installment statuses ----------------------------------------------
const (
	InstBelumJatuhTempo Status = "[Belum Jatuh Tempo]"
	InstJatuhTempo      Status = "[Jatuh Tempo]"
	InstTerverifikasi   Status = "[Terverifikasi]"
)

// ---- §6 Service statuses ---------------------------------------------------
const (
	ServiceIntake           Status = "(intake)" // PRD pseudo-label for the creation entry point
	ServiceStrategyApproved Status = "[Strategy Approved]"
	ServiceBriefed          Status = "[Briefed]"
	ServiceInExecution      Status = "[In Execution]"
)

// ---- §7 Brief / canonical Task statuses -----------------------------------
const (
	BriefToDo              Status = "[To Do]"
	BriefInProgress        Status = "[In Progress]"
	BriefSubmitted         Status = "[Submitted]"
	BriefInReview          Status = "[In Review]"
	BriefApproved          Status = "[Approved]"
	BriefRevisionRequested Status = "[Revision Requested]"
	BriefBlocked           Status = "[Blocked]"
	BriefCancelledVoided   Status = "[Cancelled — Service Voided]" // em dash, byte-exact
)

// ---- §8 Creator Booking statuses ------------------------------------------
const (
	BkgSourcing         Status = "[Sourcing]"
	BkgBooked           Status = "[Booked]"
	BkgContentProgress  Status = "[Content In Progress]"
	BkgContentSubmitted Status = "[Content Submitted]"
	BkgQCReview         Status = "[QC Review]"
	BkgQCPassed         Status = "[QC Passed]"
	BkgQCFailedRev      Status = "[QC Failed - Revision Requested]"
	BkgEscalated        Status = "[Escalated - Creator Unresponsive]"
	BkgDropped          Status = "[Dropped]"
)

// ---- §9 Creator Payment Request statuses ----------------------------------
const (
	CprRequested         Status = "[Requested]"
	CprReceivedByFinance Status = "[Received by Finance]"
	CprPaid              Status = "[Paid]"
	CprRejected          Status = "[Rejected]"
)

// ---- §10 Live Stream Session statuses -------------------------------------
const (
	LssRequested         Status = "[Requested]"
	LssConfirmedByVendor Status = "[Confirmed by Vendor]"
	LssCompleted         Status = "[Completed]"
	LssReconciled        Status = "[Reconciled]"
	LssDiscrepancy       Status = "[Discrepancy Flagged]"
)

// ---- §11 Complaint statuses ------------------------------------------------
const (
	CplOpen       Status = "[Open]"
	CplInProgress Status = "[In Progress]"
	CplResolved   Status = "[Resolved]"
	CplClosed     Status = "[Closed]"
)

// ---- §4 parallel flags (NOT statuses) -------------------------------------
// Flags are set/cleared independently of the status machine and never take
// part in transition validation (docs/STATE_MACHINES.md §4).
type Flag string

const (
	FlagJatuhTempo Flag = "[Jatuh Tempo]" // per-transaction overdue flag; clears on verification
	FlagBermasalah Flag = "[Bermasalah]"  // dispute/reversal flag; joint SPV Finance + SPV Account resolution
)

// Transition is one directed edge in a machine. It is intentionally a struct
// (not a bare pair) so later waves can attach guards, notification specs, SLA
// hooks, etc. WITHOUT breaking this API — add fields, never reshuffle.
type Transition struct {
	From Status
	To   Status
	// Roles, when non-empty, restricts this edge to actors holding at least
	// one of these CDPS roles. Empty = any authenticated actor may perform it.
	Roles []Role
	// Auto marks a system/batch/cascade-driven edge (e.g. due-date rollover,
	// void cascade, pool-competition auto-close). The engine ENFORCES this:
	// an Auto edge may only be taken by the system actor (ActorSystem); a
	// human/role actor attempting it is blocked (BlockedError, reason
	// "auto_only") with zero side effects.
	Auto bool
	// Event, when non-empty, overrides Machine.EventName for the event the
	// engine publishes on this edge. Used to fire a specific Phase 0 v2 §9
	// notification-catalog slug (see backend/internal/core/notify) instead of
	// the machine-generic name.
	Event string
	// Note documents non-obvious edges / flagged interpretations inline.
	Note string
}

// Machine is one entity's complete status configuration.
type Machine struct {
	Entity      EntityType
	Initial     []Status // creation entry point(s); informational + validated
	Terminal    []Status // states with no outgoing edges (no transition out)
	Transitions []Transition
	Flags       []Flag // parallel flags supported for this entity
	// BlockMsg is returned (as BlockedError.Message) when a from->to pair is
	// not allowed or a role check fails. Byte-exact BI string.
	BlockMsg string
	// EventName is the default event published on a successful transition.
	// Individual edges may override via Transition.Event.
	EventName string
}

// find returns the edge for from->to, or nil if the pair is not in the table.
func (m *Machine) find(from, to Status) *Transition {
	for i := range m.Transitions {
		if m.Transitions[i].From == from && m.Transitions[i].To == to {
			return &m.Transitions[i]
		}
	}
	return nil
}

// IsTerminal reports whether s is a declared terminal state.
func (m *Machine) IsTerminal(s Status) bool {
	for _, t := range m.Terminal {
		if t == s {
			return true
		}
	}
	return false
}

// hasFlag reports whether f is a flag declared for this machine.
func (m *Machine) hasFlag(f Flag) bool {
	for _, x := range m.Flags {
		if x == f {
			return true
		}
	}
	return false
}

// States returns every distinct status referenced by the machine (edges +
// declared initial + terminal). Used by the engine's config validator and by
// the full "unlisted pair is blocked" test sweep.
func (m *Machine) States() []Status {
	seen := map[Status]bool{}
	var out []Status
	add := func(s Status) {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	for _, s := range m.Initial {
		add(s)
	}
	for _, t := range m.Transitions {
		add(t.From)
		add(t.To)
	}
	for _, s := range m.Terminal {
		add(s)
	}
	return out
}

// machines is the immutable registry. Do not mutate at runtime.
var machines = buildMachines()

// Lookup returns the machine for an entity type.
func Lookup(e EntityType) (*Machine, bool) {
	m, ok := machines[e]
	return m, ok
}

// All returns every registered machine (stable-ish iteration for tests).
func All() map[EntityType]*Machine { return machines }

func buildMachines() map[EntityType]*Machine {
	return map[EntityType]*Machine{
		EntityProspect:              prospectMachine(),
		EntityCampaign:              campaignMachine(),
		EntityTransaction:           transactionMachine(),
		EntityInstallment:           installmentMachine(),
		EntityService:               serviceMachine(),
		EntityBrief:                 briefMachine(),
		EntityCreatorBooking:        creatorBookingMachine(),
		EntityCreatorPaymentRequest: creatorPaymentRequestMachine(),
		EntityLiveStreamSession:     liveStreamSessionMachine(),
		EntityComplaint:             complaintMachine(),
	}
}

// §1 Prospect attempt (M0/M1).
func prospectMachine() *Machine {
	leadOnly := []Role{RoleLeadSPV}
	return &Machine{
		Entity:    EntityProspect,
		Initial:   []Status{ProspectPendingValidation},
		Terminal:  []Status{ProspectNotQualified, ProspectBlocked, ProspectClosedSuccess, ProspectClosedLost, ProspectClosedKalah},
		Flags:     nil,
		BlockMsg:  msg.TransisiTidakDiizinkan,
		EventName: "prospect.status_transition",
		Transitions: []Transition{
			{From: ProspectPendingValidation, To: ProspectNewLead},
			{From: ProspectPendingValidation, To: ProspectBlocked, Auto: true, Note: "intake collision; no updates possible thereafter"},
			{From: ProspectNewLead, To: ProspectContacted},
			{From: ProspectContacted, To: ProspectQualified, Note: "only via successful Qualified Form submit"},
			{From: ProspectContacted, To: ProspectNotQualified},
			{From: ProspectQualified, To: ProspectNegPendingApprove, Event: "m0.negotiation.pending_approval_submitted"},
			{From: ProspectQualified, To: ProspectNegAutoApproved, Note: "no-negotiation path"},
			// Negotiation decisions are the Superior's call (PERMISSIONS M0: Sales Head/SPV only).
			{From: ProspectNegPendingApprove, To: ProspectNegApproved, Roles: leadOnly, Event: "m0.negotiation.decision"},
			{From: ProspectNegPendingApprove, To: ProspectNegRevisionReq, Roles: leadOnly, Event: "m0.negotiation.decision"},
			{From: ProspectNegPendingApprove, To: ProspectNegRejected, Roles: leadOnly, Event: "m0.negotiation.decision"},
			{From: ProspectNegRevisionReq, To: ProspectNegApproved, Roles: leadOnly, Note: "accept revision"},
			{From: ProspectNegRevisionReq, To: ProspectNegPendingApprove, Event: "m0.negotiation.pending_approval_submitted", Note: "resubmit, new version (salesperson)"},
			// Closing only from Approved / Auto Approved.
			{From: ProspectNegApproved, To: ProspectClosedSuccess},
			{From: ProspectNegAutoApproved, To: ProspectClosedSuccess},
			// FLAGGED INTERPRETATION: §1 shows a {Closed-Success | Closed-Lost}
			// outcome but never names Closed-Lost's source. Encoding the lost
			// deal as the exit of a rejected negotiation. See report.
			{From: ProspectNegRejected, To: ProspectClosedLost, Note: "FLAGGED: source of Closed-Lost not explicit in §1"},
			// Auto pool-competition loss. FLAGGED: §1 does not enumerate which
			// open states are auto-closed; using the live pursuit states.
			{From: ProspectNewLead, To: ProspectClosedKalah, Auto: true, Note: "FLAGGED: auto pool-competition loss, source-set is interpretation"},
			{From: ProspectContacted, To: ProspectClosedKalah, Auto: true, Note: "FLAGGED: auto pool-competition loss"},
			{From: ProspectQualified, To: ProspectClosedKalah, Auto: true, Note: "FLAGGED: auto pool-competition loss"},
			{From: ProspectNegPendingApprove, To: ProspectClosedKalah, Auto: true, Note: "FLAGGED: auto pool-competition loss"},
			{From: ProspectNegRevisionReq, To: ProspectClosedKalah, Auto: true, Note: "FLAGGED: auto pool-competition loss"},
			{From: ProspectNegApproved, To: ProspectClosedKalah, Auto: true, Note: "FLAGGED: auto pool-competition loss"},
			{From: ProspectNegAutoApproved, To: ProspectClosedKalah, Auto: true, Note: "FLAGGED: auto pool-competition loss"},
		},
	}
}

// §3 Campaign (CMP-).
func campaignMachine() *Machine {
	return &Machine{
		Entity:    EntityCampaign,
		Initial:   []Status{CampaignDraft},
		Terminal:  []Status{CampaignArchived},
		BlockMsg:  msg.TransisiTidakDiizinkan,
		EventName: "campaign.status_transition",
		Transitions: []Transition{
			{From: CampaignDraft, To: CampaignActive, Note: "starts accepting leads"},
			{From: CampaignActive, To: CampaignPaused, Note: "stops accepting/attributing new leads"},
			{From: CampaignPaused, To: CampaignActive, Note: "resumes"},
			{From: CampaignActive, To: CampaignClosed},
			{From: CampaignPaused, To: CampaignClosed},
			{From: CampaignClosed, To: CampaignArchived, Note: "read-only"},
		},
	}
}

// §4 Transaction payment status (M5).
func transactionMachine() *Machine {
	return &Machine{
		Entity:    EntityTransaction,
		Initial:   []Status{TxnMenungguVerifikasi},
		Terminal:  []Status{TxnLunas},
		Flags:     []Flag{FlagJatuhTempo, FlagBermasalah},
		BlockMsg:  msg.TransisiTidakDiizinkan,
		EventName: "transaction.payment_status_transition",
		Transitions: []Transition{
			{From: TxnMenungguVerifikasi, To: TxnTerverifikasiSebagian, Note: "routing gate: releases record to Account"},
			{From: TxnTerverifikasiSebagian, To: TxnLunas},
			{From: TxnMenungguVerifikasi, To: TxnLunas, Note: "Lunas scheme: one-shot full verification"},
		},
	}
}

// §5 Installment (INST-).
func installmentMachine() *Machine {
	return &Machine{
		Entity:    EntityInstallment,
		Initial:   []Status{InstBelumJatuhTempo},
		Terminal:  []Status{InstTerverifikasi},
		BlockMsg:  msg.TransisiTidakDiizinkan,
		EventName: "installment.status_transition",
		Transitions: []Transition{
			{From: InstBelumJatuhTempo, To: InstJatuhTempo, Auto: true, Note: "due date passed unverified"},
			{From: InstJatuhTempo, To: InstTerverifikasi},
			{From: InstBelumJatuhTempo, To: InstTerverifikasi, Note: "verified before due date"},
		},
	}
}

// §6 Service (M6).
//
// FLAGGED: §6 ends "-> done state per Brief rollup" WITHOUT naming the done
// status, and Void Service does not name a voided-service status (the
// [Cancelled — Service Voided] label in §6/§7 is a *Brief* status set by the
// cascade, encoded on the Brief machine). Those two states are left UNENCODED
// rather than invented; [In Execution] is therefore the last named state here.
func serviceMachine() *Machine {
	return &Machine{
		Entity:    EntityService,
		Initial:   []Status{ServiceIntake},
		Terminal:  nil, // done state unnamed in PRD; see comment above
		BlockMsg:  msg.TransisiTidakDiizinkan,
		EventName: "service.status_transition",
		Transitions: []Transition{
			{From: ServiceIntake, To: ServiceStrategyApproved, Note: "plan-gated only"},
			{From: ServiceIntake, To: ServiceBriefed, Note: "Direct services skip Strategy Approved"},
			{From: ServiceStrategyApproved, To: ServiceBriefed, Note: "first Brief created"},
			{From: ServiceBriefed, To: ServiceInExecution, Note: "any Brief leaves [To Do]"},
		},
	}
}

// §7 Brief / canonical Task machine (M6 briefs + M12 AST/BKG/BRF-as-task).
func briefMachine() *Machine {
	leadOnly := []Role{RoleLeadSPV}
	// Non-Approved, non-terminal states that a Void cascade / a Blocked pause
	// can act on. FLAGGED: §7 says Blocked "pause ... resume to [In Progress]"
	// and cancel applies to briefs "not yet [Approved]" but does not enumerate
	// the pausable/cancellable source set; using all active pre-Approved states.
	pausable := []Status{BriefToDo, BriefInProgress, BriefSubmitted, BriefInReview, BriefRevisionRequested}
	m := &Machine{
		Entity:    EntityBrief,
		Initial:   []Status{BriefToDo},
		Terminal:  []Status{BriefApproved, BriefCancelledVoided},
		BlockMsg:  msg.TransisiTidakDiizinkan,
		EventName: "brief.status_transition",
		Transitions: []Transition{
			{From: BriefToDo, To: BriefInProgress},
			{From: BriefInProgress, To: BriefSubmitted},
			{From: BriefSubmitted, To: BriefInReview},
			{From: BriefInReview, To: BriefApproved},
			{From: BriefInReview, To: BriefRevisionRequested},
			{From: BriefRevisionRequested, To: BriefInProgress, Note: "revision loop; Revision Count +1; turnaround NOT reset"},
			// Blocked pause/resume: SPV/Lead-only (PERMISSIONS M12).
			{From: BriefBlocked, To: BriefInProgress, Roles: leadOnly, Note: "resume"},
		},
	}
	// pause edges into [Blocked] (SPV/Lead-only)
	for _, s := range pausable {
		m.Transitions = append(m.Transitions, Transition{From: s, To: BriefBlocked, Roles: leadOnly, Note: "pause; SPV/Lead-only; staff/AM file block requests"})
	}
	// Void cascade -> [Cancelled — Service Voided] (terminal, auto). Also from
	// [Blocked] since a paused brief may be voided.
	for _, s := range append(append([]Status{}, pausable...), BriefBlocked) {
		m.Transitions = append(m.Transitions, Transition{From: s, To: BriefCancelledVoided, Auto: true, Note: "Void Service cascade; only non-Approved briefs"})
	}
	return m
}

// §8 Creator Booking (BKG-).
//
// FLAGGED: §8 draws the {QC Passed | QC Failed | Escalated | Dropped} branch
// off [QC Review]; encoded exactly so. "Creator Unresponsive"/"Dropped" may in
// practice originate earlier, and §8 does not state what [Escalated - Creator
// Unresponsive] resolves TO (AM/Lead decide) — so Escalated has no outgoing
// edge here (any transition out is blocked pending PRD clarification).
func creatorBookingMachine() *Machine {
	return &Machine{
		Entity:    EntityCreatorBooking,
		Initial:   []Status{BkgSourcing},
		Terminal:  []Status{BkgQCPassed, BkgDropped},
		BlockMsg:  msg.TransisiTidakDiizinkan,
		EventName: "creator_booking.status_transition",
		Transitions: []Transition{
			{From: BkgSourcing, To: BkgBooked},
			{From: BkgBooked, To: BkgContentProgress},
			{From: BkgContentProgress, To: BkgContentSubmitted, Note: "content link mandatory"},
			{From: BkgContentSubmitted, To: BkgQCReview},
			{From: BkgQCReview, To: BkgQCPassed},
			{From: BkgQCReview, To: BkgQCFailedRev},
			{From: BkgQCReview, To: BkgEscalated, Event: "m9.qc_or_booking.escalated", Note: "FLAGGED: resolution target of Escalated unspecified"},
			{From: BkgQCReview, To: BkgDropped},
			{From: BkgQCFailedRev, To: BkgContentSubmitted, Note: "creator fixes; counter +1; cap per M9"},
		},
	}
}

// §9 Creator Payment Request (CPR-).
//
// FLAGGED: §9 says [Rejected] goes "back to KOL" but does not name a target
// status; treating [Rejected] as terminal here (no resubmit edge invented).
func creatorPaymentRequestMachine() *Machine {
	return &Machine{
		Entity:    EntityCreatorPaymentRequest,
		Initial:   []Status{CprRequested},
		Terminal:  []Status{CprPaid, CprRejected},
		BlockMsg:  msg.TransisiTidakDiizinkan,
		EventName: "creator_payment_request.status_transition",
		Transitions: []Transition{
			{From: CprRequested, To: CprReceivedByFinance},
			{From: CprReceivedByFinance, To: CprPaid},
			{From: CprReceivedByFinance, To: CprRejected, Note: "reason mandatory; back to KOL"},
		},
	}
}

// §10 Live Stream Session (LSS-).
func liveStreamSessionMachine() *Machine {
	return &Machine{
		Entity:    EntityLiveStreamSession,
		Initial:   []Status{LssRequested},
		Terminal:  []Status{LssReconciled},
		BlockMsg:  msg.TransisiTidakDiizinkan,
		EventName: "live_stream_session.status_transition",
		Transitions: []Transition{
			{From: LssRequested, To: LssConfirmedByVendor},
			{From: LssConfirmedByVendor, To: LssCompleted, Note: "result fields + Vendor Report Link mandatory"},
			{From: LssCompleted, To: LssReconciled},
			{From: LssCompleted, To: LssDiscrepancy, Event: "m10.session.discrepancy_flagged", Note: "notes mandatory; SPV notified real-time"},
			{From: LssDiscrepancy, To: LssReconciled, Note: "non-blocking; may later reconcile"},
		},
	}
}

// §11 Complaint (CPL-).
func complaintMachine() *Machine {
	return &Machine{
		Entity:    EntityComplaint,
		Initial:   []Status{CplOpen},
		Terminal:  []Status{CplClosed},
		BlockMsg:  msg.TransisiTidakDiizinkan,
		EventName: "complaint.status_transition",
		Transitions: []Transition{
			{From: CplOpen, To: CplInProgress},
			{From: CplInProgress, To: CplResolved},
			{From: CplResolved, To: CplClosed, Note: "AM confirms client satisfaction (distinct from Resolved)"},
		},
	}
}
