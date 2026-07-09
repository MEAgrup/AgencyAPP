package statemachine

// This file transcribes docs/STATE_MACHINES.md into declarative machine
// configs. Do not invent statuses or edges not in that document.

type edge struct {
	from        string
	to          string
	requireLead bool // SPV/Lead-only transition
}

type def struct {
	name         string
	initial      string
	terminal     []string
	flags        []string
	autoComputed bool
	blockMessage string
	edges        []edge
}

func (d def) compile() *Machine {
	bm := d.blockMessage
	if bm == "" {
		bm = DefaultBlockMessage
	}
	m := &Machine{
		Name:         d.name,
		Initial:      d.initial,
		Flags:        d.flags,
		AutoComputed: d.autoComputed,
		BlockMessage: bm,
		terminal:     map[string]bool{},
		transitions:  map[string]map[string]rule{},
	}
	for _, t := range d.terminal {
		m.terminal[t] = true
	}
	for _, e := range d.edges {
		if m.transitions[e.from] == nil {
			m.transitions[e.from] = map[string]rule{}
		}
		m.transitions[e.from][e.to] = rule{requireLead: e.requireLead}
	}
	return m
}

// Machine names (stable identifiers).
const (
	MProspectAttempt    = "prospect_attempt"
	MLeadRecord         = "lead_record"
	MCampaign           = "campaign"
	MTransactionPayment = "transaction_payment"
	MInstallment        = "installment"
	MService            = "service"
	MBriefTask          = "brief_task"
	MCreatorBooking     = "creator_booking"
	MCreatorPaymentReq  = "creator_payment_request"
	MLiveStreamSession  = "live_stream_session"
	MComplaint          = "complaint"
	MDependency         = "dependency"
)

func defaultMachines() map[string]*Machine {
	defs := []def{
		// §1 Prospect attempt (M0/M1). Negotiation approval = Superior only.
		{
			name:     MProspectAttempt,
			initial:  "Pending Validation",
			terminal: []string{"Not Qualified", "Closed-Success", "Closed-Lost", "Blocked"},
			edges: []edge{
				{from: "Pending Validation", to: "New Lead"},
				{from: "New Lead", to: "Contacted"},
				{from: "Contacted", to: "Qualified"},
				{from: "Contacted", to: "Not Qualified"},
				{from: "Qualified", to: "Negotiation - Pending Approval"},
				{from: "Qualified", to: "Negotiation - Auto Approved"},
				{from: "Negotiation - Pending Approval", to: "Negotiation - Approved", requireLead: true},
				{from: "Negotiation - Pending Approval", to: "Negotiation - Revision Required", requireLead: true},
				{from: "Negotiation - Pending Approval", to: "Negotiation - Rejected", requireLead: true},
				{from: "Negotiation - Revision Required", to: "Negotiation - Approved", requireLead: true},
				{from: "Negotiation - Revision Required", to: "Negotiation - Pending Approval"},
				{from: "Negotiation - Approved", to: "Closed-Success"},
				{from: "Negotiation - Approved", to: "Closed-Lost"},
				{from: "Negotiation - Auto Approved", to: "Closed-Success"},
				{from: "Negotiation - Auto Approved", to: "Closed-Lost"},
			},
		},
		// §2 Lead record (M1). Only the representable transitions.
		{
			name:     MLeadRecord,
			initial:  "[Pool]",
			terminal: []string{},
			edges: []edge{
				{from: "[Rejected]", to: "[Pool]"},      // reopen
				{from: "[Not Qualified]", to: "[Pool]"}, // reopen
				{from: "[Pool]", to: "active"},          // claim
				{from: "active", to: "[Rejected]"},
				{from: "active", to: "[Not Qualified]"},
			},
		},
		// §3 Campaign (M3).
		{
			name:     MCampaign,
			initial:  "Draft",
			terminal: []string{"Archived"},
			edges: []edge{
				{from: "Draft", to: "Active"},
				{from: "Active", to: "Paused"},
				{from: "Paused", to: "Active"},
				{from: "Active", to: "Closed"},
				{from: "Paused", to: "Closed"},
				{from: "Closed", to: "Archived"},
			},
		},
		// §4 Transaction payment status (M5). [Jatuh Tempo]/[Bermasalah] = flags.
		{
			name:     MTransactionPayment,
			initial:  "[Menunggu Verifikasi]",
			terminal: []string{"[Lunas]"},
			flags:    []string{"[Jatuh Tempo]", "[Bermasalah]"},
			edges: []edge{
				{from: "[Menunggu Verifikasi]", to: "[Terverifikasi - Sebagian]"},
				{from: "[Menunggu Verifikasi]", to: "[Lunas]"},
				{from: "[Terverifikasi - Sebagian]", to: "[Lunas]"},
			},
		},
		// §5 Installment (M5).
		{
			name:     MInstallment,
			initial:  "[Belum Jatuh Tempo]",
			terminal: []string{"[Terverifikasi]"},
			flags:    []string{"[Jatuh Tempo]"},
			edges: []edge{
				{from: "[Belum Jatuh Tempo]", to: "[Jatuh Tempo]"},
				{from: "[Jatuh Tempo]", to: "[Terverifikasi]"},
				{from: "[Belum Jatuh Tempo]", to: "[Terverifikasi]"},
			},
		},
		// §6 Service (M6). Void = SPV/Account Lead approval.
		{
			name:     MService,
			initial:  "Intake",
			terminal: []string{"Done", "[Cancelled — Service Voided]"},
			edges: []edge{
				{from: "Intake", to: "[Strategy Approved]"},
				{from: "Intake", to: "[Briefed]"}, // Direct services skip strategy
				{from: "[Strategy Approved]", to: "[Briefed]"},
				{from: "[Briefed]", to: "[In Execution]"},
				{from: "[In Execution]", to: "Done"},
				{from: "Intake", to: "[Cancelled — Service Voided]", requireLead: true},
				{from: "[Strategy Approved]", to: "[Cancelled — Service Voided]", requireLead: true},
				{from: "[Briefed]", to: "[Cancelled — Service Voided]", requireLead: true},
				{from: "[In Execution]", to: "[Cancelled — Service Voided]", requireLead: true},
			},
		},
		// §7 Brief (M6) — canonical Task machine (M12), used by demo_tasks.
		{
			name:     MBriefTask,
			initial:  "[To Do]",
			terminal: []string{"[Approved]", "[Cancelled — Service Voided]"},
			edges: []edge{
				{from: "[To Do]", to: "[In Progress]"},
				{from: "[In Progress]", to: "[Submitted]"},
				{from: "[Submitted]", to: "[In Review]"},
				{from: "[In Review]", to: "[Approved]"},
				{from: "[In Review]", to: "[Revision Requested]"},
				{from: "[Revision Requested]", to: "[In Progress]"},
				// [Blocked] = SPV/Lead-only (M12 §5.3a).
				{from: "[In Progress]", to: "[Blocked]", requireLead: true},
				{from: "[Blocked]", to: "[In Progress]", requireLead: true},
				// Void cascade (terminal), SPV/Account Lead approval.
				{from: "[To Do]", to: "[Cancelled — Service Voided]", requireLead: true},
				{from: "[In Progress]", to: "[Cancelled — Service Voided]", requireLead: true},
				{from: "[Submitted]", to: "[Cancelled — Service Voided]", requireLead: true},
				{from: "[In Review]", to: "[Cancelled — Service Voided]", requireLead: true},
				{from: "[Revision Requested]", to: "[Cancelled — Service Voided]", requireLead: true},
				{from: "[Blocked]", to: "[Cancelled — Service Voided]", requireLead: true},
			},
		},
		// §8 Creator Booking (M9).
		{
			name:     MCreatorBooking,
			initial:  "[Sourcing]",
			terminal: []string{"[QC Passed]", "[Dropped]"},
			edges: []edge{
				{from: "[Sourcing]", to: "[Booked]"},
				{from: "[Booked]", to: "[Content In Progress]"},
				{from: "[Content In Progress]", to: "[Content Submitted]"},
				{from: "[Content Submitted]", to: "[QC Review]"},
				{from: "[QC Review]", to: "[QC Passed]"},
				{from: "[QC Review]", to: "[QC Failed - Revision Requested]"},
				{from: "[QC Review]", to: "[Escalated - Creator Unresponsive]", requireLead: true},
				{from: "[QC Failed - Revision Requested]", to: "[Content Submitted]"},
				{from: "[Escalated - Creator Unresponsive]", to: "[Dropped]", requireLead: true},
				{from: "[Escalated - Creator Unresponsive]", to: "[Content Submitted]"},
				{from: "[Booked]", to: "[Dropped]", requireLead: true},
				{from: "[Sourcing]", to: "[Dropped]", requireLead: true},
			},
		},
		// §9 Creator Payment Request (M9).
		{
			name:     MCreatorPaymentReq,
			initial:  "[Requested]",
			terminal: []string{"[Paid]", "[Rejected]"},
			edges: []edge{
				{from: "[Requested]", to: "[Received by Finance]"},
				{from: "[Received by Finance]", to: "[Paid]"},
				{from: "[Received by Finance]", to: "[Rejected]"},
			},
		},
		// §10 Live Stream Session (M10).
		{
			name:     MLiveStreamSession,
			initial:  "[Requested]",
			terminal: []string{"[Reconciled]"},
			edges: []edge{
				{from: "[Requested]", to: "[Confirmed by Vendor]"},
				{from: "[Confirmed by Vendor]", to: "[Completed]"},
				{from: "[Completed]", to: "[Reconciled]"},
				{from: "[Completed]", to: "[Discrepancy Flagged]"},
				{from: "[Discrepancy Flagged]", to: "[Reconciled]"},
			},
		},
		// §11 Complaint (M6).
		{
			name:     MComplaint,
			initial:  "[Open]",
			terminal: []string{"[Closed]"},
			edges: []edge{
				{from: "[Open]", to: "[In Progress]"},
				{from: "[In Progress]", to: "[Resolved]"},
				{from: "[Resolved]", to: "[Closed]"},
			},
		},
		// §12 Dependency (M11) — status auto-computed, no manual transitions.
		{
			name:         MDependency,
			initial:      "Pending",
			autoComputed: true,
			edges:        nil,
		},
	}

	out := map[string]*Machine{}
	for _, d := range defs {
		out[d.name] = d.compile()
	}
	return out
}
