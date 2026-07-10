package httpapi_test

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/auth"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/httpapi"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

// clientAuth maps fixture emails (password "rahasia123") to employee ids for the
// Module 4 / Module 5 (build stream B) endpoint tests.
type clientAuth struct{}

func (clientAuth) Verify(_ context.Context, email, password string) (string, error) {
	if password != "rahasia123" {
		return "", auth.ErrInvalidCredentials
	}
	m := map[string]string{
		"budi@mea.co.id":  "EMP-BUDI",  // Sales staff (owns clients)
		"andi@mea.co.id":  "EMP-ANDI",  // Sales staff (owns nothing here)
		"dewi@mea.co.id":  "EMP-DEWI",  // Sales lead
		"amel@mea.co.id":  "EMP-AMEL",  // Account staff
		"alia@mea.co.id":  "EMP-ALIA",  // Account lead
		"cakra@mea.co.id": "EMP-CAKRA", // Creative staff (no M4 access)
		"odi@mea.co.id":   "EMP-ODI",   // OD (layered)
		"yohan@mea.co.id": "EMP-YOHAN", // Director (layered)
	}
	if id, ok := m[email]; ok {
		return id, nil
	}
	return "", auth.ErrInvalidCredentials
}

// setupCF builds an app on build-stream-B's auth fixtures and seeds the role
// mappings + employees the M4/M5 endpoint tests share.
func setupCF(t *testing.T) (*httptest.Server, func()) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	testutil.InsertRoleMapping(t, d, "Sales", "Sales Executive", "Sales", "staff")
	testutil.InsertRoleMapping(t, d, "Sales", "Sales Head", "Sales", "lead")
	testutil.InsertRoleMapping(t, d, "Account", "Account Manager", "Account", "staff")
	testutil.InsertRoleMapping(t, d, "Account", "Account Lead", "Account", "lead")
	testutil.InsertRoleMapping(t, d, "Creative", "Creative Designer", "Creative", "staff")
	testutil.InsertEmployee(t, d, "EMP-BUDI", "Budi", "budi@mea.co.id", "Sales", "Sales Executive", true)
	testutil.InsertEmployee(t, d, "EMP-ANDI", "Andi", "andi@mea.co.id", "Sales", "Sales Executive", true)
	testutil.InsertEmployee(t, d, "EMP-DEWI", "Dewi", "dewi@mea.co.id", "Sales", "Sales Head", true)
	testutil.InsertEmployee(t, d, "EMP-AMEL", "Amel", "amel@mea.co.id", "Account", "Account Manager", true)
	testutil.InsertEmployee(t, d, "EMP-ALIA", "Alia", "alia@mea.co.id", "Account", "Account Lead", true)
	testutil.InsertEmployee(t, d, "EMP-CAKRA", "Cakra", "cakra@mea.co.id", "Creative", "Creative Designer", true)
	testutil.InsertEmployee(t, d, "EMP-ODI", "Odi", "odi@mea.co.id", "Management", "OD", true)
	testutil.InsertEmployee(t, d, "EMP-YOHAN", "Yohan", "yohan@mea.co.id", "Management", "Director", true)
	testutil.InsertLayeredRole(t, d, "EMP-ODI", "od")
	testutil.InsertLayeredRole(t, d, "EMP-YOHAN", "director")

	app := httpapi.New(d, statemachine.New(), notification.NewCatalog(), clientAuth{}, nil)
	srv := httptest.NewServer(app.Router())
	return srv, srv.Close
}

func seedCFClient(t *testing.T, id, salesPIC string, released bool) {
	t.Helper()
	d := testutil.DB(t)
	rel := "NULL"
	if released {
		rel = "NOW()"
	}
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
		  total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, created_by)
		 VALUES (?, 'PIC', ?, 'Kota', 'link', 'Fashion', '10000000.00', '20000000.00', '0.00', ?, ?, `+rel+`, 'TEST')`,
		id, id, salesPIC, salesPIC); err != nil {
		t.Fatal(err)
	}
}

func TestClientEndpoints_Visibility(t *testing.T) {
	srv, done := setupCF(t)
	defer done()
	seedCFClient(t, "CLI-PRE", "EMP-BUDI", false) // pre-verification
	seedCFClient(t, "CLI-REL", "EMP-BUDI", true)  // released to Account

	// Owner (Sales staff) sees own pre-verification client.
	budi := login(t, srv, "budi@mea.co.id")
	if code, _ := do(t, budi, "GET", srv.URL+"/api/v1/clients/CLI-PRE", nil); code != 200 {
		t.Fatalf("owner GET own client: %d", code)
	}
	// Another sales staff cannot (invisible -> 404).
	andi := login(t, srv, "andi@mea.co.id")
	if code, _ := do(t, andi, "GET", srv.URL+"/api/v1/clients/CLI-PRE", nil); code != 404 {
		t.Fatalf("other sales staff GET: %d want 404", code)
	}
	// Account staff: pre-verification invisible (404), released visible (200); list only released.
	amel := login(t, srv, "amel@mea.co.id")
	if code, _ := do(t, amel, "GET", srv.URL+"/api/v1/clients/CLI-PRE", nil); code != 404 {
		t.Fatalf("Account GET pre-verification: %d want 404", code)
	}
	if code, _ := do(t, amel, "GET", srv.URL+"/api/v1/clients/CLI-REL", nil); code != 200 {
		t.Fatalf("Account GET released: %d want 200", code)
	}
	code, body := do(t, amel, "GET", srv.URL+"/api/v1/clients", nil)
	if code != 200 {
		t.Fatalf("Account list: %d", code)
	}
	if data, _ := body["data"].([]any); len(data) != 1 {
		t.Fatalf("Account list len = %d, want 1 (released only)", len(data))
	}
	// Execution division has no M4 list access.
	cakra := login(t, srv, "cakra@mea.co.id")
	if code, _ := do(t, cakra, "GET", srv.URL+"/api/v1/clients", nil); code != 403 {
		t.Fatalf("creative list: %d want 403", code)
	}
	// Director sees all; money renders in the house convention.
	yohan := login(t, srv, "yohan@mea.co.id")
	code, body = do(t, yohan, "GET", srv.URL+"/api/v1/clients/CLI-REL", nil)
	if code != 200 {
		t.Fatalf("director GET: %d", code)
	}
	cl := body["client"].(map[string]any)
	if cl["gmv_baseline"] != "Rp. 10.000.000,00" {
		t.Errorf("gmv_baseline render = %v", cl["gmv_baseline"])
	}
}

func TestClientEndpoints_LockMatrix(t *testing.T) {
	srv, done := setupCF(t)
	defer done()
	seedCFClient(t, "CLI-REL", "EMP-BUDI", true)

	amel := login(t, srv, "amel@mea.co.id") // Account staff
	alia := login(t, srv, "alia@mea.co.id") // Account lead
	dewi := login(t, srv, "dewi@mea.co.id") // Sales lead

	// Account staff cannot correct a locked profile field -> 403 exact message.
	code, body := do(t, amel, "PATCH", srv.URL+"/api/v1/clients/CLI-REL", map[string]any{"toko": "Baru"})
	if code != 403 || body["message"] != "[field ini terkunci, tidak bisa diubah]" {
		t.Fatalf("account staff profile edit: %d %v", code, body)
	}
	// Account Lead may correct it.
	code, _ = do(t, alia, "PATCH", srv.URL+"/api/v1/clients/CLI-REL", map[string]any{"toko": "Toko Baru"})
	if code != 200 {
		t.Fatalf("account lead profile edit: %d", code)
	}
	// Nobody edits total_sales (auto) — even via the endpoint.
	code, body = do(t, dewi, "PATCH", srv.URL+"/api/v1/clients/CLI-REL", map[string]any{"total_sales": "999"})
	if code != 403 || body["message"] != "[field ini terkunci, tidak bisa diubah]" {
		t.Fatalf("total_sales edit: %d %v", code, body)
	}
	// Account revises Target GMV (money field).
	code, _ = do(t, amel, "PATCH", srv.URL+"/api/v1/clients/CLI-REL", map[string]any{"target_gmv": "50000000"})
	if code != 200 {
		t.Fatalf("account target_gmv: %d", code)
	}
	// Sales Lead reassigns Sales PIC.
	code, _ = do(t, dewi, "PATCH", srv.URL+"/api/v1/clients/CLI-REL", map[string]any{"sales_pic_id": "EMP-ANDI"})
	if code != 200 {
		t.Fatalf("sales lead reassign pic: %d", code)
	}
}

func seedCFService(t *testing.T, clientID, serviceID string) {
	t.Helper()
	d := testutil.DB(t)
	seedCFClient(t, clientID, "EMP-BUDI", false)
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO services (id, client_id, master_service_id, master_version_no, name, standard_price, commission_rule, status, created_by)
		 VALUES (?, ?, 'MSV-01', 1, 'Jasa X', '5000000.00', '10% of standard price', '[Briefed]', 'TEST')`,
		serviceID, clientID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO briefs (id, service_id, title, status, created_by) VALUES (?, ?, 'B', '[To Do]', 'TEST')`,
		serviceID+"-BRF", serviceID); err != nil {
		t.Fatal(err)
	}
}

func TestServiceVoidEndpoint(t *testing.T) {
	srv, done := setupCF(t)
	defer done()
	seedCFService(t, "CLI-S", "SVC-1")

	// Sales staff denied.
	budi := login(t, srv, "budi@mea.co.id")
	if code, _ := do(t, budi, "POST", srv.URL+"/api/v1/services/SVC-1/void", nil); code != 403 {
		t.Fatalf("sales staff void: %d want 403", code)
	}
	// OD denied (read-only).
	odi := login(t, srv, "odi@mea.co.id")
	if code, _ := do(t, odi, "POST", srv.URL+"/api/v1/services/SVC-1/void", nil); code != 403 {
		t.Fatalf("OD void: %d want 403", code)
	}
	// Account Lead allowed; cascade cancels the child brief.
	alia := login(t, srv, "alia@mea.co.id")
	code, body := do(t, alia, "POST", srv.URL+"/api/v1/services/SVC-1/void", nil)
	if code != 200 {
		t.Fatalf("account lead void: %d %v", code, body)
	}
	if voided, _ := body["voided_briefs"].([]any); len(voided) != 1 {
		t.Fatalf("voided_briefs = %v, want 1", body["voided_briefs"])
	}
	// Re-void blocked (terminal).
	code, body = do(t, alia, "POST", srv.URL+"/api/v1/services/SVC-1/void", nil)
	if code != 422 || body["message"] != "[transisi status tidak diizinkan]" {
		t.Fatalf("re-void: %d %v", code, body)
	}
}
