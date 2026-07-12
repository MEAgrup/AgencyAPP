package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/admin"
)

func (a *App) handleListMasterServices(w http.ResponseWriter, r *http.Request) {
	date := r.URL.Query().Get("effective_at")
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}
	rows, err := admin.ListEffectiveAt(r.Context(), a.DB, date)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": rows})
}

type masterServiceBody struct {
	Name                 string `json:"name"`
	StandardPrice        string `json:"standard_price"`
	CommissionRule       string `json:"commission_rule"`
	Active               bool   `json:"active"`
	RequiresStrategyPlan bool   `json:"requires_strategy_plan"`
	EffectiveFrom        string `json:"effective_from"`
}

func (b masterServiceBody) input() admin.ServiceInput {
	return admin.ServiceInput{
		Name: b.Name, StandardPrice: b.StandardPrice, CommissionRule: b.CommissionRule,
		Active: b.Active, RequiresStrategyPlan: b.RequiresStrategyPlan, EffectiveFrom: b.EffectiveFrom,
	}
}

func writeMasterServiceErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, admin.ErrMasterServiceDenied):
		writeErr(w, http.StatusForbidden, admin.MasterServiceDeniedMessage)
	case errors.Is(err, admin.ErrIncomplete):
		writeErr(w, http.StatusUnprocessableEntity, admin.ErrIncomplete.Error())
	case errors.Is(err, admin.ErrServiceNotFound):
		writeErr(w, http.StatusNotFound, "[master service tidak ditemukan]")
	default:
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
	}
}

func (a *App) handleCreateMasterService(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b masterServiceBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	id, err := admin.CreateService(r.Context(), a.DB, actor, b.input())
	if err != nil {
		writeMasterServiceErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
}

func (a *App) handleUpdateMasterService(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	id := r.PathValue("id")
	var b masterServiceBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	ver, err := admin.UpdateService(r.Context(), a.DB, actor, id, b.input())
	if err != nil {
		writeMasterServiceErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "version_no": ver})
}

func (a *App) handleMasterServiceVersions(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	rows, err := admin.ListVersions(r.Context(), a.DB, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": rows})
}
