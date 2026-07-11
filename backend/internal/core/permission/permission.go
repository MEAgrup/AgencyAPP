// Package permission holds the CDPS role model and the global permission
// matrix from PERMISSIONS.md.
//
// Universal pattern:
//   - Staff        = own data only
//   - Lead/SPV     = division-wide (own division)
//   - OD           = read-only everywhere + manages OKR (NEVER writes)
//   - Viewer       = read-only everywhere, same read reach as OD, but NOT OD
//     (no OKR authority, no lead authority, cannot manage admin)
//   - Director     = full view + manage employees / role mappings / layered roles
//
// OD, Viewer and Director are layered roles on top of a normal employee
// account.
package permission

// Level is the division seniority level from role_mappings.
const (
	LevelStaff = "staff"
	LevelLead  = "lead"
)

// Role is the resolved CDPS role for an authenticated employee.
type Role struct {
	Division string // CDPS division from role mapping (may be "" if unmapped)
	Level    string // staff | lead
	OD       bool   // layered read-only-everywhere role; also manages OKR
	Viewer   bool   // layered read-only-everywhere role; NOT OD, no OKR/lead authority
	Director bool   // layered full-access role
}

// Actor is an authenticated employee plus resolved role, threaded through the
// engine and handlers.
type Actor struct {
	EmployeeID string
	Nama       string
	Email      string
	Divisi     string // raw HRIS division
	Jabatan    string // raw HRIS jabatan
	Role       Role
}

// IsLead reports whether the actor acts with lead/SPV authority in division.
// Directors carry lead authority everywhere. OD does NOT (read-only).
func (a Actor) IsLead(division string) bool {
	if a.Role.Director {
		return true
	}
	return a.Role.Level == LevelLead && a.Role.Division == division
}

// CanWrite reports whether the actor may perform write actions at all.
// OD is read-only; a pure-OD account (no division write scope) cannot write.
// Directors can always write. Staff/Lead write within their scope.
func (a Actor) CanWrite() bool {
	if a.Role.Director {
		return true
	}
	// A layered OD with an underlying division account still writes from the
	// division scope; only actions attempted "as OD" are read-only. Here we
	// simply require some division scope to exist.
	return a.Role.Division != ""
}

// CanManageAdmin reports whether the actor may manage employees, role mappings
// and layered roles. Director only.
func (a Actor) CanManageAdmin() bool {
	return a.Role.Director
}

// CanReadDivision reports read access to a division's data.
func (a Actor) CanReadDivision(division string) bool {
	if a.Role.Director || a.Role.OD || a.Role.Viewer {
		return true
	}
	if a.Role.Level == LevelLead && a.Role.Division == division {
		return true
	}
	return false
}

// CanReadAll reports cross-division read access (OD / Viewer / Director).
func (a Actor) CanReadAll() bool {
	return a.Role.Director || a.Role.OD || a.Role.Viewer
}
