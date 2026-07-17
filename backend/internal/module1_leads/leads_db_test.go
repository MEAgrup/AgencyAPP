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

	lead, att, notice, err := s.Register(ctx, salesActor("EMP-BUDI"), RegisterInput{
		LeadName: "Alpha Digital", PhoneNumber: "0812-3456", Source: "Scouting",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if notice != "" {
		t.Errorf("fresh create carried notice %q, want empty", notice)
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

// TestRegisterJoinsCoPursuit is the dedup-v2 collaborative path: a second
// salesperson registering a phone already worked by ANOTHER sales is NOT
// blocked — a new attempt is attached to the existing lead (co-pursuit), a
// dedup_join audit row is appended, the co-pursuit notification reaches the
// prior owner AND the registrant, and the registrant gets the notice back.
func TestRegisterJoinsCoPursuit(t *testing.T) {
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

	lead, att, notice, err := s.Register(ctx, salesActor("EMP-BUDI"), RegisterInput{
		LeadName: "Unicorn Dup", PhoneNumber: "+62 812 9999", Source: "Scouting",
	})
	if err != nil {
		t.Fatalf("Register (join): %v", err)
	}
	if notice != MsgLeadCoWorked {
		t.Errorf("notice = %q, want %q", notice, MsgLeadCoWorked)
	}
	if lead.ID != "LEAD-X" {
		t.Errorf("joined lead = %q, want LEAD-X", lead.ID)
	}
	if lead.RecordStatus != RecordActive {
		t.Errorf("record_status = %q, want active (join must not transition)", lead.RecordStatus)
	}
	if att.Owner != "EMP-BUDI" || att.Status != AttemptNewLead || att.LeadID != "LEAD-X" {
		t.Errorf("attempt = %+v", att)
	}

	// A brand-new attempt exists alongside Andi's — no new lead row.
	var leadCount, attemptCount int
	s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM leads`).Scan(&leadCount)
	s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM prospect_attempts WHERE lead_id = 'LEAD-X'`).Scan(&attemptCount)
	if leadCount != 1 {
		t.Errorf("lead count = %d, want 1 (joined, not duplicated)", leadCount)
	}
	if attemptCount != 2 {
		t.Errorf("attempt count = %d, want 2 (Andi + Budi co-pursuit)", attemptCount)
	}

	// dedup_join audit on the lead.
	le, _ := audit.List(ctx, s.DB, audit.Filter{EntityType: "lead", EntityID: "LEAD-X"})
	var sawJoin bool
	for _, e := range le {
		if e.Action == "dedup_join" {
			sawJoin = true
		}
	}
	if !sawJoin {
		t.Errorf("missing dedup_join audit on LEAD-X")
	}

	// The prior owner and the registrant are both notified (co-pursuit).
	if n, _ := notification.UnreadCount(ctx, s.DB, "EMP-ANDI"); n != 1 {
		t.Errorf("Andi unread = %d, want 1", n)
	}
	if n, _ := notification.UnreadCount(ctx, s.DB, "EMP-BUDI"); n != 1 {
		t.Errorf("Budi unread = %d, want 1", n)
	}
}

// TestRegisterSameOwnerBlocked: the same salesperson cannot double-open on a
// lead they already hold — blocked with the dedup-v2 BI string.
func TestRegisterSameOwnerBlocked(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	testutil.InsertEmployee(t, s.DB, "EMP-ANDI", "Andi", "andi@mea.co.id", "Sales", "Sales Executive", true)

	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO leads (id, lead_name, phone_number, phone_norm, source, origin_division, record_status, created_by)
		 VALUES ('LEAD-Y', 'Unicorn', '0812-9999', '8129999', 'Scouting', 'Sales', 'active', 'TEST')`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO prospect_attempts (id, lead_id, owner_employee_id, status, created_by)
		 VALUES ('PRSP-Y', 'LEAD-Y', 'EMP-ANDI', 'Contacted', 'TEST')`); err != nil {
		t.Fatal(err)
	}

	_, _, _, err := s.Register(ctx, salesActor("EMP-ANDI"), RegisterInput{
		LeadName: "Unicorn Again", PhoneNumber: "+62 812 9999", Source: "Scouting",
	})
	var blocked *ErrBlocked
	if !errors.As(err, &blocked) {
		t.Fatalf("err = %v, want *ErrBlocked", err)
	}
	if blocked.Message != MsgAlreadyOwnAttempt {
		t.Errorf("message = %q, want %q", blocked.Message, MsgAlreadyOwnAttempt)
	}
	// No second attempt, no second lead.
	var n int
	s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM prospect_attempts WHERE lead_id = 'LEAD-Y'`).Scan(&n)
	if n != 1 {
		t.Errorf("attempt count = %d, want 1 (no double-open)", n)
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

	lead, att, notice, err := s.Register(ctx, salesActor("EMP-BUDI"), RegisterInput{
		LeadName: "Sini Store", PhoneNumber: "0813 0000", Source: "Scouting",
	})
	if err != nil {
		t.Fatalf("Register (reopen): %v", err)
	}
	if notice != "" {
		t.Errorf("reopen carried notice %q, want empty", notice)
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
