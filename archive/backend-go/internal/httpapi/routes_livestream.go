package httpapi

import "net/http"

// registerLiveStreamRoutes wires the Module 10 (Live Stream) HTTP routes — the Live
// Stream Session (LSS-) vendor-tracker: request creation under an off-machine
// [Dispatched to Vendor] Brief (§3), the AM-owned lifecycle (confirm -> results ->
// reconcile / flag-discrepancy, §4), reads (§6.1), and the O27-b Brief reopen
// (DECISIONS W2-M10-C2). Every write edge is the owning AM or Director (§6.1).
//
// Kept in its own registration file per the per-stream convention.
func (a *App) registerLiveStreamRoutes(mux *http.ServeMux) {
	// Session request creation + reads (§3 / §6.1). Owning AM or Director create;
	// read gate = OD/Director + Account lead + owning AM.
	mux.HandleFunc("POST /api/v1/briefs/{id}/sessions", a.protect(a.handleCreateSession))
	mux.HandleFunc("GET /api/v1/briefs/{id}/sessions", a.protect(a.handleListBriefSessions))
	mux.HandleFunc("GET /api/v1/sessions/{id}", a.protect(a.handleGetSession))

	// Lifecycle (§4): each edge is the owning AM or Director.
	mux.HandleFunc("POST /api/v1/sessions/{id}/confirm", a.protect(a.handleConfirmByVendor))
	mux.HandleFunc("POST /api/v1/sessions/{id}/results", a.protect(a.handleLogResults))
	mux.HandleFunc("POST /api/v1/sessions/{id}/reconcile", a.protect(a.handleReconcile))
	mux.HandleFunc("POST /api/v1/sessions/{id}/flag-discrepancy", a.protect(a.handleFlagDiscrepancy))

	// O27-b Brief reopen ([Approved] -> [Dispatched to Vendor], M10-OA-4): owning AM
	// or Director only (same §6.1 write gate as Sessions).
	mux.HandleFunc("POST /api/v1/briefs/{id}/reopen", a.protect(a.handleReopenBrief))
}
