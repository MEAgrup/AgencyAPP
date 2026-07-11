package main

// Pure CLI-level tests for hrisconvert. No DB, no network — everything runs
// through run() against temp files and in-memory buffers. Fixtures are
// synthetic (no real employee names/NIKs — PII).

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

const rawFixture = `No,NIK,JOIN DATE,NAMA LENGKAP,DEPARTMENT,JABATAN
No,NIK,JOIN DATE,NAMA LENGKAP,DEPARTMENT,JABATAN
1,1000000001,18-Jan-2021,Contoh Satu,SALES,Sales Executive
2,1000000002,24-Mei-2021,Contoh Dua,ACCOUNT,Account Manager
`

func TestRun_ConvertToStdout(t *testing.T) {
	in := writeTemp(t, "raw.csv", rawFixture)
	var stdout, stderr strings.Builder
	code := run([]string{in}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit code=%d want 0; stderr=%s", code, stderr.String())
	}
	want := "employee_id,nama,email,divisi,jabatan,status_aktif\n" +
		"1000000001,Contoh Satu,,SALES,Sales Executive,true\n" +
		"1000000002,Contoh Dua,,ACCOUNT,Account Manager,true\n"
	if stdout.String() != want {
		t.Fatalf("stdout=\n%s\nwant:\n%s", stdout.String(), want)
	}
	if !strings.Contains(stderr.String(), "2 rows in, 2 emitted, 0 warning(s), 2 distinct") {
		t.Fatalf("summary missing/unexpected in stderr: %s", stderr.String())
	}
	if !strings.Contains(stderr.String(), "2 of 2 employees have NO email") {
		t.Fatalf("expected empty-email note in summary, got: %s", stderr.String())
	}
}

func TestRun_OutputFileFlag(t *testing.T) {
	in := writeTemp(t, "raw.csv", rawFixture)
	outPath := filepath.Join(t.TempDir(), "out.csv")
	var stdout, stderr strings.Builder
	code := run([]string{"-in", in, "-o", outPath}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit code=%d want 0; stderr=%s", code, stderr.String())
	}
	if stdout.String() != "" {
		t.Fatalf("expected nothing on stdout when -o is set, got: %s", stdout.String())
	}
	got, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(got), "employee_id,nama,email,divisi,jabatan,status_aktif\n") {
		t.Fatalf("unexpected output file content: %s", got)
	}
}

func TestRun_EmailsFlagMergesAndSuppressesEmptyEmailNote(t *testing.T) {
	in := writeTemp(t, "raw.csv", rawFixture)
	emailsCSV := writeTemp(t, "emails.csv", "nik,email\n1000000001,satu@mea.co.id\n1000000002,dua@mea.co.id\n")
	var stdout, stderr strings.Builder
	code := run([]string{"-in", in, "-emails", emailsCSV}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit code=%d want 0; stderr=%s", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), "1000000001,Contoh Satu,satu@mea.co.id,SALES,Sales Executive,true") {
		t.Fatalf("expected merged email in output, got: %s", stdout.String())
	}
	if strings.Contains(stderr.String(), "NO email") {
		t.Fatalf("should not warn about missing emails once all are mapped: %s", stderr.String())
	}
}

func TestRun_PairsMode(t *testing.T) {
	in := writeTemp(t, "raw.csv", rawFixture)
	var stdout, stderr strings.Builder
	code := run([]string{"-in", in, "-pairs"}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit code=%d want 0; stderr=%s", code, stderr.String())
	}
	want := "department,jabatan,count\n" +
		"ACCOUNT,Account Manager,1\n" +
		"SALES,Sales Executive,1\n"
	if stdout.String() != want {
		t.Fatalf("stdout=\n%s\nwant:\n%s", stdout.String(), want)
	}
}

func TestRun_DataQualityGateBlocksOutputAndExitsNonzero(t *testing.T) {
	dup := `No,NIK,JOIN DATE,NAMA LENGKAP,DEPARTMENT,JABATAN
1,1000000001,18-Jan-2021,Contoh Satu,SALES,Sales Executive
2,1000000001,24-Mei-2021,Contoh Dua,ACCOUNT,Account Manager
`
	in := writeTemp(t, "raw.csv", dup)
	var stdout, stderr strings.Builder
	code := run([]string{in}, &stdout, &stderr)
	if code == 0 {
		t.Fatal("expected nonzero exit code on duplicate NIK")
	}
	if stdout.String() != "" {
		t.Fatalf("no output must be emitted when the data-quality gate fails, got: %s", stdout.String())
	}
	if !strings.Contains(stderr.String(), "DATA QUALITY GATE FAILED") {
		t.Fatalf("expected gate-failure report, got: %s", stderr.String())
	}
	if !strings.Contains(stderr.String(), "line 2") || !strings.Contains(stderr.String(), "line 3") {
		t.Fatalf("expected both offending lines reported, got: %s", stderr.String())
	}
}

func TestRun_MissingInputPathExitsWithUsageError(t *testing.T) {
	var stdout, stderr strings.Builder
	code := run(nil, &stdout, &stderr)
	if code != 2 {
		t.Fatalf("exit code=%d want 2", code)
	}
	if !strings.Contains(stderr.String(), "missing input CSV path") {
		t.Fatalf("expected missing-input message, got: %s", stderr.String())
	}
}

func TestRun_FlagsAfterPositionalPathAreHonored(t *testing.T) {
	// The documented invocation is `hrisconvert <original.csv> --emails ... -o ...`
	// (path first). Standard flag parsing stops at the first positional, so
	// without re-parsing, --emails and -o would be dropped silently — emitting
	// login-blocking empty emails to stdout with exit code 0.
	in := writeTemp(t, "raw.csv", rawFixture)
	emailsCSV := writeTemp(t, "emails.csv", "nik,email\n1000000001,satu@mea.co.id\n1000000002,dua@mea.co.id\n")
	outPath := filepath.Join(t.TempDir(), "out.csv")
	var stdout, stderr strings.Builder
	code := run([]string{in, "-emails", emailsCSV, "-o", outPath}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit code=%d want 0; stderr=%s", code, stderr.String())
	}
	if stdout.String() != "" {
		t.Fatalf("expected nothing on stdout when -o is set after the path, got: %s", stdout.String())
	}
	body, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatalf("-o after the path was not honored: %v", err)
	}
	if !strings.Contains(string(body), "1000000001,Contoh Satu,satu@mea.co.id,SALES,Sales Executive,true") {
		t.Fatalf("-emails after the path was not honored, got: %s", body)
	}
	if strings.Contains(stderr.String(), "NO email") {
		t.Fatalf("should not warn about missing emails once all are mapped: %s", stderr.String())
	}
}

func TestRun_ExtraPositionalArgumentIsRejected(t *testing.T) {
	in := writeTemp(t, "raw.csv", rawFixture)
	other := writeTemp(t, "other.csv", rawFixture)
	var stdout, stderr strings.Builder
	code := run([]string{in, other}, &stdout, &stderr)
	if code != 2 {
		t.Fatalf("exit code=%d want 2; stderr=%s", code, stderr.String())
	}
	if !strings.Contains(stderr.String(), "unexpected extra argument") {
		t.Fatalf("expected extra-argument error, got: %s", stderr.String())
	}
}
