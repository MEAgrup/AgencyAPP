package module1_leads

import (
	"reflect"
	"testing"
)

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

// openBy builds a match with a single open attempt owned by ownerID/ownerName.
func openBy(id, status, ownerID, ownerName string) *ExistingLead {
	return &ExistingLead{ID: id, RecordStatus: status, OpenAttempts: []OpenAttempt{{OwnerEmployeeID: ownerID, OwnerName: ownerName}}}
}

// TestDedupDecisionTable exercises the full v2 decision table for BOTH doors
// (SPEC_M1_DEDUP_V2). "ACT" is the acting salesperson for single registration;
// the import door ignores the actor (any holder blocks).
func TestDedupDecisionTable(t *testing.T) {
	cases := []struct {
		name         string
		channel      Channel
		match        *ExistingLead
		actor        string
		want         Outcome
		wantMsg      string
		wantJoinID   string
		wantCoOwners []string
	}{
		// --- no match ---
		{name: "no match — create (import)", channel: ChannelImport, match: nil, want: OutcomeCreate},
		{name: "no match — create (single-reg)", channel: ChannelSingleReg, match: nil, actor: "ACT", want: OutcomeCreate},

		// --- already a client (both doors block) ---
		{
			name: "closed-win — block client (import)", channel: ChannelImport,
			match: &ExistingLead{ID: "LEAD-3", RecordStatus: StatusClosedWin},
			want:  OutcomeBlock, wantMsg: MsgAlreadyClient,
		},
		{
			name: "closed-win — block client (single-reg)", channel: ChannelSingleReg, actor: "ACT",
			match: &ExistingLead{ID: "LEAD-3", RecordStatus: StatusClosedWin},
			want:  OutcomeBlock, wantMsg: MsgAlreadyClient,
		},

		// --- open attempt owned by the ACTOR ---
		{
			name: "open attempt owned by actor (single-reg) — block own", channel: ChannelSingleReg, actor: "EMP-ANDI",
			match: openBy("LEAD-1", StatusActive, "EMP-ANDI", "Andi"),
			want:  OutcomeBlock, wantMsg: MsgAlreadyOwnAttempt,
		},
		{
			name: "open attempt (owner=actor) via import — block (import ignores actor)", channel: ChannelImport,
			match: openBy("LEAD-1", StatusActive, "EMP-ANDI", "Andi"),
			want:  OutcomeBlock, wantMsg: "[lead sedang diproses oleh sales lain (Andi)]",
		},

		// --- open attempt owned by ANOTHER salesperson ---
		{
			name: "open attempt owned by other (single-reg) — JOIN", channel: ChannelSingleReg, actor: "EMP-BUDI",
			match: openBy("LEAD-1", StatusActive, "EMP-ANDI", "Andi"),
			want:  OutcomeJoin, wantJoinID: "LEAD-1", wantCoOwners: []string{"EMP-ANDI"},
		},
		{
			name: "open attempt owned by other (import) — block", channel: ChannelImport,
			match: openBy("LEAD-1", StatusActive, "EMP-ANDI", "Andi"),
			want:  OutcomeBlock, wantMsg: "[lead sedang diproses oleh sales lain (Andi)]",
		},
		{
			name: "actor holds + another holds (single-reg) — own block wins", channel: ChannelSingleReg, actor: "EMP-BUDI",
			match: &ExistingLead{ID: "LEAD-1", RecordStatus: StatusActive, OpenAttempts: []OpenAttempt{
				{OwnerEmployeeID: "EMP-ANDI", OwnerName: "Andi"},
				{OwnerEmployeeID: "EMP-BUDI", OwnerName: "Budi"},
			}},
			want: OutcomeBlock, wantMsg: MsgAlreadyOwnAttempt,
		},

		// --- Pool without any open attempt ---
		{
			name: "pool, no attempt (import) — block duplicate", channel: ChannelImport,
			match: &ExistingLead{ID: "LEAD-2", RecordStatus: StatusPool},
			want:  OutcomeBlock, wantMsg: MsgDuplicatePool,
		},
		{
			name: "pool, no attempt (single-reg) — block (claim is the official path)", channel: ChannelSingleReg, actor: "ACT",
			match: &ExistingLead{ID: "LEAD-2", RecordStatus: StatusPool},
			want:  OutcomeBlock, wantMsg: MsgDuplicatePool,
		},

		// --- terminal records reopen (both doors) ---
		{
			name: "rejected — reopen (import)", channel: ChannelImport,
			match: &ExistingLead{ID: "LEAD-4", RecordStatus: StatusRejected}, want: OutcomeReopen,
		},
		{
			name: "not-qualified — reopen (single-reg)", channel: ChannelSingleReg, actor: "ACT",
			match: &ExistingLead{ID: "LEAD-5", RecordStatus: StatusNotQualified}, want: OutcomeReopen,
		},

		// --- active/other status with NOBODY holding an open attempt ---
		{
			name: "active, no attempt (single-reg) — JOIN (no co-owner)", channel: ChannelSingleReg, actor: "ACT",
			match: &ExistingLead{ID: "LEAD-6", RecordStatus: StatusActive},
			want:  OutcomeJoin, wantJoinID: "LEAD-6", wantCoOwners: nil,
		},
		{
			name: "active, no attempt (import) — block", channel: ChannelImport,
			match: &ExistingLead{ID: "LEAD-6", RecordStatus: StatusActive},
			want:  OutcomeBlock, wantMsg: MsgActiveOtherSalesImport,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			d := Decide(c.channel, c.match, c.actor)
			if d.Outcome != c.want {
				t.Fatalf("Outcome = %v, want %v", d.Outcome, c.want)
			}
			if c.wantMsg != "" && d.Message != c.wantMsg {
				t.Errorf("Message = %q, want %q", d.Message, c.wantMsg)
			}
			if c.want != OutcomeBlock && d.Message != "" {
				t.Errorf("non-block decision carried message %q", d.Message)
			}
			if c.want == OutcomeReopen && d.ReopenLeadID != c.match.ID {
				t.Errorf("ReopenLeadID = %q, want %q", d.ReopenLeadID, c.match.ID)
			}
			if c.want == OutcomeJoin {
				if d.JoinLeadID != c.wantJoinID {
					t.Errorf("JoinLeadID = %q, want %q", d.JoinLeadID, c.wantJoinID)
				}
				if !reflect.DeepEqual(d.CoOwners, c.wantCoOwners) {
					t.Errorf("CoOwners = %v, want %v", d.CoOwners, c.wantCoOwners)
				}
			}
		})
	}
}
