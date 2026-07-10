package authz_test

import (
	"context"
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/testdb"
)

func TestMappingAdmin_CreateMapping_DirectorOnly(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	fake := &fakeAuditLogger{}
	admin := authz.NewMappingAdmin(authz.NewMatrixChecker(), fake)

	staff := authz.Identity{EmployeeID: "EMP-1", Divisi: "Sales", Roles: []authz.Role{authz.RoleStaff}}
	if _, err := admin.CreateMapping(ctx, conn, staff, "Sales", "Salesperson", authz.RoleStaff); err == nil {
		t.Fatal("expected staff to be denied admin write")
	} else if !errors.Is(err, authz.ErrDenied) {
		t.Fatalf("expected ErrDenied, got %v", err)
	}

	od := authz.Identity{EmployeeID: "EMP-2", Divisi: "Sales", Roles: []authz.Role{authz.RoleOD}}
	if _, err := admin.CreateMapping(ctx, conn, od, "Sales", "Salesperson", authz.RoleStaff); err == nil {
		t.Fatal("expected OD (read-only) to be denied admin write")
	}

	director := authz.Identity{EmployeeID: "EMP-3", Divisi: "Sales", Roles: []authz.Role{authz.RoleDirector}}
	m, err := admin.CreateMapping(ctx, conn, director, "Sales", "Salesperson", authz.RoleStaff)
	if err != nil {
		t.Fatalf("expected director to succeed, got %v", err)
	}
	if m.Divisi != "Sales" || m.Jabatan != "Salesperson" || m.Role != authz.RoleStaff {
		t.Fatalf("unexpected mapping: %+v", m)
	}

	entries := fake.all()
	if len(entries) != 1 || entries[0].Action != "create" || entries[0].EntityType != "role_mapping" || entries[0].Actor != "EMP-3" {
		t.Fatalf("expected one audited create by EMP-3, got %+v", entries)
	}

	// Resolving now reflects the new mapping without any redeploy step.
	resolved, err := authz.NewSQLResolver().Resolve(ctx, conn, "EMP-99", "Sales", "Salesperson")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if !resolved.Has(authz.RoleStaff) {
		t.Fatalf("expected new mapping to resolve to staff, got %v", resolved.Roles)
	}
}

func TestMappingAdmin_UpdateAndDeleteMapping_Audited(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	fake := &fakeAuditLogger{}
	admin := authz.NewMappingAdmin(authz.NewMatrixChecker(), fake)
	director := authz.Identity{EmployeeID: "EMP-3", Divisi: "Sales", Roles: []authz.Role{authz.RoleDirector}}

	m, err := admin.CreateMapping(ctx, conn, director, "Ads", "Ads Lead", authz.RoleStaff)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	updated, err := admin.UpdateMapping(ctx, conn, director, m.ID, authz.RoleLeadSPV)
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Role != authz.RoleLeadSPV {
		t.Fatalf("expected role updated to lead_spv, got %v", updated.Role)
	}

	if err := admin.DeleteMapping(ctx, conn, director, m.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}

	entries := fake.all()
	if len(entries) != 3 {
		t.Fatalf("expected create+update+delete audited, got %d entries: %+v", len(entries), entries)
	}
	if entries[0].Action != "create" || entries[1].Action != "update" || entries[2].Action != "delete" {
		t.Fatalf("unexpected audit action sequence: %v %v %v", entries[0].Action, entries[1].Action, entries[2].Action)
	}
	if entries[1].Before == nil || entries[1].After == nil {
		t.Fatal("expected update entry to carry before/after JSON")
	}

	// Deleted mapping no longer resolves to any base role.
	id, err := authz.NewSQLResolver().Resolve(ctx, conn, "EMP-100", "Ads", "Ads Lead")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if id.Authenticated() {
		t.Fatalf("expected deleted mapping to leave employee unmapped, got %v", id.Roles)
	}
}

func TestMappingAdmin_Overrides_DirectorOnly_Audited(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	fake := &fakeAuditLogger{}
	admin := authz.NewMappingAdmin(authz.NewMatrixChecker(), fake)

	leadSPV := authz.Identity{EmployeeID: "EMP-9", Divisi: "Sales", Roles: []authz.Role{authz.RoleLeadSPV}}
	if _, err := admin.CreateOverride(ctx, conn, leadSPV, "EMP-1", authz.RoleOD); err == nil {
		t.Fatal("expected lead_spv to be denied override management")
	}

	director := authz.Identity{EmployeeID: "EMP-3", Divisi: "Sales", Roles: []authz.Role{authz.RoleDirector}}
	o, err := admin.CreateOverride(ctx, conn, director, "EMP-1", authz.RoleOD)
	if err != nil {
		t.Fatalf("create override: %v", err)
	}

	resolved, err := authz.NewSQLResolver().Resolve(ctx, conn, "EMP-1", "Sales", "Anything")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if !resolved.Has(authz.RoleOD) {
		t.Fatalf("expected EMP-1 to carry OD override, got %v", resolved.Roles)
	}

	if err := admin.DeleteOverride(ctx, conn, director, o.ID); err != nil {
		t.Fatalf("delete override: %v", err)
	}

	entries := fake.all()
	if len(entries) != 2 || entries[0].EntityType != "role_override" || entries[1].EntityType != "role_override" {
		t.Fatalf("expected two audited role_override changes, got %+v", entries)
	}
}
