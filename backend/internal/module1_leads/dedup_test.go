package module1_leads

import "testing"

func TestNormalizePhone(t *testing.T) {
	// All of these Indonesian-number spellings must collapse to one key.
	same := []string{
		"+62 812-3456",
		"0812 3456",
		"812.3456",
		"(0812) 3456",
		"62 812 3456",
		"+628123456",
	}
	want := "8123456"
	for _, in := range same {
		if got := NormalizePhone(in); got != want {
			t.Errorf("NormalizePhone(%q) = %q, want %q", in, got, want)
		}
	}
	if got := NormalizePhone("abc"); got != "" {
		t.Errorf("NormalizePhone(non-digit) = %q, want empty", got)
	}
	// Distinct numbers stay distinct.
	if NormalizePhone("081200000001") == NormalizePhone("081200000002") {
		t.Error("distinct numbers collided")
	}
}

// TestDedupDecisionTable pins the collaborative dedup table (DECISIONS
// 2026-07-10 "M1 DEDUP DIREDESAIN", revised 2026-07-16). Import (Marketing) keeps
// the exclusive/block behavior; Sales single registration JOINs instead of
// blocking when another salesperson is already working the lead.
func TestDedupDecisionTable(t *testing.T) {
	cases := []struct {
		name     string
		channel  Channel
		match    *ExistingLead
		want     Outcome
		wantMsg  string
		wantJoin string // expected JoinLeadID when want == OutcomeJoin
	}{
		{
			name:    "no match — create (import)",
			channel: ChannelImport,
			match:   nil,
			want:    OutcomeCreate,
		},
		{
			name:    "no match — create (single-reg)",
			channel: ChannelSingleReg,
			match:   nil,
			want:    OutcomeCreate,
		},
		// ---- Import channel: block behavior UNCHANGED ----
		{
			name:    "active scouted lead, import channel — block",
			channel: ChannelImport,
			match:   &ExistingLead{ID: "LEAD-1", RecordStatus: StatusActive, HasActiveScoutedAttempt: true, ActiveOwnerName: "Andi"},
			want:    OutcomeBlock,
			wantMsg: "[lead sedang diproses oleh sales lain (Andi)]",
		},
		{
			name:    "active lead without known owner keeps (nama) placeholder (import)",
			channel: ChannelImport,
			match:   &ExistingLead{ID: "LEAD-1", RecordStatus: StatusActive, HasActiveScoutedAttempt: true},
			want:    OutcomeBlock,
			wantMsg: MsgActiveOtherSalesImport,
		},
		{
			name:    "existing pool lead — block duplicate (import)",
			channel: ChannelImport,
			match:   &ExistingLead{ID: "LEAD-2", RecordStatus: StatusPool},
			want:    OutcomeBlock,
			wantMsg: MsgDuplicatePool,
		},
		{
			name:    "already a client — block (import)",
			channel: ChannelImport,
			match:   &ExistingLead{ID: "LEAD-3", RecordStatus: StatusClosedWin},
			want:    OutcomeBlock,
			wantMsg: MsgAlreadyClient,
		},
		{
			name:    "rejected lead — reopen to pool (import)",
			channel: ChannelImport,
			match:   &ExistingLead{ID: "LEAD-4", RecordStatus: StatusRejected},
			want:    OutcomeReopen,
		},
		// ---- Sales single registration: COLLABORATIVE ----
		{
			name:     "active lead owned by other sales — JOIN, not block (single-reg)",
			channel:  ChannelSingleReg,
			match:    &ExistingLead{ID: "LEAD-1", RecordStatus: StatusActive, HasActiveScoutedAttempt: true, ActiveOwnerName: "Andi"},
			want:     OutcomeJoin,
			wantJoin: "LEAD-1",
		},
		{
			name:     "existing pool lead, no active attempt — JOIN (≈ claim, single-reg)",
			channel:  ChannelSingleReg,
			match:    &ExistingLead{ID: "LEAD-2", RecordStatus: StatusPool},
			want:     OutcomeJoin,
			wantJoin: "LEAD-2",
		},
		{
			name:     "in-process active record, no active attempt — JOIN (single-reg)",
			channel:  ChannelSingleReg,
			match:    &ExistingLead{ID: "LEAD-6", RecordStatus: StatusActive},
			want:     OutcomeJoin,
			wantJoin: "LEAD-6",
		},
		{
			name:    "already a client — STILL block (single-reg)",
			channel: ChannelSingleReg,
			match:   &ExistingLead{ID: "LEAD-3", RecordStatus: StatusClosedWin},
			want:    OutcomeBlock,
			wantMsg: MsgAlreadyClient,
		},
		{
			name:    "not-qualified lead — reopen to pool (single-reg)",
			channel: ChannelSingleReg,
			match:   &ExistingLead{ID: "LEAD-5", RecordStatus: StatusNotQualified},
			want:    OutcomeReopen,
		},
		{
			name:    "rejected lead — reopen to pool (single-reg)",
			channel: ChannelSingleReg,
			match:   &ExistingLead{ID: "LEAD-7", RecordStatus: StatusRejected},
			want:    OutcomeReopen,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			d := Decide(c.channel, c.match)
			if d.Outcome != c.want {
				t.Fatalf("Outcome = %v, want %v", d.Outcome, c.want)
			}
			if c.wantMsg != "" && d.Message != c.wantMsg {
				t.Errorf("Message = %q, want %q", d.Message, c.wantMsg)
			}
			if c.want == OutcomeReopen && d.ReopenLeadID != c.match.ID {
				t.Errorf("ReopenLeadID = %q, want %q", d.ReopenLeadID, c.match.ID)
			}
			if c.want == OutcomeJoin && d.JoinLeadID != c.wantJoin {
				t.Errorf("JoinLeadID = %q, want %q", d.JoinLeadID, c.wantJoin)
			}
			// Only a block carries a BI message; Join's informational message is
			// built in persistence from the actual other-owner list.
			if c.want != OutcomeBlock && d.Message != "" {
				t.Errorf("non-block decision carried message %q", d.Message)
			}
		})
	}
}
