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
	// Example (uncomment/extend as tickets land):
	//   mux.HandleFunc("POST /api/v1/leads/import", a.protect(a.handleLeadImport))
	//   mux.HandleFunc("POST /api/v1/leads/{id}/claim", a.protect(a.handleClaimLead))
	//   mux.HandleFunc("POST /api/v1/attempts/{id}/qualify", a.protect(a.handleQualify))
	//   mux.HandleFunc("POST /api/v1/attempts/{id}/close", a.protect(a.handleClosing))
}
