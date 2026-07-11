package main

// Pure CLI-level tests for seedroles. No DB, no network — everything runs
// through run() (dry-run mode) against temp files and in-memory buffers.
// Fixtures are SYNTHETIC (no real employee names/NIKs — PII).

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeTemp(t *testing.T, name, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

// employeesFixture exercises: SALES wildcard+auto (a HEAD → lead, a plain
// exec → staff), ACCOUNT wildcard, a specific override inside BIZDEV
// (MARKETING STRATEGIST → Sales/staff) while the rest of BIZDEV is excluded,
// a fully excluded department (MISC), and a MENTOR jabatan (auto → staff, not
// lead).
const employeesFixture = `employee_id,nama,email,divisi,jabatan,status_aktif
1000000001,Emp One,,SALES,SALES EXECUTIVE,true
1000000002,Emp Two,,SALES,HEAD OF SALES,true
1000000003,Emp Three,,SALES,SALES MENTOR,true
1000000004,Emp Four,,ACCOUNT,ACCOUNT MANAGER,true
1000000005,Emp Five,,ACCOUNT,ACCOUNT MANAGER,true
1000000006,Emp Six,,BIZDEV,MARKETING STRATEGIST,true
1000000007,Emp Seven,,BIZDEV,CONTENT CREATOR,true
1000000008,Emp Eight,,MISC,RANDOM ROLE,true
`

const mappingFixture = `department,jabatan,division,level
SALES,*,Sales,auto
ACCOUNT,*,Account,auto
BIZDEV,MARKETING STRATEGIST,Sales,staff
BIZDEV,*,-,-
MISC,*,-,-
`

const layeredFixture = `employee_id,role,enabled
1000000004,viewer,true
`

func TestRun_DryRun_ResolvesWildcardOverrideExcludeAndAutoLevel(t *testing.T) {
	emp := writeTemp(t, "employees.csv", employeesFixture)
	mp := writeTemp(t, "mapping.csv", mappingFixture)
	ly := writeTemp(t, "layered.csv", layeredFixture)

	var stdout, stderr strings.Builder
	code := run([]string{"dry-run", "--employees", emp, "--mapping", mp, "--layered", ly}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit=%d want 0; stderr=%s", code, stderr.String())
	}

	out := stdout.String()
	want := "divisi,jabatan,division,level\n" +
		"ACCOUNT,ACCOUNT MANAGER,Account,staff\n" +
		"BIZDEV,MARKETING STRATEGIST,Sales,staff\n" + // specific override beats wildcard
		"SALES,HEAD OF SALES,Sales,lead\n" + // auto → lead (HEAD)
		"SALES,SALES EXECUTIVE,Sales,staff\n" + // auto → staff
		"SALES,SALES MENTOR,Sales,staff\n" // MENTOR is NOT a lead
	if out != want {
		t.Fatalf("resolved CSV mismatch:\n got:\n%s\nwant:\n%s", out, want)
	}

	s := stderr.String()
	// Sales: exec+head+mentor = 3 ; Account: 2 ; Bizdev marketing strategist: 1 → mapped 6
	for _, sub := range []string{
		"8 karyawan, 7 pasangan divisi|jabatan unik",
		"role_mappings di-upsert: 5",
		"karyawan ter-mapping (punya akses): 6 ; excluded (tanpa akses tersisa): 2",
		"Sales:", "Account:",
		"BIZDEV: 1",
		"MISC: 1",
		"layered roles di-set: 1",
		"1000000004 viewer=true",
	} {
		if !strings.Contains(s, sub) {
			t.Fatalf("summary missing %q; stderr=\n%s", sub, s)
		}
	}
}

func TestRun_DryRunIsDefaultModeWithoutSubcommand(t *testing.T) {
	emp := writeTemp(t, "employees.csv", employeesFixture)
	mp := writeTemp(t, "mapping.csv", mappingFixture)
	ly := writeTemp(t, "layered.csv", layeredFixture)

	var stdout, stderr strings.Builder
	code := run([]string{"--employees", emp, "--mapping", mp, "--layered", ly}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit=%d want 0; stderr=%s", code, stderr.String())
	}
	if !strings.HasPrefix(stdout.String(), "divisi,jabatan,division,level\n") {
		t.Fatalf("expected resolved CSV on stdout, got: %s", stdout.String())
	}
	if !strings.Contains(stderr.String(), "dry-run —") {
		t.Fatalf("expected dry-run summary, got: %s", stderr.String())
	}
}

func TestRun_AutoLeadHeuristicTokens(t *testing.T) {
	cases := []struct {
		jabatan string
		want    string
	}{
		{"HEAD OF SALES", "lead"},
		{"SALES SPV", "lead"},
		{"SALES SUPERVISOR", "lead"},
		{"TEAM LEADER", "lead"},
		{"TEAM LEAD", "lead"},
		{"SALES MENTOR", "staff"},
		{"SALES EXECUTIVE", "staff"},
		{"OVERHEAD PLANNER", "staff"}, // HEAD only as substring → not a lead
	}
	for _, c := range cases {
		got, err := resolveLevel(mappingRule{Level: "auto"}, c.jabatan)
		if err != nil {
			t.Fatalf("%q: unexpected err %v", c.jabatan, err)
		}
		if got != c.want {
			t.Fatalf("auto level for %q = %q want %q", c.jabatan, got, c.want)
		}
	}
}

func TestRun_UnknownDepartmentIsFatalAndReportsAll(t *testing.T) {
	// Two distinct unmapped pairs in ZZZ + one in YYY — all must be reported.
	emp := writeTemp(t, "employees.csv", `employee_id,nama,email,divisi,jabatan,status_aktif
2000000001,A,,SALES,SALES EXECUTIVE,true
2000000002,B,,ZZZ,ROLE ONE,true
2000000003,C,,ZZZ,ROLE TWO,true
2000000004,D,,YYY,ROLE X,true
`)
	mp := writeTemp(t, "mapping.csv", "department,jabatan,division,level\nSALES,*,Sales,auto\n")
	ly := writeTemp(t, "layered.csv", "employee_id,role,enabled\n")

	var stdout, stderr strings.Builder
	code := run([]string{"dry-run", "--employees", emp, "--mapping", mp, "--layered", ly}, &stdout, &stderr)
	if code == 0 {
		t.Fatal("expected nonzero exit for unmapped departments")
	}
	if stdout.String() != "" {
		t.Fatalf("no output must be emitted when the gate fails, got: %s", stdout.String())
	}
	s := stderr.String()
	if !strings.Contains(s, "GATE GAGAL") {
		t.Fatalf("expected gate-failure report, got: %s", s)
	}
	for _, sub := range []string{`divisi="ZZZ", jabatan="ROLE ONE"`, `divisi="ZZZ", jabatan="ROLE TWO"`, `divisi="YYY", jabatan="ROLE X"`} {
		if !strings.Contains(s, sub) {
			t.Fatalf("expected every unmapped pair reported, missing %q; got: %s", sub, s)
		}
	}
}

func TestRun_UnknownLayeredEmployeeIsFatal(t *testing.T) {
	emp := writeTemp(t, "employees.csv", employeesFixture)
	mp := writeTemp(t, "mapping.csv", mappingFixture)
	ly := writeTemp(t, "layered.csv", "employee_id,role,enabled\n9999999999,viewer,true\n")

	var stdout, stderr strings.Builder
	code := run([]string{"dry-run", "--employees", emp, "--mapping", mp, "--layered", ly}, &stdout, &stderr)
	if code == 0 {
		t.Fatal("expected nonzero exit for unknown layered employee")
	}
	if stdout.String() != "" {
		t.Fatalf("no output on gate failure, got: %s", stdout.String())
	}
	if !strings.Contains(stderr.String(), `layered employee_id "9999999999" tidak ditemukan`) {
		t.Fatalf("expected unknown-layered-employee error, got: %s", stderr.String())
	}
}

func TestRun_InvalidLayeredRoleIsFatal(t *testing.T) {
	emp := writeTemp(t, "employees.csv", employeesFixture)
	mp := writeTemp(t, "mapping.csv", mappingFixture)
	ly := writeTemp(t, "layered.csv", "employee_id,role,enabled\n1000000004,superadmin,true\n")

	var stdout, stderr strings.Builder
	code := run([]string{"dry-run", "--employees", emp, "--mapping", mp, "--layered", ly}, &stdout, &stderr)
	if code == 0 {
		t.Fatal("expected nonzero exit for invalid layered role")
	}
	if !strings.Contains(stderr.String(), `layered role "superadmin" tidak valid`) {
		t.Fatalf("expected invalid-role error, got: %s", stderr.String())
	}
}

func TestRun_MissingRequiredFlagsExitTwo(t *testing.T) {
	var stdout, stderr strings.Builder
	code := run([]string{"dry-run", "--employees", "x.csv"}, &stdout, &stderr)
	if code != 2 {
		t.Fatalf("exit=%d want 2", code)
	}
	if !strings.Contains(stderr.String(), "wajib diisi") {
		t.Fatalf("expected required-flags message, got: %s", stderr.String())
	}
}

func TestRun_ApplyWithoutActorExitsTwo(t *testing.T) {
	emp := writeTemp(t, "employees.csv", employeesFixture)
	mp := writeTemp(t, "mapping.csv", mappingFixture)
	ly := writeTemp(t, "layered.csv", layeredFixture)

	var stdout, stderr strings.Builder
	code := run([]string{"apply", "--employees", emp, "--mapping", mp, "--layered", ly}, &stdout, &stderr)
	if code != 2 {
		t.Fatalf("exit=%d want 2 (apply needs --actor); stderr=%s", code, stderr.String())
	}
	if !strings.Contains(stderr.String(), "membutuhkan --actor") {
		t.Fatalf("expected actor-required message, got: %s", stderr.String())
	}
}

func TestRun_UnknownModeExitsTwo(t *testing.T) {
	var stdout, stderr strings.Builder
	code := run([]string{"blah", "--employees", "x"}, &stdout, &stderr)
	if code != 2 {
		t.Fatalf("exit=%d want 2", code)
	}
	if !strings.Contains(stderr.String(), "mode tidak dikenal") {
		t.Fatalf("expected unknown-mode message, got: %s", stderr.String())
	}
}
