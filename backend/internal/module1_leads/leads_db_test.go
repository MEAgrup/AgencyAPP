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

// newServiceWithCatalog builds an M1 service with the notification catalog bound
// (for collaborative-Join notification assertions).
func newServiceWithCatalog(t *testing.T) *Service {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	return &Service{DB: d, Engine: statemachine.New(), Catalog: notification.NewCatalog()}
}

func salesActor(id string) permission.Actor {
	return permission.Actor{
		EmployeeID: id,
		Role:       permission.Role{Division: SalesDivision, Level: permission.LevelStaff},
	}
}

func newService(t *testing.T) *Service {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	return &Service{DB: d, Engine: statemachine.New()}
}

func TestRegisterCreatesLeadAndAttempt(t *testing.T) {
	s := newService(t)
	testutil.InsertEmployee(t, s.DB, "EMP-BUDI", "Budi", "budi@mea.co.id", "Sales", "Sales Executive", true)
	ctx := context.Background()

	lead, att, _, err := s.Register(ctx, salesActor("EMP-BUDI"), RegisterInput{
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
	_, _, _, err := s.Register(context.Background(), salesActor("EMP-BUDI"), RegisterInput{LeadName: "X"})
	if !errors.Is(err, ErrIncomplete) {
		t.Fatalf("err = %v, want ErrIncomplete", err)
	}
}

// TestRegisterJoinsAnotherSalesLead is the collaborative-dedup happy path
// (DECISIONS 2026-07-10): a second salesperson registering a phone another sales
// already works is NOT blocked — a new attempt is attached to the SAME lead, the
// other owner is notified, and the join is audited. Replaces the old block test.
func TestRegisterJoinsAnotherSalesLead(t *testing.T) {
	s := newServiceWithCatalog(t)
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

	lead, att, notice, err := s.Register(ctx, salesActor("EMP-BUDI"), RegisterInput{
		LeadName: "Unicorn Dup", PhoneNumber: "+62 812 9999", Source: "Scouting",
	})
	if err != nil {
		t.Fatalf("Register (join): %v", err)
	}
	// Attached to the existing lead (no duplicate record).
	if lead.ID != "LEAD-X" {
		t.Errorf("join lead = %q, want LEAD-X", lead.ID)
	}
	if att.Owner != "EMP-BUDI" || att.LeadID != "LEAD-X" || att.Status != AttemptNewLead {
		t.Errorf("attempt = %+v", att)
	}
	// Informational (non-error) message names the other owner.
	if notice == nil {
		t.Fatal("expected a JoinNotice for a collaborative join")
	}
	if notice.Message != "[lead juga sedang dikerjakan sales lain (Andi)]" {
		t.Errorf("notice message = %q", notice.Message)
	}
	// Still exactly one lead; now two attempts.
	var leadN, attN int
	s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM leads`).Scan(&leadN)
	s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM prospect_attempts WHERE lead_id='LEAD-X'`).Scan(&attN)
	if leadN != 1 || attN != 2 {
		t.Errorf("leads=%d attempts=%d, want 1 and 2", leadN, attN)
	}
	// Andi (the other active owner) was notified; Budi (registrant) was not.
	if n, _ := notification.UnreadCount(ctx, s.DB, "EMP-ANDI"); n != 1 {
		t.Errorf("Andi unread = %d, want 1", n)
	}
	if n, _ := notification.UnreadCount(ctx, s.DB, "EMP-BUDI"); n != 0 {
		t.Errorf("Budi (registrant) unread = %d, want 0", n)
	}
	// The join is audited on the lead.
	le, _ := audit.List(ctx, s.DB, audit.Filter{EntityType: "lead", EntityID: "LEAD-X"})
	var found bool
	for _, e := range le {
		if e.Action == "dedup_join" {
			found = true
		}
	}
	if !found {
		t.Error("missing dedup_join audit entry on the lead")
	}
}

// TestRegisterJoin_SameSalesGuard: a salesperson who already has an open attempt
// on a lead cannot open a second one via registration (ErrAlreadyPursuing,
// consistent with ClaimFromPool).
func TestRegisterJoin_SameSalesGuard(t *testing.T) {
	s := newServiceWithCatalog(t)
	ctx := context.Background()
	testutil.InsertEmployee(t, s.DB, "EMP-BUDI", "Budi", "budi@mea.co.id", "Sales", "Sales Executive", true)

	// Budi registers a scouted lead (exclusive attempt).
	lead, _, _, err := s.Register(ctx, salesActor("EMP-BUDI"), RegisterInput{
		LeadName: "Sini Store", PhoneNumber: "0812-7777", Source: "Scouting",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	// Registering the same phone again → he already pursues it.
	_, _, _, err = s.Register(ctx, salesActor("EMP-BUDI"), RegisterInput{
		LeadName: "Sini Store", PhoneNumber: "+62 812 7777", Source: "Scouting",
	})
	if !errors.Is(err, ErrAlreadyPursuing) {
		t.Fatalf("err = %v, want ErrAlreadyPursuing", err)
	}
	// No duplicate attempt created.
	var attN int
	s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM prospect_attempts WHERE lead_id=?`, lead.ID).Scan(&attN)
	if attN != 1 {
		t.Errorf("attempts = %d, want 1 (guarded)", attN)
	}
}

// TestRegisterJoin_O19_UnsyncedOwnerDetected: an attempt owned by an employee
// NOT yet synced from HRIS must still be detected by dedup (LEFT JOIN, O19) — the
// registration JOINs (rather than losing the attempt and minting a duplicate),
// and the owner name falls back to the employee id.
func TestRegisterJoin_O19_UnsyncedOwnerDetected(t *testing.T) {
	s := newServiceWithCatalog(t)
	ctx := context.Background()
	testutil.InsertEmployee(t, s.DB, "EMP-BUDI", "Budi", "budi@mea.co.id", "Sales", "Sales Executive", true)

	// LEAD-Y is worked by EMP-GHOST, who is NOT present in employees (unsynced).
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO leads (id, lead_name, phone_number, phone_norm, source, origin_division, record_status, created_by)
		 VALUES ('LEAD-Y', 'Ghost Co', '0812-1212', '8121212', 'Scouting', 'Sales', 'active', 'TEST')`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO prospect_attempts (id, lead_id, owner_employee_id, status, created_by)
		 VALUES ('PRSP-Y', 'LEAD-Y', 'EMP-GHOST', 'Contacted', 'TEST')`); err != nil {
		t.Fatal(err)
	}

	lead, att, notice, err := s.Register(ctx, salesActor("EMP-BUDI"), RegisterInput{
		LeadName: "Ghost Dup", PhoneNumber: "0812 1212", Source: "Scouting",
	})
	if err != nil {
		t.Fatalf("Register (O19 join): %v", err)
	}
	// Detected as in-process → JOIN onto LEAD-Y (attempt not lost, no duplicate).
	if lead.ID != "LEAD-Y" || att.LeadID != "LEAD-Y" {
		t.Errorf("expected join onto LEAD-Y, got lead=%q att.lead=%q", lead.ID, att.LeadID)
	}
	var leadN int
	s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM leads`).Scan(&leadN)
	if leadN != 1 {
		t.Errorf("lead count = %d, want 1 (no duplicate from unsynced-owner)", leadN)
	}
	// Owner name falls back to the employee id (not synced) in the message +
	// notification.
	if notice == nil || notice.Message != "[lead juga sedang dikerjakan sales lain (EMP-GHOST)]" {
		t.Errorf("notice = %+v, want fallback to EMP-GHOST", notice)
	}
	if n, _ := notification.UnreadCount(ctx, s.DB, "EMP-GHOST"); n != 1 {
		t.Errorf("EMP-GHOST unread = %d, want 1", n)
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

	lead, att, _, err := s.Register(ctx, salesActor("EMP-BUDI"), RegisterInput{
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
