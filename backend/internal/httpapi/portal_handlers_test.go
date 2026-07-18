package httpapi_test

import (
	"net/http"
	"testing"
)

// TestPortalRoutes_MeAndGates exercises the wired M15 Team Portal routes at the HTTP
// boundary: the staff landing is reachable by any authenticated staffer, while the
// SPV/Lead and Management surfaces are gated (staff denied on both; a non-management
// lead denied on management; Director allowed on management).
func TestPortalRoutes_MeAndGates(t *testing.T) {
	srv, done := setup(t)
	defer done()
	budi := login(t, srv, "budi@mea.co.id")   // Sales staff
	dewi := login(t, srv, "dewi@mea.co.id")   // Sales lead
	yohan := login(t, srv, "yohan@mea.co.id") // Director

	// Staff landing: any authenticated actor may see their OWN landing (200). A Sales
	// staffer has no KPI Profile, so running_score is null — still a 200.
	code, body := do(t, budi, "GET", srv.URL+"/api/v1/portal/me", nil)
	if code != http.StatusOK {
		t.Fatalf("staff /portal/me = %d, want 200", code)
	}
	if _, ok := body["open_tasks"]; !ok {
		t.Error("/portal/me should carry open_tasks")
	}
	if body["running_score"] != nil {
		t.Error("Sales staff /portal/me: running_score should be null (no KPI Profile)")
	}

	// Team variant: a Sales staffer is not a lead → 403 with the shared access string.
	if code, b := do(t, budi, "GET", srv.URL+"/api/v1/portal/team", nil); code != http.StatusForbidden {
		t.Errorf("staff /portal/team = %d (%v), want 403", code, b["message"])
	}
	// Management: staff and a non-management lead are both denied (Rule 11).
	if code, _ := do(t, budi, "GET", srv.URL+"/api/v1/portal/management", nil); code != http.StatusForbidden {
		t.Errorf("staff /portal/management = %d, want 403", code)
	}
	if code, _ := do(t, dewi, "GET", srv.URL+"/api/v1/portal/management", nil); code != http.StatusForbidden {
		t.Errorf("sales lead /portal/management = %d, want 403", code)
	}
	// Director sees the Management Dashboard (empty portfolio is a valid 200).
	code, dash := do(t, yohan, "GET", srv.URL+"/api/v1/portal/management", nil)
	if code != http.StatusOK {
		t.Fatalf("director /portal/management = %d, want 200", code)
	}
	if _, ok := dash["rows"]; !ok {
		t.Error("management dashboard should carry rows")
	}
}
