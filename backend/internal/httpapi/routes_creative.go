package httpapi

import "net/http"

// registerCreativeRoutes wires the Module 7 (Creative) HTTP routes — the Asset
// (AST-) ENTITY surface: incremental Brief breakdown into Assets (§4), the AM-side
// review edges at Asset granularity (§4 Flow 3 / §6) and the manual Hours Logged
// field (§5 Rule 2). The DIVISION-side execution edges + PIC/SLA/block/metrics an
// Asset plugs into live in registerTaskRoutes (the shared M12 engine).
//
// Kept in its own registration file per the per-stream convention.
func (a *App) registerCreativeRoutes(mux *http.ServeMux) {
	// Asset breakdown + reads (M7 §4 / §9). Creatable by the Brief's Creative
	// staff/lead (self-claim or Team Leader) or Director; read gate = §9.1.
	mux.HandleFunc("POST /api/v1/briefs/{id}/assets", a.protect(a.handleCreateAsset))
	mux.HandleFunc("GET /api/v1/briefs/{id}/assets", a.protect(a.handleListBriefAssets))
	mux.HandleFunc("GET /api/v1/assets/{id}", a.protect(a.handleGetAsset))

	// AM-side review edges (§4 Flow 3 / §6): owning AM or Director only.
	mux.HandleFunc("POST /api/v1/assets/{id}/review", a.protect(a.handleReviewAsset))
	mux.HandleFunc("POST /api/v1/assets/{id}/approve", a.protect(a.handleApproveAsset))
	mux.HandleFunc("POST /api/v1/assets/{id}/request-revision", a.protect(a.handleRequestAssetRevision))

	// Hours Logged (§5 Rule 2): the assigned PIC, the Creative lead, or Director.
	mux.HandleFunc("POST /api/v1/assets/{id}/hours", a.protect(a.handleLogHours))

	// Daily Output (§7): derived read-model feed for one PIC's WIB day. Read gate
	// (W2-M7-C2): the PIC themselves, the Creative lead, OD, or Director.
	mux.HandleFunc("GET /api/v1/daily-output/{picId}", a.protect(a.handleDailyOutput))
}
