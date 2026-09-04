// This file implements M12 §5.3 / §2 Rule 10: the target division's Lead/SPV sets
// each Task's PIC and its individual SLA Target at breakdown time. Both are plain
// audited field writes (not lifecycle statuses), mirroring the AM-assignment
// pattern in module6_account (a relationship/field pointer + immutable audit row,
// never the state-machine engine). Deferred from W2-M6-C3 (the `assigned_pic`
// column already existed; `sla_target_hours` is added by migration 0024).
package module12_task

import (
	"context"
	"database/sql"
	"errors"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// canManageTask is the §5.3 write gate: the target division's Lead/SPV, or
// Director. Staff (incl. the PIC), the AM and OD cannot assign PICs or set SLAs.
func canManageTask(a permission.Actor, division string) bool {
	return a.IsLead(division)
}

// AssignPIC sets the Task's accountable staff member (§5.3, §2 Rule 1). Target
// division Lead/SPV (or Director) only. The PIC must be an active STAFF member of
// the Brief's target division (mirrors module6_account.validateAMCandidate). A
// Live Stream / vendor-dispatched Brief is not an execution Task and is rejected.
func (s *Service) AssignPIC(ctx context.Context, actor permission.Actor, briefID, picID string) error {
	return s.assignPIC(ctx, actor, sourceBrief, briefID, picID)
}

// AssignAssetPIC assigns the accountable Creative staff on an Asset (M7 §9.3
// "Set by Team Leader or self-claimed" / §3 Rule 3 Team-Leader reassign). Same
// gate as briefs: the Asset's (parent Brief's) division Lead/SPV or Director.
func (s *Service) AssignAssetPIC(ctx context.Context, actor permission.Actor, assetID, picID string) error {
	return s.assignPIC(ctx, actor, sourceAsset, assetID, picID)
}

func (s *Service) assignPIC(ctx context.Context, actor permission.Actor, src taskSource, id, picID string) error {
	picID = trim(picID)
	if picID == "" {
		return ErrInvalidPIC
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	r, err := lockTask(ctx, tx, src, id)
	if err != nil {
		return err
	}
	if r.status == StatusVendorDispatched || r.division == DivisionLiveStream {
		return ErrNotATask
	}
	if !canManageTask(actor, r.division) {
		return ErrAssignForbidden
	}
	if err := validatePICForDivision(ctx, tx, picID, r.division); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		"UPDATE "+src.table+" SET assigned_pic = ? WHERE id = ?", picID, id); err != nil {
		return err
	}
	prev := any(nil)
	if r.assignedPIC != "" {
		prev = r.assignedPIC
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: src.entityType, EntityID: id, Actor: actor.EmployeeID, Action: "pic_assigned",
		Before: map[string]any{"assigned_pic": prev},
		After:  map[string]any{"assigned_pic": picID, "assigned_by": actor.EmployeeID},
	}); err != nil {
		return err
	}
	return tx.Commit()
}

// SetSLATarget sets the Task-level SLA Target in hours (§2 Rule 10, §5.3). Target
// division Lead/SPV (or Director) only. Distinct from the Brief-level due_date
// (client-facing DATE); this is the internal yardstick Speed Score measures
// against. Must be > 0. Changes are audited (history immutable in the audit log);
// it is never auto-defaulted or backfilled from the Brief level.
func (s *Service) SetSLATarget(ctx context.Context, actor permission.Actor, briefID string, hours float64) error {
	return s.setSLA(ctx, actor, sourceBrief, briefID, "sla_target_hours", "sla_target_set", hours)
}

// SetAssetSLA sets an Asset's Task-level SLA Target (§5.3) — the internal hours
// yardstick Speed Score measures against. Target division Lead/SPV or Director.
func (s *Service) SetAssetSLA(ctx context.Context, actor permission.Actor, assetID string, hours float64) error {
	return s.setSLA(ctx, actor, sourceAsset, assetID, "sla_target_hours", "sla_target_set", hours)
}

// SetAssetRevisionSLA sets an Asset's Revision SLA Target (M7-OA-3 / §9.3) — the
// separate, shorter target (default 24–48h) each revision round is measured
// against, feeding revision_speed_score. Distinct from the original SLA Target;
// same Lead/SPV/Director write gate. Set at breakdown time alongside the original.
func (s *Service) SetAssetRevisionSLA(ctx context.Context, actor permission.Actor, assetID string, hours float64) error {
	return s.setSLA(ctx, actor, sourceAsset, assetID, "revision_sla_target_hours", "revision_sla_target_set", hours)
}

func (s *Service) setSLA(ctx context.Context, actor permission.Actor, src taskSource, id, col, action string, hours float64) error {
	if hours <= 0 {
		return ErrInvalidSLA
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	r, err := lockTask(ctx, tx, src, id)
	if err != nil {
		return err
	}
	if r.status == StatusVendorDispatched || r.division == DivisionLiveStream {
		return ErrNotATask
	}
	if !canManageTask(actor, r.division) {
		return ErrAssignForbidden
	}
	var prev sql.NullFloat64
	if err := tx.QueryRowContext(ctx,
		"SELECT "+col+" FROM "+src.table+" WHERE id = ?", id).Scan(&prev); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		"UPDATE "+src.table+" SET "+col+" = ? WHERE id = ?", hours, id); err != nil {
		return err
	}
	var prevVal any
	if prev.Valid {
		prevVal = prev.Float64
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: src.entityType, EntityID: id, Actor: actor.EmployeeID, Action: action,
		Before: map[string]any{col: prevVal},
		After:  map[string]any{col: hours},
	}); err != nil {
		return err
	}
	return tx.Commit()
}

// validatePICForDivision enforces that the chosen PIC is an ACTIVE employee whose
// resolved CDPS division equals the Brief's target division and whose level is
// staff (§2 Rule 1 — a single accountable staff member). Mirrors the divisi+
// jabatan -> division join used by auth.ResolveActor without importing auth.
func validatePICForDivision(ctx context.Context, tx *sql.Tx, picID, division string) error {
	var active int
	var div, level sql.NullString
	err := tx.QueryRowContext(ctx,
		`SELECT e.status_aktif, rm.division, rm.level
		   FROM employees e
		   LEFT JOIN role_mappings rm ON rm.divisi = e.divisi AND rm.jabatan = e.jabatan
		  WHERE e.employee_id = ?`, picID).Scan(&active, &div, &level)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrInvalidPIC
	}
	if err != nil {
		return err
	}
	if active != 1 || !div.Valid || div.String != division ||
		!level.Valid || level.String != permission.LevelStaff {
		return ErrInvalidPIC
	}
	return nil
}
