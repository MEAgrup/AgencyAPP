package httpapi

import (
	"net/http"

	"github.com/meagrup/agencyapp/backend/internal/module0_sales"
)

// handleListAttempts serves the scoped attempt list (contract §1).
func (a *App) handleListAttempts(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	rows, err := a.salesSvc().ListAttempts(r.Context(), actor, r.URL.Query().Get("status"))
	if err != nil {
		a.writeDomainErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": rows})
}

// handleGetAttempt serves the full attempt detail (contract §2).
func (a *App) handleGetAttempt(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	d, err := a.salesSvc().GetAttempt(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		a.writeDomainErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

// handleMarkLost closes an attempt as Closed-Lost (contract §6).
func (a *App) handleMarkLost(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	if err := a.salesSvc().MarkLost(r.Context(), actor, r.PathValue("id")); err != nil {
		a.writeDomainErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": module0_sales.StatusClosedLost})
}

// handleListPool serves the Sales Pool board (contract §3).
func (a *App) handleListPool(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	rows, err := a.leadsSvc().ListPool(r.Context(), actor)
	if err != nil {
		a.writeDomainErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": rows})
}

// handleListLeads serves the scoped Leads Database (contract §4).
func (a *App) handleListLeads(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	q := r.URL.Query()
	rows, err := a.leadsSvc().ListLeads(r.Context(), actor, q.Get("status"), q.Get("q"))
	if err != nil {
		a.writeDomainErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": rows})
}

// handleGetLead serves a lead + its attempt contest (contract §5).
func (a *App) handleGetLead(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	d, err := a.leadsSvc().GetLead(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		a.writeDomainErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}
