// Command setpass is the ops-only bootstrap for CDPS-local auth: it sets a
// temporary password (must_change_password = 1) for one employee directly via
// the database, bypassing the HTTP authorization layer. Its reason to exist is
// the first Director on a fresh deployment — with HRIS auth removed
// (DECISIONS 2026-07-19) no credential exists yet, so nobody can log in to
// provision anyone. After bootstrap, day-to-day resets go through
// POST /api/v1/auth/admin/set-password.
//
// Usage: CDPS_DSN=... go run ./cmd/setpass <employee_id> <temp_password>
package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"golang.org/x/crypto/bcrypt"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/db"
)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: setpass <employee_id> <temp_password>")
		os.Exit(2)
	}
	empID, password := os.Args[1], os.Args[2]
	if len([]rune(password)) < 8 {
		log.Fatal("setpass: password minimal 8 karakter")
	}
	if len(password) > 72 {
		log.Fatal("setpass: password maksimal 72 karakter")
	}

	d, err := db.Open(db.DSN())
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer d.Close()
	ctx := context.Background()

	var exists int
	if err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM employees WHERE employee_id = ?`, empID).Scan(&exists); err != nil {
		log.Fatalf("lookup employee: %v", err)
	}
	if exists == 0 {
		log.Fatalf("setpass: karyawan %s tidak ditemukan", empID)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		log.Fatalf("hash: %v", err)
	}
	if _, err := d.ExecContext(ctx,
		`INSERT INTO employee_credentials (employee_id, password_hash, must_change_password, failed_attempts, locked_until, created_by)
		 VALUES (?, ?, 1, 0, NULL, 'CLI-BOOTSTRAP')
		 ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), must_change_password = 1,
		                         failed_attempts = 0, locked_until = NULL`,
		empID, string(hash)); err != nil {
		log.Fatalf("write credential: %v", err)
	}
	if _, err := d.ExecContext(ctx, `UPDATE sessions SET revoked_at = NOW() WHERE employee_id = ? AND revoked_at IS NULL`, empID); err != nil {
		log.Fatalf("revoke sessions: %v", err)
	}
	if err := audit.Write(ctx, d, audit.Record{
		EntityType: "employee_credential", EntityID: empID, Actor: "CLI-BOOTSTRAP",
		Action: "password_set_admin", After: map[string]any{"must_change_password": true, "via": "cli_bootstrap"},
	}); err != nil {
		log.Fatalf("audit: %v", err)
	}
	fmt.Printf("password temporer di-set untuk %s (wajib ganti saat login pertama)\n", empID)
}
