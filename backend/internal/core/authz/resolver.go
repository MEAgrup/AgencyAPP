package authz

import (
	"context"
	"database/sql"

	"github.com/meagrup/agencyapp/backend/internal/core/db"
)

// DivisiJabatan is one HRIS (divisi, jabatan) combination, as used by
// Unmapped to report combinations with no role_mappings row.
type DivisiJabatan struct {
	Divisi  string
	Jabatan string
}

// Resolver turns (employeeID, divisi, jabatan) into an Identity by reading
// role_mappings (base role) and role_overrides (layered OD/Director) fresh
// on every call, so an admin change to either table takes effect on the very
// next resolution without a redeploy (S0-08 AC). An unmapped (divisi,
// jabatan) with no override yields an Identity with zero Roles -- deny by
// default, per Checker.
type Resolver interface {
	Resolve(ctx context.Context, q db.Queryer, employeeID, divisi, jabatan string) (Identity, error)
	// Unmapped filters combos down to the ones with no role_mappings row,
	// for admin visibility into unmapped HRIS (divisi, jabatan) pairs. It
	// takes the candidate combos explicitly (e.g. sourced from the HRIS
	// employee sync) rather than querying the employees table directly --
	// authz does not own or depend on that table.
	Unmapped(ctx context.Context, q db.Queryer, combos []DivisiJabatan) ([]DivisiJabatan, error)
}

// SQLResolver is the MySQL/MariaDB-backed Resolver.
type SQLResolver struct{}

// NewSQLResolver constructs the standard DB-backed Resolver.
func NewSQLResolver() *SQLResolver { return &SQLResolver{} }

// Resolve implements Resolver.
func (SQLResolver) Resolve(ctx context.Context, q db.Queryer, employeeID, divisi, jabatan string) (Identity, error) {
	id := Identity{EmployeeID: employeeID, Divisi: divisi}

	var baseRole string
	err := q.QueryRowContext(ctx,
		`SELECT role FROM role_mappings WHERE divisi = ? AND jabatan = ?`,
		divisi, jabatan,
	).Scan(&baseRole)
	switch {
	case err == nil:
		id.Roles = append(id.Roles, Role(baseRole))
	case err == sql.ErrNoRows:
		// Unmapped combo: no base role. Overrides may still apply.
	default:
		return Identity{}, err
	}

	rows, err := q.QueryContext(ctx,
		`SELECT role FROM role_overrides WHERE employee_id = ?`,
		employeeID,
	)
	if err != nil {
		return Identity{}, err
	}
	defer rows.Close()

	for rows.Next() {
		var overrideRole string
		if err := rows.Scan(&overrideRole); err != nil {
			return Identity{}, err
		}
		id.Roles = append(id.Roles, Role(overrideRole))
	}
	if err := rows.Err(); err != nil {
		return Identity{}, err
	}

	return id, nil
}

// Unmapped implements Resolver.
func (SQLResolver) Unmapped(ctx context.Context, q db.Queryer, combos []DivisiJabatan) ([]DivisiJabatan, error) {
	var out []DivisiJabatan
	for _, c := range combos {
		var role string
		err := q.QueryRowContext(ctx,
			`SELECT role FROM role_mappings WHERE divisi = ? AND jabatan = ?`,
			c.Divisi, c.Jabatan,
		).Scan(&role)
		switch {
		case err == sql.ErrNoRows:
			out = append(out, c)
		case err != nil:
			return nil, err
		}
	}
	return out, nil
}
