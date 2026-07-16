package httpapi

import (
	"errors"
	"net/http"

	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module0_sales"
	"github.com/meagrup/agencyapp/backend/internal/module1_leads"
)

// leadsSvc builds the Module 1 service over the app's shared deps. The
// notification catalog is bound so a collaborative Join notifies the other
// active owners (DECISIONS 2026-07-10).
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
	resp := map[string]any{"lead": lead, "attempt": att}
	// Collaborative Join (DECISIONS 2026-07-10): success, but the lead is also
	// worked by other salespeople — surface the informational BI message (not an
	// error) alongside the created attempt.
	if notice != nil {
		resp["joined"] = true
		resp["message"] = notice.Message
		resp["notified_owners"] = notice.NotifiedOwners
	}
	writeJSON(w, http.StatusCreated, resp)
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
