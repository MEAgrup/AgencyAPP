package httpapi

import "net/http"

// registerPerfRoutes wires the Module 14 (Team Performance) HTTP routes: the
// monthly snapshot sweep (POST /performance/snapshots/scan, Director only), the
// per-staff snapshot / trend reads (visibility Rule 7), the team rollup, and the
// admin KPI-config surfaces (weights + period targets, Director only).
//
// Per-staff reads hang off "/api/v1/staff/{id}/performance/..." (the staff member
// is the entity, PERF- → User); the sweep + team + config are cross-staff surfaces
// under a top-level /performance, mirroring the M13 /health layout.
func (a *App) registerPerfRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/performance/snapshots/scan", a.protect(a.handleRunPerfScan))
	mux.HandleFunc("GET /api/v1/staff/{id}/performance", a.protect(a.handleGetPerf))
	mux.HandleFunc("GET /api/v1/staff/{id}/performance/trend", a.protect(a.handlePerfTrend))
	mux.HandleFunc("GET /api/v1/performance/teams/{division}", a.protect(a.handlePerfTeam))
	mux.HandleFunc("GET /api/v1/performance/config/weights", a.protect(a.handleListPerfWeights))
	mux.HandleFunc("PUT /api/v1/performance/config/weights", a.protect(a.handleSetPerfWeights))
	mux.HandleFunc("GET /api/v1/performance/config/targets", a.protect(a.handleListPerfTargets))
	mux.HandleFunc("PUT /api/v1/performance/config/targets", a.protect(a.handleSetPerfTarget))
}
