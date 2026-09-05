package httpapi_test

import "testing"

// TestMarketingPerformanceEndpoints exercises the Module 2 (Marketing) HTTP surface:
// performance-record create (budget validation, 1:1 duplicate, per-role permissions),
// budget update, GET record+metrics, and the Lead/Staff performance dashboard split. It
// reuses the Module 3 fixture setup (setupCMP) since the record hangs off a Campaign.
func TestMarketingPerformanceEndpoints(t *testing.T) {
	srv, done := setupCMP(t)
	defer done()

	lia := login(t, srv, "lia@mea.co.id")
	maya := login(t, srv, "maya@mea.co.id")
	sam := login(t, srv, "sam@mea.co.id")
	odi := login(t, srv, "odi@mea.co.id")
	yohan := login(t, srv, "yohan@mea.co.id")

	base := srv.URL + "/api/v1/marketing/campaigns"
	valid := map[string]any{"name": "Promo Skilskul Maret", "channel": "TikTok Ads", "online": true, "start_date": "2026-03-02"}

	// Lia creates a campaign she owns.
	code, body := do(t, lia, "POST", base, valid)
	if code != 200 {
		t.Fatalf("create campaign: %d %v", code, body)
	}
	id := body["id"].(string)
	perf := base + "/" + id + "/performance"

	// --- Create record: invalid budget -> 422 house default.
	if code, body := do(t, lia, "POST", perf, map[string]any{"budget": "0"}); code != 422 || body["message"] != "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" {
		t.Fatalf("zero budget: %d %v", code, body)
	}
	// Foreign division -> 403.
	if code, _ := do(t, sam, "POST", perf, map[string]any{"budget": "5000000"}); code != 403 {
		t.Fatalf("sales create record: want 403")
	}
	// Lead (read-only over staff records) -> 403.
	if code, _ := do(t, maya, "POST", perf, map[string]any{"budget": "5000000"}); code != 403 {
		t.Fatalf("lead create-over-staff: want 403")
	}
	// OD read-only -> 403.
	if code, _ := do(t, odi, "POST", perf, map[string]any{"budget": "5000000"}); code != 403 {
		t.Fatalf("OD create: want 403")
	}
	// Owner creates -> 200, IDR-formatted budget.
	code, body = do(t, lia, "POST", perf, map[string]any{"budget": "5000000"})
	if code != 200 || body["budget_idr"] != "Rp. 5.000.000,00" {
		t.Fatalf("owner create record: %d %v", code, body)
	}
	// 1:1 duplicate -> 409.
	if code, _ := do(t, lia, "POST", perf, map[string]any{"budget": "9000000"}); code != 409 {
		t.Fatalf("duplicate record: want 409")
	}

	// --- Update budget: owner via POST .../budget -> 200.
	if code, body := do(t, lia, "POST", perf+"/budget", map[string]any{"budget": "7000000"}); code != 200 || body["budget"] != "7000000.00" {
		t.Fatalf("owner update budget: %d %v", code, body)
	}
	// Non-owner staff -> 403.
	dina := login(t, srv, "dina@mea.co.id")
	if code, _ := do(t, dina, "POST", perf+"/budget", map[string]any{"budget": "1000000"}); code != 403 {
		t.Fatalf("non-owner update: want 403")
	}

	// --- GET record + metrics: owner + OD may read; foreign 403.
	if code, resp := do(t, lia, "GET", perf, nil); code != 200 || resp["record"] == nil || resp["metrics"] == nil {
		t.Fatalf("owner GET performance: %d %v", code, resp)
	}
	if code, _ := do(t, odi, "GET", perf, nil); code != 200 {
		t.Fatalf("OD GET performance: want 200")
	}
	if code, _ := do(t, sam, "GET", perf, nil); code != 403 {
		t.Fatalf("foreign GET performance: want 403")
	}

	// --- Dashboard split: Director creates a second campaign+record; lead sees both,
	// staff sees only own.
	code, body = do(t, yohan, "POST", base, map[string]any{"name": "Event Jakarta", "channel": "Event", "offline": true, "start_date": "2026-04-01"})
	if code != 200 {
		t.Fatalf("director create campaign: %d %v", code, body)
	}
	id2 := body["id"].(string)
	if code, _ := do(t, yohan, "POST", base+"/"+id2+"/performance", map[string]any{"budget": "3000000"}); code != 200 {
		t.Fatalf("director create record: want 200")
	}

	dash := srv.URL + "/api/v1/marketing/performance-dashboard"
	if code, resp := do(t, maya, "GET", dash, nil); code != 200 || len(resp["data"].([]any)) != 2 {
		t.Fatalf("lead dashboard: %d %v", code, resp)
	}
	if code, resp := do(t, lia, "GET", dash, nil); code != 200 || len(resp["data"].([]any)) != 1 {
		t.Fatalf("staff dashboard (own only): %d %v", code, resp)
	}
	if code, _ := do(t, sam, "GET", dash, nil); code != 403 {
		t.Fatalf("foreign dashboard: want 403")
	}
}
