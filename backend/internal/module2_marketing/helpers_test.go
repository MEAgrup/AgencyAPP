package module2_marketing

import (
	"database/sql"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module3_campaign"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

// ---- actor helpers (mirror module3_campaign) ----

func mktStaff(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: module3_campaign.MarketingDivision, Level: permission.LevelStaff}}
}
func mktLead(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: module3_campaign.MarketingDivision, Level: permission.LevelLead}}
}
func salesStaff(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: "Sales", Level: permission.LevelStaff}}
}
func od(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: "Management", Level: permission.LevelStaff, OD: true}}
}
func director(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: "Management", Level: permission.LevelStaff, Director: true}}
}

// newService builds the M2 service over a clean test DB with a small Marketing roster.
func newService(t *testing.T) (*Service, *module3_campaign.Service) {
	t.Helper()
	d := testutil.DB(t)
	testutil.Clean(t, d)
	testutil.InsertRoleMapping(t, d, "Marketing", "Marketing Staff", module3_campaign.MarketingDivision, permission.LevelStaff)
	testutil.InsertRoleMapping(t, d, "Marketing", "Marketing Head", module3_campaign.MarketingDivision, permission.LevelLead)
	testutil.InsertRoleMapping(t, d, "Sales", "Sales Executive", "Sales", permission.LevelStaff)
	testutil.InsertEmployee(t, d, "EMP-LIA", "Lia", "lia@mea.co.id", "Marketing", "Marketing Staff", true)
	testutil.InsertEmployee(t, d, "EMP-DINA", "Dina", "dina@mea.co.id", "Marketing", "Marketing Staff", true)
	testutil.InsertEmployee(t, d, "EMP-MHEAD", "Maya", "maya@mea.co.id", "Marketing", "Marketing Head", true)
	testutil.InsertEmployee(t, d, "EMP-SAL", "Sam", "sam@mea.co.id", "Sales", "Sales Executive", true)
	cmp := &module3_campaign.Service{DB: d, Engine: statemachine.New()}
	return &Service{DB: d, Campaign: cmp}, cmp
}

func validInput() module3_campaign.CampaignInput {
	return module3_campaign.CampaignInput{Name: "Promo Skilskul Maret", Channel: "TikTok Ads", Online: true, StartDate: "2026-03-02"}
}

// ---- linkage seed helpers ----

// seedLead inserts a lead with the given Origin and Last-Touch campaigns (empty -> NULL).
func seedLead(t *testing.T, d *sql.DB, id, phone, originCmp, lastTouchCmp string) {
	t.Helper()
	var oc, lt any
	if originCmp != "" {
		oc = originCmp
	}
	if lastTouchCmp != "" {
		lt = lastTouchCmp
	}
	if _, err := d.Exec(
		`INSERT INTO leads (id, lead_name, phone_number, phone_norm, source, origin_division,
		    origin_campaign_id, last_touch_campaign_id, record_status, created_by)
		 VALUES (?, ?, ?, ?, 'Leads - Iklan', 'Marketing', ?, ?, '[Pool]', 'EMP-LIA')`,
		id, "Lead "+id, phone, phone, oc, lt); err != nil {
		t.Fatalf("seed lead %s: %v", id, err)
	}
}

// seedAttemptReachedQualified inserts an attempt plus the exact audit row the metric reads
// to decide "reached >= Qualified" (transition INTO Qualified).
func seedAttemptReachedQualified(t *testing.T, d *sql.DB, id, leadID string, reached bool) {
	t.Helper()
	if _, err := d.Exec(
		`INSERT INTO prospect_attempts (id, lead_id, owner_employee_id, status, created_by)
		 VALUES (?, ?, 'EMP-SAL', 'Contacted', 'EMP-SAL')`, id, leadID); err != nil {
		t.Fatalf("seed attempt %s: %v", id, err)
	}
	action := "transition:New Lead->Contacted"
	if reached {
		action = "transition:Contacted->Qualified"
	}
	if _, err := d.Exec(
		`INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, created_by)
		 VALUES ('prospect_attempt', ?, 'EMP-SAL', ?, 'EMP-SAL')`, id, action); err != nil {
		t.Fatalf("seed attempt audit %s: %v", id, err)
	}
}

// seedNQReason inserts one Not-Qualified reason on an attempt (verbatim label).
func seedNQReason(t *testing.T, d *sql.DB, attemptID, reason string) {
	t.Helper()
	if _, err := d.Exec(
		`INSERT INTO prospect_attempt_nq_reasons (attempt_id, reason, created_by)
		 VALUES (?, ?, 'EMP-SAL')`, attemptID, reason); err != nil {
		t.Fatalf("seed nq reason: %v", err)
	}
}

// seedWonClient inserts a won Client (with lead + origin campaign + transaction) whose
// closing instant (client.created_at + the immutable "closing" audit row) is winAt.
func seedWonClient(t *testing.T, d *sql.DB, clientID, trxID, leadID, originCmp, totalDec string, winAt time.Time) {
	t.Helper()
	var oc any
	if originCmp != "" {
		oc = originCmp
	}
	if _, err := d.Exec(
		`INSERT INTO clients (id, lead_id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
		    origin_campaign_id, sales_pic_id, commission_payment_pic_id, transaction_id, created_at, created_by)
		 VALUES (?, ?, 'P', 'T', 'K', 'L', 'C', 0, 0, ?, 'EMP-SAL', 'EMP-SAL', ?, ?, 'EMP-SAL')`,
		clientID, leadID, oc, trxID, winAt); err != nil {
		t.Fatalf("seed client %s: %v", clientID, err)
	}
	if _, err := d.Exec(
		`INSERT INTO transactions (id, client_id, payment_intent_scheme, total_agreed_value, payment_status, created_by)
		 VALUES (?, ?, '[Bayar Penuh (Lunas)]', ?, '[Lunas]', 'EMP-SAL')`,
		trxID, clientID, totalDec); err != nil {
		t.Fatalf("seed trx %s: %v", trxID, err)
	}
	if _, err := d.Exec(
		`INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, created_at, created_by)
		 VALUES ('client', ?, 'EMP-SAL', 'closing', ?, 'EMP-SAL')`, clientID, winAt); err != nil {
		t.Fatalf("seed closing audit %s: %v", clientID, err)
	}
}

// seedDirectVerification inserts a direct (NULL installment) verified receipt — the
// verified-received basis for Collected-ROAS (mirrors finance direct verifications).
func seedDirectVerification(t *testing.T, d *sql.DB, trxID, amountDec string) {
	t.Helper()
	if _, err := d.Exec(
		`INSERT INTO payment_verifications (transaction_id, installment_id, amount, received_date, verified_by, created_by)
		 VALUES (?, NULL, ?, '2026-03-15', 'EMP-FIN', 'EMP-FIN')`, trxID, amountDec); err != nil {
		t.Fatalf("seed direct verification: %v", err)
	}
}

// seedVerifiedInstallment inserts a verified installment (status [Terverifikasi]) — the
// per-termin verified-received basis for Collected-ROAS.
func seedVerifiedInstallment(t *testing.T, d *sql.DB, instID, trxID string, no int, amountDec string) {
	t.Helper()
	if _, err := d.Exec(
		`INSERT INTO installments (id, transaction_id, installment_no, amount, due_date, status, created_by)
		 VALUES (?, ?, ?, ?, '2026-04-01', '[Terverifikasi]', 'EMP-FIN')`,
		instID, trxID, no, amountDec); err != nil {
		t.Fatalf("seed verified installment: %v", err)
	}
}
