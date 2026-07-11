// Package seedroles builds role_mappings (and optional layered OD/Director
// assignments) for the REAL HRIS employee population, driven by the
// department policy validated by OD on 2026-07-11 (see
// docs/handoff/HRIS_ROLE_MAPPING_DRAFT.md §0 and docs/DECISIONS.md same date).
//
// It never guesses: a DEPARTMENT that appears in the employees CSV but is
// absent from the policy file is a hard error (per CLAUDE.md — "if the PRD is
// ambiguous ... STOP and flag it", applied here to an unvalidated department).
//
// This package is pure planning logic (no DB calls) so it can be unit tested
// without a database; the DB-touching apply step lives in cmd/seedroles.
package seedroles

import (
	"encoding/csv"
	"fmt"
	"io"
	"sort"
	"strings"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/hris"
)

// Policy values for the department policy CSV's "policy" column.
const (
	PolicyMap      = "map"
	PolicyExclude  = "exclude"
	PolicyNoAccess = "no-access"
)

// DeptPolicy is one row of the committed department-policy CSV
// (backend/configs/role_mapping_dept.csv): department,policy,division.
type DeptPolicy struct {
	Department string // raw, as written in the policy file (kept for reporting)
	Policy     string // map | exclude | no-access
	Division   string // required (non-empty) iff Policy == map
}

// PolicyTable indexes DeptPolicy by normalized (trim + uppercase) department
// name, matching the same normalization hrisconvert's --exclude-dept uses
// (hris.NormalizeDept), so a department validated once behaves identically
// across both tools.
type PolicyTable map[string]DeptPolicy

// ParsePolicyCSV parses the department policy CSV. Header row required:
// department,policy,division. policy must be one of map/exclude/no-access;
// division is required when policy=map and must be empty otherwise (an
// explicit config error, not a silent default) so the committed file can't
// drift into an ambiguous state.
func ParsePolicyCSV(r io.Reader) (PolicyTable, error) {
	cr := csv.NewReader(r)
	cr.TrimLeadingSpace = true
	cr.FieldsPerRecord = -1
	out := PolicyTable{}
	header := true
	line := 0
	for {
		row, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("seedroles: policy csv: reading row: %w", err)
		}
		line++
		if header {
			header = false
			continue
		}
		if len(row) < 2 {
			return nil, fmt.Errorf("seedroles: policy csv line %d: expected >=2 columns, got %d", line, len(row))
		}
		dept := strings.TrimSpace(row[0])
		policy := strings.ToLower(strings.TrimSpace(row[1]))
		division := ""
		if len(row) >= 3 {
			division = strings.TrimSpace(row[2])
		}
		if dept == "" {
			return nil, fmt.Errorf("seedroles: policy csv line %d: empty department", line)
		}
		switch policy {
		case PolicyMap:
			if division == "" {
				return nil, fmt.Errorf("seedroles: policy csv line %d: department %q has policy=map but no division", line, dept)
			}
		case PolicyExclude, PolicyNoAccess:
			if division != "" {
				return nil, fmt.Errorf("seedroles: policy csv line %d: department %q has policy=%s but a division (%q) was given — division only applies to policy=map", line, dept, policy, division)
			}
		default:
			return nil, fmt.Errorf("seedroles: policy csv line %d: department %q has unknown policy %q (want map|exclude|no-access)", line, dept, policy)
		}
		norm := hris.NormalizeDept(dept)
		if existing, ok := out[norm]; ok {
			return nil, fmt.Errorf("seedroles: policy csv line %d: department %q duplicates an earlier row (%q)", line, dept, existing.Department)
		}
		out[norm] = DeptPolicy{Department: dept, Policy: policy, Division: division}
	}
	return out, nil
}

// Level applies the crude jabatan-keyword heuristic from
// docs/handoff/HRIS_ROLE_MAPPING_DRAFT.md §2: JABATAN containing (case
// insensitive) HEAD OF / SPV / SUPERVISOR / LEADER / LEAD => "lead", else
// "staff". This is a stopgap, not a substitute for the explicit per-jabatan
// table the draft calls for once the real pairs list is reviewed manually.
func Level(jabatan string) string {
	upper := strings.ToUpper(jabatan)
	for _, kw := range []string{"HEAD OF", "SPV", "SUPERVISOR", "LEADER", "LEAD"} {
		if strings.Contains(upper, kw) {
			return permission.LevelLead
		}
	}
	return permission.LevelStaff
}

// PlannedMapping is one distinct (divisi,jabatan) pair from the employees CSV
// resolved to a CDPS role_mappings row, ready for admin.UpsertRoleMapping.
type PlannedMapping struct {
	Divisi   string
	Jabatan  string
	Division string
	Level    string
	Count    int // number of employees carrying this exact (divisi,jabatan)
}

// NoAccessGroup summarizes employees synced without a role_mappings row
// (policy=no-access), grouped by department for the dry-run report.
type NoAccessGroup struct {
	Department string
	Count      int
}

// ExcludedGroup summarizes employees found in the CSV whose department is
// policy=exclude — this should never happen if hrisconvert --exclude-dept was
// used upstream, so it is surfaced as a hard warning, not silently skipped.
type ExcludedGroup struct {
	Department string
	Count      int
}

// Plan is the full seeding plan computed from the employees CSV + policy
// table, before any DB write.
type Plan struct {
	Mappings       []PlannedMapping // sorted by Divisi, Jabatan
	NoAccessGroups []NoAccessGroup  // sorted by Department
	ExcludedFound  []ExcludedGroup  // sorted by Department; non-empty = warn loudly
}

// UnknownDepartmentError reports a DEPARTMENT present in the employees CSV
// that has no entry in the policy table at all. Per house convention this is
// a hard stop, never a guess.
type UnknownDepartmentError struct {
	Departments []string // sorted, as they appear (raw) in the employees CSV
}

func (e *UnknownDepartmentError) Error() string {
	return fmt.Sprintf("seedroles: %d department(s) in the employees CSV have no policy entry (add them to the policy CSV first, do not guess): %s",
		len(e.Departments), strings.Join(e.Departments, ", "))
}

// BuildPlan computes the seeding plan from parsed employees and the policy
// table. Employees are grouped by the RAW (divisi,jabatan) pair, since
// role_mappings keys on the exact HRIS strings (see admin.RoleMapping);
// department policy lookup is normalized (trim+uppercase) per NormalizeDept.
func BuildPlan(employees []hris.Employee, policy PolicyTable) (Plan, error) {
	type mapKey struct{ divisi, jabatan string }
	mapCounts := map[mapKey]int{}
	noAccessCounts := map[string]int{}
	excludedCounts := map[string]int{}
	var unknown []string
	unknownSeen := map[string]bool{}

	for _, emp := range employees {
		norm := hris.NormalizeDept(emp.Divisi)
		pol, ok := policy[norm]
		if !ok {
			if !unknownSeen[emp.Divisi] {
				unknownSeen[emp.Divisi] = true
				unknown = append(unknown, emp.Divisi)
			}
			continue
		}
		switch pol.Policy {
		case PolicyMap:
			mapCounts[mapKey{emp.Divisi, emp.Jabatan}]++
		case PolicyNoAccess:
			noAccessCounts[emp.Divisi]++
		case PolicyExclude:
			// Should already be filtered out upstream (hrisconvert --exclude-dept).
			// Still counted, never silently dropped, per house convention.
			excludedCounts[emp.Divisi]++
		}
	}

	if len(unknown) > 0 {
		sort.Strings(unknown)
		return Plan{}, &UnknownDepartmentError{Departments: unknown}
	}

	var plan Plan
	for k, n := range mapCounts {
		pol := policy[hris.NormalizeDept(k.divisi)]
		plan.Mappings = append(plan.Mappings, PlannedMapping{
			Divisi: k.divisi, Jabatan: k.jabatan, Division: pol.Division, Level: Level(k.jabatan), Count: n,
		})
	}
	sort.Slice(plan.Mappings, func(i, j int) bool {
		if plan.Mappings[i].Divisi != plan.Mappings[j].Divisi {
			return plan.Mappings[i].Divisi < plan.Mappings[j].Divisi
		}
		return plan.Mappings[i].Jabatan < plan.Mappings[j].Jabatan
	})

	for dept, n := range noAccessCounts {
		plan.NoAccessGroups = append(plan.NoAccessGroups, NoAccessGroup{Department: dept, Count: n})
	}
	sort.Slice(plan.NoAccessGroups, func(i, j int) bool { return plan.NoAccessGroups[i].Department < plan.NoAccessGroups[j].Department })

	for dept, n := range excludedCounts {
		plan.ExcludedFound = append(plan.ExcludedFound, ExcludedGroup{Department: dept, Count: n})
	}
	sort.Slice(plan.ExcludedFound, func(i, j int) bool { return plan.ExcludedFound[i].Department < plan.ExcludedFound[j].Department })

	return plan, nil
}

// LayeredAssignment is one --layered CSV row: employee_id,role (role is "od"
// or "director", validated by admin.SetLayeredRole at apply time).
type LayeredAssignment struct {
	EmployeeID string
	Role       string
}

// ParseLayeredCSV parses the optional --layered employee_id,role CSV.
func ParseLayeredCSV(r io.Reader) ([]LayeredAssignment, error) {
	cr := csv.NewReader(r)
	cr.TrimLeadingSpace = true
	cr.FieldsPerRecord = -1
	var out []LayeredAssignment
	header := true
	line := 0
	for {
		row, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("seedroles: layered csv: reading row: %w", err)
		}
		line++
		if header {
			header = false
			continue
		}
		if len(row) < 2 {
			return nil, fmt.Errorf("seedroles: layered csv line %d: expected >=2 columns, got %d", line, len(row))
		}
		empID := strings.TrimSpace(row[0])
		role := strings.ToLower(strings.TrimSpace(row[1]))
		if empID == "" {
			return nil, fmt.Errorf("seedroles: layered csv line %d: empty employee_id", line)
		}
		if role != "od" && role != "director" {
			return nil, fmt.Errorf("seedroles: layered csv line %d: role %q must be 'od' or 'director'", line, role)
		}
		out = append(out, LayeredAssignment{EmployeeID: empID, Role: role})
	}
	return out, nil
}
