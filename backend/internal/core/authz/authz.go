// Package authz is the permission layer over the Phase 0 §4 Consolidated
// Role Matrix (docs/prd/CDPS Phase0 Foundation v2.md §4, PERMISSIONS.md).
//
// Universal pattern: Staff = own data only; Lead/SPV = division-wide (own
// division); OD = read-only everywhere plus OKR management; Director = full
// view plus employee/role-mapping management. OD and Director are layered
// roles on top of a normal employee account (e.g. Staff+OD on one account),
// never a replacement for the base role.
package authz

import (
	"errors"
	"fmt"
)

// Role is a CDPS permission role. Base roles (Staff, LeadSPV) come from
// role_mappings; layered roles (OD, Director) come from role_overrides. An
// Identity can hold more than one Role at once.
type Role string

const (
	RoleStaff    Role = "staff"
	RoleLeadSPV  Role = "lead_spv"
	RoleOD       Role = "od"
	RoleDirector Role = "director"
)

// Action is the kind of access being requested against a resource.
type Action string

const (
	ActionRead  Action = "read"
	ActionWrite Action = "write"
)

// Capability names a named special right from the Phase 0 §4 matrix that
// isn't a plain read/write over a division/owner-scoped resource (e.g.
// "Manage OKR", "Manage employees / role mapping").
type Capability string

const (
	// CapManageOKR: OD and Director only (Phase 0 §4 cross-cutting row).
	CapManageOKR Capability = "manage_okr"
	// CapManageRoleMapping: Director only (role_mappings/role_overrides admin).
	CapManageRoleMapping Capability = "manage_role_mapping"
	// CapManageEmployees: Director only (Phase 0 §4 "manage employees").
	CapManageEmployees Capability = "manage_employees"
)

// Identity is the resolved set of roles for one employee at request time.
// Divisi is the employee's own division (from HRIS via role_mappings),
// used for Lead/SPV division-wide checks.
type Identity struct {
	EmployeeID string
	Divisi     string
	Roles      []Role
}

// Has reports whether the identity carries the given role.
func (i Identity) Has(r Role) bool {
	for _, x := range i.Roles {
		if x == r {
			return true
		}
	}
	return false
}

// Authenticated reports whether the identity resolved to at least one role.
// An employee whose (divisi, jabatan) has no role_mappings row and no
// role_overrides row is unmapped -- deny by default (S0-08 AC).
func (i Identity) Authenticated() bool {
	return len(i.Roles) > 0
}

// Request describes the access being attempted against a resource, in terms
// the Phase 0 §4 matrix understands.
type Request struct {
	Action Action
	// Division is the resource's own division (e.g. the division a Master
	// Service List entry belongs to, or the division of the record being
	// touched). Empty means "not division-scoped".
	Division string
	// OwnerEmployeeID is the employee_id that owns the resource, for
	// own-data-only (Staff) checks. Empty means "not owner-scoped".
	OwnerEmployeeID string
	// Capability, if set, requests a named special right instead of a plain
	// read/write check; Action/Division/OwnerEmployeeID are ignored.
	Capability Capability
}

// DeniedError is returned by Checker.Check on a denied request. It is
// intentionally typed (not a sentinel) so callers can inspect Reason for
// logging/telemetry without string-matching errors.Is.
type DeniedError struct {
	EmployeeID string
	Reason     string
}

func (e *DeniedError) Error() string {
	return fmt.Sprintf("authz: denied for employee %s: %s", e.EmployeeID, e.Reason)
}

// Is makes errors.Is(err, ErrDenied) work for any *DeniedError.
func (e *DeniedError) Is(target error) bool {
	return target == ErrDenied
}

// ErrDenied is a matchable sentinel; every returned error also satisfies
// errors.As into *DeniedError for the specific reason.
var ErrDenied = errors.New("authz: permission denied")

func denied(id Identity, reason string) error {
	return &DeniedError{EmployeeID: id.EmployeeID, Reason: reason}
}

// Checker enforces the Phase 0 §4 matrix against a resolved Identity.
type Checker interface {
	Check(id Identity, req Request) error
}

// MatrixChecker is the Checker implementation driving directly off the
// Phase 0 §4 / PERMISSIONS.md matrix. It holds no state and does no I/O --
// callers resolve Identity first (authz.Resolver) then check per request.
type MatrixChecker struct{}

// NewMatrixChecker constructs the standard Phase 0 §4 checker.
func NewMatrixChecker() *MatrixChecker { return &MatrixChecker{} }

// Check implements Checker.
//
// Semantics (PERMISSIONS.md "Global" table):
//   - Director: full access -- every read, every write, every capability.
//   - OD: read-only everywhere (any division, any owner) plus ManageOKR.
//     OD NEVER grants write, even for capabilities it doesn't hold and even
//     over its own employee_id's data -- write must come from a base role
//     (Staff/LeadSPV) layered on the same account.
//   - LeadSPV: division-wide read/write within its own division
//     (req.Division == id.Divisi).
//   - Staff: own-data-only read/write (req.OwnerEmployeeID == id.EmployeeID).
//   - No matching role (including a fully unmapped Identity): deny.
func (MatrixChecker) Check(id Identity, req Request) error {
	if req.Capability != "" {
		if capabilityAllowed(req.Capability, id) {
			return nil
		}
		return denied(id, fmt.Sprintf("capability %q requires OD/Director", req.Capability))
	}

	switch req.Action {
	case ActionRead:
		if id.Has(RoleDirector) || id.Has(RoleOD) {
			return nil
		}
		if id.Has(RoleLeadSPV) && req.Division != "" && req.Division == id.Divisi {
			return nil
		}
		if id.Has(RoleStaff) && req.OwnerEmployeeID != "" && req.OwnerEmployeeID == id.EmployeeID {
			return nil
		}
		return denied(id, "no role grants read access to this resource")

	case ActionWrite:
		if id.Has(RoleDirector) {
			return nil
		}
		// OD is read-only by definition: it falls through here even if the
		// same identity also has RoleOD, because write is only granted by
		// the base-role branches below.
		if id.Has(RoleLeadSPV) && req.Division != "" && req.Division == id.Divisi {
			return nil
		}
		if id.Has(RoleStaff) && req.OwnerEmployeeID != "" && req.OwnerEmployeeID == id.EmployeeID {
			return nil
		}
		return denied(id, "no role grants write access to this resource")

	default:
		return denied(id, fmt.Sprintf("unknown action %q", req.Action))
	}
}

func capabilityAllowed(cap Capability, id Identity) bool {
	switch cap {
	case CapManageOKR:
		return id.Has(RoleOD) || id.Has(RoleDirector)
	case CapManageRoleMapping, CapManageEmployees:
		return id.Has(RoleDirector)
	default:
		return false
	}
}
