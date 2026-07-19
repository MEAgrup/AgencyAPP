package httpapi_test

import (
	"net/http/httptest"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/httpapi"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

// setupAuthSrv wires a server with a role matrix for the local-auth HTTP tests.
// EMP-STAFF2 is provisioned with a temp password (must_change = 1); everyone
// else has an active "rahasia123" credential.
func setupAuthSrv(t *testing.T) (*httptest.Server, func()) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	testutil.InsertRoleMapping(t, d, "Sales", "Sales Executive", "Sales", "staff")
	testutil.InsertRoleMapping(t, d, "Sales", "Sales Head", "Sales", "lead")
	testutil.InsertRoleMapping(t, d, "Marketing", "Marketing Staff", "Marketing", "staff")

	testutil.InsertEmployee(t, d, "EMP-DIR", "Yohan", "dir@mea.co.id", "Management", "Director", true)
	testutil.InsertLayeredRole(t, d, "EMP-DIR", "director")
	testutil.InsertEmployee(t, d, "EMP-LEAD", "Dewi", "lead@mea.co.id", "Sales", "Sales Head", true)
	testutil.InsertEmployee(t, d, "EMP-STAFF", "Budi", "staff@mea.co.id", "Sales", "Sales Executive", true)
	testutil.InsertEmployee(t, d, "EMP-STAFF2", "Andi", "staff2@mea.co.id", "Sales", "Sales Executive", true)
	testutil.InsertEmployee(t, d, "EMP-MKT", "Lia", "mkt@mea.co.id", "Marketing", "Marketing Staff", true)
	testutil.InsertEmployee(t, d, "EMP-SLEAD2", "Sari", "slead2@mea.co.id", "Sales", "Sales Head", true)
	testutil.InsertLayeredRole(t, d, "EMP-SLEAD2", "director") // layered target the Lead cannot manage
	testutil.InsertEmployee(t, d, "EMP-NOMAP", "Nara", "nomap@mea.co.id", "Ops", "Ops Person", true)

	testutil.SeedCredentials(t, d, "rahasia123")
	testutil.SeedCredential(t, d, "EMP-STAFF2", "TempInit!234", true) // force-change pending

	app := httpapi.New(d, statemachine.New(), notification.NewCatalog(), nil)
	srv := httptest.NewServer(app.Router())
	return srv, srv.Close
}

func TestAuthHTTP_AdminSetPassword(t *testing.T) {
	srv, done := setupAuthSrv(t)
	defer done()

	dir := login(t, srv, "dir@mea.co.id")
	lead := login(t, srv, "lead@mea.co.id")
	staff := login(t, srv, "staff@mea.co.id")

	// Staff denied.
	code, body := do(t, staff, "POST", srv.URL+"/api/v1/auth/admin/set-password",
		map[string]string{"employee_id": "EMP-STAFF2", "temp_password": "TempPass!234"})
	if code != 403 || body["message"] != "[anda tidak memiliki akses untuk mengatur password karyawan ini]" {
		t.Fatalf("staff set-password: %d %v", code, body)
	}

	// Lead OK for same-division staff.
	code, _ = do(t, lead, "POST", srv.URL+"/api/v1/auth/admin/set-password",
		map[string]string{"employee_id": "EMP-STAFF", "temp_password": "TempPass!234"})
	if code != 204 {
		t.Fatalf("lead set-password same-div: %d", code)
	}

	// Lead denied cross-division.
	code, _ = do(t, lead, "POST", srv.URL+"/api/v1/auth/admin/set-password",
		map[string]string{"employee_id": "EMP-MKT", "temp_password": "TempPass!234"})
	if code != 403 {
		t.Fatalf("lead set-password cross-div: %d want 403", code)
	}

	// Lead denied for a layered target (no escalation).
	code, _ = do(t, lead, "POST", srv.URL+"/api/v1/auth/admin/set-password",
		map[string]string{"employee_id": "EMP-SLEAD2", "temp_password": "TempPass!234"})
	if code != 403 {
		t.Fatalf("lead set-password layered target: %d want 403", code)
	}

	// Lead denied for a target with no role mapping (Director only).
	code, _ = do(t, lead, "POST", srv.URL+"/api/v1/auth/admin/set-password",
		map[string]string{"employee_id": "EMP-NOMAP", "temp_password": "TempPass!234"})
	if code != 403 {
		t.Fatalf("lead set-password unmapped target: %d want 403", code)
	}

	// Director OK for the unmapped target.
	code, _ = do(t, dir, "POST", srv.URL+"/api/v1/auth/admin/set-password",
		map[string]string{"employee_id": "EMP-NOMAP", "temp_password": "TempPass!234"})
	if code != 204 {
		t.Fatalf("director set-password unmapped: %d", code)
	}

	// Non-existent target => 404 exact message.
	code, body = do(t, dir, "POST", srv.URL+"/api/v1/auth/admin/set-password",
		map[string]string{"employee_id": "EMP-GHOST", "temp_password": "TempPass!234"})
	if code != 404 || body["message"] != "[karyawan tidak ditemukan]" {
		t.Fatalf("set-password ghost: %d %v", code, body)
	}

	// Too-short temp => 400 exact message.
	code, body = do(t, dir, "POST", srv.URL+"/api/v1/auth/admin/set-password",
		map[string]string{"employee_id": "EMP-STAFF", "temp_password": "short"})
	if code != 400 || body["message"] != "[password minimal 8 karakter]" {
		t.Fatalf("set-password short: %d %v", code, body)
	}

	// The admin-set target must now change on next login.
	c := client(t)
	code, body = do(t, c, "POST", srv.URL+"/api/v1/auth/login",
		map[string]string{"email": "staff@mea.co.id", "password": "TempPass!234"})
	if code != 200 || body["must_change_password"] != true {
		t.Fatalf("target login after admin set: %d %v", code, body)
	}
}

func TestAuthHTTP_ChangePasswordAndForceChangeGate(t *testing.T) {
	srv, done := setupAuthSrv(t)
	defer done()

	// staff2 has a pending forced change.
	c := client(t)
	code, body := do(t, c, "POST", srv.URL+"/api/v1/auth/login",
		map[string]string{"email": "staff2@mea.co.id", "password": "TempInit!234"})
	if code != 200 || body["must_change_password"] != true {
		t.Fatalf("staff2 login: %d %v", code, body)
	}

	// A normal protected route is blocked by the gate.
	code, body = do(t, c, "GET", srv.URL+"/api/v1/notifications", nil)
	if code != 403 || body["message"] != "[wajib mengganti password terlebih dahulu]" {
		t.Fatalf("gate should block notifications: %d %v", code, body)
	}

	// me is exempt and still reports must_change.
	code, body = do(t, c, "GET", srv.URL+"/api/v1/auth/me", nil)
	if code != 200 || body["must_change_password"] != true {
		t.Fatalf("me under gate: %d %v", code, body)
	}

	// Wrong old password => 401 exact message.
	code, body = do(t, c, "POST", srv.URL+"/api/v1/auth/change-password",
		map[string]string{"old_password": "salah", "new_password": "BrandNew!234"})
	if code != 401 || body["message"] != "[password lama tidak sesuai]" {
		t.Fatalf("change wrong old: %d %v", code, body)
	}

	// New too short => 400 exact message.
	code, body = do(t, c, "POST", srv.URL+"/api/v1/auth/change-password",
		map[string]string{"old_password": "TempInit!234", "new_password": "short"})
	if code != 400 || body["message"] != "[password minimal 8 karakter]" {
		t.Fatalf("change short new: %d %v", code, body)
	}

	// Successful change clears the gate.
	code, _ = do(t, c, "POST", srv.URL+"/api/v1/auth/change-password",
		map[string]string{"old_password": "TempInit!234", "new_password": "BrandNew!234"})
	if code != 204 {
		t.Fatalf("change success: %d", code)
	}
	code, _ = do(t, c, "GET", srv.URL+"/api/v1/notifications", nil)
	if code != 200 {
		t.Fatalf("notifications after change: %d want 200", code)
	}
	code, body = do(t, c, "GET", srv.URL+"/api/v1/auth/me", nil)
	if code != 200 || body["must_change_password"] != false {
		t.Fatalf("me after change: %d %v", code, body)
	}
}

func TestAuthHTTP_ChangePasswordLockout(t *testing.T) {
	srv, done := setupAuthSrv(t)
	defer done()

	// staff logs in (correct password), then brute-forces the old password.
	c := login(t, srv, "staff@mea.co.id")

	// Five failed change-password attempts (wrong old_password) lock the account.
	for i := 0; i < 5; i++ {
		code, body := do(t, c, "POST", srv.URL+"/api/v1/auth/change-password",
			map[string]string{"old_password": "salah", "new_password": "BrandNew!234"})
		if code != 401 || body["message"] != "[password lama tidak sesuai]" {
			t.Fatalf("change failure %d: %d %v", i+1, code, body)
		}
	}

	// Now locked: even the correct old password is rejected with 423 + exact message.
	code, body := do(t, c, "POST", srv.URL+"/api/v1/auth/change-password",
		map[string]string{"old_password": "rahasia123", "new_password": "BrandNew!234"})
	if code != 423 || body["message"] != "[akun terkunci sementara karena percobaan gagal berulang, coba lagi dalam 15 menit]" {
		t.Fatalf("change while locked: %d %v", code, body)
	}
}

func TestAuthHTTP_CredentialsScoping(t *testing.T) {
	srv, done := setupAuthSrv(t)
	defer done()

	dir := login(t, srv, "dir@mea.co.id")
	lead := login(t, srv, "lead@mea.co.id")
	staff := login(t, srv, "staff@mea.co.id")

	code, body := do(t, dir, "GET", srv.URL+"/api/v1/auth/admin/credentials", nil)
	if code != 200 {
		t.Fatalf("director credentials: %d", code)
	}
	if len(body["data"].([]any)) < 6 {
		t.Fatalf("director should see all active employees: %v", body["data"])
	}

	code, body = do(t, lead, "GET", srv.URL+"/api/v1/auth/admin/credentials", nil)
	if code != 200 {
		t.Fatalf("lead credentials: %d", code)
	}
	for _, row := range body["data"].([]any) {
		if row.(map[string]any)["divisi"] != "Sales" {
			t.Fatalf("lead saw non-Sales row: %v", row)
		}
	}

	code, _ = do(t, staff, "GET", srv.URL+"/api/v1/auth/admin/credentials", nil)
	if code != 403 {
		t.Fatalf("staff credentials: %d want 403", code)
	}
}

func TestAuthHTTP_LoginLockout(t *testing.T) {
	srv, done := setupAuthSrv(t)
	defer done()

	// Five consecutive failures.
	for i := 0; i < 5; i++ {
		code, _ := do(t, client(t), "POST", srv.URL+"/api/v1/auth/login",
			map[string]string{"email": "staff@mea.co.id", "password": "bad-pass-x"})
		if code != 401 {
			t.Fatalf("failure %d: code=%d want 401", i+1, code)
		}
	}
	// Now locked: the correct password is rejected with 423.
	code, body := do(t, client(t), "POST", srv.URL+"/api/v1/auth/login",
		map[string]string{"email": "staff@mea.co.id", "password": "rahasia123"})
	if code != 423 || body["message"] != "[akun terkunci sementara karena percobaan gagal berulang, coba lagi dalam 15 menit]" {
		t.Fatalf("locked login: %d %v", code, body)
	}
}
