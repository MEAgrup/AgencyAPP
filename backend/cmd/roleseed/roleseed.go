package main

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/admin"
	"github.com/meagrup/agencyapp/backend/internal/hris"
)

// validDivisions are the six CDPS delivery divisions actually wired into
// permission.go / the modules. UpsertRoleMapping only validates level, so a
// typo'd division would silently produce a role nobody's visibility matches —
// the CLI gates it here instead.
var validDivisions = map[string]bool{
	"Sales": true, "Account": true, "Creative": true, "Ads": true, "KOL": true, "Finance": true,
}

// MappingIssue is one fatal data problem in the mapping CSV (no silent drops).
type MappingIssue struct {
	Line   int
	Detail string
}

// LoadMappings parses and validates the `divisi,jabatan,division,level` CSV.
// Every problem is reported (not just the first); any issue means the run
// must not write.
func LoadMappings(r io.Reader) ([]admin.RoleMapping, []MappingIssue, error) {
	cr := csv.NewReader(r)
	cr.TrimLeadingSpace = true
	cr.FieldsPerRecord = -1

	header, err := cr.Read()
	if err == io.EOF {
		return nil, nil, fmt.Errorf("mapping csv kosong, tidak ada header")
	}
	if err != nil {
		return nil, nil, fmt.Errorf("baca header: %w", err)
	}
	want := []string{"divisi", "jabatan", "division", "level"}
	if len(header) < len(want) {
		return nil, nil, fmt.Errorf("header kurang kolom: dapat %v, butuh %v", header, want)
	}
	for i, w := range want {
		if !strings.EqualFold(strings.TrimSpace(header[i]), w) {
			return nil, nil, fmt.Errorf("header kolom %d = %q, harus %q", i+1, header[i], w)
		}
	}

	var (
		out    []admin.RoleMapping
		issues []MappingIssue
		seen   = map[string]int{} // upper(divisi)|upper(jabatan) -> first line
	)
	line := 1
	for {
		row, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, nil, fmt.Errorf("baca baris: %w", err)
		}
		line++
		if len(row) < 4 {
			issues = append(issues, MappingIssue{line, fmt.Sprintf("kolom kurang: %d dari 4", len(row))})
			continue
		}
		m := admin.RoleMapping{
			Divisi:   strings.TrimSpace(row[0]),
			Jabatan:  strings.TrimSpace(row[1]),
			Division: strings.TrimSpace(row[2]),
			Level:    strings.TrimSpace(row[3]),
		}
		if m.Divisi == "" || m.Jabatan == "" || m.Division == "" || m.Level == "" {
			issues = append(issues, MappingIssue{line, "field kosong (semua kolom wajib terisi)"})
			continue
		}
		if !validDivisions[m.Division] {
			issues = append(issues, MappingIssue{line, fmt.Sprintf("division %q tidak dikenal (valid: Sales/Account/Creative/Ads/KOL/Finance)", m.Division)})
		}
		if m.Level != "staff" && m.Level != "lead" {
			issues = append(issues, MappingIssue{line, fmt.Sprintf("level %q tidak dikenal (valid: staff/lead)", m.Level)})
		}
		key := strings.ToUpper(m.Divisi) + "|" + strings.ToUpper(m.Jabatan)
		if first, dup := seen[key]; dup {
			issues = append(issues, MappingIssue{line, fmt.Sprintf("duplikat pasangan divisi|jabatan (pertama di baris %d)", first)})
		} else {
			seen[key] = line
		}
		out = append(out, m)
	}
	return out, issues, nil
}

// MappingPlan is one dry-run plan row: CREATE / UPDATE / SAMA vs the DB.
type MappingPlan struct {
	Action string // "CREATE" | "UPDATE" | "SAMA"
	M      admin.RoleMapping
	Note   string // for UPDATE: the old value
}

// PlanMappings diffs the desired mappings against existing rows. Keys are
// compared case-insensitively to mirror MySQL's ci collation on the unique
// key (an upsert with different casing updates, not duplicates).
func PlanMappings(existing, desired []admin.RoleMapping) []MappingPlan {
	cur := map[string]admin.RoleMapping{}
	for _, e := range existing {
		cur[strings.ToUpper(e.Divisi)+"|"+strings.ToUpper(e.Jabatan)] = e
	}
	out := make([]MappingPlan, 0, len(desired))
	for _, m := range desired {
		key := strings.ToUpper(m.Divisi) + "|" + strings.ToUpper(m.Jabatan)
		e, ok := cur[key]
		switch {
		case !ok:
			out = append(out, MappingPlan{Action: "CREATE", M: m})
		case e.Division == m.Division && e.Level == m.Level:
			out = append(out, MappingPlan{Action: "SAMA", M: m})
		default:
			out = append(out, MappingPlan{Action: "UPDATE", M: m,
				Note: fmt.Sprintf(" (sebelumnya %s/%s)", e.Division, e.Level)})
		}
	}
	return out
}

// SplitNIKList splits a comma-separated NIK list, trimming and dropping
// empties (never inventing entries).
func SplitNIKList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if v := strings.TrimSpace(p); v != "" {
			out = append(out, v)
		}
	}
	return out
}

// FilteredSource wraps an EmployeeSource and drops the excluded employee IDs
// (decision O28e: CREATIVE - EKSTERNAL are not synced as active users). It
// records which exclusions were actually seen, so a typo'd NIK — which would
// silently sync someone decided as no-login — can be surfaced as an error.
type FilteredSource struct {
	Src     hris.EmployeeSource
	Exclude map[string]bool

	seen map[string]bool
}

// Name implements hris.EmployeeSource.
func (f *FilteredSource) Name() string { return f.Src.Name() + " (roleseed filter)" }

// Fetch implements hris.EmployeeSource.
func (f *FilteredSource) Fetch(ctx context.Context, since time.Time) ([]hris.Employee, error) {
	all, err := f.Src.Fetch(ctx, since)
	if err != nil {
		return nil, err
	}
	f.seen = map[string]bool{}
	out := make([]hris.Employee, 0, len(all))
	for _, e := range all {
		if f.Exclude[e.EmployeeID] {
			f.seen[e.EmployeeID] = true
			continue
		}
		out = append(out, e)
	}
	return out, nil
}

// ExcludedSeen lists exclusions that matched a CSV row (sorted).
func (f *FilteredSource) ExcludedSeen() []string { return sortedKeys(f.seen) }

// ExcludedNotSeen lists exclusions that matched nothing (sorted) — a typo
// guard; only meaningful after Fetch.
func (f *FilteredSource) ExcludedNotSeen() []string {
	miss := map[string]bool{}
	for k := range f.Exclude {
		if !f.seen[k] {
			miss[k] = true
		}
	}
	return sortedKeys(miss)
}

// timeZero is the zero time (full sync) — named for call-site readability.
func timeZero() time.Time { return time.Time{} }
