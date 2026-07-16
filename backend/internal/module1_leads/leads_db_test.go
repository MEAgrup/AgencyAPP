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

	lead, att, join, err := s.Register(ctx, salesActor("EMP-BUDI"), RegisterInput{
		LeadName: "Alpha Digital", PhoneNumber: "0812-3456", Source: "Scouting",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if join != nil {
		t.Errorf("fresh create should carry no JoinInfo, got %+v", join)
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

// TestRegisterCollaborativeJoin covers the M1 v2 happy path: a second
// salesperson registering a phone already worked by another JOINS the same lead
// (no new lead row), both attempts persist, the other owner is notified, the
// actor is NOT, and the registrant receives the inline JoinInfo.
func TestRegisterCollaborativeJoin(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	testutil.InsertEmployee(t, s.DB, "EMP-BUDI", "Budi", "budi@mea.co.id", "Sales", "Sales Executive", true)
	testutil.InsertEmployee(t, s.DB, "EMP-RINA", "Rina", "rina@mea.co.id", "Sales", "Sales Executive", true)

	// Budi registers the phone first.
	budiLead, _, budiJoin, err := s.Register(ctx, salesActor("EMP-BUDI"), RegisterInput{
		LeadName: "Kolab Co", PhoneNumber: "0812-7777", Source: "Scouting",
	})
	if err != nil {
		t.Fatalf("Budi Register: %v", err)
	}
	if budiJoin != nil {
		t.Errorf("first registration should not join, got %+v", budiJoin)
	}

	// Rina registers the SAME phone (different spelling) — collaborative join.
	rinaLead, rinaAtt, join, err := s.Register(ctx, salesActor("EMP-RINA"), RegisterInput{
		LeadName: "Kolab Co", PhoneNumber: "+62 812 7777", Source: "Scouting",
	})
	if err != nil {
		t.Fatalf("Rina Register (join): %v", err)
	}
	if rinaLead.ID != budiLead.ID {
		t.Fatalf("join created a new lead %q, want same as %q", rinaLead.ID, budiLead.ID)
	}
	if join == nil {
		t.Fatal("expected JoinInfo for Rina, got nil")
	}
	if join.Message != MsgCollabJoin {
		t.Errorf("JoinInfo.Message = %q, want %q", join.Message, MsgCollabJoin)
	}
	if len(join.OtherSales) != 1 || join.OtherSales[0] != "Budi" {
		t.Errorf("JoinInfo.OtherSales = %v, want [Budi]", join.OtherSales)
	}

	// Exactly one lead row, two prospect_attempts.
	var leadN, attN int
	s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM leads`).Scan(&leadN)
	if leadN != 1 {
		t.Errorf("lead count = %d, want 1 (join, not duplicate)", leadN)
	}
	s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM prospect_attempts WHERE lead_id = ?`, budiLead.ID).Scan(&attN)
	if attN != 2 {
		t.Errorf("attempt count = %d, want 2", attN)
	}
	if rinaAtt.Owner != "EMP-RINA" {
		t.Errorf("rina attempt owner = %q", rinaAtt.Owner)
	}

	// Budi has one collaborative-attempt notification; Rina (actor) has none.
	var budiNotif int
	s.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM notifications WHERE recipient_employee_id = 'EMP-BUDI' AND event_type = ?`,
		string(notification.EvLeadCollabAttempt)).Scan(&budiNotif)
	if budiNotif != 1 {
		t.Errorf("Budi collab notifications = %d, want 1", budiNotif)
	}
	var rinaNotif int
	s.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM notifications WHERE recipient_employee_id = 'EMP-RINA'`).Scan(&rinaNotif)
	if rinaNotif != 0 {
		t.Errorf("Rina (actor) notifications = %d, want 0", rinaNotif)
	}

	// A dedup_join audit row is recorded on the lead.
	le, _ := audit.List(ctx, s.DB, audit.Filter{EntityType: "lead", EntityID: budiLead.ID})
	var sawJoin bool
	for _, e := range le {
		if e.Action == "dedup_join" {
			sawJoin = true
		}
	}
	if !sawJoin {
		t.Errorf("expected a dedup_join audit row on the lead, got %+v", le)
	}
}

// TestRegisterOwnDuplicateBlocked: the same salesperson registering their own
// lead twice is blocked with MsgAlreadyOwnAttempt; no second attempt is created.
func TestRegisterOwnDuplicateBlocked(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	testutil.InsertEmployee(t, s.DB, "EMP-BUDI", "Budi", "budi@mea.co.id", "Sales", "Sales Executive", true)

	lead, _, _, err := s.Register(ctx, salesActor("EMP-BUDI"), RegisterInput{
		LeadName: "Solo Co", PhoneNumber: "0812-5555", Source: "Scouting",
	})
	if err != nil {
		t.Fatalf("first Register: %v", err)
	}

	_, _, _, err = s.Register(ctx, salesActor("EMP-BUDI"), RegisterInput{
		LeadName: "Solo Co", PhoneNumber: "0812 5555", Source: "Scouting",
	})
	var blocked *ErrBlocked
	if !errors.As(err, &blocked) {
		t.Fatalf("err = %v, want *ErrBlocked", err)
	}
	if blocked.Message != MsgAlreadyOwnAttempt {
		t.Errorf("message = %q, want %q", blocked.Message, MsgAlreadyOwnAttempt)
	}
	var attN int
	s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM prospect_attempts WHERE lead_id = ?`, lead.ID).Scan(&attN)
	if attN != 1 {
		t.Errorf("attempt count = %d, want 1 (own duplicate blocked)", attN)
	}
}

// TestRegisterJoinUnsyncedOwner is the O19 regression: an attempt owned by an
// employee absent from `employees` must NOT be dropped from dedup. The LEFT JOIN
// falls back to the raw employee id as the display name, and MatchByPhone
// surfaces the attempt in OpenAttempts.
func TestRegisterJoinUnsyncedOwner(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	testutil.InsertEmployee(t, s.DB, "EMP-RINA", "Rina", "rina@mea.co.id", "Sales", "Sales Executive", true)

	// Raw INSERTs: a lead + open attempt whose owner is NOT in employees.
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO leads (id, lead_name, phone_number, phone_norm, source, origin_division, record_status, created_by)
		 VALUES ('LEAD-U', 'Unsynced Co', '0812-8888', '8128888', 'Scouting', 'Sales', 'active', 'TEST')`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO prospect_attempts (id, lead_id, owner_employee_id, status, created_by)
		 VALUES ('PRSP-U', 'LEAD-U', 'EMP-GHOST', 'Contacted', 'TEST')`); err != nil {
		t.Fatal(err)
	}

	// MatchByPhone directly returns the unsynced attempt with fallback name.
	match, err := MatchByPhone(ctx, s.DB, "8128888")
	if err != nil {
		t.Fatalf("MatchByPhone: %v", err)
	}
	if match == nil || len(match.OpenAttempts) != 1 {
		t.Fatalf("MatchByPhone OpenAttempts = %+v, want 1", match)
	}
	if match.OpenAttempts[0].OwnerID != "EMP-GHOST" || match.OpenAttempts[0].OwnerName != "EMP-GHOST" {
		t.Errorf("unsynced attempt = %+v, want owner/name EMP-GHOST", match.OpenAttempts[0])
	}

	// Rina registers the same phone — join succeeds, other owner is the raw id.
	_, _, join, err := s.Register(ctx, salesActor("EMP-RINA"), RegisterInput{
		LeadName: "Unsynced Co", PhoneNumber: "0812 8888", Source: "Scouting",
	})
	if err != nil {
		t.Fatalf("Register (join unsynced): %v", err)
	}
	if join == nil {
		t.Fatal("expected JoinInfo, got nil")
	}
	if len(join.OtherSales) != 1 || join.OtherSales[0] != "EMP-GHOST" {
		t.Errorf("JoinInfo.OtherSales = %v, want [EMP-GHOST]", join.OtherSales)
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

	lead, att, join, err := s.Register(ctx, salesActor("EMP-BUDI"), RegisterInput{
		LeadName: "Sini Store", PhoneNumber: "0813 0000", Source: "Scouting",
	})
	if err != nil {
		t.Fatalf("Register (reopen): %v", err)
	}
	if join != nil {
		t.Errorf("reopen should carry no JoinInfo, got %+v", join)
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
