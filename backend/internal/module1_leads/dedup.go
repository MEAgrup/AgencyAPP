// Dedup / registration-door decision table (M1 §5, W1-01). This is the pure
// decision function — given the existing record a new intake collides with (if
// any), the intake channel and the acting salesperson, it returns exactly what
// should happen and (when blocked) the verbatim Bahasa Indonesia message.
// Persistence applies the decision; every decision (incl. blocked/joined) is
// audit-logged by the caller (M1 §5 Rule 6).
//
// Dedup checks against ALL historical records, no time window (M1-OA-4), keyed
// on NormalizePhone.
//
// v2 (kolaboratif, DECISIONS 2026-07-10 "M1 DEDUP DIREDESAIN", arahan Nerissa):
// a Sales single-registration on a phone already held by ANOTHER salesperson is
// no longer blocked — the system records every salesperson pursuing the lead
// (multi-attempt) and notifies "lead juga sedang dikerjakan sales lain". The
// import door is unchanged (duplicates still blocked, M1 §3 flow 5 / M1-OA-6).
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

	// v2 additions.
	// MsgAlreadyOwnAttempt blocks a single-registration when the ACTOR already
	// holds an open attempt on the lead (cannot double-open — M1 dedup v2).
	MsgAlreadyOwnAttempt = "[anda sudah memiliki prospek aktif untuk lead ini]"
	// MsgLeadCoWorked is a NON-error notice returned on OutcomeJoin when other
	// salespeople already pursue the lead (verbatim, no name interpolation).
	MsgLeadCoWorked = "[lead juga sedang dikerjakan sales lain]"
)

// Channel is the intake door (affects the active-lead message wording and, for
// single-registration, whether a co-pursuit joins instead of blocking).
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

// OpenAttempt is one holder of a non-terminal attempt on the matched lead.
type OpenAttempt struct {
	OwnerEmployeeID string
	OwnerName       string // resolved employee name, or the raw id when unsynced (O19)
}

// ExistingLead is the record a new intake matched on normalized phone, together
// with every open (non-terminal) attempt currently on it.
type ExistingLead struct {
	ID           string
	RecordStatus string
	OpenAttempts []OpenAttempt // ALL salespeople holding an open attempt (v2)

	// Deprecated: legacy single-owner dedup fields. Still populated by the
	// un-migrated importer mirror (DECISIONS O19); Decide honours them so the
	// import door keeps its exact pre-v2 behaviour until the importer moves to
	// MatchByPhone. Remove once no caller sets them.
	HasActiveScoutedAttempt bool
	ActiveOwnerName         string
}

// openAttempts returns the effective open-attempt set, falling back to the
// legacy single-owner fields when OpenAttempts is empty (un-migrated importer).
func (m *ExistingLead) openAttempts() []OpenAttempt {
	if len(m.OpenAttempts) > 0 {
		return m.OpenAttempts
	}
	if m.HasActiveScoutedAttempt {
		return []OpenAttempt{{OwnerName: m.ActiveOwnerName}}
	}
	return nil
}

// firstOwnerName is the owner name used to interpolate "(nama)" in the import
// block message.
func (m *ExistingLead) firstOwnerName() string {
	if oa := m.openAttempts(); len(oa) > 0 {
		return oa[0].OwnerName
	}
	return ""
}

// actorHoldsOpenAttempt reports whether actor already holds an open attempt.
func (m *ExistingLead) actorHoldsOpenAttempt(actor string) bool {
	if actor == "" {
		return false
	}
	for _, a := range m.openAttempts() {
		if a.OwnerEmployeeID == actor {
			return true
		}
	}
	return false
}

// otherOwners returns the employee ids of open-attempt holders other than actor
// (the co-pursuit notification recipients).
func (m *ExistingLead) otherOwners(actor string) []string {
	var out []string
	for _, a := range m.openAttempts() {
		if a.OwnerEmployeeID != "" && a.OwnerEmployeeID != actor {
			out = append(out, a.OwnerEmployeeID)
		}
	}
	return out
}

// Outcome is the dedup verdict.
type Outcome int

const (
	OutcomeCreate Outcome = iota // no match — mint a fresh LEAD
	OutcomeBlock                 // rejected; nothing changes
	OutcomeReopen                // matched a terminal record — reopen it to [Pool]
	OutcomeJoin                  // v2: attach an attempt to the existing lead (co-pursuit)
)

// Decision is the result of the dedup table.
type Decision struct {
	Outcome      Outcome
	Message      string   // BI message when blocked ("" otherwise)
	ReopenLeadID string   // set when OutcomeReopen
	JoinLeadID   string   // set when OutcomeJoin
	CoOwners     []string // OutcomeJoin: other open-attempt owners (notification recipients)
}

// Decide runs the registration-door decision table (M1 §5 Rule 4, v2).
//
// actorEmployeeID identifies the registering salesperson; it is variadic so the
// import door — which does not distinguish the actor (any holder blocks) — can
// keep calling Decide(channel, match). Single registration passes the actor so
// it can tell "my own open attempt" (block) from "another sales" (join).
func Decide(channel Channel, match *ExistingLead, actorEmployeeID ...string) Decision {
	if match == nil {
		return Decision{Outcome: OutcomeCreate}
	}
	actor := ""
	if len(actorEmployeeID) > 0 {
		actor = actorEmployeeID[0]
	}

	// A won lead is already a client — blocks on every door.
	if match.RecordStatus == StatusClosedWin {
		return Decision{Outcome: OutcomeBlock, Message: MsgAlreadyClient}
	}

	// Someone is actively working this lead.
	if len(match.openAttempts()) > 0 {
		if channel == ChannelSingleReg {
			// The actor may not open a second attempt on a lead they hold.
			if match.actorHoldsOpenAttempt(actor) {
				return Decision{Outcome: OutcomeBlock, Message: MsgAlreadyOwnAttempt}
			}
			// Held only by other salespeople — collaborative co-pursuit (v2).
			return Decision{Outcome: OutcomeJoin, JoinLeadID: match.ID, CoOwners: match.otherOwners(actor)}
		}
		// Import never distinguishes the actor: any open attempt blocks (M1-OA-6).
		return Decision{Outcome: OutcomeBlock, Message: interpolateOwner(MsgActiveOtherSalesImport, match.firstOwnerName())}
	}

	// Nobody is holding an open attempt: fall back to the record status.
	switch match.RecordStatus {
	case StatusPool:
		// Pool is not "held by another sales"; the official path is the Pool
		// claim (§6), so a fresh intake is blocked on both doors.
		return Decision{Outcome: OutcomeBlock, Message: MsgDuplicatePool}
	case StatusRejected, StatusNotQualified:
		return Decision{Outcome: OutcomeReopen, ReopenLeadID: match.ID}
	default:
		// An active (or otherwise non-terminal) record with nobody holding it.
		if channel == ChannelSingleReg {
			// No collision — attach an attempt; no co-owner to notify.
			return Decision{Outcome: OutcomeJoin, JoinLeadID: match.ID}
		}
		return Decision{Outcome: OutcomeBlock, Message: interpolateOwner(MsgActiveOtherSalesImport, match.firstOwnerName())}
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
