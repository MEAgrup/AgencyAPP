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
	MsgActiveOtherSalesImport = "[lead sedang diproses oleh sales lain (nama)]"
	// MsgActiveOtherSalesSingleReg — LEGACY (DECISIONS 2026-07-10 "M1 DEDUP
	// DIREDESAIN"). Sales single registration no longer BLOCKS on another
	// salesperson's active lead; it now JOINs (see MsgAlsoWorkedByOthers). The
	// constant is retained for provenance / old references and is no longer
	// emitted by Decide for the single-registration channel.
	MsgActiveOtherSalesSingleReg = "[tidak bisa ditambahkan, lead sedang diproses oleh sales lain (nama)]"
	MsgDuplicatePool             = "[lead sudah ada & sedang diproses, tidak diimport]"
	MsgAlreadyClient             = "[lead sudah menjadi klien]"
	MsgRowIncomplete             = "[data tidak lengkap, baris tidak diimport]"
	MsgSingleIncomplete          = "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]"
	// MsgAlsoWorkedByOthers — informational (NOT an error) response for the Join
	// outcome: the sales-registered lead is also being worked by other salespeople
	// (collaborative dedup, DECISIONS 2026-07-10). "(nama)" interpolates the other
	// owners' names, comma-separated when there is more than one. New string per
	// the W1-09 precedent (new BI strings are authorized explicitly).
	MsgAlsoWorkedByOthers = "[lead juga sedang dikerjakan sales lain (nama)]"
	// MsgAlreadyPursuing — the registrant already holds an open attempt on this
	// lead (same-salesperson guard, consistent with ClaimFromPool). Surfaced as a
	// 409, never a 500. New string per the W1-09 precedent, logged in DECISIONS
	// 2026-07-16: the PRD leaves this case without a message (the Pool view hides
	// already-claimed leads), but single registration reaches it directly.
	MsgAlreadyPursuing = "[anda sudah memproses lead ini]"
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

// ActiveOwner is one non-terminal (in-process) attempt owner on a matched lead.
// Name falls back to EmployeeID when the owner is not yet synced from HRIS
// (LEFT JOIN, O19) so the owner never disappears from dedup.
type ActiveOwner struct {
	EmployeeID string
	Name       string
}

// ExistingLead is the record a new intake matched on normalized phone.
type ExistingLead struct {
	ID                      string
	RecordStatus            string
	HasActiveScoutedAttempt bool
	ActiveOwnerName         string        // representative owner for the import block message
	ActiveOwners            []ActiveOwner // every in-process owner (for Join notify/message)
}

// Outcome is the dedup verdict.
type Outcome int

const (
	OutcomeCreate Outcome = iota // no match — mint a fresh LEAD
	OutcomeBlock                 // rejected; nothing changes
	OutcomeReopen                // matched a terminal record — reopen it to [Pool]
	OutcomeJoin                  // attach a new attempt to the existing lead (collaborative)
)

// Decision is the result of the dedup table.
type Decision struct {
	Outcome      Outcome
	Message      string // BI message when blocked ("" otherwise)
	ReopenLeadID string // set when OutcomeReopen
	JoinLeadID   string // set when OutcomeJoin — the existing lead to attach to
}

// Decide runs the registration-door decision table (M1 §5 Rule 4).
//
// The two channels diverge (DECISIONS 2026-07-10 "M1 DEDUP DIREDESAIN"):
//   - ChannelImport (Marketing) keeps the exclusive/block behavior unchanged.
//   - ChannelSingleReg (Sales) is COLLABORATIVE: registering a phone another
//     salesperson is already working no longer blocks — it JOINs, attaching a
//     new attempt to the existing lead and (later) notifying the other owners.
func Decide(channel Channel, match *ExistingLead) Decision {
	if match == nil {
		return Decision{Outcome: OutcomeCreate}
	}
	if channel == ChannelSingleReg {
		return decideSingleReg(match)
	}
	return decideImport(match)
}

// decideImport is the Marketing-import decision table (unchanged block behavior).
// Kept byte-for-byte equivalent to the pre-2026-07-10 table so import intake
// (and its byte-identical importer mirror, DECISIONS O19) is not altered.
func decideImport(match *ExistingLead) Decision {
	// An active attempt owned by another salesperson blocks, regardless of the
	// record's nominal status.
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

// decideSingleReg is the collaborative Sales single-registration decision table
// (DECISIONS 2026-07-10). The only remaining BLOCK is a lead already won
// (Closed-Success). Terminal records reopen; everything else — an active attempt
// by another salesperson, an existing [Pool] lead, or any other in-process
// record — JOINs, attaching this registrant's attempt to the one Lead record.
// The same-salesperson guard (a registrant who already has an open attempt) is
// enforced in persistence (ErrAlreadyPursuing, consistent with ClaimFromPool),
// not here, because Decide does not know the registrant's identity.
func decideSingleReg(match *ExistingLead) Decision {
	// Already a client: never re-pursued (M1 §5, M1-OA-4).
	if match.RecordStatus == StatusClosedWin {
		return Decision{Outcome: OutcomeBlock, Message: MsgAlreadyClient}
	}
	// Another salesperson is actively working it → collaborate (join).
	if match.HasActiveScoutedAttempt {
		return Decision{Outcome: OutcomeJoin, JoinLeadID: match.ID}
	}
	switch match.RecordStatus {
	case StatusRejected, StatusNotQualified:
		return Decision{Outcome: OutcomeReopen, ReopenLeadID: match.ID}
	case StatusPool:
		// [Pool] lead with no active attempt: a sales registration of it is
		// effectively a self-claim (M1 §6 rule 1) — attach an attempt to the
		// existing record rather than minting a duplicate. Consistent with
		// ClaimFromPool (which likewise spawns an attempt on an existing lead).
		return Decision{Outcome: OutcomeJoin, JoinLeadID: match.ID}
	default:
		// Any other in-process record (active, attempts all terminal but record
		// not reopened) → collaborative join onto the existing lead.
		return Decision{Outcome: OutcomeJoin, JoinLeadID: match.ID}
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
