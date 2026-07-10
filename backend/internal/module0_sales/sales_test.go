package sales_test

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/events"
	"github.com/meagrup/agencyapp/backend/internal/core/ids"
	"github.com/meagrup/agencyapp/backend/internal/module0_sales"
)

// jul2026 is a fixed business time inside Wave 1's worked example month.
var jul2026 = time.Date(2026, time.July, 10, 4, 0, 0, 0, time.UTC)

func newAttempts() *sales.Attempts {
	return sales.NewAttempts(authz.NewMatrixChecker(), audit.NewMySQL(), ids.NewMySQL(), events.NewInMemoryBus())
}

// ---- fixture actors (M0 §7.1 role matrix) ----------------------------------

func staffActor(employeeID string) authz.Identity {
	return authz.Identity{EmployeeID: employeeID, Divisi: sales.DivisiSales, Roles: []authz.Role{authz.RoleStaff}}
}

func spvActor(employeeID string) authz.Identity {
	return authz.Identity{EmployeeID: employeeID, Divisi: sales.DivisiSales, Roles: []authz.Role{authz.RoleLeadSPV}}
}

func odActor(employeeID string) authz.Identity {
	return authz.Identity{EmployeeID: employeeID, Divisi: "OD", Roles: []authz.Role{authz.RoleOD}}
}

func directorActor(employeeID string) authz.Identity {
	return authz.Identity{EmployeeID: employeeID, Divisi: "Direksi", Roles: []authz.Role{authz.RoleDirector}}
}

// otherDivisionStaff is a Staff actor in a division other than Sales, used to
// prove division/ownership (not just role name) gates access.
func otherDivisionStaff(employeeID string) authz.Identity {
	return authz.Identity{EmployeeID: employeeID, Divisi: "Ads", Roles: []authz.Role{authz.RoleStaff}}
}

// mustCreate is a test helper that registers an attempt and fails the test on
// error, returning the generated PRSP id.
func mustCreate(ctx context.Context, t *testing.T, conn *sql.DB, s *sales.Attempts, leadID, owner string) string {
	t.Helper()
	id, err := s.CreateAttempt(ctx, conn, leadID, owner, jul2026)
	if err != nil {
		t.Fatalf("CreateAttempt(%s, %s): %v", leadID, owner, err)
	}
	return id
}

// countAuditRows counts audit_log rows for entity "prospect"/id.
func countAuditRows(t *testing.T, conn *sql.DB, prospectID string) int {
	t.Helper()
	var n int
	if err := conn.QueryRow(`SELECT COUNT(*) FROM audit_log WHERE entity_type = 'prospect' AND entity_id = ?`, prospectID).Scan(&n); err != nil {
		t.Fatalf("count audit rows: %v", err)
	}
	return n
}

func rawStatus(t *testing.T, conn *sql.DB, prospectID string) string {
	t.Helper()
	var s string
	if err := conn.QueryRow(`SELECT status FROM prospect_attempts WHERE prospect_id = ?`, prospectID).Scan(&s); err != nil {
		t.Fatalf("raw status: %v", err)
	}
	return s
}

// seedAttemptAt inserts a prospect_attempts row directly at an arbitrary
// status, bypassing the engine entirely. This is a TEST-ONLY fixture helper
// (production code never writes `status` this way -- see create.go /
// status.go doc comments) used to exercise a single §1 edge in isolation
// without having to drive every attempt through its full preceding history.
func seedAttemptAt(t *testing.T, conn *sql.DB, prospectID, leadID, owner, status string) {
	t.Helper()
	now := time.Now().UTC()
	if _, err := conn.Exec(
		`INSERT INTO prospect_attempts (prospect_id, lead_id, owner_employee_id, status, last_status_at, created_at, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		prospectID, leadID, owner, status, now, now, owner,
	); err != nil {
		t.Fatalf("seedAttemptAt: %v", err)
	}
}
