package auth_test

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/auth"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

// director / lead / staff actors for the admin-authorization tests.
func director() permission.Actor {
	return permission.Actor{EmployeeID: "EMP-DIR", Role: permission.Role{Director: true}}
}
func salesLead() permission.Actor {
	return permission.Actor{EmployeeID: "EMP-LEAD", Role: permission.Role{Division: "Sales", Level: permission.LevelLead}}
}
func salesStaff() permission.Actor {
	return permission.Actor{EmployeeID: "EMP-STAFF", Role: permission.Role{Division: "Sales", Level: permission.LevelStaff}}
}

// seedProvisioned sets a temporary password (must_change=1) as Director.
func seedProvisioned(t *testing.T, d *sql.DB, empID, temp string) {
	t.Helper()
	if err := auth.SetPassword(context.Background(), d, director(), empID, temp); err != nil {
		t.Fatalf("seed provision %s: %v", empID, err)
	}
}

func baseFixture(t *testing.T) *sql.DB {
	t.Helper()
	d := testutil.DB(t)
	testutil.Clean(t, d)
	testutil.InsertRoleMapping(t, d, "Sales", "Sales Executive", "Sales", "staff")
	testutil.InsertRoleMapping(t, d, "Sales", "Sales Head", "Sales", "lead")
	testutil.InsertRoleMapping(t, d, "Marketing", "Marketing Staff", "Marketing", "staff")
	testutil.InsertEmployee(t, d, "EMP-SALES", "Sari", "sari@mea.co.id", "Sales", "Sales Executive", true)
	testutil.InsertEmployee(t, d, "EMP-MKT", "Miko", "miko@mea.co.id", "Marketing", "Marketing Staff", true)
	testutil.InsertEmployee(t, d, "EMP-OFF", "Ola", "ola@mea.co.id", "Sales", "Sales Executive", false)
	return d
}

func TestVerifyLocal_SuccessFailUnprovisionedInactive(t *testing.T) {
	d := baseFixture(t)
	ctx := context.Background()
	seedProvisioned(t, d, "EMP-SALES", "TempPass!234")

	// Success (temp password still valid; must_change flagged).
	id, mustChange, err := auth.VerifyLocal(ctx, d, "sari@mea.co.id", "TempPass!234")
	if err != nil || id != "EMP-SALES" || !mustChange {
		t.Fatalf("success: id=%q must=%v err=%v", id, mustChange, err)
	}

	// Wrong password.
	if _, _, err := auth.VerifyLocal(ctx, d, "sari@mea.co.id", "wrong-pass-000"); !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("wrong pw: %v", err)
	}
	// Unknown email.
	if _, _, err := auth.VerifyLocal(ctx, d, "ghost@mea.co.id", "TempPass!234"); !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("unknown email: %v", err)
	}
	// Active but not provisioned.
	if _, _, err := auth.VerifyLocal(ctx, d, "miko@mea.co.id", "TempPass!234"); !errors.Is(err, auth.ErrNotProvisioned) {
		t.Fatalf("unprovisioned: %v", err)
	}
	// Inactive employee, even if provisioned.
	seedProvisionedInactive := func() {
		// reactivate to allow provisioning, then deactivate again.
		if _, err := d.Exec(`UPDATE employees SET status_aktif=1 WHERE employee_id='EMP-OFF'`); err != nil {
			t.Fatal(err)
		}
		seedProvisioned(t, d, "EMP-OFF", "TempPass!234")
		if _, err := d.Exec(`UPDATE employees SET status_aktif=0 WHERE employee_id='EMP-OFF'`); err != nil {
			t.Fatal(err)
		}
	}
	seedProvisionedInactive()
	if _, _, err := auth.VerifyLocal(ctx, d, "ola@mea.co.id", "TempPass!234"); !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("inactive: %v", err)
	}
}

func TestLockout_FifthFailureLocksAndExpiry(t *testing.T) {
	d := baseFixture(t)
	ctx := context.Background()
	seedProvisioned(t, d, "EMP-SALES", "TempPass!234")

	// Four failures: still invalid-credentials, not locked yet.
	for i := 0; i < 4; i++ {
		if _, _, err := auth.VerifyLocal(ctx, d, "sari@mea.co.id", "bad-pass-x"); !errors.Is(err, auth.ErrInvalidCredentials) {
			t.Fatalf("attempt %d: %v", i+1, err)
		}
	}
	// Fifth failure locks the account.
	if _, _, err := auth.VerifyLocal(ctx, d, "sari@mea.co.id", "bad-pass-x"); !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("fifth failure: %v", err)
	}
	// Correct password is now rejected while locked.
	if _, _, err := auth.VerifyLocal(ctx, d, "sari@mea.co.id", "TempPass!234"); !errors.Is(err, auth.ErrLocked) {
		t.Fatalf("locked-with-correct-pw: %v", err)
	}
	// account_locked audit row exists.
	entries, err := loadCredAudit(t, d, "EMP-SALES")
	if err != nil {
		t.Fatal(err)
	}
	if !hasAction(entries, "account_locked") {
		t.Fatalf("expected account_locked audit, got %v", actions(entries))
	}

	// Simulate lock expiry, then a fresh failure starts a new cycle from one.
	if _, err := d.Exec(`UPDATE employee_credentials SET locked_until = ? WHERE employee_id='EMP-SALES'`,
		time.Now().Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := auth.VerifyLocal(ctx, d, "sari@mea.co.id", "bad-pass-x"); !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("post-expiry failure: %v", err)
	}
	var attempts int
	var locked sql.NullTime
	if err := d.QueryRow(`SELECT failed_attempts, locked_until FROM employee_credentials WHERE employee_id='EMP-SALES'`).
		Scan(&attempts, &locked); err != nil {
		t.Fatal(err)
	}
	if attempts != 1 || (locked.Valid && locked.Time.After(time.Now())) {
		t.Fatalf("post-expiry state attempts=%d locked=%v want attempts=1 not-locked", attempts, locked)
	}
	// Correct password now succeeds and clears the counter.
	if _, _, err := auth.VerifyLocal(ctx, d, "sari@mea.co.id", "TempPass!234"); err != nil {
		t.Fatalf("post-expiry success: %v", err)
	}
}

func TestChangePassword_Flow(t *testing.T) {
	d := baseFixture(t)
	ctx := context.Background()
	seedProvisioned(t, d, "EMP-SALES", "TempPass!234")

	// Two sessions for the same employee; only "keep" survives the change.
	keep, err := auth.CreateSession(ctx, d, "EMP-SALES")
	if err != nil {
		t.Fatal(err)
	}
	other, err := auth.CreateSession(ctx, d, "EMP-SALES")
	if err != nil {
		t.Fatal(err)
	}

	// Old password mismatch.
	if err := auth.ChangePassword(ctx, d, "EMP-SALES", keep, "not-the-temp", "BrandNew!234"); !errors.Is(err, auth.ErrOldPasswordMismatch) {
		t.Fatalf("old mismatch: %v", err)
	}
	// Too short.
	if err := auth.ChangePassword(ctx, d, "EMP-SALES", keep, "TempPass!234", "short"); !errors.Is(err, auth.ErrWeakPassword) {
		t.Fatalf("too short: %v", err)
	}
	// Too long (> 72 bytes).
	long := make([]byte, 73)
	for i := range long {
		long[i] = 'a'
	}
	if err := auth.ChangePassword(ctx, d, "EMP-SALES", keep, "TempPass!234", string(long)); !errors.Is(err, auth.ErrPasswordTooLong) {
		t.Fatalf("too long: %v", err)
	}
	// Success.
	if err := auth.ChangePassword(ctx, d, "EMP-SALES", keep, "TempPass!234", "BrandNew!234"); err != nil {
		t.Fatalf("change ok: %v", err)
	}
	// must_change cleared; new password verifies (must=false).
	_, mustChange, err := auth.VerifyLocal(ctx, d, "sari@mea.co.id", "BrandNew!234")
	if err != nil || mustChange {
		t.Fatalf("after change: must=%v err=%v", mustChange, err)
	}
	// Kept session still valid; other session revoked.
	if _, err := auth.ResolveSession(ctx, d, keep); err != nil {
		t.Fatalf("kept session revoked: %v", err)
	}
	if _, err := auth.ResolveSession(ctx, d, other); !errors.Is(err, auth.ErrNoSession) {
		t.Fatalf("other session should be revoked: %v", err)
	}
	if e, _ := loadCredAudit(t, d, "EMP-SALES"); !hasAction(e, "password_changed_self") {
		t.Fatalf("expected password_changed_self audit")
	}
}

func TestChangePassword_SharedLockoutWithLogin(t *testing.T) {
	d := baseFixture(t)
	ctx := context.Background()
	seedProvisioned(t, d, "EMP-SALES", "TempPass!234")

	// Two failed logins raise the shared counter to 2.
	for i := 0; i < 2; i++ {
		if _, _, err := auth.VerifyLocal(ctx, d, "sari@mea.co.id", "bad-pass-x"); !errors.Is(err, auth.ErrInvalidCredentials) {
			t.Fatalf("login failure %d: %v", i+1, err)
		}
	}
	// Three failed ChangePassword attempts (wrong old_password) push it to 5 => locked.
	for i := 0; i < 3; i++ {
		if err := auth.ChangePassword(ctx, d, "EMP-SALES", "", "wrong-old-pw", "BrandNew!234"); !errors.Is(err, auth.ErrOldPasswordMismatch) {
			t.Fatalf("change failure %d: %v", i+1, err)
		}
	}

	// ChangePassword with the CORRECT old password is now rejected while locked.
	if err := auth.ChangePassword(ctx, d, "EMP-SALES", "", "TempPass!234", "BrandNew!234"); !errors.Is(err, auth.ErrLocked) {
		t.Fatalf("change while locked (correct old): %v", err)
	}
	// VerifyLocal with the CORRECT password is likewise locked (shared, both directions).
	if _, _, err := auth.VerifyLocal(ctx, d, "sari@mea.co.id", "TempPass!234"); !errors.Is(err, auth.ErrLocked) {
		t.Fatalf("login while locked (correct pw): %v", err)
	}

	// account_locked audit row exists.
	entries, err := loadCredAudit(t, d, "EMP-SALES")
	if err != nil {
		t.Fatal(err)
	}
	if !hasAction(entries, "account_locked") {
		t.Fatalf("expected account_locked audit, got %v", actions(entries))
	}

	// Simulate lock expiry, then a correct ChangePassword succeeds and clears state.
	if _, err := d.Exec(`UPDATE employee_credentials SET locked_until = ? WHERE employee_id='EMP-SALES'`,
		time.Now().Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := auth.ChangePassword(ctx, d, "EMP-SALES", "", "TempPass!234", "BrandNew!234"); err != nil {
		t.Fatalf("change after expiry: %v", err)
	}
	var attempts int
	var locked sql.NullTime
	if err := d.QueryRow(`SELECT failed_attempts, locked_until FROM employee_credentials WHERE employee_id='EMP-SALES'`).
		Scan(&attempts, &locked); err != nil {
		t.Fatal(err)
	}
	if attempts != 0 || locked.Valid {
		t.Fatalf("post-change state attempts=%d locked=%v want attempts=0 locked=NULL", attempts, locked)
	}
	// New password verifies (force-change cleared).
	if _, _, err := auth.VerifyLocal(ctx, d, "sari@mea.co.id", "BrandNew!234"); err != nil {
		t.Fatalf("verify new password: %v", err)
	}
}

func TestSetPassword_Authorization(t *testing.T) {
	d := baseFixture(t)
	ctx := context.Background()
	// A layered (director) target in Sales, and a Director target.
	testutil.InsertEmployee(t, d, "EMP-SLEAD", "Dedi", "dedi@mea.co.id", "Sales", "Sales Head", true)
	testutil.InsertEmployee(t, d, "EMP-NOMAP", "Nara", "nara@mea.co.id", "Ops", "Ops Person", true) // no role mapping
	testutil.InsertLayeredRole(t, d, "EMP-SLEAD", "director")

	cases := []struct {
		name   string
		admin  permission.Actor
		target string
		want   error
	}{
		{"director any division", director(), "EMP-MKT", nil},
		{"director unmapped target", director(), "EMP-NOMAP", nil},
		{"lead own division", salesLead(), "EMP-SALES", nil},
		{"lead other division", salesLead(), "EMP-MKT", auth.ErrForbidden},
		{"lead layered target", salesLead(), "EMP-SLEAD", auth.ErrForbidden},
		{"lead unmapped target", salesLead(), "EMP-NOMAP", auth.ErrForbidden},
		{"staff denied", salesStaff(), "EMP-SALES", auth.ErrForbidden},
		{"target not found", director(), "EMP-GHOST", auth.ErrEmployeeNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := auth.SetPassword(ctx, d, tc.admin, tc.target, "TempPass!234")
			if tc.want == nil && err != nil {
				t.Fatalf("want ok, got %v", err)
			}
			if tc.want != nil && !errors.Is(err, tc.want) {
				t.Fatalf("want %v, got %v", tc.want, err)
			}
		})
	}
}

func TestSetPassword_RevokesTargetSessionsAndAudits(t *testing.T) {
	d := baseFixture(t)
	ctx := context.Background()
	seedProvisioned(t, d, "EMP-SALES", "TempPass!234")
	tok, err := auth.CreateSession(ctx, d, "EMP-SALES")
	if err != nil {
		t.Fatal(err)
	}
	if err := auth.SetPassword(ctx, d, director(), "EMP-SALES", "ResetPass!99"); err != nil {
		t.Fatal(err)
	}
	if _, err := auth.ResolveSession(ctx, d, tok); !errors.Is(err, auth.ErrNoSession) {
		t.Fatalf("target session should be revoked: %v", err)
	}
	if e, _ := loadCredAudit(t, d, "EMP-SALES"); !hasAction(e, "password_set_admin") {
		t.Fatalf("expected password_set_admin audit")
	}
	// The reset forces a change again.
	_, mustChange, err := auth.VerifyLocal(ctx, d, "sari@mea.co.id", "ResetPass!99")
	if err != nil || !mustChange {
		t.Fatalf("after reset: must=%v err=%v", mustChange, err)
	}
}

func TestListCredentials_Scoping(t *testing.T) {
	d := baseFixture(t)
	ctx := context.Background()
	seedProvisioned(t, d, "EMP-SALES", "TempPass!234")

	// Director sees all active employees.
	all, err := auth.ListCredentials(ctx, d, director())
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 { // EMP-SALES + EMP-MKT (EMP-OFF is inactive)
		t.Fatalf("director count=%d want 2 (%v)", len(all), all)
	}
	// Lead sees only their division.
	leadView, err := auth.ListCredentials(ctx, d, salesLead())
	if err != nil {
		t.Fatal(err)
	}
	if len(leadView) != 1 || leadView[0].EmployeeID != "EMP-SALES" {
		t.Fatalf("lead view=%v want only EMP-SALES", leadView)
	}
	if !leadView[0].HasPassword || !leadView[0].MustChangePassword {
		t.Fatalf("has_password/must_change not reflected: %+v", leadView[0])
	}
	// Staff denied.
	if _, err := auth.ListCredentials(ctx, d, salesStaff()); !errors.Is(err, auth.ErrForbidden) {
		t.Fatalf("staff list: %v", err)
	}
}

func TestAudit_NoSecretMaterial(t *testing.T) {
	d := baseFixture(t)
	ctx := context.Background()
	seedProvisioned(t, d, "EMP-SALES", "TempPass!234")
	if err := auth.ChangePassword(ctx, d, "EMP-SALES", "", "TempPass!234", "BrandNew!234"); err != nil {
		t.Fatal(err)
	}
	rows, err := d.Query(`SELECT before_json, after_json FROM audit_log WHERE entity_type='employee_credential'`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var before, after sql.NullString
		if err := rows.Scan(&before, &after); err != nil {
			t.Fatal(err)
		}
		for _, s := range []string{before.String, after.String} {
			if s == "" {
				continue
			}
			for _, secret := range []string{"TempPass!234", "BrandNew!234", "$2a$", "$2b$"} {
				if strings.Contains(s, secret) {
					t.Fatalf("audit leaked secret material %q in %q", secret, s)
				}
			}
		}
	}
}

// ---- small test helpers ----

func loadCredAudit(t *testing.T, d *sql.DB, empID string) ([]string, error) {
	t.Helper()
	rows, err := d.Query(`SELECT action FROM audit_log WHERE entity_type='employee_credential' AND entity_id=?`, empID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var a string
		if err := rows.Scan(&a); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func hasAction(list []string, want string) bool {
	for _, a := range list {
		if a == want {
			return true
		}
	}
	return false
}

func actions(list []string) []string { return list }
