package main

// DB-backed tests: run Execute against the real seed CSVs (and small
// hand-built ones for the error paths) through the SYSTEM/Director bootstrap
// actor, asserting idempotency and the "validate everything before any write"
// contract — pattern mirrors cmd/mslseed's engine_db_test.go.

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

func TestExecute_RealSeedCSVs_ApplyThenIdempotent(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()

	// The layered-role row (OD OKFA, 2409230432) needs a matching employees
	// row first — FK on employee_layered_roles, same as production ordering
	// (employees_cdps.csv sync happens before rolemapseed in the smoke run).
	testutil.InsertEmployee(t, d, "2409230432", "OKFA RENDI WIRATAMA", "orendy9@gmail.com", "HRGA", "SUPERVISOR HR", true)

	roleF := openFile(t, FindRoleMappingsCSV())
	defer roleF.Close()
	roleRows, err := ParseRoleMappingCSV(roleF)
	if err != nil {
		t.Fatalf("parse role csv: %v", err)
	}
	if len(roleRows) != 23 {
		t.Fatalf("got %d role mapping rows, want 23", len(roleRows))
	}

	layeredF := openFile(t, FindLayeredRolesCSV())
	defer layeredF.Close()
	layeredRows, err := ParseLayeredRoleCSV(layeredF)
	if err != nil {
		t.Fatalf("parse layered csv: %v", err)
	}
	if len(layeredRows) != 1 {
		t.Fatalf("got %d layered role rows, want 1", len(layeredRows))
	}

	// Run 1 (apply): 23 mapped, 1 layered.
	rep, err := Execute(ctx, d, systemDirector, roleRows, layeredRows, true, discard(t))
	if err != nil {
		t.Fatalf("run 1 (apply): %v", err)
	}
	if rep.RoleMappings != 23 || rep.LayeredRoles != 1 || rep.Errors != 0 {
		t.Fatalf("run 1 report=%+v want RoleMappings=23 LayeredRoles=1 Errors=0", rep)
	}

	var mappingCount int
	if err := d.QueryRow(`SELECT COUNT(*) FROM role_mappings`).Scan(&mappingCount); err != nil {
		t.Fatal(err)
	}
	if mappingCount != 23 {
		t.Fatalf("role_mappings=%d want 23", mappingCount)
	}
	var enabled bool
	if err := d.QueryRow(`SELECT enabled FROM employee_layered_roles WHERE employee_id = ? AND role = 'od'`, "2409230432").Scan(&enabled); err != nil {
		t.Fatalf("query layered role: %v", err)
	}
	if !enabled {
		t.Fatal("expected OD layered role enabled for 2409230432")
	}

	// Run 2 (apply again, unchanged CSVs): idempotent — no duplicate rows.
	rep2, err := Execute(ctx, d, systemDirector, roleRows, layeredRows, true, discard(t))
	if err != nil {
		t.Fatalf("run 2 (idempotent apply): %v", err)
	}
	if rep2.RoleMappings != 23 || rep2.LayeredRoles != 1 || rep2.Errors != 0 {
		t.Fatalf("run 2 report=%+v want RoleMappings=23 LayeredRoles=1 Errors=0", rep2)
	}
	if err := d.QueryRow(`SELECT COUNT(*) FROM role_mappings`).Scan(&mappingCount); err != nil {
		t.Fatal(err)
	}
	if mappingCount != 23 {
		t.Fatalf("role_mappings=%d want 23 (no duplicates)", mappingCount)
	}
	var layeredCount int
	if err := d.QueryRow(`SELECT COUNT(*) FROM employee_layered_roles`).Scan(&layeredCount); err != nil {
		t.Fatal(err)
	}
	if layeredCount != 1 {
		t.Fatalf("employee_layered_roles=%d want 1 (no duplicates)", layeredCount)
	}
}

func TestExecute_DryRunDoesNotWrite(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()
	testutil.InsertEmployee(t, d, "2409230432", "OKFA RENDI WIRATAMA", "orendy9@gmail.com", "HRGA", "SUPERVISOR HR", true)

	roleF := openFile(t, FindRoleMappingsCSV())
	defer roleF.Close()
	roleRows, err := ParseRoleMappingCSV(roleF)
	if err != nil {
		t.Fatalf("parse role csv: %v", err)
	}
	layeredF := openFile(t, FindLayeredRolesCSV())
	defer layeredF.Close()
	layeredRows, err := ParseLayeredRoleCSV(layeredF)
	if err != nil {
		t.Fatalf("parse layered csv: %v", err)
	}

	rep, err := Execute(ctx, d, systemDirector, roleRows, layeredRows, false, discard(t))
	if err != nil {
		t.Fatalf("dry-run: %v", err)
	}
	if rep.RoleMappings != 23 || rep.LayeredRoles != 1 {
		t.Fatalf("dry-run report=%+v want RoleMappings=23 LayeredRoles=1 (planned, not written)", rep)
	}

	var mappingCount, layeredCount int
	if err := d.QueryRow(`SELECT COUNT(*) FROM role_mappings`).Scan(&mappingCount); err != nil {
		t.Fatal(err)
	}
	if err := d.QueryRow(`SELECT COUNT(*) FROM employee_layered_roles`).Scan(&layeredCount); err != nil {
		t.Fatal(err)
	}
	if mappingCount != 0 || layeredCount != 0 {
		t.Fatalf("dry-run must not write: role_mappings=%d employee_layered_roles=%d", mappingCount, layeredCount)
	}
}

func TestExecute_UnknownLayeredEmployeeAbortsBeforeAnyWrite(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()
	// Deliberately do NOT insert employee 2409230432 — the FK/existence
	// precondition the spec calls out ("employee_id layered harus ada di
	// tabel employees — kalau tidak, error jelas").

	roleF := openFile(t, FindRoleMappingsCSV())
	defer roleF.Close()
	roleRows, err := ParseRoleMappingCSV(roleF)
	if err != nil {
		t.Fatalf("parse role csv: %v", err)
	}
	layeredF := openFile(t, FindLayeredRolesCSV())
	defer layeredF.Close()
	layeredRows, err := ParseLayeredRoleCSV(layeredF)
	if err != nil {
		t.Fatalf("parse layered csv: %v", err)
	}

	_, err = Execute(ctx, d, systemDirector, roleRows, layeredRows, true, discard(t))
	if err == nil {
		t.Fatal("expected error: layered-role employee_id not present in employees")
	}
	if !strings.Contains(err.Error(), "tidak ada di tabel employees") {
		t.Fatalf("unexpected error message: %v", err)
	}

	var mappingCount int
	if err := d.QueryRow(`SELECT COUNT(*) FROM role_mappings`).Scan(&mappingCount); err != nil {
		t.Fatal(err)
	}
	if mappingCount != 0 {
		t.Fatalf("role_mappings=%d want 0 — nothing should be written when validation fails", mappingCount)
	}
}

func TestExecute_InvalidLevelAbortsBeforeAnyWrite(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()

	rows := []RoleMappingRow{
		{Line: 1, Divisi: "SALES", Jabatan: "SALES", Division: "Sales", Level: "staff"},
		{Line: 2, Divisi: "SALES", Jabatan: "HEAD OF SALES JASA", Division: "Sales", Level: "manager"}, // invalid
	}
	_, err := Execute(ctx, d, systemDirector, rows, nil, true, discard(t))
	if err == nil {
		t.Fatal("expected validation error for level=manager")
	}

	var mappingCount int
	if err := d.QueryRow(`SELECT COUNT(*) FROM role_mappings`).Scan(&mappingCount); err != nil {
		t.Fatal(err)
	}
	if mappingCount != 0 {
		t.Fatalf("role_mappings=%d want 0 — one bad row must abort the whole batch before any write", mappingCount)
	}
}

func openFile(t *testing.T, path string) *os.File {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("open %s: %v", path, err)
	}
	return f
}

// discard returns an io.Writer that logs through t (kept out of stdout during
// `go test`, visible with -v).
func discard(t *testing.T) *testWriter { return &testWriter{t: t} }

type testWriter struct{ t *testing.T }

func (w *testWriter) Write(p []byte) (int, error) {
	w.t.Logf("%s", p)
	return len(p), nil
}
