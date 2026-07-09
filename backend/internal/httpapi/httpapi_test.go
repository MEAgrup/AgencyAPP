package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/auth"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/httpapi"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

// fakeAuth maps fixture emails to employee ids; a sentinel email is unreachable.
type fakeAuth struct{}

func (fakeAuth) Verify(_ context.Context, email, password string) (string, error) {
	if email == "down@mea.co.id" {
		return "", auth.ErrUnreachable
	}
	if password != "rahasia123" {
		return "", auth.ErrInvalidCredentials
	}
	switch email {
	case "budi@mea.co.id":
		return "EMP-0001", nil
	case "dewi@mea.co.id":
		return "EMP-0006", nil
	case "yohan@mea.co.id":
		return "EMP-0008", nil
	}
	return "", auth.ErrInvalidCredentials
}

func setup(t *testing.T) (*httptest.Server, func()) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	testutil.InsertRoleMapping(t, d, "Sales", "Sales Executive", "Sales", "staff")
	testutil.InsertRoleMapping(t, d, "Sales", "Sales Head", "Sales", "lead")
	testutil.InsertEmployee(t, d, "EMP-0001", "Budi", "budi@mea.co.id", "Sales", "Sales Executive", true)
	testutil.InsertEmployee(t, d, "EMP-0006", "Dewi", "dewi@mea.co.id", "Sales", "Sales Head", true)
	testutil.InsertEmployee(t, d, "EMP-0008", "Yohan", "yohan@mea.co.id", "Management", "Director", true)
	testutil.InsertLayeredRole(t, d, "EMP-0008", "director")

	app := httpapi.New(d, statemachine.New(), notification.NewCatalog(), fakeAuth{}, nil)
	srv := httptest.NewServer(app.Router())
	return srv, srv.Close
}

func client(t *testing.T) *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar}
}

func do(t *testing.T, c *http.Client, method, url string, body any) (int, map[string]any) {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, url, rdr)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	raw, _ := io.ReadAll(resp.Body)
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &out)
	}
	return resp.StatusCode, out
}

func login(t *testing.T, srv *httptest.Server, email string) *http.Client {
	t.Helper()
	c := client(t)
	code, body := do(t, c, "POST", srv.URL+"/api/v1/auth/login", map[string]string{"email": email, "password": "rahasia123"})
	if code != 200 {
		t.Fatalf("login %s failed: %d %v", email, code, body)
	}
	return c
}

func TestAuth_LoginMeUnreachableUnknown(t *testing.T) {
	srv, done := setup(t)
	defer done()

	// Valid login.
	c := login(t, srv, "budi@mea.co.id")
	code, body := do(t, c, "GET", srv.URL+"/api/v1/me", nil)
	if code != 200 {
		t.Fatalf("me: %d", code)
	}
	role := body["role"].(map[string]any)
	if role["division"] != "Sales" || role["level"] != "staff" {
		t.Fatalf("unexpected role: %v", role)
	}

	// HRIS unreachable => 503 with EXACT message.
	code, body = do(t, client(t), "POST", srv.URL+"/api/v1/auth/login", map[string]string{"email": "down@mea.co.id", "password": "rahasia123"})
	if code != 503 || body["message"] != auth.HRISUnreachableMessage {
		t.Fatalf("unreachable: %d %v", code, body)
	}

	// Unknown employee (valid pw but not in DB) => 401.
	code, _ = do(t, client(t), "POST", srv.URL+"/api/v1/auth/login", map[string]string{"email": "ghost@mea.co.id", "password": "rahasia123"})
	if code != 401 {
		t.Fatalf("unknown login code=%d want 401", code)
	}
}

func TestDemoFlow_FullDemoPath(t *testing.T) {
	srv, done := setup(t)
	defer done()
	budi := login(t, srv, "budi@mea.co.id")

	// Missing title => 422 with EXACT message.
	code, body := do(t, budi, "POST", srv.URL+"/api/v1/demo-tasks", map[string]string{"description": "no title"})
	if code != 422 || body["message"] != "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" {
		t.Fatalf("missing title: %d %v", code, body)
	}

	// Create.
	code, body = do(t, budi, "POST", srv.URL+"/api/v1/demo-tasks", map[string]string{"title": "Brief Alpha"})
	if code != 200 {
		t.Fatalf("create: %d %v", code, body)
	}
	taskID := body["id"].(string)

	// Walk [To Do] -> [In Progress].
	code, body = do(t, budi, "POST", srv.URL+"/api/v1/demo-tasks/"+taskID+"/transition", map[string]string{"to": "[In Progress]"})
	if code != 200 {
		t.Fatalf("transition to In Progress: %d %v", code, body)
	}

	// Illegal jump [In Progress] -> [Approved] => 422 BI message.
	code, body = do(t, budi, "POST", srv.URL+"/api/v1/demo-tasks/"+taskID+"/transition", map[string]string{"to": "[Approved]"})
	if code != 422 || body["message"] != "[transisi status tidak diizinkan]" {
		t.Fatalf("illegal jump: %d %v", code, body)
	}

	// Staff attempts [Blocked] directly => 403 (SPV/Lead-only).
	code, body = do(t, budi, "POST", srv.URL+"/api/v1/demo-tasks/"+taskID+"/transition", map[string]string{"to": "[Blocked]"})
	if code != 403 {
		t.Fatalf("staff [Blocked]: %d %v (want 403)", code, body)
	}

	// Staff submits a block request => notifies division leads.
	code, body = do(t, budi, "POST", srv.URL+"/api/v1/demo-tasks/"+taskID+"/block-request", map[string]string{"reason": "menunggu aset dari klien"})
	if code != 200 {
		t.Fatalf("block-request: %d %v", code, body)
	}
	reqID := body["id"].(string)

	// Dewi (Sales lead) sees the notification.
	dewi := login(t, srv, "dewi@mea.co.id")
	code, body = do(t, dewi, "GET", srv.URL+"/api/v1/notifications?unread=1", nil)
	if code != 200 {
		t.Fatalf("dewi notifications: %d", code)
	}
	if int(body["unread_count"].(float64)) < 1 {
		t.Fatalf("dewi should have a block-request notification: %v", body)
	}

	// Dewi approves => engine drives [In Progress] -> [Blocked] as lead.
	code, body = do(t, dewi, "POST", srv.URL+"/api/v1/demo-tasks/"+taskID+"/block-requests/"+reqID+"/approve", nil)
	if code != 200 {
		t.Fatalf("approve: %d %v", code, body)
	}

	// Task is now [Blocked].
	code, body = do(t, budi, "GET", srv.URL+"/api/v1/demo-tasks/"+taskID, nil)
	if code != 200 {
		t.Fatalf("get task: %d", code)
	}
	task := body["task"].(map[string]any)
	if task["status"] != "[Blocked]" {
		t.Fatalf("status=%v want [Blocked]", task["status"])
	}

	// Budi (requester) got the decision notification.
	code, body = do(t, budi, "GET", srv.URL+"/api/v1/notifications?unread=1", nil)
	if int(body["unread_count"].(float64)) < 1 {
		t.Fatalf("budi should have a decision notification: %v", body)
	}

	// Audit trail contains create + transitions.
	code, body = do(t, budi, "GET", srv.URL+"/api/v1/audit?entity_type=demo_task&entity_id="+taskID, nil)
	if code != 200 {
		t.Fatalf("audit: %d", code)
	}
	entries := body["data"].([]any)
	if len(entries) < 3 {
		t.Fatalf("audit trail too short: %d entries", len(entries))
	}
}

func TestPermissions_MasterServiceAndAdmin(t *testing.T) {
	srv, done := setup(t)
	defer done()

	budi := login(t, srv, "budi@mea.co.id")   // Sales staff
	dewi := login(t, srv, "dewi@mea.co.id")   // Sales lead
	yohan := login(t, srv, "yohan@mea.co.id") // Director

	svc := map[string]any{"name": "Ads Management", "standard_price": "10000000.00", "commission_rule": "5%", "active": true, "effective_from": "2026-01-01"}

	// Sales staff denied with the exact BI message.
	code, body := do(t, budi, "POST", srv.URL+"/api/v1/master-services", svc)
	if code != 403 || body["message"] != "[anda tidak memiliki akses untuk mengubah master service list]" {
		t.Fatalf("staff master-service: %d %v", code, body)
	}
	// Sales lead allowed.
	code, body = do(t, dewi, "POST", srv.URL+"/api/v1/master-services", svc)
	if code != 200 {
		t.Fatalf("lead master-service: %d %v", code, body)
	}

	// Admin employees: staff denied, director allowed.
	code, _ = do(t, budi, "GET", srv.URL+"/api/v1/admin/employees", nil)
	if code != 403 {
		t.Fatalf("staff admin/employees code=%d want 403", code)
	}
	code, _ = do(t, yohan, "GET", srv.URL+"/api/v1/admin/employees", nil)
	if code != 200 {
		t.Fatalf("director admin/employees code=%d want 200", code)
	}
}
