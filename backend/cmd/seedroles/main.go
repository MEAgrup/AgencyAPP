// Command seedroles seeds the production `role_mappings` and
// `employee_layered_roles` tables from the final mapping decisions
// (Nerissa 2026-07-10/11, docs/DECISIONS.md), using the real HRIS employee
// export as the source of the concrete (divisi, jabatan) pairs to resolve.
//
// It is the counterpart to hrisconvert: hrisconvert turns the raw HR sheet
// into employees.csv; seedroles takes that employees.csv plus two committed
// decision files and produces the exact role_mappings / layered-role rows.
//
// Usage:
//
//	seedroles [dry-run] --employees employees.csv --mapping ROLE_MAPPING_FINAL.csv --layered LAYERED_ROLES.csv
//	seedroles apply     --actor <NIK Director> --employees ... --mapping ... --layered ...   (env CDPS_DSN)
//
// Input files:
//
//   - --employees : hrisconvert output (employee_id,nama,email,divisi,jabatan,
//     status_aktif). NOT committed — it is PII; regenerate via hrisconvert.
//   - --mapping   : department,jabatan,division,level. jabatan="*" is a
//     department-wide wildcard; a specific jabatan row beats the wildcard.
//     division="-" means EXCLUDED (no CDPS access, no role_mappings row).
//     level="auto" derives staff/lead from the jabatan (lead-pattern
//     heuristic below); an explicit "staff"/"lead" is used verbatim.
//   - --layered   : employee_id,role,enabled  (role: od|director|viewer).
//
// Like hrisconvert's data-quality gate, seedroles never silently drops a pair:
// a (divisi, jabatan) whose department has no mapping rule, an invalid level,
// an unknown layered employee_id, or a bad layered role are ALL reported and
// are fatal (nonzero exit, no rows written / no output emitted).
//
// dry-run is pure (no DB) and prints the resolved role_mappings CSV to stdout
// plus a run summary to stderr. apply resolves the Director actor from the DB
// (auth.ResolveActor) — a non-Director actor is rejected — then upserts every
// row via admin.UpsertRoleMapping / admin.SetLayeredRole in deterministic
// order.
package main

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"github.com/meagrup/agencyapp/backend/internal/admin"
	"github.com/meagrup/agencyapp/backend/internal/auth"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/db"
	"github.com/meagrup/agencyapp/backend/internal/hris"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// leadTokens are the whole-word jabatan tokens that mark a lead/SPV under the
// level="auto" heuristic. Matching is case-insensitive and token-wise (whole
// word), so MENTOR is NOT a lead and "OVERHEAD" would not match HEAD.
var leadTokens = map[string]bool{
	"HEAD": true, "LEAD": true, "LEADER": true, "SPV": true, "SUPERVISOR": true,
}

// validLayeredRoles is the literal set seedroles accepts for a layered role.
// (SetLayeredRole enforces its own set server-side; this is the CLI gate.)
var validLayeredRoles = map[string]bool{"od": true, "director": true, "viewer": true}

func run(args []string, stdout, stderr io.Writer) int {
	// Subcommand: optional leading "dry-run" (default) or "apply".
	mode := "dry-run"
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		mode = args[0]
		args = args[1:]
	}
	if mode != "dry-run" && mode != "apply" {
		fmt.Fprintf(stderr, "seedroles: mode tidak dikenal %q (pakai dry-run|apply)\n", mode)
		usage(stderr)
		return 2
	}

	var (
		employeesPath, mappingPath, layeredPath, actorID string
	)
	rest := args
	for len(rest) > 0 {
		a := rest[0]
		takeVal := func() (string, bool) {
			if len(rest) < 2 {
				return "", false
			}
			v := rest[1]
			rest = rest[2:]
			return v, true
		}
		var ok bool
		switch a {
		case "--employees", "-employees":
			employeesPath, ok = takeVal()
		case "--mapping", "-mapping":
			mappingPath, ok = takeVal()
		case "--layered", "-layered":
			layeredPath, ok = takeVal()
		case "--actor", "-actor":
			actorID, ok = takeVal()
		default:
			fmt.Fprintf(stderr, "seedroles: argumen tidak dikenal %q\n", a)
			usage(stderr)
			return 2
		}
		if !ok {
			fmt.Fprintf(stderr, "seedroles: %s membutuhkan sebuah nilai\n", a)
			usage(stderr)
			return 2
		}
	}

	if employeesPath == "" || mappingPath == "" || layeredPath == "" {
		fmt.Fprintln(stderr, "seedroles: --employees, --mapping dan --layered wajib diisi")
		usage(stderr)
		return 2
	}

	emps, mapping, layered, err := loadInputs(employeesPath, mappingPath, layeredPath)
	if err != nil {
		fmt.Fprintf(stderr, "seedroles: %v\n", err)
		return 1
	}

	plan := buildPlan(emps, mapping, layered)

	if len(plan.Errors) > 0 {
		printGateReport(stderr, plan)
		return 1
	}

	if mode == "dry-run" {
		if err := writeResolvedCSV(stdout, plan); err != nil {
			fmt.Fprintf(stderr, "seedroles: tulis csv: %v\n", err)
			return 1
		}
		printSummary(stderr, plan, "dry-run")
		return 0
	}

	// apply
	if actorID == "" {
		fmt.Fprintln(stderr, "seedroles: apply membutuhkan --actor <NIK Director>")
		return 2
	}
	ctx := context.Background()
	d, err := db.Open(db.DSN())
	if err != nil {
		fmt.Fprintf(stderr, "seedroles: open db: %v\n", err)
		return 1
	}
	defer d.Close()

	actor, err := auth.ResolveActor(ctx, d, actorID)
	if err != nil {
		fmt.Fprintf(stderr, "seedroles: resolve actor %s: %v\n", actorID, err)
		return 1
	}
	if !actor.Role.Director {
		fmt.Fprintf(stderr, "seedroles: actor %s (%s) bukan Director — seeding role/layered hanya boleh oleh Director\n",
			actorID, actor.Nama)
		return 1
	}

	for _, u := range plan.Upserts {
		if _, err := admin.UpsertRoleMapping(ctx, d, actor, admin.RoleMapping{
			Divisi: u.Divisi, Jabatan: u.Jabatan, Division: u.Division, Level: u.Level,
		}); err != nil {
			fmt.Fprintf(stderr, "seedroles: upsert role_mapping (%s/%s): %v\n", u.Divisi, u.Jabatan, err)
			return 1
		}
	}
	for _, la := range plan.Layered {
		if err := admin.SetLayeredRole(ctx, d, actor, la.EmployeeID, la.Role, la.Enabled); err != nil {
			fmt.Fprintf(stderr, "seedroles: set layered role (%s %s): %v\n", la.EmployeeID, la.Role, err)
			return 1
		}
	}
	printSummary(stderr, plan, "apply")
	fmt.Fprintf(stderr, "seedroles: apply OK — %d role_mappings, %d layered roles (actor %s %s)\n",
		len(plan.Upserts), len(plan.Layered), actorID, actor.Nama)
	return 0
}

func usage(stderr io.Writer) {
	fmt.Fprintln(stderr, "usage: seedroles [dry-run|apply] --employees <csv> --mapping <csv> --layered <csv> [--actor <NIK> (apply)]")
}

// ---- input parsing ---------------------------------------------------------

// mappingRule is one parsed line of the mapping CSV.
type mappingRule struct {
	Department string
	Jabatan    string // "*" => department wildcard
	Division   string // "-" => EXCLUDED
	Level      string // auto | staff | lead | "-" (excluded)
}

// ruleSet groups a department's rules: an optional wildcard plus specific
// jabatan overrides (keyed by upper-cased jabatan).
type ruleSet struct {
	wildcard *mappingRule
	specific map[string]mappingRule
}

// layeredAssign is one parsed line of the layered CSV.
type layeredAssign struct {
	EmployeeID string
	Role       string
	Enabled    bool
}

func loadInputs(employeesPath, mappingPath, layeredPath string) ([]hris.Employee, map[string]ruleSet, []layeredAssign, error) {
	ef, err := os.Open(employeesPath)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("buka --employees %s: %w", employeesPath, err)
	}
	defer ef.Close()
	recs, err := hris.ParseEmployeeCSV(ef)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("parse --employees: %w", err)
	}
	emps := make([]hris.Employee, len(recs))
	for i, r := range recs {
		emps[i] = r.Employee
	}

	mf, err := os.Open(mappingPath)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("buka --mapping %s: %w", mappingPath, err)
	}
	defer mf.Close()
	mapping, err := parseMapping(mf)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("parse --mapping: %w", err)
	}

	lf, err := os.Open(layeredPath)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("buka --layered %s: %w", layeredPath, err)
	}
	defer lf.Close()
	layered, err := parseLayered(lf)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("parse --layered: %w", err)
	}
	return emps, mapping, layered, nil
}

// parseMapping reads department,jabatan,division,level. A header row (first
// column == "department", case-insensitive) is skipped. A duplicate wildcard
// or duplicate specific jabatan for the same department is a hard error (the
// decision file must be unambiguous).
func parseMapping(r io.Reader) (map[string]ruleSet, error) {
	cr := csv.NewReader(r)
	cr.TrimLeadingSpace = true
	cr.FieldsPerRecord = -1
	out := map[string]ruleSet{}
	first := true
	for {
		row, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if first {
			first = false
			if len(row) > 0 && strings.EqualFold(strings.TrimSpace(row[0]), "department") {
				continue
			}
		}
		if len(row) < 4 {
			return nil, fmt.Errorf("baris mapping butuh 4 kolom (department,jabatan,division,level), dapat %d: %v", len(row), row)
		}
		dept := strings.TrimSpace(row[0])
		jab := strings.TrimSpace(row[1])
		div := strings.TrimSpace(row[2])
		lvl := strings.TrimSpace(row[3])
		if dept == "" || jab == "" {
			return nil, fmt.Errorf("baris mapping dengan department/jabatan kosong: %v", row)
		}
		key := strings.ToUpper(dept)
		rs := out[key]
		if rs.specific == nil {
			rs.specific = map[string]mappingRule{}
		}
		rule := mappingRule{Department: dept, Jabatan: jab, Division: div, Level: lvl}
		if jab == "*" {
			if rs.wildcard != nil {
				return nil, fmt.Errorf("wildcard ganda untuk department %q", dept)
			}
			w := rule
			rs.wildcard = &w
		} else {
			jk := strings.ToUpper(jab)
			if _, dup := rs.specific[jk]; dup {
				return nil, fmt.Errorf("aturan jabatan ganda %q untuk department %q", jab, dept)
			}
			rs.specific[jk] = rule
		}
		out[key] = rs
	}
	return out, nil
}

// parseLayered reads employee_id,role,enabled. A header row (first column ==
// "employee_id") is skipped.
func parseLayered(r io.Reader) ([]layeredAssign, error) {
	cr := csv.NewReader(r)
	cr.TrimLeadingSpace = true
	cr.FieldsPerRecord = -1
	var out []layeredAssign
	first := true
	for {
		row, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if first {
			first = false
			if len(row) > 0 && strings.EqualFold(strings.TrimSpace(row[0]), "employee_id") {
				continue
			}
		}
		if len(row) < 3 {
			return nil, fmt.Errorf("baris layered butuh 3 kolom (employee_id,role,enabled), dapat %d: %v", len(row), row)
		}
		id := strings.TrimSpace(row[0])
		role := strings.ToLower(strings.TrimSpace(row[1]))
		if id == "" {
			return nil, fmt.Errorf("baris layered dengan employee_id kosong: %v", row)
		}
		enabled, err := strconv.ParseBool(strings.TrimSpace(row[2]))
		if err != nil {
			return nil, fmt.Errorf("baris layered %q: enabled %q bukan boolean", id, row[2])
		}
		out = append(out, layeredAssign{EmployeeID: id, Role: role, Enabled: enabled})
	}
	return out, nil
}

// ---- plan ------------------------------------------------------------------

type upsertRow struct {
	Divisi, Jabatan, Division, Level string
}

type excludedDept struct {
	Department string
	Count      int
}

// Plan is the fully resolved seeding plan (pure output of buildPlan).
type Plan struct {
	Upserts        []upsertRow     // one per distinct MAPPED (divisi,jabatan), sorted
	DivisionCounts map[string]int  // CDPS division -> employees granted access
	Excluded       []excludedDept  // per department, sorted (mapped-but-no-access)
	Layered        []layeredAssign // valid layered assignments, input order
	Errors         []string        // fatal problems (all reported; any => nonzero exit)
	EmployeesIn    int
	DistinctPairs  int
	MappedCount    int // employees with a CDPS division granted
	ExcludedCount  int // employees resolved to "-" (no access)
}

func buildPlan(emps []hris.Employee, mapping map[string]ruleSet, layered []layeredAssign) Plan {
	type pairKey struct{ divisi, jabatan string }
	pairCount := map[pairKey]int{}
	empIDs := map[string]bool{}
	for _, e := range emps {
		pairCount[pairKey{e.Divisi, e.Jabatan}]++
		empIDs[e.EmployeeID] = true
	}

	pairs := make([]pairKey, 0, len(pairCount))
	for k := range pairCount {
		pairs = append(pairs, k)
	}
	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].divisi != pairs[j].divisi {
			return pairs[i].divisi < pairs[j].divisi
		}
		return pairs[i].jabatan < pairs[j].jabatan
	})

	plan := Plan{
		DivisionCounts: map[string]int{},
		EmployeesIn:    len(emps),
		DistinctPairs:  len(pairs),
	}
	excludedByDept := map[string]int{}

	for _, p := range pairs {
		count := pairCount[p]
		rule, ok := resolveRule(mapping, p.divisi, p.jabatan)
		if !ok {
			plan.Errors = append(plan.Errors, fmt.Sprintf(
				"tidak ada aturan mapping untuk (divisi=%q, jabatan=%q) — %d karyawan; tambahkan baris spesifik atau wildcard '*' di mapping.csv",
				p.divisi, p.jabatan, count))
			continue
		}
		if rule.Division == "-" {
			excludedByDept[p.divisi] += count
			plan.ExcludedCount += count
			continue
		}
		level, lerr := resolveLevel(rule, p.jabatan)
		if lerr != nil {
			plan.Errors = append(plan.Errors, fmt.Sprintf(
				"level tidak valid untuk (divisi=%q, jabatan=%q): %v", p.divisi, p.jabatan, lerr))
			continue
		}
		plan.Upserts = append(plan.Upserts, upsertRow{
			Divisi: p.divisi, Jabatan: p.jabatan, Division: rule.Division, Level: level,
		})
		plan.DivisionCounts[rule.Division] += count
		plan.MappedCount += count
	}

	for dept, n := range excludedByDept {
		plan.Excluded = append(plan.Excluded, excludedDept{Department: dept, Count: n})
	}
	sort.Slice(plan.Excluded, func(i, j int) bool { return plan.Excluded[i].Department < plan.Excluded[j].Department })

	// Layered assignments: validate role set + that the employee exists.
	for _, la := range layered {
		if !validLayeredRoles[la.Role] {
			plan.Errors = append(plan.Errors, fmt.Sprintf(
				"layered role %q tidak valid untuk %s (harus od|director|viewer)", la.Role, la.EmployeeID))
			continue
		}
		if !empIDs[la.EmployeeID] {
			plan.Errors = append(plan.Errors, fmt.Sprintf(
				"layered employee_id %q tidak ditemukan di employees.csv (role %s)", la.EmployeeID, la.Role))
			continue
		}
		plan.Layered = append(plan.Layered, la)
	}

	return plan
}

// resolveRule returns the winning rule for (divisi, jabatan): a specific
// jabatan override beats the department wildcard. ok=false when the department
// is absent OR present without a matching specific rule or wildcard (both are
// fatal — no silent drop).
func resolveRule(mapping map[string]ruleSet, divisi, jabatan string) (mappingRule, bool) {
	rs, ok := mapping[strings.ToUpper(strings.TrimSpace(divisi))]
	if !ok {
		return mappingRule{}, false
	}
	if r, ok := rs.specific[strings.ToUpper(strings.TrimSpace(jabatan))]; ok {
		return r, true
	}
	if rs.wildcard != nil {
		return *rs.wildcard, true
	}
	return mappingRule{}, false
}

// resolveLevel maps a rule to a concrete staff/lead level. "auto" applies the
// lead-pattern heuristic to the jabatan; explicit staff/lead is used verbatim.
func resolveLevel(rule mappingRule, jabatan string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(rule.Level)) {
	case "auto":
		if isLeadJabatan(jabatan) {
			return permission.LevelLead, nil
		}
		return permission.LevelStaff, nil
	case permission.LevelStaff:
		return permission.LevelStaff, nil
	case permission.LevelLead:
		return permission.LevelLead, nil
	default:
		return "", fmt.Errorf("level %q bukan auto|staff|lead", rule.Level)
	}
}

// isLeadJabatan reports whether the jabatan carries a lead/SPV whole-word
// token (HEAD/LEAD/LEADER/SPV/SUPERVISOR, case-insensitive). Tokenizing on
// non-alphanumeric runes keeps it whole-word: MENTOR is staff, and a substring
// like the HEAD in "OVERHEAD" would not match.
func isLeadJabatan(jabatan string) bool {
	toks := strings.FieldsFunc(jabatan, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	for _, t := range toks {
		if leadTokens[strings.ToUpper(t)] {
			return true
		}
	}
	return false
}

// ---- output ----------------------------------------------------------------

// writeResolvedCSV emits the concrete role_mappings the plan would upsert.
func writeResolvedCSV(w io.Writer, plan Plan) error {
	cw := csv.NewWriter(w)
	if err := cw.Write([]string{"divisi", "jabatan", "division", "level"}); err != nil {
		return err
	}
	for _, u := range plan.Upserts {
		if err := cw.Write([]string{u.Divisi, u.Jabatan, u.Division, u.Level}); err != nil {
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}

func printGateReport(stderr io.Writer, plan Plan) {
	fmt.Fprintf(stderr, "seedroles: GATE GAGAL — %d masalah fatal, tidak ada baris ditulis / output dikosongkan\n", len(plan.Errors))
	for _, e := range plan.Errors {
		fmt.Fprintf(stderr, "  - %s\n", e)
	}
	fmt.Fprintln(stderr, "Perbaiki mapping.csv / layered.csv (atau data sumber) lalu ulangi. Tidak ada pasangan yang di-drop diam-diam.")
}

func printSummary(stderr io.Writer, plan Plan, mode string) {
	fmt.Fprintf(stderr, "seedroles: %s — %d karyawan, %d pasangan divisi|jabatan unik\n",
		mode, plan.EmployeesIn, plan.DistinctPairs)
	fmt.Fprintf(stderr, "  role_mappings di-upsert: %d\n", len(plan.Upserts))
	fmt.Fprintf(stderr, "  karyawan ter-mapping (punya akses): %d ; excluded (tanpa akses tersisa): %d\n",
		plan.MappedCount, plan.ExcludedCount)

	fmt.Fprintln(stderr, "  per divisi CDPS:")
	divs := make([]string, 0, len(plan.DivisionCounts))
	for d := range plan.DivisionCounts {
		divs = append(divs, d)
	}
	sort.Strings(divs)
	for _, d := range divs {
		fmt.Fprintf(stderr, "    %-10s %d\n", d+":", plan.DivisionCounts[d])
	}

	fmt.Fprintln(stderr, "  EXCLUDED per department (ada di mapping.csv → tanpa akses):")
	for _, ex := range plan.Excluded {
		fmt.Fprintf(stderr, "    %s: %d\n", ex.Department, ex.Count)
	}

	fmt.Fprintf(stderr, "  layered roles di-set: %d\n", len(plan.Layered))
	for _, la := range plan.Layered {
		fmt.Fprintf(stderr, "    %s %s=%t\n", la.EmployeeID, la.Role, la.Enabled)
	}
}
