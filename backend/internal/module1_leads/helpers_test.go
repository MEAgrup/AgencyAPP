package leads

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/ids"
	"github.com/meagrup/agencyapp/backend/internal/core/testdb"
)

// fakeAttempts is the test double for AttemptCreator (module0_sales is built
// in parallel; W1-01 mandates a fake). It hands out PRSP-shaped ids and
// records every call; failNext forces the next call to error so the caller's
// whole transaction rollback can be asserted.
type fakeAttempts struct {
	mu       sync.Mutex
	calls    []attemptCall
	seq      int
	failNext bool
}

type attemptCall struct {
	LeadID          string
	OwnerEmployeeID string
	At              time.Time
}

var _ AttemptCreator = (*fakeAttempts)(nil)

func (f *fakeAttempts) CreateAttempt(_ context.Context, _ db.Queryer, leadID, ownerEmployeeID string, at time.Time) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.failNext {
		f.failNext = false
		return "", fmt.Errorf("fakeAttempts: forced failure")
	}
	f.seq++
	f.calls = append(f.calls, attemptCall{LeadID: leadID, OwnerEmployeeID: ownerEmployeeID, At: at})
	return fmt.Sprintf("PRSP-202607-%04d", f.seq), nil
}

func (f *fakeAttempts) all() []attemptCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]attemptCall, len(f.calls))
	copy(out, f.calls)
	return out
}

// newTestService wires a Service against an isolated migrated DB with the
// REAL MySQL audit logger (so storage-layer immutability triggers are in
// force) and the real id generator.
func newTestService(t *testing.T) (*sql.DB, *Service, *fakeAttempts) {
	t.Helper()
	conn := testdb.New(t)
	attempts := &fakeAttempts{}
	svc := NewService(authz.NewMatrixChecker(), audit.NewMySQL(), ids.NewMySQL(), attempts, DefaultNormalizer())
	return conn, svc, attempts
}

func insertEmployee(t *testing.T, conn *sql.DB, employeeID, nama, divisi, jabatan string) {
	t.Helper()
	now := time.Now().UTC()
	if _, err := conn.Exec(
		`INSERT INTO employees (employee_id, nama, email, divisi, jabatan, status_aktif, hris_updated_at, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
		employeeID, nama, nama+"@meagency.co.id", divisi, jabatan, now, now, now,
	); err != nil {
		t.Fatalf("insert employee %s: %v", employeeID, err)
	}
}

func insertCampaign(t *testing.T, conn *sql.DB, id, status, source, owner string) {
	t.Helper()
	if err := InsertCampaignStub(context.Background(), conn, CampaignStub{
		CampaignID: id, Status: status, Source: source, OwnerEmployeeID: owner,
	}); err != nil {
		t.Fatalf("insert campaign stub %s: %v", id, err)
	}
}

// forceRecordStatus is a TEST-ONLY fixture shortcut to place an existing lead
// into a decision-table state ([Rejected], [Not Qualified], [Closed - Success])
// whose production path belongs to W1-03+ (attempt lifecycle / win resolution).
func forceRecordStatus(t *testing.T, conn *sql.DB, leadID string, status RecordStatus) {
	t.Helper()
	if _, err := conn.Exec(`UPDATE leads SET record_status = ? WHERE lead_id = ?`, string(status), leadID); err != nil {
		t.Fatalf("force record status: %v", err)
	}
}

func countLeads(t *testing.T, conn *sql.DB) int {
	t.Helper()
	var n int
	if err := conn.QueryRow(`SELECT COUNT(*) FROM leads`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func auditRows(t *testing.T, conn *sql.DB, leadID, action string) []audit.Record {
	t.Helper()
	recs, err := audit.NewMySQL().List(context.Background(), conn, audit.Filter{
		EntityType: auditEntityLead, EntityID: leadID, Action: action,
	})
	if err != nil {
		t.Fatal(err)
	}
	return recs
}

// Common identities (Phase 0 §4 role matrix, incl. layered OD/Director).
var (
	idSalesBudi = authz.Identity{EmployeeID: "EMP-BUDI", Divisi: "Sales", Roles: []authz.Role{authz.RoleStaff}}
	idSalesAndi = authz.Identity{EmployeeID: "EMP-ANDI", Divisi: "Sales", Roles: []authz.Role{authz.RoleStaff}}
	idSalesLead = authz.Identity{EmployeeID: "EMP-SLEAD", Divisi: "Sales", Roles: []authz.Role{authz.RoleLeadSPV}}
	idMktLia    = authz.Identity{EmployeeID: "EMP-LIA", Divisi: "Marketing", Roles: []authz.Role{authz.RoleStaff}}
	idMktRina   = authz.Identity{EmployeeID: "EMP-RINA", Divisi: "Marketing", Roles: []authz.Role{authz.RoleStaff}}
	idMktLead   = authz.Identity{EmployeeID: "EMP-MLEAD", Divisi: "Marketing", Roles: []authz.Role{authz.RoleLeadSPV}}
	idODOnly    = authz.Identity{EmployeeID: "EMP-OD", Divisi: "OD", Roles: []authz.Role{authz.RoleOD}}
	idDirector  = authz.Identity{EmployeeID: "EMP-DIR", Divisi: "Management", Roles: []authz.Role{authz.RoleDirector}}
	// Layered roles live on the SAME employee account (house convention #2.7):
	// idSalesStaffOD is Budi's account with OD layered on; idMktODLayered is
	// Lia's account with OD layered on.
	idSalesStaffOD = authz.Identity{EmployeeID: "EMP-BUDI", Divisi: "Sales", Roles: []authz.Role{authz.RoleStaff, authz.RoleOD}}
	idUnmapped     = authz.Identity{EmployeeID: "EMP-404"}
	idMktODLayered = authz.Identity{EmployeeID: "EMP-LIA", Divisi: "Marketing", Roles: []authz.Role{authz.RoleStaff, authz.RoleOD}}
)

func validSalesForm() SalesRegistrationForm {
	return SalesRegistrationForm{
		LeadName: "Alpha Digital",
		Phone:    "0812-1111-2222",
		Email:    "alpha@contoh.co.id",
		Source:   SourceScouting,
	}
}
