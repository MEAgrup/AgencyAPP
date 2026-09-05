package permission_test

import (
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

func TestRoleMatrix(t *testing.T) {
	staff := permission.Actor{EmployeeID: "S", Role: permission.Role{Division: "Creative", Level: "staff"}}
	lead := permission.Actor{EmployeeID: "L", Role: permission.Role{Division: "Creative", Level: "lead"}}
	od := permission.Actor{EmployeeID: "O", Role: permission.Role{OD: true}}
	director := permission.Actor{EmployeeID: "D", Role: permission.Role{Director: true}}
	// Layered case: one employee is Creative Staff AND OD.
	staffOD := permission.Actor{EmployeeID: "SO", Role: permission.Role{Division: "Creative", Level: "staff", OD: true}}

	cases := []struct {
		name                           string
		a                              permission.Actor
		canWrite, admin, readAll, lead bool
		readOwnDiv, readOtherDiv       bool
	}{
		{"staff", staff, true, false, false, false, false, false},
		{"lead", lead, true, false, false, true, true, false},
		{"od", od, false, false, true, false, true, true},
		{"director", director, true, true, true, true, true, true},
		{"staff+od", staffOD, true, false, true, false, true, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.a.CanWrite(); got != c.canWrite {
				t.Errorf("CanWrite=%v want %v", got, c.canWrite)
			}
			if got := c.a.CanManageAdmin(); got != c.admin {
				t.Errorf("CanManageAdmin=%v want %v", got, c.admin)
			}
			if got := c.a.CanReadAll(); got != c.readAll {
				t.Errorf("CanReadAll=%v want %v", got, c.readAll)
			}
			if got := c.a.IsLead("Creative"); got != c.lead {
				t.Errorf("IsLead(Creative)=%v want %v", got, c.lead)
			}
			if got := c.a.CanReadDivision("Creative"); got != c.readOwnDiv {
				t.Errorf("CanReadDivision(Creative)=%v want %v", got, c.readOwnDiv)
			}
			if got := c.a.CanReadDivision("Ads"); got != c.readOtherDiv {
				t.Errorf("CanReadDivision(Ads)=%v want %v", got, c.readOtherDiv)
			}
		})
	}
}

// The layered OD scope must never confer write; only the underlying division
// scope does. A pure OD (no division) cannot write.
func TestLayeredOD_NeverWritesFromODScope(t *testing.T) {
	pureOD := permission.Actor{EmployeeID: "O", Role: permission.Role{OD: true}}
	if pureOD.CanWrite() {
		t.Fatal("pure OD must be read-only (CanWrite=false)")
	}
	staffOD := permission.Actor{EmployeeID: "SO", Role: permission.Role{Division: "Creative", Level: "staff", OD: true}}
	if !staffOD.CanWrite() {
		t.Fatal("Staff+OD must write from staff scope")
	}
	if staffOD.IsLead("Creative") {
		t.Fatal("Staff+OD is not a lead")
	}
}
