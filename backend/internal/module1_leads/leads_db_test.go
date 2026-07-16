package module1_leads

import (
	"context"
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

func salesActor(id string) permission.Actor {
	return permission.Actor{
		EmployeeID: id,
		Role:       permission.Role{Division: SalesDivision, Level: permission.LevelStaff},
	}
}

func newService(t *testing.T) *Service {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	return &Service{DB: d, Engine: statemachine.New(), Catalog: notification.NewCatalog()}
}

func TestRegisterCreatesLeadAndAttempt(t *testing.T) {
	s := newService(t)
	testutil.InsertEmployee(t, s.DB, "EMP-BUDI", "Budi", "budi@mea.co.id", "Sales", "Sales Executive", true)
	ctx := context.Background()

	lead, att, err := s.Register(ctx, salesActor("EMP-BUDI"), RegisterInput{
		LeadName: "Alpha Digital", PhoneNumber: "0812-3456", Source: "Scouting",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if lead.RecordStatus != RecordActive {
		t.Errorf("lead status = %q, want %q", lead.RecordStatus, RecordActive)
	}
	if att.Status != AttemptNewLead || att.Owner != "EMP-BUDI" || att.LeadID != lead.ID {
		t.Errorf("attempt = %+v", att)
	}
	// Both entities carry a create audit entry.
	le, _ := audit.List(ctx, s.DB, audit.Filter{EntityType: "lead", EntityID: lead.ID})
	ae, _ := audit.List(ctx, s.DB, audit.Filter{EntityType: "prospect_attempt", EntityID: att.ID})
	if len(le) == 0 || len(ae) == 0 {
		t.Errorf("missing audit: lead=%d attempt=%d", len(le), len(ae))
	}
}

func TestRegisterIncomplete(t *testing.T) {
	s := newService(t)
	_, _, err := s.Register(context.Background(), salesActor("EMP-BUDI"), RegisterInput{LeadName: "X"})
	if !errors.Is(err, ErrIncomplete) {
		t.Fatalf("err = %v, want ErrIncomplete", err)
	}
}

// TestRegisterJoinsExistingActiveLead is the v2 collaborative core (D2/D4/D7):
// a second salesperson registering a phone already worked by another JOINS the
// existing lead with a parallel attempt — one lead, two attempts, the existing
// owner is notified, the actor gets the info string, and the join is audited.
func TestRegisterJoinsExistingActiveLead(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	testutil.InsertEmployee(t, s.DB, "EMP-ANDI", "Andi", "andi@mea.co.id", "Sales", "Sales Executive", true)
	testutil.InsertEmployee(t, s.DB, "EMP-BUDI", "Budi", "budi@mea.co.id", "Sales", "Sales Executive", true)

	// Andi already works this phone (active, in-process attempt).
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO leads (id, lead_name, phone_number, phone_norm, source, origin_division, record_status, created_by)
		 VALUES ('LEAD-X', 'Unicorn', '0812-9999', '8129999', 'Scouting', 'Sales', 'active', 'TEST')`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO prospect_attempts (id, lead_id, owner_employee_id, status, created_by)
		 VALUES ('PRSP-X', 'LEAD-X', 'EMP-ANDI', 'Contacted', 'TEST')`); err != nil {
		t.Fatal(err)
	}

	res, err := s.RegisterWithResult(ctx, salesActor("EMP-BUDI"), RegisterInput{
		LeadName: "Unicorn Dup", PhoneNumber: "+62 812 9999", Source: "Scouting",
	})
	if err != nil {
		t.Fatalf("RegisterWithResult (join): %v", err)
	}
	if !res.JoinedExisting {
		t.Errorf("JoinedExisting = false, want true")
	}
	if res.Info != "[lead juga sedang dikerjakan sales lain (Andi)]" {
		t.Errorf("Info = %q", res.Info)
	}
	if res.Lead.ID != "LEAD-X" || res.Attempt.Owner != "EMP-BUDI" || res.Attempt.LeadID != "LEAD-X" {
		t.Errorf("join result = lead %+v attempt %+v", res.Lead, res.Attempt)
	}
	// Record status is left untouched (D2/D3: no transition on join).
	if res.Lead.RecordStatus != "active" {
		t.Errorf("record_status = %q, want active (unchanged)", res.Lead.RecordStatus)
	}

	// Exactly one lead, two attempts.
	var leads, attempts int
	s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM leads`).Scan(&leads)
	s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM prospect_attempts WHERE lead_id = 'LEAD-X'`).Scan(&attempts)
	if leads != 1 || attempts != 2 {
		t.Fatalf("leads=%d attempts=%d, want 1 and 2", leads, attempts)
	}

	// Andi (existing owner) is notified; Budi (joining actor) is NOT.
	if n, _ := notification.UnreadCount(ctx, s.DB, "EMP-ANDI"); n != 1 {
		t.Errorf("Andi unread = %d, want 1", n)
	}
	if n, _ := notification.UnreadCount(ctx, s.DB, "EMP-BUDI"); n != 0 {
		t.Errorf("Budi (actor) unread = %d, want 0", n)
	}

	// The join is on the audit trail (append-only, M1 §5 Rule 6).
	entries, _ := audit.List(ctx, s.DB, audit.Filter{EntityType: "lead", EntityID: "LEAD-X"})
	var joined bool
	for _, e := range entries {
		if e.Action == "collab_joined" {
			joined = true
		}
	}
	if !joined {
		t.Errorf("no collab_joined audit entry on LEAD-X")
	}
}

// TestRegisterBlockedWhenActorAlreadyHolds covers the new same-owner guard (D2):
// the salesperson who already holds a live attempt cannot re-register the lead.
func TestRegisterBlockedWhenActorAlreadyHolds(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	testutil.InsertEmployee(t, s.DB, "EMP-BUDI", "Budi", "budi@mea.co.id", "Sales", "Sales Executive", true)

	if _, _, err := s.Register(ctx, salesActor("EMP-BUDI"), RegisterInput{
		LeadName: "Zeta", PhoneNumber: "0812-7777", Source: "Scouting",
	}); err != nil {
		t.Fatalf("first Register: %v", err)
	}
	_, _, err := s.Register(ctx, salesActor("EMP-BUDI"), RegisterInput{
		LeadName: "Zeta Again", PhoneNumber: "+62 812 7777", Source: "Scouting",
	})
	var blocked *ErrBlocked
	if !errors.As(err, &blocked) {
		t.Fatalf("err = %v, want *ErrBlocked", err)
	}
	if blocked.Message != MsgAlreadyOwnAttempt {
		t.Errorf("message = %q, want %q", blocked.Message, MsgAlreadyOwnAttempt)
	}
	var n int
	s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM leads`).Scan(&n)
	if n != 1 {
		t.Errorf("lead count = %d, want 1", n)
	}
}

// TestRegisterBlockedWhenClient keeps the closed-success block (D2 unchanged row).
func TestRegisterBlockedWhenClient(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	testutil.InsertEmployee(t, s.DB, "EMP-BUDI", "Budi", "budi@mea.co.id", "Sales", "Sales Executive", true)

	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO leads (id, lead_name, phone_number, phone_norm, source, origin_division, record_status, created_by)
		 VALUES ('LEAD-WON', 'Won Co', '0812-1111', '8121111', 'Scouting', 'Sales', '[Closed-Success]', 'TEST')`); err != nil {
		t.Fatal(err)
	}
	_, _, err := s.Register(ctx, salesActor("EMP-BUDI"), RegisterInput{
		LeadName: "Won Co Dup", PhoneNumber: "0812 1111", Source: "Scouting",
	})
	var blocked *ErrBlocked
	if !errors.As(err, &blocked) {
		t.Fatalf("err = %v, want *ErrBlocked", err)
	}
	if blocked.Message != MsgAlreadyClient {
		t.Errorf("message = %q, want %q", blocked.Message, MsgAlreadyClient)
	}
}

// TestMatchByPhoneCountsUnsyncedOwner is the O19/LEFT-JOIN guarantee: an attempt
// whose owner has no employees row still counts as an active collaborator, so a
// second salesperson JOINS rather than creating a duplicate — dedup never hinges
// on HRIS sync timing.
func TestMatchByPhoneCountsUnsyncedOwner(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	// EMP-GHOST is deliberately NOT inserted into employees.
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO leads (id, lead_name, phone_number, phone_norm, source, origin_division, record_status, created_by)
		 VALUES ('LEAD-G', 'Ghost Co', '0812-2222', '8122222', 'Scouting', 'Sales', 'active', 'TEST')`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO prospect_attempts (id, lead_id, owner_employee_id, status, created_by)
		 VALUES ('PRSP-G', 'LEAD-G', 'EMP-GHOST', 'Contacted', 'TEST')`); err != nil {
		t.Fatal(err)
	}

	m, err := MatchByPhone(ctx, s.DB, "8122222", "EMP-OTHER")
	if err != nil {
		t.Fatalf("MatchByPhone: %v", err)
	}
	if m == nil || !m.HasActiveScoutedAttempt {
		t.Fatalf("match = %+v, want an active attempt despite unsynced owner", m)
	}
	if len(m.ActiveOwners) != 1 || m.ActiveOwners[0].EmployeeID != "EMP-GHOST" || m.ActiveOwners[0].Name != "" {
		t.Errorf("ActiveOwners = %+v, want one EMP-GHOST with empty name", m.ActiveOwners)
	}
	if m.ActorHasActiveAttempt {
		t.Errorf("ActorHasActiveAttempt = true for a non-owner actor")
	}
	if d := Decide(ChannelSingleReg, m); d.Outcome != OutcomeJoin {
		t.Errorf("Decide outcome = %v, want Join (collaborate on unsynced-owner lead)", d.Outcome)
	}

	// End-to-end: a live registration by another sales joins, does not duplicate.
	testutil.InsertEmployee(t, s.DB, "EMP-OTHER", "Other", "other@mea.co.id", "Sales", "Sales Executive", true)
	res, err := s.RegisterWithResult(ctx, salesActor("EMP-OTHER"), RegisterInput{
		LeadName: "Ghost Dup", PhoneNumber: "0812 2222", Source: "Scouting",
	})
	if err != nil {
		t.Fatalf("RegisterWithResult: %v", err)
	}
	if !res.JoinedExisting || res.Lead.ID != "LEAD-G" {
		t.Errorf("expected join of LEAD-G, got %+v", res)
	}
	var n int
	s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM leads`).Scan(&n)
	if n != 1 {
		t.Errorf("lead count = %d, want 1 (joined, not duplicated)", n)
	}
}

func TestRegisterReopensTerminalLead(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	testutil.InsertEmployee(t, s.DB, "EMP-BUDI", "Budi", "budi@mea.co.id", "Sales", "Sales Executive", true)

	// A previously not-qualified lead, no active attempt.
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO leads (id, lead_name, phone_number, phone_norm, source, origin_division, record_status, created_by)
		 VALUES ('LEAD-OLD', 'Sini Store', '0813-0000', '8130000', 'Scouting', 'Sales', '[Not Qualified]', 'TEST')`); err != nil {
		t.Fatal(err)
	}

	lead, att, err := s.Register(ctx, salesActor("EMP-BUDI"), RegisterInput{
		LeadName: "Sini Store", PhoneNumber: "0813 0000", Source: "Scouting",
	})
	if err != nil {
		t.Fatalf("Register (reopen): %v", err)
	}
	if lead.ID != "LEAD-OLD" {
		t.Errorf("expected reopen of LEAD-OLD, got %q", lead.ID)
	}
	if lead.RecordStatus != RecordActive {
		t.Errorf("reopened status = %q, want active", lead.RecordStatus)
	}
	if att.Owner != "EMP-BUDI" || att.Status != AttemptNewLead {
		t.Errorf("attempt = %+v", att)
	}
	// No new lead row; still exactly one.
	var n int
	s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM leads`).Scan(&n)
	if n != 1 {
		t.Errorf("lead count = %d, want 1 (reopened, not duplicated)", n)
	}
}

// TestRegisterSoloJoinPoolCarriesNoInfo covers the pool-claim-equivalent join
// (D2): registering a phone that matches a [Pool] lead with no live attempt
// attaches the actor's attempt but is NOT a collaboration — no info string, no
// notification, record_status untouched.
func TestRegisterSoloJoinPoolCarriesNoInfo(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	testutil.InsertEmployee(t, s.DB, "EMP-BUDI", "Budi", "budi@mea.co.id", "Sales", "Sales Executive", true)

	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO leads (id, lead_name, phone_number, phone_norm, source, origin_division, record_status, created_by)
		 VALUES ('LEAD-P', 'Pool Co', '0812-3333', '8123333', 'Import', 'Marketing', '[Pool]', 'TEST')`); err != nil {
		t.Fatal(err)
	}

	res, err := s.RegisterWithResult(ctx, salesActor("EMP-BUDI"), RegisterInput{
		LeadName: "Pool Co", PhoneNumber: "0812 3333", Source: "Scouting",
	})
	if err != nil {
		t.Fatalf("RegisterWithResult (solo join): %v", err)
	}
	if !res.JoinedExisting || res.Lead.ID != "LEAD-P" {
		t.Fatalf("expected join of LEAD-P, got %+v", res)
	}
	if res.Info != "" {
		t.Errorf("solo join Info = %q, want empty (no collaborator)", res.Info)
	}
	if res.Lead.RecordStatus != "[Pool]" {
		t.Errorf("record_status = %q, want [Pool] (unchanged)", res.Lead.RecordStatus)
	}
	if n, _ := notification.UnreadCount(ctx, s.DB, "EMP-BUDI"); n != 0 {
		t.Errorf("solo join produced %d notifications, want 0", n)
	}
}
