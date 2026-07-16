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
	const actor = "EMP-ME"
	andi := OpenAttempt{OwnerID: "EMP-ANDI", OwnerName: "Andi"}
	me := OpenAttempt{OwnerID: actor, OwnerName: "Me"}

	cases := []struct {
		name       string
		channel    Channel
		match      *ExistingLead
		want       Outcome
		wantMsg    string
		wantJoinID string
		wantOthers []OpenAttempt
		wantReopen string
	}{
		// ---- ChannelImport: UNCHANGED from M1 v1 ----
		{
			name:    "import — no match — create",
			channel: ChannelImport,
			match:   nil,
			want:    OutcomeCreate,
		},
		{
			name:    "import — active-other-sales block w/ name interpolation",
			channel: ChannelImport,
			match:   &ExistingLead{ID: "LEAD-1", RecordStatus: StatusActive, OpenAttempts: []OpenAttempt{andi}},
			want:    OutcomeBlock,
			wantMsg: "[lead sedang diproses oleh sales lain (Andi)]",
		},
		{
			name:    "import — active lead without known owner keeps (nama) placeholder",
			channel: ChannelImport,
			match:   &ExistingLead{ID: "LEAD-1", RecordStatus: StatusActive},
			want:    OutcomeBlock,
			wantMsg: MsgActiveOtherSalesImport,
		},
		{
			name:    "import — existing pool lead — block duplicate",
			channel: ChannelImport,
			match:   &ExistingLead{ID: "LEAD-2", RecordStatus: StatusPool},
			want:    OutcomeBlock,
			wantMsg: MsgDuplicatePool,
		},
		{
			name:    "import — already a client — block",
			channel: ChannelImport,
			match:   &ExistingLead{ID: "LEAD-3", RecordStatus: StatusClosedWin},
			want:    OutcomeBlock,
			wantMsg: MsgAlreadyClient,
		},
		{
			name:       "import — rejected lead — reopen to pool",
			channel:    ChannelImport,
			match:      &ExistingLead{ID: "LEAD-4", RecordStatus: StatusRejected},
			want:       OutcomeReopen,
			wantReopen: "LEAD-4",
		},

		// ---- ChannelSingleReg: M1 v2 collaborative ----
		{
			name:    "single-reg — no match — create",
			channel: ChannelSingleReg,
			match:   nil,
			want:    OutcomeCreate,
		},
		{
			name:       "single-reg — others working it — JOIN + notice",
			channel:    ChannelSingleReg,
			match:      &ExistingLead{ID: "LEAD-6", RecordStatus: StatusActive, OpenAttempts: []OpenAttempt{andi}},
			want:       OutcomeJoin,
			wantMsg:    MsgCollabJoin,
			wantJoinID: "LEAD-6",
			wantOthers: []OpenAttempt{andi},
		},
		{
			name:    "single-reg — actor already owns an open attempt — block",
			channel: ChannelSingleReg,
			match:   &ExistingLead{ID: "LEAD-7", RecordStatus: StatusActive, OpenAttempts: []OpenAttempt{me, andi}},
			want:    OutcomeBlock,
			wantMsg: MsgAlreadyOwnAttempt,
		},
		{
			name:    "single-reg — already a client — block (takes precedence)",
			channel: ChannelSingleReg,
			match:   &ExistingLead{ID: "LEAD-8", RecordStatus: StatusClosedWin, OpenAttempts: []OpenAttempt{andi}},
			want:    OutcomeBlock,
			wantMsg: MsgAlreadyClient,
		},
		{
			name:       "single-reg — not-qualified lead — reopen to pool",
			channel:    ChannelSingleReg,
			match:      &ExistingLead{ID: "LEAD-9", RecordStatus: StatusNotQualified},
			want:       OutcomeReopen,
			wantReopen: "LEAD-9",
		},
		{
			name:       "single-reg — pool w/ zero open attempts — silent join (no others)",
			channel:    ChannelSingleReg,
			match:      &ExistingLead{ID: "LEAD-10", RecordStatus: StatusPool},
			want:       OutcomeJoin,
			wantJoinID: "LEAD-10",
			wantOthers: nil,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			d := Decide(c.channel, c.match, actor)
			if d.Outcome != c.want {
				t.Fatalf("Outcome = %v, want %v", d.Outcome, c.want)
			}
			if c.wantMsg != "" && d.Message != c.wantMsg {
				t.Errorf("Message = %q, want %q", d.Message, c.wantMsg)
			}
			if c.want == OutcomeReopen && d.ReopenLeadID != c.wantReopen {
				t.Errorf("ReopenLeadID = %q, want %q", d.ReopenLeadID, c.wantReopen)
			}
			if c.want == OutcomeJoin {
				if d.JoinLeadID != c.wantJoinID {
					t.Errorf("JoinLeadID = %q, want %q", d.JoinLeadID, c.wantJoinID)
				}
				if len(d.OtherOwners) != len(c.wantOthers) {
					t.Fatalf("OtherOwners = %+v, want %+v", d.OtherOwners, c.wantOthers)
				}
				for i := range c.wantOthers {
					if d.OtherOwners[i] != c.wantOthers[i] {
						t.Errorf("OtherOwners[%d] = %+v, want %+v", i, d.OtherOwners[i], c.wantOthers[i])
					}
				}
			}
			if c.want != OutcomeBlock && c.want != OutcomeJoin && d.Message != "" {
				t.Errorf("non-block/non-join decision carried message %q", d.Message)
			}
		})
	}
}
