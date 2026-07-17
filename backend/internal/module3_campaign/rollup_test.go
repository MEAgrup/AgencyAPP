package module3_campaign

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/money"
)

// seedLead inserts a lead record with a given origin campaign (NULL when empty).
func seedLead(t *testing.T, d *sql.DB, id, phone, originCmp string) {
	t.Helper()
	var oc any
	if originCmp != "" {
		oc = originCmp
	}
	if _, err := d.Exec(
		`INSERT INTO leads (id, lead_name, phone_number, phone_norm, source, origin_division, origin_campaign_id, record_status, created_by)
		 VALUES (?, ?, ?, ?, ?, 'Marketing', ?, '[Pool]', 'EMP-LIA')`,
		id, "Lead "+id, phone, phone, "Leads - Iklan", oc); err != nil {
		t.Fatalf("seed lead %s: %v", id, err)
	}
}

// seedAttemptReachedQualified inserts an attempt on leadID plus the exact audit
// row the rollup reads to decide "reached >= Qualified" (transition INTO Qualified).
func seedAttemptReachedQualified(t *testing.T, d *sql.DB, id, leadID string, reached bool) {
	t.Helper()
	if _, err := d.Exec(
		`INSERT INTO prospect_attempts (id, lead_id, owner_employee_id, status, created_by)
		 VALUES (?, ?, 'EMP-SAL', ?, 'EMP-SAL')`,
		id, leadID, "Contacted"); err != nil {
		t.Fatalf("seed attempt %s: %v", id, err)
	}
	action := "transition:New Lead->Contacted"
	if reached {
		action = "transition:Contacted->Qualified"
	}
	if _, err := d.Exec(
		`INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, created_by)
		 VALUES ('prospect_attempt', ?, 'EMP-SAL', ?, 'EMP-SAL')`,
		id, action); err != nil {
		t.Fatalf("seed audit %s: %v", id, err)
	}
}

// seedWonClient inserts a Client (origin campaign) + its combined Transaction.
func seedWonClient(t *testing.T, d *sql.DB, clientID, trxID, originCmp, totalDecimal string) {
	t.Helper()
	var oc any
	if originCmp != "" {
		oc = originCmp
	}
	if _, err := d.Exec(
		`INSERT INTO clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
		    origin_campaign_id, sales_pic_id, commission_payment_pic_id, transaction_id, created_by)
		 VALUES (?, 'P', 'T', 'K', 'L', 'C', 0, 0, ?, 'EMP-SAL', 'EMP-SAL', ?, 'EMP-SAL')`,
		clientID, oc, trxID); err != nil {
		t.Fatalf("seed client %s: %v", clientID, err)
	}
	if _, err := d.Exec(
		`INSERT INTO transactions (id, client_id, payment_intent_scheme, total_agreed_value, payment_status, created_by)
		 VALUES (?, ?, '[Bayar Penuh (Lunas)]', ?, '[Lunas]', 'EMP-SAL')`,
		trxID, clientID, totalDecimal); err != nil {
		t.Fatalf("seed trx %s: %v", trxID, err)
	}
}

// TestRollup_RecomputeFromFixture builds a known linkage fixture and asserts the
// four derived rollups (M3 §4 Rule 4 / §6.3) equal the hand-counted numbers:
// leads generated, real leads (>= Qualified via the audit log), clients won, and
// total value won (IDR). Rows belonging to a DIFFERENT campaign must not leak in.
func TestRollup_RecomputeFromFixture(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	d := s.DB

	// The campaign under test (Active) + an unrelated campaign whose rows must be excluded.
	cmp, err := s.Create(ctx, mktStaff("EMP-LIA"), validInput())
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := s.Transition(ctx, mktStaff("EMP-LIA"), cmp.ID, StatusActive); err != nil {
		t.Fatalf("activate: %v", err)
	}
	other, err := s.Create(ctx, mktStaff("EMP-LIA"), validInput())
	if err != nil {
		t.Fatalf("Create other: %v", err)
	}

	// 3 leads on cmp (L1 reached Qualified, L2 only Contacted, L3 pure Pool) + 1 on `other`.
	seedLead(t, d, "LEAD-1", "0811000001", cmp.ID)
	seedLead(t, d, "LEAD-2", "0811000002", cmp.ID)
	seedLead(t, d, "LEAD-3", "0811000003", cmp.ID)
	seedLead(t, d, "LEAD-X", "0811000009", other.ID)
	seedAttemptReachedQualified(t, d, "PRSP-1", "LEAD-1", true)
	seedAttemptReachedQualified(t, d, "PRSP-2", "LEAD-2", false)
	seedAttemptReachedQualified(t, d, "PRSP-X", "LEAD-X", true) // real, but on the other campaign

	// 2 won clients on cmp (Rp 21.900.000 + Rp 5.000.000) + 1 on `other`.
	seedWonClient(t, d, "CLI-1", "TRX-1", cmp.ID, "21900000.00")
	seedWonClient(t, d, "CLI-2", "TRX-2", cmp.ID, "5000000.00")
	seedWonClient(t, d, "CLI-X", "TRX-X", other.ID, "9999999.00")

	roll, err := s.Rollup(ctx, mktStaff("EMP-LIA"), cmp.ID)
	if err != nil {
		t.Fatalf("Rollup: %v", err)
	}
	if roll.LeadsGenerated != 3 {
		t.Errorf("leads_generated = %d, want 3", roll.LeadsGenerated)
	}
	if roll.RealLeads != 1 {
		t.Errorf("real_leads = %d, want 1", roll.RealLeads)
	}
	if roll.ClientsWon != 2 {
		t.Errorf("clients_won = %d, want 2", roll.ClientsWon)
	}
	if roll.TotalValueWon != "26900000.00" {
		t.Errorf("total_value_won = %q, want 26900000.00", roll.TotalValueWon)
	}
	wantIDR := money.Money(2690000000).Format()
	if roll.TotalValueWonIDR != wantIDR {
		t.Errorf("total_value_won_idr = %q, want %q", roll.TotalValueWonIDR, wantIDR)
	}
}

// TestRollup_EmptyCampaign: a campaign with no linkage rolls up to zeros and a
// Rp. 0,00 total (SUM over no rows is COALESCEd to 0, never an error).
func TestRollup_EmptyCampaign(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	cmp, err := s.Create(ctx, mktStaff("EMP-LIA"), validInput())
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	roll, err := s.Rollup(ctx, mktStaff("EMP-LIA"), cmp.ID)
	if err != nil {
		t.Fatalf("Rollup: %v", err)
	}
	if roll.LeadsGenerated != 0 || roll.RealLeads != 0 || roll.ClientsWon != 0 || roll.TotalValueWon != "0.00" {
		t.Fatalf("empty rollup = %+v, want all zero", roll)
	}
}

// TestRollup_Visibility: the §5 read gate is reused — a Marketing staff who does
// not own the campaign gets ErrForbidden; a missing campaign is ErrNotFound; OD
// (read-everywhere) may read it.
func TestRollup_Visibility(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	cmp, err := s.Create(ctx, mktStaff("EMP-LIA"), validInput())
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := s.Rollup(ctx, mktStaff("EMP-DINA"), cmp.ID); !errors.Is(err, ErrForbidden) {
		t.Errorf("non-owner staff err=%v want ErrForbidden", err)
	}
	if _, err := s.Rollup(ctx, mktStaff("EMP-LIA"), "CMP-999999-9999"); !errors.Is(err, ErrNotFound) {
		t.Errorf("missing campaign err=%v want ErrNotFound", err)
	}
	if _, err := s.Rollup(ctx, od("EMP-OD"), cmp.ID); err != nil {
		t.Errorf("OD read err=%v want nil", err)
	}
}
