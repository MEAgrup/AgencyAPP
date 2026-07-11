package admin_test

import (
	"context"
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/admin"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

var director = permission.Actor{EmployeeID: "D", Role: permission.Role{Director: true}}

func TestSetLayeredRole_ViewerAccepted(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()
	testutil.InsertEmployee(t, d, "EMP-0100", "Nerissa", "nerissa@mea.co.id", "Data & BI", "Analyst", true)

	if err := admin.SetLayeredRole(ctx, d, director, "EMP-0100", "viewer", true); err != nil {
		t.Fatalf("SetLayeredRole viewer: %v", err)
	}

	roles, err := admin.ListLayeredRoles(ctx, d)
	if err != nil {
		t.Fatal(err)
	}
	var found *admin.LayeredRole
	for i := range roles {
		if roles[i].EmployeeID == "EMP-0100" && roles[i].Role == "viewer" {
			found = &roles[i]
		}
	}
	if found == nil || !found.Enabled {
		t.Fatalf("expected enabled viewer layered role for EMP-0100, got %v", roles)
	}
}

func TestSetLayeredRole_BadRoleRejected(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()
	testutil.InsertEmployee(t, d, "EMP-0101", "Someone", "someone@mea.co.id", "Data & BI", "Analyst", true)

	_, err := admin.ListLayeredRoles(ctx, d) // sanity: table reachable before the bad call
	if err != nil {
		t.Fatal(err)
	}
	err = admin.SetLayeredRole(ctx, d, director, "EMP-0101", "okr-manager", true)
	if !errors.Is(err, admin.ErrBadRole) {
		t.Fatalf("want ErrBadRole, got %v", err)
	}
	if err.Error() != "role harus 'od', 'director', atau 'viewer'" {
		t.Fatalf("ErrBadRole message=%q", err.Error())
	}
}
