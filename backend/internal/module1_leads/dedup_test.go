package leads

import "testing"

// TestDecide_DecisionTable is the W1-01 AC: a table-driven transcription of
// the M1 §5 rule-4 dedup decision table, row by row, including the byte-exact
// BI block messages and the door-variant wording (M0 §3 vs M1 §5 — both exist
// in the PRD for different doors).
func TestDecide_DecisionTable(t *testing.T) {
	scouted := &RecordSnapshot{
		LeadID: "LEAD-202607-0001", RecordStatus: StatusScoutedActive,
		ScoutedOwnerName: "Andi",
	}
	pool := &RecordSnapshot{
		LeadID: "LEAD-202607-0002", RecordStatus: StatusPool,
		OriginCampaign: "CMP-202603-0007",
	}
	rejected := &RecordSnapshot{LeadID: "LEAD-202607-0003", RecordStatus: StatusRejected}
	notQualified := &RecordSnapshot{LeadID: "LEAD-202607-0004", RecordStatus: StatusNotQualified}
	client := &RecordSnapshot{LeadID: "LEAD-202607-0005", RecordStatus: StatusClient}

	tests := []struct {
		name           string
		existing       *RecordSnapshot
		door           Door
		intakeCampaign string
		wantOutcome    Outcome
		wantMessage    string
		wantExisting   string
		wantLastTouch  bool
	}{
		// --- no existing record: create ------------------------------------
		{
			name:     "no match creates a new record",
			existing: nil, door: DoorSalesRegistration,
			wantOutcome: OutcomeCreate,
		},

		// --- §5 row 1: active scouted attempt -> block, with real owner name
		{
			name:     "row1 scouted active, dedup engine message (M1 §5)",
			existing: scouted, door: DoorDedupEngine,
			wantOutcome:  OutcomeBlockScouted,
			wantMessage:  "[lead sedang diproses oleh sales lain (Andi)]",
			wantExisting: "LEAD-202607-0001",
		},
		{
			name:     "row1 scouted active, sales registration door message (M0 §3)",
			existing: scouted, door: DoorSalesRegistration,
			wantOutcome:  OutcomeBlockScouted,
			wantMessage:  "[tidak bisa ditambahkan, lead sedang diproses oleh sales lain (Andi)]",
			wantExisting: "LEAD-202607-0001",
		},
		{
			name:     "row1 scouted active, marketing import row message (M1 §3 step 5)",
			existing: scouted, door: DoorMarketingImport,
			wantOutcome:  OutcomeBlockScouted,
			wantMessage:  "[lead sudah ada & sedang diproses, tidak diimport]",
			wantExisting: "LEAD-202607-0001",
		},

		// --- §5 row 2: [Pool] -> block duplicate record, never a second record
		{
			name:     "row2 pool duplicate, same campaign: no last-touch",
			existing: pool, door: DoorMarketingImport, intakeCampaign: "CMP-202603-0007",
			wantOutcome: OutcomeBlockPool, wantExisting: "LEAD-202607-0002",
			wantLastTouch: false,
		},
		{
			name:     "row2 pool duplicate, different campaign: write last-touch",
			existing: pool, door: DoorMarketingImport, intakeCampaign: "CMP-202604-0011",
			wantOutcome: OutcomeBlockPool, wantExisting: "LEAD-202607-0002",
			wantLastTouch: true,
		},
		{
			name:     "row2 pool duplicate, no intake campaign: no last-touch",
			existing: pool, door: DoorSalesRegistration, intakeCampaign: "",
			wantOutcome: OutcomeBlockPool, wantExisting: "LEAD-202607-0002",
			wantLastTouch: false,
		},
		{
			name: "row2 pool duplicate, campaign equals recorded last-touch: no rewrite",
			existing: &RecordSnapshot{
				LeadID: "LEAD-202607-0002", RecordStatus: StatusPool,
				OriginCampaign: "CMP-202603-0007", LastTouchCampaign: "CMP-202604-0011",
			},
			door: DoorMarketingImport, intakeCampaign: "CMP-202604-0011",
			wantOutcome: OutcomeBlockPool, wantExisting: "LEAD-202607-0002",
			wantLastTouch: false,
		},
		{
			name: "row2 pool duplicate, third campaign after a last-touch: write again",
			existing: &RecordSnapshot{
				LeadID: "LEAD-202607-0002", RecordStatus: StatusPool,
				OriginCampaign: "CMP-202603-0007", LastTouchCampaign: "CMP-202604-0011",
			},
			door: DoorMarketingImport, intakeCampaign: "CMP-202605-0002",
			wantOutcome: OutcomeBlockPool, wantExisting: "LEAD-202607-0002",
			wantLastTouch: true,
		},

		// --- §5 row 3: Rejected / Not Qualified -> allow re-entry, reopen ---
		{
			name:     "row3 rejected reopens to pool",
			existing: rejected, door: DoorMarketingImport,
			wantOutcome: OutcomeReopen, wantExisting: "LEAD-202607-0003",
		},
		{
			name:     "row3 not qualified reopens to pool",
			existing: notQualified, door: DoorSalesRegistration,
			wantOutcome: OutcomeReopen, wantExisting: "LEAD-202607-0004",
		},

		// --- §5 row 4: [Closed - Success] -> block, already a client --------
		{
			name:     "row4 closed-success blocks with client message (M1-OA-4)",
			existing: client, door: DoorSalesRegistration,
			wantOutcome:  OutcomeBlockClient,
			wantMessage:  "[lead sudah menjadi klien]",
			wantExisting: "LEAD-202607-0005",
		},
		{
			name:     "row4 closed-success blocks on import too",
			existing: client, door: DoorMarketingImport,
			wantOutcome:  OutcomeBlockClient,
			wantMessage:  "[lead sudah menjadi klien]",
			wantExisting: "LEAD-202607-0005",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := Decide(tc.existing, tc.door, tc.intakeCampaign)
			if got.Outcome != tc.wantOutcome {
				t.Fatalf("outcome = %q, want %q", got.Outcome, tc.wantOutcome)
			}
			if got.Message != tc.wantMessage {
				t.Fatalf("message = %q, want %q (byte-exact)", got.Message, tc.wantMessage)
			}
			if got.ExistingLeadID != tc.wantExisting {
				t.Fatalf("existing lead = %q, want %q", got.ExistingLeadID, tc.wantExisting)
			}
			if got.WriteLastTouch != tc.wantLastTouch {
				t.Fatalf("writeLastTouch = %v, want %v", got.WriteLastTouch, tc.wantLastTouch)
			}
		})
	}
}

// TestDecide_PoolSecondClaimIsNotDedup pins §5 rule 5: a second salesperson
// claiming an existing [Pool] lead is NOT a dedup create — the engine reports
// the existing record (block-as-duplicate-record), and the claim path (§6,
// W1-03) spawns an attempt against that same record instead of a new LEAD.
func TestDecide_PoolSecondClaimIsNotDedup(t *testing.T) {
	pool := &RecordSnapshot{LeadID: "LEAD-202607-0031", RecordStatus: StatusPool}
	got := Decide(pool, DoorDedupEngine, "")
	if got.Outcome == OutcomeCreate {
		t.Fatal("a matched [Pool] record must never produce a second record")
	}
	if got.ExistingLeadID != "LEAD-202607-0031" {
		t.Fatalf("must point at the existing record, got %q", got.ExistingLeadID)
	}
}
