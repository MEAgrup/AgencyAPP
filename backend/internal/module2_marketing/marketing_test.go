package module2_marketing

import (
	"context"
	"errors"
	"testing"
)

// mustCampaign creates a Draft campaign owned by owner and returns its id.
func mustCampaign(t *testing.T, s *Service, ownerID string) string {
	t.Helper()
	c, err := s.campaign().Create(context.Background(), mktStaff(ownerID), validInput())
	if err != nil {
		t.Fatalf("create campaign: %v", err)
	}
	return c.ID
}

// ---- Budget validation (M2 §3 Rule 3/4): empty / 0 / negative -> BI default, no row ----

func TestCreateRecord_BudgetValidation(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	cid := mustCampaign(t, s, "EMP-LIA")

	for _, bad := range []string{"", "   ", "0", "0.00", "-5000000", "abc"} {
		if _, err := s.CreateRecord(ctx, mktStaff("EMP-LIA"), cid, bad); !errors.Is(err, ErrIncomplete) {
			t.Fatalf("budget %q err=%v want ErrIncomplete", bad, err)
		}
	}
	// No record row was written by any of the failed creates.
	var n int
	if err := s.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM marketing_performance_records WHERE campaign_id=?`, cid).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("record rows=%d want 0 after failed validations", n)
	}

	// Valid budget -> record created, IDR formatted.
	rec, err := s.CreateRecord(ctx, mktStaff("EMP-LIA"), cid, "5000000")
	if err != nil {
		t.Fatalf("valid create: %v", err)
	}
	if rec.Budget != "5000000.00" {
		t.Errorf("budget=%q want 5000000.00", rec.Budget)
	}
	if rec.BudgetIDR != "Rp. 5.000.000,00" {
		t.Errorf("budget_idr=%q want Rp. 5.000.000,00", rec.BudgetIDR)
	}
	if !rec.Online || rec.Offline {
		t.Errorf("online/offline read from campaign = %v/%v want true/false", rec.Online, rec.Offline)
	}
}

// ---- 1:1 duplicate rejected (M3-OA-5) ----

func TestCreateRecord_DuplicateRejected(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	cid := mustCampaign(t, s, "EMP-LIA")
	if _, err := s.CreateRecord(ctx, mktStaff("EMP-LIA"), cid, "5000000"); err != nil {
		t.Fatalf("first create: %v", err)
	}
	if _, err := s.CreateRecord(ctx, mktStaff("EMP-LIA"), cid, "9000000"); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("second create err=%v want ErrDuplicate", err)
	}
	// Exactly one row, budget unchanged by the rejected second create.
	var dec string
	if err := s.DB.QueryRowContext(ctx,
		`SELECT budget FROM marketing_performance_records WHERE campaign_id=?`, cid).Scan(&dec); err != nil {
		t.Fatal(err)
	}
	if dec != "5000000.00" {
		t.Fatalf("budget=%q want 5000000.00 (unchanged)", dec)
	}
}

// ---- CreateRecord / UpdateBudget permissions (M2 §3 Rule 5 / §5 Rule 3) ----

func TestCreateRecord_Permissions(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	cid := mustCampaign(t, s, "EMP-LIA") // owned by Lia

	// Non-owner Marketing staff: campaign not visible -> ErrForbidden.
	if _, err := s.CreateRecord(ctx, mktStaff("EMP-DINA"), cid, "5000000"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-owner staff err=%v want ErrForbidden", err)
	}
	// Marketing lead (sees all, but read-only over staff records) cannot create for a
	// staff-owned campaign (M2 §5 Rule 3).
	if _, err := s.CreateRecord(ctx, mktLead("EMP-MHEAD"), cid, "5000000"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("lead create-over-staff err=%v want ErrForbidden", err)
	}
	// OD is read-only everywhere.
	if _, err := s.CreateRecord(ctx, od("EMP-OD"), cid, "5000000"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("OD create err=%v want ErrForbidden", err)
	}
	// Foreign division denied.
	if _, err := s.CreateRecord(ctx, salesStaff("EMP-SAL"), cid, "5000000"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("sales create err=%v want ErrForbidden", err)
	}
	// Owner staff may create.
	if _, err := s.CreateRecord(ctx, mktStaff("EMP-LIA"), cid, "5000000"); err != nil {
		t.Fatalf("owner create: %v", err)
	}
	// Director has full access on a separate campaign.
	dcid := mustCampaign(t, s, "EMP-LIA")
	if _, err := s.CreateRecord(ctx, director("EMP-DIR"), dcid, "3000000"); err != nil {
		t.Fatalf("director create: %v", err)
	}
	// Missing campaign -> ErrNotFound.
	if _, err := s.CreateRecord(ctx, mktStaff("EMP-LIA"), "CMP-000000-9999", "5000000"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing campaign err=%v want ErrNotFound", err)
	}
}

// A Marketing lead who OWNS the campaign may create/edit its record (owner branch).
func TestCreateRecord_LeadOwnerMayManage(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	// Campaign owned by the Marketing Head themselves.
	c, err := s.campaign().Create(ctx, mktLead("EMP-MHEAD"), validInput())
	if err != nil {
		t.Fatalf("lead create campaign: %v", err)
	}
	if _, err := s.CreateRecord(ctx, mktLead("EMP-MHEAD"), c.ID, "5000000"); err != nil {
		t.Fatalf("lead-owner create record: %v", err)
	}
	if _, err := s.UpdateBudget(ctx, mktLead("EMP-MHEAD"), c.ID, "7000000"); err != nil {
		t.Fatalf("lead-owner update: %v", err)
	}
}

func TestUpdateBudget_ValidationPermissionsAndAudit(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	cid := mustCampaign(t, s, "EMP-LIA")
	if _, err := s.CreateRecord(ctx, mktStaff("EMP-LIA"), cid, "5000000"); err != nil {
		t.Fatalf("create: %v", err)
	}

	// Invalid budget rejected.
	if _, err := s.UpdateBudget(ctx, mktStaff("EMP-LIA"), cid, "0"); !errors.Is(err, ErrIncomplete) {
		t.Fatalf("zero budget err=%v want ErrIncomplete", err)
	}
	// Non-owner / lead-over-staff / OD cannot edit.
	if _, err := s.UpdateBudget(ctx, mktLead("EMP-MHEAD"), cid, "9000000"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("lead edit-over-staff err=%v want ErrForbidden", err)
	}
	if _, err := s.UpdateBudget(ctx, od("EMP-OD"), cid, "9000000"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("OD edit err=%v want ErrForbidden", err)
	}
	// Owner edits -> new value + before->after audit row.
	rec, err := s.UpdateBudget(ctx, mktStaff("EMP-LIA"), cid, "9000000")
	if err != nil {
		t.Fatalf("owner update: %v", err)
	}
	if rec.Budget != "9000000.00" {
		t.Fatalf("budget=%q want 9000000.00", rec.Budget)
	}
	var before, after string
	if err := s.DB.QueryRowContext(ctx,
		`SELECT before_json, after_json FROM audit_log
		  WHERE entity_type='marketing_performance_record' AND entity_id=? AND action='budget_edited'`, cid).
		Scan(&before, &after); err != nil {
		t.Fatalf("budget_edited audit row missing: %v", err)
	}
}

// ---- Immutability: history rows are append-only (create + edit each append) ----

func TestAudit_AppendOnly(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	cid := mustCampaign(t, s, "EMP-LIA")
	if _, err := s.CreateRecord(ctx, mktStaff("EMP-LIA"), cid, "5000000"); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := s.UpdateBudget(ctx, mktStaff("EMP-LIA"), cid, "7000000"); err != nil {
		t.Fatalf("update: %v", err)
	}
	if _, err := s.UpdateBudget(ctx, mktStaff("EMP-LIA"), cid, "8000000"); err != nil {
		t.Fatalf("update2: %v", err)
	}
	var n int
	if err := s.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM audit_log WHERE entity_type='marketing_performance_record' AND entity_id=?`, cid).
		Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 3 { // 1 create + 2 edits, none overwritten
		t.Fatalf("audit rows=%d want 3 (append-only)", n)
	}
}

// ---- GetRecord visibility (M2 §5 read gate) ----

func TestGetRecord_Visibility(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	cid := mustCampaign(t, s, "EMP-LIA")
	if _, err := s.CreateRecord(ctx, mktStaff("EMP-LIA"), cid, "5000000"); err != nil {
		t.Fatalf("create: %v", err)
	}
	// Owner staff, lead, OD, Director may read.
	if _, err := s.GetRecord(ctx, mktStaff("EMP-LIA"), cid); err != nil {
		t.Fatalf("owner get: %v", err)
	}
	if _, err := s.GetRecord(ctx, mktLead("EMP-MHEAD"), cid); err != nil {
		t.Fatalf("lead get: %v", err)
	}
	if _, err := s.GetRecord(ctx, od("EMP-OD"), cid); err != nil {
		t.Fatalf("OD get: %v", err)
	}
	// Non-owner staff denied.
	if _, err := s.GetRecord(ctx, mktStaff("EMP-DINA"), cid); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-owner get err=%v want ErrForbidden", err)
	}
	// Visible campaign but no record -> ErrNotFound.
	empty := mustCampaign(t, s, "EMP-LIA")
	if _, err := s.GetRecord(ctx, mktStaff("EMP-LIA"), empty); !errors.Is(err, ErrNotFound) {
		t.Fatalf("no-record get err=%v want ErrNotFound", err)
	}
}
