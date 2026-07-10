package authz_test

import (
	"context"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/testdb"
)

func TestResolver_MappingPlusOverride(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	r := authz.NewSQLResolver()

	if _, err := conn.ExecContext(ctx,
		`INSERT INTO role_mappings (divisi, jabatan, role, created_at, created_by) VALUES (?, ?, ?, ?, ?)`,
		"Sales", "Account Executive", "staff", time.Now().UTC(), "SEED",
	); err != nil {
		t.Fatalf("seed mapping: %v", err)
	}

	id, err := r.Resolve(ctx, conn, "EMP-1", "Sales", "Account Executive")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if !id.Has(authz.RoleStaff) || len(id.Roles) != 1 {
		t.Fatalf("expected only [staff], got %v", id.Roles)
	}

	// Layer a Director override onto the same employee_id.
	if _, err := conn.ExecContext(ctx,
		`INSERT INTO role_overrides (employee_id, role, created_at, created_by) VALUES (?, ?, ?, ?)`,
		"EMP-1", "director", time.Now().UTC(), "SEED",
	); err != nil {
		t.Fatalf("seed override: %v", err)
	}

	id, err = r.Resolve(ctx, conn, "EMP-1", "Sales", "Account Executive")
	if err != nil {
		t.Fatalf("Resolve after override: %v", err)
	}
	if !id.Has(authz.RoleStaff) || !id.Has(authz.RoleDirector) {
		t.Fatalf("expected [staff director], got %v", id.Roles)
	}
}

func TestResolver_UnmappedCombo_DeniesByDefault(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	r := authz.NewSQLResolver()

	id, err := r.Resolve(ctx, conn, "EMP-404", "Sales", "Nonexistent Jabatan")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if id.Authenticated() {
		t.Fatalf("expected unmapped identity to be unauthenticated, got roles %v", id.Roles)
	}

	checker := authz.NewMatrixChecker()
	if err := checker.Check(id, authz.Request{Action: authz.ActionRead, Division: "Sales", OwnerEmployeeID: "EMP-404"}); err == nil {
		t.Fatal("expected unmapped identity to be denied read access")
	}
}

// TestResolver_MappingChangeTakesEffectWithoutRestart is the S0-08 AC:
// a mapping row change (e.g. promoting a jabatan from staff to lead_spv)
// must be reflected on the very next Resolve call, with no process restart
// or cache to invalidate -- Resolve is a DB read every time.
func TestResolver_MappingChangeTakesEffectWithoutRestart(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	r := authz.NewSQLResolver()

	res, err := conn.ExecContext(ctx,
		`INSERT INTO role_mappings (divisi, jabatan, role, created_at, created_by) VALUES (?, ?, ?, ?, ?)`,
		"Ads", "Ads Specialist", "staff", time.Now().UTC(), "SEED",
	)
	if err != nil {
		t.Fatalf("seed mapping: %v", err)
	}
	mappingID, _ := res.LastInsertId()

	before, err := r.Resolve(ctx, conn, "EMP-5", "Ads", "Ads Specialist")
	if err != nil {
		t.Fatalf("Resolve before: %v", err)
	}
	if !before.Has(authz.RoleStaff) || before.Has(authz.RoleLeadSPV) {
		t.Fatalf("expected [staff] before change, got %v", before.Roles)
	}

	if _, err := conn.ExecContext(ctx, `UPDATE role_mappings SET role = 'lead_spv' WHERE id = ?`, mappingID); err != nil {
		t.Fatalf("update mapping: %v", err)
	}

	after, err := r.Resolve(ctx, conn, "EMP-5", "Ads", "Ads Specialist")
	if err != nil {
		t.Fatalf("Resolve after: %v", err)
	}
	if !after.Has(authz.RoleLeadSPV) || after.Has(authz.RoleStaff) {
		t.Fatalf("expected [lead_spv] immediately after mapping change (no redeploy), got %v", after.Roles)
	}
}

func TestResolver_Unmapped(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	r := authz.NewSQLResolver()

	if _, err := conn.ExecContext(ctx,
		`INSERT INTO role_mappings (divisi, jabatan, role, created_at, created_by) VALUES (?, ?, ?, ?, ?)`,
		"Creative", "Video Editor", "staff", time.Now().UTC(), "SEED",
	); err != nil {
		t.Fatalf("seed mapping: %v", err)
	}

	combos := []authz.DivisiJabatan{
		{Divisi: "Creative", Jabatan: "Video Editor"}, // mapped
		{Divisi: "KOL", Jabatan: "KOL Specialist"},    // unmapped
	}
	unmapped, err := r.Unmapped(ctx, conn, combos)
	if err != nil {
		t.Fatalf("Unmapped: %v", err)
	}
	if len(unmapped) != 1 || unmapped[0].Divisi != "KOL" {
		t.Fatalf("expected only the KOL combo unmapped, got %v", unmapped)
	}
}
