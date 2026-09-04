package auth

import (
	"context"
	"database/sql"
	"errors"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// ErrEmployeeNotFound indicates the employee id has no active synced record.
var ErrEmployeeNotFound = errors.New("auth: employee not found or inactive")

// LookupActiveEmployee returns the employee id if it maps to an ACTIVE synced
// employee, else ErrEmployeeNotFound. Used to gate login to synced+active only.
func LookupActiveEmployee(ctx context.Context, d *sql.DB, employeeID string) error {
	var active bool
	err := d.QueryRowContext(ctx, `SELECT status_aktif FROM employees WHERE employee_id = ?`, employeeID).Scan(&active)
	if err == sql.ErrNoRows {
		return ErrEmployeeNotFound
	}
	if err != nil {
		return err
	}
	if !active {
		return ErrEmployeeNotFound
	}
	return nil
}

// ResolveActor builds the full Actor (employee + role) for an employee id,
// applying role_mappings and layered OD/Director roles.
func ResolveActor(ctx context.Context, d *sql.DB, employeeID string) (permission.Actor, error) {
	var a permission.Actor
	a.EmployeeID = employeeID

	err := d.QueryRowContext(ctx,
		`SELECT nama, email, divisi, jabatan FROM employees WHERE employee_id = ?`, employeeID).
		Scan(&a.Nama, &a.Email, &a.Divisi, &a.Jabatan)
	if err == sql.ErrNoRows {
		return a, ErrEmployeeNotFound
	}
	if err != nil {
		return a, err
	}

	// Role mapping (divisi+jabatan -> division+level). Absent mapping is allowed
	// (e.g. pure Director), leaving division/level empty.
	var division, level sql.NullString
	err = d.QueryRowContext(ctx,
		`SELECT division, level FROM role_mappings WHERE divisi = ? AND jabatan = ?`, a.Divisi, a.Jabatan).
		Scan(&division, &level)
	if err != nil && err != sql.ErrNoRows {
		return a, err
	}
	if division.Valid {
		a.Role.Division = division.String
	}
	if level.Valid {
		a.Role.Level = level.String
	}

	// Layered roles.
	rows, err := d.QueryContext(ctx,
		`SELECT role FROM employee_layered_roles WHERE employee_id = ? AND enabled = 1`, employeeID)
	if err != nil {
		return a, err
	}
	defer rows.Close()
	for rows.Next() {
		var role string
		if err := rows.Scan(&role); err != nil {
			return a, err
		}
		switch role {
		case "od":
			a.Role.OD = true
		case "director":
			a.Role.Director = true
		}
	}
	return a, rows.Err()
}
