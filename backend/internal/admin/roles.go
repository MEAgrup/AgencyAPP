package admin

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// ErrBadLevel is returned for an invalid role-mapping level.
var ErrBadLevel = errors.New("level harus 'staff' atau 'lead'")

// ErrBadRole is returned for an invalid layered role.
var ErrBadRole = errors.New("role harus 'od' atau 'director'")

// ErrBadDivision is returned when the mapping's CDPS division is not one of the
// canonical values the permission gates compare against.
var ErrBadDivision = errors.New("division harus salah satu dari: Marketing, Sales, Finance, Account, Creative, Ads, KOL, Live Stream")

// RoleMapping is a HRIS divisi+jabatan -> CDPS division+level rule.
type RoleMapping struct {
	ID        int64     `json:"id"`
	Divisi    string    `json:"divisi"`
	Jabatan   string    `json:"jabatan"`
	Division  string    `json:"division"`
	Level     string    `json:"level"`
	CreatedAt time.Time `json:"created_at"`
}

// ListRoleMappings returns all role mappings.
func ListRoleMappings(ctx context.Context, d *sql.DB) ([]RoleMapping, error) {
	rows, err := d.QueryContext(ctx,
		`SELECT id, divisi, jabatan, division, level, created_at FROM role_mappings ORDER BY divisi, jabatan`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RoleMapping{}
	for rows.Next() {
		var m RoleMapping
		if err := rows.Scan(&m.ID, &m.Divisi, &m.Jabatan, &m.Division, &m.Level, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// UpsertRoleMapping inserts or updates a mapping (admin-managed, no redeploy).
func UpsertRoleMapping(ctx context.Context, d *sql.DB, actor permission.Actor, m RoleMapping) (int64, error) {
	if m.Level != permission.LevelStaff && m.Level != permission.LevelLead {
		return 0, ErrBadLevel
	}
	// Canonicalize the CDPS division: the FE form may submit lowercase/spaced
	// variants ("marketing", "livestream"), but the permission gates compare
	// against exact constants. Store only the canonical value or reject.
	division, ok := permission.NormalizeDivision(m.Division)
	if !ok {
		return 0, ErrBadDivision
	}
	res, err := d.ExecContext(ctx,
		`INSERT INTO role_mappings (divisi, jabatan, division, level, created_by)
		 VALUES (?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE division=VALUES(division), level=VALUES(level)`,
		m.Divisi, m.Jabatan, division, m.Level, actor.EmployeeID)
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	_ = audit.Write(ctx, d, audit.Record{
		EntityType: "role_mapping", EntityID: m.Divisi + "/" + m.Jabatan, Actor: actor.EmployeeID,
		Action: "upsert", After: map[string]any{"division": division, "level": m.Level},
	})
	return id, nil
}

// DeleteRoleMapping removes a mapping by id.
func DeleteRoleMapping(ctx context.Context, d *sql.DB, actor permission.Actor, id int64) error {
	if _, err := d.ExecContext(ctx, `DELETE FROM role_mappings WHERE id = ?`, id); err != nil {
		return err
	}
	_ = audit.Write(ctx, d, audit.Record{
		EntityType: "role_mapping", EntityID: strconv.FormatInt(id, 10), Actor: actor.EmployeeID, Action: "delete",
	})
	return nil
}

// LayeredRole is an OD/Director assignment on an employee.
type LayeredRole struct {
	ID         int64     `json:"id"`
	EmployeeID string    `json:"employee_id"`
	Role       string    `json:"role"`
	Enabled    bool      `json:"enabled"`
	CreatedAt  time.Time `json:"created_at"`
}

// ListLayeredRoles returns all layered-role assignments.
func ListLayeredRoles(ctx context.Context, d *sql.DB) ([]LayeredRole, error) {
	rows, err := d.QueryContext(ctx,
		`SELECT id, employee_id, role, enabled, created_at FROM employee_layered_roles ORDER BY employee_id, role`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LayeredRole{}
	for rows.Next() {
		var r LayeredRole
		if err := rows.Scan(&r.ID, &r.EmployeeID, &r.Role, &r.Enabled, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// SetLayeredRole enables/disables a layered OD/Director role for an employee.
func SetLayeredRole(ctx context.Context, d *sql.DB, actor permission.Actor, employeeID, role string, enabled bool) error {
	if role != "od" && role != "director" {
		return ErrBadRole
	}
	en := 0
	if enabled {
		en = 1
	}
	if _, err := d.ExecContext(ctx,
		`INSERT INTO employee_layered_roles (employee_id, role, enabled, created_by)
		 VALUES (?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)`,
		employeeID, role, en, actor.EmployeeID); err != nil {
		return err
	}
	_ = audit.Write(ctx, d, audit.Record{
		EntityType: "layered_role", EntityID: employeeID, Actor: actor.EmployeeID,
		Action: "set", After: map[string]any{"role": role, "enabled": enabled},
	})
	return nil
}
