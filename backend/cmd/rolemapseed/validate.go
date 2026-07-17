package main

// Field-level validation of one raw CSV row, pure (no DB): the same
// staff/lead and od/director enums admin already enforces server-side
// (admin.ErrBadLevel / admin.ErrBadRole) — this is an early, row-addressable
// error report so a bad seed CSV fails fast with a useful line number instead
// of a generic error from deep inside admin. admin.UpsertRoleMapping /
// admin.SetLayeredRole remain the authoritative server-side gate.
//
// The employee_id-must-exist-in-employees check for layered roles is NOT
// here: it needs a DB read, so it lives in engine.go's Execute (phase 1b,
// still strictly before any write).

import (
	"fmt"
	"strings"

	"github.com/meagrup/agencyapp/backend/internal/admin"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// errf builds a row-addressable error (line number + key fields).
func (r RoleMappingRow) errf(format string, args ...any) error {
	return fmt.Errorf("role_mappings_riil.csv baris %d (%s/%s): "+format,
		append([]any{r.Line, r.Divisi, r.Jabatan}, args...)...)
}

func (r LayeredRoleRow) errf(format string, args ...any) error {
	return fmt.Errorf("layered_roles_riil.csv baris %d (%s): "+format,
		append([]any{r.Line, r.EmployeeID}, args...)...)
}

// ToRoleMapping validates one raw row and converts it to an
// admin.RoleMapping. It is the single source of truth for "is this row
// well-formed" — both dry-run and apply call it before touching the DB.
func (r RoleMappingRow) ToRoleMapping() (admin.RoleMapping, error) {
	divisi := strings.TrimSpace(r.Divisi)
	jabatan := strings.TrimSpace(r.Jabatan)
	division := strings.TrimSpace(r.Division)
	level := strings.TrimSpace(r.Level)

	if divisi == "" {
		return admin.RoleMapping{}, r.errf("divisi kosong")
	}
	if jabatan == "" {
		return admin.RoleMapping{}, r.errf("jabatan kosong")
	}
	if division == "" {
		return admin.RoleMapping{}, r.errf("division (CDPS) kosong")
	}
	if level != permission.LevelStaff && level != permission.LevelLead {
		return admin.RoleMapping{}, r.errf("%w: %q", admin.ErrBadLevel, r.Level)
	}
	return admin.RoleMapping{Divisi: divisi, Jabatan: jabatan, Division: division, Level: level}, nil
}

// Validate validates one raw layered-role row (role enum + non-empty
// employee_id). It does NOT check that employee_id exists in `employees` —
// that requires a DB read and is done in engine.go before any write.
func (r LayeredRoleRow) Validate() (employeeID, role string, err error) {
	employeeID = strings.TrimSpace(r.EmployeeID)
	role = strings.TrimSpace(r.Role)

	if employeeID == "" {
		return "", "", r.errf("employee_id kosong")
	}
	if role != "od" && role != "director" {
		return "", "", r.errf("%w: %q", admin.ErrBadRole, r.Role)
	}
	return employeeID, role, nil
}
