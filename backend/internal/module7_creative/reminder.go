// Hours Logged end-of-day reminder (M7 §5 Rule 2 / M7-OA-2, DECISIONS O29 ->
// "GO — W2 langkah 49" 2026-07-17, W3-CAT-1: the one event the catalog freeze
// opened for in Wave 3). Hours Logged stays optional and non-punitive — this
// sweep only nudges completion, never blocks or scores anything.
//
// Pattern mirrored, field for field, from module5_finance/reminder.go's
// ScanReminders (M5 §6): a sweep function safe to run on every dashboard load
// AND on a nightly cron, each candidate row re-checked and fire-once guarded
// inside its own row-locked transaction so concurrent scans never double-emit.
//
// Two adaptations from the M5 shape, both logged here rather than picked
// silently:
//
//  1. "Active" work status. M5's overdue/H-3 passes key off a single explicit
//     installment status. Here, "status kerja aktif" (per the cluster brief)
//     reads as: the Asset has an assigned PIC (nobody to remind otherwise) AND
//     its status is neither terminal ([Approved], §7 machine) nor [Blocked]
//     (paused on an external dependency — no work is happening to log hours
//     against, STATE_MACHINES.md §7 "Blocked intervals excluded from
//     turnaround"). Every other status ([To Do], [In Progress], [Submitted],
//     [In Review], [Revision Requested]) counts as active.
//
//  2. "Logged today". Hours Logged (hours.go) is a single self-reported
//     overwrite-and-audit figure on the Asset row, not a per-day table — the
//     per-day granularity of the auto-logged Daily Output feature is a
//     separate, explicitly deferred cluster (W2-M7-C2 header). So "logged
//     today" is read the same way Daily Output reads Asset history: derived
//     from the immutable audit log. LogHours writes exactly one audit row per
//     call (action "hours_logged"); "logged today" = at least one such row
//     falls inside the target WIB calendar day (tz.Date, O20).
//
// Dedup mirrors M5's fire-once *_at columns exactly, adapted for a REPEATING
// (daily, not one-time) reminder: assets.hours_reminder_sent_at (migration
// 0031) stores the timestamp of the last reminder fired for that Asset. A
// candidate is skipped only while the stored timestamp's WIB calendar day is
// still today's; once the WIB day has moved on, the guard opens again — so a
// PIC who still hasn't logged hours gets reminded again the next day, but
// never twice within the same WIB day.
package module7_creative

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/tz"
)

// hoursReminderSystemActor drives the automated sweep (M5 reminder.go
// precedent) — no human actor initiates it, and the emission never notifies
// this synthetic id (Emission.NotifyActor defaults false).
var hoursReminderSystemActor = permission.Actor{EmployeeID: "system"}

// ErrHoursReminderScanForbidden: actor may not trigger the Hours Logged
// reminder scan (only the Creative division, any level, or Director — §9.1
// precedent, mirrors module5_finance.canRunScan's Finance-division-or-Director
// gate). New BI string (W1-09 precedent), listed for orchestrator sign-off.
var ErrHoursReminderScanForbidden = errors.New("[anda tidak memiliki akses untuk menjalankan pemindaian pengingat Hours Logged]")

// hoursReminderActiveStatuses: not terminal ([Approved]), not paused
// ([Blocked]) — see the package-level note above.
func isHoursReminderActiveStatus(status string) bool {
	return status != StatusApproved && status != StatusBlocked
}

// ScanHoursReminderResult tallies what one ScanHoursReminders pass fired.
type ScanHoursReminderResult struct {
	RemindersSent int `json:"reminders_sent"`
}

// ScanHoursReminders finds every active Asset (assigned PIC, non-terminal,
// non-blocked) whose PIC has not logged Hours on it for the WIB calendar day
// containing `now`, and emits EvHoursLoggedReminder to that PIC — at most once
// per (Asset, WIB day). Safe to call on every dashboard load and on a nightly
// cron (M5 §6 Flow 1 precedent). No-op (returns a zero result, touches
// nothing) when the catalog is not wired — mirrors the nil-guard already used
// for EvRevisionCountFlag (review.go) rather than marking rows sent without
// ever actually notifying anyone.
func (s *Service) ScanHoursReminders(ctx context.Context, now time.Time) (ScanHoursReminderResult, error) {
	var res ScanHoursReminderResult
	if s.Catalog == nil {
		return res, nil
	}
	today := tz.Date(now)

	rows, err := s.DB.QueryContext(ctx,
		`SELECT id FROM assets
		   WHERE assigned_pic IS NOT NULL AND assigned_pic <> ''
		     AND status NOT IN (?, ?)`,
		StatusApproved, StatusBlocked)
	if err != nil {
		return res, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return res, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return res, err
	}
	rows.Close()

	for _, id := range ids {
		ok, err := s.fireHoursReminder(ctx, id, now, today)
		if err != nil {
			return res, err
		}
		if ok {
			res.RemindersSent++
		}
	}
	return res, nil
}

// fireHoursReminder re-checks and fires one Asset's reminder inside a
// row-locked transaction (M5 fireOverdue/fireH3 precedent, exact shape). It
// stamps hours_reminder_sent_at with the scan's own `now` (not SQL NOW()) so
// the fire-once guard's day comparison stays consistent with the clock the
// scan was actually run against — production callers pass real time.Now(),
// but this keeps the sweep deterministic under an injected clock (tests).
func (s *Service) fireHoursReminder(ctx context.Context, assetID string, now, today time.Time) (bool, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	var status string
	var pic sql.NullString
	var sentAt sql.NullTime
	if err := tx.QueryRowContext(ctx,
		`SELECT status, assigned_pic, hours_reminder_sent_at FROM assets WHERE id = ? FOR UPDATE`, assetID).
		Scan(&status, &pic, &sentAt); err != nil {
		return false, err
	}
	if !isHoursReminderActiveStatus(status) || !pic.Valid || pic.String == "" {
		// Moved on (approved/blocked) or unassigned since candidates were listed.
		return false, nil
	}
	if sentAt.Valid && !tz.Date(sentAt.Time).Before(today) {
		// Already reminded for this WIB day (or a later one — should not
		// happen since `today` is the scan's own day).
		return false, nil
	}

	logged, err := hoursLoggedOnDay(ctx, tx, assetID, today)
	if err != nil {
		return false, err
	}
	if logged {
		return false, nil
	}

	if _, err := s.Catalog.Emit(ctx, tx, notification.Emission{
		Event: notification.EvHoursLoggedReminder, EntityType: "asset", EntityID: assetID,
		Actor: hoursReminderSystemActor.EmployeeID, ExplicitRecipients: []string{pic.String},
	}); err != nil {
		return false, err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE assets SET hours_reminder_sent_at = ? WHERE id = ?`, now.UTC(), assetID); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

// hoursLoggedOnDay reports whether the PIC logged Hours (hours.go's LogHours,
// audit action "hours_logged") on this Asset within the WIB calendar day
// containing `day` — the same UTC window construction as DailyOutput (O20):
// [day 00:00 WIB, day+1 00:00 WIB).
func hoursLoggedOnDay(ctx context.Context, tx *sql.Tx, assetID string, day time.Time) (bool, error) {
	dayMid := tz.Date(day)
	nextMid := dayMid.AddDate(0, 0, 1)
	var n int
	err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM audit_log
		   WHERE entity_type = 'asset' AND entity_id = ? AND action = 'hours_logged'
		     AND created_at >= ? AND created_at < ?`,
		assetID, dayMid.UTC(), nextMid.UTC()).Scan(&n)
	return n > 0, err
}

// canRunHoursReminderScan: Creative (any level) or Director may trigger the
// scan on demand (mirrors module5_finance.canRunScan, M5 §8.1 precedent).
func canRunHoursReminderScan(a permission.Actor) bool {
	if a.Role.Director {
		return true
	}
	return a.Role.Division == CreativeDivision
}

// RunHoursReminderScan is the authorised entry point for the scan endpoint.
func (s *Service) RunHoursReminderScan(ctx context.Context, actor permission.Actor, now time.Time) (ScanHoursReminderResult, error) {
	if !canRunHoursReminderScan(actor) {
		return ScanHoursReminderResult{}, ErrHoursReminderScanForbidden
	}
	return s.ScanHoursReminders(ctx, now)
}
