// Dedup / registration-door decision table (M1 §5, W1-01). This is the pure
// decision function — given the existing record a new intake collides with (if
// any) and the intake channel, it returns exactly what should happen and the
// verbatim Bahasa Indonesia message. Persistence applies the decision; every
// decision (incl. blocked/rejected) is audit-logged by the caller (M1 §5 Rule 6).
//
// Dedup checks against ALL historical records, no time window (M1-OA-4), keyed
// on NormalizePhone. A second salesperson claiming an already-[Pool] lead is a
// competitive claim (§6), NOT a dedup block — that path never reaches Decide.
package module1_leads

import "strings"

// Verbatim BI messages (M1 §3/§4/§5, quoted per originating section — the two
// active-lead strings differ by channel by design, DECISIONS O11).
const (
	MsgActiveOtherSalesImport    = "[lead sedang diproses oleh sales lain (nama)]"
	MsgActiveOtherSalesSingleReg = "[tidak bisa ditambahkan, lead sedang diproses oleh sales lain (nama)]"
	MsgDuplicatePool             = "[lead sudah ada & sedang diproses, tidak diimport]"
	MsgAlreadyClient             = "[lead sudah menjadi klien]"
	MsgRowIncomplete             = "[data tidak lengkap, baris tidak diimport]"
	MsgSingleIncomplete          = "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]"
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

// ExistingLead is the record a new intake matched on normalized phone.
type ExistingLead struct {
	ID                      string
	RecordStatus            string
	HasActiveScoutedAttempt bool
	ActiveOwnerName         string // interpolated into the active-lead message
}

// Outcome is the dedup verdict.
type Outcome int

const (
	OutcomeCreate Outcome = iota // no match — mint a fresh LEAD
	OutcomeBlock                 // rejected; nothing changes
	OutcomeReopen                // matched a terminal record — reopen it to [Pool]
)

// Decision is the result of the dedup table.
type Decision struct {
	Outcome      Outcome
	Message      string // BI message when blocked ("" otherwise)
	ReopenLeadID string // set when OutcomeReopen
}

// Decide runs the registration-door decision table (M1 §5 Rule 4).
func Decide(channel Channel, match *ExistingLead) Decision {
	if match == nil {
		return Decision{Outcome: OutcomeCreate}
	}
	// An active attempt owned by another salesperson blocks, regardless of the
	// record's nominal status.
	if match.HasActiveScoutedAttempt {
		msg := MsgActiveOtherSalesImport
		if channel == ChannelSingleReg {
			msg = MsgActiveOtherSalesSingleReg
		}
		return Decision{Outcome: OutcomeBlock, Message: interpolateOwner(msg, match.ActiveOwnerName)}
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
		msg := MsgActiveOtherSalesImport
		if channel == ChannelSingleReg {
			msg = MsgActiveOtherSalesSingleReg
		}
		return Decision{Outcome: OutcomeBlock, Message: interpolateOwner(msg, match.ActiveOwnerName)}
	}
}

// interpolateOwner replaces the literal "(nama)" placeholder with the owning
// salesperson's name when one is known.
func interpolateOwner(msg, owner string) string {
	if owner == "" {
		return msg
	}
	return strings.Replace(msg, "(nama)", "("+owner+")", 1)
}
