package importer

// sales_resolve_db_test.go: DB-backed test for LoadEmployeeNameIndex, following
// the shared testutil pattern (testutil.DB skips cleanly when no local test DB
// is reachable). The pure resolution/precedence/report logic is covered without
// a DB in sales_resolve_test.go / parse_test.go.

import (
	"context"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

func TestLoadEmployeeNameIndexFromDB(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	testutil.InsertEmployee(t, d, "EMP-BUDI", "Budi Santoso", "budi@mea.co.id", "Sales", "Sales Executive", true)
	testutil.InsertEmployee(t, d, "EMP-DEWI", "Dewi Lestari", "dewi@mea.co.id", "Sales", "Sales Executive", true)
	// An inactive employee must still be resolvable — historical lead
	// attribution is a one-time backfill, not a live access grant.
	testutil.InsertEmployee(t, d, "EMP-LAMA", "Rudi Purnomo", "rudi@mea.co.id", "Sales", "Sales Executive", false)

	idx, err := LoadEmployeeNameIndex(context.Background(), d)
	if err != nil {
		t.Fatalf("LoadEmployeeNameIndex: %v", err)
	}
	if id, ok := idx.Resolve("budi   SANTOSO"); !ok || id != "EMP-BUDI" {
		t.Fatalf("Resolve(budi santoso, case/space-insensitive): id=%q ok=%v", id, ok)
	}
	if id, ok := idx.Resolve("Dewi Lestari"); !ok || id != "EMP-DEWI" {
		t.Fatalf("Resolve(Dewi Lestari): id=%q ok=%v", id, ok)
	}
	if id, ok := idx.Resolve("Rudi Purnomo"); !ok || id != "EMP-LAMA" {
		t.Fatalf("Resolve must include inactive employees for historical attribution: id=%q ok=%v", id, ok)
	}
	if _, ok := idx.Resolve("Tidak Ada"); ok {
		t.Fatal("unknown name must not resolve")
	}
}
