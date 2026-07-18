package module14_performance

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// This file owns the admin-configurable KPI Profile weights (§5.2 / OA-5) and the
// period targets (§2 Rule 2 / OA-2; O9 STILL OPEN). Both are living config, not
// state machines — edited through the admin surface (Director gate) and appended to
// the immutable audit_log (before->after). The compute path reads them at snapshot
// time; the redistribution (Rule 6) re-normalises whatever weights are present.

// defaultTargetDate is the sentinel period_start meaning "applies to every period
// unless a period-specific override row exists" (migration 0036). A real per-period
// target is a row with the actual month's first day.
const defaultTargetDate = "0001-01-01"

// validRoleTypes is the closed set a config write may target.
var validRoleTypes = map[string]bool{
	RoleCreative: true, RoleAds: true, RoleKOL: true, RoleAM: true,
}

// ---- KPI Profile weights ----

// KPIWeight is one (role_type, component) weight row.
type KPIWeight struct {
	RoleType  string    `json:"role_type"`
	Component string    `json:"component"`
	Weight    float64   `json:"weight"`
	UpdatedAt time.Time `json:"updated_at"`
	UpdatedBy string    `json:"updated_by"`
}

// roleWeights loads the weight map for one role_type (component -> weight). Used by
// the compute path; never gated (internal).
func roleWeights(ctx context.Context, q rowQuerier, roleType string) (map[string]float64, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT component, weight FROM perf_kpi_weights WHERE role_type = ?`, roleType)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]float64{}
	for rows.Next() {
		var comp string
		var w float64
		if err := rows.Scan(&comp, &w); err != nil {
			return nil, err
		}
		out[comp] = w
	}
	return out, rows.Err()
}

// ListWeights returns every configured weight, for the admin UI + read surfaces.
// Read-gated by canScope (any CDPS actor may inspect the profile definition).
func (s *Service) ListWeights(ctx context.Context, actor permission.Actor) ([]KPIWeight, error) {
	if !canScope(actor) {
		return nil, ErrForbidden
	}
	rows, err := s.DB.QueryContext(ctx,
		`SELECT role_type, component, weight, updated_at, updated_by
		   FROM perf_kpi_weights ORDER BY role_type, component`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []KPIWeight{}
	for rows.Next() {
		var w KPIWeight
		if err := rows.Scan(&w.RoleType, &w.Component, &w.Weight, &w.UpdatedAt, &w.UpdatedBy); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// SetWeights replaces the FULL weight set for one role_type in a single atomic
// write (§5.2 / OA-5). The incoming components must sum to exactly 100
// (ErrWeightsNotHundred) — validated server-side before any row is touched, so a
// bad edit can never leave a role in a Σ≠100 state. Director only. The change is
// appended to the immutable audit_log (before->after). Setting weights does NOT
// recompute or mutate any existing snapshot (immutable) — it affects the next run.
func (s *Service) SetWeights(ctx context.Context, actor permission.Actor, roleType string, weights map[string]float64) error {
	if !canManageConfig(actor) {
		return ErrConfigForbidden
	}
	if !validRoleTypes[roleType] {
		return ErrBadRoleType
	}
	var sum float64
	for _, w := range weights {
		sum += w
	}
	if math.Abs(sum-100) > 1e-6 {
		return ErrWeightsNotHundred
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	before, err := roleWeights(ctx, tx, roleType)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM perf_kpi_weights WHERE role_type = ?`, roleType); err != nil {
		return err
	}
	for comp, w := range weights {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO perf_kpi_weights (role_type, component, weight, updated_by) VALUES (?, ?, ?, ?)`,
			roleType, comp, w, actor.EmployeeID); err != nil {
			return err
		}
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "perf_kpi_weights", EntityID: roleType, Actor: actor.EmployeeID,
		Action: "weights_set",
		Before: map[string]any{"weights": before},
		After:  map[string]any{"weights": weights},
	}); err != nil {
		return err
	}
	return tx.Commit()
}

// ---- Period targets (OA-2 / O9) ----

// PeriodTarget is one normalisation target row.
type PeriodTarget struct {
	RoleType      string    `json:"role_type"`
	Component     string    `json:"component"`
	PeriodStart   string    `json:"period_start"` // "YYYY-MM-DD"; defaultTargetDate = applies to all periods
	TargetValue   float64   `json:"target_value"`
	IsPlaceholder bool      `json:"is_placeholder"` // O9: true = illustrative seed, NOT a confirmed target
	UpdatedAt     time.Time `json:"updated_at"`
	UpdatedBy     string    `json:"updated_by"`
}

// targetFor resolves the normalisation target for (role_type, component) in a
// period: an exact period-specific row wins, else the sentinel default row. ok is
// false when no target is configured at all (the component is then treated as
// missing data → excluded + redistributed, decision point 2 / 4). placeholder is
// surfaced so a snapshot can flag that its normalisation used an unconfirmed target.
func targetFor(ctx context.Context, q rowQuerier, roleType, component, periodStartDate string) (target float64, placeholder, ok bool, err error) {
	// Exact period match first.
	err = q.QueryRowContext(ctx,
		`SELECT target_value, is_placeholder FROM perf_period_targets
		   WHERE role_type = ? AND component = ? AND period_start = ?`,
		roleType, component, periodStartDate).Scan(&target, &placeholder)
	if err == nil {
		return target, placeholder, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, false, false, err
	}
	// Default sentinel row.
	err = q.QueryRowContext(ctx,
		`SELECT target_value, is_placeholder FROM perf_period_targets
		   WHERE role_type = ? AND component = ? AND period_start = ?`,
		roleType, component, defaultTargetDate).Scan(&target, &placeholder)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, false, nil
	}
	if err != nil {
		return 0, false, false, err
	}
	return target, placeholder, true, nil
}

// ListTargets returns every configured target, newest-period first. Read-gated by
// canScope.
func (s *Service) ListTargets(ctx context.Context, actor permission.Actor) ([]PeriodTarget, error) {
	if !canScope(actor) {
		return nil, ErrForbidden
	}
	rows, err := s.DB.QueryContext(ctx,
		`SELECT role_type, component, period_start, target_value, is_placeholder, updated_at, updated_by
		   FROM perf_period_targets ORDER BY role_type, component, period_start DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PeriodTarget{}
	for rows.Next() {
		var t PeriodTarget
		var ph int
		var start time.Time
		if err := rows.Scan(&t.RoleType, &t.Component, &start, &t.TargetValue, &ph, &t.UpdatedAt, &t.UpdatedBy); err != nil {
			return nil, err
		}
		t.PeriodStart = start.Format("2006-01-02")
		t.IsPlaceholder = ph != 0
		out = append(out, t)
	}
	return out, rows.Err()
}

// SetTarget upserts one normalisation target (§2 Rule 2 / O9). Director only. When
// a real target is entered the caller sets IsPlaceholder=false; the seed rows stay
// flagged placeholder until then. periodStart "" defaults to the sentinel (applies
// to every period). Appended to the immutable audit_log (before->after).
func (s *Service) SetTarget(ctx context.Context, actor permission.Actor, t PeriodTarget) error {
	if !canManageConfig(actor) {
		return ErrConfigForbidden
	}
	if !validRoleTypes[t.RoleType] {
		return ErrBadRoleType
	}
	periodStart := t.PeriodStart
	if periodStart == "" {
		periodStart = defaultTargetDate
	}
	ph := 0
	if t.IsPlaceholder {
		ph = 1
	}
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO perf_period_targets (role_type, component, period_start, target_value, is_placeholder, updated_by)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE target_value=VALUES(target_value), is_placeholder=VALUES(is_placeholder), updated_by=VALUES(updated_by)`,
		t.RoleType, t.Component, periodStart, t.TargetValue, ph, actor.EmployeeID); err != nil {
		return err
	}
	_ = audit.Write(ctx, s.DB, audit.Record{
		EntityType: "perf_period_targets", EntityID: t.RoleType + "/" + t.Component + "/" + periodStart,
		Actor: actor.EmployeeID, Action: "target_set",
		After: map[string]any{"target_value": t.TargetValue, "is_placeholder": t.IsPlaceholder},
	})
	return nil
}
