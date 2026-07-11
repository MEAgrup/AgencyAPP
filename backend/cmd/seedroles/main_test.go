package main

// CLI-level tests for seedroles. The dry-run / parsing / plan-printing paths
// are pure (no DB, no network) and run against temp files and in-memory
// buffers, mirroring cmd/hrisconvert's test style. The --apply path needs a
// real DB; it uses testutil.DB (which skips cleanly if the local test DB is
// unreachable) and points db.DSN() at it via CDPS_DSN for the duration of the
// test.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/admin"
	"github.com/meagrup/agencyapp/backend/internal/auth"
	"github.com/meagrup/agencyapp/backend/internal/db"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

func writeTemp(t *testing.T, name, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

const employeesFixture = `employee_id,nama,email,divisi,jabatan,status_aktif
1000000001,Contoh Satu,satu@mea.co.id,SALES,Sales Executive,true
1000000002,Contoh Dua,dua@mea.co.id,SALES,Sales Team Leader,true
1000000003,Contoh Tiga,tiga@mea.co.id,ADVERTISER,Ads Specialist,true
1000000004,Contoh Empat,empat@mea.co.id,IT,IT Support,true
`

const policyFixture = `department,policy,division
SALES,map,Sales
ADVERTISER,map,Ads
IT,no-access,
MCN,exclude,
`

func TestRun_DryRunDefaultPrintsPlanAndWritesNothing(t *testing.T) {
	empPath := writeTemp(t, "employees.csv", employeesFixture)
	polPath := writeTemp(t, "policy.csv", policyFixture)
	var stdout, stderr strings.Builder
	code := run([]string{"--employees", empPath, "--policy", polPath, "--actor", "EMP-TEST"}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit code=%d want 0; stderr=%s", code, stderr.String())
	}
	out := stdout.String()
	if !strings.Contains(out, "[DRY RUN]") {
		t.Fatalf("expected dry-run banner, got: %s", out)
	}
	if !strings.Contains(out, "SALES") || !strings.Contains(out, "Sales Executive") || !strings.Contains(out, "staff") {
		t.Fatalf("expected Sales Executive staff mapping in plan, got: %s", out)
	}
	if !strings.Contains(out, "Sales Team Leader") || !strings.Contains(out, "lead") {
		t.Fatalf("expected Sales Team Leader lead mapping in plan, got: %s", out)
	}
	if !strings.Contains(out, "ADVERTISER") || !strings.Contains(out, "Ads") {
		t.Fatalf("expected ADVERTISER -> Ads mapping in plan, got: %s", out)
	}
	if !strings.Contains(out, "IT") || !strings.Contains(out, "no access") {
		t.Fatalf("expected IT listed as no-access, got: %s", out)
	}
}

func TestRun_UnknownDepartmentIsHardErrorNonzeroExit(t *testing.T) {
	emp := `employee_id,nama,email,divisi,jabatan,status_aktif
1000000001,Contoh Satu,satu@mea.co.id,MYSTERY DEPT,Something,true
`
	empPath := writeTemp(t, "employees.csv", emp)
	polPath := writeTemp(t, "policy.csv", policyFixture)
	var stdout, stderr strings.Builder
	code := run([]string{"--employees", empPath, "--policy", polPath, "--actor", "EMP-TEST"}, &stdout, &stderr)
	if code == 0 {
		t.Fatal("expected nonzero exit for a department absent from the policy file")
	}
	if !strings.Contains(stderr.String(), "MYSTERY DEPT") {
		t.Fatalf("expected the unknown department named in stderr, got: %s", stderr.String())
	}
}

func TestRun_ExcludePolicyStillPresentIsWarned(t *testing.T) {
	emp := `employee_id,nama,email,divisi,jabatan,status_aktif
1000000001,Contoh Satu,satu@mea.co.id,MCN,Staff MCN,true
`
	empPath := writeTemp(t, "employees.csv", emp)
	polPath := writeTemp(t, "policy.csv", policyFixture)
	var stdout, stderr strings.Builder
	code := run([]string{"--employees", empPath, "--policy", polPath, "--actor", "EMP-TEST"}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit code=%d want 0 (warning, not fatal); stderr=%s", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), "WARNING") || !strings.Contains(stdout.String(), "MCN") {
		t.Fatalf("expected MCN warned in plan output, got: %s", stdout.String())
	}
}

func TestRun_MissingActorFlagExitsUsageError(t *testing.T) {
	empPath := writeTemp(t, "employees.csv", employeesFixture)
	polPath := writeTemp(t, "policy.csv", policyFixture)
	var stdout, stderr strings.Builder
	code := run([]string{"--employees", empPath, "--policy", polPath}, &stdout, &stderr)
	if code != 2 {
		t.Fatalf("exit code=%d want 2", code)
	}
	if !strings.Contains(stderr.String(), "--actor") {
		t.Fatalf("expected missing --actor message, got: %s", stderr.String())
	}
}

func TestRun_MissingEmployeesFlagExitsUsageError(t *testing.T) {
	var stdout, stderr strings.Builder
	code := run([]string{"--actor", "EMP-TEST"}, &stdout, &stderr)
	if code != 2 {
		t.Fatalf("exit code=%d want 2", code)
	}
	if !strings.Contains(stderr.String(), "--employees") {
		t.Fatalf("expected missing --employees message, got: %s", stderr.String())
	}
}

func TestRun_LayeredCSVPrintedInPlan(t *testing.T) {
	empPath := writeTemp(t, "employees.csv", employeesFixture)
	polPath := writeTemp(t, "policy.csv", policyFixture)
	layeredPath := writeTemp(t, "layered.csv", "employee_id,role\n1000000002,director\n")
	var stdout, stderr strings.Builder
	code := run([]string{"--employees", empPath, "--policy", polPath, "--actor", "EMP-TEST", "--layered", layeredPath}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit code=%d want 0; stderr=%s", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), "1000000002") || !strings.Contains(stdout.String(), "director") {
		t.Fatalf("expected layered assignment listed in plan, got: %s", stdout.String())
	}
}

// TestRun_ApplyWritesRoleMappings exercises the real --apply DB path. It
// skips cleanly (via testutil.DB) if no local test DB is reachable.
func TestRun_ApplyWritesRoleMappings(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)

	oldDSN, hadDSN := os.LookupEnv("CDPS_DSN")
	os.Setenv("CDPS_DSN", db.TestDSN())
	t.Cleanup(func() {
		if hadDSN {
			os.Setenv("CDPS_DSN", oldDSN)
		} else {
			os.Unsetenv("CDPS_DSN")
		}
	})

	testutil.InsertEmployee(t, d, "EMP-ACTOR", "Actor Director", "actor@mea.co.id", "Direksi", "Director", true)
	testutil.InsertLayeredRole(t, d, "EMP-ACTOR", "director")
	testutil.InsertEmployee(t, d, "1000000002", "Contoh Dua", "dua@mea.co.id", "SALES", "Sales Team Leader", true)

	empPath := writeTemp(t, "employees.csv", employeesFixture)
	polPath := writeTemp(t, "policy.csv", policyFixture)
	layeredPath := writeTemp(t, "layered.csv", "employee_id,role\n1000000002,od\n")

	var stdout, stderr strings.Builder
	code := run([]string{
		"--employees", empPath, "--policy", polPath, "--actor", "EMP-ACTOR",
		"--layered", layeredPath, "--apply",
	}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit code=%d want 0; stderr=%s", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), "[APPLIED]") {
		t.Fatalf("expected [APPLIED] banner, got: %s", stdout.String())
	}

	mappings, err := admin.ListRoleMappings(t.Context(), d)
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]admin.RoleMapping{}
	for _, m := range mappings {
		found[m.Divisi+"|"+m.Jabatan] = m
	}
	se, ok := found["SALES|Sales Executive"]
	if !ok || se.Division != "Sales" || se.Level != "staff" {
		t.Fatalf("expected SALES/Sales Executive -> Sales/staff, got %+v ok=%v", se, ok)
	}
	sh, ok := found["SALES|Sales Team Leader"]
	if !ok || sh.Division != "Sales" || sh.Level != "lead" {
		t.Fatalf("expected SALES/Sales Team Leader -> Sales/lead, got %+v ok=%v", sh, ok)
	}
	ad, ok := found["ADVERTISER|Ads Specialist"]
	if !ok || ad.Division != "Ads" || ad.Level != "staff" {
		t.Fatalf("expected ADVERTISER/Ads Specialist -> Ads/staff, got %+v ok=%v", ad, ok)
	}
	if _, ok := found["IT|IT Support"]; ok {
		t.Fatalf("IT is no-access policy; must NOT get a role_mappings row")
	}

	roles, err := admin.ListLayeredRoles(t.Context(), d)
	if err != nil {
		t.Fatal(err)
	}
	var gotOD bool
	for _, r := range roles {
		if r.EmployeeID == "1000000002" && r.Role == "od" && r.Enabled {
			gotOD = true
		}
	}
	if !gotOD {
		t.Fatalf("expected layered OD role for 1000000002, got: %+v", roles)
	}

	// auth.ResolveActor sanity: EMP-ACTOR must resolve as Director (audit actor).
	actor, err := auth.ResolveActor(t.Context(), d, "EMP-ACTOR")
	if err != nil {
		t.Fatal(err)
	}
	if !actor.Role.Director {
		t.Fatalf("expected EMP-ACTOR to resolve as Director, got %+v", actor.Role)
	}
}
