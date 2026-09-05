package httpapi_test

import (
	"context"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

// seedAwaitingService inserts a released client owned by amID plus a Service in
// [Awaiting Onboarding] with the given pinned Requires-Strategy-Plan flag.
func seedAwaitingService(t *testing.T, clientID, serviceID, amID string, pin bool) {
	t.Helper()
	d := testutil.DB(t)
	seedCFClient(t, clientID, "EMP-BUDI", true)
	assignCFAM(t, clientID, amID)
	rsp := 0
	if pin {
		rsp = 1
	}
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO services (id, client_id, master_service_id, master_version_no, name, standard_price,
		   commission_rule, status, requires_strategy_plan, created_by)
		 VALUES (?, ?, 'MSV-01', 1, 'Jasa X', '5000000.00', '10% of standard price', '[Awaiting Onboarding]', ?, 'TEST')`,
		serviceID, clientID, rsp); err != nil {
		t.Fatal(err)
	}
}

// TestStrategyRequirementEndpoint exercises the M6-OA-1 per-engagement override
// HTTP surface: permission matrix (AM/SPV/Director allow; other AM, OD, Sales
// deny), reason validation, and the effective-flag flip end-to-end.
func TestStrategyRequirementEndpoint(t *testing.T) {
	srv, done := setupCF(t)
	defer done()

	amel := login(t, srv, "amel@mea.co.id")   // Account staff / owning AM
	alia := login(t, srv, "alia@mea.co.id")   // Account lead (SPV)
	dewi := login(t, srv, "dewi@mea.co.id")   // Sales lead
	odi := login(t, srv, "odi@mea.co.id")     // OD (read-only)
	yohan := login(t, srv, "yohan@mea.co.id") // Director

	url := func(svc string) string { return srv.URL + "/api/v1/services/" + svc + "/strategy-requirement" }

	// Owning AM overrides a Direct Service (pin=0) to require a plan.
	seedAwaitingService(t, "CLI-OA1", "SVC-OA1", "EMP-AMEL", false)
	code, body := do(t, amel, "POST", url("SVC-OA1"), map[string]any{"requires_strategy_plan": true, "reason": "klien minta rencana"})
	if code != 200 {
		t.Fatalf("owner AM override: %d %v", code, body)
	}
	if body["requires_strategy_plan"] != true || body["overridden"] != true || body["pinned_requires_strategy_plan"] != false {
		t.Fatalf("override result = %v", body)
	}
	// Effective flip proven: Strategy creation now allowed on the once-Direct Service.
	if c, b := do(t, amel, "POST", srv.URL+"/api/v1/services/SVC-OA1/strategy", map[string]any{
		"objective": "grow", "target_kpi": "GMV +30%", "divisions_involved": []string{"Creative"},
		"planned_brief_outline": "x", "timeline_start": "2026-07-01", "timeline_end": "2026-08-01",
	}); c != 200 {
		t.Fatalf("CreateStrategy after override: %d %v", c, b)
	}

	// Reason mandatory -> 422.
	seedAwaitingService(t, "CLI-OA2", "SVC-OA2", "EMP-AMEL", false)
	if code, body := do(t, amel, "POST", url("SVC-OA2"), map[string]any{"requires_strategy_plan": true, "reason": ""}); code != 422 ||
		body["message"] != "[alasan perubahan kebutuhan Strategy & Plan wajib diisi]" {
		t.Fatalf("no reason: %d %v", code, body)
	}

	// Account lead and Director may override; OD, Sales, and a non-owner AM may not.
	if code, _ := do(t, alia, "POST", url("SVC-OA2"), map[string]any{"requires_strategy_plan": true, "reason": "spv"}); code != 200 {
		t.Fatalf("account lead override: %d want 200", code)
	}
	seedAwaitingService(t, "CLI-OA3", "SVC-OA3", "EMP-AMEL", true)
	if code, _ := do(t, yohan, "POST", url("SVC-OA3"), map[string]any{"requires_strategy_plan": false, "reason": "dir"}); code != 200 {
		t.Fatalf("director override: %d want 200", code)
	}
	seedAwaitingService(t, "CLI-OA4", "SVC-OA4", "EMP-AMEL", false)
	if code, _ := do(t, odi, "POST", url("SVC-OA4"), map[string]any{"requires_strategy_plan": true, "reason": "od"}); code != 403 {
		t.Fatalf("OD override: %d want 403", code)
	}
	if code, _ := do(t, dewi, "POST", url("SVC-OA4"), map[string]any{"requires_strategy_plan": true, "reason": "sales"}); code != 403 {
		t.Fatalf("sales override: %d want 403", code)
	}
	// A non-owning AM (Bima) is denied.
	bima := login(t, srv, "bima@mea.co.id")
	if code, _ := do(t, bima, "POST", url("SVC-OA4"), map[string]any{"requires_strategy_plan": true, "reason": "bukan owner"}); code != 403 {
		t.Fatalf("non-owner AM override: %d want 403", code)
	}
}

// TestAccountIntakeAndAssignEndpoints exercises the M6 §3 (Cluster 1) HTTP
// surface end-to-end with per-role permission checks, reusing setupCF's Account
// fixtures (EMP-AMEL = Account staff/AM, EMP-ALIA = Account lead).
func TestAccountIntakeAndAssignEndpoints(t *testing.T) {
	srv, done := setupCF(t)
	defer done()
	seedCFClient(t, "CLI-Q", "EMP-BUDI", true) // released, unassigned -> in queue

	amel := login(t, srv, "amel@mea.co.id")   // Account staff (AM)
	alia := login(t, srv, "alia@mea.co.id")   // Account lead (SPV/Head Account)
	dewi := login(t, srv, "dewi@mea.co.id")   // Sales lead
	odi := login(t, srv, "odi@mea.co.id")     // OD (read-only)
	yohan := login(t, srv, "yohan@mea.co.id") // Director

	// --- Intake queue read gate (§3 Rule 1): Lead/OD/Director yes; AM/Sales no.
	if code, body := do(t, alia, "GET", srv.URL+"/api/v1/account/intake", nil); code != 200 {
		t.Fatalf("account lead intake: %d %v", code, body)
	}
	if code, _ := do(t, odi, "GET", srv.URL+"/api/v1/account/intake", nil); code != 200 {
		t.Fatalf("OD intake: %d want 200", code)
	}
	if code, _ := do(t, yohan, "GET", srv.URL+"/api/v1/account/intake", nil); code != 200 {
		t.Fatalf("director intake: %d want 200", code)
	}
	if code, _ := do(t, amel, "GET", srv.URL+"/api/v1/account/intake", nil); code != 403 {
		t.Fatalf("AM intake: %d want 403", code)
	}
	if code, _ := do(t, dewi, "GET", srv.URL+"/api/v1/account/intake", nil); code != 403 {
		t.Fatalf("sales lead intake: %d want 403", code)
	}

	// --- Assign gate (§3 Rule 2): only Lead/Director may assign.
	if code, _ := do(t, amel, "POST", srv.URL+"/api/v1/clients/CLI-Q/assign-am", map[string]any{"am_id": "EMP-AMEL"}); code != 403 {
		t.Fatalf("AM self-assign: %d want 403", code)
	}
	if code, _ := do(t, odi, "POST", srv.URL+"/api/v1/clients/CLI-Q/assign-am", map[string]any{"am_id": "EMP-AMEL"}); code != 403 {
		t.Fatalf("OD assign: %d want 403 (read-only)", code)
	}
	// Invalid assignee (Sales staff is not an Account AM) -> 422.
	code, body := do(t, alia, "POST", srv.URL+"/api/v1/clients/CLI-Q/assign-am", map[string]any{"am_id": "EMP-DEWI"})
	if code != 422 || body["message"] != "[Account Manager tidak valid: harus staff divisi Account yang aktif]" {
		t.Fatalf("invalid AM: %d %v", code, body)
	}
	// Account Lead assigns a valid AM.
	if code, _ := do(t, alia, "POST", srv.URL+"/api/v1/clients/CLI-Q/assign-am", map[string]any{"am_id": "EMP-AMEL"}); code != 200 {
		t.Fatalf("account lead assign: %d", code)
	}
	// Now the client leaves the intake queue and the AM can see it via M4.
	if _, body := do(t, alia, "GET", srv.URL+"/api/v1/account/intake", nil); len(body["data"].([]any)) != 0 {
		t.Fatalf("intake queue should be empty after assignment: %v", body["data"])
	}
	if code, _ := do(t, amel, "GET", srv.URL+"/api/v1/clients/CLI-Q", nil); code != 200 {
		t.Fatalf("assigned AM GET client: %d want 200", code)
	}

	// --- Double-assign rejected (M6-OA-6) -> 422, route to reassignment.
	code, body = do(t, alia, "POST", srv.URL+"/api/v1/clients/CLI-Q/assign-am", map[string]any{"am_id": "EMP-ALIA"})
	if code != 422 || body["message"] != "[klien sudah memiliki Account Manager, gunakan reassignment]" {
		t.Fatalf("double assign: %d %v", code, body)
	}

	// --- Reassign (§3 Rule 3): reason mandatory; then succeeds.
	code, body = do(t, alia, "POST", srv.URL+"/api/v1/clients/CLI-Q/reassign-am", map[string]any{"am_id": "EMP-BIMA"})
	if code != 422 || body["message"] != "[alasan reassignment wajib diisi]" {
		t.Fatalf("reassign no reason: %d %v", code, body)
	}
	// Lead/SPV bukan kandidat AM (M6 §3 Rule 1: SPV ≠ individual AM) -> 422.
	code, body = do(t, alia, "POST", srv.URL+"/api/v1/clients/CLI-Q/reassign-am", map[string]any{"am_id": "EMP-ALIA", "reason": "Amel cuti"})
	if code != 422 || body["message"] != "[Account Manager tidak valid: harus staff divisi Account yang aktif]" {
		t.Fatalf("reassign to lead: %d %v", code, body)
	}
	if code, _ := do(t, alia, "POST", srv.URL+"/api/v1/clients/CLI-Q/reassign-am", map[string]any{"am_id": "EMP-BIMA", "reason": "Amel cuti"}); code != 200 {
		t.Fatalf("reassign with reason: %d", code)
	}

	// --- Workload dashboard (§3 Rule 5) reflects the current owner.
	code, body = do(t, alia, "GET", srv.URL+"/api/v1/account/workload", nil)
	if code != 200 {
		t.Fatalf("workload: %d", code)
	}
	rows, _ := body["data"].([]any)
	if len(rows) != 1 {
		t.Fatalf("workload rows = %v, want 1", body["data"])
	}
	r0 := rows[0].(map[string]any)
	if r0["am_employee_id"] != "EMP-BIMA" || r0["active_client_count"].(float64) != 1 {
		t.Errorf("workload row = %+v, want EMP-BIMA=1", r0)
	}
}
