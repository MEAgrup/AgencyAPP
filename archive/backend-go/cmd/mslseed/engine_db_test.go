package main

// DB-backed test: seeds 2-3 rows through Execute via a Director actor from
// the seed fixtures (backend/internal/seed), asserting idempotency (second
// run all-skip) and a version bump on changed price.

import (
	"context"
	"strings"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/auth"
	"github.com/meagrup/agencyapp/backend/internal/seed"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

const miniSeedCSV = validHeader +
	`gmv-max,GMV Max,Ads Spending,,,0,passthrough,1,Monthly,,0% of standard price,2026-07-16,true,"Budget iklan minimum per campaign.",14
foto-katalog-4-output,Product Catalog Photos – 4 Outputs,Asset Produk,per produk,1,150000,batch_ceiling,0,One-time,,0% of standard price,2026-07-16,true,"Foto katalog per produk.",17
nano-kol,Nano KOL (1K-10K followers),KOL & Influencer,per KOL,10,5000000,min_floor,1,Campaign,,0% of standard price,2026-07-16,true,"Rate card KOL.",34
`

func TestExecute_DBBackedSeedFlow(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()

	// Populate employees/role-mappings/layered Director roles from the real
	// seed fixtures (backend/internal/seed/seed.go: directors = EMP-0008..10).
	if err := seed.Run(ctx, d, ""); err != nil {
		t.Fatalf("seed.Run: %v", err)
	}
	actor, err := auth.ResolveActor(ctx, d, "EMP-0008")
	if err != nil {
		t.Fatalf("resolve actor: %v", err)
	}
	if !actor.Role.Director {
		t.Fatalf("EMP-0008 expected Director, got role=%+v", actor.Role)
	}

	rows, err := ParseCSV(strings.NewReader(miniSeedCSV))
	if err != nil {
		t.Fatalf("parse mini seed csv: %v", err)
	}
	if len(rows) != 3 {
		t.Fatalf("got %d rows, want 3", len(rows))
	}

	// Run 1 (apply): all 3 created.
	rep, err := Execute(ctx, d, actor, rows, true, discard(t))
	if err != nil {
		t.Fatalf("run 1: %v", err)
	}
	if rep.Created != 3 || rep.NewVersion != 0 || rep.Skipped != 0 || rep.Errors != 0 {
		t.Fatalf("run 1 report=%+v want Created=3", rep)
	}
	// seed.Run already planted 3 unrelated master services (Ads/KOL
	// Management, Live Stream Package) — our 3 rows add 3 more.
	var svcCount int
	if err := d.QueryRow(`SELECT COUNT(*) FROM master_services`).Scan(&svcCount); err != nil {
		t.Fatal(err)
	}
	if svcCount != 6 {
		t.Fatalf("master_services=%d want 6 (3 from seed.Run + 3 from mslseed)", svcCount)
	}

	// Run 2 (apply again, unchanged CSV): idempotent — everything skips.
	rep2, err := Execute(ctx, d, actor, rows, true, discard(t))
	if err != nil {
		t.Fatalf("run 2: %v", err)
	}
	if rep2.Created != 0 || rep2.NewVersion != 0 || rep2.Skipped != 3 || rep2.Errors != 0 {
		t.Fatalf("run 2 (idempotent) report=%+v want Skipped=3", rep2)
	}
	if err := d.QueryRow(`SELECT COUNT(*) FROM master_services`).Scan(&svcCount); err != nil {
		t.Fatal(err)
	}
	if svcCount != 6 {
		t.Fatalf("master_services=%d want 6 (no duplicates)", svcCount)
	}

	// Run 3 (apply, one row's price changed): that row bumps to a new
	// version, the other two still skip.
	changed := strings.Replace(miniSeedCSV, "per produk,1,150000,batch_ceiling", "per produk,1,175000,batch_ceiling", 1)
	rows3, err := ParseCSV(strings.NewReader(changed))
	if err != nil {
		t.Fatalf("parse changed csv: %v", err)
	}
	rep3, err := Execute(ctx, d, actor, rows3, true, discard(t))
	if err != nil {
		t.Fatalf("run 3: %v", err)
	}
	if rep3.Created != 0 || rep3.NewVersion != 1 || rep3.Skipped != 2 || rep3.Errors != 0 {
		t.Fatalf("run 3 (price change) report=%+v want NewVersion=1 Skipped=2", rep3)
	}
	var versionCount int
	if err := d.QueryRow(
		`SELECT COUNT(*) FROM master_service_versions v
		   JOIN master_services s ON s.id = v.service_id
		  WHERE v.name = 'Product Catalog Photos – 4 Outputs'`).Scan(&versionCount); err != nil {
		t.Fatal(err)
	}
	if versionCount != 2 {
		t.Fatalf("versions for changed service=%d want 2", versionCount)
	}
}

func TestExecute_DryRunDoesNotWrite(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()
	if err := seed.Run(ctx, d, ""); err != nil {
		t.Fatalf("seed.Run: %v", err)
	}
	actor, err := auth.ResolveActor(ctx, d, "EMP-0008")
	if err != nil {
		t.Fatalf("resolve actor: %v", err)
	}
	rows, err := ParseCSV(strings.NewReader(miniSeedCSV))
	if err != nil {
		t.Fatalf("parse mini seed csv: %v", err)
	}

	var before int
	if err := d.QueryRow(`SELECT COUNT(*) FROM master_services`).Scan(&before); err != nil {
		t.Fatal(err)
	}

	rep, err := Execute(ctx, d, actor, rows, false, discard(t))
	if err != nil {
		t.Fatalf("dry-run: %v", err)
	}
	if rep.Created != 3 {
		t.Fatalf("dry-run report=%+v want Created=3 (planned, not written)", rep)
	}

	var after int
	if err := d.QueryRow(`SELECT COUNT(*) FROM master_services`).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if after != before {
		t.Fatalf("dry-run must not write: before=%d after=%d", before, after)
	}
}

func TestExecute_NonLeadSalesStaffDenied(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()
	if err := seed.Run(ctx, d, ""); err != nil {
		t.Fatalf("seed.Run: %v", err)
	}
	// EMP-0001 is Sales Executive (staff level) per testdata/employees.csv.
	actor, err := auth.ResolveActor(ctx, d, "EMP-0001")
	if err != nil {
		t.Fatalf("resolve actor: %v", err)
	}
	rows, err := ParseCSV(strings.NewReader(miniSeedCSV))
	if err != nil {
		t.Fatalf("parse mini seed csv: %v", err)
	}
	_, err = Execute(ctx, d, actor, rows, false, discard(t))
	if err == nil {
		t.Fatal("expected permission denial for plain Sales staff")
	}
}

// discard returns an io.Writer that logs through t (kept out of stdout during
// `go test`, visible with -v).
func discard(t *testing.T) *testWriter { return &testWriter{t: t} }

type testWriter struct{ t *testing.T }

func (w *testWriter) Write(p []byte) (int, error) {
	w.t.Logf("%s", p)
	return len(p), nil
}
