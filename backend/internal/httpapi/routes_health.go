package httpapi

import "net/http"

// registerHealthRoutes wires the Module 13 (Client Health Report) HTTP routes:
// the monthly snapshot sweep (POST /health/snapshots/scan), the per-Client
// snapshot / trend / live-preview reads, and the ROAS Inclusion Toggle (Rule 13).
//
// Per-Client reads hang off "/api/v1/clients/{id}/health/..." (the client is the
// entity, CHR- → CLI); the sweep is the cross-client batch under a top-level
// /health surface, mirroring the finance & creative reminder-scan endpoints.
func (a *App) registerHealthRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/health/snapshots/scan", a.protect(a.handleRunHealthScan))
	mux.HandleFunc("GET /api/v1/clients/{id}/health", a.protect(a.handleGetHealth))
	mux.HandleFunc("GET /api/v1/clients/{id}/health/trend", a.protect(a.handleHealthTrend))
	mux.HandleFunc("GET /api/v1/clients/{id}/health/preview", a.protect(a.handleHealthPreview))
	mux.HandleFunc("GET /api/v1/clients/{id}/health/roas-toggle", a.protect(a.handleGetROASToggle))
	mux.HandleFunc("PUT /api/v1/clients/{id}/health/roas-toggle", a.protect(a.handleSetROASToggle))
}
