// Command seedroles seeds role_mappings (and optionally layered OD/Director
// assignments) for the REAL HRIS employee population, driven by the
// department policy validated by OD on 2026-07-11 — see
// docs/handoff/HRIS_ROLE_MAPPING_DRAFT.md §0 and docs/DECISIONS.md same date.
//
// It is deliberately separate from backend/internal/seed (the Alpha Digital
// worked-example fixture) and from cmd/import (the W1-19 lead/client
// migration) — this tool only ever touches role_mappings and, optionally,
// employee_layered_roles.
//
// Usage:
//
//	seedroles --employees employees_from_hris.csv --policy configs/role_mapping_dept.csv \
//	    --actor <NIK> [--layered layered.csv] [--dry-run=true|--apply]
//
// employees_from_hris.csv is EmployeeSource shape
// (employee_id,nama,email,divisi,jabatan,status_aktif), i.e. the output of
// hrisconvert. --policy is the committed department policy CSV (see
// backend/configs/role_mapping_dept.csv): department,policy(map|exclude|no-access),division.
//
// Behavior:
//   - For every DISTINCT (divisi,jabatan) pair among employees whose
//     department policy is "map", the level (staff|lead) is computed via the
//     jabatan-keyword heuristic (internal/seedroles.Level) and a
//     role_mappings row is upserted (admin.UpsertRoleMapping).
//   - A department found in the employees CSV that has NO entry in the policy
//     CSV is a HARD ERROR — never guessed (house convention: PRD/policy
//     ambiguous => stop, do not silently pick an interpretation).
//   - A department whose policy is "exclude" but still appears in the
//     employees CSV is a hard WARNING (it should already have been filtered
//     out by `hrisconvert --exclude-dept`).
//   - "no-access" departments are synced as employees (already true via
//     hris.Sync elsewhere) but deliberately get NO role_mappings row — they
//     are only reported here for visibility.
//   - --layered (optional) assigns OD/Director per employee_id via
//     admin.SetLayeredRole — never per-department (see §2 of the draft: OD
//     and Director are layered roles on an individual account, not a
//     department mapping).
//
// --dry-run defaults to true: it prints the full plan (mappings, no-access
// groups, warnings) and writes nothing. Pass --apply to actually write to the
// DB (mutually exclusive with a bare --dry-run; --apply always wins if both
// are somehow set).
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"sort"

	"github.com/meagrup/agencyapp/backend/internal/admin"
	"github.com/meagrup/agencyapp/backend/internal/auth"
	"github.com/meagrup/agencyapp/backend/internal/db"
	"github.com/meagrup/agencyapp/backend/internal/hris"
	"github.com/meagrup/agencyapp/backend/internal/seedroles"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("seedroles", flag.ContinueOnError)
	fs.SetOutput(stderr)
	employeesPath := fs.String("employees", "", "path to EmployeeSource CSV (employee_id,nama,email,divisi,jabatan,status_aktif) — output of hrisconvert")
	policyPath := fs.String("policy", "", "path to department policy CSV (department,policy,division) — default backend/configs/role_mapping_dept.csv")
	layeredPath := fs.String("layered", "", "optional CSV employee_id,role for OD/Director assignment via admin.SetLayeredRole")
	actorID := fs.String("actor", "", "employee_id of the actor performing the seed (required, for audit — same pattern as cmd/import)")
	dryRun := fs.Bool("dry-run", true, "print the plan without writing to the DB (default true)")
	apply := fs.Bool("apply", false, "actually write to the DB; overrides --dry-run")
	fs.Usage = func() {
		fmt.Fprintln(stderr, "usage: seedroles --employees <csv> --policy <csv> --actor <NIK> [--layered <csv>] [--dry-run=true|--apply]")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return 2
	}

	if *employeesPath == "" {
		fmt.Fprintln(stderr, "seedroles: --employees is required")
		fs.Usage()
		return 2
	}
	policyPathVal := *policyPath
	if policyPathVal == "" {
		policyPathVal = "configs/role_mapping_dept.csv"
	}
	if *actorID == "" {
		fmt.Fprintln(stderr, "seedroles: --actor <employee_id> is required")
		fs.Usage()
		return 2
	}

	ef, err := os.Open(*employeesPath)
	if err != nil {
		fmt.Fprintf(stderr, "seedroles: open --employees %s: %v\n", *employeesPath, err)
		return 1
	}
	defer ef.Close()
	records, err := hris.ParseEmployeeCSV(ef)
	if err != nil {
		fmt.Fprintf(stderr, "seedroles: parse --employees: %v\n", err)
		return 1
	}
	employees := make([]hris.Employee, len(records))
	for i, r := range records {
		employees[i] = r.Employee
	}

	pf, err := os.Open(policyPathVal)
	if err != nil {
		fmt.Fprintf(stderr, "seedroles: open --policy %s: %v\n", policyPathVal, err)
		return 1
	}
	defer pf.Close()
	policy, err := seedroles.ParsePolicyCSV(pf)
	if err != nil {
		fmt.Fprintf(stderr, "seedroles: %v\n", err)
		return 1
	}

	plan, err := seedroles.BuildPlan(employees, policy)
	if err != nil {
		// UnknownDepartmentError et al. — never guessed, always a hard stop.
		fmt.Fprintf(stderr, "seedroles: %v\n", err)
		return 1
	}

	var layered []seedroles.LayeredAssignment
	if *layeredPath != "" {
		lf, err := os.Open(*layeredPath)
		if err != nil {
			fmt.Fprintf(stderr, "seedroles: open --layered %s: %v\n", *layeredPath, err)
			return 1
		}
		layered, err = seedroles.ParseLayeredCSV(lf)
		lf.Close()
		if err != nil {
			fmt.Fprintf(stderr, "seedroles: %v\n", err)
			return 1
		}
	}

	printPlan(stdout, plan, layered)

	// --apply is the only thing that gates a write; --dry-run is accepted for
	// explicitness/symmetry with other CLIs in this repo (cmd/import's
	// -dryrun/-apply subcommand pairs), but setting --dry-run=false alone does
	// NOT write anything -- catch that likely user mistake explicitly.
	if !*apply {
		if !*dryRun {
			fmt.Fprintln(stderr, "seedroles: --dry-run=false alone does not apply changes; pass --apply explicitly to write to the DB.")
		}
		fmt.Fprintln(stdout, "\n[DRY RUN] Nothing was written. Pass --apply to write these role_mappings (and layered roles) to the DB.")
		return 0
	}

	d, err := db.Open(db.DSN())
	if err != nil {
		fmt.Fprintf(stderr, "seedroles: open db: %v\n", err)
		return 1
	}
	defer d.Close()

	ctx := context.Background()
	actor, err := auth.ResolveActor(ctx, d, *actorID)
	if err != nil {
		fmt.Fprintf(stderr, "seedroles: resolve actor %s: %v\n", *actorID, err)
		return 1
	}

	for _, m := range plan.Mappings {
		if _, err := admin.UpsertRoleMapping(ctx, d, actor, admin.RoleMapping{
			Divisi: m.Divisi, Jabatan: m.Jabatan, Division: m.Division, Level: m.Level,
		}); err != nil {
			fmt.Fprintf(stderr, "seedroles: upsert role_mapping (%s,%s): %v\n", m.Divisi, m.Jabatan, err)
			return 1
		}
	}
	for _, la := range layered {
		if err := admin.SetLayeredRole(ctx, d, actor, la.EmployeeID, la.Role, true); err != nil {
			fmt.Fprintf(stderr, "seedroles: set layered role %s/%s: %v\n", la.EmployeeID, la.Role, err)
			return 1
		}
	}

	fmt.Fprintf(stdout, "\n[APPLIED] %d role_mappings upserted, %d layered role(s) assigned.\n", len(plan.Mappings), len(layered))
	return 0
}

func printPlan(w io.Writer, plan seedroles.Plan, layered []seedroles.LayeredAssignment) {
	fmt.Fprintf(w, "seedroles: plan — %d distinct (divisi,jabatan) mapping(s), %d no-access department group(s), %d excluded-but-present warning(s), %d layered assignment(s)\n\n",
		len(plan.Mappings), len(plan.NoAccessGroups), len(plan.ExcludedFound), len(layered))

	fmt.Fprintln(w, "-- role_mappings to seed (divisi | jabatan | division | level | employee count) --")
	for _, m := range plan.Mappings {
		fmt.Fprintf(w, "  %-24s | %-24s -> %-10s %-6s (n=%d)\n", m.Divisi, m.Jabatan, m.Division, m.Level, m.Count)
	}
	if len(plan.Mappings) == 0 {
		fmt.Fprintln(w, "  (none)")
	}

	fmt.Fprintln(w, "\n-- departments synced WITHOUT role_mappings (no-access policy) --")
	for _, g := range plan.NoAccessGroups {
		fmt.Fprintf(w, "  %-24s (n=%d) — no access\n", g.Department, g.Count)
	}
	if len(plan.NoAccessGroups) == 0 {
		fmt.Fprintln(w, "  (none)")
	}

	if len(plan.ExcludedFound) > 0 {
		fmt.Fprintln(w, "\n-- WARNING: policy=exclude departments still present in employees CSV (should have been filtered by hrisconvert --exclude-dept) --")
		for _, g := range plan.ExcludedFound {
			fmt.Fprintf(w, "  %-24s (n=%d)\n", g.Department, g.Count)
		}
	}

	if len(layered) > 0 {
		fmt.Fprintln(w, "\n-- layered role assignments (--layered) --")
		sorted := append([]seedroles.LayeredAssignment(nil), layered...)
		sort.Slice(sorted, func(i, j int) bool {
			if sorted[i].EmployeeID != sorted[j].EmployeeID {
				return sorted[i].EmployeeID < sorted[j].EmployeeID
			}
			return sorted[i].Role < sorted[j].Role
		})
		for _, la := range sorted {
			fmt.Fprintf(w, "  %-12s -> %s\n", la.EmployeeID, la.Role)
		}
	}
}
