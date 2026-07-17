// Command roleseed applies the REAL go-live role decisions (DECISIONS.md
// 2026-07-17) to the database: role_mappings from the validated CSV
// (seed/role_mappings_riil.csv), optional employee sync from an EmployeeSource
// CSV with an exclusion list (e.g. CREATIVE - EKSTERNAL, no-login), and layered
// OD/Director roles per employee NIK.
//
// It does NOT touch backend/internal/seed (Alpha Digital fixture) — per
// HRIS_ROLE_MAPPING_DRAFT.md §1 the real data is seeded through the same
// admin.UpsertRoleMapping / admin.SetLayeredRole paths as the admin UI, so
// every write is validated and audited.
//
// Usage:
//
//	roleseed [-mappings seed/role_mappings_riil.csv]
//	         [-employees testdata/import_samples/employees_from_hris.csv]
//	         [-exclude-nik nik,nik,...] [-od nik,...] [-director nik,...]
//	         [-apply]
//
// Default is a DRY-RUN: it prints the full plan (create/update/unchanged per
// mapping, sync row counts, layered-role changes) and writes nothing. All
// input is validated before anything is written; one invalid row fails the
// whole run (no silent drops, exit code non-zero).
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"

	"github.com/meagrup/agencyapp/backend/internal/admin"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/db"
	"github.com/meagrup/agencyapp/backend/internal/hris"
)

// systemDirector mirrors the bootstrap actor pattern in internal/seed: at
// go-live no real Director account exists yet, so privileged seed writes run
// as the synthetic SYSTEM director (audited as such).
var systemDirector = permission.Actor{EmployeeID: "SYSTEM", Role: permission.Role{Director: true}}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("roleseed", flag.ContinueOnError)
	fs.SetOutput(stderr)
	mappingsPath := fs.String("mappings", "seed/role_mappings_riil.csv", "CSV mapping riil `divisi,jabatan,division,level`")
	employeesPath := fs.String("employees", "", "CSV EmployeeSource untuk sync karyawan (kosong = sync dilewati)")
	excludeNIK := fs.String("exclude-nik", "", "daftar NIK dipisah koma yang DIKECUALIKAN dari sync (keputusan: CREATIVE - EKSTERNAL tanpa login)")
	odList := fs.String("od", "", "daftar NIK dipisah koma untuk layered role OD")
	dirList := fs.String("director", "", "daftar NIK dipisah koma untuk layered role Director")
	apply := fs.Bool("apply", false, "tulis ke DB (default: dry-run, hanya menampilkan rencana)")
	fs.Usage = func() {
		fmt.Fprintln(stderr, "usage: roleseed [-mappings file.csv] [-employees file.csv] [-exclude-nik n,n] [-od n,n] [-director n,n] [-apply]")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return 2
	}

	ctx := context.Background()

	// 1) Load + validate the mapping CSV fully before touching the DB.
	f, err := os.Open(*mappingsPath)
	if err != nil {
		fmt.Fprintf(stderr, "roleseed: open -mappings %s: %v\n", *mappingsPath, err)
		return 1
	}
	mappings, issues, err := LoadMappings(f)
	f.Close()
	if err != nil {
		fmt.Fprintf(stderr, "roleseed: %v\n", err)
		return 1
	}
	if len(issues) > 0 {
		for _, is := range issues {
			fmt.Fprintf(stderr, "roleseed: mapping baris %d: %s\n", is.Line, is.Detail)
		}
		fmt.Fprintf(stderr, "roleseed: %d masalah pada %s — tidak ada yang ditulis\n", len(issues), *mappingsPath)
		return 1
	}

	ods := SplitNIKList(*odList)
	dirs := SplitNIKList(*dirList)
	exclude := SplitNIKList(*excludeNIK)

	d, err := db.Open(db.DSN())
	if err != nil {
		fmt.Fprintf(stderr, "roleseed: open db: %v\n", err)
		return 1
	}
	defer d.Close()

	// 2) Mapping plan (diff vs existing rows).
	existing, err := admin.ListRoleMappings(ctx, d)
	if err != nil {
		fmt.Fprintf(stderr, "roleseed: list role_mappings: %v\n", err)
		return 1
	}
	plan := PlanMappings(existing, mappings)
	for _, p := range plan {
		fmt.Fprintf(stdout, "mapping %-8s %s | %s -> %s/%s%s\n", p.Action, p.M.Divisi, p.M.Jabatan, p.M.Division, p.M.Level, p.Note)
	}
	fmt.Fprintf(stdout, "mapping: %d baris (create %d, update %d, sama %d)\n",
		len(plan), countAction(plan, "CREATE"), countAction(plan, "UPDATE"), countAction(plan, "SAMA"))

	// 3) Employee sync plan.
	var src hris.EmployeeSource
	if *employeesPath != "" {
		base := hris.NewCSVSource(*employeesPath)
		fsrc := &FilteredSource{Src: base, Exclude: toSet(exclude)}
		emps, err := fsrc.Fetch(ctx, timeZero())
		if err != nil {
			fmt.Fprintf(stderr, "roleseed: baca -employees %s: %v\n", *employeesPath, err)
			return 1
		}
		missing := fsrc.ExcludedNotSeen()
		if len(missing) > 0 {
			// A typo in -exclude-nik would silently sync someone decided as
			// no-login — that is data dirt, fail loudly.
			fmt.Fprintf(stderr, "roleseed: -exclude-nik tidak ditemukan di CSV: %s\n", strings.Join(missing, ", "))
			return 1
		}
		fmt.Fprintf(stdout, "sync: %d karyawan akan disync, %d dikecualikan (%s)\n",
			len(emps), len(fsrc.ExcludedSeen()), strings.Join(fsrc.ExcludedSeen(), ", "))
		src = fsrc
	} else {
		fmt.Fprintln(stdout, "sync: dilewati (tanpa -employees)")
	}

	// 4) Layered-role plan. Targets must exist as employees; when a sync is
	// part of this run the check is deferred to post-sync on apply.
	type layered struct{ nik, role string }
	var lays []layered
	for _, n := range ods {
		lays = append(lays, layered{n, "od"})
	}
	for _, n := range dirs {
		lays = append(lays, layered{n, "director"})
	}
	for _, l := range lays {
		fmt.Fprintf(stdout, "layered %-8s -> %s\n", l.role, l.nik)
	}

	if !*apply {
		fmt.Fprintln(stdout, "DRY-RUN: tidak ada yang ditulis. Jalankan ulang dengan -apply untuk menerapkan.")
		return 0
	}

	// APPLY — order matters: mappings first (sync/login resolve roles from
	// them), then employees, then layered roles (need employee rows).
	for _, m := range mappings {
		if _, err := admin.UpsertRoleMapping(ctx, d, systemDirector, m); err != nil {
			fmt.Fprintf(stderr, "roleseed: upsert mapping %s|%s: %v\n", m.Divisi, m.Jabatan, err)
			return 1
		}
	}
	fmt.Fprintf(stdout, "APPLY: %d role_mappings di-upsert\n", len(mappings))

	if src != nil {
		res, err := hris.Sync(ctx, d, src, "SYSTEM", true)
		if err != nil {
			fmt.Fprintf(stderr, "roleseed: sync: %v\n", err)
			return 1
		}
		fmt.Fprintf(stdout, "APPLY: sync selesai (synced %d, deactivated %d, flagged %d)\n",
			res.Synced, res.Deactivated, res.Flagged)
	}

	for _, l := range lays {
		var nama string
		if err := d.QueryRowContext(ctx, `SELECT nama FROM employees WHERE employee_id = ?`, l.nik).Scan(&nama); err != nil {
			fmt.Fprintf(stderr, "roleseed: layered %s: karyawan %s tidak ditemukan di tabel employees (sync dulu / periksa NIK)\n", l.role, l.nik)
			return 1
		}
		if err := admin.SetLayeredRole(ctx, d, systemDirector, l.nik, l.role, true); err != nil {
			fmt.Fprintf(stderr, "roleseed: set layered %s %s: %v\n", l.role, l.nik, err)
			return 1
		}
		fmt.Fprintf(stdout, "APPLY: layered %s -> %s (%s)\n", l.role, l.nik, nama)
	}

	fmt.Fprintln(stdout, "APPLY: OK")
	return 0
}

func countAction(plan []MappingPlan, action string) int {
	n := 0
	for _, p := range plan {
		if p.Action == action {
			n++
		}
	}
	return n
}

func toSet(list []string) map[string]bool {
	s := map[string]bool{}
	for _, v := range list {
		s[v] = true
	}
	return s
}

// sortedKeys is used by FilteredSource reporting.
func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
