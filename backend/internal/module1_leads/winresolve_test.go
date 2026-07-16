package module1_leads_test

import (
	"context"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module1_leads"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

func salesStaff(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: "Sales", Level: permission.LevelStaff}}
}

func svc(t *testing.T) *module1_leads.Service {
	t.Helper()
	d := testutil.DB(t)
	testutil.Clean(t, d)
	return &module1_leads.Service{DB: d, Engine: statemachine.New()}
}

// TestClaim_PermissionAndContest: only Sales may claim; a second salesperson
// forms a contest; the same salesperson cannot double-open.
func TestClaim_PermissionAndContest(t *testing.T) {
	s := svc(t)
	ctx := context.Background()
	owner := salesStaff("SS-1")

	lead, _, _, err := s.Register(ctx, owner, module1_leads.RegisterInput{LeadName: "Co", PhoneNumber: "0812", Source: "Referral"})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	// Non-Sales cannot claim.
	acct := permission.Actor{EmployeeID: "AS-1", Role: permission.Role{Division: "Account", Level: permission.LevelStaff}}
	if _, err := s.ClaimFromPool(ctx, acct, lead.ID); err == nil {
		t.Fatal("non-Sales must not claim")
	}
	// A different salesperson forms the contest.
	if _, err := s.ClaimFromPool(ctx, salesStaff("SS-2"), lead.ID); err != nil {
		t.Fatalf("contest claim: %v", err)
	}
	// The original owner already has an open attempt — double-open rejected.
	if _, err := s.ClaimFromPool(ctx, owner, lead.ID); err == nil {
		t.Fatal("same salesperson must not double-open on one lead")
	}
}

// TestResolveWin_ClosesCompetitorsAndIsIdempotent.
func TestResolveWin_ClosesCompetitorsAndIsIdempotent(t *testing.T) {
	s := svc(t)
	ctx := context.Background()
	owner := salesStaff("SS-1")

	lead, att1, _, err := s.Register(ctx, owner, module1_leads.RegisterInput{LeadName: "Co", PhoneNumber: "0812", Source: "Referral"})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	att2, err := s.ClaimFromPool(ctx, salesStaff("SS-2"), lead.ID)
	if err != nil {
		t.Fatalf("claim: %v", err)
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if err := s.ResolveWin(ctx, tx, lead.ID, att1.ID, "SS-1", time.Now().UTC()); err != nil {
		tx.Rollback()
		t.Fatalf("ResolveWin: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}

	var loserStatus string
	if err := s.DB.QueryRowContext(ctx, `SELECT status FROM prospect_attempts WHERE id = ?`, att2.ID).Scan(&loserStatus); err != nil {
		t.Fatalf("read loser: %v", err)
	}
	if loserStatus != module1_leads.AttemptClosedKalah {
		t.Fatalf("loser status = %q, want %q", loserStatus, module1_leads.AttemptClosedKalah)
	}

	// A second resolution is rejected (atomic, one winner only).
	tx2, _ := s.DB.BeginTx(ctx, nil)
	err = s.ResolveWin(ctx, tx2, lead.ID, att2.ID, "SS-2", time.Now().UTC())
	tx2.Rollback()
	if err != module1_leads.ErrAlreadyResolved {
		t.Fatalf("second ResolveWin err = %v, want ErrAlreadyResolved", err)
	}
}

// TestResolveWin_OverCollaborativeJoinAttempts: attempts created via the
// collaborative registration Join (DECISIONS 2026-07-10) resolve exactly like
// Pool-claim contests — the winner is set and every OTHER active attempt closes
// as [Closed - Kalah Kompetisi]. This case is now more common because two
// salespeople registering the same phone both land attempts on one lead.
func TestResolveWin_OverCollaborativeJoinAttempts(t *testing.T) {
	s := svc(t)
	ctx := context.Background()

	// SS-1 registers; SS-2 registers the SAME phone → collaborative Join, so both
	// attempts sit on the one Lead record.
	lead, att1, _, err := s.Register(ctx, salesStaff("SS-1"), module1_leads.RegisterInput{LeadName: "Co", PhoneNumber: "0812", Source: "Referral"})
	if err != nil {
		t.Fatalf("Register SS-1: %v", err)
	}
	joinLead, att2, notice, err := s.Register(ctx, salesStaff("SS-2"), module1_leads.RegisterInput{LeadName: "Co", PhoneNumber: "+62 812", Source: "Referral"})
	if err != nil {
		t.Fatalf("Register SS-2 (join): %v", err)
	}
	if joinLead.ID != lead.ID || att2.LeadID != lead.ID {
		t.Fatalf("join did not attach to the same lead: lead=%q joinLead=%q att2.lead=%q", lead.ID, joinLead.ID, att2.LeadID)
	}
	if notice == nil {
		t.Fatal("expected a JoinNotice for the second registration")
	}

	// SS-1 wins the lead.
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if err := s.ResolveWin(ctx, tx, lead.ID, att1.ID, "SS-1", time.Now().UTC()); err != nil {
		tx.Rollback()
		t.Fatalf("ResolveWin: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}

	// SS-2's join attempt lost the contest.
	var loserStatus string
	if err := s.DB.QueryRowContext(ctx, `SELECT status FROM prospect_attempts WHERE id = ?`, att2.ID).Scan(&loserStatus); err != nil {
		t.Fatalf("read loser: %v", err)
	}
	if loserStatus != module1_leads.AttemptClosedKalah {
		t.Fatalf("loser status = %q, want %q", loserStatus, module1_leads.AttemptClosedKalah)
	}
	// The winner is recorded on the lead.
	var winner string
	if err := s.DB.QueryRowContext(ctx, `SELECT winning_attempt_id FROM leads WHERE id = ?`, lead.ID).Scan(&winner); err != nil {
		t.Fatalf("read winner: %v", err)
	}
	if winner != att1.ID {
		t.Errorf("winning_attempt_id = %q, want %q", winner, att1.ID)
	}
}
