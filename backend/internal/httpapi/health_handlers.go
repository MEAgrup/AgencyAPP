package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/module13_health"
)

// healthSvc builds the Module 13 (Client Health Report) service. The FROZEN
// catalog backs the EvClientBandDrop emission (Rule 12) fired inside the snapshot
// transaction; handlers never emit directly.
func (a *App) healthSvc() *module13_health.Service {
	return &module13_health.Service{DB: a.DB, Catalog: a.Catalog}
}

// handleRunHealthScan: POST /api/v1/health/snapshots/scan — the monthly snapshot
// sweep (Account any level / Director, mirrors finance & creative scan gates).
func (a *App) handleRunHealthScan(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.healthSvc().RunScan(r.Context(), actor, time.Now())
	if err != nil {
		writeHealthErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// handleGetHealth: GET /api/v1/clients/{id}/health[?period=YYYYMM] — one stored
// snapshot (latest, or the given period).
func (a *App) handleGetHealth(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	snap, err := a.healthSvc().GetSnapshot(r.Context(), actor, r.PathValue("id"), r.URL.Query().Get("period"))
	if err != nil {
		writeHealthErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, snap)
}

// handleHealthTrend: GET /api/v1/clients/{id}/health/trend — all stored snapshots
// for the Client, oldest first (Rule 9).
func (a *App) handleHealthTrend(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	list, err := a.healthSvc().Trend(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeHealthErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": list})
}

// handleHealthPreview: GET /api/v1/clients/{id}/health/preview — the read-only,
// never-stored live preview of the current month (Rule 10).
func (a *App) handleHealthPreview(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	snap, err := a.healthSvc().Preview(r.Context(), actor, r.PathValue("id"), time.Now())
	if err != nil {
		writeHealthErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, snap)
}

// handleGetROASToggle: GET /api/v1/clients/{id}/health/roas-toggle.
func (a *App) handleGetROASToggle(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	tg, err := a.healthSvc().GetROASToggle(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeHealthErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, tg)
}

type roasToggleBody struct {
	// Override: true/false sets an explicit toggle; null (omitted) clears it back
	// to the default (Rule 13 / §5.4).
	Override *bool `json:"override"`
}

// handleSetROASToggle: PUT /api/v1/clients/{id}/health/roas-toggle.
func (a *App) handleSetROASToggle(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b roasToggleBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	tg, err := a.healthSvc().SetROASToggle(r.Context(), actor, r.PathValue("id"), b.Override)
	if err != nil {
		writeHealthErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, tg)
}

// writeHealthErr maps M13 sentinels to HTTP status + their verbatim BI message,
// following the module handler-error convention (forbidden->403, not-found->404).
func writeHealthErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, module13_health.ErrForbidden),
		errors.Is(err, module13_health.ErrScanForbidden):
		writeErr(w, http.StatusForbidden, err.Error())
	case errors.Is(err, module13_health.ErrNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	default:
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
	}
}
