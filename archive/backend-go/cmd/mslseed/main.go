// Command mslseed loads backend/seed/msl_kalkulator.csv (the MSL v2
// calculator canonical seed, docs/handoff/MSL_KALKULATOR_VALIDASI.md) into
// the Master Service List via internal/admin — CreateService/UpdateService
// only, so every write is validated, audited, and versioned exactly as it
// would be through the admin UI.
//
// Alur pemakaian (WAJIB dry-run dulu — importer convention):
//
//	mslseed --actor <employee_id> [--csv path]           # dry-run (default)
//	mslseed --actor <employee_id> [--csv path] --apply   # tulis ke DB
//
// --actor must resolve (auth.ResolveActor) to an employee who passes
// admin.CanEditMasterServices — Sales Head/SPV Sales (division=Sales,
// level=lead) or a layered Director. A plain salesperson is denied with the
// exact BI message from admin.MasterServiceDeniedMessage.
//
// Idempotent by service NAME: matched against the Master Service List
// version effective at each row's effective_from. None found -> create.
// Found but any seeded field differs -> new version. Identical -> skip.
// Every row is validated before anything is written; apply aborts before any
// write if even one row is invalid.
//
// DB: env CDPS_DSN (schema must already be migrated; run `migrate up` first).
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/meagrup/agencyapp/backend/internal/auth"
	"github.com/meagrup/agencyapp/backend/internal/db"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("mslseed", flag.ContinueOnError)
	fs.SetOutput(stderr)
	actorID := fs.String("actor", "", "employee_id pelaksana (wajib: Sales Head/SPV Sales atau Director — admin.CanEditMasterServices)")
	csvPath := fs.String("csv", FindSeedCSV(), "path CSV MSL kalkulator (default: backend/seed/msl_kalkulator.csv)")
	apply := fs.Bool("apply", false, "tulis ke DB (default: dry-run, WAJIB dry-run dulu)")
	fs.Usage = func() {
		fmt.Fprintln(stderr, "usage: mslseed --actor <employee_id> [--csv path] [--apply]")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if *actorID == "" {
		fmt.Fprintln(stderr, "mslseed: --actor wajib diisi")
		fs.Usage()
		return 2
	}

	f, err := os.Open(*csvPath)
	if err != nil {
		fmt.Fprintf(stderr, "mslseed: buka csv %s: %v\n", *csvPath, err)
		return 1
	}
	rows, err := ParseCSV(f)
	f.Close()
	if err != nil {
		fmt.Fprintf(stderr, "mslseed: parse csv %s: %v\n", *csvPath, err)
		return 1
	}

	d, err := db.Open(db.DSN())
	if err != nil {
		fmt.Fprintf(stderr, "mslseed: open db: %v\n", err)
		return 1
	}
	defer d.Close()

	ctx := context.Background()
	actor, err := auth.ResolveActor(ctx, d, *actorID)
	if err != nil {
		fmt.Fprintf(stderr, "mslseed: resolve actor %s: %v\n", *actorID, err)
		return 1
	}

	if *apply {
		fmt.Fprintln(stdout, "mslseed: APPLY — menulis ke DB")
	} else {
		fmt.Fprintln(stdout, "mslseed: DRY-RUN (tidak menulis; pakai --apply untuk menulis)")
	}
	fmt.Fprintf(stdout, "mslseed: %d baris dari %s, actor=%s (%s)\n", len(rows), *csvPath, actor.EmployeeID, actor.Nama)

	if _, err := Execute(ctx, d, actor, rows, *apply, stdout); err != nil {
		fmt.Fprintf(stderr, "mslseed: %v\n", err)
		return 1
	}
	return 0
}
