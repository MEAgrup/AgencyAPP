package hris_test

// Pure unit tests for the raw-HRIS-export -> EmployeeSource-CSV converter
// (internal/hris/convert.go). No DB. All fixtures are synthetic (no real
// employee names/NIKs — PII).

import (
	"strings"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/hris"
)

// mergedHeaderFixture mirrors the real shape reported by HR: a leading "No"
// column, Indonesian month abbreviations in JOIN DATE, and the sheet's first
// two rows being duplicated merged-header artifacts (the header itself, plus
// one echoed repeat before the real data starts). It also contains a blank
// separator row (all commas, no data) further down, which must be tolerated
// the same way.
const mergedHeaderFixture = `No,NIK,JOIN DATE,NAMA LENGKAP,DEPARTMENT,JABATAN
No,NIK,JOIN DATE,NAMA LENGKAP,DEPARTMENT,JABATAN
1,1000000001,18-Jan-2021,Contoh Satu,SALES,Sales Executive
2,1000000002,24-Mei-2021,Contoh Dua,ACCOUNT,Account Manager
,,,,,
3,1000000003,03-Mar-2022,Contoh Tiga,CREATIVE,Creative Designer
`

func TestParseOriginalCSV_MergedHeaderAndBlankArtifactsTolerated(t *testing.T) {
	res, err := hris.ParseOriginalCSV(strings.NewReader(mergedHeaderFixture))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(res.Issues) != 0 {
		t.Fatalf("expected no issues, got %+v", res.Issues)
	}
	if res.RowsIn != 3 {
		t.Fatalf("RowsIn=%d want 3 (header repeat + blank row must not count)", res.RowsIn)
	}
	if len(res.Rows) != 3 {
		t.Fatalf("len(Rows)=%d want 3", len(res.Rows))
	}
	want := []string{"1000000001", "1000000002", "1000000003"}
	for i, w := range want {
		if res.Rows[i].NIK != w {
			t.Errorf("Rows[%d].NIK=%q want %q", i, res.Rows[i].NIK, w)
		}
	}
	if res.Rows[0].NamaLengkap != "Contoh Satu" || res.Rows[0].Department != "SALES" || res.Rows[0].Jabatan != "Sales Executive" {
		t.Errorf("Rows[0]=%+v unexpected", res.Rows[0])
	}
	if len(res.Warnings) != 0 {
		t.Fatalf("expected no warnings for 10-digit NIKs, got %+v", res.Warnings)
	}
}

func TestParseOriginalCSV_OddNIKLengthIsWarningNotFatal(t *testing.T) {
	// One NIK has 9 digits, mirroring the real dirt observed in the sheet.
	in := `No,NIK,JOIN DATE,NAMA LENGKAP,DEPARTMENT,JABATAN
1,100000001,18-Jan-2021,Contoh Satu,SALES,Sales Executive
2,1000000002,24-Mei-2021,Contoh Dua,ACCOUNT,Account Manager
`
	res, err := hris.ParseOriginalCSV(strings.NewReader(in))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(res.Issues) != 0 {
		t.Fatalf("odd NIK length must not be fatal, got issues: %+v", res.Issues)
	}
	if len(res.Warnings) != 1 {
		t.Fatalf("warnings=%d want 1", len(res.Warnings))
	}
	if res.Warnings[0].Row.NIK != "100000001" {
		t.Errorf("warning row NIK=%q want 100000001", res.Warnings[0].Row.NIK)
	}
	// The row must still be emitted despite the warning.
	if len(res.Rows) != 2 {
		t.Fatalf("len(Rows)=%d want 2 (row still emitted on warning)", len(res.Rows))
	}
}

func TestParseOriginalCSV_DuplicateNIKIsFatalAndReportsAllRows(t *testing.T) {
	in := `No,NIK,JOIN DATE,NAMA LENGKAP,DEPARTMENT,JABATAN
1,1000000001,18-Jan-2021,Contoh Satu,SALES,Sales Executive
2,1000000001,24-Mei-2021,Contoh Dua,ACCOUNT,Account Manager
`
	res, err := hris.ParseOriginalCSV(strings.NewReader(in))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(res.Issues) != 2 {
		t.Fatalf("expected 2 issues (both rows sharing the duplicate NIK reported), got %d: %+v", len(res.Issues), res.Issues)
	}
	for _, iss := range res.Issues {
		if iss.Field != "duplicate_nik" {
			t.Errorf("issue field=%q want duplicate_nik", iss.Field)
		}
	}
}

func TestParseOriginalCSV_EmptyRequiredFieldOnRealDataRowIsFatal(t *testing.T) {
	// NIK present but NAMA LENGKAP empty on an otherwise real data row: this
	// is NOT a header/blank artifact (NIK is populated) so it must be
	// reported, never silently dropped.
	in := `No,NIK,JOIN DATE,NAMA LENGKAP,DEPARTMENT,JABATAN
1,1000000001,18-Jan-2021,,SALES,Sales Executive
`
	res, err := hris.ParseOriginalCSV(strings.NewReader(in))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(res.Issues) != 1 || res.Issues[0].Field != "nama_lengkap" {
		t.Fatalf("expected 1 nama_lengkap issue, got %+v", res.Issues)
	}
	if res.RowsIn != 1 {
		t.Fatalf("RowsIn=%d want 1 (a row with partial data is a real data row, not a skipped artifact)", res.RowsIn)
	}
}

func TestParseOriginalCSV_EmptyNIKWithOtherDataIsFatalNotSkipped(t *testing.T) {
	// A row missing only NIK, with every other column populated, must be
	// reported as fatal dirt — it must NOT be silently treated as a header
	// or blank-row artifact just because its NIK cell is empty.
	in := `No,NIK,JOIN DATE,NAMA LENGKAP,DEPARTMENT,JABATAN
1,,18-Jan-2021,Contoh Satu,SALES,Sales Executive
`
	res, err := hris.ParseOriginalCSV(strings.NewReader(in))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(res.Issues) != 1 || res.Issues[0].Field != "nik" {
		t.Fatalf("expected 1 nik issue, got %+v", res.Issues)
	}
}

func TestParseOriginalCSV_MissingRequiredColumnErrors(t *testing.T) {
	in := "No,NIK,JOIN DATE,NAMA LENGKAP,JABATAN\n1,1000000001,18-Jan-2021,Contoh Satu,Sales Executive\n"
	if _, err := hris.ParseOriginalCSV(strings.NewReader(in)); err == nil {
		t.Fatal("expected error for missing DEPARTMENT column")
	}
}

func TestDistinctPairs_SortedWithCounts(t *testing.T) {
	rows := []hris.OriginalRow{
		{NIK: "1", Department: "SALES", Jabatan: "Sales Executive"},
		{NIK: "2", Department: "SALES", Jabatan: "Sales Executive"},
		{NIK: "3", Department: "ACCOUNT", Jabatan: "Account Manager"},
		{NIK: "4", Department: "SALES", Jabatan: "Sales Head"},
	}
	pairs := hris.DistinctPairs(rows)
	if len(pairs) != 3 {
		t.Fatalf("len(pairs)=%d want 3", len(pairs))
	}
	// Sorted by Department then Jabatan.
	if pairs[0].Department != "ACCOUNT" {
		t.Errorf("pairs[0].Department=%q want ACCOUNT (alphabetically first)", pairs[0].Department)
	}
	if pairs[1].Department != "SALES" || pairs[1].Jabatan != "Sales Executive" || pairs[1].Count != 2 {
		t.Errorf("pairs[1]=%+v unexpected", pairs[1])
	}
	if pairs[2].Department != "SALES" || pairs[2].Jabatan != "Sales Head" || pairs[2].Count != 1 {
		t.Errorf("pairs[2]=%+v unexpected", pairs[2])
	}
}

func TestParseNIKEmailMap_MergeIntoEmployeeCSV(t *testing.T) {
	rows := []hris.OriginalRow{
		{NIK: "1000000001", NamaLengkap: "Contoh Satu", Department: "SALES", Jabatan: "Sales Executive"},
		{NIK: "1000000002", NamaLengkap: "Contoh Dua", Department: "ACCOUNT", Jabatan: "Account Manager"},
	}
	emails, err := hris.ParseNIKEmailMap(strings.NewReader("nik,email\n1000000001,satu@mea.co.id\n"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if emails["1000000001"] != "satu@mea.co.id" {
		t.Fatalf("email for 1000000001=%q want satu@mea.co.id", emails["1000000001"])
	}
	if _, ok := emails["1000000002"]; ok {
		t.Fatalf("1000000002 must not get a fabricated email")
	}

	var buf strings.Builder
	if err := hris.WriteEmployeeCSV(&buf, rows, emails); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	out := buf.String()
	if !strings.Contains(out, "employee_id,nama,email,divisi,jabatan,status_aktif\n") {
		t.Fatalf("missing expected header, got: %s", out)
	}
	if !strings.Contains(out, "1000000001,Contoh Satu,satu@mea.co.id,SALES,Sales Executive,true\n") {
		t.Fatalf("missing expected mapped-email row, got: %s", out)
	}
	if !strings.Contains(out, "1000000002,Contoh Dua,,ACCOUNT,Account Manager,true\n") {
		t.Fatalf("missing expected empty-email row (not fabricated), got: %s", out)
	}
	if hris.CountEmptyEmails(rows, emails) != 1 {
		t.Fatalf("CountEmptyEmails=%d want 1", hris.CountEmptyEmails(rows, emails))
	}
}

func TestSplitExcludeDepts_TrimAndCaseInsensitive(t *testing.T) {
	got := hris.SplitExcludeDepts(" mcn , Creative - Eksternal ,,")
	if len(got) != 2 {
		t.Fatalf("len(got)=%d want 2: %+v", len(got), got)
	}
	if !got["MCN"] || !got["CREATIVE - EKSTERNAL"] {
		t.Fatalf("expected normalized keys MCN and CREATIVE - EKSTERNAL, got %+v", got)
	}
}

func TestSplitExcludeDepts_Empty(t *testing.T) {
	if got := hris.SplitExcludeDepts(""); len(got) != 0 {
		t.Fatalf("expected empty map for empty flag value, got %+v", got)
	}
}

func TestPartitionExcluded_FiltersCaseInsensitiveTrimmed(t *testing.T) {
	rows := []hris.OriginalRow{
		{Line: 2, NIK: "1", NamaLengkap: "Satu", Department: "SALES", Jabatan: "Sales Executive"},
		{Line: 3, NIK: "2", NamaLengkap: "Dua", Department: " mcn ", Jabatan: "Staff MCN"},
		{Line: 4, NIK: "3", NamaLengkap: "Tiga", Department: "Creative - Eksternal", Jabatan: "Freelancer"},
		{Line: 5, NIK: "4", NamaLengkap: "Empat", Department: "ACCOUNT", Jabatan: "Account Manager"},
	}
	excludeDepts := hris.SplitExcludeDepts("MCN,CREATIVE - EKSTERNAL")
	kept, excluded := hris.PartitionExcluded(rows, excludeDepts)
	if len(kept) != 2 {
		t.Fatalf("len(kept)=%d want 2: %+v", len(kept), kept)
	}
	if kept[0].NIK != "1" || kept[1].NIK != "4" {
		t.Fatalf("kept order/content unexpected: %+v", kept)
	}
	if len(excluded) != 2 {
		t.Fatalf("len(excluded)=%d want 2: %+v", len(excluded), excluded)
	}
	if excluded[0].Row.NIK != "2" || excluded[1].Row.NIK != "3" {
		t.Fatalf("excluded order/content unexpected: %+v", excluded)
	}
}

func TestPartitionExcluded_NoExclusionsReturnsAllAsKept(t *testing.T) {
	rows := []hris.OriginalRow{
		{NIK: "1", Department: "SALES"},
		{NIK: "2", Department: "MCN"},
	}
	kept, excluded := hris.PartitionExcluded(rows, nil)
	if len(kept) != 2 || len(excluded) != 0 {
		t.Fatalf("with no exclude depts, expected all rows kept; kept=%d excluded=%d", len(kept), len(excluded))
	}
}

func TestWritePairsCSV(t *testing.T) {
	pairs := []hris.DeptJabatanPair{
		{Department: "ACCOUNT", Jabatan: "Account Manager", Count: 3},
		{Department: "SALES", Jabatan: "Sales Executive", Count: 5},
	}
	var buf strings.Builder
	if err := hris.WritePairsCSV(&buf, pairs); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := "department,jabatan,count\nACCOUNT,Account Manager,3\nSALES,Sales Executive,5\n"
	if buf.String() != want {
		t.Fatalf("got:\n%s\nwant:\n%s", buf.String(), want)
	}
}
