package hris_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/auth"
	"github.com/meagrup/agencyapp/backend/internal/hris"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

func writeCSV(t *testing.T, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "employees.csv")
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

const header = "employee_id,nama,email,divisi,jabatan,status_aktif,password\n"

func TestSync_IdempotentAndSwapCSVtoHTTP(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()

	csv := writeCSV(t, header+
		"EMP-1,Budi,budi@mea.co.id,Sales,Sales Executive,true,rahasia123\n"+
		"EMP-2,Dewi,dewi@mea.co.id,Sales,Sales Head,true,rahasia123\n")

	csvSrc := hris.NewCSVSource(csv)

	// First sync.
	res, err := hris.Sync(ctx, d, csvSrc, "SYSTEM", true)
	if err != nil {
		t.Fatal(err)
	}
	if res.Synced != 2 {
		t.Fatalf("synced=%d want 2", res.Synced)
	}
	// Idempotent: second run same count, no duplicates.
	if _, err := hris.Sync(ctx, d, csvSrc, "SYSTEM", true); err != nil {
		t.Fatal(err)
	}
	var count int
	d.QueryRow(`SELECT COUNT(*) FROM employees`).Scan(&count)
	if count != 2 {
		t.Fatalf("employees=%d want 2 (idempotent)", count)
	}

	// HTTP source returning the SAME employees through the SAME consumer.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"data": []hris.Employee{
				{EmployeeID: "EMP-1", Nama: "Budi", Email: "budi@mea.co.id", Divisi: "Sales", Jabatan: "Sales Executive", StatusAktif: true},
				{EmployeeID: "EMP-2", Nama: "Dewi", Email: "dewi@mea.co.id", Divisi: "Sales", Jabatan: "Sales Head", StatusAktif: true},
			},
			"page": 1, "page_size": 100, "total": 2,
		})
	}))
	defer srv.Close()
	var httpSrc hris.EmployeeSource = hris.NewHTTPSource(srv.URL, "svc-token")
	if _, err := hris.Sync(ctx, d, httpSrc, "SYSTEM", true); err != nil {
		t.Fatalf("http sync via same consumer failed: %v", err)
	}
	d.QueryRow(`SELECT COUNT(*) FROM employees`).Scan(&count)
	if count != 2 {
		t.Fatalf("after http sync employees=%d want 2", count)
	}
}

func TestSync_DeactivationRevokesSessionAndBlocksAccess(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()

	active := writeCSV(t, header+"EMP-1,Budi,budi@mea.co.id,Sales,Sales Executive,true,rahasia123\n")
	if _, err := hris.Sync(ctx, d, hris.NewCSVSource(active), "SYSTEM", true); err != nil {
		t.Fatal(err)
	}
	tok, err := auth.CreateSession(ctx, d, "EMP-1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := auth.ResolveSession(ctx, d, tok); err != nil {
		t.Fatalf("session should be valid before deactivation: %v", err)
	}

	// Deactivate in HRIS => next sync revokes session + blocks access.
	inactive := writeCSV(t, header+"EMP-1,Budi,budi@mea.co.id,Sales,Sales Executive,false,rahasia123\n")
	res, err := hris.Sync(ctx, d, hris.NewCSVSource(inactive), "SYSTEM", true)
	if err != nil {
		t.Fatal(err)
	}
	if res.Deactivated != 1 {
		t.Fatalf("deactivated=%d want 1", res.Deactivated)
	}
	if _, err := auth.ResolveSession(ctx, d, tok); err == nil {
		t.Fatal("session should be revoked after deactivation")
	}
}

func TestSync_AbsentEmployeeFlaggedNotDeleted(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()

	two := writeCSV(t, header+
		"EMP-1,Budi,budi@mea.co.id,Sales,Sales Executive,true,rahasia123\n"+
		"EMP-2,Dewi,dewi@mea.co.id,Sales,Sales Head,true,rahasia123\n")
	if _, err := hris.Sync(ctx, d, hris.NewCSVSource(two), "SYSTEM", true); err != nil {
		t.Fatal(err)
	}
	one := writeCSV(t, header+"EMP-1,Budi,budi@mea.co.id,Sales,Sales Executive,true,rahasia123\n")
	res, err := hris.Sync(ctx, d, hris.NewCSVSource(one), "SYSTEM", true)
	if err != nil {
		t.Fatal(err)
	}
	if res.Flagged != 1 {
		t.Fatalf("flagged=%d want 1", res.Flagged)
	}
	var flagged bool
	d.QueryRow(`SELECT flagged_for_review FROM employees WHERE employee_id='EMP-2'`).Scan(&flagged)
	if !flagged {
		t.Fatal("absent employee should be flagged, not deleted")
	}
	var count int
	d.QueryRow(`SELECT COUNT(*) FROM employees`).Scan(&count)
	if count != 2 {
		t.Fatalf("employees=%d want 2 (not deleted)", count)
	}
}
