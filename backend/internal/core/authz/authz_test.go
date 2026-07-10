package authz_test

import (
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/authz"
)

// Per PERMISSIONS.md "Test-suite note": for a representative resource
// (a Sales-division, employee-owned record) generate: allow the named role,
// deny the role below it, deny cross-division same-level, allow-read-only
// for OD, allow for Director.

func mustDeny(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		t.Fatal("expected denial, got nil error")
	}
	if !errors.Is(err, authz.ErrDenied) {
		t.Fatalf("expected errors.Is(err, ErrDenied), got %v", err)
	}
	var de *authz.DeniedError
	if !errors.As(err, &de) {
		t.Fatalf("expected *authz.DeniedError, got %T: %v", err, err)
	}
}

func mustAllow(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("expected allow, got %v", err)
	}
}

func TestCheck_OwnData(t *testing.T) {
	checker := authz.NewMatrixChecker()
	staffSales := authz.Identity{EmployeeID: "EMP-1", Divisi: "Sales", Roles: []authz.Role{authz.RoleStaff}}
	req := authz.Request{Action: authz.ActionWrite, Division: "Sales", OwnerEmployeeID: "EMP-1"}

	// allow: staff writing own record
	mustAllow(t, checker.Check(staffSales, req))

	// deny: staff writing someone else's record (own-data-only)
	otherOwned := req
	otherOwned.OwnerEmployeeID = "EMP-2"
	mustDeny(t, checker.Check(staffSales, otherOwned))
}

func TestCheck_LeadSPVDivisionWide(t *testing.T) {
	checker := authz.NewMatrixChecker()
	leadSales := authz.Identity{EmployeeID: "EMP-9", Divisi: "Sales", Roles: []authz.Role{authz.RoleLeadSPV}}

	// allow: lead_spv writes anywhere in own division, regardless of owner
	mustAllow(t, checker.Check(leadSales, authz.Request{Action: authz.ActionWrite, Division: "Sales", OwnerEmployeeID: "EMP-1"}))
	mustAllow(t, checker.Check(leadSales, authz.Request{Action: authz.ActionRead, Division: "Sales"}))

	// deny: cross-division same level (lead_spv of Sales touching Ads resource)
	mustDeny(t, checker.Check(leadSales, authz.Request{Action: authz.ActionWrite, Division: "Ads", OwnerEmployeeID: "EMP-1"}))

	// deny: plain staff (role below lead_spv) attempting the same division-wide write
	staffSales := authz.Identity{EmployeeID: "EMP-1", Divisi: "Sales", Roles: []authz.Role{authz.RoleStaff}}
	mustDeny(t, checker.Check(staffSales, authz.Request{Action: authz.ActionWrite, Division: "Sales", OwnerEmployeeID: "EMP-2"}))
}

func TestCheck_OD_ReadOnlyEverywhere_NeverWrite(t *testing.T) {
	checker := authz.NewMatrixChecker()
	od := authz.Identity{EmployeeID: "EMP-77", Divisi: "Marketing", Roles: []authz.Role{authz.RoleOD}}

	// allow-read-only: OD reads any division, any owner
	mustAllow(t, checker.Check(od, authz.Request{Action: authz.ActionRead, Division: "Sales", OwnerEmployeeID: "EMP-1"}))
	mustAllow(t, checker.Check(od, authz.Request{Action: authz.ActionRead, Division: "Ads"}))

	// deny: OD never writes, even to its own division or its own employee_id
	mustDeny(t, checker.Check(od, authz.Request{Action: authz.ActionWrite, Division: "Marketing", OwnerEmployeeID: "EMP-77"}))
	mustDeny(t, checker.Check(od, authz.Request{Action: authz.ActionWrite, Division: "Sales"}))
}

func TestCheck_Director_Full(t *testing.T) {
	checker := authz.NewMatrixChecker()
	director := authz.Identity{EmployeeID: "EMP-1", Divisi: "Sales", Roles: []authz.Role{authz.RoleDirector}}

	mustAllow(t, checker.Check(director, authz.Request{Action: authz.ActionRead, Division: "Ads"}))
	mustAllow(t, checker.Check(director, authz.Request{Action: authz.ActionWrite, Division: "Ads", OwnerEmployeeID: "EMP-99"}))
	mustAllow(t, checker.Check(director, authz.Request{Capability: authz.CapManageOKR}))
	mustAllow(t, checker.Check(director, authz.Request{Capability: authz.CapManageRoleMapping}))
	mustAllow(t, checker.Check(director, authz.Request{Capability: authz.CapManageEmployees}))
}

func TestCheck_Capabilities(t *testing.T) {
	checker := authz.NewMatrixChecker()
	od := authz.Identity{EmployeeID: "EMP-2", Divisi: "Marketing", Roles: []authz.Role{authz.RoleOD}}
	leadSPV := authz.Identity{EmployeeID: "EMP-3", Divisi: "Marketing", Roles: []authz.Role{authz.RoleLeadSPV}}
	staff := authz.Identity{EmployeeID: "EMP-4", Divisi: "Marketing", Roles: []authz.Role{authz.RoleStaff}}
	director := authz.Identity{EmployeeID: "EMP-5", Divisi: "Marketing", Roles: []authz.Role{authz.RoleDirector}}

	// ManageOKR: OD and Director only
	mustAllow(t, checker.Check(od, authz.Request{Capability: authz.CapManageOKR}))
	mustAllow(t, checker.Check(director, authz.Request{Capability: authz.CapManageOKR}))
	mustDeny(t, checker.Check(leadSPV, authz.Request{Capability: authz.CapManageOKR}))
	mustDeny(t, checker.Check(staff, authz.Request{Capability: authz.CapManageOKR}))

	// ManageRoleMapping / ManageEmployees: Director only, not even OD
	mustDeny(t, checker.Check(od, authz.Request{Capability: authz.CapManageRoleMapping}))
	mustAllow(t, checker.Check(director, authz.Request{Capability: authz.CapManageRoleMapping}))
	mustDeny(t, checker.Check(od, authz.Request{Capability: authz.CapManageEmployees}))
	mustAllow(t, checker.Check(director, authz.Request{Capability: authz.CapManageEmployees}))
}

func TestCheck_UnmappedIdentity_DeniedByDefault(t *testing.T) {
	checker := authz.NewMatrixChecker()
	unmapped := authz.Identity{EmployeeID: "EMP-404", Divisi: "Sales"} // no Roles resolved

	if unmapped.Authenticated() {
		t.Fatal("expected unmapped identity to be unauthenticated")
	}
	mustDeny(t, checker.Check(unmapped, authz.Request{Action: authz.ActionRead, Division: "Sales", OwnerEmployeeID: "EMP-404"}))
	mustDeny(t, checker.Check(unmapped, authz.Request{Action: authz.ActionWrite, Division: "Sales", OwnerEmployeeID: "EMP-404"}))
	mustDeny(t, checker.Check(unmapped, authz.Request{Capability: authz.CapManageOKR}))
}

// TestCheck_LayeredRole_StaffPlusOD is the S0-08 AC fixture: one employee
// account that is Staff+OD (layered). It must get write from the Staff
// scope, read-all from the OD scope, and NEVER write from the OD scope.
func TestCheck_LayeredRole_StaffPlusOD(t *testing.T) {
	checker := authz.NewMatrixChecker()
	fixture := authz.Identity{
		EmployeeID: "EMP-STAFF-OD",
		Divisi:     "Marketing",
		Roles:      []authz.Role{authz.RoleStaff, authz.RoleOD},
	}

	// Write to own data: granted via the Staff scope.
	mustAllow(t, checker.Check(fixture, authz.Request{
		Action: authz.ActionWrite, Division: "Marketing", OwnerEmployeeID: "EMP-STAFF-OD",
	}))

	// Read cross-division, someone else's data: granted via the OD scope.
	mustAllow(t, checker.Check(fixture, authz.Request{
		Action: authz.ActionRead, Division: "Ads", OwnerEmployeeID: "EMP-OTHER",
	}))

	// Write cross-division / someone else's data: the OD scope grants read
	// only, and the Staff scope doesn't apply (not own division/own data) --
	// must be denied outright, never falling back to an OD write.
	mustDeny(t, checker.Check(fixture, authz.Request{
		Action: authz.ActionWrite, Division: "Ads", OwnerEmployeeID: "EMP-OTHER",
	}))

	// Write to own division-wide data the fixture doesn't own and isn't
	// lead_spv over: still denied -- OD never upgrades to write.
	mustDeny(t, checker.Check(fixture, authz.Request{
		Action: authz.ActionWrite, Division: "Marketing", OwnerEmployeeID: "EMP-OTHER",
	}))
}
