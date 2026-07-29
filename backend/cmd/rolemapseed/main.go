// Command rolemapseed loads the two role-mapping-riil canonical seed files
// (supabase/seed/role_mappings_riil.csv — 23 real HRIS divisi/jabatan -> CDPS
// division/level mappings, and supabase/seed/layered_roles_riil.csv — OD/
// Director layered roles; see docs/DECISIONS.md entri 2026-07-17 "Role mapping riil batch-1") into role_mappings
// and employee_layered_roles via internal/admin — UpsertRoleMapping /
// SetLayeredRole only, so every write is validated and audited exactly as it
// would be through the admin UI.
//
// Alur pemakaian (WAJIB dry-run dulu — importer convention, pola mslseed):
//
//	rolemapseed [--role-csv path] [--layered-csv path]           # dry-run (default)
//	rolemapseed [--role-csv path] [--layered-csv path] --apply   # tulis ke DB
//
// Actor: a synthetic SYSTEM/Director actor (permission.Actor{EmployeeID:
// "SYSTEM", Role: {Director: true}}), byte-for-byte the same pattern as
// internal/seed.systemDirector. This is a deliberate bootstrap exception, NOT
// the general pattern for future admin writes: at go-live time there is no
// real Director employee row yet (Yohan & Nerissa are not in the 39-row HRIS
// roster — see docs/DECISIONS.md, Open O26). Once O26 resolves and their
// employee rows land, role-mapping/layered-role administration should move to
// a real Director actor via auth.ResolveActor, same as mslseed does for its
// --actor flag. Decision logged: docs/DECISIONS.md, entry dated 2026-07-17
// ("seeding via cmd/rolemapseed aktor SYSTEM, bootstrap, preseden seed.Run").
//
// Idempotent: admin.UpsertRoleMapping (ON DUPLICATE KEY on divisi+jabatan) and
// admin.SetLayeredRole (ON DUPLICATE KEY on employee_id+role) are plain
// upserts — running rolemapseed --apply repeatedly converges to the same
// state and writes no duplicate rows. Every row from both CSVs is validated
// (role-mapping level ∈ {staff,lead}; layered role ∈ {od,director}; layered
// employee_id must already exist in `employees`) before anything is written;
// apply aborts before any write if even one row is invalid.
//
// DB: env CDPS_DSN (schema must already be migrated; run `migrate up` first).
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/db"
)

// systemDirector is the synthetic bootstrap actor — see the package doc
// comment above and internal/seed.systemDirector for the identical pattern.
var systemDirector = permission.Actor{EmployeeID: "SYSTEM", Role: permission.Role{Director: true}}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("rolemapseed", flag.ContinueOnError)
	fs.SetOutput(stderr)
	roleCSVPath := fs.String("role-csv", FindRoleMappingsCSV(), "path CSV role mapping riil (default: supabase/seed/role_mappings_riil.csv)")
	layeredCSVPath := fs.String("layered-csv", FindLayeredRolesCSV(), "path CSV layered role riil (default: supabase/seed/layered_roles_riil.csv)")
	apply := fs.Bool("apply", false, "tulis ke DB (default: dry-run, WAJIB dry-run dulu)")
	fs.Usage = func() {
		fmt.Fprintln(stderr, "usage: rolemapseed [--role-csv path] [--layered-csv path] [--apply]")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return 2
	}

	rf, err := os.Open(*roleCSVPath)
	if err != nil {
		fmt.Fprintf(stderr, "rolemapseed: buka csv %s: %v\n", *roleCSVPath, err)
		return 1
	}
	roleRows, err := ParseRoleMappingCSV(rf)
	rf.Close()
	if err != nil {
		fmt.Fprintf(stderr, "rolemapseed: parse csv %s: %v\n", *roleCSVPath, err)
		return 1
	}

	lf, err := os.Open(*layeredCSVPath)
	if err != nil {
		fmt.Fprintf(stderr, "rolemapseed: buka csv %s: %v\n", *layeredCSVPath, err)
		return 1
	}
	layeredRows, err := ParseLayeredRoleCSV(lf)
	lf.Close()
	if err != nil {
		fmt.Fprintf(stderr, "rolemapseed: parse csv %s: %v\n", *layeredCSVPath, err)
		return 1
	}

	d, err := db.Open(db.DSN())
	if err != nil {
		fmt.Fprintf(stderr, "rolemapseed: open db: %v\n", err)
		return 1
	}
	defer d.Close()

	ctx := context.Background()

	if *apply {
		fmt.Fprintln(stdout, "rolemapseed: APPLY — menulis ke DB")
	} else {
		fmt.Fprintln(stdout, "rolemapseed: DRY-RUN (tidak menulis; pakai --apply untuk menulis)")
	}
	fmt.Fprintf(stdout, "rolemapseed: %d baris role mapping dari %s, %d baris layered role dari %s, actor=%s (bootstrap SYSTEM/Director)\n",
		len(roleRows), *roleCSVPath, len(layeredRows), *layeredCSVPath, systemDirector.EmployeeID)

	if _, err := Execute(ctx, d, systemDirector, roleRows, layeredRows, *apply, stdout); err != nil {
		fmt.Fprintf(stderr, "rolemapseed: %v\n", err)
		return 1
	}
	return 0
}
