package httpapi

import "net/http"

// registerAccountRoutes wires the Module 6 (Account & Service) HTTP routes.
//
// Wave 2, Cluster 1 (M6 §3 — Client intake & AM assignment). Kept in its own
// registration file so the Wave-1 router blocks stay untouched, mirroring the
// per-stream convention (registerLeadsSalesRoutes / registerClientFinanceRoutes).
func (a *App) registerAccountRoutes(mux *http.ServeMux) {
	// M6 §3 Rule 1 — Unassigned Intake Queue (SPV/Head Account + OD/Director).
	mux.HandleFunc("GET /api/v1/account/intake", a.protect(a.handleAccountIntake))
	// M6 §3 Rule 5 — AM workload counter (soft signal, M6-OA-2).
	mux.HandleFunc("GET /api/v1/account/workload", a.protect(a.handleAccountWorkload))
	// M6 §3 Rules 2–4 — manual AM assignment + reassignment (SPV/Head Account).
	mux.HandleFunc("POST /api/v1/clients/{id}/assign-am", a.protect(a.handleAssignAM))
	mux.HandleFunc("POST /api/v1/clients/{id}/reassign-am", a.protect(a.handleReassignAM))

	// Cluster 2 (M6 §4 — Strategy & Plan, plan-gated path).
	mux.HandleFunc("GET /api/v1/strategies", a.protect(a.handleListStrategies))
	mux.HandleFunc("GET /api/v1/strategies/{id}", a.protect(a.handleGetStrategy))
	mux.HandleFunc("POST /api/v1/services/{id}/strategy", a.protect(a.handleCreateStrategy))
	mux.HandleFunc("PUT /api/v1/strategies/{id}", a.protect(a.handleUpdateStrategy))
	mux.HandleFunc("POST /api/v1/strategies/{id}/submit", a.protect(a.handleSubmitStrategy))
	mux.HandleFunc("POST /api/v1/strategies/{id}/approve", a.protect(a.handleApproveStrategy))
	mux.HandleFunc("POST /api/v1/strategies/{id}/request-revision", a.protect(a.handleRequestStrategyRevision))
	// M6-OA-1 — per-engagement override of the Requires-Strategy-Plan flag.
	mux.HandleFunc("POST /api/v1/services/{id}/strategy-requirement", a.protect(a.handleSetStrategyRequirement))

	// Cluster 3 (M6 §5 — Service → Brief breakdown, §6 — dispatch).
	mux.HandleFunc("POST /api/v1/services/{id}/briefs", a.protect(a.handleCreateBrief))
	mux.HandleFunc("GET /api/v1/services/{id}/briefs", a.protect(a.handleListServiceBriefs))
	mux.HandleFunc("GET /api/v1/briefs/{id}", a.protect(a.handleGetBrief))
	mux.HandleFunc("GET /api/v1/divisions/{division}/brief-queue", a.protect(a.handleDivisionQueue))

	// Cluster 4 part A (M6 §7 — Revision routing, AM-side review edges).
	mux.HandleFunc("POST /api/v1/briefs/{id}/review", a.protect(a.handleReviewBrief))
	mux.HandleFunc("POST /api/v1/briefs/{id}/approve", a.protect(a.handleApproveBrief))
	mux.HandleFunc("POST /api/v1/briefs/{id}/request-revision", a.protect(a.handleRequestBriefRevision))

	// Cluster 4 part B (M6 §8 — Complaint door #2, AM via WhatsApp).
	mux.HandleFunc("POST /api/v1/clients/{id}/complaints", a.protect(a.handleLogComplaint))
	mux.HandleFunc("GET /api/v1/clients/{id}/complaints", a.protect(a.handleListClientComplaints))
	mux.HandleFunc("GET /api/v1/complaints/{id}", a.protect(a.handleGetComplaint))
	mux.HandleFunc("POST /api/v1/complaints/{id}/start", a.protect(a.handleStartComplaint))
	mux.HandleFunc("POST /api/v1/complaints/{id}/resolve", a.protect(a.handleResolveComplaint))
	mux.HandleFunc("POST /api/v1/complaints/{id}/close", a.protect(a.handleCloseComplaint))
}
