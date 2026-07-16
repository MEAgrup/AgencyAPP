package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/admin"
	"github.com/meagrup/agencyapp/backend/internal/core/tz"
)

func (a *App) handleListMasterServices(w http.ResponseWriter, r *http.Request) {
	date := r.URL.Query().Get("effective_at")
	if date == "" {
		date = tz.BusinessDate(time.Now()).Format("2006-01-02") // WIB default (DECISIONS O20)
	}
	rows, err := admin.ListEffectiveAt(r.Context(), a.DB, date)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": rows})
}

type masterServiceBody struct {
	Name           string `json:"name"`
	StandardPrice  string `json:"standard_price"`
	CommissionRule string `json:"commission_rule"`
	Category       string `json:"category"`
	Unit           string `json:"unit"`
	MinQty         string `json:"min_qty"`
	PricingMode    string `json:"pricing_mode"`
	ApplyPPN       bool   `json:"apply_ppn"`
	Frequency      string `json:"frequency"`
	PriceNote      string `json:"price_note"`
	Description    string `json:"description"`
	Active         bool   `json:"active"`
	EffectiveFrom  string `json:"effective_from"`
}

func (b masterServiceBody) input() admin.ServiceInput {
	return admin.ServiceInput{
		Name: b.Name, StandardPrice: b.StandardPrice, CommissionRule: b.CommissionRule,
		Category: b.Category, Unit: b.Unit, MinQty: b.MinQty, PricingMode: b.PricingMode,
		ApplyPPN: b.ApplyPPN, Frequency: b.Frequency, PriceNote: b.PriceNote, Description: b.Description,
		Active: b.Active, EffectiveFrom: b.EffectiveFrom,
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
