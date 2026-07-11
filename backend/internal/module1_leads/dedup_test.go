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

func TestDedupDecisionTable(t *testing.T) {
	cases := []struct {
		name    string
		channel Channel
		match   *ExistingLead
		want    Outcome
		wantMsg string
	}{
		{
			name:    "no match — create (import)",
			channel: ChannelImport,
			match:   nil,
			want:    OutcomeCreate,
		},
		{
			name:    "active scouted lead, import channel — block",
			channel: ChannelImport,
			match:   &ExistingLead{ID: "LEAD-1", RecordStatus: StatusActive, HasActiveScoutedAttempt: true, ActiveOwnerName: "Andi"},
			want:    OutcomeBlock,
			wantMsg: "[lead sedang diproses oleh sales lain (Andi)]",
		},
		{
			name:    "active scouted lead, single-reg channel — block (different wording)",
			channel: ChannelSingleReg,
			match:   &ExistingLead{ID: "LEAD-1", RecordStatus: StatusActive, HasActiveScoutedAttempt: true, ActiveOwnerName: "Andi"},
			want:    OutcomeBlock,
			wantMsg: "[tidak bisa ditambahkan, lead sedang diproses oleh sales lain (Andi)]",
		},
		{
			name:    "active lead without known owner keeps (nama) placeholder",
			channel: ChannelImport,
			match:   &ExistingLead{ID: "LEAD-1", RecordStatus: StatusActive, HasActiveScoutedAttempt: true},
			want:    OutcomeBlock,
			wantMsg: MsgActiveOtherSalesImport,
		},
		{
			name:    "existing pool lead — block duplicate",
			channel: ChannelImport,
			match:   &ExistingLead{ID: "LEAD-2", RecordStatus: StatusPool},
			want:    OutcomeBlock,
			wantMsg: MsgDuplicatePool,
		},
		{
			name:    "already a client — block",
			channel: ChannelImport,
			match:   &ExistingLead{ID: "LEAD-3", RecordStatus: StatusClosedWin},
			want:    OutcomeBlock,
			wantMsg: MsgAlreadyClient,
		},
		{
			name:    "rejected lead — reopen to pool",
			channel: ChannelImport,
			match:   &ExistingLead{ID: "LEAD-4", RecordStatus: StatusRejected},
			want:    OutcomeReopen,
		},
		{
			name:    "not-qualified lead — reopen to pool",
			channel: ChannelSingleReg,
			match:   &ExistingLead{ID: "LEAD-5", RecordStatus: StatusNotQualified},
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
			if c.want != OutcomeBlock && d.Message != "" {
				t.Errorf("non-block decision carried message %q", d.Message)
			}
		})
	}
}
