package module14_performance

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/ident"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// perfPrefix is the house-ID prefix for a Performance Score snapshot (DATA_MODEL
// §1/§29). The YYYYMM bucket is the scored PERIOD month (§5.1), not the run month.
const perfPrefix = "PERF"

// Snapshot is the API view of a Performance Score — the full breakdown is
// MANDATORY (§2 Rule 8 / Flow 6 / §5.5: never a single number without its
// components).
type Snapshot struct {
	ID                 string      `json:"id"`
	StaffID            string      `json:"staff_id"`
	RoleType           string      `json:"role_type"`
	PeriodStart        string      `json:"period_start"`
	PeriodEnd          string      `json:"period_end"`
	ProfileScore       *float64    `json:"profile_score"`
	Modifier           Modifier    `json:"modifier"`
	FinalScore         *float64    `json:"final_score"`
	ScoreDisplay       string      `json:"score_display"` // "88.40" or "—" (all-excluded)
	Components         []Component `json:"components"`
	TargetsPlaceholder bool        `json:"targets_placeholder"` // O9: a raw-value used a placeholder target
	ComputedAt         time.Time   `json:"computed_at,omitempty"`
	ComputedBy         string      `json:"computed_by,omitempty"`
	Preview            bool        `json:"preview"`
}

// storedPayload is the components_json shape: the component breakdown, the modifier
// (value + source clients), and the placeholder-target flag (§5.1/§5.5).
type storedPayload struct {
	Components         []Component `json:"components"`
	Modifier           Modifier    `json:"modifier"`
	TargetsPlaceholder bool        `json:"targets_placeholder"`
}

// computed is the raw scoring output for one staff + period.
type computed struct {
	roleType    string
	components  []Component
	profile     *float64 // nil in the all-excluded case
	modifier    Modifier
	final       *float64 // nil in the all-excluded case
	placeholder bool
}

// computeFor gathers inputs and runs the scoring core for one staff + period,
// against *sql.DB (preview/read) or *sql.Tx (batch).
func (s *Service) computeFor(ctx context.Context, q rowQuerier, staffID, roleType string, per period) (computed, error) {
	weights, err := roleWeights(ctx, q, roleType)
	if err != nil {
		return computed{}, err
	}
	cands, placeholder, err := s.gatherProfile(ctx, q, staffID, roleType, per)
	if err != nil {
		return computed{}, err
	}
	comps, profile, ok := scoreProfile(weights, cands)
	mod, err := s.computeModifier(ctx, q, staffID, roleType, per)
	if err != nil {
		return computed{}, err
	}
	c := computed{roleType: roleType, components: comps, modifier: mod, placeholder: placeholder}
	if ok {
		p := profile
		c.profile = &p
	}
	c.final = boundFinal(c.profile, mod)
	return c, nil
}

// ---- monthly batch sweep (M14 §3 / §5.4) ----

// ScanResult tallies one RunSnapshotJob pass.
type ScanResult struct {
	Period        string `json:"period"`
	SnapshotsMade int    `json:"snapshots_made"`
}

// RunScan is the authorised entry point for the sweep endpoint. Gate = Director
// only (the sweep spans every division; decision point 5).
func (s *Service) RunScan(ctx context.Context, actor permission.Actor, now time.Time) (ScanResult, error) {
	if !canRunScan(actor) {
		return ScanResult{}, ErrScanForbidden
	}
	return s.RunSnapshotJob(ctx, now)
}

// RunSnapshotJob is the monthly batch (§5.4): it scores every scored staff member
// for the most-recently CLOSED calendar month and writes one immutable snapshot
// each. Idempotent (UNIQUE (staff_id, period_start) + re-check), so it is safe to
// re-run — exactly like the M13 fire-once sweep. Only staff whose CDPS role maps to
// a KPI Profile role type (Creative/Ads/KOL/AM, staff level) are scored; a division
// without a profile (Sales/Finance/Marketing) or a lead is skipped (decision points
// 1 & 6).
func (s *Service) RunSnapshotJob(ctx context.Context, now time.Time) (ScanResult, error) {
	per := closedMonthPeriod(now)
	res := ScanResult{Period: per.id}

	rows, err := s.DB.QueryContext(ctx,
		`SELECT e.employee_id, rm.division, rm.level
		   FROM employees e
		   JOIN role_mappings rm ON rm.divisi = e.divisi AND rm.jabatan = e.jabatan
		  WHERE e.status_aktif = 1`)
	if err != nil {
		return res, err
	}
	type staffRow struct {
		id       string
		division string
		level    string
	}
	var staff []staffRow
	for rows.Next() {
		var sr staffRow
		if err := rows.Scan(&sr.id, &sr.division, &sr.level); err != nil {
			rows.Close()
			return res, err
		}
		staff = append(staff, sr)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return res, err
	}
	rows.Close()

	for _, sr := range staff {
		roleType, ok := roleTypeFor(sr.division, sr.level)
		if !ok {
			continue // no KPI Profile for this division/level (decision point 6)
		}
		made, err := s.fireSnapshot(ctx, sr.id, roleType, per)
		if err != nil {
			return res, err
		}
		if made {
			res.SnapshotsMade++
		}
	}
	return res, nil
}

// roleTypeFor maps a staff member's CDPS division + level to a Module 14 role type.
// v1 scores STAFF level only (decision point 1 — Rule 7 separates leaders; PRD "per
// staff"). Leads and profile-less divisions return ok=false.
func roleTypeFor(division, level string) (string, bool) {
	if level != permission.LevelStaff {
		return "", false
	}
	switch division {
	case CreativeDivision:
		return RoleCreative, true
	case AdsDivision:
		return RoleAds, true
	case KOLDivision:
		return RoleKOL, true
	case AccountDivision:
		return RoleAM, true
	}
	return "", false
}

// fireSnapshot scores one staff member and inserts an immutable snapshot if none
// exists yet (fire-once). The EvPerformancePublished emission (Flow 6) happens in
// the SAME transaction as the insert, so it is naturally fire-once — a re-run finds
// the snapshot already there and does nothing.
func (s *Service) fireSnapshot(ctx context.Context, staffID, roleType string, per period) (made bool, err error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	// Serialise per-staff snapshot creation.
	var lockID string
	if err := tx.QueryRowContext(ctx,
		`SELECT employee_id FROM employees WHERE employee_id = ? FOR UPDATE`, staffID).Scan(&lockID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}

	var existing string
	err = tx.QueryRowContext(ctx,
		`SELECT id FROM performance_snapshots WHERE staff_id = ? AND period_start = ?`,
		staffID, per.startDate).Scan(&existing)
	if err == nil {
		return false, nil // already snapshotted — idempotent no-op
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return false, err
	}

	c, err := s.computeFor(ctx, tx, staffID, roleType, per)
	if err != nil {
		return false, err
	}
	payload := storedPayload{Components: c.components, Modifier: c.modifier, TargetsPlaceholder: c.placeholder}
	compJSON, err := json.Marshal(payload)
	if err != nil {
		return false, err
	}

	id, err := ident.Next(ctx, tx, perfPrefix, per.start)
	if err != nil {
		return false, err
	}

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO performance_snapshots
		   (id, staff_id, role_type, period_start, period_end, profile_score, modifier_value, final_score, components_json, computed_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'system')`,
		id, staffID, roleType, per.startDate, per.endDate,
		nullableFloat(c.profile), c.modifier.Value, nullableFloat(c.final), compJSON); err != nil {
		return false, err
	}

	// EvPerformancePublished (Flow 6 / catalog FROZEN): notify the staff member.
	// Fire-once by construction (one insert). Resolver = explicit (recipient = the
	// scored staff).
	if s.Catalog != nil {
		if _, err := s.Catalog.Emit(ctx, tx, notification.Emission{
			Event:              notification.EvPerformancePublished,
			EntityType:         "performance_snapshot",
			EntityID:           id,
			Actor:              "system",
			ExplicitRecipients: []string{staffID},
		}); err != nil {
			return false, err
		}
	}

	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

// ---- reads (Rule 7 visibility, Rule 8 full breakdown) ----

// GetSnapshot returns one stored snapshot for a staff member. periodID ("YYYYMM")
// picks a month; empty picks the latest. Visibility gated (Rule 7). ErrNotFound when
// the staff is invisible/absent or has no snapshot for the period.
func (s *Service) GetSnapshot(ctx context.Context, actor permission.Actor, staffID, periodID string) (Snapshot, error) {
	if !canScope(actor) {
		return Snapshot{}, ErrForbidden
	}
	q := `SELECT id, staff_id, role_type, period_start, period_end, profile_score, modifier_value, final_score, components_json, computed_at, computed_by
	        FROM performance_snapshots WHERE staff_id = ?`
	args := []any{staffID}
	if periodID != "" {
		q += ` AND DATE_FORMAT(period_start, '%Y%m') = ?`
		args = append(args, periodID)
	}
	q += ` ORDER BY period_start DESC LIMIT 1`
	snap, err := scanSnapshot(s.DB.QueryRowContext(ctx, q, args...))
	if errors.Is(err, sql.ErrNoRows) {
		return Snapshot{}, ErrNotFound
	}
	if err != nil {
		return Snapshot{}, err
	}
	if !canView(actor, snap.StaffID, snap.RoleType) {
		return Snapshot{}, ErrNotFound
	}
	return snap, nil
}

// Trend returns every stored snapshot for a staff member, oldest first. Visibility
// gated (Rule 7).
func (s *Service) Trend(ctx context.Context, actor permission.Actor, staffID string) ([]Snapshot, error) {
	if !canScope(actor) {
		return nil, ErrForbidden
	}
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, staff_id, role_type, period_start, period_end, profile_score, modifier_value, final_score, components_json, computed_at, computed_by
		   FROM performance_snapshots WHERE staff_id = ? ORDER BY period_start ASC`, staffID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Snapshot{}
	var visible bool
	var checked bool
	for rows.Next() {
		snap, err := scanSnapshot(rows)
		if err != nil {
			return nil, err
		}
		if !checked {
			visible = canView(actor, snap.StaffID, snap.RoleType)
			checked = true
		}
		if !visible {
			return nil, ErrNotFound
		}
		out = append(out, snap)
	}
	return out, rows.Err()
}

// TeamRow is one member's line in the team rollup.
type TeamRow struct {
	StaffID      string   `json:"staff_id"`
	RoleType     string   `json:"role_type"`
	FinalScore   *float64 `json:"final_score"`
	ScoreDisplay string   `json:"score_display"`
}

// TeamRollup is the team view (§2 Rule 5 / OA-8): the members' snapshots for a
// period plus the simple average of their final scores — DERIVED ON READ, never
// stored. `division` selects the team (Creative/Ads/KOL/Account); OD/Director may
// view any team, a lead only their own. periodID empty = the latest period present.
type TeamRollup struct {
	Division       string    `json:"division"`
	Period         string    `json:"period"`
	Members        []TeamRow `json:"members"`
	TeamAverage    *float64  `json:"team_average"`
	AverageDisplay string    `json:"average_display"` // "—" when no member has a score
}

// TeamRollup returns the simple-average team view for a division + period.
func (s *Service) TeamRollup(ctx context.Context, actor permission.Actor, division, periodID string) (TeamRollup, error) {
	if !canViewTeam(actor, division) {
		return TeamRollup{}, ErrForbidden
	}
	roleType := roleTypeOfDivision(division)
	if roleType == "" {
		return TeamRollup{}, ErrNotFound
	}
	// Resolve the period: latest present when unspecified.
	if periodID == "" {
		if err := s.DB.QueryRowContext(ctx,
			`SELECT DATE_FORMAT(MAX(period_start), '%Y%m') FROM performance_snapshots WHERE role_type = ?`,
			roleType).Scan(&sqlNullPeriod{&periodID}); err != nil {
			return TeamRollup{}, err
		}
	}
	out := TeamRollup{Division: division, Period: periodID}
	if periodID == "" {
		out.AverageDisplay = "—"
		out.Members = []TeamRow{}
		return out, nil
	}
	rows, err := s.DB.QueryContext(ctx,
		`SELECT staff_id, role_type, final_score
		   FROM performance_snapshots
		  WHERE role_type = ? AND DATE_FORMAT(period_start, '%Y%m') = ?
		  ORDER BY staff_id`, roleType, periodID)
	if err != nil {
		return TeamRollup{}, err
	}
	defer rows.Close()
	var sum float64
	var scored int
	out.Members = []TeamRow{}
	for rows.Next() {
		var r TeamRow
		var final sql.NullFloat64
		if err := rows.Scan(&r.StaffID, &r.RoleType, &final); err != nil {
			return TeamRollup{}, err
		}
		if final.Valid {
			f := final.Float64
			r.FinalScore = &f
			sum += f
			scored++
		}
		r.ScoreDisplay = scoreDisplay(r.FinalScore)
		out.Members = append(out.Members, r)
	}
	if err := rows.Err(); err != nil {
		return TeamRollup{}, err
	}
	if scored > 0 {
		avg := sum / float64(scored)
		out.TeamAverage = &avg
	}
	out.AverageDisplay = scoreDisplay(out.TeamAverage)
	return out, nil
}

// canViewTeam authorises a team rollup for a division (Rule 7): OD/Director any
// team; a lead only their own division.
func canViewTeam(a permission.Actor, division string) bool {
	if a.Role.Director || a.Role.OD {
		return true
	}
	return a.Role.Level == permission.LevelLead && a.Role.Division == division
}

// roleTypeOfDivision maps a division to the single role type scored within it. The
// Account division's staff are scored as AM.
func roleTypeOfDivision(division string) string {
	switch division {
	case CreativeDivision:
		return RoleCreative
	case AdsDivision:
		return RoleAds
	case KOLDivision:
		return RoleKOL
	case AccountDivision:
		return RoleAM
	}
	return ""
}

// scanSnapshot reads one persisted row (components_json → payload).
func scanSnapshot(sc interface{ Scan(...any) error }) (Snapshot, error) {
	var s Snapshot
	var profile, final sql.NullFloat64
	var modifierValue float64
	var compJSON []byte
	var start, end time.Time
	if err := sc.Scan(&s.ID, &s.StaffID, &s.RoleType, &start, &end, &profile, &modifierValue, &final, &compJSON, &s.ComputedAt, &s.ComputedBy); err != nil {
		return Snapshot{}, err
	}
	s.PeriodStart = start.Format("2006-01-02")
	s.PeriodEnd = end.Format("2006-01-02")
	if profile.Valid {
		p := profile.Float64
		s.ProfileScore = &p
	}
	if final.Valid {
		f := final.Float64
		s.FinalScore = &f
	}
	s.ScoreDisplay = scoreDisplay(s.FinalScore)
	if len(compJSON) > 0 {
		var payload storedPayload
		if err := json.Unmarshal(compJSON, &payload); err != nil {
			return Snapshot{}, err
		}
		s.Components = payload.Components
		s.Modifier = payload.Modifier
		s.TargetsPlaceholder = payload.TargetsPlaceholder
	}
	if s.Components == nil {
		s.Components = []Component{}
	}
	return s, nil
}

// nullableFloat renders a *float64 as a driver arg (nil → SQL NULL).
func nullableFloat(v *float64) any {
	if v == nil {
		return nil
	}
	return *v
}

// sqlNullPeriod scans a possibly-NULL DATE_FORMAT result into a string (NULL → "").
type sqlNullPeriod struct{ dst *string }

func (p *sqlNullPeriod) Scan(v any) error {
	switch t := v.(type) {
	case nil:
		*p.dst = ""
	case string:
		*p.dst = t
	case []byte:
		*p.dst = string(t)
	}
	return nil
}
