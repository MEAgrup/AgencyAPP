package httpapi

import (
	"errors"
	"net/http"

	"github.com/meagrup/agencyapp/backend/internal/module2_marketing"
	"github.com/meagrup/agencyapp/backend/internal/module3_campaign"
)

// marketingSvc builds the Module 2 (Marketing) service. It reuses the Module 3 Campaign
// service (same DB/Engine) for the Campaign existence + §5 visibility gate and the 1:1
// Online/Offline read. Module 2 emits NOTHING (the FROZEN catalog has no M2 event).
func (a *App) marketingSvc() *module2_marketing.Service {
	return &module2_marketing.Service{
		DB:       a.DB,
		Campaign: &module3_campaign.Service{DB: a.DB, Engine: a.Engine, Catalog: a.Catalog},
	}
}

// ---- Performance record inputs (M2 §3) ----
//
// NOTE ON PATH PREFIX: these routes live under "/api/v1/marketing/campaigns/{id}/..."
// to sit alongside the acquisition Campaign (CMP-) surface (routes_campaign.go), which is
// itself namespaced under /marketing to avoid the Module 8 Ad-Campaign route collision.

type budgetBody struct {
	Budget string `json:"budget"`
}

// handleCreatePerformanceRecord: POST /api/v1/marketing/campaigns/{id}/performance.
func (a *App) handleCreatePerformanceRecord(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b budgetBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	rec, err := a.marketingSvc().CreateRecord(r.Context(), actor, r.PathValue("id"), b.Budget)
	if err != nil {
		writeMarketingErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

// handleUpdatePerformanceBudget: POST/PATCH /api/v1/marketing/campaigns/{id}/performance/budget.
func (a *App) handleUpdatePerformanceBudget(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b budgetBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	rec, err := a.marketingSvc().UpdateBudget(r.Context(), actor, r.PathValue("id"), b.Budget)
	if err != nil {
		writeMarketingErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

// handleGetPerformance: GET /api/v1/marketing/campaigns/{id}/performance — the record plus
// its read-only Auto-Metrics (M2 §4). Returns {record, metrics}.
func (a *App) handleGetPerformance(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	svc := a.marketingSvc()
	id := r.PathValue("id")
	rec, err := svc.GetRecord(r.Context(), actor, id)
	if err != nil {
		writeMarketingErr(w, err)
		return
	}
	metrics, err := svc.Metrics(r.Context(), actor, id)
	if err != nil {
		writeMarketingErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"record": rec, "metrics": metrics})
}

// handlePerformanceDashboard: GET /api/v1/marketing/performance-dashboard — the Lead/Staff
// dashboard split (M2 §5). Staff sees own campaigns; lead/OD/Director sees all.
func (a *App) handlePerformanceDashboard(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	list, err := a.marketingSvc().Dashboard(r.Context(), actor)
	if err != nil {
		writeMarketingErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": list})
}

// writeMarketingErr maps M2 sentinels to HTTP status + their verbatim BI message, following
// the campaign_handlers.go convention (forbidden->403, not-found->404, validation->422,
// duplicate->409).
func writeMarketingErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, module2_marketing.ErrForbidden):
		writeErr(w, http.StatusForbidden, err.Error())
	case errors.Is(err, module2_marketing.ErrNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, module2_marketing.ErrIncomplete):
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, module2_marketing.ErrDuplicate):
		writeErr(w, http.StatusConflict, err.Error())
	default:
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
	}
}
