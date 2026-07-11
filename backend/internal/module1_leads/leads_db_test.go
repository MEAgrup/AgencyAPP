package module1_leads

import (
	"context"
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
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
	return &Service{DB: d, Engine: statemachine.New()}
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

func TestRegisterBlockedByAnotherSales(t *testing.T) {
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

	_, _, err := s.Register(ctx, salesActor("EMP-BUDI"), RegisterInput{
		LeadName: "Unicorn Dup", PhoneNumber: "+62 812 9999", Source: "Scouting",
	})
	var blocked *ErrBlocked
	if !errors.As(err, &blocked) {
		t.Fatalf("err = %v, want *ErrBlocked", err)
	}
	if blocked.Message != "[tidak bisa ditambahkan, lead sedang diproses oleh sales lain (Andi)]" {
		t.Errorf("message = %q", blocked.Message)
	}
	// No second lead created.
	var n int
	s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM leads`).Scan(&n)
	if n != 1 {
		t.Errorf("lead count = %d, want 1 (no duplicate created)", n)
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
