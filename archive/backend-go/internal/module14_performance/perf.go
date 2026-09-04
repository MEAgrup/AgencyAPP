// Package module14_performance is Module 14 (Team Performance). Like Module 13 it
// is a pure AGGREGATION and scoring layer (M14 §2 Rule 1): it invents NO new raw
// KPI, only a per-staff, per-role, per-month weighted 0..100 rollup of KPIs that
// already live in Modules 7 (Output Quantity / GMV Impact), 8 (ROAS / GMV Impact /
// Optimization Activity), 9 (Creator Count / QC Pass Rate / Escalation), 12 (Speed
// Score / Revision Count) and 13 (Client Health Score), plus a small cross-division
// Client-Outcome Modifier drawn from Module 13 snapshots (§2 Rule 3).
//
// The month boundary produces one immutable snapshot per scored staff member
// (PERF-, §5.1). Everything a snapshot persists is recomputable from the immutable
// event/timestamp logs of the source modules (house rule 4).
//
// Files:
//   - perf.go       — this file: role types, component keys, Service, sentinels, visibility.
//   - profile.go    — the PURE KPI-Profile scoring core (transforms, redistribution,
//     modifier, bounding), no DB dependency, exhaustively unit-testable.
//   - config.go     — KPI Profile weights + period targets (admin-configurable, OA-5/O9).
//   - compute.go    — gathers the per-role raw KPI inputs from the source modules.
//   - modifier.go   — the Client-Outcome Modifier from Module 13 CHR- snapshots (§5.3).
//   - snapshot.go   — the monthly batch sweep, get / list / team rollup, EvPerformancePublished.
package module14_performance

import (
	"context"
	"database/sql"
	"errors"

	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// Role types (M14 §5.1 enum). A staff member's role type is derived from their
// CDPS division (role_mappings), staff-level only in v1 (decision point 1). The
// string values double as the perf_kpi_weights.role_type key and the snapshot
// role_type column.
const (
	RoleCreative = "Creative"
	RoleAds      = "Ads"
	RoleKOL      = "KOL"
	RoleAM       = "AM"
)

// CDPS division constants (the real batch-1 role-mapping values, DECISIONS
// 2026-07-17 "Role mapping riil batch-1"): Creative / Ads / KOL / Account.
const (
	CreativeDivision = "Creative"
	AdsDivision      = "Ads"
	KOLDivision      = "KOL"
	AccountDivision  = "Account"
)

// Component keys (M14 §2 Rule 2). Stable string keys — persisted in
// perf_kpi_weights, perf_period_targets and components_json, and surfaced in the
// API, so they never change.
const (
	CompSpeedScore               = "speed_score"                // M12, transform OA-1
	CompOutputQuantity           = "output_quantity"            // M7 approved assets / period, normalized OA-2
	CompGMVImpact                = "gmv_impact"                 // M7§7 / M8§7, normalized OA-2
	CompRevisionCount            = "revision_count"             // M12 inverse
	CompROASAttainment           = "roas_attainment"            // M8, own managed campaigns
	CompOptimizationActivity     = "optimization_activity"      // M8, normalized OA-2
	CompCreatorCount             = "creator_count"              // M9 QC-passed bookings / period, normalized OA-2
	CompQCPassRate               = "qc_pass_rate"               // M9
	CompEscalationRate           = "escalation_rate"            // M9 inverse
	CompCHRAverage               = "chr_average"                // M13 portfolio avg (AM, §8/OA-6)
	CompComplaintResolutionSpeed = "complaint_resolution_speed" // M6, speed transform OA-1 vs SLA target
	CompRevisionEscalationRate   = "revision_escalation_rate"   // M6/M12 inverse (AM)

	// Diagnostic (reported, NEVER weighted — §2 Rule 2 KOL row): KOL Sourcing
	// Turnaround is shown on the staff's own breakdown but carries no weight
	// because it is largely already reflected inside the combined Speed Score.
	CompSourcingTurnaround = "sourcing_turnaround"
)

// modifierComponent maps a role type to the Module 13 Health-Score sub-component
// its Client-Outcome Modifier draws from (M14 §5.3 / OA-4): Creative ->
// Revision Burden, Ads -> ROAS Attainment, KOL -> Task Completion. AM has no
// modifier (Rule 3 — "for Creative/Ads/KOL roles").
//
// The values are the Module 13 components_json component keys (module13_health
// CompRevisionBurden / CompROASAttainment / CompTaskCompletion) — referenced as
// literals here to avoid a compile dependency cycle and because they are frozen
// persisted keys (module13_health §5.6).
var modifierComponent = map[string]string{
	RoleCreative: "revision_burden",
	RoleAds:      "roas_attainment",
	RoleKOL:      "task_completion",
}

// Service is the Module 14 persistence + scoring surface. Catalog is optional:
// when nil the EvPerformancePublished emission (Flow 6) is a no-op — mirroring the
// nil-guard used by module13_health.Service so the pure scoring paths are
// unit-testable without the notification wiring.
type Service struct {
	DB      *sql.DB
	Catalog *notification.Catalog
}

// Sentinel errors surfaced to the HTTP layer. They reuse the shared house BI
// strings (CLAUDE.md §5); the two genuinely new strings are the scan- and
// config-authorisation messages (W1-09 / W3-M13-C1 precedent), proposed for
// orchestrator sign-off — see ErrScanForbidden / ErrConfigForbidden.
var (
	// ErrForbidden: the actor has no M14 read scope at all (e.g. a Sales staffer).
	// Reuses the shared access-denied string.
	ErrForbidden = errors.New("[anda tidak memiliki akses ke data ini]")
	// ErrNotFound: the snapshot / staff does not exist OR is not visible to the
	// actor — invisible-but-existing is reported as not-found (same pattern as M13).
	ErrNotFound = errors.New("[data tidak ditemukan]")
	// ErrScanForbidden: the actor may not trigger the monthly snapshot sweep. NEW
	// BI string (W1-09 precedent, mirrors module13_health.ErrScanForbidden).
	ErrScanForbidden = errors.New("[anda tidak memiliki akses untuk menjalankan pemindaian skor performa tim]")
	// ErrConfigForbidden: the actor may not edit KPI weights / period targets. NEW
	// BI string. Gate = Director only (§5.2 "Yohan/HR"; decision point 5).
	ErrConfigForbidden = errors.New("[anda tidak memiliki akses untuk mengubah konfigurasi KPI performa]")
	// ErrWeightsNotHundred: an admin weight write whose Σ per role_type != 100
	// (§5.2 / OA-5 server-side validation).
	ErrWeightsNotHundred = errors.New("[total bobot KPI harus berjumlah 100]")
	// ErrBadRoleType: an unknown role_type in a config write. Reuses the shared
	// generic validation string (W3-M3-C1 precedent: no entity-specific wording
	// when the PRD does not demand one).
	ErrBadRoleType = errors.New("[format data tidak valid]")
)

// ---- visibility (M14 §2 Rule 7) ----
//
// staff see their OWN score; Team Leader/SPV see their full team (division-wide);
// OD read-only everywhere; Director full. A scored staff's team = the division its
// role type belongs to (divisionOfRole).

// divisionOfRole maps a role type back to the CDPS division whose lead/SPV may see
// that staff's scores (Rule 7). AM belongs to the Account division.
func divisionOfRole(roleType string) string {
	if roleType == RoleAM {
		return AccountDivision
	}
	return roleType // Creative / Ads / KOL are 1:1 with their division
}

// canView reports whether actor may see a snapshot for staffID in roleType
// (Rule 7). ownStaff is the snapshot subject.
func canView(actor permission.Actor, staffID, roleType string) bool {
	if actor.Role.Director || actor.Role.OD { // Director full; OD read-only everywhere
		return true
	}
	if actor.EmployeeID == staffID { // staff: own score
		return true
	}
	// Lead/SPV: full team = own division (division-wide).
	return actor.Role.Level == permission.LevelLead && actor.Role.Division == divisionOfRole(roleType)
}

// canScope reports whether the actor has ANY M14 read scope. Everyone with a CDPS
// division has at least their own score; OD/Director see everyone. A completely
// unmapped actor (no division, not layered) has none.
func canScope(actor permission.Actor) bool {
	if actor.Role.Director || actor.Role.OD {
		return true
	}
	return actor.Role.Division != "" || actor.EmployeeID != ""
}

// canRunScan authorises the on-demand snapshot sweep (Flow 1). The sweep spans ALL
// divisions (it scores every staff), so unlike the division-owned M13/M5/M7 scans
// it is a management action: Director only (decision point 5). OD is read-only.
func canRunScan(a permission.Actor) bool {
	return a.Role.Director
}

// canManageConfig authorises editing KPI weights + period targets (§5.2 "Yohan/HR
// can retune weights"; decision point 5). Director only — the KPI Profile is a
// cross-division management artefact, not a single division's to own (contrast the
// Master Service List, which Sales Head owns). OD is read-only.
func canManageConfig(a permission.Actor) bool {
	return a.Role.Director
}

// rowQuerier is satisfied by *sql.DB and *sql.Tx — the gather + read helpers work
// against either, so the live preview (on *sql.DB) and the batch sweep (inside a
// *sql.Tx) share one code path (mirrors module13_health.rowQuerier).
type rowQuerier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}
