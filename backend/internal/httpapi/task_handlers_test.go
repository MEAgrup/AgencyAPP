package httpapi_test

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/auth"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/httpapi"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

// tcAuth maps fixture emails (password "rahasia123") to employee ids for the
// Module 12 (Task Execution) + Module 7 (Creative) HTTP tests.
type tcAuth struct{}

func (tcAuth) Verify(_ context.Context, email, password string) (string, error) {
	if password != "rahasia123" {
		return "", auth.ErrInvalidCredentials
	}
	m := map[string]string{
		"budi@mea.co.id":  "EMP-BUDI",  // Sales staff (owns client; foreign division)
		"cakra@mea.co.id": "EMP-CAKRA", // Creative staff (PIC)
		"cindy@mea.co.id": "EMP-CINDY", // Creative staff (non-PIC)
		"clara@mea.co.id": "EMP-CLARA", // Creative lead
		"cdir@mea.co.id":  "EMP-CDIR",  // Creative staff + LAYERED director
		"amel@mea.co.id":  "EMP-AMEL",  // Account staff = owning AM
		"alia@mea.co.id":  "EMP-ALIA",  // Account lead (division-wide read)
		"adi@mea.co.id":   "EMP-ADI",   // Ads staff (PIC)
		"adi2@mea.co.id":  "EMP-ADI2",  // Ads staff (non-PIC)
		"adil@mea.co.id":  "EMP-ADIL",  // Ads lead
		"koko@mea.co.id":  "EMP-KOKO",  // KOL staff (Coordinator)
		"kiki@mea.co.id":  "EMP-KIKI",  // KOL staff (non-Coordinator)
		"kev@mea.co.id":   "EMP-KEV",   // KOL lead (Team Leader)
		"fina@mea.co.id":  "EMP-FINA",  // Finance staff
		"anin@mea.co.id":  "EMP-ANIN",  // Account staff = SECOND AM (non-owner)
		"odi@mea.co.id":   "EMP-ODI",   // OD (layered, read-only)
		"yohan@mea.co.id": "EMP-YOHAN", // Director (layered, full)
	}
	if id, ok := m[email]; ok {
		return id, nil
	}
	return "", auth.ErrInvalidCredentials
}

// setupTC builds an app + seeds the role mappings and employees the M12/M7
// endpoint tests share.
func setupTC(t *testing.T) (*httptest.Server, func()) {
	t.Helper()
	d := testutil.DB(t)
	testutil.Clean(t, d)
	testutil.InsertRoleMapping(t, d, "Sales", "Sales Executive", "Sales", "staff")
	testutil.InsertRoleMapping(t, d, "Creative", "Creative Designer", "Creative", "staff")
	testutil.InsertRoleMapping(t, d, "Creative", "Creative Lead", "Creative", "lead")
	testutil.InsertRoleMapping(t, d, "Account", "Account Manager", "Account", "staff")
	testutil.InsertRoleMapping(t, d, "Account", "Account Lead", "Account", "lead")
	testutil.InsertRoleMapping(t, d, "Ads", "Ads Executive", "Ads", "staff")
	testutil.InsertRoleMapping(t, d, "Ads", "Ads Lead", "Ads", "lead")
	testutil.InsertRoleMapping(t, d, "KOL", "KOL Coordinator", "KOL", "staff")
	testutil.InsertRoleMapping(t, d, "KOL", "KOL Lead", "KOL", "lead")
	testutil.InsertRoleMapping(t, d, "Finance", "Finance Staff", "Finance", "staff")

	testutil.InsertEmployee(t, d, "EMP-BUDI", "Budi", "budi@mea.co.id", "Sales", "Sales Executive", true)
	testutil.InsertEmployee(t, d, "EMP-CAKRA", "Cakra", "cakra@mea.co.id", "Creative", "Creative Designer", true)
	testutil.InsertEmployee(t, d, "EMP-CINDY", "Cindy", "cindy@mea.co.id", "Creative", "Creative Designer", true)
	testutil.InsertEmployee(t, d, "EMP-CLARA", "Clara", "clara@mea.co.id", "Creative", "Creative Lead", true)
	testutil.InsertEmployee(t, d, "EMP-CDIR", "Cedir", "cdir@mea.co.id", "Creative", "Creative Designer", true)
	testutil.InsertEmployee(t, d, "EMP-AMEL", "Amel", "amel@mea.co.id", "Account", "Account Manager", true)
	testutil.InsertEmployee(t, d, "EMP-ALIA", "Alia", "alia@mea.co.id", "Account", "Account Lead", true)
	testutil.InsertEmployee(t, d, "EMP-ADI", "Adi", "adi@mea.co.id", "Ads", "Ads Executive", true)
	testutil.InsertEmployee(t, d, "EMP-ADI2", "Adit", "adi2@mea.co.id", "Ads", "Ads Executive", true)
	testutil.InsertEmployee(t, d, "EMP-ADIL", "Adil", "adil@mea.co.id", "Ads", "Ads Lead", true)
	testutil.InsertEmployee(t, d, "EMP-KOKO", "Koko", "koko@mea.co.id", "KOL", "KOL Coordinator", true)
	testutil.InsertEmployee(t, d, "EMP-KIKI", "Kiki", "kiki@mea.co.id", "KOL", "KOL Coordinator", true)
	testutil.InsertEmployee(t, d, "EMP-KEV", "Kevin", "kev@mea.co.id", "KOL", "KOL Lead", true)
	testutil.InsertEmployee(t, d, "EMP-FINA", "Fina", "fina@mea.co.id", "Finance", "Finance Staff", true)
	testutil.InsertEmployee(t, d, "EMP-ANIN", "Anin", "anin@mea.co.id", "Account", "Account Manager", true)
	testutil.InsertEmployee(t, d, "EMP-ODI", "Odi", "odi@mea.co.id", "Management", "OD", true)
	testutil.InsertEmployee(t, d, "EMP-YOHAN", "Yohan", "yohan@mea.co.id", "Management", "Director", true)
	testutil.InsertLayeredRole(t, d, "EMP-ODI", "od")
	testutil.InsertLayeredRole(t, d, "EMP-YOHAN", "director")
	// One-account-two-roles layered case: a Creative STAFF who is ALSO Director.
	testutil.InsertLayeredRole(t, d, "EMP-CDIR", "director")

	app := httpapi.New(d, statemachine.New(), notification.NewCatalog(), tcAuth{}, nil)
	srv := httptest.NewServer(app.Router())
	return srv, srv.Close
}

// seedTCBrief inserts a released client (owned by AM EMP-AMEL), a [Briefed]
// service, and one Brief in [To Do] for the given division & quantity target.
func seedTCBrief(t *testing.T, clientID, svcID, briefID, division string, qty int) {
	t.Helper()
	d := testutil.DB(t)
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
		  total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
		 VALUES (?, 'PIC', ?, 'Kota', 'link', 'Fashion', '0.00', '0.00', '0.00', 'EMP-BUDI', 'EMP-BUDI', NOW(), 'EMP-AMEL', 'TEST')`,
		clientID, clientID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO services (id, client_id, master_service_id, master_version_no, name, standard_price, commission_rule, status, created_by)
		 VALUES (?, ?, 'MSV-01', 1, 'Jasa X', '5000000.00', '10% of standard price', '[Briefed]', 'TEST')`,
		svcID, clientID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO briefs (id, service_id, assigned_division, deliverable_type, quantity_target, due_date, priority, title, status, created_by)
		 VALUES (?, ?, ?, 'Product Video', ?, '2026-08-30', 'High', 'B', '[To Do]', 'TEST')`,
		briefID, svcID, division, qty); err != nil {
		t.Fatal(err)
	}
}

func briefStatusTC(t *testing.T, id string) string {
	t.Helper()
	var st string
	if err := testutil.DB(t).QueryRowContext(context.Background(),
		`SELECT status FROM briefs WHERE id = ?`, id).Scan(&st); err != nil {
		t.Fatal(err)
	}
	return st
}

// TestTaskBriefEndpoints exercises the Module 12 Brief-as-task HTTP surface
// (/api/v1/tasks/...) with per-role permission checks (incl. layered OD/Director),
// valid + invalid transitions with exact BI messages, and the §5.3a block queue.
func TestTaskBriefEndpoints(t *testing.T) {
	srv, done := setupTC(t)
	defer done()
	seedTCBrief(t, "CLI-AD", "SVC-AD", "BRF-AD", "Ads", 1)

	budi := login(t, srv, "budi@mea.co.id")   // Sales staff (foreign division)
	cakra := login(t, srv, "cakra@mea.co.id") // Creative staff (foreign)
	adi := login(t, srv, "adi@mea.co.id")     // Ads staff (becomes PIC)
	adi2 := login(t, srv, "adi2@mea.co.id")   // Ads staff (non-PIC)
	adil := login(t, srv, "adil@mea.co.id")   // Ads lead
	odi := login(t, srv, "odi@mea.co.id")     // OD (read-only)
	yohan := login(t, srv, "yohan@mea.co.id") // Director

	start := srv.URL + "/api/v1/tasks/BRF-AD"

	// --- StartTask (claim model, pre-PIC): foreign divisions + OD denied; Ads staff OK.
	if code, body := do(t, cakra, "POST", start+"/start", nil); code != 403 || body["message"] != "[anda tidak memiliki akses untuk mengerjakan task ini]" {
		t.Fatalf("creative start: %d %v", code, body)
	}
	if code, _ := do(t, budi, "POST", start+"/start", nil); code != 403 {
		t.Fatalf("sales start: %d want 403", code)
	}
	if code, _ := do(t, odi, "POST", start+"/start", nil); code != 403 {
		t.Fatalf("OD start: %d want 403 (read-only)", code)
	}
	if code, body := do(t, adi, "POST", start+"/start", nil); code != 200 {
		t.Fatalf("ads staff start: %d %v", code, body)
	}
	// The Brief left [To Do] -> parent Service advanced to [In Execution].
	if st := briefStatusTC(t, "BRF-AD"); st != "[In Progress]" {
		t.Fatalf("brief status after start = %s", st)
	}

	// --- AssignPIC (§5.3): staff/OD denied; invalid PIC 422; Ads lead assigns.
	if code, body := do(t, adi, "POST", start+"/assign-pic", map[string]any{"pic_id": "EMP-ADI"}); code != 403 || body["message"] != "[anda tidak memiliki akses untuk menugaskan PIC atau menetapkan SLA task ini]" {
		t.Fatalf("staff assign-pic: %d %v", code, body)
	}
	if code, body := do(t, adil, "POST", start+"/assign-pic", map[string]any{"pic_id": "EMP-BUDI"}); code != 422 || body["message"] != "[PIC tidak valid: harus staff divisi tujuan yang aktif]" {
		t.Fatalf("invalid pic: %d %v", code, body)
	}
	if code, _ := do(t, adil, "POST", start+"/assign-pic", map[string]any{"pic_id": "EMP-ADI"}); code != 200 {
		t.Fatalf("lead assign-pic: want 200")
	}

	// --- SetSLA (§5.3): 0 hours -> 422; lead sets a valid target.
	if code, body := do(t, adil, "POST", start+"/sla", map[string]any{"hours": 0}); code != 422 || body["message"] != "[target SLA harus lebih dari 0 jam]" {
		t.Fatalf("zero sla: %d %v", code, body)
	}
	if code, _ := do(t, adil, "POST", start+"/sla", map[string]any{"hours": 48}); code != 200 {
		t.Fatalf("lead set sla: want 200")
	}

	// --- Post-PIC lock: another Ads staff (not the PIC) cannot drive; the PIC can.
	if code, body := do(t, adi2, "POST", start+"/submit", nil); code != 403 || body["message"] != "[anda tidak memiliki akses untuk mengerjakan task ini]" {
		t.Fatalf("non-PIC submit: %d %v", code, body)
	}
	if code, _ := do(t, adi, "POST", start+"/submit", nil); code != 200 {
		t.Fatalf("PIC submit: want 200")
	}

	// --- Invalid transition: Rework needs [Revision Requested]; brief is [Submitted].
	if code, body := do(t, adi, "POST", start+"/rework", nil); code != 422 || body["message"] != "[transisi status tidak diizinkan]" {
		t.Fatalf("invalid rework: %d %v", code, body)
	}

	// --- Metrics read gate: PIC/OD see it; a foreign division does not.
	if code, _ := do(t, adi, "GET", start+"/metrics", nil); code != 200 {
		t.Fatalf("PIC metrics: want 200")
	}
	if code, _ := do(t, odi, "GET", start+"/metrics", nil); code != 200 {
		t.Fatalf("OD metrics: want 200 (read-all)")
	}
	if code, body := do(t, cakra, "GET", start+"/metrics", nil); code != 403 || body["message"] != "[anda tidak memiliki akses ke task ini]" {
		t.Fatalf("foreign metrics: %d %v", code, body)
	}
	// Not-found task.
	if code, body := do(t, adi, "GET", srv.URL+"/api/v1/tasks/BRF-NONE/metrics", nil); code != 404 || body["message"] != "[task tidak ditemukan]" {
		t.Fatalf("missing task metrics: %d %v", code, body)
	}

	// --- Block queue (§5.3a) on a fresh Ads brief.
	seedTCBrief(t, "CLI-AD2", "SVC-AD2", "BRF-AD2", "Ads", 1)
	b2 := srv.URL + "/api/v1/tasks/BRF-AD2"
	if code, _ := do(t, adi, "POST", b2+"/start", nil); code != 200 {
		t.Fatalf("start BRF-AD2: want 200")
	}
	// Foreign division cannot request a block; empty reason -> 422.
	if code, body := do(t, budi, "POST", b2+"/block-request", map[string]any{"reason": "x"}); code != 403 || body["message"] != "[anda tidak memiliki akses untuk mengajukan permintaan block task ini]" {
		t.Fatalf("foreign block-request: %d %v", code, body)
	}
	if code, body := do(t, adi, "POST", b2+"/block-request", map[string]any{"reason": ""}); code != 422 || body["message"] != "[alasan permintaan block wajib diisi]" {
		t.Fatalf("empty block reason: %d %v", code, body)
	}
	code, body := do(t, adi, "POST", b2+"/block-request", map[string]any{"reason": "menunggu aset klien"})
	if code != 200 {
		t.Fatalf("block-request: %d %v", code, body)
	}
	reqID := body["id"].(string)
	// Staff cannot decide; lead approves -> engine drives [In Progress] -> [Blocked].
	if code, body := do(t, adi, "POST", b2+"/block-requests/"+reqID+"/approve", nil); code != 403 || body["message"] != "[anda tidak memiliki akses untuk memutuskan permintaan block]" {
		t.Fatalf("staff approve block: %d %v", code, body)
	}
	if code, _ := do(t, adil, "POST", b2+"/block-requests/"+reqID+"/approve", nil); code != 200 {
		t.Fatalf("lead approve block: want 200")
	}
	if st := briefStatusTC(t, "BRF-AD2"); st != "[Blocked]" {
		t.Fatalf("brief status after approve = %s want [Blocked]", st)
	}
	// Resume: staff denied; Director (layered) allowed.
	if code, _ := do(t, adi, "POST", b2+"/resume", nil); code != 403 {
		t.Fatalf("staff resume: want 403")
	}
	if code, _ := do(t, yohan, "POST", b2+"/resume", nil); code != 200 {
		t.Fatalf("director resume: want 200")
	}
	if st := briefStatusTC(t, "BRF-AD2"); st != "[In Progress]" {
		t.Fatalf("brief status after resume = %s want [In Progress]", st)
	}
}
