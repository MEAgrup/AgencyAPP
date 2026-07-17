package httpapi_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

// seedHealthClient inserts one released client (assigned to EMP-AM) so the M13
// endpoints have something to score.
func seedHealthClient(t *testing.T, id string) {
	t.Helper()
	d := testutil.DB(t)
	if _, err := d.Exec(
		`INSERT INTO clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
		   total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_at, created_by)
		 VALUES (?, 'PIC', ?, 'Bandung', 'link', 'Fashion', '50000000.00', '80000000.00', '62000000.00',
		         'EMP-0001', 'EMP-0001', NOW(), 'EMP-AM', ?, 'TEST')`,
		id, id, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatal(err)
	}
}

// TestHealthRoutes_DirectorHappyPath exercises the wired M13 routes end to end as
// the Director (full access): scan, live preview, latest snapshot, ROAS toggle.
func TestHealthRoutes_DirectorHappyPath(t *testing.T) {
	srv, done := setup(t)
	defer done()
	seedHealthClient(t, "CLI-H1")
	dir := login(t, srv, "yohan@mea.co.id")

	// Snapshot sweep — Director may run it.
	if code, _ := do(t, dir, "POST", srv.URL+"/api/v1/health/snapshots/scan", nil); code != http.StatusOK {
		t.Fatalf("director scan = %d, want 200", code)
	}
	// Live preview (current month; independent of the sweep).
	code, body := do(t, dir, "GET", srv.URL+"/api/v1/clients/CLI-H1/health/preview", nil)
	if code != http.StatusOK {
		t.Fatalf("preview = %d, want 200", code)
	}
	if body["preview"] != true {
		t.Errorf("preview flag = %v, want true", body["preview"])
	}
	// Latest stored snapshot exists after the sweep.
	if code, _ := do(t, dir, "GET", srv.URL+"/api/v1/clients/CLI-H1/health", nil); code != http.StatusOK {
		t.Fatalf("get latest snapshot = %d, want 200", code)
	}
	// Trend read.
	if code, _ := do(t, dir, "GET", srv.URL+"/api/v1/clients/CLI-H1/health/trend", nil); code != http.StatusOK {
		t.Fatalf("trend = %d, want 200", code)
	}
	// ROAS toggle: set OFF then read back.
	code, tg := do(t, dir, "PUT", srv.URL+"/api/v1/clients/CLI-H1/health/roas-toggle", map[string]any{"override": false})
	if code != http.StatusOK {
		t.Fatalf("set toggle = %d, want 200", code)
	}
	if tg["override"] != false {
		t.Errorf("toggle override = %v, want false", tg["override"])
	}
	// Unknown client → 404.
	if code, _ := do(t, dir, "GET", srv.URL+"/api/v1/clients/CLI-NOPE/health/preview", nil); code != http.StatusNotFound {
		t.Errorf("unknown client preview = %d, want 404", code)
	}
}

// TestHealthRoutes_ScopeGates checks the role gates at the HTTP boundary: a Sales
// staffer has no M13 scope, so every read is 403 and the scan is 403.
func TestHealthRoutes_ScopeGates(t *testing.T) {
	srv, done := setup(t)
	defer done()
	seedHealthClient(t, "CLI-H2")
	sales := login(t, srv, "budi@mea.co.id") // Sales staff — no Account scope

	if code, _ := do(t, sales, "POST", srv.URL+"/api/v1/health/snapshots/scan", nil); code != http.StatusForbidden {
		t.Errorf("sales scan = %d, want 403", code)
	}
	if code, _ := do(t, sales, "GET", srv.URL+"/api/v1/clients/CLI-H2/health/preview", nil); code != http.StatusForbidden {
		t.Errorf("sales preview = %d, want 403", code)
	}
	if code, _ := do(t, sales, "GET", srv.URL+"/api/v1/clients/CLI-H2/health/trend", nil); code != http.StatusForbidden {
		t.Errorf("sales trend = %d, want 403", code)
	}
}
