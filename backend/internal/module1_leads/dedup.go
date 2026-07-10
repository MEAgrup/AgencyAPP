package leads

// Door identifies which intake door an intake arrived through. It selects the
// exact byte-exact BI block message the user sees, because the PRD specifies
// DIFFERENT wording per door for the same underlying collision (§4/M0 §3 vs
// §3 import vs the §5 engine default). See messages.go.
type Door string

const (
	// DoorSalesRegistration — Sales single registration (§4 / M0 §3).
	DoorSalesRegistration Door = "sales_registration"
	// DoorMarketingImport — Marketing single or bulk import (§3). Single is a
	// one-row import, so it shares this door's messages.
	DoorMarketingImport Door = "marketing_import"
	// DoorDedupEngine — the raw §5 deduplication-engine context (no door
	// wrapping). Yields the canonical §5 message.
	DoorDedupEngine Door = "dedup_engine"
)

// Outcome is one row of the §5 rule-4 decision table (plus the no-match
// create case). These are the ONLY outcomes the dedup engine produces; the AC
// for W1-01 is that the table-driven tests reproduce this mapping exactly.
type Outcome string

const (
	// OutcomeCreate — no existing record for this normalized phone: create a
	// new LEAD.
	OutcomeCreate Outcome = "create"
	// OutcomeBlockScouted — existing record has an active scouted attempt
	// (New Lead … Negotiation): BLOCK. §5 row 1.
	OutcomeBlockScouted Outcome = "block_scouted"
	// OutcomeBlockPool — existing record is [Pool]: BLOCK as a duplicate
	// record, point to the existing LEAD, never create a second record; write
	// Last-Touch Campaign if the intake campaign differs. §5 row 2.
	OutcomeBlockPool Outcome = "block_pool"
	// OutcomeReopen — existing record is [Rejected]/[Not Qualified] (all
	// attempts terminal): ALLOW re-entry, reopen the existing record to [Pool].
	// §5 row 3.
	OutcomeReopen Outcome = "reopen"
	// OutcomeBlockClient — existing record already became a client
	// ([Closed - Success]): BLOCK. §5 row 4 / M1-OA-4.
	OutcomeBlockClient Outcome = "block_client"
)

// RecordSnapshot is the minimal existing-record state the dedup decision needs.
// A nil snapshot means "no existing record for this normalized phone".
type RecordSnapshot struct {
	LeadID           string
	RecordStatus     RecordStatus
	OriginCampaign   string
	ScoutedOwnerName string // resolved employee name, for the scouted block message
}

// Decision is the dedup engine's verdict for one intake.
type Decision struct {
	Outcome Outcome
	// ExistingLeadID is set for every non-create outcome (the record the intake
	// matched). Callers point to it instead of creating a duplicate.
	ExistingLeadID string
	// Message is the byte-exact BI block message for block outcomes, already
	// door-specialised. Empty for create/reopen and for the pool block (the
	// PRD specifies no user string for the pool duplicate — the caller points
	// to ExistingLeadID; import supplies its own per-row reason).
	Message string
	// WriteLastTouch is true only for OutcomeBlockPool when the intake campaign
	// differs from the record's Origin Campaign (§5 Last-Touch tracking).
	WriteLastTouch bool
}

// Decide is the deduplication engine (§5). It is a PURE transcription of the
// §5 rule-4 decision table and carries no I/O, so it can be unit-tested
// table-driven exactly against the PRD (AC W1-01). The caller looks up the
// existing record by normalized phone, resolves the scouted owner's name, and
// passes both here.
//
//	existing        — matched record, or nil for no match
//	door            — selects the block-message wording
//	intakeCampaign  — this intake's campaign ("" if none), for Last-Touch
func Decide(existing *RecordSnapshot, door Door, intakeCampaign string) Decision {
	if existing == nil {
		return Decision{Outcome: OutcomeCreate}
	}

	switch existing.RecordStatus {
	case StatusScoutedActive:
		// Row 1: active scouted attempt owned by another salesperson → block.
		return Decision{
			Outcome:        OutcomeBlockScouted,
			ExistingLeadID: existing.LeadID,
			Message:        scoutedBlockMessage(door, existing.ScoutedOwnerName),
		}
	case StatusPool:
		// Row 2: already in DB as [Pool] → block as duplicate record; write
		// Last-Touch if the intake campaign differs from Origin Campaign.
		return Decision{
			Outcome:        OutcomeBlockPool,
			ExistingLeadID: existing.LeadID,
			WriteLastTouch: intakeCampaign != "" && intakeCampaign != existing.OriginCampaign,
		}
	case StatusRejected, StatusNotQualified:
		// Row 3: all attempts terminal (rejected) → allow re-entry, reopen.
		return Decision{
			Outcome:        OutcomeReopen,
			ExistingLeadID: existing.LeadID,
		}
	case StatusClient:
		// Row 4: already a client → block.
		return Decision{
			Outcome:        OutcomeBlockClient,
			ExistingLeadID: existing.LeadID,
			Message:        MsgLeadSudahKlien,
		}
	default:
		// Unknown record status is treated as a hard block (never silently
		// create a second record for a matched phone). Should not occur.
		return Decision{
			Outcome:        OutcomeBlockPool,
			ExistingLeadID: existing.LeadID,
		}
	}
}

// scoutedBlockMessage returns the door-appropriate byte-exact block message for
// an active-scouted collision.
func scoutedBlockMessage(door Door, ownerName string) string {
	switch door {
	case DoorSalesRegistration:
		return msgScoutedRegistrationDoor(ownerName) // M0 §3 variant
	case DoorMarketingImport:
		return MsgLeadSudahAdaDiproses // §3 import row rejection
	default:
		return msgScoutedDedup(ownerName) // §5 engine canonical
	}
}
