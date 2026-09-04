package hris

import (
	"encoding/csv"
	"fmt"
	"io"
	"sort"
	"strings"
)

// This file converts the RAW HRIS spreadsheet export (as handed over by HR,
// columns `No | NIK | JOIN DATE | NAMA LENGKAP | DEPARTMENT | JABATAN`) into
// the EmployeeSource fallback CSV format consumed by CSVSource/ParseEmployeeCSV
// (source.go): `employee_id,nama,email,divisi,jabatan,status_aktif`.
//
// It never touches the DB and never invents data (no fabricated emails, no
// guessed statuses) — see cmd/hrisconvert for the CLI that drives this.

// OriginalRow is one accepted data row from the raw HRIS export.
type OriginalRow struct {
	Line        int // 1-based source line number (from the CSV reader)
	NIK         string
	NamaLengkap string
	Department  string
	Jabatan     string
}

// String renders the row's content for data-quality reports.
func (r OriginalRow) String() string {
	return fmt.Sprintf("NIK=%q NAMA LENGKAP=%q DEPARTMENT=%q JABATAN=%q", r.NIK, r.NamaLengkap, r.Department, r.Jabatan)
}

// ConvertIssue is one FATAL data-quality problem found in the raw export.
// Per CLAUDE.md house rules there is no silent-drop path: every offending row
// is surfaced, never quietly skipped.
type ConvertIssue struct {
	Line   int
	Field  string // "nik" | "nama_lengkap" | "department" | "jabatan" | "duplicate_nik"
	Detail string
	Row    OriginalRow
}

// ConvertWarning is a non-fatal data-quality note; the row is still emitted.
type ConvertWarning struct {
	Line   int
	Detail string
	Row    OriginalRow
}

// ConvertResult is the outcome of parsing a raw HRIS export.
type ConvertResult struct {
	Rows     []OriginalRow // accepted data rows, in source order
	Issues   []ConvertIssue
	Warnings []ConvertWarning
	RowsIn   int // data rows scanned (header/merged-header/blank artifact rows excluded)
}

// requiredColumns are matched case-insensitively, trimmed, against the header
// row. "No" (row number) and "JOIN DATE" are tolerated but never required —
// JOIN DATE is read only to keep column alignment; its value (including
// Indonesian month abbreviations like "24-Mei-2021") is never parsed or
// emitted.
var requiredColumns = []string{"NIK", "NAMA LENGKAP", "DEPARTMENT", "JABATAN"}

// ParseOriginalCSV parses the raw HRIS export. It tolerates a leading "No"
// column, a JOIN DATE column (ignored), surrounding whitespace, and
// repeated/merged-header-row artifacts (a row is treated as such an artifact,
// and silently skipped, only when it is indistinguishable from the header
// itself: NIK cell literally "NIK", or the row is entirely blank across every
// tracked column). A row with a genuinely missing NIK but other data present
// is NOT an artifact — it is real dirt and is reported as a fatal
// ConvertIssue instead, per the no-silent-drop rule.
func ParseOriginalCSV(r io.Reader) (ConvertResult, error) {
	cr := csv.NewReader(r)
	cr.TrimLeadingSpace = true
	cr.FieldsPerRecord = -1

	headerRow, err := cr.Read()
	if err == io.EOF {
		return ConvertResult{}, fmt.Errorf("hris convert: empty input, no header row")
	}
	if err != nil {
		return ConvertResult{}, fmt.Errorf("hris convert: reading header: %w", err)
	}

	col := map[string]int{}
	for i, h := range headerRow {
		col[strings.ToUpper(strings.TrimSpace(h))] = i
	}
	var missing []string
	for _, want := range requiredColumns {
		if _, ok := col[want]; !ok {
			missing = append(missing, want)
		}
	}
	if len(missing) > 0 {
		return ConvertResult{}, fmt.Errorf("hris convert: header missing required column(s) %v (got %v)", missing, headerRow)
	}
	nikIdx, namaIdx, deptIdx, jabIdx := col["NIK"], col["NAMA LENGKAP"], col["DEPARTMENT"], col["JABATAN"]

	var res ConvertResult
	seen := map[string][]OriginalRow{} // nik -> every accepted row carrying it, for duplicate detection

	cell := func(row []string, idx int) string {
		if idx < 0 || idx >= len(row) {
			return ""
		}
		return strings.TrimSpace(row[idx])
	}

	for {
		row, rerr := cr.Read()
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return ConvertResult{}, fmt.Errorf("hris convert: reading row: %w", rerr)
		}
		line := 0
		if pos, ok := fieldPos(cr, 0); ok {
			line = pos
		}

		nik := cell(row, nikIdx)
		nama := cell(row, namaIdx)
		dept := cell(row, deptIdx)
		jab := cell(row, jabIdx)

		// Merged/repeated header artifact: either the header row echoed again
		// (NIK cell literally "NIK"), or an entirely blank row from a merged
		// cell in the source sheet.
		if strings.EqualFold(nik, "NIK") {
			continue
		}
		if nik == "" && nama == "" && dept == "" && jab == "" {
			continue
		}

		res.RowsIn++
		row2 := OriginalRow{Line: line, NIK: nik, NamaLengkap: nama, Department: dept, Jabatan: jab}

		if nik == "" {
			res.Issues = append(res.Issues, ConvertIssue{Line: line, Field: "nik", Detail: "NIK kosong", Row: row2})
		} else {
			seen[nik] = append(seen[nik], row2)
			if len(nik) != 10 {
				res.Warnings = append(res.Warnings, ConvertWarning{Line: line,
					Detail: fmt.Sprintf("NIK %q panjangnya %d karakter (diharapkan 10)", nik, len(nik)), Row: row2})
			}
		}
		if nama == "" {
			res.Issues = append(res.Issues, ConvertIssue{Line: line, Field: "nama_lengkap", Detail: "NAMA LENGKAP kosong", Row: row2})
		}
		if dept == "" {
			res.Issues = append(res.Issues, ConvertIssue{Line: line, Field: "department", Detail: "DEPARTMENT kosong", Row: row2})
		}
		if jab == "" {
			res.Issues = append(res.Issues, ConvertIssue{Line: line, Field: "jabatan", Detail: "JABATAN kosong", Row: row2})
		}

		res.Rows = append(res.Rows, row2)
	}

	// Duplicate-NIK gate: any NIK seen on more than one accepted row is
	// fatal — every row sharing it is reported (not just the second one).
	dupNiks := make([]string, 0, len(seen))
	for nik, rows := range seen {
		if len(rows) > 1 {
			dupNiks = append(dupNiks, nik)
		}
	}
	sort.Strings(dupNiks)
	for _, nik := range dupNiks {
		for _, row2 := range seen[nik] {
			res.Issues = append(res.Issues, ConvertIssue{Line: row2.Line, Field: "duplicate_nik",
				Detail: fmt.Sprintf("NIK %q muncul %d kali", nik, len(seen[nik])), Row: row2})
		}
	}
	sort.Slice(res.Issues, func(i, j int) bool { return res.Issues[i].Line < res.Issues[j].Line })

	return res, nil
}

// fieldPos calls (*csv.Reader).FieldPos defensively — it panics if idx is out
// of range for the record just read, which should not happen for a non-blank
// line, but a CLI tool must never panic on messy real-world input.
func fieldPos(cr *csv.Reader, idx int) (line int, ok bool) {
	defer func() {
		if recover() != nil {
			ok = false
		}
	}()
	l, _ := cr.FieldPos(idx)
	return l, true
}

// ParseNIKEmailMap parses the optional --emails mapping: a 2-column CSV
// `nik,email` with a required header row (same convention as
// ParseEmployeeCSV). Emails are never fabricated: a NIK absent here simply
// gets no email. If a NIK repeats, the last row wins (this file is HR-review
// input, not the primary data-quality gate — that gate applies to the raw
// export itself).
func ParseNIKEmailMap(r io.Reader) (map[string]string, error) {
	cr := csv.NewReader(r)
	cr.TrimLeadingSpace = true
	cr.FieldsPerRecord = -1
	out := map[string]string{}
	header := true
	for {
		row, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("hris convert: reading --emails row: %w", err)
		}
		if header {
			header = false
			continue
		}
		if len(row) < 2 {
			return nil, fmt.Errorf("hris convert: --emails: expected >=2 columns, got %d", len(row))
		}
		nik := strings.TrimSpace(row[0])
		email := strings.TrimSpace(row[1])
		if nik == "" {
			continue
		}
		out[nik] = email
	}
	return out, nil
}

// DeptJabatanPair is one distinct DEPARTMENT/JABATAN combination with its
// occurrence count, feeding the role-mapping table draft.
type DeptJabatanPair struct {
	Department string
	Jabatan    string
	Count      int
}

// DistinctPairs computes the sorted, deduplicated DEPARTMENT/JABATAN pairs
// (with counts) across the accepted rows.
func DistinctPairs(rows []OriginalRow) []DeptJabatanPair {
	type key struct{ dept, jab string }
	counts := map[key]int{}
	for _, row := range rows {
		counts[key{row.Department, row.Jabatan}]++
	}
	out := make([]DeptJabatanPair, 0, len(counts))
	for k, n := range counts {
		out = append(out, DeptJabatanPair{Department: k.dept, Jabatan: k.jab, Count: n})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Department != out[j].Department {
			return out[i].Department < out[j].Department
		}
		return out[i].Jabatan < out[j].Jabatan
	})
	return out
}

// WriteEmployeeCSV writes the EmployeeSource fallback CSV
// (employee_id,nama,email,divisi,jabatan,status_aktif) for the given rows.
// emails may be nil; a row whose NIK has no entry gets an empty email column
// (never fabricated). Every row is emitted with status_aktif=true — everyone
// on the sheet is a current employee; departures are handled by absence on
// the next full sync (the existing flagged_for_review behavior in sync.go).
func WriteEmployeeCSV(w io.Writer, rows []OriginalRow, emails map[string]string) error {
	cw := csv.NewWriter(w)
	if err := cw.Write([]string{"employee_id", "nama", "email", "divisi", "jabatan", "status_aktif"}); err != nil {
		return err
	}
	for _, row := range rows {
		email := emails[row.NIK]
		if err := cw.Write([]string{row.NIK, row.NamaLengkap, email, row.Department, row.Jabatan, "true"}); err != nil {
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}

// WritePairsCSV writes the distinct DEPARTMENT,JABATAN,COUNT CSV.
func WritePairsCSV(w io.Writer, pairs []DeptJabatanPair) error {
	cw := csv.NewWriter(w)
	if err := cw.Write([]string{"department", "jabatan", "count"}); err != nil {
		return err
	}
	for _, p := range pairs {
		if err := cw.Write([]string{p.Department, p.Jabatan, fmt.Sprintf("%d", p.Count)}); err != nil {
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}

// CountEmptyEmails reports how many rows would be emitted with an empty
// email column, for the CLI run summary.
func CountEmptyEmails(rows []OriginalRow, emails map[string]string) int {
	n := 0
	for _, row := range rows {
		if emails[row.NIK] == "" {
			n++
		}
	}
	return n
}
