package admin_test

import (
	"context"
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/admin"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

var salesLead = permission.Actor{EmployeeID: "L", Role: permission.Role{Division: "Sales", Level: "lead"}}
var salesStaff = permission.Actor{EmployeeID: "S", Role: permission.Role{Division: "Sales", Level: "staff"}}

func TestMasterService_PlainSalespersonDenied(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()
	_, err := admin.CreateService(ctx, d, salesStaff, admin.ServiceInput{
		Name: "Ads Management", StandardPrice: "10000000.00", CommissionRule: "5%", Active: true, EffectiveFrom: "2026-01-01",
	})
	if !errors.Is(err, admin.ErrMasterServiceDenied) {
		t.Fatalf("want ErrMasterServiceDenied, got %v", err)
	}
	if err != nil && err.Error() != admin.MasterServiceDeniedMessage {
		t.Fatalf("denied message=%q want %q", err.Error(), admin.MasterServiceDeniedMessage)
	}
}

func TestMasterService_VersioningAndHistoricalLookup(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()

	id, err := admin.CreateService(ctx, d, salesLead, admin.ServiceInput{
		Name: "Ads Management", StandardPrice: "10000000.00", CommissionRule: "5%", Active: true, EffectiveFrom: "2026-01-01",
	})
	if err != nil {
		t.Fatal(err)
	}
	// Price change => new version effective later.
	ver, err := admin.UpdateService(ctx, d, salesLead, id, admin.ServiceInput{
		Name: "Ads Management", StandardPrice: "12000000.00", CommissionRule: "5%", Active: true, EffectiveFrom: "2026-06-01",
	})
	if err != nil {
		t.Fatal(err)
	}
	if ver != 2 {
		t.Fatalf("new version=%d want 2", ver)
	}

	// Deal closing on 2026-03-01 must see the ORIGINAL (v1) price.
	v1, err := admin.EffectiveAt(ctx, d, id, "2026-03-01")
	if err != nil {
		t.Fatal(err)
	}
	if v1.VersionNo != 1 || v1.StandardPrice != "10000000.00" {
		t.Fatalf("historical lookup got v%d price=%s want v1 10000000.00", v1.VersionNo, v1.StandardPrice)
	}
	// A later date sees v2.
	v2, err := admin.EffectiveAt(ctx, d, id, "2026-07-01")
	if err != nil {
		t.Fatal(err)
	}
	if v2.VersionNo != 2 || v2.StandardPrice != "12000000.00" {
		t.Fatalf("current lookup got v%d price=%s want v2 12000000.00", v2.VersionNo, v2.StandardPrice)
	}

	versions, err := admin.ListVersions(ctx, d, id)
	if err != nil {
		t.Fatal(err)
	}
	if len(versions) != 2 {
		t.Fatalf("want 2 versions, got %d", len(versions))
	}
}

func TestMasterService_IncompleteRejected(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()
	_, err := admin.CreateService(ctx, d, salesLead, admin.ServiceInput{Name: "", StandardPrice: "1", CommissionRule: "x", EffectiveFrom: "2026-01-01"})
	if !errors.Is(err, admin.ErrIncomplete) {
		t.Fatalf("want ErrIncomplete, got %v", err)
	}
}
