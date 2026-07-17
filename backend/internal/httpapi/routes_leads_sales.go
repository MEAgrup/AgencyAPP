package httpapi

import "net/http"

// registerLeadsSalesRoutes wires the M1 (Leads) + M0 (Sales) HTTP routes.
//
// OWNED BY BUILD STREAM A (alur akuisisi → closing). Add every M1/M0 route and
// its handler here (and in sibling *_handlers.go files you create), so Team B's
// router file is never touched. Handlers follow the Sprint 0 pattern: resolve
// the actor via actorFrom(r.Context()), return BI errors with writeErr, JSON
// with writeJSON.
func (a *App) registerLeadsSalesRoutes(mux *http.ServeMux) {
	// M1 — Leads registry (W1-01 registration, W1-03 pool claim).
	mux.HandleFunc("POST /api/v1/leads", a.protect(a.handleRegisterLead))
	mux.HandleFunc("POST /api/v1/leads/bulk", a.protect(a.handleBulkImportLeads))
	mux.HandleFunc("POST /api/v1/leads/{id}/claim", a.protect(a.handleClaimLead))

	// M0 — quote preview (MSL v2 calculator; no persistence).
	mux.HandleFunc("POST /api/v1/sales/quote-preview", a.protect(a.handleQuotePreview))

	// M0 — attempt lifecycle (W1-05..09).
	mux.HandleFunc("POST /api/v1/attempts/{id}/contacted", a.protect(a.handleMarkContacted))
	mux.HandleFunc("POST /api/v1/attempts/{id}/qualify", a.protect(a.handleQualify))
	mux.HandleFunc("POST /api/v1/attempts/{id}/not-qualified", a.protect(a.handleNotQualified))
	mux.HandleFunc("POST /api/v1/attempts/{id}/negotiation", a.protect(a.handleSubmitNegotiation))
	mux.HandleFunc("POST /api/v1/attempts/{id}/negotiation/decision", a.protect(a.handleDecideNegotiation))
	mux.HandleFunc("POST /api/v1/attempts/{id}/negotiation/accept", a.protect(a.handleAcceptCounter))
	mux.HandleFunc("POST /api/v1/attempts/{id}/negotiation/resubmit", a.protect(a.handleResubmitNegotiation))
	mux.HandleFunc("POST /api/v1/attempts/{id}/close", a.protect(a.handleClose))
}
