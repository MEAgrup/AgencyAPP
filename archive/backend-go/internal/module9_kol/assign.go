// Coordinator assignment (§3 Rule 3), Task-level SLA Target (DATA_MODEL §3) and the
// optional Hours Logged field (§7 Rule 2). All three are plain audited field writes
// (not lifecycle statuses), mirroring the assign/SLA pattern in module12_task and
// the Hours Logged pattern in module7 — a relationship/field pointer + immutable
// audit row, never the state-machine engine.
package module9_kol

import (
	"context"
	"database/sql"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// canManageBooking is the §3 Rule 3 write gate for assignment / SLA: the KOL Team
// Leader (lead) or Director. Staff (incl. the Coordinator), AM and OD cannot.
func canManageBooking(a permission.Actor) bool {
	return a.IsLead(KOLDivision)
}

// AssignCoordinator sets the Booking's owning Coordinator (§3 Flow 2). KOL Team
// Leader/Director only. The Coordinator must be an active KOL-division staff member.
// The first assignment carries no "reason"; a REASSIGNMENT (an already-assigned
// Booking moving to a different Coordinator) requires a mandatory reason (§3 Rule 3),
// logged immutably.
func (s *Service) AssignCoordinator(ctx context.Context, actor permission.Actor, bookingID, coordID, reason string) error {
	coordID = trim(coordID)
	if coordID == "" {
		return ErrInvalidCoordinator
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	r, err := lockBooking(ctx, tx, bookingID)
	if err != nil {
		return err
	}
	if !canManageBooking(actor) {
		return ErrAssignForbidden
	}
	if err := validateKOLStaff(ctx, tx, coordID); err != nil {
		return err
	}
	// A reassignment (already assigned to a different Coordinator) requires a reason.
	reassign := r.coordinator != "" && r.coordinator != coordID
	if reassign && trim(reason) == "" {
		return ErrReassignReasonRequired
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE creator_bookings SET assigned_coordinator = ? WHERE id = ?`, coordID, bookingID); err != nil {
		return err
	}
	action := "coordinator_assigned"
	after := map[string]any{"assigned_coordinator": coordID, "assigned_by": actor.EmployeeID}
	if reassign {
		action = "coordinator_reassigned"
		after["reason"] = trim(reason)
	}
	prev := any(nil)
	if r.coordinator != "" {
		prev = r.coordinator
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "creator_booking", EntityID: bookingID, Actor: actor.EmployeeID, Action: action,
		Before: map[string]any{"assigned_coordinator": prev},
		After:  after,
	}); err != nil {
		return err
	}
	return tx.Commit()
}

// SetSLATarget sets the Booking-level SLA Target in hours (DATA_MODEL §3). KOL Team
// Leader/Director only. This is the internal yardstick the overall Speed Score
// (§11 mapping) is measured against; a Booking with no SLA yields Speed Score = N/A,
// never auto-defaulted or backfilled. Must be > 0. Audited (history immutable).
func (s *Service) SetSLATarget(ctx context.Context, actor permission.Actor, bookingID string, hours float64) error {
	if hours <= 0 {
		return ErrInvalidSLA
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	r, err := lockBooking(ctx, tx, bookingID)
	if err != nil {
		return err
	}
	if !canManageBooking(actor) {
		return ErrAssignForbidden
	}
	var prev sql.NullFloat64
	if err := tx.QueryRowContext(ctx,
		`SELECT sla_target_hours FROM creator_bookings WHERE id = ?`, bookingID).Scan(&prev); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE creator_bookings SET sla_target_hours = ? WHERE id = ?`, hours, bookingID); err != nil {
		return err
	}
	var prevVal any
	if prev.Valid {
		prevVal = prev.Float64
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "creator_booking", EntityID: bookingID, Actor: actor.EmployeeID, Action: "sla_target_set",
		Before: map[string]any{"sla_target_hours": prevVal},
		After:  map[string]any{"sla_target_hours": hours},
	}); err != nil {
		return err
	}
	_ = r
	return tx.Commit()
}

// LogHours sets the Booking's Hours Logged (§7 Rule 2) — a manual, self-reported,
// NON-punitive effort figure (mirrors M7 §5 Rule 2), never folded into Speed/KPI
// scoring. Must be > 0. Allowed for the assigned Coordinator (self-report), the KOL
// lead, or Director; overwrite-and-audit (immutable history in the log).
func (s *Service) LogHours(ctx context.Context, actor permission.Actor, bookingID string, hours float64) error {
	if hours <= 0 {
		return ErrInvalidSLA // reused positive-number message; hours must be > 0
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	r, err := lockBooking(ctx, tx, bookingID)
	if err != nil {
		return err
	}
	if !canLogHours(actor, r) {
		return ErrExecForbidden
	}
	var prev sql.NullFloat64
	if err := tx.QueryRowContext(ctx,
		`SELECT hours_logged FROM creator_bookings WHERE id = ?`, bookingID).Scan(&prev); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE creator_bookings SET hours_logged = ? WHERE id = ?`, hours, bookingID); err != nil {
		return err
	}
	var prevVal any
	if prev.Valid {
		prevVal = prev.Float64
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "creator_booking", EntityID: bookingID, Actor: actor.EmployeeID, Action: "hours_logged",
		Before: map[string]any{"hours_logged": prevVal},
		After:  map[string]any{"hours_logged": hours},
	}); err != nil {
		return err
	}
	return tx.Commit()
}

// canLogHours: the assigned Coordinator (self-report), the KOL lead, or Director. A
// different KOL staff member (not the Coordinator) may not log for others.
func canLogHours(a permission.Actor, r bookingRow) bool {
	if a.Role.Director {
		return true
	}
	if a.IsLead(KOLDivision) {
		return true
	}
	return r.coordinator != "" && a.EmployeeID == r.coordinator
}
