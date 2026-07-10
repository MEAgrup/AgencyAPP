package module5_finance

// W1-18 tests: [Bermasalah] flag + joint SPV resolution (M5 §5 Rule 5 /
// M5-OA-5). DB-backed, following the fixture pattern in finance_db_test.go.

import (
	"context"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

var (
	accountLead = permission.Actor{EmployeeID: "EMP-ALEAD", Role: permission.Role{Division: AccountDivision, Level: permission.LevelLead}}
)

func bermasalahFlag(t *testing.T, s *Service, trxID string) bool {
	t.Helper()
	var b int
	if err := s.DB.QueryRowContext(context.Background(),
		`SELECT bermasalah FROM transactions WHERE id = ?`, trxID).Scan(&b); err != nil {
		t.Fatal(err)
	}
	return b != 0
}

// releaseTrx stamps released_to_account_at so Account's SPV vote is visible to
// them (M5 §5 Rule 2, trxVisibility) — the joint-approval fixtures below give
// SPV Account an actual seat to vote from, matching the same visibility gate
// Flag/Vote now enforce (FIX3).
func releaseTrx(t *testing.T, s *Service, trxID string) {
	t.Helper()
	if _, err := s.DB.ExecContext(context.Background(),
		`UPDATE transactions SET released_to_account_at = NOW() WHERE id = ?`, trxID); err != nil {
		t.Fatal(err)
	}
}

func TestFlagBermasalah_HappyPathAndAuthority(t *testing.T) {
	s := newSvc(t)
	seedClient(t, s, "CLI-BM", "EMP-BUDI")
	seedTrx(t, s, "TRX-BM", "CLI-BM", SchemeLunas, "20000000.00", "")

	// Reason mandatory.
	if err := s.FlagBermasalah(context.Background(), financeStaff, "TRX-BM", ""); err != ErrIncomplete {
		t.Fatalf("no-reason err = %v, want ErrIncomplete", err)
	}
	// Sales cannot flag.
	if err := s.FlagBermasalah(context.Background(), salesOwner, "TRX-BM", "klien komplain"); err != ErrForbidden {
		t.Fatalf("sales flag err = %v, want ErrForbidden", err)
	}
	// Account cannot flag either (M5 §5 Rule 5 — Finance's call).
	if err := s.FlagBermasalah(context.Background(), accountStaff, "TRX-BM", "klien komplain"); err != ErrForbidden {
		t.Fatalf("account flag err = %v, want ErrForbidden", err)
	}

	// Finance staff succeeds.
	if err := s.FlagBermasalah(context.Background(), financeStaff, "TRX-BM", "pembayaran direversal bank"); err != nil {
		t.Fatalf("finance flag: %v", err)
	}
	if !bermasalahFlag(t, s, "TRX-BM") {
		t.Fatal("bermasalah should be 1 after flag")
	}
	if got := countAudit(t, s, "transaction", "TRX-BM", "bermasalah:flagged"); got != 1 {
		t.Errorf("bermasalah:flagged audit rows = %d, want 1", got)
	}

	// Flagging never touches released_to_account_at (M5 §5 Rule 5 — Account's
	// work is not pulled back).
	var released *string
	if err := s.DB.QueryRowContext(context.Background(),
		`SELECT released_to_account_at FROM transactions WHERE id = 'TRX-BM'`).Scan(&released); err != nil {
		t.Fatal(err)
	}
	if released != nil {
		t.Errorf("released_to_account_at should remain untouched, got %v", *released)
	}
}

func TestFlagBermasalah_NotFoundAndAlreadyFlagged(t *testing.T) {
	s := newSvc(t)
	seedClient(t, s, "CLI-BM2", "EMP-BUDI")
	seedTrx(t, s, "TRX-BM2", "CLI-BM2", SchemeLunas, "20000000.00", "")

	if err := s.FlagBermasalah(context.Background(), financeStaff, "TRX-NOPE", "reason"); err != ErrNotFound {
		t.Fatalf("missing trx err = %v, want ErrNotFound", err)
	}
	if err := s.FlagBermasalah(context.Background(), financeStaff, "TRX-BM2", "reason 1"); err != nil {
		t.Fatalf("first flag: %v", err)
	}
	if err := s.FlagBermasalah(context.Background(), financeStaff, "TRX-BM2", "reason 2"); err != ErrAlreadyBermasalah {
		t.Fatalf("double flag err = %v, want ErrAlreadyBermasalah", err)
	}
}

func TestVoteBermasalah_NotBermasalahGuard(t *testing.T) {
	s := newSvc(t)
	seedClient(t, s, "CLI-NB", "EMP-BUDI")
	seedTrx(t, s, "TRX-NB", "CLI-NB", SchemeLunas, "20000000.00", "")

	if err := s.VoteBermasalah(context.Background(), financeLead, "TRX-NB", DecisionSetuju, ""); err != ErrNotBermasalah {
		t.Fatalf("vote on non-flagged trx err = %v, want ErrNotBermasalah", err)
	}
}

func TestVoteBermasalah_StaffAndODCannotVote(t *testing.T) {
	s := newSvc(t)
	seedClient(t, s, "CLI-NV", "EMP-BUDI")
	seedTrx(t, s, "TRX-NV", "CLI-NV", SchemeLunas, "20000000.00", "")
	// Release so Account's own visibility isn't the reason for denial here —
	// this test asserts NO VOTING SEAT (division/level gate), not invisibility.
	// See TestVoteBermasalah_VisibilityGateBlocksWrite for the visibility gate.
	releaseTrx(t, s, "TRX-NV")
	if err := s.FlagBermasalah(context.Background(), financeStaff, "TRX-NV", "reason"); err != nil {
		t.Fatalf("flag: %v", err)
	}

	for _, actor := range []permission.Actor{financeStaff, accountStaff, odActor, salesLead} {
		if err := s.VoteBermasalah(context.Background(), actor, "TRX-NV", DecisionSetuju, ""); err != ErrForbidden {
			t.Errorf("actor %+v vote err = %v, want ErrForbidden", actor.Role, err)
		}
	}
}

func TestVoteBermasalah_JointApprovalResolves(t *testing.T) {
	s := newSvc(t)
	seedClient(t, s, "CLI-JOINT", "EMP-BUDI")
	seedTrx(t, s, "TRX-JOINT", "CLI-JOINT", SchemeLunas, "20000000.00", "")
	// SPV Account only has a seat here once the transaction is visible to
	// Account (M5 §5 Rule 2) — released, same as the read path requires.
	releaseTrx(t, s, "TRX-JOINT")
	if err := s.FlagBermasalah(context.Background(), financeStaff, "TRX-JOINT", "reversal"); err != nil {
		t.Fatalf("flag: %v", err)
	}

	// Invalid decision word rejected.
	if err := s.VoteBermasalah(context.Background(), financeLead, "TRX-JOINT", "maybe", ""); err != ErrIncomplete {
		t.Fatalf("bad decision err = %v, want ErrIncomplete", err)
	}

	// Only Finance SPV voted "setuju" so far -> still flagged.
	if err := s.VoteBermasalah(context.Background(), financeLead, "TRX-JOINT", DecisionSetuju, "sudah dicek"); err != nil {
		t.Fatalf("finance vote: %v", err)
	}
	if !bermasalahFlag(t, s, "TRX-JOINT") {
		t.Fatal("one SPV alone must not resolve the flag")
	}
	status, err := s.GetBermasalahStatus(context.Background(), financeStaff, "TRX-JOINT")
	if err != nil {
		t.Fatalf("GetBermasalahStatus: %v", err)
	}
	if !status.Flagged || status.FinanceVote != DecisionSetuju || status.AccountVote != "" || status.Escalated {
		t.Errorf("status after one vote = %+v", status)
	}

	// Account SPV also votes "setuju" -> resolved.
	if err := s.VoteBermasalah(context.Background(), accountLead, "TRX-JOINT", DecisionSetuju, "confirmed"); err != nil {
		t.Fatalf("account vote: %v", err)
	}
	if bermasalahFlag(t, s, "TRX-JOINT") {
		t.Fatal("both SPVs agreeing should resolve (clear) the flag")
	}
	if got := countAudit(t, s, "transaction", "TRX-JOINT", "bermasalah:resolved"); got != 1 {
		t.Errorf("bermasalah:resolved audit rows = %d, want 1", got)
	}

	// Approvals are append-only (no UPDATE/DELETE path exists in the API).
	var cnt int
	if err := s.DB.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM transaction_issue_approvals WHERE transaction_id = 'TRX-JOINT'`).Scan(&cnt); err != nil {
		t.Fatal(err)
	}
	if cnt != 2 {
		t.Errorf("approval rows = %d, want 2 (one per SPV, append-only)", cnt)
	}
}

func TestVoteBermasalah_DisagreementEscalatesThenDirectorRules(t *testing.T) {
	s := newSvc(t)
	seedClient(t, s, "CLI-ESC", "EMP-BUDI")
	seedTrx(t, s, "TRX-ESC", "CLI-ESC", SchemeLunas, "20000000.00", "")
	releaseTrx(t, s, "TRX-ESC") // SPV Account needs visibility to have a seat.
	if err := s.FlagBermasalah(context.Background(), financeStaff, "TRX-ESC", "reversal"); err != nil {
		t.Fatalf("flag: %v", err)
	}

	if err := s.VoteBermasalah(context.Background(), financeLead, "TRX-ESC", DecisionSetuju, ""); err != nil {
		t.Fatalf("finance vote: %v", err)
	}
	if err := s.VoteBermasalah(context.Background(), accountLead, "TRX-ESC", DecisionTolak, "belum yakin"); err != nil {
		t.Fatalf("account vote: %v", err)
	}
	if !bermasalahFlag(t, s, "TRX-ESC") {
		t.Fatal("disagreement must not resolve the flag")
	}
	status, err := s.GetBermasalahStatus(context.Background(), financeStaff, "TRX-ESC")
	if err != nil {
		t.Fatalf("GetBermasalahStatus: %v", err)
	}
	if !status.Escalated {
		t.Errorf("expected escalated=true after SPV disagreement, got %+v", status)
	}

	// Director rules "setuju" -> resolved immediately, regardless of the SPVs.
	if err := s.VoteBermasalah(context.Background(), director, "TRX-ESC", DecisionSetuju, "final call"); err != nil {
		t.Fatalf("director vote: %v", err)
	}
	if bermasalahFlag(t, s, "TRX-ESC") {
		t.Fatal("director 'setuju' should resolve the flag")
	}
	if got := countAudit(t, s, "transaction", "TRX-ESC", "bermasalah:director_decision"); got != 1 {
		t.Errorf("bermasalah:director_decision audit rows = %d, want 1", got)
	}
	status, err = s.GetBermasalahStatus(context.Background(), financeStaff, "TRX-ESC")
	if err != nil {
		t.Fatalf("GetBermasalahStatus: %v", err)
	}
	if status.Escalated {
		t.Errorf("no longer escalated once Director has ruled: %+v", status)
	}
}

func TestVoteBermasalah_DirectorTolakKeepsFlagged(t *testing.T) {
	s := newSvc(t)
	seedClient(t, s, "CLI-DTOLAK", "EMP-BUDI")
	seedTrx(t, s, "TRX-DTOLAK", "CLI-DTOLAK", SchemeLunas, "20000000.00", "")
	if err := s.FlagBermasalah(context.Background(), financeStaff, "TRX-DTOLAK", "reversal"); err != nil {
		t.Fatalf("flag: %v", err)
	}
	if err := s.VoteBermasalah(context.Background(), director, "TRX-DTOLAK", DecisionTolak, "belum cukup bukti"); err != nil {
		t.Fatalf("director vote: %v", err)
	}
	if !bermasalahFlag(t, s, "TRX-DTOLAK") {
		t.Fatal("director 'tolak' must keep the flag")
	}
}

func TestBermasalah_ReflagAfterResolveStartsNewCycle(t *testing.T) {
	s := newSvc(t)
	seedClient(t, s, "CLI-CYCLE", "EMP-BUDI")
	seedTrx(t, s, "TRX-CYCLE", "CLI-CYCLE", SchemeLunas, "20000000.00", "")
	releaseTrx(t, s, "TRX-CYCLE") // SPV Account needs visibility to have a seat.

	// Cycle 1: flagged, resolved by both SPVs.
	if err := s.FlagBermasalah(context.Background(), financeStaff, "TRX-CYCLE", "reversal 1"); err != nil {
		t.Fatalf("flag 1: %v", err)
	}
	if err := s.VoteBermasalah(context.Background(), financeLead, "TRX-CYCLE", DecisionSetuju, ""); err != nil {
		t.Fatalf("finance vote 1: %v", err)
	}
	if err := s.VoteBermasalah(context.Background(), accountLead, "TRX-CYCLE", DecisionSetuju, ""); err != nil {
		t.Fatalf("account vote 1: %v", err)
	}
	if bermasalahFlag(t, s, "TRX-CYCLE") {
		t.Fatal("cycle 1 should be resolved")
	}

	// Cycle 2: re-flagged; old votes must NOT count toward this cycle.
	if err := s.FlagBermasalah(context.Background(), financeStaff, "TRX-CYCLE", "reversal 2"); err != nil {
		t.Fatalf("flag 2: %v", err)
	}
	status, err := s.GetBermasalahStatus(context.Background(), financeStaff, "TRX-CYCLE")
	if err != nil {
		t.Fatalf("GetBermasalahStatus: %v", err)
	}
	if status.FinanceVote != "" || status.AccountVote != "" {
		t.Errorf("cycle 2 should start with no votes counted, got %+v", status)
	}
	if !status.Flagged {
		t.Error("cycle 2 should be flagged again")
	}
}

func TestGetBermasalahStatus_VisibilityFollowsTransaction(t *testing.T) {
	s := newSvc(t)
	seedClient(t, s, "CLI-GVIS", "EMP-BUDI")
	seedTrx(t, s, "TRX-GVIS", "CLI-GVIS", SchemeBayarSebagian, "20000000.00", "")

	// Pre-release: Account and a non-owning salesperson cannot see it.
	if _, err := s.GetBermasalahStatus(context.Background(), accountStaff, "TRX-GVIS"); err != ErrNotFound {
		t.Errorf("account status err = %v, want ErrNotFound", err)
	}
	if _, err := s.GetBermasalahStatus(context.Background(), salesOther, "TRX-GVIS"); err != ErrNotFound {
		t.Errorf("non-owner sales status err = %v, want ErrNotFound", err)
	}
	// Owner Sales, Finance, Director can see it.
	for _, actor := range []permission.Actor{salesOwner, financeStaff, director} {
		if _, err := s.GetBermasalahStatus(context.Background(), actor, "TRX-GVIS"); err != nil {
			t.Errorf("actor %s status err = %v, want nil", actor.EmployeeID, err)
		}
	}
}

// TestVoteBermasalah_VisibilityGateBlocksWrite (FIX3): an actor whose
// trxVisibility excludes the transaction must be denied BEFORE any write, the
// same as the read path denies them — not merely "no seat" (ErrForbidden),
// but ErrNotFound, and zero approval rows written.
func TestVoteBermasalah_VisibilityGateBlocksWrite(t *testing.T) {
	s := newSvc(t)
	seedClient(t, s, "CLI-VISV", "EMP-BUDI")
	seedTrx(t, s, "TRX-VISV", "CLI-VISV", SchemeLunas, "20000000.00", "") // never released
	if err := s.FlagBermasalah(context.Background(), financeStaff, "TRX-VISV", "reversal"); err != nil {
		t.Fatalf("flag: %v", err)
	}

	// SPV Account has a voting seat (Lead of Account), but the transaction is
	// pre-release and therefore invisible to Account (M5 §5 Rule 2) — same as
	// LoadTransaction/GetBermasalahStatus would report for this actor.
	if err := s.VoteBermasalah(context.Background(), accountLead, "TRX-VISV", DecisionSetuju, ""); err != ErrNotFound {
		t.Fatalf("invisible-actor vote err = %v, want ErrNotFound", err)
	}
	var cnt int
	if err := s.DB.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM transaction_issue_approvals WHERE transaction_id = 'TRX-VISV'`).Scan(&cnt); err != nil {
		t.Fatal(err)
	}
	if cnt != 0 {
		t.Errorf("approval rows = %d, want 0 (invisible actor must not write)", cnt)
	}
	// The flag itself is untouched too.
	if !bermasalahFlag(t, s, "TRX-VISV") {
		t.Error("blocked vote must not clear the flag")
	}
}
