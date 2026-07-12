package httpapi_test

import (
	"testing"
)

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
