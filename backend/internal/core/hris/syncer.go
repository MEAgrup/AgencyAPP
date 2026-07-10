package hris

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
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
	// Audit, when non-nil, receives one append-only history row per employee
	// row mutation the sync performs (create/update/deactivate/flag_missing/
	// unflag_missing), on the same transaction as the mutation — CLAUDE.md
	// convention #3. Nil disables auditing (unchanged behavior).
	Audit audit.Logger
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
// flagged missing_from_sync=1 (never deleted), has all sessions revoked, and
// an admin event is published per flagged employee. Deactivated employees
// (status_aktif=false) likewise have all their sessions revoked. After 2 or
// more consecutive failures (of either the fetch or the DB apply step) an
// admin event is published.
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
		created, updated, unchanged, err := upsertEmployees(ctx, tx, s.Audit, s.now(), employees)
		if err != nil {
			return err
		}
		result.Created, result.Updated, result.Unchanged = created, updated, unchanged

		if updatedSince.IsZero() {
			flagged, err := flagMissing(ctx, tx, s.Audit, s.now(), employees)
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

// employeeAudit is the row snapshot serialized into audit before/after JSON.
type employeeAudit struct {
	EmployeeID      string    `json:"employee_id"`
	Nama            string    `json:"nama"`
	Email           string    `json:"email"`
	Divisi          string    `json:"divisi"`
	Jabatan         string    `json:"jabatan"`
	StatusAktif     bool      `json:"status_aktif"`
	HrisUpdatedAt   time.Time `json:"hris_updated_at"`
	MissingFromSync bool      `json:"missing_from_sync"`
}

// appendEmployeeAudit writes one append-only history row for an employee-row
// mutation, on the caller's transaction. A nil logger is a no-op (auditing
// disabled). Actor is always "system" — sync is a batch job (audit.Entry doc).
func appendEmployeeAudit(ctx context.Context, aud audit.Logger, q db.Queryer, now time.Time, action, employeeID string, before, after *employeeAudit) error {
	if aud == nil {
		return nil
	}
	var beforeJSON, afterJSON []byte
	if before != nil {
		beforeJSON, _ = json.Marshal(before)
	}
	if after != nil {
		afterJSON, _ = json.Marshal(after)
	}
	_, err := aud.Append(ctx, q, audit.Entry{
		EntityType: "employee",
		EntityID:   employeeID,
		Actor:      "system",
		Action:     action,
		Before:     beforeJSON,
		After:      afterJSON,
		At:         now,
	})
	return err
}

// upsertEmployees writes each fetched employee: insert if unseen, update only
// if any field actually differs (so `updated_at` only bumps on real change),
// and revokes sessions for anyone reported inactive. Every row mutation is
// audited via aud (nil disables auditing).
func upsertEmployees(ctx context.Context, q db.Queryer, aud audit.Logger, now time.Time, employees []Employee) (created, updated, unchanged int, err error) {
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

		after := &employeeAudit{
			EmployeeID: emp.EmployeeID, Nama: emp.Nama, Email: emp.Email, Divisi: emp.Divisi,
			Jabatan: emp.Jabatan, StatusAktif: emp.StatusAktif, HrisUpdatedAt: emp.UpdatedAt,
			MissingFromSync: false,
		}

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
			if err = appendEmployeeAudit(ctx, aud, q, now, "create", emp.EmployeeID, nil, after); err != nil {
				return created, updated, unchanged, fmt.Errorf("audit create %s: %w", emp.EmployeeID, err)
			}
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

				// Classify the mutation for the audit trail. Deactivation
				// (active→inactive) is the security-critical case and wins;
				// otherwise a reappearance (was flagged missing, now present)
				// is an unflag; everything else is a plain field update.
				action := "update"
				switch {
				case existing.StatusAktif && !emp.StatusAktif:
					action = "deactivate"
				case missing:
					action = "unflag_missing"
				}
				before := &employeeAudit{
					EmployeeID: emp.EmployeeID, Nama: existing.Nama, Email: existing.Email, Divisi: existing.Divisi,
					Jabatan: existing.Jabatan, StatusAktif: existing.StatusAktif,
					HrisUpdatedAt: existing.UpdatedAt.UTC().Truncate(time.Microsecond), MissingFromSync: missing,
				}
				if err = appendEmployeeAudit(ctx, aud, q, now, action, emp.EmployeeID, before, after); err != nil {
					return created, updated, unchanged, fmt.Errorf("audit %s %s: %w", action, emp.EmployeeID, err)
				}
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
// missing_from_sync=1 (never deleting them), revokes their sessions (an
// HRIS-removed employee must lose CDPS access on next sync, CLAUDE.md), audits
// each flag via aud, and returns the newly-flagged employee_ids so the caller
// can publish admin events after the transaction commits.
func flagMissing(ctx context.Context, q db.Queryer, aud audit.Logger, now time.Time, fetched []Employee) ([]string, error) {
	now = now.UTC().Truncate(time.Microsecond)

	seen := make(map[string]bool, len(fetched))
	for _, e := range fetched {
		seen[e.EmployeeID] = true
	}

	rows, err := q.QueryContext(ctx, `
		SELECT employee_id, nama, email, divisi, jabatan, status_aktif, hris_updated_at
		FROM employees WHERE missing_from_sync = 0`)
	if err != nil {
		return nil, fmt.Errorf("list employees for missing check: %w", err)
	}
	var toFlag []employeeAudit
	for rows.Next() {
		var e employeeAudit
		if err := rows.Scan(&e.EmployeeID, &e.Nama, &e.Email, &e.Divisi, &e.Jabatan, &e.StatusAktif, &e.HrisUpdatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		if !seen[e.EmployeeID] {
			toFlag = append(toFlag, e)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	ids := make([]string, 0, len(toFlag))
	for _, e := range toFlag {
		if _, err := q.ExecContext(ctx, `UPDATE employees SET missing_from_sync = 1, updated_at = ? WHERE employee_id = ?`, now, e.EmployeeID); err != nil {
			return nil, fmt.Errorf("flag missing employee %s: %w", e.EmployeeID, err)
		}
		// Revoke sessions so a removed employee loses CDPS access immediately.
		if _, err := q.ExecContext(ctx, `
			UPDATE sessions SET revoked_at = ? WHERE employee_id = ? AND revoked_at IS NULL`,
			now, e.EmployeeID); err != nil {
			return nil, fmt.Errorf("revoke sessions for missing %s: %w", e.EmployeeID, err)
		}

		before := e
		after := e
		after.MissingFromSync = true
		if err := appendEmployeeAudit(ctx, aud, q, now, "flag_missing", e.EmployeeID, &before, &after); err != nil {
			return nil, fmt.Errorf("audit flag_missing %s: %w", e.EmployeeID, err)
		}
		ids = append(ids, e.EmployeeID)
	}
	return ids, nil
}
