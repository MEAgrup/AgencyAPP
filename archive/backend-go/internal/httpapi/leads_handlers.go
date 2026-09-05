package httpapi

import (
	"errors"
	"net/http"

	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module0_sales"
	"github.com/meagrup/agencyapp/backend/internal/module1_leads"
)

// leadsSvc builds the Module 1 service over the app's shared deps. The
// notification Catalog is injected so a co-pursuit registration (dedup v2) can
// emit the co_pursuit event inside its transaction.
func (a *App) leadsSvc() *module1_leads.Service {
	return &module1_leads.Service{DB: a.DB, Engine: a.Engine, Catalog: a.Catalog}
}

// writeDomainErr maps M0/M1 domain errors to HTTP status + verbatim BI message.
func (a *App) writeDomainErr(w http.ResponseWriter, err error) {
	var re *statemachine.RoleError
	var be *statemachine.BlockedError
	switch {
	case errors.As(err, &re):
		writeErr(w, http.StatusForbidden, re.Message)
	case err.Error() == statemachine.RoleDeniedMessage:
		writeErr(w, http.StatusForbidden, err.Error())
	case errors.As(err, &be):
		writeErr(w, http.StatusConflict, be.Message)
	case errors.Is(err, module0_sales.ErrNotFound),
		errors.Is(err, module1_leads.ErrLeadNotFound):
		writeErr(w, http.StatusNotFound, "[data tidak ditemukan]")
	default:
		msg := err.Error()
		if len(msg) > 0 && msg[0] == '[' {
			writeErr(w, http.StatusBadRequest, msg)
			return
		}
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan]")
	}
}

func (a *App) handleRegisterLead(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var in module1_leads.RegisterInput
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, module0_sales.IncompleteMessage)
		return
	}
	lead, att, notice, err := a.leadsSvc().Register(r.Context(), actor, in)
	if err != nil {
		a.writeDomainErr(w, err)
		return
	}
	body := map[string]any{"lead": lead, "attempt": att}
	if notice != "" {
		body["notice"] = notice
	}
	writeJSON(w, http.StatusCreated, body)
}

// handleBulkImportLeads is the Marketing bulk-import door (M1 §3): a JSON body
// of many registration rows processed with import-door semantics (duplicates
// blocked per-row, incomplete rows rejected, ids minted only for valid rows).
// The response carries the per-row report, the §3 Flow-7 summary line, and the
// rejection list. The write gate lives in the service (Marketing/Director only).
func (a *App) handleBulkImportLeads(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var in struct {
		CampaignID string                  `json:"campaign_id"`
		Rows       []module1_leads.BulkRow `json:"rows"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, module0_sales.IncompleteMessage)
		return
	}
	report, err := a.leadsSvc().BulkImport(r.Context(), actor, in.CampaignID, in.Rows)
	if err != nil {
		a.writeDomainErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"imported":   report.Imported,
		"rejected":   report.Rejected,
		"summary":    report.Summary(),
		"rows":       report.Rows,
		"rejections": report.Rejections(),
	})
}

func (a *App) handleClaimLead(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	att, err := a.leadsSvc().ClaimFromPool(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		a.writeDomainErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"attempt": att})
}
