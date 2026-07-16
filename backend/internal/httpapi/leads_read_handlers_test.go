package httpapi_test

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/auth"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/httpapi"
	"github.com/meagrup/agencyapp/backend/internal/module1_leads"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

// leadsAuth maps Sales-Workspace fixture emails (password "rahasia123") to ids.
type leadsAuth struct{}

func (leadsAuth) Verify(_ context.Context, email, password string) (string, error) {
	if password != "rahasia123" {
		return "", auth.ErrInvalidCredentials
	}
	m := map[string]string{
		"ss1@mea.co.id":  "EMP-SS1",  // Sales staff (owns attempts)
		"ss2@mea.co.id":  "EMP-SS2",  // Sales staff (other)
		"sl@mea.co.id":   "EMP-SL",   // Sales lead
		"mk@mea.co.id":   "EMP-MK",   // Marketing staff
		"ac@mea.co.id":   "EMP-AC",   // Account staff (cross-division)
		"od@mea.co.id":   "EMP-OD",   // OD (layered)
		"dir@mea.co.id":  "EMP-DIR",  // Director (layered)
		"ssod@mea.co.id": "EMP-SSOD", // Sales staff + OD (layered)
	}
	if id, ok := m[email]; ok {
		return id, nil
	}
	return "", auth.ErrInvalidCredentials
}

func setupLeads(t *testing.T) (*httptest.Server, func()) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	testutil.InsertRoleMapping(t, d, "Sales", "Sales Executive", "Sales", "staff")
	testutil.InsertRoleMapping(t, d, "Sales", "Sales Head", "Sales", "lead")
	testutil.InsertRoleMapping(t, d, "Marketing", "Marketing Executive", "Marketing", "staff")
	testutil.InsertRoleMapping(t, d, "Account", "Account Manager", "Account", "staff")
	testutil.InsertEmployee(t, d, "EMP-SS1", "Andi", "ss1@mea.co.id", "Sales", "Sales Executive", true)
	testutil.InsertEmployee(t, d, "EMP-SS2", "Bara", "ss2@mea.co.id", "Sales", "Sales Executive", true)
	testutil.InsertEmployee(t, d, "EMP-SL", "Sari", "sl@mea.co.id", "Sales", "Sales Head", true)
	testutil.InsertEmployee(t, d, "EMP-MK", "Maya", "mk@mea.co.id", "Marketing", "Marketing Executive", true)
	testutil.InsertEmployee(t, d, "EMP-AC", "Agus", "ac@mea.co.id", "Account", "Account Manager", true)
	testutil.InsertEmployee(t, d, "EMP-OD", "Odi", "od@mea.co.id", "Management", "OD", true)
	testutil.InsertEmployee(t, d, "EMP-DIR", "Dira", "dir@mea.co.id", "Management", "Director", true)
	testutil.InsertEmployee(t, d, "EMP-SSOD", "Sasa", "ssod@mea.co.id", "Sales", "Sales Executive", true)
	testutil.InsertLayeredRole(t, d, "EMP-OD", "od")
	testutil.InsertLayeredRole(t, d, "EMP-DIR", "director")
	testutil.InsertLayeredRole(t, d, "EMP-SSOD", "od")

	app := httpapi.New(d, statemachine.New(), notification.NewCatalog(), leadsAuth{}, nil)
	srv := httptest.NewServer(app.Router())
	return srv, srv.Close
}

func seedLead(t *testing.T, id, name, phone, status string) {
	t.Helper()
	d := testutil.DB(t)
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO leads (id, lead_name, phone_number, phone_norm, source, origin_division, record_status, created_by)
		 VALUES (?, ?, ?, ?, 'Scouting', 'Sales', ?, 'TEST')`,
		id, name, phone, module1_leads.NormalizePhone(phone), status); err != nil {
		t.Fatal(err)
	}
}

func setLeadCreatedAt(t *testing.T, id, expr string) {
	t.Helper()
	d := testutil.DB(t)
	if _, err := d.ExecContext(context.Background(),
		`UPDATE leads SET created_at = `+expr+` WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
}

func seedAttempt(t *testing.T, id, leadID, owner, status string) {
	t.Helper()
	d := testutil.DB(t)
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO prospect_attempts (id, lead_id, owner_employee_id, status, created_by)
		 VALUES (?, ?, ?, ?, 'TEST')`, id, leadID, owner, status); err != nil {
		t.Fatal(err)
	}
}

func setAttemptCreatedAt(t *testing.T, id, expr string) {
	t.Helper()
	d := testutil.DB(t)
	if _, err := d.ExecContext(context.Background(),
		`UPDATE prospect_attempts SET created_at = `+expr+` WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
}

// seedPoolTransitionAudit appends an audit_log transition INTO [Pool] at a chosen
// time — the DERIVED stale signal (M1-OA-7) reads the latest such row.
func seedPoolTransitionAudit(t *testing.T, leadID, atExpr string) {
	t.Helper()
	d := testutil.DB(t)
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, created_at, created_by)
		 VALUES ('lead', ?, 'TEST', 'transition:[Rejected]->[Pool]', `+atExpr+`, 'TEST')`, leadID); err != nil {
		t.Fatal(err)
	}
}

func leadsByID(body map[string]any) map[string]map[string]any {
	out := map[string]map[string]any{}
	arr, _ := body["leads"].([]any)
	for _, it := range arr {
		m, _ := it.(map[string]any)
		if id, ok := m["id"].(string); ok {
			out[id] = m
		}
	}
	return out
}

// TestLeadsList_Visibility exercises the per-role view matrix for GET /leads.
func TestLeadsList_Visibility(t *testing.T) {
	srv, done := setupLeads(t)
	defer done()

	seedLead(t, "LEAD-P1", "Pool One", "0811-0001", "[Pool]")
	seedLead(t, "LEAD-P2", "Pool Two", "0811-0002", "[Pool]")
	seedLead(t, "LEAD-A1", "Active One", "0811-0003", "active")
	seedAttempt(t, "PRSP-A1", "LEAD-A1", "EMP-SS1", "Contacted")
	seedLead(t, "LEAD-A2", "Active Two", "0811-0004", "active")
	seedAttempt(t, "PRSP-A2", "LEAD-A2", "EMP-SS2", "Contacted")

	ss1 := login(t, srv, "ss1@mea.co.id")
	// Sales staff: pool -> both pool leads.
	code, body := do(t, ss1, "GET", srv.URL+"/api/v1/leads?view=pool", nil)
	if code != 200 || len(leadsByID(body)) != 2 {
		t.Fatalf("ss1 pool: %d %v", code, body)
	}
	// Sales staff: mine -> only the lead they have an attempt on.
	code, body = do(t, ss1, "GET", srv.URL+"/api/v1/leads?view=mine", nil)
	mine := leadsByID(body)
	if code != 200 || len(mine) != 1 || mine["LEAD-A1"] == nil {
		t.Fatalf("ss1 mine: %d %v", code, body)
	}
	// Sales staff: all -> denied with the exact BI constant.
	code, body = do(t, ss1, "GET", srv.URL+"/api/v1/leads?view=all", nil)
	if code != 403 || body["message"] != "[anda tidak memiliki akses ke data ini]" {
		t.Fatalf("ss1 all: %d %v want 403 read-denial string", code, body)
	}
	// Default view (no param) = pool.
	code, body = do(t, ss1, "GET", srv.URL+"/api/v1/leads", nil)
	if code != 200 || len(leadsByID(body)) != 2 {
		t.Fatalf("ss1 default view: %d %v", code, body)
	}

	// Sales lead: all -> every lead (division-wide).
	sl := login(t, srv, "sl@mea.co.id")
	code, body = do(t, sl, "GET", srv.URL+"/api/v1/leads?view=all", nil)
	if code != 200 || len(leadsByID(body)) != 4 {
		t.Fatalf("sl all: %d %v want 4", code, body)
	}

	// Marketing staff: all + pool read-only; mine empty (no attempts).
	mk := login(t, srv, "mk@mea.co.id")
	code, body = do(t, mk, "GET", srv.URL+"/api/v1/leads?view=all", nil)
	if code != 200 || len(leadsByID(body)) != 4 {
		t.Fatalf("mk all: %d %v", code, body)
	}
	code, body = do(t, mk, "GET", srv.URL+"/api/v1/leads?view=mine", nil)
	if code != 200 || len(leadsByID(body)) != 0 {
		t.Fatalf("mk mine: %d %v want empty", code, body)
	}

	// OD (read) and Director see all.
	od := login(t, srv, "od@mea.co.id")
	if code, body = do(t, od, "GET", srv.URL+"/api/v1/leads?view=all", nil); code != 200 || len(leadsByID(body)) != 4 {
		t.Fatalf("od all: %d %v", code, body)
	}
	dir := login(t, srv, "dir@mea.co.id")
	if code, body = do(t, dir, "GET", srv.URL+"/api/v1/leads?view=all", nil); code != 200 || len(leadsByID(body)) != 4 {
		t.Fatalf("dir all: %d %v", code, body)
	}

	// Cross-division (Account staff): no lead access at all.
	ac := login(t, srv, "ac@mea.co.id")
	if code, body = do(t, ac, "GET", srv.URL+"/api/v1/leads?view=pool", nil); code != 403 {
		t.Fatalf("ac pool: %d %v want 403", code, body)
	}

	// Layered Sales staff + OD: OD read scope wins -> all view allowed.
	ssod := login(t, srv, "ssod@mea.co.id")
	if code, body = do(t, ssod, "GET", srv.URL+"/api/v1/leads?view=all", nil); code != 200 || len(leadsByID(body)) != 4 {
		t.Fatalf("ssod all (OD read scope): %d %v", code, body)
	}
}

// TestLeadsList_SearchAndShape checks the q filter and the pinned JSON shape.
func TestLeadsList_SearchAndShape(t *testing.T) {
	srv, done := setupLeads(t)
	defer done()
	seedLead(t, "LEAD-Q1", "Sinar Jaya", "0812-7777", "[Pool]")
	seedLead(t, "LEAD-Q2", "Toko Makmur", "0813-8888", "[Pool]")

	ss1 := login(t, srv, "ss1@mea.co.id")
	// Name substring.
	code, body := do(t, ss1, "GET", srv.URL+"/api/v1/leads?view=pool&q=Sinar", nil)
	if got := leadsByID(body); code != 200 || len(got) != 1 || got["LEAD-Q1"] == nil {
		t.Fatalf("q=name: %d %v", code, body)
	}
	// Phone (normalized): "+62 813 8888" -> 8138888 == phone_norm of 0813-8888.
	code, body = do(t, ss1, "GET", srv.URL+"/api/v1/leads?view=pool&q=%2B62%20813%208888", nil)
	if got := leadsByID(body); code != 200 || len(got) != 1 || got["LEAD-Q2"] == nil {
		t.Fatalf("q=phone: %d %v", code, body)
	}

	// Pinned shape assertions on a single record.
	code, body = do(t, ss1, "GET", srv.URL+"/api/v1/leads?view=pool&q=Sinar", nil)
	if code != 200 {
		t.Fatalf("shape fetch: %d", code)
	}
	rec := leadsByID(body)["LEAD-Q1"]
	for _, k := range []string{"id", "lead_name", "phone_number", "source", "record_status",
		"origin_division", "manual_review_flag", "stale", "active_owners", "winning_attempt_id", "created_at"} {
		if _, ok := rec[k]; !ok {
			t.Errorf("missing pinned field %q in %v", k, rec)
		}
	}
	if rec["winning_attempt_id"] != nil {
		t.Errorf("winning_attempt_id should be null, got %v", rec["winning_attempt_id"])
	}
	if owners, ok := rec["active_owners"].([]any); !ok || len(owners) != 0 {
		t.Errorf("active_owners should be empty array, got %v", rec["active_owners"])
	}
}

// TestLeadDetail_Visibility covers GET /leads/{id} entitlement + 404.
func TestLeadDetail_Visibility(t *testing.T) {
	srv, done := setupLeads(t)
	defer done()
	seedLead(t, "LEAD-P1", "Pool One", "0811-0001", "[Pool]")
	seedLead(t, "LEAD-A1", "Active One", "0811-0003", "active")
	seedAttempt(t, "PRSP-A1", "LEAD-A1", "EMP-SS1", "Contacted")
	seedLead(t, "LEAD-A2", "Active Two", "0811-0004", "active")
	seedAttempt(t, "PRSP-A2", "LEAD-A2", "EMP-SS2", "Contacted")

	ss1 := login(t, srv, "ss1@mea.co.id")
	ss2 := login(t, srv, "ss2@mea.co.id")

	// Sales staff sees a [Pool] lead.
	if code, _ := do(t, ss1, "GET", srv.URL+"/api/v1/leads/LEAD-P1", nil); code != 200 {
		t.Fatalf("ss1 pool detail: %d", code)
	}
	// Sales staff sees a lead they own an attempt on.
	code, body := do(t, ss1, "GET", srv.URL+"/api/v1/leads/LEAD-A1", nil)
	if code != 200 {
		t.Fatalf("ss1 own detail: %d %v", code, body)
	}
	if _, ok := body["lead"].(map[string]any); !ok {
		t.Fatalf("detail missing lead: %v", body)
	}
	if _, ok := body["attempts"].([]any); !ok {
		t.Fatalf("detail missing attempts: %v", body)
	}
	// Sales staff denied a non-pool lead they don't own.
	if code, _ := do(t, ss1, "GET", srv.URL+"/api/v1/leads/LEAD-A2", nil); code != 403 {
		t.Fatalf("ss1 other active detail: %d want 403", code)
	}
	// Other sales staff denied SS1's active lead.
	if code, _ := do(t, ss2, "GET", srv.URL+"/api/v1/leads/LEAD-A1", nil); code != 403 {
		t.Fatalf("ss2 cross-owner detail: %d want 403", code)
	}
	// Sales lead, Marketing, OD, Director all allowed.
	for _, e := range []string{"sl@mea.co.id", "mk@mea.co.id", "od@mea.co.id", "dir@mea.co.id"} {
		c := login(t, srv, e)
		if code, _ := do(t, c, "GET", srv.URL+"/api/v1/leads/LEAD-A1", nil); code != 200 {
			t.Fatalf("%s detail: %d want 200", e, code)
		}
	}
	// Account (cross-division) denied.
	ac := login(t, srv, "ac@mea.co.id")
	if code, _ := do(t, ac, "GET", srv.URL+"/api/v1/leads/LEAD-A1", nil); code != 403 {
		t.Fatalf("ac detail: %d want 403", code)
	}
	// Missing lead -> 404 exact message.
	code, body = do(t, ss1, "GET", srv.URL+"/api/v1/leads/LEAD-NONE", nil)
	if code != 404 || body["message"] != "[data tidak ditemukan]" {
		t.Fatalf("missing lead: %d %v", code, body)
	}
}

// TestMyAttempts_OrderingAndScope checks the worklist ordering + own-data scope.
func TestMyAttempts_OrderingAndScope(t *testing.T) {
	srv, done := setupLeads(t)
	defer done()
	seedLead(t, "LEAD-M1", "Lead M1", "0810-1", "active")
	seedLead(t, "LEAD-M2", "Lead M2", "0810-2", "active")
	// Terminal attempt is the most recent; a non-terminal one is older.
	seedAttempt(t, "PRSP-T1", "LEAD-M1", "EMP-SS1", "Closed-Success")
	setAttemptCreatedAt(t, "PRSP-T1", "NOW()")
	seedAttempt(t, "PRSP-T2", "LEAD-M2", "EMP-SS1", "Contacted")
	setAttemptCreatedAt(t, "PRSP-T2", "NOW() - INTERVAL 1 HOUR")

	ss1 := login(t, srv, "ss1@mea.co.id")
	code, body := do(t, ss1, "GET", srv.URL+"/api/v1/my/attempts", nil)
	if code != 200 {
		t.Fatalf("my attempts: %d %v", code, body)
	}
	arr, _ := body["attempts"].([]any)
	if len(arr) != 2 {
		t.Fatalf("attempts len = %d want 2", len(arr))
	}
	first := arr[0].(map[string]any)
	if first["id"] != "PRSP-T2" {
		t.Errorf("non-terminal should sort first, got %v", first["id"])
	}
	// OD sees only their own attempts (none).
	od := login(t, srv, "od@mea.co.id")
	code, body = do(t, od, "GET", srv.URL+"/api/v1/my/attempts", nil)
	if code != 200 || len(body["attempts"].([]any)) != 0 {
		t.Fatalf("od my attempts: %d %v want empty", code, body)
	}
}

func seedQualifiedForm(t *testing.T, attemptID, leadID string) {
	t.Helper()
	d := testutil.DB(t)
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO qualified_forms
		   (attempt_id, lead_id, nama_pic, toko, kota, link_toko, kategori,
		    gmv_baseline, target_gmv, marketing_budget, platform, store_link, created_by)
		 VALUES (?, ?, 'PIC', 'Toko', 'Kota', 'link', 'Fashion',
		    '10000000.00', '20000000.00', '5000000.00', 'TikTok', 'store', 'TEST')`,
		attemptID, leadID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO qualified_form_services
		   (attempt_id, master_service_id, master_version_no, name, standard_price, commission_rule, created_by)
		 VALUES (?, 'MSV-01', 1, 'Jasa Ads', '3000000.00', '10% of standard price', 'TEST')`,
		attemptID); err != nil {
		t.Fatal(err)
	}
}

func seedNegotiation(t *testing.T, propID, attemptID string) {
	t.Helper()
	d := testutil.DB(t)
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO negotiation_proposals (id, attempt_id, version_no, proposed_by, created_by)
		 VALUES (?, ?, 1, 'EMP-SS1', 'TEST')`, propID, attemptID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO negotiation_proposal_lines
		   (proposal_id, master_service_id, proposed_price, commission_rule, payment_terms, created_by)
		 VALUES (?, 'MSV-01', '2500000.00', '10% of standard price', 'Termin 2x', 'TEST')`,
		propID); err != nil {
		t.Fatal(err)
	}
}

// TestAttemptDetail_VisibilityAndMoney covers GET /attempts/{id} entitlement,
// 404, and the raw + `*_idr` money projection.
func TestAttemptDetail_VisibilityAndMoney(t *testing.T) {
	srv, done := setupLeads(t)
	defer done()
	seedLead(t, "LEAD-A1", "Active One", "0811-0003", "active")
	seedAttempt(t, "PRSP-A1", "LEAD-A1", "EMP-SS1", "Qualified")
	seedQualifiedForm(t, "PRSP-A1", "LEAD-A1")
	seedNegotiation(t, "NEG-1", "PRSP-A1")

	ss1 := login(t, srv, "ss1@mea.co.id")
	code, body := do(t, ss1, "GET", srv.URL+"/api/v1/attempts/PRSP-A1", nil)
	if code != 200 {
		t.Fatalf("owner attempt detail: %d %v", code, body)
	}
	qf := body["qualified_form"].(map[string]any)
	if qf["gmv_baseline"] != "10000000.00" || qf["gmv_baseline_idr"] != "Rp. 10.000.000,00" {
		t.Errorf("gmv_baseline pair = %v / %v", qf["gmv_baseline"], qf["gmv_baseline_idr"])
	}
	if qf["marketing_budget_idr"] != "Rp. 5.000.000,00" {
		t.Errorf("marketing_budget_idr = %v", qf["marketing_budget_idr"])
	}
	svc := qf["services"].([]any)[0].(map[string]any)
	if svc["standard_price_idr"] != "Rp. 3.000.000,00" {
		t.Errorf("standard_price_idr = %v", svc["standard_price_idr"])
	}
	neg := body["negotiation"].(map[string]any)
	line := neg["versions"].([]any)[0].(map[string]any)["lines"].([]any)[0].(map[string]any)
	if line["proposed_price"] != "2500000.00" || line["proposed_price_idr"] != "Rp. 2.500.000,00" {
		t.Errorf("proposed_price pair = %v / %v", line["proposed_price"], line["proposed_price_idr"])
	}

	// Non-owner Sales staff denied; Sales lead / OD / Director allowed; Marketing
	// + Account denied.
	ss2 := login(t, srv, "ss2@mea.co.id")
	if code, _ := do(t, ss2, "GET", srv.URL+"/api/v1/attempts/PRSP-A1", nil); code != 403 {
		t.Fatalf("ss2 attempt: %d want 403", code)
	}
	for _, e := range []string{"sl@mea.co.id", "od@mea.co.id", "dir@mea.co.id"} {
		c := login(t, srv, e)
		if code, _ := do(t, c, "GET", srv.URL+"/api/v1/attempts/PRSP-A1", nil); code != 200 {
			t.Fatalf("%s attempt: %d want 200", e, code)
		}
	}
	mk := login(t, srv, "mk@mea.co.id")
	if code, _ := do(t, mk, "GET", srv.URL+"/api/v1/attempts/PRSP-A1", nil); code != 403 {
		t.Fatalf("marketing attempt: %d want 403 (internal sales)", code)
	}
	ac := login(t, srv, "ac@mea.co.id")
	if code, _ := do(t, ac, "GET", srv.URL+"/api/v1/attempts/PRSP-A1", nil); code != 403 {
		t.Fatalf("account attempt: %d want 403", code)
	}
	// Missing attempt -> 404.
	code, body = do(t, ss1, "GET", srv.URL+"/api/v1/attempts/PRSP-NONE", nil)
	if code != 404 || body["message"] != "[data tidak ditemukan]" {
		t.Fatalf("missing attempt: %d %v", code, body)
	}

	// A New Lead attempt with no qualified form / negotiation renders nulls.
	seedLead(t, "LEAD-N", "Nadaan", "0811-9", "active")
	seedAttempt(t, "PRSP-N", "LEAD-N", "EMP-SS1", "New Lead")
	code, body = do(t, ss1, "GET", srv.URL+"/api/v1/attempts/PRSP-N", nil)
	if code != 200 || body["qualified_form"] != nil || body["negotiation"] != nil {
		t.Fatalf("bare attempt: %d %v want null form/negotiation", code, body)
	}
}

// TestPoolStale_Boundary drives the DERIVED stale signal across the 24h line,
// including the audit-transition-vs-created_at fallback (M1-OA-7, house §3/§4).
func TestPoolStale_Boundary(t *testing.T) {
	srv, done := setupLeads(t)
	defer done()

	// Born in Pool, aged past 24h, no transition row -> fallback created_at -> stale.
	seedLead(t, "LEAD-OLD", "Old Pool", "0819-1", "[Pool]")
	setLeadCreatedAt(t, "LEAD-OLD", "NOW() - INTERVAL 25 HOUR")
	// Fresh pool lead (1h) -> not stale.
	seedLead(t, "LEAD-FRESH", "Fresh Pool", "0819-2", "[Pool]")
	setLeadCreatedAt(t, "LEAD-FRESH", "NOW() - INTERVAL 1 HOUR")
	// Old created_at BUT recently reopened to Pool (audit 2h ago) -> not stale.
	seedLead(t, "LEAD-REOPEN", "Reopened", "0819-3", "[Pool]")
	setLeadCreatedAt(t, "LEAD-REOPEN", "NOW() - INTERVAL 30 HOUR")
	seedPoolTransitionAudit(t, "LEAD-REOPEN", "NOW() - INTERVAL 2 HOUR")
	// Reopened long ago (audit 26h) -> stale from the audit timestamp.
	seedLead(t, "LEAD-REOPEN-OLD", "Reopened Old", "0819-4", "[Pool]")
	setLeadCreatedAt(t, "LEAD-REOPEN-OLD", "NOW() - INTERVAL 40 HOUR")
	seedPoolTransitionAudit(t, "LEAD-REOPEN-OLD", "NOW() - INTERVAL 26 HOUR")

	ss1 := login(t, srv, "ss1@mea.co.id")
	code, body := do(t, ss1, "GET", srv.URL+"/api/v1/leads?view=pool", nil)
	if code != 200 {
		t.Fatalf("pool list: %d", code)
	}
	got := leadsByID(body)
	want := map[string]bool{
		"LEAD-OLD":        true,
		"LEAD-FRESH":      false,
		"LEAD-REOPEN":     false,
		"LEAD-REOPEN-OLD": true,
	}
	for id, exp := range want {
		rec := got[id]
		if rec == nil {
			t.Fatalf("missing %s in pool list", id)
		}
		if rec["stale"] != exp {
			t.Errorf("%s stale = %v want %v", id, rec["stale"], exp)
		}
	}
}

// TestActiveOwners_LeftJoin verifies active_owners lists non-terminal owners and
// tolerates an unsynced (missing) employee (name "" — O19).
func TestActiveOwners_LeftJoin(t *testing.T) {
	srv, done := setupLeads(t)
	defer done()
	seedLead(t, "LEAD-OWN", "Contested", "0817-1", "[Pool]")
	seedAttempt(t, "PRSP-O1", "LEAD-OWN", "EMP-SS1", "Contacted")            // active, synced
	seedAttempt(t, "PRSP-O2", "LEAD-OWN", "EMP-GHOST", "Contacted")         // active, unsynced
	seedAttempt(t, "PRSP-O3", "LEAD-OWN", "EMP-SS2", "[Closed - Kalah Kompetisi]") // terminal, excluded

	ss1 := login(t, srv, "ss1@mea.co.id")
	code, body := do(t, ss1, "GET", srv.URL+"/api/v1/leads?view=pool", nil)
	if code != 200 {
		t.Fatalf("pool: %d", code)
	}
	rec := leadsByID(body)["LEAD-OWN"]
	owners, _ := rec["active_owners"].([]any)
	if len(owners) != 2 {
		t.Fatalf("active_owners = %v want 2 (terminal excluded)", owners)
	}
	names := map[string]string{}
	for _, o := range owners {
		m := o.(map[string]any)
		names[m["employee_id"].(string)], _ = m["name"].(string)
	}
	if names["EMP-SS1"] != "Andi" {
		t.Errorf("synced owner name = %q want Andi", names["EMP-SS1"])
	}
	if _, ok := names["EMP-GHOST"]; !ok || names["EMP-GHOST"] != "" {
		t.Errorf("unsynced owner should be present with empty name, got %v", names)
	}
}
