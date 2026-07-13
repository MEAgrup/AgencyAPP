// Hours Logged (M7 §5 Rule 2 / M12 §2 Rule 9): a manual, self-reported effort
// figure the PIC may optionally record on an Asset. It is supplementary and
// NON-punitive — NEVER folded into Speed/Quantity KPI scoring (M7-OA-2); the
// metrics computation (module12_task) does not read it. Written by the assigned
// PIC, the Creative lead, or Director; audited (immutable history).
//
// Scope note (C1): Hours Logged is stored as a single self-reported figure on the
// Asset, overwrite-and-audit. The per-day granularity and end-of-day lock of the
// auto-logged Daily Output feature (§7) are a separate, later M7 cluster.
package module7_creative

import (
	"context"
	"database/sql"
	"errors"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// LogHours sets the Asset's Hours Logged (§5 Rule 2). Must be > 0. Allowed for the
// assigned PIC (self-report), the Creative division lead, or Director.
func (s *Service) LogHours(ctx context.Context, actor permission.Actor, assetID string, hours float64) error {
	if hours <= 0 {
		return ErrInvalidHours
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var division string
	var pic sql.NullString
	var prev sql.NullFloat64
	err = tx.QueryRowContext(ctx,
		`SELECT b.assigned_division, a.assigned_pic, a.hours_logged
		   FROM assets a JOIN briefs b ON b.id = a.brief_id
		  WHERE a.id = ? FOR UPDATE`, assetID).Scan(&division, &pic, &prev)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrAssetNotFound
	}
	if err != nil {
		return err
	}
	if !canLogHours(actor, division, pic.String) {
		return ErrHoursForbidden
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE assets SET hours_logged = ? WHERE id = ?`, hours, assetID); err != nil {
		return err
	}
	var prevVal any
	if prev.Valid {
		prevVal = prev.Float64
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "asset", EntityID: assetID, Actor: actor.EmployeeID, Action: "hours_logged",
		Before: map[string]any{"hours_logged": prevVal},
		After:  map[string]any{"hours_logged": hours},
	}); err != nil {
		return err
	}
	return tx.Commit()
}

// canLogHours: the assigned PIC (self-report), the Creative division lead, or
// Director. A different Creative staff member (not the PIC) may not log for others.
func canLogHours(a permission.Actor, division, assignedPIC string) bool {
	if a.Role.Director {
		return true
	}
	if a.IsLead(division) {
		return true
	}
	return assignedPIC != "" && a.EmployeeID == assignedPIC
}
