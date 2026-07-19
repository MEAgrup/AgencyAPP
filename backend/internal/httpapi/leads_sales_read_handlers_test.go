package httpapi_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	neturl "net/url"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/httpapi"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

// setupLS wires the server + directly seeds a controlled leads/attempts fixture
// (statuses set at INSERT so the read model and the /lost engine edge can be
// exercised without walking the full lifecycle).
func setupLS(t *testing.T) (*httptest.Server, func()) {
	t.Helper()
	d := testutil.DB(t)
	testutil.Clean(t, d)
	testutil.InsertRoleMapping(t, d, "Sales", "Sales Executive", "Sales", "staff")
	testutil.InsertRoleMapping(t, d, "Sales", "Sales Head", "Sales", "lead")
	testutil.InsertRoleMapping(t, d, "Marketing", "Marketing Staff", "Marketing", "staff")
	testutil.InsertRoleMapping(t, d, "Marketing", "Marketing Head", "Marketing", "lead")
	testutil.InsertRoleMapping(t, d, "Creative", "Creative Staff", "Creative", "staff")
	testutil.InsertEmployee(t, d, "EMP-SS1", "Sam Satu", "ss1@mea.co.id", "Sales", "Sales Executive", true)
	testutil.InsertEmployee(t, d, "EMP-SS2", "Sam Dua", "ss2@mea.co.id", "Sales", "Sales Executive", true)
	testutil.InsertEmployee(t, d, "EMP-SL", "Dewi", "sl@mea.co.id", "Sales", "Sales Head", true)
	testutil.InsertEmployee(t, d, "EMP-MS", "Lia", "ms@mea.co.id", "Marketing", "Marketing Staff", true)
	testutil.InsertEmployee(t, d, "EMP-ML", "Maya", "ml@mea.co.id", "Marketing", "Marketing Head", true)
	testutil.InsertEmployee(t, d, "EMP-CR", "Caca", "cr@mea.co.id", "Creative", "Creative Staff", true)
	testutil.InsertEmployee(t, d, "EMP-ODI", "Odi", "odi@mea.co.id", "Management", "OD", true)
	testutil.InsertEmployee(t, d, "EMP-DIR", "Yohan", "yohan@mea.co.id", "Management", "Director", true)
	testutil.InsertLayeredRole(t, d, "EMP-ODI", "od")
	testutil.InsertLayeredRole(t, d, "EMP-DIR", "director")

	ctx := context.Background()
	exec := func(q string, args ...any) {
		if _, err := d.ExecContext(ctx, q, args...); err != nil {
			t.Fatalf("seed exec: %v\n%s", err, q)
		}
	}

	// Campaign owned by the Marketing staff (origin-campaign scope for LEAD-B).
	exec(`INSERT INTO campaigns (id, name, channel, is_online, start_date, owner_employee_id, status, created_by)
	      VALUES ('CMP-1', 'Promo', 'TikTok', 1, '2026-03-01', 'EMP-MS', 'Active', 'EMP-MS')`)

	lead := func(id, name, phone, status, campaign, createdBy, createdAt string) {
		q := `INSERT INTO leads (id, lead_name, phone_number, phone_norm, source, origin_division, origin_campaign_id, record_status, created_by, created_at)
		      VALUES (?, ?, ?, ?, 'Scouting', 'Sales', ?, ?, ?, ` + createdAt + `)`
		var camp any
		if campaign != "" {
			camp = campaign
		}
		exec(q, id, name, phone, phone, camp, status, createdBy)
	}
	attempt := func(id, leadID, owner, status string) {
		exec(`INSERT INTO prospect_attempts (id, lead_id, owner_employee_id, status, created_by) VALUES (?, ?, ?, ?, ?)`,
			id, leadID, owner, status, owner)
	}

	// Active leads + attempts.
	lead("LEAD-A", "Toko A", "0811000001", "active", "", "EMP-MS", "NOW()")
	attempt("PRSP-A1", "LEAD-A", "EMP-SS1", "New Lead")

	lead("LEAD-B", "Toko B", "0811000002", "active", "CMP-1", "EMP-OTHER", "NOW()")
	attempt("PRSP-B1", "LEAD-B", "EMP-SS2", "Contacted")

	lead("LEAD-NEG", "Toko Nego", "0811000003", "active", "", "EMP-OTHER", "NOW()")
	attempt("PRSP-NEG", "LEAD-NEG", "EMP-SS1", "Negotiation - Rejected")
	// Qualified form + pinned service for PRSP-NEG.
	exec(`INSERT INTO qualified_forms (attempt_id, lead_id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, marketing_budget, platform, store_link, created_by)
	      VALUES ('PRSP-NEG', 'LEAD-NEG', 'Pak Budi', 'Toko Nego', 'Jakarta', 'http://x', 'Fashion', '9000000.00', '20000000.00', '3000000.00', 'TikTok', 'http://s', 'EMP-SS1')`)
	exec(`INSERT INTO qualified_form_services (attempt_id, master_service_id, master_version_no, name, standard_price, commission_rule, quantity, pricing_mode, subtotal, created_by)
	      VALUES ('PRSP-NEG', 'MSV-1', 1, 'Jasa A', '9000000.00', '10% of standard price', 1, 'flat', '9000000.00', 'EMP-SS1')`)
	// Two immutable proposal versions (v1 then v2).
	exec(`INSERT INTO negotiation_proposals (id, attempt_id, version_no, proposed_by, decision_note, created_by)
	      VALUES ('NEG-1', 'PRSP-NEG', 1, 'EMP-SS1', 'revisi harga', 'EMP-SS1')`)
	exec(`INSERT INTO negotiation_proposals (id, attempt_id, version_no, proposed_by, created_by)
	      VALUES ('NEG-2', 'PRSP-NEG', 2, 'EMP-SS1', 'EMP-SS1')`)
	exec(`INSERT INTO negotiation_proposal_lines (proposal_id, master_service_id, proposed_price, commission_rule, payment_terms, created_by)
	      VALUES ('NEG-2', 'MSV-1', '8500000.00', '10% of standard price', 'DP 50%', 'EMP-SS1')`)

	// Attempts to close as lost.
	lead("LEAD-L1", "Toko L1", "0811000004", "active", "", "EMP-OTHER", "NOW()")
	attempt("PRSP-LOST", "LEAD-L1", "EMP-SS1", "Negotiation - Rejected")
	lead("LEAD-L2", "Toko L2", "0811000005", "active", "", "EMP-OTHER", "NOW()")
	attempt("PRSP-LOST2", "LEAD-L2", "EMP-SS1", "Negotiation - Rejected")

	// Pool leads: fresh (2 open attempts) + stale (none).
	lead("LEAD-POOL", "Toko Pool", "0811000006", "[Pool]", "", "TEST", "NOW()")
	attempt("PRSP-P1", "LEAD-POOL", "EMP-SS2", "Contacted")
	attempt("PRSP-P2", "LEAD-POOL", "EMP-SS1", "New Lead")
	lead("LEAD-POOL-STALE", "Toko Stale", "0811000007", "[Pool]", "", "TEST", "(NOW() - INTERVAL 3 DAY)")

	testutil.SeedCredentials(t, d, "rahasia123")
	app := httpapi.New(d, statemachine.New(), notification.NewCatalog(), nil)
	srv := httptest.NewServer(app.Router())
	return srv, srv.Close
}

// rowsByID indexes a {"data":[...]} list body by the "id" field.
func rowsByID(t *testing.T, body map[string]any) map[string]map[string]any {
	t.Helper()
	out := map[string]map[string]any{}
	data, _ := body["data"].([]any)
	for _, r := range data {
		m := r.(map[string]any)
		out[m["id"].(string)] = m
	}
	return out
}

func TestListAttempts_ScopeAndFilter(t *testing.T) {
	srv, done := setupLS(t)
	defer done()

	ss1 := login(t, srv, "ss1@mea.co.id")
	ss2 := login(t, srv, "ss2@mea.co.id")
	sl := login(t, srv, "sl@mea.co.id")
	ms := login(t, srv, "ms@mea.co.id")
	cr := login(t, srv, "cr@mea.co.id")
	odi := login(t, srv, "odi@mea.co.id")
	yohan := login(t, srv, "yohan@mea.co.id")
	url := srv.URL + "/api/v1/attempts"

	// Sales staff sees only their own attempts.
	code, body := do(t, ss1, "GET", url, nil)
	if code != 200 {
		t.Fatalf("ss1 list: %d %v", code, body)
	}
	byID := rowsByID(t, body)
	for _, own := range []string{"PRSP-A1", "PRSP-NEG", "PRSP-LOST", "PRSP-P2"} {
		if _, ok := byID[own]; !ok {
			t.Errorf("ss1 missing own attempt %s", own)
		}
	}
	for _, other := range []string{"PRSP-B1", "PRSP-P1"} {
		if _, ok := byID[other]; ok {
			t.Errorf("ss1 should not see other's attempt %s", other)
		}
	}
	// owner_nama resolved from employees.
	if byID["PRSP-A1"]["owner_nama"] != "Sam Satu" {
		t.Errorf("owner_nama = %v want Sam Satu", byID["PRSP-A1"]["owner_nama"])
	}

	// ss2 sees only their own.
	_, body = do(t, ss2, "GET", url, nil)
	byID = rowsByID(t, body)
	if _, ok := byID["PRSP-B1"]; !ok {
		t.Errorf("ss2 should see PRSP-B1")
	}
	if _, ok := byID["PRSP-A1"]; ok {
		t.Errorf("ss2 should not see PRSP-A1")
	}

	// Sales lead / OD / Director see everything.
	for _, c := range []struct {
		name string
		cl   *http.Client
	}{{"sl", sl}, {"od", odi}, {"dir", yohan}} {
		code, body = do(t, c.cl, "GET", url, nil)
		if code != 200 {
			t.Fatalf("%s list: %d", c.name, code)
		}
		byID = rowsByID(t, body)
		if _, ok := byID["PRSP-A1"]; !ok {
			t.Errorf("%s should see PRSP-A1", c.name)
		}
		if _, ok := byID["PRSP-B1"]; !ok {
			t.Errorf("%s should see PRSP-B1", c.name)
		}
	}

	// Marketing + foreign division denied.
	if code, _ := do(t, ms, "GET", url, nil); code != 403 {
		t.Errorf("marketing staff list: %d want 403", code)
	}
	if code, _ := do(t, cr, "GET", url, nil); code != 403 {
		t.Errorf("creative list: %d want 403", code)
	}

	// Status filter (scoped to ss1's own New Lead attempts).
	_, body = do(t, ss1, "GET", url+"?"+neturl.Values{"status": {"New Lead"}}.Encode(), nil)
	byID = rowsByID(t, body)
	if _, ok := byID["PRSP-A1"]; !ok {
		t.Errorf("status filter missing PRSP-A1")
	}
	if _, ok := byID["PRSP-NEG"]; ok {
		t.Errorf("status filter should exclude PRSP-NEG (Negotiation - Rejected)")
	}
}

func TestGetAttempt_DetailAndScope(t *testing.T) {
	srv, done := setupLS(t)
	defer done()

	ss1 := login(t, srv, "ss1@mea.co.id")
	ss2 := login(t, srv, "ss2@mea.co.id")
	sl := login(t, srv, "sl@mea.co.id")
	ms := login(t, srv, "ms@mea.co.id")
	odi := login(t, srv, "odi@mea.co.id")

	// New Lead attempt: no qualified form / proposals; Contacted is reachable.
	code, body := do(t, ss1, "GET", srv.URL+"/api/v1/attempts/PRSP-A1", nil)
	if code != 200 {
		t.Fatalf("get PRSP-A1: %d %v", code, body)
	}
	if body["qualified_form"] != nil {
		t.Errorf("PRSP-A1 qualified_form should be null before qualify: %v", body["qualified_form"])
	}
	if props, _ := body["proposals"].([]any); len(props) != 0 {
		t.Errorf("PRSP-A1 proposals should be empty: %v", body["proposals"])
	}
	if !containsStr(body["allowed_transitions"], "Contacted") {
		t.Errorf("PRSP-A1 allowed_transitions missing Contacted: %v", body["allowed_transitions"])
	}

	// Negotiation attempt: qualified form present + proposals ordered v1,v2.
	code, body = do(t, ss1, "GET", srv.URL+"/api/v1/attempts/PRSP-NEG", nil)
	if code != 200 {
		t.Fatalf("get PRSP-NEG: %d %v", code, body)
	}
	qf, _ := body["qualified_form"].(map[string]any)
	if qf == nil || qf["nama_pic"] != "Pak Budi" || qf["gmv_baseline"] != "9000000.00" {
		t.Fatalf("PRSP-NEG qualified_form wrong: %v", body["qualified_form"])
	}
	svcs, _ := qf["services"].([]any)
	if len(svcs) != 1 || svcs[0].(map[string]any)["name"] != "Jasa A" {
		t.Fatalf("PRSP-NEG services wrong: %v", qf["services"])
	}
	props, _ := body["proposals"].([]any)
	if len(props) != 2 {
		t.Fatalf("PRSP-NEG proposals len = %d want 2", len(props))
	}
	if props[0].(map[string]any)["version_no"].(float64) != 1 || props[1].(map[string]any)["version_no"].(float64) != 2 {
		t.Errorf("proposals not ordered ASC: %v", props)
	}
	// Line name resolves from the qualified-form service.
	lines, _ := props[1].(map[string]any)["lines"].([]any)
	if len(lines) != 1 || lines[0].(map[string]any)["name"] != "Jasa A" {
		t.Errorf("proposal line name unresolved: %v", lines)
	}
	if !containsStr(body["allowed_transitions"], "Closed-Lost") {
		t.Errorf("PRSP-NEG allowed_transitions missing Closed-Lost: %v", body["allowed_transitions"])
	}

	// Scope: Sales lead + OD may read; a non-owner Sales staff + Marketing may not.
	if code, _ := do(t, sl, "GET", srv.URL+"/api/v1/attempts/PRSP-A1", nil); code != 200 {
		t.Errorf("sales lead detail: %d want 200", code)
	}
	if code, _ := do(t, odi, "GET", srv.URL+"/api/v1/attempts/PRSP-A1", nil); code != 200 {
		t.Errorf("OD detail: %d want 200", code)
	}
	if code, _ := do(t, ss2, "GET", srv.URL+"/api/v1/attempts/PRSP-A1", nil); code != 403 {
		t.Errorf("non-owner sales staff detail: %d want 403", code)
	}
	if code, _ := do(t, ms, "GET", srv.URL+"/api/v1/attempts/PRSP-A1", nil); code != 403 {
		t.Errorf("marketing detail: %d want 403", code)
	}
	// Missing -> 404.
	if code, b := do(t, ss1, "GET", srv.URL+"/api/v1/attempts/PRSP-NONE", nil); code != 404 || b["message"] != "[data tidak ditemukan]" {
		t.Errorf("missing attempt: %d %v", code, b)
	}
}

func TestLeadsPool_FlagsAndScope(t *testing.T) {
	srv, done := setupLS(t)
	defer done()

	ss1 := login(t, srv, "ss1@mea.co.id")
	ss2 := login(t, srv, "ss2@mea.co.id")
	ms := login(t, srv, "ms@mea.co.id")
	odi := login(t, srv, "odi@mea.co.id")
	url := srv.URL + "/api/v1/leads/pool"

	code, body := do(t, ss1, "GET", url, nil)
	if code != 200 {
		t.Fatalf("ss1 pool: %d %v", code, body)
	}
	byID := rowsByID(t, body)
	// Only [Pool] leads present.
	if _, ok := byID["LEAD-A"]; ok {
		t.Errorf("active lead leaked into pool")
	}
	pool := byID["LEAD-POOL"]
	if pool == nil {
		t.Fatalf("LEAD-POOL missing from pool")
	}
	if pool["open_attempt_count"].(float64) != 2 {
		t.Errorf("LEAD-POOL open_attempt_count = %v want 2", pool["open_attempt_count"])
	}
	if pool["my_open_attempt"] != true {
		t.Errorf("LEAD-POOL my_open_attempt = %v want true (ss1 owns PRSP-P2)", pool["my_open_attempt"])
	}
	if pool["stale"] != false {
		t.Errorf("LEAD-POOL stale = %v want false", pool["stale"])
	}
	stale := byID["LEAD-POOL-STALE"]
	if stale == nil || stale["stale"] != true {
		t.Errorf("LEAD-POOL-STALE stale flag wrong: %v", stale)
	}
	if stale["open_attempt_count"].(float64) != 0 || stale["my_open_attempt"] != false {
		t.Errorf("LEAD-POOL-STALE counts wrong: %v", stale)
	}

	// ss2 owns PRSP-P1 => my_open_attempt true as well.
	_, body = do(t, ss2, "GET", url, nil)
	if rowsByID(t, body)["LEAD-POOL"]["my_open_attempt"] != true {
		t.Errorf("ss2 my_open_attempt should be true")
	}

	// OD read ok, Marketing denied.
	if code, _ := do(t, odi, "GET", url, nil); code != 200 {
		t.Errorf("OD pool: %d want 200", code)
	}
	if code, _ := do(t, ms, "GET", url, nil); code != 403 {
		t.Errorf("marketing pool: %d want 403", code)
	}
}

func TestLeadsList_ScopeAndDetail(t *testing.T) {
	srv, done := setupLS(t)
	defer done()

	ss1 := login(t, srv, "ss1@mea.co.id")
	sl := login(t, srv, "sl@mea.co.id")
	ms := login(t, srv, "ms@mea.co.id")
	ml := login(t, srv, "ml@mea.co.id")
	cr := login(t, srv, "cr@mea.co.id")
	odi := login(t, srv, "odi@mea.co.id")
	url := srv.URL + "/api/v1/leads"

	// Marketing staff: own (created_by) + owned-campaign origin only.
	code, body := do(t, ms, "GET", url, nil)
	if code != 200 {
		t.Fatalf("ms leads: %d %v", code, body)
	}
	byID := rowsByID(t, body)
	if _, ok := byID["LEAD-A"]; !ok { // created_by EMP-MS
		t.Errorf("ms missing own LEAD-A")
	}
	if _, ok := byID["LEAD-B"]; !ok { // origin campaign owned by EMP-MS
		t.Errorf("ms missing campaign-scoped LEAD-B")
	}
	if _, ok := byID["LEAD-NEG"]; ok {
		t.Errorf("ms should not see LEAD-NEG (not creator, not owned campaign)")
	}

	// Marketing lead / Sales lead / OD see all.
	for _, cl := range []struct {
		name string
		c    *http.Client
	}{{"ml", ml}, {"sl", sl}, {"od", odi}} {
		_, body = do(t, cl.c, "GET", url, nil)
		if _, ok := rowsByID(t, body)["LEAD-NEG"]; !ok {
			t.Errorf("%s should see LEAD-NEG", cl.name)
		}
	}

	// Sales staff + foreign division denied on the Database list.
	if code, _ := do(t, ss1, "GET", url, nil); code != 403 {
		t.Errorf("sales staff leads: %d want 403", code)
	}
	if code, _ := do(t, cr, "GET", url, nil); code != 403 {
		t.Errorf("creative leads: %d want 403", code)
	}

	// Filters.
	_, body = do(t, ml, "GET", url+"?"+neturl.Values{"status": {"[Pool]"}}.Encode(), nil)
	byID = rowsByID(t, body)
	if _, ok := byID["LEAD-POOL"]; !ok {
		t.Errorf("status filter missing LEAD-POOL")
	}
	if _, ok := byID["LEAD-A"]; ok {
		t.Errorf("status filter should exclude active LEAD-A")
	}
	_, body = do(t, ml, "GET", url+"?"+neturl.Values{"q": {"Nego"}}.Encode(), nil)
	byID = rowsByID(t, body)
	if _, ok := byID["LEAD-NEG"]; !ok || len(byID) != 1 {
		t.Errorf("q filter wrong: %v", byID)
	}

	// Detail scope.
	if code, _ := do(t, ms, "GET", srv.URL+"/api/v1/leads/LEAD-A", nil); code != 200 {
		t.Errorf("ms own lead detail: %d want 200", code)
	}
	if code, _ := do(t, ms, "GET", srv.URL+"/api/v1/leads/LEAD-NEG", nil); code != 403 {
		t.Errorf("ms out-of-scope lead detail: %d want 403", code)
	}
	// Sales staff with an attempt on the lead may read it.
	code, body = do(t, ss1, "GET", srv.URL+"/api/v1/leads/LEAD-NEG", nil)
	if code != 200 {
		t.Fatalf("ss1 lead-with-attempt detail: %d want 200", code)
	}
	atts, _ := body["attempts"].([]any)
	if len(atts) != 1 || atts[0].(map[string]any)["owner_nama"] != "Sam Satu" {
		t.Errorf("lead detail attempts wrong: %v", body["attempts"])
	}
	// Sales staff without an attempt on the lead is denied.
	if code, _ := do(t, ss1, "GET", srv.URL+"/api/v1/leads/LEAD-B", nil); code != 403 {
		t.Errorf("ss1 lead-without-attempt detail: %d want 403", code)
	}
	if code, b := do(t, sl, "GET", srv.URL+"/api/v1/leads/LEAD-NONE", nil); code != 404 || b["message"] != "[data tidak ditemukan]" {
		t.Errorf("missing lead: %d %v", code, b)
	}
}

func TestMarkLost_EngineAndPermissions(t *testing.T) {
	srv, done := setupLS(t)
	defer done()

	ss1 := login(t, srv, "ss1@mea.co.id")
	ss2 := login(t, srv, "ss2@mea.co.id")
	cr := login(t, srv, "cr@mea.co.id")
	odi := login(t, srv, "odi@mea.co.id")
	yohan := login(t, srv, "yohan@mea.co.id")

	// Legal: owner closes a Negotiation - Rejected attempt as lost.
	code, body := do(t, ss1, "POST", srv.URL+"/api/v1/attempts/PRSP-LOST/lost", nil)
	if code != 200 || body["status"] != "Closed-Lost" {
		t.Fatalf("owner lost: %d %v", code, body)
	}
	// Director may also close (own division authority everywhere).
	if code, body := do(t, yohan, "POST", srv.URL+"/api/v1/attempts/PRSP-LOST2/lost", nil); code != 200 || body["status"] != "Closed-Lost" {
		t.Fatalf("director lost: %d %v", code, body)
	}

	// Illegal edge: New Lead -> Closed-Lost blocked by the engine (default BI msg).
	code, body = do(t, ss1, "POST", srv.URL+"/api/v1/attempts/PRSP-A1/lost", nil)
	if code != 409 || body["message"] != "[transisi status tidak diizinkan]" {
		t.Fatalf("illegal lost: %d %v", code, body)
	}

	// Permission: non-owner Sales staff, OD (read-only), foreign division all 403.
	if code, b := do(t, ss2, "POST", srv.URL+"/api/v1/attempts/PRSP-NEG/lost", nil); code != 403 ||
		b["message"] != statemachine.RoleDeniedMessage {
		t.Errorf("non-owner lost: %d %v want 403", code, b)
	}
	if code, _ := do(t, odi, "POST", srv.URL+"/api/v1/attempts/PRSP-NEG/lost", nil); code != 403 {
		t.Errorf("OD lost: %d want 403", code)
	}
	if code, _ := do(t, cr, "POST", srv.URL+"/api/v1/attempts/PRSP-NEG/lost", nil); code != 403 {
		t.Errorf("creative lost: %d want 403", code)
	}
	// PRSP-NEG stayed Negotiation - Rejected (no mutation from denied calls).
	_, body = do(t, ss1, "GET", srv.URL+"/api/v1/attempts/PRSP-NEG", nil)
	if body["attempt"].(map[string]any)["status"] != "Negotiation - Rejected" {
		t.Errorf("PRSP-NEG mutated by denied /lost: %v", body["attempt"])
	}
}

func containsStr(v any, want string) bool {
	arr, _ := v.([]any)
	for _, s := range arr {
		if s == want {
			return true
		}
	}
	return false
}
