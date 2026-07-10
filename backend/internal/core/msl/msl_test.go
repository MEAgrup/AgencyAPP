package msl_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/msl"
	"github.com/meagrup/agencyapp/backend/internal/core/testdb"
)

func mustTime(s string) time.Time {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		panic(err)
	}
	return t
}

func TestStore_CreateEntry_WriteGate(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	fake := &fakeAuditLogger{}
	store := msl.NewStore(authz.NewMatrixChecker(), fake)

	in := msl.CreateInput{
		Name:           "Instagram Ads Management",
		StandardPrice:  "5000000.00",
		CommissionRule: `{"percent": 5}`,
		EffectiveFrom:  mustTime("2026-01-01"),
	}

	// deny: plain Sales staff (not Sales Head/SPV)
	staff := authz.Identity{EmployeeID: "EMP-1", Divisi: msl.DivisiSales, Roles: []authz.Role{authz.RoleStaff}}
	if _, err := store.CreateEntry(ctx, conn, staff, in); err == nil {
		t.Fatal("expected plain Sales staff to be denied write")
	} else if !errors.Is(err, authz.ErrDenied) {
		t.Fatalf("expected ErrDenied, got %v", err)
	}

	// deny: lead_spv of ANOTHER division
	otherLead := authz.Identity{EmployeeID: "EMP-2", Divisi: "Ads", Roles: []authz.Role{authz.RoleLeadSPV}}
	if _, err := store.CreateEntry(ctx, conn, otherLead, in); err == nil {
		t.Fatal("expected lead_spv of another division to be denied write")
	} else if !errors.Is(err, authz.ErrDenied) {
		t.Fatalf("expected ErrDenied, got %v", err)
	}

	// allow: Sales lead_spv (Sales Head/SPV)
	salesLead := authz.Identity{EmployeeID: "EMP-3", Divisi: msl.DivisiSales, Roles: []authz.Role{authz.RoleLeadSPV}}
	entry, err := store.CreateEntry(ctx, conn, salesLead, in)
	if err != nil {
		t.Fatalf("expected Sales lead_spv to succeed, got %v", err)
	}
	if entry.Name != in.Name || !entry.Active {
		t.Fatalf("unexpected entry: %+v", entry)
	}

	// allow: Director too (different name -- service_entries.name is unique)
	director := authz.Identity{EmployeeID: "EMP-4", Divisi: "Sales", Roles: []authz.Role{authz.RoleDirector}}
	directorIn := in
	directorIn.Name = "Instagram Ads Management (Director Fixture)"
	if _, err := store.CreateEntry(ctx, conn, director, directorIn); err != nil {
		t.Fatalf("expected Director to succeed, got %v", err)
	}

	entries := fake.all()
	if len(entries) != 2 {
		t.Fatalf("expected 2 audited creates (staff/other-lead denials never reach audit), got %d: %+v", len(entries), entries)
	}
	for _, e := range entries {
		if e.Action != "create" || e.EntityType != "service_entry" {
			t.Fatalf("unexpected audit entry: %+v", e)
		}
	}
}

func TestStore_UpdateEntry_VersionsNeverMutateInPlace(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	fake := &fakeAuditLogger{}
	store := msl.NewStore(authz.NewMatrixChecker(), fake)
	salesLead := authz.Identity{EmployeeID: "EMP-3", Divisi: msl.DivisiSales, Roles: []authz.Role{authz.RoleLeadSPV}}

	entry, err := store.CreateEntry(ctx, conn, salesLead, msl.CreateInput{
		Name: "TikTok Ads Setup", StandardPrice: "3000000.00", CommissionRule: `{"percent": 4}`,
		EffectiveFrom: mustTime("2026-01-01"),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	newPrice := "3500000.00"
	v2, err := store.UpdateEntry(ctx, conn, salesLead, entry.ID, msl.UpdateInput{
		StandardPrice: &newPrice, EffectiveFrom: mustTime("2026-03-01"),
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if v2.Version != 2 || v2.StandardPrice != newPrice {
		t.Fatalf("expected version 2 with new price, got %+v", v2)
	}
	// Name/commission carried over unchanged from version 1.
	if v2.Name != "TikTok Ads Setup" || v2.CommissionRule != `{"percent": 4}` {
		t.Fatalf("expected unset fields to carry over, got %+v", v2)
	}

	// Version 1 must remain intact (money-critical, house convention #3).
	v1, err := msl.EffectiveAt(ctx, conn, entry.ID, mustTime("2026-01-01"))
	if err != nil {
		t.Fatalf("EffectiveAt(v1 date): %v", err)
	}
	if v1.Version != 1 || v1.StandardPrice != "3000000.00" {
		t.Fatalf("expected version 1 untouched with original price, got %+v", v1)
	}

	// deny: cross-division lead_spv cannot update either
	otherLead := authz.Identity{EmployeeID: "EMP-9", Divisi: "Ads", Roles: []authz.Role{authz.RoleLeadSPV}}
	if _, err := store.UpdateEntry(ctx, conn, otherLead, entry.ID, msl.UpdateInput{StandardPrice: &newPrice, EffectiveFrom: mustTime("2026-04-01")}); err == nil {
		t.Fatal("expected cross-division lead_spv update to be denied")
	}

	entries := fake.all()
	if len(entries) != 2 {
		t.Fatalf("expected create+update audited, got %d: %+v", len(entries), entries)
	}
	if entries[1].Action != "update" || entries[1].Before == nil || entries[1].After == nil {
		t.Fatalf("expected update entry with before/after, got %+v", entries[1])
	}
}

// TestEffectiveAt_DealDateLookup is the money-critical S0-09 AC: a deal
// closing on a given date must lock onto the version in effect on that
// date, including the exact boundary at effective_from, and a date before
// the first version must be "not found", never an error masquerading as a
// zero value.
func TestEffectiveAt_DealDateLookup(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	fake := &fakeAuditLogger{}
	store := msl.NewStore(authz.NewMatrixChecker(), fake)
	salesLead := authz.Identity{EmployeeID: "EMP-3", Divisi: msl.DivisiSales, Roles: []authz.Role{authz.RoleLeadSPV}}

	entry, err := store.CreateEntry(ctx, conn, salesLead, msl.CreateInput{
		Name: "KOL Sourcing Package", StandardPrice: "10000000.00", CommissionRule: `{"percent": 6}`,
		EffectiveFrom: mustTime("2026-02-01"),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	newPrice := "12000000.00"
	if _, err := store.UpdateEntry(ctx, conn, salesLead, entry.ID, msl.UpdateInput{
		StandardPrice: &newPrice, EffectiveFrom: mustTime("2026-06-01"),
	}); err != nil {
		t.Fatalf("update: %v", err)
	}

	// Before the first version entirely: not found.
	if _, err := msl.EffectiveAt(ctx, conn, entry.ID, mustTime("2026-01-01")); !errors.Is(err, msl.ErrNotFound) {
		t.Fatalf("expected ErrNotFound before first version, got %v", err)
	}

	// A deal closing between v1 and v2's effective dates locks onto v1.
	historical, err := msl.EffectiveAt(ctx, conn, entry.ID, mustTime("2026-03-15"))
	if err != nil {
		t.Fatalf("EffectiveAt historical: %v", err)
	}
	if historical.Version != 1 || historical.StandardPrice != "10000000.00" {
		t.Fatalf("expected historical deal to lock onto v1 at 10000000.00, got %+v", historical)
	}

	// Exactly at v2's effective_from boundary: v2 applies (inclusive).
	atBoundary, err := msl.EffectiveAt(ctx, conn, entry.ID, mustTime("2026-06-01"))
	if err != nil {
		t.Fatalf("EffectiveAt at boundary: %v", err)
	}
	if atBoundary.Version != 2 || atBoundary.StandardPrice != newPrice {
		t.Fatalf("expected v2 to apply exactly at its effective_from, got %+v", atBoundary)
	}

	// After v2: still v2 (latest applicable).
	after, err := msl.EffectiveAt(ctx, conn, entry.ID, mustTime("2026-12-31"))
	if err != nil {
		t.Fatalf("EffectiveAt after: %v", err)
	}
	if after.Version != 2 {
		t.Fatalf("expected v2 to remain the latest applicable version, got %+v", after)
	}
}

func TestListAndGetEntry_ReadOpenToAuthenticatedRoles(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	fake := &fakeAuditLogger{}
	store := msl.NewStore(authz.NewMatrixChecker(), fake)
	salesLead := authz.Identity{EmployeeID: "EMP-3", Divisi: msl.DivisiSales, Roles: []authz.Role{authz.RoleLeadSPV}}

	entry, err := store.CreateEntry(ctx, conn, salesLead, msl.CreateInput{
		Name: "Live Shopping Session", StandardPrice: "2000000.00", CommissionRule: `{"percent": 3}`,
		EffectiveFrom: mustTime("2026-01-01"),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Any authenticated internal role can read, even outside Sales.
	adsStaff := authz.Identity{EmployeeID: "EMP-50", Divisi: "Ads", Roles: []authz.Role{authz.RoleStaff}}
	got, err := msl.GetEntry(ctx, conn, adsStaff, entry.ID)
	if err != nil {
		t.Fatalf("expected read access for any authenticated role, got %v", err)
	}
	if got.Name != entry.Name {
		t.Fatalf("unexpected entry: %+v", got)
	}

	list, err := msl.ListEntries(ctx, conn, adsStaff)
	if err != nil {
		t.Fatalf("ListEntries: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(list))
	}

	// Unmapped/unauthenticated identity denied even for reads, with the same
	// typed authz denial the write path returns.
	unmapped := authz.Identity{EmployeeID: "EMP-404"}
	if _, err := msl.GetEntry(ctx, conn, unmapped, entry.ID); err == nil {
		t.Fatal("expected unmapped identity to be denied read access")
	} else if !errors.Is(err, authz.ErrDenied) {
		t.Fatalf("expected authz.ErrDenied on read, got %v", err)
	}
	if _, err := msl.ListEntries(ctx, conn, unmapped); !errors.Is(err, authz.ErrDenied) {
		t.Fatalf("expected authz.ErrDenied on list, got %v", err)
	}
}
