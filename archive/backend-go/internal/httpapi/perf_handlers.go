package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/module14_performance"
)

// perfSvc builds the Module 14 (Team Performance) service. The FROZEN catalog backs
// the EvPerformancePublished emission (Flow 6) fired inside the snapshot
// transaction; handlers never emit directly.
func (a *App) perfSvc() *module14_performance.Service {
	return &module14_performance.Service{DB: a.DB, Catalog: a.Catalog}
}

// handleRunPerfScan: POST /api/v1/performance/snapshots/scan — the monthly sweep
// (Director only; the sweep spans every division).
func (a *App) handleRunPerfScan(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.perfSvc().RunScan(r.Context(), actor, time.Now())
	if err != nil {
		writePerfErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// handleGetPerf: GET /api/v1/staff/{id}/performance[?period=YYYYMM] — one stored
// snapshot (latest, or the given period), with the full breakdown (Rule 8).
func (a *App) handleGetPerf(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	snap, err := a.perfSvc().GetSnapshot(r.Context(), actor, r.PathValue("id"), r.URL.Query().Get("period"))
	if err != nil {
		writePerfErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, snap)
}

// handlePerfTrend: GET /api/v1/staff/{id}/performance/trend — all stored snapshots
// for the staff member, oldest first.
func (a *App) handlePerfTrend(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	list, err := a.perfSvc().Trend(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writePerfErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": list})
}

// handlePerfTeam: GET /api/v1/performance/teams/{division}[?period=YYYYMM] — the
// team rollup (simple average, derived on read).
func (a *App) handlePerfTeam(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	roll, err := a.perfSvc().TeamRollup(r.Context(), actor, r.PathValue("division"), r.URL.Query().Get("period"))
	if err != nil {
		writePerfErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, roll)
}

// handleListPerfWeights: GET /api/v1/performance/config/weights.
func (a *App) handleListPerfWeights(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	list, err := a.perfSvc().ListWeights(r.Context(), actor)
	if err != nil {
		writePerfErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": list})
}

type perfWeightsBody struct {
	RoleType string             `json:"role_type"`
	Weights  map[string]float64 `json:"weights"`
}

// handleSetPerfWeights: PUT /api/v1/performance/config/weights — replace one role's
// weight set (Σ=100 validated; Director only).
func (a *App) handleSetPerfWeights(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b perfWeightsBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	if err := a.perfSvc().SetWeights(r.Context(), actor, b.RoleType, b.Weights); err != nil {
		writePerfErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleListPerfTargets: GET /api/v1/performance/config/targets.
func (a *App) handleListPerfTargets(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	list, err := a.perfSvc().ListTargets(r.Context(), actor)
	if err != nil {
		writePerfErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": list})
}

type perfTargetBody struct {
	RoleType      string  `json:"role_type"`
	Component     string  `json:"component"`
	PeriodStart   string  `json:"period_start"`
	TargetValue   float64 `json:"target_value"`
	IsPlaceholder bool    `json:"is_placeholder"`
}

// handleSetPerfTarget: PUT /api/v1/performance/config/targets — upsert one period
// target (Director only). Entering a real target sets is_placeholder=false (O9).
func (a *App) handleSetPerfTarget(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b perfTargetBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	err := a.perfSvc().SetTarget(r.Context(), actor, module14_performance.PeriodTarget{
		RoleType: b.RoleType, Component: b.Component, PeriodStart: b.PeriodStart,
		TargetValue: b.TargetValue, IsPlaceholder: b.IsPlaceholder,
	})
	if err != nil {
		writePerfErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// writePerfErr maps M14 sentinels to HTTP status + their verbatim BI message.
func writePerfErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, module14_performance.ErrForbidden),
		errors.Is(err, module14_performance.ErrScanForbidden),
		errors.Is(err, module14_performance.ErrConfigForbidden):
		writeErr(w, http.StatusForbidden, err.Error())
	case errors.Is(err, module14_performance.ErrNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, module14_performance.ErrWeightsNotHundred),
		errors.Is(err, module14_performance.ErrBadRoleType):
		writeErr(w, http.StatusBadRequest, err.Error())
	default:
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
	}
}
