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
		name     string
		channel  Channel
		match    *ExistingLead
		want     Outcome
		wantMsg  string
		wantLead string // ReopenLeadID (reopen) or JoinLeadID (join)
	}{
		// ---- ChannelImport (v1, UNCHANGED — D2 top table) ----
		{
			name:    "import: no match — create",
			channel: ChannelImport,
			match:   nil,
			want:    OutcomeCreate,
		},
		{
			name:    "import: active attempt (any owner) — block",
			channel: ChannelImport,
			match:   &ExistingLead{ID: "LEAD-1", RecordStatus: StatusActive, HasActiveScoutedAttempt: true, ActiveOwnerName: "Andi"},
			want:    OutcomeBlock,
			wantMsg: "[lead sedang diproses oleh sales lain (Andi)]",
		},
		{
			name:    "import: active attempt without known owner keeps (nama) placeholder",
			channel: ChannelImport,
			match:   &ExistingLead{ID: "LEAD-1", RecordStatus: StatusActive, HasActiveScoutedAttempt: true},
			want:    OutcomeBlock,
			wantMsg: MsgActiveOtherSalesImport,
		},
		{
			name:    "import: closed-success — block (already client)",
			channel: ChannelImport,
			match:   &ExistingLead{ID: "LEAD-3", RecordStatus: StatusClosedWin},
			want:    OutcomeBlock,
			wantMsg: MsgAlreadyClient,
		},
		{
			name:    "import: pool — block duplicate",
			channel: ChannelImport,
			match:   &ExistingLead{ID: "LEAD-2", RecordStatus: StatusPool},
			want:    OutcomeBlock,
			wantMsg: MsgDuplicatePool,
		},
		{
			name:    "import: rejected — reopen",
			channel: ChannelImport,
			match:   &ExistingLead{ID: "LEAD-4", RecordStatus: StatusRejected},
			want:    OutcomeReopen, wantLead: "LEAD-4",
		},
		{
			name:    "import: not-qualified — reopen",
			channel: ChannelImport,
			match:   &ExistingLead{ID: "LEAD-5", RecordStatus: StatusNotQualified},
			want:    OutcomeReopen, wantLead: "LEAD-5",
		},
		{
			name:    "import: active without attempt — block (active other-sales default)",
			channel: ChannelImport,
			match:   &ExistingLead{ID: "LEAD-6", RecordStatus: StatusActive},
			want:    OutcomeBlock,
			wantMsg: MsgActiveOtherSalesImport,
		},

		// ---- ChannelSingleReg (v2 COLLABORATIVE — D2 bottom table) ----
		{
			name:    "single-reg: no match — create",
			channel: ChannelSingleReg,
			match:   nil,
			want:    OutcomeCreate,
		},
		{
			name:    "single-reg: actor already holds a live attempt — block (new string)",
			channel: ChannelSingleReg,
			match:   &ExistingLead{ID: "LEAD-A", RecordStatus: StatusActive, HasActiveScoutedAttempt: true, ActorHasActiveAttempt: true, ActiveOwnerName: "Budi"},
			want:    OutcomeBlock,
			wantMsg: MsgAlreadyOwnAttempt,
		},
		{
			name:    "single-reg: another sales holds a live attempt — join",
			channel: ChannelSingleReg,
			match:   &ExistingLead{ID: "LEAD-B", RecordStatus: StatusActive, HasActiveScoutedAttempt: true, ActiveOwnerName: "Andi"},
			want:    OutcomeJoin, wantLead: "LEAD-B",
		},
		{
			name:    "single-reg: another sales holds a live attempt on a rejected record — join (not reopen)",
			channel: ChannelSingleReg,
			match:   &ExistingLead{ID: "LEAD-B2", RecordStatus: StatusRejected, HasActiveScoutedAttempt: true, ActiveOwnerName: "Andi"},
			want:    OutcomeJoin, wantLead: "LEAD-B2",
		},
		{
			name:    "single-reg: closed-success — block (already client)",
			channel: ChannelSingleReg,
			match:   &ExistingLead{ID: "LEAD-C", RecordStatus: StatusClosedWin},
			want:    OutcomeBlock,
			wantMsg: MsgAlreadyClient,
		},
		{
			name:    "single-reg: pool without live attempt — join (pool-claim equivalent)",
			channel: ChannelSingleReg,
			match:   &ExistingLead{ID: "LEAD-D", RecordStatus: StatusPool},
			want:    OutcomeJoin, wantLead: "LEAD-D",
		},
		{
			name:    "single-reg: active without live attempt — join",
			channel: ChannelSingleReg,
			match:   &ExistingLead{ID: "LEAD-E", RecordStatus: StatusActive},
			want:    OutcomeJoin, wantLead: "LEAD-E",
		},
		{
			name:    "single-reg: rejected, all attempts terminal — reopen",
			channel: ChannelSingleReg,
			match:   &ExistingLead{ID: "LEAD-F", RecordStatus: StatusRejected},
			want:    OutcomeReopen, wantLead: "LEAD-F",
		},
		{
			name:    "single-reg: not-qualified, all attempts terminal — reopen",
			channel: ChannelSingleReg,
			match:   &ExistingLead{ID: "LEAD-G", RecordStatus: StatusNotQualified},
			want:    OutcomeReopen, wantLead: "LEAD-G",
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
			if c.want == OutcomeReopen && d.ReopenLeadID != c.wantLead {
				t.Errorf("ReopenLeadID = %q, want %q", d.ReopenLeadID, c.wantLead)
			}
			if c.want == OutcomeJoin && d.JoinLeadID != c.wantLead {
				t.Errorf("JoinLeadID = %q, want %q", d.JoinLeadID, c.wantLead)
			}
			if c.want != OutcomeBlock && d.Message != "" {
				t.Errorf("non-block decision carried message %q", d.Message)
			}
		})
	}
}
