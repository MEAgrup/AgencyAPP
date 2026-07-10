package seed

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/events"
	"github.com/meagrup/agencyapp/backend/internal/core/hris"
	"github.com/meagrup/agencyapp/backend/internal/core/msl"
)

// employeesCSV is the fictional MEA roster for dev/staging, flowing through
// the same CSV EmployeeSource used as the pre-HRIS contingency (Build Plan
// R1) — employee data is never hardcoded into inserts. Names follow the
// OA-14 worked-example cast (Budi/Sinta/Rian/Kenny/Putri + supporting roles).
//
//go:embed fixtures/employees.csv
var employeesCSV []byte

// Fixture employee IDs referenced by tests and later fixture slices.
const (
	EmpBudiSales       = "EMP-0001" // Sales staff — Alpha Digital's salesperson
	EmpHendraSalesHead = "EMP-0002" // Sales Head (lead_spv, Sales)
	EmpDewiFinance     = "EMP-0003"
	EmpRinaSPVFinance  = "EMP-0004"
	EmpSintaAM         = "EMP-0005"
	EmpBagusAccLead    = "EMP-0006"
	EmpRianCreative    = "EMP-0007"
	EmpMayaCreLead     = "EMP-0008"
	EmpYohanStaffOD    = "EMP-0009" // layered fixture: staff + OD on one account
	EmpNerissaDirector = "EMP-0010"
	EmpKennyAds        = "EMP-0011"
	EmpPutriKOL        = "EMP-0012"
)

// directorIdentity is the bootstrap acting identity for seeding role mappings
// and the Master Service List. Constructed directly rather than resolved,
// because on an empty database no mapping rows exist yet to resolve the first
// Director from — the classic bootstrap step. After seeding, EMP-0010 resolves
// to this same identity through role_overrides.
func directorIdentity() authz.Identity {
	return authz.Identity{
		EmployeeID: EmpNerissaDirector,
		Divisi:     "Management",
		Roles:      []authz.Role{authz.RoleStaff, authz.RoleDirector},
	}
}

// salesHeadIdentity is the acting identity for Master Service List writes
// (DECISIONS.md M0 OD-2: Sales Head/SPV manages the list).
func salesHeadIdentity() authz.Identity {
	return authz.Identity{
		EmployeeID: EmpHendraSalesHead,
		Divisi:     msl.DivisiSales,
		Roles:      []authz.Role{authz.RoleLeadSPV},
	}
}

// baseMappings maps every (divisi, jabatan) combo in the fixture CSV to its
// CDPS base role per the Phase 0 §4 matrix.
var baseMappings = []struct {
	divisi, jabatan string
	role            authz.Role
}{
	{"Sales", "Sales Executive", authz.RoleStaff},
	{"Sales", "Sales Head", authz.RoleLeadSPV},
	{"Finance", "Finance Staff", authz.RoleStaff},
	{"Finance", "SPV Finance", authz.RoleLeadSPV},
	{"Account", "Account Manager", authz.RoleStaff},
	{"Account", "Account Lead", authz.RoleLeadSPV},
	{"Creative", "Editor", authz.RoleStaff},
	{"Creative", "Creative Lead", authz.RoleLeadSPV},
	{"Ads", "Advertiser", authz.RoleStaff},
	{"KOL", "KOL Coordinator", authz.RoleStaff},
	{"Operations", "OD Officer", authz.RoleStaff}, // OD layered via override
	{"Management", "Director", authz.RoleStaff},   // Director layered via override
}

// roleOverrides are the layered roles (Phase 0 §4: OD/Director sit on top of
// a normal employee account).
var roleOverrides = []struct {
	employeeID string
	role       authz.Role
}{
	{EmpYohanStaffOD, authz.RoleOD},
	{EmpNerissaDirector, authz.RoleDirector},
}

// mslEntries are the three services from the Alpha Digital worked example
// (Module 0 §4.3: Estimasi Nilai Transaksi Rp. 21.900.000,00). Commission
// rules are NOT specified in the PRDs — the JSON below is an explicit
// placeholder awaiting the Sales Head's validated list (Build Plan R3); the
// shape {"type":"pending_master_list"} is intentionally non-computable so
// Wave 1 commission math cannot silently use it.
var mslEntries = []msl.CreateInput{
	{Name: "Pendampingan Establish TikTok", StandardPrice: "9000000.00", CommissionRule: `{"type":"pending_master_list"}`},
	{Name: "Jasa Buka Toko Online Basic", StandardPrice: "6000000.00", CommissionRule: `{"type":"pending_master_list"}`},
	{Name: "Jasa Live Streaming Basic", StandardPrice: "6900000.00", CommissionRule: `{"type":"pending_master_list"}`},
}

// fixtureEffectiveFrom pins the seeded MSL versions before the worked
// example's deal dates (Alpha Digital qualifies 20 Apr 2026), so
// EffectiveAt lookups on example dates resolve to these versions.
var fixtureEffectiveFrom = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

func init() {
	Register(Step{Name: "sprint0/employees", Run: seedEmployees})
	Register(Step{Name: "sprint0/role-mappings", Run: seedRoleMappings})
	Register(Step{Name: "sprint0/master-service-list", Run: seedMasterServiceList})
}

func seedEmployees(ctx context.Context, conn *sql.DB) error {
	src := &hris.CSVSource{Open: func() (io.ReadCloser, error) {
		return io.NopCloser(strings.NewReader(string(employeesCSV))), nil
	}}
	syncer := &hris.Syncer{DB: conn, Bus: events.NewInMemoryBus()}
	if _, err := syncer.Sync(ctx, src, time.Time{}); err != nil {
		return fmt.Errorf("employee sync: %w", err)
	}
	return nil
}

func seedRoleMappings(ctx context.Context, conn *sql.DB) error {
	admin := authz.NewMappingAdmin(authz.NewMatrixChecker(), audit.NewMySQL())
	actor := directorIdentity()

	for _, m := range baseMappings {
		var exists int
		err := conn.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM role_mappings WHERE divisi = ? AND jabatan = ?`,
			m.divisi, m.jabatan).Scan(&exists)
		if err != nil {
			return err
		}
		if exists > 0 {
			continue // idempotent re-run
		}
		if _, err := admin.CreateMapping(ctx, conn, actor, m.divisi, m.jabatan, m.role); err != nil {
			return fmt.Errorf("mapping %s/%s: %w", m.divisi, m.jabatan, err)
		}
	}

	for _, o := range roleOverrides {
		var exists int
		err := conn.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM role_overrides WHERE employee_id = ? AND role = ?`,
			o.employeeID, string(o.role)).Scan(&exists)
		if err != nil {
			return err
		}
		if exists > 0 {
			continue
		}
		if _, err := admin.CreateOverride(ctx, conn, actor, o.employeeID, o.role); err != nil {
			return fmt.Errorf("override %s→%s: %w", o.employeeID, o.role, err)
		}
	}
	return nil
}

func seedMasterServiceList(ctx context.Context, conn *sql.DB) error {
	store := msl.NewStore(authz.NewMatrixChecker(), audit.NewMySQL())
	actor := salesHeadIdentity()

	existing, err := msl.ListEntries(ctx, conn, actor)
	if err != nil {
		return err
	}
	have := map[string]bool{}
	for _, e := range existing {
		have[e.Name] = true
	}
	for _, in := range mslEntries {
		if have[in.Name] {
			continue // idempotent re-run
		}
		in.EffectiveFrom = fixtureEffectiveFrom
		if _, err := store.CreateEntry(ctx, conn, actor, in); err != nil {
			return fmt.Errorf("msl entry %q: %w", in.Name, err)
		}
	}
	return nil
}
