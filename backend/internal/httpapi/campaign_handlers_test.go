package httpapi_test

import (
	"context"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/auth"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/httpapi"
	"net/http/httptest"

	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

// cmpAuth maps the Module 3 (Campaign) fixture emails (password "rahasia123") to ids.
type cmpAuth struct{}

func (cmpAuth) Verify(_ context.Context, email, password string) (string, error) {
	if password != "rahasia123" {
		return "", auth.ErrInvalidCredentials
	}
	m := map[string]string{
		"lia@mea.co.id":   "EMP-LIA",   // Marketing staff (owner)
		"dina@mea.co.id":  "EMP-DINA",  // Marketing staff (reassign target)
		"maya@mea.co.id":  "EMP-MHEAD", // Marketing head (lead)
		"sam@mea.co.id":   "EMP-SAL",   // Sales staff (foreign)
		"odi@mea.co.id":   "EMP-ODI",   // OD (read-only)
		"yohan@mea.co.id": "EMP-YOHAN", // Director
	}
	if id, ok := m[email]; ok {
		return id, nil
	}
	return "", auth.ErrInvalidCredentials
}

func setupCMP(t *testing.T) (*httptest.Server, func()) {
	t.Helper()
	d := testutil.DB(t)
	testutil.Clean(t, d)
	testutil.InsertRoleMapping(t, d, "Marketing", "Marketing Staff", "Marketing", "staff")
	testutil.InsertRoleMapping(t, d, "Marketing", "Marketing Head", "Marketing", "lead")
	testutil.InsertRoleMapping(t, d, "Sales", "Sales Executive", "Sales", "staff")
	testutil.InsertEmployee(t, d, "EMP-LIA", "Lia", "lia@mea.co.id", "Marketing", "Marketing Staff", true)
	testutil.InsertEmployee(t, d, "EMP-DINA", "Dina", "dina@mea.co.id", "Marketing", "Marketing Staff", true)
	testutil.InsertEmployee(t, d, "EMP-MHEAD", "Maya", "maya@mea.co.id", "Marketing", "Marketing Head", true)
	testutil.InsertEmployee(t, d, "EMP-SAL", "Sam", "sam@mea.co.id", "Sales", "Sales Executive", true)
	testutil.InsertEmployee(t, d, "EMP-ODI", "Odi", "odi@mea.co.id", "Management", "OD", true)
	testutil.InsertEmployee(t, d, "EMP-YOHAN", "Yohan", "yohan@mea.co.id", "Management", "Director", true)
	testutil.InsertLayeredRole(t, d, "EMP-ODI", "od")
	testutil.InsertLayeredRole(t, d, "EMP-YOHAN", "director")

	app := httpapi.New(d, statemachine.New(), notification.NewCatalog(), cmpAuth{}, nil)
	srv := httptest.NewServer(app.Router())
	return srv, srv.Close
}

// TestCampaignEndpoints exercises the Module 3 (Campaign) HTTP surface
// (/api/v1/marketing/campaigns): create validation, born status, per-role permissions
// (incl. layered OD/Director), the lifecycle transition (legal + blocked), Closed
// stamping end_date, and ownership reassignment.
func TestCampaignEndpoints(t *testing.T) {
	srv, done := setupCMP(t)
	defer done()

	lia := login(t, srv, "lia@mea.co.id")
	maya := login(t, srv, "maya@mea.co.id")
	sam := login(t, srv, "sam@mea.co.id")
	odi := login(t, srv, "odi@mea.co.id")
	yohan := login(t, srv, "yohan@mea.co.id")

	base := srv.URL + "/api/v1/marketing/campaigns"
	valid := map[string]any{"name": "Promo Skilskul Maret", "channel": "TikTok Ads", "online": true, "start_date": "2026-03-02"}

	// --- Create: incomplete -> 422 with the house default BI message.
	if code, body := do(t, lia, "POST", base, map[string]any{"name": "x", "online": true, "start_date": "2026-03-02"}); code != 422 || body["message"] != "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" {
		t.Fatalf("incomplete create: %d %v", code, body)
	}
	// Foreign division -> 403.
	if code, body := do(t, sam, "POST", base, valid); code != 403 || body["message"] != "[anda tidak memiliki akses ke data ini]" {
		t.Fatalf("sales create: %d %v", code, body)
	}
	// Marketing staff creates -> 200, born Draft, owned by Lia.
	code, body := do(t, lia, "POST", base, valid)
	if code != 200 || body["status"] != "Draft" {
		t.Fatalf("create: %d %v", code, body)
	}
	id := body["id"].(string)
	campaign := base + "/" + id

	// --- Read gate: owner + lead + OD + Director see it; foreign 403; missing 404.
	if code, _ := do(t, lia, "GET", campaign, nil); code != 200 {
		t.Fatalf("owner GET: want 200")
	}
	if code, _ := do(t, maya, "GET", campaign, nil); code != 200 {
		t.Fatalf("lead GET: want 200")
	}
	if code, _ := do(t, odi, "GET", campaign, nil); code != 200 {
		t.Fatalf("OD GET: want 200")
	}
	if code, body := do(t, sam, "GET", campaign, nil); code != 403 || body["message"] != "[anda tidak memiliki akses ke data ini]" {
		t.Fatalf("foreign GET: %d %v", code, body)
	}
	if code, body := do(t, lia, "GET", base+"/CMP-000000-9999", nil); code != 404 || body["message"] != "[data tidak ditemukan]" {
		t.Fatalf("missing GET: %d %v", code, body)
	}

	// --- Transition: illegal Draft->Closed blocked; OD write denied; owner advances.
	if code, body := do(t, lia, "POST", campaign+"/transition", map[string]any{"to": "Closed"}); code != 422 || body["message"] != "[transisi status tidak diizinkan]" {
		t.Fatalf("illegal transition: %d %v", code, body)
	}
	if code, _ := do(t, odi, "POST", campaign+"/transition", map[string]any{"to": "Active"}); code != 403 {
		t.Fatalf("OD transition: want 403")
	}
	if code, _ := do(t, lia, "POST", campaign+"/transition", map[string]any{"to": "Active"}); code != 200 {
		t.Fatalf("owner ->Active: want 200")
	}
	// Closed stamps end_date.
	if code, _ := do(t, lia, "POST", campaign+"/transition", map[string]any{"to": "Closed"}); code != 200 {
		t.Fatalf("owner ->Closed: want 200")
	}
	if _, body := do(t, lia, "GET", campaign, nil); body["end_date"] == nil {
		t.Fatalf("end_date not set after Closed: %v", body)
	}

	// --- Reassign: staff (owner) denied; lead reassigns; Director allowed.
	if code, _ := do(t, lia, "POST", campaign+"/reassign", map[string]any{"owner_employee_id": "EMP-DINA"}); code != 403 {
		t.Fatalf("owner reassign: want 403")
	}
	if code, body := do(t, maya, "POST", campaign+"/reassign", map[string]any{"owner_employee_id": "EMP-DINA"}); code != 200 || body["owner_employee_id"] != "EMP-DINA" {
		t.Fatalf("lead reassign: %d %v", code, body)
	}
	// Reassign to a non-Marketing employee -> 404 (no valid Marketing owner).
	if code, body := do(t, yohan, "POST", campaign+"/reassign", map[string]any{"owner_employee_id": "EMP-SAL"}); code != 404 || body["message"] != "[data tidak ditemukan]" {
		t.Fatalf("reassign to sales: %d %v", code, body)
	}

	// --- List scope: staff own-only; lead all; foreign 403.
	if code, _ := do(t, yohan, "POST", base, map[string]any{"name": "Event Jakarta", "channel": "Event", "offline": true, "start_date": "2026-04-01"}); code != 200 {
		t.Fatalf("director create second: want 200")
	}
	if code, body := do(t, maya, "GET", base, nil); code != 200 || len(body["data"].([]any)) != 2 {
		t.Fatalf("lead list: %d %v", code, body)
	}
	if code, body := do(t, sam, "GET", base, nil); code != 403 {
		t.Fatalf("foreign list: %d %v", code, body)
	}
}
