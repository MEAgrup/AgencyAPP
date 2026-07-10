package hris

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/events"
)

// Event names published by Syncer. Not part of the Phase 0 v2 §9 business
// notification catalog (that catalog is module/PRD-driven); these are
// operational/admin signals for HRIS sync health, per docs/HRIS API
// CONTRACT.md §3 ("raises an admin notification after 2 consecutive
// failures" / "flagged for admin review"). See the sync ambiguity note in
// this ticket's final report re: no dedicated notification-center recipient
// is defined for these yet.
const (
	EventSyncFailed      = "hris.sync.failed"
	EventEmployeeMissing = "hris.employee.missing_from_sync"
)

// SyncResult summarizes one Sync call for logging/observability.
type SyncResult struct {
	Fetched        int
	Created        int
	Updated        int
	Unchanged      int
	FlaggedMissing int
}

// Syncer upserts employees from any EmployeeSource into the local `employees`
// mirror table (docs/DATA_MODEL.md), idempotently. It is safe for concurrent
// use by a single scheduler goroutine plus manual-refresh triggers; the
// consecutive-failure counter is protected by a mutex.
type Syncer struct {
	DB  *sql.DB
	Bus events.Bus
	// Now defaults to time.Now when nil; override in tests for determinism.
	Now func() time.Time

	mu               sync.Mutex
	consecutiveFails int
}

func (s *Syncer) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// Sync fetches employees from src updated since updatedSince (zero time =
// full sync, matching the EmployeeSource.Fetch contract) and upserts them.
// On a full sync, any currently-known employee absent from the payload is
// flagged missing_from_sync=1 (never deleted) and an admin event is
// published per flagged employee. Deactivated employees (status_aktif=false)
// have all their sessions revoked. After 2 or more consecutive failures (of
// either the fetch or the DB apply step) an admin event is published.
func (s *Syncer) Sync(ctx context.Context, src EmployeeSource, updatedSince time.Time) (SyncResult, error) {
	employees, err := src.Fetch(ctx, updatedSince)
	if err != nil {
		s.recordFailure(ctx, fmt.Errorf("fetch employees: %w", err))
		return SyncResult{}, err
	}

	var result SyncResult
	result.Fetched = len(employees)
	var flaggedMissing []string

	err = db.WithTx(ctx, s.DB, func(tx *sql.Tx) error {
		created, updated, unchanged, err := upsertEmployees(ctx, tx, s.now(), employees)
		if err != nil {
			return err
		}
		result.Created, result.Updated, result.Unchanged = created, updated, unchanged

		if updatedSince.IsZero() {
			flagged, err := flagMissing(ctx, tx, s.now(), employees)
			if err != nil {
				return err
			}
			flaggedMissing = flagged
			result.FlaggedMissing = len(flagged)
		}
		return nil
	})
	if err != nil {
		s.recordFailure(ctx, err)
		return result, err
	}

	// Publish only after the transaction that recorded the flags commits.
	for _, id := range flaggedMissing {
		s.publishMissing(ctx, id)
	}

	s.recordSuccess()
	return result, nil
}

func (s *Syncer) recordFailure(ctx context.Context, cause error) {
	s.mu.Lock()
	s.consecutiveFails++
	n := s.consecutiveFails
	s.mu.Unlock()

	if n >= 2 && s.Bus != nil {
		s.Bus.Publish(ctx, events.Event{
			Name:       EventSyncFailed,
			EntityType: "hris_sync",
			EntityID:   "employees",
			Actor:      "system",
			At:         s.now(),
			Payload: map[string]any{
				"consecutive_failures": n,
				"error":                cause.Error(),
			},
		})
	}
}

func (s *Syncer) recordSuccess() {
	s.mu.Lock()
	s.consecutiveFails = 0
	s.mu.Unlock()
}

func (s *Syncer) publishMissing(ctx context.Context, employeeID string) {
	if s.Bus == nil {
		return
	}
	s.Bus.Publish(ctx, events.Event{
		Name:       EventEmployeeMissing,
		EntityType: "employee",
		EntityID:   employeeID,
		Actor:      "system",
		At:         s.now(),
		Payload:    map[string]any{"reason": "absent_from_full_sync"},
	})
}

// upsertEmployees writes each fetched employee: insert if unseen, update only
// if any field actually differs (so `updated_at` only bumps on real change),
// and revokes sessions for anyone reported inactive.
func upsertEmployees(ctx context.Context, q db.Queryer, now time.Time, employees []Employee) (created, updated, unchanged int, err error) {
	now = now.UTC().Truncate(time.Microsecond)

	for _, emp := range employees {
		emp.UpdatedAt = emp.UpdatedAt.UTC().Truncate(time.Microsecond)

		var existing Employee
		var missing bool
		row := q.QueryRowContext(ctx, `
			SELECT nama, email, divisi, jabatan, status_aktif, hris_updated_at, missing_from_sync
			FROM employees WHERE employee_id = ?`, emp.EmployeeID)
		scanErr := row.Scan(&existing.Nama, &existing.Email, &existing.Divisi, &existing.Jabatan,
			&existing.StatusAktif, &existing.UpdatedAt, &missing)

		switch {
		case errors.Is(scanErr, sql.ErrNoRows):
			if _, err = q.ExecContext(ctx, `
				INSERT INTO employees
					(employee_id, nama, email, divisi, jabatan, status_aktif, hris_updated_at, missing_from_sync, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
				emp.EmployeeID, emp.Nama, emp.Email, emp.Divisi, emp.Jabatan, emp.StatusAktif, emp.UpdatedAt, now, now); err != nil {
				return created, updated, unchanged, fmt.Errorf("insert employee %s: %w", emp.EmployeeID, err)
			}
			created++
		case scanErr != nil:
			return created, updated, unchanged, fmt.Errorf("lookup employee %s: %w", emp.EmployeeID, scanErr)
		default:
			same := existing.Nama == emp.Nama &&
				existing.Email == emp.Email &&
				existing.Divisi == emp.Divisi &&
				existing.Jabatan == emp.Jabatan &&
				existing.StatusAktif == emp.StatusAktif &&
				existing.UpdatedAt.Equal(emp.UpdatedAt) &&
				!missing
			if same {
				unchanged++
			} else {
				if _, err = q.ExecContext(ctx, `
					UPDATE employees
					SET nama = ?, email = ?, divisi = ?, jabatan = ?, status_aktif = ?, hris_updated_at = ?, missing_from_sync = 0, updated_at = ?
					WHERE employee_id = ?`,
					emp.Nama, emp.Email, emp.Divisi, emp.Jabatan, emp.StatusAktif, emp.UpdatedAt, now, emp.EmployeeID); err != nil {
					return created, updated, unchanged, fmt.Errorf("update employee %s: %w", emp.EmployeeID, err)
				}
				updated++
			}
		}

		if !emp.StatusAktif {
			if _, err = q.ExecContext(ctx, `
				UPDATE sessions SET revoked_at = ? WHERE employee_id = ? AND revoked_at IS NULL`,
				now, emp.EmployeeID); err != nil {
				return created, updated, unchanged, fmt.Errorf("revoke sessions for %s: %w", emp.EmployeeID, err)
			}
		}
	}
	return created, updated, unchanged, nil
}

// flagMissing marks employees not present in a full-sync payload as
// missing_from_sync=1 (never deleting them) and returns the newly-flagged
// employee_ids so the caller can publish events after the transaction
// commits.
func flagMissing(ctx context.Context, q db.Queryer, now time.Time, fetched []Employee) ([]string, error) {
	now = now.UTC().Truncate(time.Microsecond)

	seen := make(map[string]bool, len(fetched))
	for _, e := range fetched {
		seen[e.EmployeeID] = true
	}

	rows, err := q.QueryContext(ctx, `SELECT employee_id FROM employees WHERE missing_from_sync = 0`)
	if err != nil {
		return nil, fmt.Errorf("list employees for missing check: %w", err)
	}
	var toFlag []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		if !seen[id] {
			toFlag = append(toFlag, id)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	for _, id := range toFlag {
		if _, err := q.ExecContext(ctx, `UPDATE employees SET missing_from_sync = 1, updated_at = ? WHERE employee_id = ?`, now, id); err != nil {
			return nil, fmt.Errorf("flag missing employee %s: %w", id, err)
		}
	}
	return toFlag, nil
}
