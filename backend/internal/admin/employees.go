package admin

import (
	"context"
	"database/sql"
	"time"
)

// EmployeeRow is an admin view of a synced employee.
type EmployeeRow struct {
	EmployeeID  string     `json:"employee_id"`
	Nama        string     `json:"nama"`
	Email       string     `json:"email"`
	Divisi      string     `json:"divisi"`
	Jabatan     string     `json:"jabatan"`
	StatusAktif bool       `json:"status_aktif"`
	Flagged     bool       `json:"flagged"`
	SyncedAt    *time.Time `json:"synced_at"`
}

// ListEmployees returns all synced employees.
func ListEmployees(ctx context.Context, d *sql.DB) ([]EmployeeRow, error) {
	rows, err := d.QueryContext(ctx,
		`SELECT employee_id, nama, email, divisi, jabatan, status_aktif, flagged_for_review, synced_at
		   FROM employees ORDER BY divisi, nama`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []EmployeeRow{}
	for rows.Next() {
		var e EmployeeRow
		var synced sql.NullTime
		if err := rows.Scan(&e.EmployeeID, &e.Nama, &e.Email, &e.Divisi, &e.Jabatan, &e.StatusAktif, &e.Flagged, &synced); err != nil {
			return nil, err
		}
		if synced.Valid {
			t := synced.Time
			e.SyncedAt = &t
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
