// Dedup / registration-door decision table (M1 §5, W1-01; collaborative v2 —
// DECISIONS "M1 DEDUP DIREDESAIN", 2026-07-10). This is the pure decision
// function — given the existing record a new intake collides with (if any) and
// the intake channel, it returns exactly what should happen. Persistence applies
// the decision; every decision (incl. blocked/join/reopen) is audit-logged by
// the caller (M1 §5 Rule 6).
//
// Dedup checks against ALL historical records, no time window (M1-OA-4), keyed
// on NormalizePhone. Two channels differ by design (D1): ChannelImport still
// BLOCKS a duplicate that is being worked (an import row carries no sales attempt
// — nobody is collaborating), while ChannelSingleReg is COLLABORATIVE — a second
// salesperson registering the same phone JOINS the existing lead with a parallel
// attempt instead of being turned away.
package module1_leads

import "strings"

// Verbatim BI messages (M1 §3/§4/§5, quoted per originating section — the
// active-lead import string is retained; the single-reg block is retired by the
// collaborative redesign, DECISIONS O11 + "M1 DEDUP DIREDESAIN"). The two v2
// strings (MsgCollabJoined, MsgAlreadyOwnAttempt) are the only new strings (D5).
const (
	MsgActiveOtherSalesImport    = "[lead sedang diproses oleh sales lain (nama)]"
	MsgActiveOtherSalesSingleReg = "[tidak bisa ditambahkan, lead sedang diproses oleh sales lain (nama)]" // retired for single-reg (D1); kept for reference/back-compat
	MsgDuplicatePool             = "[lead sudah ada & sedang diproses, tidak diimport]"
	MsgAlreadyClient             = "[lead sudah menjadi klien]"
	MsgRowIncomplete             = "[data tidak lengkap, baris tidak diimport]"
	MsgSingleIncomplete          = "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]"

	// v2 collaborative-dedup strings (D5). MsgCollabJoined is a NON-blocking info
	// returned to the joining salesperson; MsgAlreadyOwnAttempt blocks the same
	// salesperson re-registering a lead they already actively hold.
	MsgCollabJoined      = "[lead juga sedang dikerjakan sales lain (nama)]"
	MsgAlreadyOwnAttempt = "[lead ini sudah anda pegang & masih diproses]"
)

// Channel is the intake door (affects the active-lead message wording).
type Channel int

const (
	ChannelImport    Channel = iota // Marketing bulk/single import
	ChannelSingleReg                // Sales single registration
)

// Record statuses used by the dedup table (subset of the lead_record machine).
const (
	StatusPool         = "[Pool]"
	StatusRejected     = "[Rejected]"
	StatusNotQualified = "[Not Qualified]"
	StatusClosedWin    = "[Closed-Success]"
	StatusActive       = "active"
)

// AttemptOwner is one salesperson holding a non-terminal attempt on a lead.
type AttemptOwner struct {
	EmployeeID string
	Name       string
}

// ExistingLead is the record a new intake matched on normalized phone.
//
// ActiveOwners is the full set of non-terminal attempt owners (the collaborators
// already working the lead). HasActiveScoutedAttempt and ActiveOwnerName are
// derived from it and kept for low-churn legacy consumers (importer, older
// tests). ActorHasActiveAttempt is true when the registering actor is one of the
// ActiveOwners — this is what lets Decide tell "same salesperson re-registering"
// (block) apart from "another salesperson collaborating" (join), D2/D6.
type ExistingLead struct {
	ID                      string
	RecordStatus            string
	HasActiveScoutedAttempt bool
	ActiveOwnerName         string // interpolated into the active-lead / collab message
	ActiveOwners            []AttemptOwner
	ActorHasActiveAttempt   bool
}

// Outcome is the dedup verdict.
type Outcome int

const (
	OutcomeCreate Outcome = iota // no match — mint a fresh LEAD
	OutcomeBlock                 // rejected; nothing changes
	OutcomeReopen                // matched a terminal record — reopen it to [Pool]
	OutcomeJoin                  // single-reg collaborative — attach a parallel attempt (D3)
)

// Decision is the result of the dedup table.
type Decision struct {
	Outcome      Outcome
	Message      string // BI message when blocked ("" otherwise)
	ReopenLeadID string // set when OutcomeReopen
	JoinLeadID   string // set when OutcomeJoin (D3)
}

// Decide runs the registration-door decision table (M1 §5 Rule 4). The two
// channels diverge by design (D1/D2): import stays a hard dedup, single-reg is
// collaborative.
func Decide(channel Channel, match *ExistingLead) Decision {
	if match == nil {
		return Decision{Outcome: OutcomeCreate}
	}
	if channel == ChannelSingleReg {
		return decideSingleReg(match)
	}
	return decideImport(match)
}

// decideImport is the unchanged (v1) hard-dedup door for Marketing import (D2).
// An import row carries no sales attempt, so an actively-worked match is always
// a block — never a join. Behaviour/messages are byte-identical to v1.
func decideImport(match *ExistingLead) Decision {
	if match.HasActiveScoutedAttempt {
		return Decision{Outcome: OutcomeBlock, Message: interpolateOwner(MsgActiveOtherSalesImport, match.ActiveOwnerName)}
	}
	switch match.RecordStatus {
	case StatusClosedWin:
		return Decision{Outcome: OutcomeBlock, Message: MsgAlreadyClient}
	case StatusPool:
		return Decision{Outcome: OutcomeBlock, Message: MsgDuplicatePool}
	case StatusRejected, StatusNotQualified:
		return Decision{Outcome: OutcomeReopen, ReopenLeadID: match.ID}
	default:
		// Any other active (non-scouted-flagged) record is treated as in-process.
		return Decision{Outcome: OutcomeBlock, Message: interpolateOwner(MsgActiveOtherSalesImport, match.ActiveOwnerName)}
	}
}

// decideSingleReg is the v2 collaborative door for Sales single registration (D2).
// A won lead is a client (block); the same salesperson may not double-register a
// lead they already actively hold (block, new string); any other match is a JOIN
// — the actor attaches a parallel attempt without a new lead record and without
// transitioning record_status — except a fully-terminal (rejected/not-qualified)
// record, which reopens as before.
func decideSingleReg(match *ExistingLead) Decision {
	if match.RecordStatus == StatusClosedWin {
		return Decision{Outcome: OutcomeBlock, Message: MsgAlreadyClient}
	}
	if match.ActorHasActiveAttempt {
		return Decision{Outcome: OutcomeBlock, Message: MsgAlreadyOwnAttempt}
	}
	// Another salesperson is actively working it → collaborate, regardless of the
	// record's nominal status (import/pool/active/reopened).
	if match.HasActiveScoutedAttempt {
		return Decision{Outcome: OutcomeJoin, JoinLeadID: match.ID}
	}
	switch match.RecordStatus {
	case StatusRejected, StatusNotQualified:
		return Decision{Outcome: OutcomeReopen, ReopenLeadID: match.ID}
	default:
		// [Pool] or active with no live attempt → attach (pool-claim equivalent);
		// record_status is left untouched (D2, consistent with ClaimFromPool).
		return Decision{Outcome: OutcomeJoin, JoinLeadID: match.ID}
	}
}

// IsTerminalAttempt reports whether an attempt status is terminal (does NOT mark
// the lead as actively worked). Exported wrapper over the unexported set so
// consumers outside the package (importer, O19) share one source of truth.
func IsTerminalAttempt(status string) bool {
	return terminalAttemptStatuses[status]
}

// interpolateOwner replaces the literal "(nama)" placeholder with the owning
// salesperson's name when one is known.
func interpolateOwner(msg, owner string) string {
	if owner == "" {
		return msg
	}
	return strings.Replace(msg, "(nama)", "("+owner+")", 1)
}
