// Admin CRUD for role_mappings and role_overrides. Restricted to Director
// (Phase 0 §4: "Manage employees / role mapping ... Director (+ system
// admin)" only) and appended to the audit log via the audit.Logger contract
// on every change (CLAUDE.md convention #3).
package authz

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/msg"
)

// RoleMapping is one role_mappings row.
type RoleMapping struct {
	ID        int64
	Divisi    string
	Jabatan   string
	Role      Role
	CreatedAt time.Time
	CreatedBy string
}

// RoleOverride is one role_overrides row.
type RoleOverride struct {
	ID         int64
	EmployeeID string
	Role       Role
	CreatedAt  time.Time
	CreatedBy  string
}

// ValidationError carries the exact Bahasa Indonesia message required by
// CLAUDE.md convention #5. Admin-config validation here has no
// module-specific PRD message, so it uses the documented default.
type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }

func validationErr() error {
	return &ValidationError{Message: msg.DataTidakLengkap}
}

// MappingAdmin is the Director-only admin surface for role_mappings and
// role_overrides. Every method checks the caller via Checker before touching
// the database and appends an audit row via audit.Logger on success.
type MappingAdmin struct {
	checker Checker
	audit   audit.Logger
}

// NewMappingAdmin constructs a MappingAdmin.
func NewMappingAdmin(checker Checker, logger audit.Logger) *MappingAdmin {
	return &MappingAdmin{checker: checker, audit: logger}
}

func (a *MappingAdmin) requireDirector(actor Identity) error {
	return a.checker.Check(actor, Request{Capability: CapManageRoleMapping})
}

// CreateMapping inserts a new (divisi, jabatan) -> role base mapping.
func (a *MappingAdmin) CreateMapping(ctx context.Context, q db.Queryer, actor Identity, divisi, jabatan string, role Role) (*RoleMapping, error) {
	if err := a.requireDirector(actor); err != nil {
		return nil, err
	}
	if divisi == "" || jabatan == "" {
		return nil, validationErr()
	}
	if role != RoleStaff && role != RoleLeadSPV {
		return nil, validationErr()
	}

	now := time.Now().UTC()
	res, err := q.ExecContext(ctx,
		`INSERT INTO role_mappings (divisi, jabatan, role, created_at, created_by) VALUES (?, ?, ?, ?, ?)`,
		divisi, jabatan, string(role), now, actor.EmployeeID,
	)
	if err != nil {
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}

	m := &RoleMapping{ID: id, Divisi: divisi, Jabatan: jabatan, Role: role, CreatedAt: now, CreatedBy: actor.EmployeeID}
	after, _ := json.Marshal(m)
	if _, err := a.audit.Append(ctx, q, audit.Entry{
		EntityType: "role_mapping",
		EntityID:   fmt.Sprint(id),
		Actor:      actor.EmployeeID,
		Action:     "create",
		After:      after,
		At:         now,
	}); err != nil {
		return nil, err
	}
	return m, nil
}

// UpdateMapping changes the role assigned to an existing (divisi, jabatan)
// mapping row (e.g. promoting a jabatan from staff to lead_spv).
func (a *MappingAdmin) UpdateMapping(ctx context.Context, q db.Queryer, actor Identity, id int64, newRole Role) (*RoleMapping, error) {
	if err := a.requireDirector(actor); err != nil {
		return nil, err
	}
	if newRole != RoleStaff && newRole != RoleLeadSPV {
		return nil, validationErr()
	}

	before, err := a.getMapping(ctx, q, id)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	if _, err := q.ExecContext(ctx, `UPDATE role_mappings SET role = ? WHERE id = ?`, string(newRole), id); err != nil {
		return nil, err
	}

	after := *before
	after.Role = newRole
	beforeJSON, _ := json.Marshal(before)
	afterJSON, _ := json.Marshal(after)
	if _, err := a.audit.Append(ctx, q, audit.Entry{
		EntityType: "role_mapping",
		EntityID:   fmt.Sprint(id),
		Actor:      actor.EmployeeID,
		Action:     "update",
		Before:     beforeJSON,
		After:      afterJSON,
		At:         now,
	}); err != nil {
		return nil, err
	}
	return &after, nil
}

// DeleteMapping removes a (divisi, jabatan) base mapping row.
func (a *MappingAdmin) DeleteMapping(ctx context.Context, q db.Queryer, actor Identity, id int64) error {
	if err := a.requireDirector(actor); err != nil {
		return err
	}
	before, err := a.getMapping(ctx, q, id)
	if err != nil {
		return err
	}
	if _, err := q.ExecContext(ctx, `DELETE FROM role_mappings WHERE id = ?`, id); err != nil {
		return err
	}
	beforeJSON, _ := json.Marshal(before)
	_, err = a.audit.Append(ctx, q, audit.Entry{
		EntityType: "role_mapping",
		EntityID:   fmt.Sprint(id),
		Actor:      actor.EmployeeID,
		Action:     "delete",
		Before:     beforeJSON,
		At:         time.Now().UTC(),
	})
	return err
}

func (a *MappingAdmin) getMapping(ctx context.Context, q db.Queryer, id int64) (*RoleMapping, error) {
	var m RoleMapping
	var role string
	err := q.QueryRowContext(ctx,
		`SELECT id, divisi, jabatan, role, created_at, created_by FROM role_mappings WHERE id = ?`, id,
	).Scan(&m.ID, &m.Divisi, &m.Jabatan, &role, &m.CreatedAt, &m.CreatedBy)
	if err != nil {
		return nil, err
	}
	m.Role = Role(role)
	return &m, nil
}

// CreateOverride layers an OD/Director role onto an employee account.
func (a *MappingAdmin) CreateOverride(ctx context.Context, q db.Queryer, actor Identity, employeeID string, role Role) (*RoleOverride, error) {
	if err := a.requireDirector(actor); err != nil {
		return nil, err
	}
	if employeeID == "" {
		return nil, validationErr()
	}
	if role != RoleOD && role != RoleDirector {
		return nil, validationErr()
	}

	now := time.Now().UTC()
	res, err := q.ExecContext(ctx,
		`INSERT INTO role_overrides (employee_id, role, created_at, created_by) VALUES (?, ?, ?, ?)`,
		employeeID, string(role), now, actor.EmployeeID,
	)
	if err != nil {
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}

	o := &RoleOverride{ID: id, EmployeeID: employeeID, Role: role, CreatedAt: now, CreatedBy: actor.EmployeeID}
	after, _ := json.Marshal(o)
	if _, err := a.audit.Append(ctx, q, audit.Entry{
		EntityType: "role_override",
		EntityID:   fmt.Sprint(id),
		Actor:      actor.EmployeeID,
		Action:     "create",
		After:      after,
		At:         now,
	}); err != nil {
		return nil, err
	}
	return o, nil
}

// DeleteOverride removes a layered role from an employee account.
func (a *MappingAdmin) DeleteOverride(ctx context.Context, q db.Queryer, actor Identity, id int64) error {
	if err := a.requireDirector(actor); err != nil {
		return err
	}

	var o RoleOverride
	var role string
	err := q.QueryRowContext(ctx,
		`SELECT id, employee_id, role, created_at, created_by FROM role_overrides WHERE id = ?`, id,
	).Scan(&o.ID, &o.EmployeeID, &role, &o.CreatedAt, &o.CreatedBy)
	if err != nil {
		return err
	}
	o.Role = Role(role)

	if _, err := q.ExecContext(ctx, `DELETE FROM role_overrides WHERE id = ?`, id); err != nil {
		return err
	}
	beforeJSON, _ := json.Marshal(o)
	_, err = a.audit.Append(ctx, q, audit.Entry{
		EntityType: "role_override",
		EntityID:   fmt.Sprint(id),
		Actor:      actor.EmployeeID,
		Action:     "delete",
		Before:     beforeJSON,
		At:         time.Now().UTC(),
	})
	return err
}
