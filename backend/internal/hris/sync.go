package hris

import (
	"context"
	"database/sql"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
)

// SyncResult summarizes one sync run.
type SyncResult struct {
	Synced      int `json:"synced"`
	Deactivated int `json:"deactivated"`
	Flagged     int `json:"flagged"`
}

// Sync upserts employees from src into the employees table. It is idempotent.
//
//   - status_aktif=false ⇒ the employee's sessions are revoked (access blocked
//     on their next request).
//   - On a full sync, employees present in CDPS but absent from the source are
//     flagged_for_review (never deleted — audit trail preserved).
//
// actor is the employee id that triggered the sync (or "SYSTEM" for scheduled).
func Sync(ctx context.Context, d *sql.DB, src EmployeeSource, actor string, full bool) (SyncResult, error) {
	var res SyncResult
	var since time.Time // full sync => zero
	emps, err := src.Fetch(ctx, since)
	if err != nil {
		return res, err
	}

	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		return res, err
	}
	defer tx.Rollback()

	now := time.Now()
	present := make(map[string]bool, len(emps))
	for _, e := range emps {
		present[e.EmployeeID] = true

		// Prior active state (for deactivation detection).
		var priorActive sql.NullBool
		_ = tx.QueryRowContext(ctx, `SELECT status_aktif FROM employees WHERE employee_id = ?`, e.EmployeeID).Scan(&priorActive)

		active := 0
		if e.StatusAktif {
			active = 1
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO employees (employee_id, nama, email, divisi, jabatan, status_aktif, flagged_for_review, synced_at, created_by)
			 VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
			 ON DUPLICATE KEY UPDATE nama=VALUES(nama), email=VALUES(email), divisi=VALUES(divisi),
			   jabatan=VALUES(jabatan), status_aktif=VALUES(status_aktif), flagged_for_review=0, synced_at=VALUES(synced_at)`,
			e.EmployeeID, e.Nama, e.Email, e.Divisi, e.Jabatan, active, now, actor); err != nil {
			return res, err
		}
		res.Synced++

		if !e.StatusAktif {
			// Revoke sessions (block access). Count as deactivation when it is
			// a transition from active (or unknown) to inactive.
			r, err := tx.ExecContext(ctx,
				`UPDATE sessions SET revoked_at = ? WHERE employee_id = ? AND revoked_at IS NULL`, now, e.EmployeeID)
			if err != nil {
				return res, err
			}
			revoked, _ := r.RowsAffected()
			if !priorActive.Valid || priorActive.Bool || revoked > 0 {
				res.Deactivated++
				_ = audit.Write(ctx, tx, audit.Record{
					EntityType: "employee", EntityID: e.EmployeeID, Actor: actor,
					Action: "hris_sync:deactivated", After: map[string]any{"status_aktif": false},
				})
			}
		}
	}

	if full {
		rows, err := tx.QueryContext(ctx, `SELECT employee_id FROM employees WHERE flagged_for_review = 0`)
		if err != nil {
			return res, err
		}
		var missing []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return res, err
			}
			if !present[id] {
				missing = append(missing, id)
			}
		}
		rows.Close()
		for _, id := range missing {
			if _, err := tx.ExecContext(ctx,
				`UPDATE employees SET flagged_for_review = 1 WHERE employee_id = ?`, id); err != nil {
				return res, err
			}
			res.Flagged++
			_ = audit.Write(ctx, tx, audit.Record{
				EntityType: "employee", EntityID: id, Actor: actor,
				Action: "hris_sync:flagged_absent", After: map[string]any{"flagged_for_review": true},
			})
		}
	}

	if err := tx.Commit(); err != nil {
		return res, err
	}
	return res, nil
}
