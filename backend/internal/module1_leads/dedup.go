// Dedup / registration-door decision table (M1 §5, W1-01). This is the pure
// decision function — given the existing record a new intake collides with (if
// any), the intake channel, and the acting salesperson, it returns exactly what
// should happen and the verbatim Bahasa Indonesia message. Persistence applies
// the decision; every decision (incl. blocked/joined) is audit-logged by the
// caller (M1 §5 Rule 6).
//
// M1 v2 — the SALES single-registration door is now COLLABORATIVE (DECISIONS
// 2026-07-10 "M1 DEDUP DIREDESAIN", product owner Nerissa; implementation
// 2026-07-16 "M1 v2 dedup kolaboratif diimplementasikan"). A salesperson
// registering a phone already worked by ANOTHER salesperson is NO LONGER
// rejected: the system records EVERY salesperson pursuing the lead (an extra
// prospect_attempt on the same LEAD) and notifies the other owners "[lead juga
// sedang dikerjakan sales lain]" — the registrant learns via the inline API
// response, not a block. The MARKETING import door is UNCHANGED — it still
// blocks duplicates byte-identically (M1-OA-6 / M1 §3 rule 5).
//
// Dedup checks against ALL historical records, no time window (M1-OA-4), keyed
// on NormalizePhone.
package module1_leads

import "strings"

// Verbatim BI messages (M1 §3/§4/§5, quoted per originating section).
const (
	MsgActiveOtherSalesImport = "[lead sedang diproses oleh sales lain (nama)]"
	MsgDuplicatePool          = "[lead sudah ada & sedang diproses, tidak diimport]"
	MsgAlreadyClient          = "[lead sudah menjadi klien]"
	MsgRowIncomplete          = "[data tidak lengkap, baris tidak diimport]"
	MsgSingleIncomplete       = "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]"

	// M1 v2 collaborative-door strings (DECISIONS 2026-07-16; exact wording
	// pending product confirmation — Open O26. Change only via a decision-log
	// entry). MsgCollabJoin is the inline response the
	// registrant sees when joining a lead already worked by others;
	// MsgAlreadyOwnAttempt blocks a salesperson re-registering their own lead.
	MsgCollabJoin        = "[lead juga sedang dikerjakan sales lain]"
	MsgAlreadyOwnAttempt = "[lead sudah ada di daftar prospek Anda]"
)

// NOTE: the old single-reg block string MsgActiveOtherSalesSingleReg
// ("[tidak bisa ditambahkan, lead sedang diproses oleh sales lain (nama)]") was
// REMOVED in M1 v2 — the collaborative door never rejects a lead worked by
// another salesperson, so the string no longer fires. See DECISIONS 2026-07-16.

// Channel is the intake door (import still blocks; single-reg now collaborates).
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

// OpenAttempt is one salesperson actively (non-terminal) pursuing a matched lead.
type OpenAttempt struct {
	OwnerID   string // owner employee id
	OwnerName string // display name (fallback = employee id when not HRIS-synced)
}

// ExistingLead is the record a new intake matched on normalized phone, together
// with every open (non-terminal) attempt currently on it.
type ExistingLead struct {
	ID           string
	RecordStatus string
	OpenAttempts []OpenAttempt
}

// Outcome is the dedup verdict.
type Outcome int

const (
	OutcomeCreate Outcome = iota // no match — mint a fresh LEAD
	OutcomeBlock                 // rejected; nothing changes
	OutcomeReopen                // matched a terminal record — reopen it to [Pool]
	OutcomeJoin                  // M1 v2 — attach a collaborative attempt to the match
)

// Decision is the result of the dedup table.
type Decision struct {
	Outcome      Outcome
	Message      string        // BI message when blocked, or the inline join notice ("" otherwise)
	ReopenLeadID string        // set when OutcomeReopen
	JoinLeadID   string        // set when OutcomeJoin — the lead to attach onto
	OtherOwners  []OpenAttempt // other salespeople already pursuing the lead (OutcomeJoin)
}

// Decide runs the registration-door decision table (M1 §5 Rule 4; M1 v2).
func Decide(channel Channel, match *ExistingLead, actorEmployeeID string) Decision {
	if match == nil {
		return Decision{Outcome: OutcomeCreate}
	}
	if channel == ChannelImport {
		return decideImport(match)
	}
	return decideSingleReg(match, actorEmployeeID)
}

// decideImport is the UNCHANGED Marketing-import door (byte-identical to M1 v1).
func decideImport(match *ExistingLead) Decision {
	// Any open attempt owned by a salesperson blocks, regardless of nominal
	// status; interpolate the FIRST open attempt's owner name.
	if len(match.OpenAttempts) > 0 {
		return Decision{
			Outcome: OutcomeBlock,
			Message: interpolateOwner(MsgActiveOtherSalesImport, match.OpenAttempts[0].OwnerName),
		}
	}
	switch match.RecordStatus {
	case StatusClosedWin:
		return Decision{Outcome: OutcomeBlock, Message: MsgAlreadyClient}
	case StatusPool:
		return Decision{Outcome: OutcomeBlock, Message: MsgDuplicatePool}
	case StatusRejected, StatusNotQualified:
		return Decision{Outcome: OutcomeReopen, ReopenLeadID: match.ID}
	default:
		// Any other active record with no open attempt: in-process, no owner
		// known — "(nama)" stays literal, same as M1 v1.
		return Decision{Outcome: OutcomeBlock, Message: MsgActiveOtherSalesImport}
	}
}

// decideSingleReg is the M1 v2 COLLABORATIVE Sales single-registration door.
func decideSingleReg(match *ExistingLead, actorEmployeeID string) Decision {
	// (a) Already a client — still a hard block.
	if match.RecordStatus == StatusClosedWin {
		return Decision{Outcome: OutcomeBlock, Message: MsgAlreadyClient}
	}
	// (b) The actor already pursues this lead — block (their own duplicate).
	for _, a := range match.OpenAttempts {
		if a.OwnerID == actorEmployeeID {
			return Decision{Outcome: OutcomeBlock, Message: MsgAlreadyOwnAttempt}
		}
	}
	// (c) Others are working it — JOIN and notify them.
	if len(match.OpenAttempts) > 0 {
		return Decision{
			Outcome:     OutcomeJoin,
			JoinLeadID:  match.ID,
			OtherOwners: match.OpenAttempts,
			Message:     MsgCollabJoin,
		}
	}
	// (d) Terminal record with no open attempt — reopen (unchanged behavior).
	switch match.RecordStatus {
	case StatusRejected, StatusNotQualified:
		return Decision{Outcome: OutcomeReopen, ReopenLeadID: match.ID}
	default:
		// (e) [Pool] / active record with zero open attempts — join silently
		// (equivalent to a Pool claim; no other owner to notify).
		return Decision{Outcome: OutcomeJoin, JoinLeadID: match.ID, OtherOwners: nil, Message: ""}
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
