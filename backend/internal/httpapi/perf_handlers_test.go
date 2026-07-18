package httpapi_test

import (
	"net/http"
	"testing"
)

// TestPerfRoutes_DirectorHappyPath exercises the wired M14 routes end to end as
// the Director (full access): sweep, config reads, a Σ=100 weight write, the
// Σ≠100 rejection, and the team rollup read.
func TestPerfRoutes_DirectorHappyPath(t *testing.T) {
	srv, done := setup(t)
	defer done()
	dir := login(t, srv, "yohan@mea.co.id")

	// Snapshot sweep — Director only; fixture has no profiled staff, still 200.
	if code, _ := do(t, dir, "POST", srv.URL+"/api/v1/performance/snapshots/scan", nil); code != http.StatusOK {
		t.Fatalf("director scan = %d, want 200", code)
	}
	// Config reads: migration-seeded §2 Rule 2 weights + placeholder targets.
	code, wts := do(t, dir, "GET", srv.URL+"/api/v1/performance/config/weights", nil)
	if code != http.StatusOK {
		t.Fatalf("list weights = %d, want 200", code)
	}
	if wts["data"] == nil {
		t.Error("list weights: want seeded data")
	}
	if code, _ := do(t, dir, "GET", srv.URL+"/api/v1/performance/config/targets", nil); code != http.StatusOK {
		t.Fatalf("list targets = %d, want 200", code)
	}
	// Weight write with Σ≠100 → 400 with the approved BI string.
	bad := map[string]any{"role_type": "Creative", "weights": map[string]float64{
		"speed_score": 30, "output_quantity": 30, "gmv_impact": 30, "revision_count": 30}}
	code, body := do(t, dir, "PUT", srv.URL+"/api/v1/performance/config/weights", bad)
	if code != http.StatusBadRequest {
		t.Fatalf("bad-sum weights = %d, want 400", code)
	}
	if body["message"] != "[total bobot KPI harus berjumlah 100]" {
		t.Errorf("bad-sum message = %v", body["message"])
	}
	// Valid retune (OA-5 admin-configurable) → 200.
	good := map[string]any{"role_type": "Creative", "weights": map[string]float64{
		"speed_score": 25, "output_quantity": 25, "gmv_impact": 25, "revision_count": 25}}
	if code, _ := do(t, dir, "PUT", srv.URL+"/api/v1/performance/config/weights", good); code != http.StatusOK {
		t.Fatalf("valid weights = %d, want 200", code)
	}
	// Team rollup read (derived-on-read; empty division is a valid 200).
	if code, _ := do(t, dir, "GET", srv.URL+"/api/v1/performance/teams/Creative", nil); code != http.StatusOK {
		t.Fatalf("team rollup = %d, want 200", code)
	}
	// No snapshot stored for an unprofiled staff → 404.
	if code, _ := do(t, dir, "GET", srv.URL+"/api/v1/staff/EMP-0001/performance", nil); code != http.StatusNotFound {
		t.Errorf("get perf without snapshot = %d, want 404", code)
	}
}

// TestPerfRoutes_Gates checks the management gates at the HTTP boundary: a Sales
// staffer may not run the sweep nor write config (Director only).
func TestPerfRoutes_Gates(t *testing.T) {
	srv, done := setup(t)
	defer done()
	sales := login(t, srv, "budi@mea.co.id") // Sales staff

	if code, body := do(t, sales, "POST", srv.URL+"/api/v1/performance/snapshots/scan", nil); code != http.StatusForbidden {
		t.Errorf("sales scan = %d (%v), want 403", code, body["message"])
	}
	good := map[string]any{"role_type": "Creative", "weights": map[string]float64{
		"speed_score": 25, "output_quantity": 25, "gmv_impact": 25, "revision_count": 25}}
	if code, body := do(t, sales, "PUT", srv.URL+"/api/v1/performance/config/weights", good); code != http.StatusForbidden {
		t.Errorf("sales set weights = %d (%v), want 403", code, body["message"])
	}
}
