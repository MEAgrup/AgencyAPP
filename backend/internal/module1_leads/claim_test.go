package leads

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/events"
	"github.com/meagrup/agencyapp/backend/internal/core/ids"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/core/testdb"
	sales "github.com/meagrup/agencyapp/backend/internal/module0_sales"
)

// W1-03 (M1 §6) is exercised END-TO-END here: real module0_sales.Attempts as
// both AttemptCreator and CompetitionResolver (no fakes), real statemachine
// engine, real audit triggers. The import direction is test-only —
// module0_sales never imports this package.
var _ CompetitionResolver = (*sales.Attempts)(nil)
var _ AttemptCreator = (*sales.Attempts)(nil)

// newCompetitionFixture wires the Module 1 service against the REAL Module 0
// attempt store on one isolated DB.
func newCompetitionFixture(t *testing.T) (*sql.DB, *Service, *sales.Attempts) {
	t.Helper()
	conn := testdb.New(t)
	attempts := sales.NewAttempts(authz.NewMatrixChecker(), audit.NewMySQL(), ids.NewMySQL(), events.NewInMemoryBus())
	svc := NewService(authz.NewMatrixChecker(), audit.NewMySQL(), ids.NewMySQL(), attempts, DefaultNormalizer())
	return conn, svc, attempts
}

func insertPoolLead(t *testing.T, conn *sql.DB, leadID, name, phone string) {
	t.Helper()
	l := Lead{
		LeadID: leadID, LeadName: name, PhoneRaw: phone,
		PhoneNormalized: DefaultNormalizer().Normalize(phone),
		Source:          SourceIklan, OriginDivision: DivisiMarketing,
		OriginCampaign: "CMP-202607-0001", RecordStatus: StatusPool,
	}
	if err := insertLead(context.Background(), conn, l, time.Now().UTC()); err != nil {
		t.Fatalf("insert pool lead %s: %v", leadID, err)
	}
}

// driveToClosedSuccess walks an attempt through the full winning lifecycle:
// New Lead -> Contacted -> Qualified -> Neg Auto Approved -> Closed-Success.
func driveToClosedSuccess(t *testing.T, conn *sql.DB, attempts *sales.Attempts, owner authz.Identity, prospectID string) {
	t.Helper()
	ctx := context.Background()
	if err := attempts.UpdateStatus(ctx, conn, owner, prospectID, sales.UpdateStatusInput{To: statemachine.ProspectContacted, ActionType: "call"}); err != nil {
		t.Fatalf("->Contacted: %v", err)
	}
	if err := attempts.QualifyFromForm(ctx, conn, owner, prospectID); err != nil {
		t.Fatalf("->Qualified: %v", err)
	}
	if err := attempts.UpdateStatus(ctx, conn, owner, prospectID, sales.UpdateStatusInput{To: statemachine.ProspectNegAutoApproved}); err != nil {
		t.Fatalf("->Neg Auto Approved: %v", err)
	}
	if err := attempts.UpdateStatus(ctx, conn, owner, prospectID, sales.UpdateStatusInput{To: statemachine.ProspectClosedSuccess}); err != nil {
		t.Fatalf("->Closed-Success: %v", err)
	}
}

// TestClaimPool_TwoClaimants_WinResolution is the W1-03 acceptance fixture
// (M1 §6 example, Sini Store): two staff claim the same pool lead, one closes,
// win resolution marks the winner and auto-closes the competitor as
// [Closed - Kalah Kompetisi] — all with full immutable audit.
func TestClaimPool_TwoClaimants_WinResolution(t *testing.T) {
	conn, svc, attempts := newCompetitionFixture(t)
	ctx := context.Background()
	insertEmployee(t, conn, "EMP-BUDI", "Budi", "Sales", "Staff")
	insertEmployee(t, conn, "EMP-ANDI", "Andi", "Sales", "Staff")
	const leadID = "LEAD-202607-9001"
	insertPoolLead(t, conn, leadID, "Sini Store", "0812-9000-0001")

	budi, err := svc.ClaimPoolLead(ctx, conn, idSalesBudi, attempts, leadID)
	if err != nil {
		t.Fatalf("Budi claim: %v", err)
	}
	andi, err := svc.ClaimPoolLead(ctx, conn, idSalesAndi, attempts, leadID)
	if err != nil {
		t.Fatalf("Andi claim (simultaneous contest, M1-OA-1): %v", err)
	}
	if budi.ProspectID == andi.ProspectID || !strings.HasPrefix(budi.ProspectID, "PRSP-") || !strings.HasPrefix(andi.ProspectID, "PRSP-") {
		t.Fatalf("claims must yield distinct PRSP attempts, got %q / %q", budi.ProspectID, andi.ProspectID)
	}
	// §6 rule 4: each claim is logged on the Lead record.
	if got := len(auditRows(t, conn, leadID, actionClaim)); got != 2 {
		t.Fatalf("claim audit rows = %d, want 2", got)
	}

	driveToClosedSuccess(t, conn, attempts, idSalesBudi, budi.ProspectID)

	now := time.Now().UTC()
	if err := db.WithTx(ctx, conn, func(tx *sql.Tx) error {
		return svc.ResolveWin(ctx, tx, attempts, leadID, budi.ProspectID, "EMP-BUDI", now)
	}); err != nil {
		t.Fatalf("ResolveWin: %v", err)
	}

	// Lead record: winner + [Closed - Success] (§5 rule 4 row 4, §6 rule 5).
	l, err := GetLead(ctx, conn, leadID)
	if err != nil {
		t.Fatal(err)
	}
	if l.RecordStatus != StatusClient || l.WinningAttempt != budi.ProspectID || l.WinningSalespersonID != "EMP-BUDI" {
		t.Fatalf("lead after win = %q winner=%q sales=%q", l.RecordStatus, l.WinningAttempt, l.WinningSalespersonID)
	}
	// Loser auto-closed [Closed - Kalah Kompetisi]; winner untouched.
	lost, err := attempts.GetAttempt(ctx, conn, idSalesAndi, andi.ProspectID)
	if err != nil {
		t.Fatal(err)
	}
	if lost.Status != statemachine.ProspectClosedKalah {
		t.Fatalf("competitor status = %q, want %q", lost.Status, statemachine.ProspectClosedKalah)
	}
	won, err := attempts.GetAttempt(ctx, conn, idSalesBudi, budi.ProspectID)
	if err != nil {
		t.Fatal(err)
	}
	if won.Status != statemachine.ProspectClosedSuccess {
		t.Fatalf("winner status = %q, want Closed-Success", won.Status)
	}
	// win_resolved audit row carries the losers + the §6 rule 5 note with the
	// winner's real name.
	recs := auditRows(t, conn, leadID, actionWinResolved)
	if len(recs) != 1 {
		t.Fatalf("win_resolved audit rows = %d, want 1", len(recs))
	}
	after := string(recs[0].After)
	if !strings.Contains(after, andi.ProspectID) || !strings.Contains(after, "[lead dimenangkan oleh sales lain (Budi)]") {
		t.Fatalf("win_resolved after-doc missing loser/note: %s", after)
	}
	// The engine's own transition audit on the losing attempt (system actor).
	trans, err := audit.NewMySQL().List(ctx, conn, audit.Filter{EntityType: "prospect", EntityID: andi.ProspectID, Action: "transition"})
	if err != nil {
		t.Fatal(err)
	}
	last := trans[len(trans)-1]
	if last.Actor != statemachine.ActorSystem {
		t.Fatalf("kalah transition actor = %q, want system", last.Actor)
	}

	// Second resolution refused, zero extra side effects.
	err = db.WithTx(ctx, conn, func(tx *sql.Tx) error {
		return svc.ResolveWin(ctx, tx, attempts, leadID, andi.ProspectID, "EMP-ANDI", now)
	})
	if !errors.Is(err, ErrWinAlreadyResolved) {
		t.Fatalf("second ResolveWin err = %v, want ErrWinAlreadyResolved", err)
	}
}

// TestClaimPool_SameStaffTwice_Blocked — contest is between DIFFERENT staff;
// one salesperson never holds two open attempts on one lead.
func TestClaimPool_SameStaffTwice_Blocked(t *testing.T) {
	conn, svc, attempts := newCompetitionFixture(t)
	ctx := context.Background()
	const leadID = "LEAD-202607-9002"
	insertPoolLead(t, conn, leadID, "Lulu Lala", "0812-9000-0002")

	if _, err := svc.ClaimPoolLead(ctx, conn, idSalesBudi, attempts, leadID); err != nil {
		t.Fatalf("first claim: %v", err)
	}
	if _, err := svc.ClaimPoolLead(ctx, conn, idSalesBudi, attempts, leadID); !errors.Is(err, ErrAlreadyClaimed) {
		t.Fatalf("second claim err = %v, want ErrAlreadyClaimed", err)
	}
}

// TestClaimPool_ScoutedExclusive_Blocked — §6 rule 3: scouted leads are not
// contestable; the block message names the owning salesperson.
func TestClaimPool_ScoutedExclusive_Blocked(t *testing.T) {
	conn, svc, attempts := newCompetitionFixture(t)
	ctx := context.Background()
	insertEmployee(t, conn, "EMP-BUDI", "Budi", "Sales", "Staff")

	reg, err := svc.RegisterSalesLead(ctx, conn, idSalesBudi, validSalesForm())
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.ClaimPoolLead(ctx, conn, idSalesAndi, attempts, reg.Lead.LeadID)
	var blocked *BlockedError
	if !errors.As(err, &blocked) {
		t.Fatalf("err = %v, want *BlockedError", err)
	}
	if blocked.Message != "[lead sedang diproses oleh sales lain (Budi)]" {
		t.Fatalf("message = %q", blocked.Message)
	}
}

// TestClaimPool_ClientLead_Blocked — a won lead is a client, never claimable.
func TestClaimPool_ClientLead_Blocked(t *testing.T) {
	conn, svc, attempts := newCompetitionFixture(t)
	ctx := context.Background()
	const leadID = "LEAD-202607-9003"
	insertPoolLead(t, conn, leadID, "Sinii Store", "0812-9000-0003")
	forceRecordStatus(t, conn, leadID, StatusClient)

	_, err := svc.ClaimPoolLead(ctx, conn, idSalesBudi, attempts, leadID)
	var blocked *BlockedError
	if !errors.As(err, &blocked) || blocked.Message != MsgLeadSudahKlien {
		t.Fatalf("err = %v, want blocked %q", err, MsgLeadSudahKlien)
	}
}

// TestClaimPool_ReclaimRejected_Reopens — §6 rule 7: re-claim of a
// [Rejected]/[Not Qualified] lead follows the reopen rule (record to [Pool],
// fresh attempt for the claimant, history retained).
func TestClaimPool_ReclaimRejected_Reopens(t *testing.T) {
	conn, svc, attempts := newCompetitionFixture(t)
	ctx := context.Background()
	const leadID = "LEAD-202607-9004"
	insertPoolLead(t, conn, leadID, "ABC Media", "0812-9000-0004")
	forceRecordStatus(t, conn, leadID, StatusRejected)

	res, err := svc.ClaimPoolLead(ctx, conn, idSalesBudi, attempts, leadID)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Reopened || !strings.HasPrefix(res.ProspectID, "PRSP-") {
		t.Fatalf("re-claim result = %+v, want reopened with fresh attempt", res)
	}
	l, err := GetLead(ctx, conn, leadID)
	if err != nil {
		t.Fatal(err)
	}
	if l.RecordStatus != StatusPool {
		t.Fatalf("record status = %q, want [Pool]", l.RecordStatus)
	}
}

// TestClaimPool_Permissions — claiming is a Sales write: Marketing staff, OD,
// and unmapped identities are denied server-side; nothing is created.
func TestClaimPool_Permissions(t *testing.T) {
	conn, svc, attempts := newCompetitionFixture(t)
	ctx := context.Background()
	const leadID = "LEAD-202607-9005"
	insertPoolLead(t, conn, leadID, "Unicorn Digital", "0812-9000-0005")

	for _, actor := range []authz.Identity{idMktLia, idODOnly, idUnmapped} {
		if _, err := svc.ClaimPoolLead(ctx, conn, actor, attempts, leadID); !errors.Is(err, authz.ErrDenied) {
			t.Errorf("actor %s: err = %v, want authz denial", actor.EmployeeID, err)
		}
	}
	if got := len(auditRows(t, conn, leadID, actionClaim)); got != 0 {
		t.Fatalf("claim audit rows after denials = %d, want 0", got)
	}
}
