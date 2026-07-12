// Package testutil provides DB-backed test helpers. Tests skip cleanly when the
// test database is unreachable, but run normally when it is up.
package testutil

import (
	"database/sql"
	"sync"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/db"
)

var (
	once     sync.Once
	shared   *sql.DB
	openErr  error
	migrated bool
)

// DB returns a migrated connection to the test database, or skips the test if
// the database is unreachable.
func DB(t *testing.T) *sql.DB {
	t.Helper()
	once.Do(func() {
		shared, openErr = db.Open(db.TestDSN())
		if openErr != nil {
			return
		}
		dir := db.FindMigrationsDir()
		if err := db.MigrateUp(shared, dir); err != nil {
			openErr = err
			return
		}
		migrated = true
	})
	if openErr != nil || !migrated {
		t.Skipf("test DB unavailable: %v", openErr)
	}
	return shared
}

// dataTables are truncated by Clean, children before parents not required since
// FK checks are disabled during truncation.
var dataTables = []string{
	// Wave 1 money-path entities (children before parents).
	"qualified_form_services",
	"qualified_forms",
	"transaction_issue_approvals",
	"payment_verifications",
	"installments",
	"transactions",
	"briefs",
	"strategy_plans",
	"services",
	"client_sales_allocations",
	"client_platforms",
	"clients",
	"negotiation_proposal_lines",
	"negotiation_proposals",
	"prospect_attempt_nq_reasons",
	"prospect_attempts",
	"leads",
	"demo_task_block_requests",
	"demo_tasks",
	"notifications",
	"master_service_versions",
	"master_services",
	"employee_layered_roles",
	"role_mappings",
	"audit_log",
	"id_sequences",
	"sessions",
	"employees",
}

// Clean truncates all data tables to give a test a fresh slate. TRUNCATE does
// not fire the append-only DELETE triggers, so it is safe here.
func Clean(t *testing.T, d *sql.DB) {
	t.Helper()
	if _, err := d.Exec("SET FOREIGN_KEY_CHECKS=0"); err != nil {
		t.Fatalf("disable fk checks: %v", err)
	}
	for _, tbl := range dataTables {
		if _, err := d.Exec("TRUNCATE TABLE " + tbl); err != nil {
			t.Fatalf("truncate %s: %v", tbl, err)
		}
	}
	if _, err := d.Exec("SET FOREIGN_KEY_CHECKS=1"); err != nil {
		t.Fatalf("enable fk checks: %v", err)
	}
}

// InsertEmployee inserts a synced employee for tests.
func InsertEmployee(t *testing.T, d *sql.DB, id, nama, email, divisi, jabatan string, active bool) {
	t.Helper()
	a := 0
	if active {
		a = 1
	}
	_, err := d.Exec(
		`INSERT INTO employees (employee_id, nama, email, divisi, jabatan, status_aktif, synced_at, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, NOW(), 'TEST')
		 ON DUPLICATE KEY UPDATE nama=VALUES(nama), divisi=VALUES(divisi), jabatan=VALUES(jabatan), status_aktif=VALUES(status_aktif)`,
		id, nama, email, divisi, jabatan, a)
	if err != nil {
		t.Fatalf("insert employee: %v", err)
	}
}

// InsertRoleMapping inserts a role mapping for tests.
func InsertRoleMapping(t *testing.T, d *sql.DB, divisi, jabatan, division, level string) {
	t.Helper()
	_, err := d.Exec(
		`INSERT INTO role_mappings (divisi, jabatan, division, level, created_by)
		 VALUES (?, ?, ?, ?, 'TEST')
		 ON DUPLICATE KEY UPDATE division=VALUES(division), level=VALUES(level)`,
		divisi, jabatan, division, level)
	if err != nil {
		t.Fatalf("insert role mapping: %v", err)
	}
}

// InsertLayeredRole inserts a layered role for tests.
func InsertLayeredRole(t *testing.T, d *sql.DB, employeeID, role string) {
	t.Helper()
	_, err := d.Exec(
		`INSERT INTO employee_layered_roles (employee_id, role, enabled, created_by)
		 VALUES (?, ?, 1, 'TEST') ON DUPLICATE KEY UPDATE enabled=1`,
		employeeID, role)
	if err != nil {
		t.Fatalf("insert layered role: %v", err)
	}
}
