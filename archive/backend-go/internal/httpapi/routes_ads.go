package httpapi

import "net/http"

// registerAdsRoutes wires the Module 8 (Ads) HTTP routes — the Ad Campaign (ADC-)
// entity: creation under an [In Progress] setup Brief (§4 Rule 1), the three-status
// lifecycle (§9.3 Launch/Resume/Pause/End with the §12 code guard on activation),
// Creative-Asset linkage (§4 Rule 2), and the append-only Metric-Entry (§5) and
// Optimization-Log (§6) child rows (POST + GET list; no edit/delete). The setup
// Brief's own lifecycle/metrics stay in M6 (review) + M12 (execution + Speed KPI).
//
// Kept in its own registration file per the per-stream convention, so the Wave-1 and
// earlier Wave-2 router blocks stay untouched.
func (a *App) registerAdsRoutes(mux *http.ServeMux) {
	// Ad Campaign creation + read (§4 / §9.1). Creatable by the Ads division's
	// staff/lead or Director while the parent Brief is [In Progress]; read gate §9.1.
	mux.HandleFunc("POST /api/v1/briefs/{id}/campaigns", a.protect(a.handleCreateCampaign))
	mux.HandleFunc("GET /api/v1/campaigns/{id}", a.protect(a.handleGetCampaign))

	// Lifecycle (§9.3): Launch/Resume ([Paused]->[Active]) carry the §12 code guard
	// (brief [Approved] + all linked Assets [Approved]); Pause/End need no gate beyond
	// canManageCampaign (Ads staff/lead or Director).
	mux.HandleFunc("POST /api/v1/campaigns/{id}/launch", a.protect(a.handleLaunchCampaign))
	mux.HandleFunc("POST /api/v1/campaigns/{id}/resume", a.protect(a.handleResumeCampaign))
	mux.HandleFunc("POST /api/v1/campaigns/{id}/pause", a.protect(a.handlePauseCampaign))
	mux.HandleFunc("POST /api/v1/campaigns/{id}/end", a.protect(a.handleEndCampaign))

	// Creative-Asset linkage (§4 Rule 2): Ads staff/lead or Director.
	mux.HandleFunc("POST /api/v1/campaigns/{id}/assets", a.protect(a.handleLinkAsset))
	mux.HandleFunc("DELETE /api/v1/campaigns/{id}/assets/{assetId}", a.protect(a.handleUnlinkAsset))

	// Append-only child rows (§5 / §6): POST records, GET lists — no edit/delete.
	mux.HandleFunc("POST /api/v1/campaigns/{id}/metrics", a.protect(a.handleLogMetricEntry))
	mux.HandleFunc("GET /api/v1/campaigns/{id}/metrics", a.protect(a.handleListMetricEntries))
	mux.HandleFunc("POST /api/v1/campaigns/{id}/optimizations", a.protect(a.handleLogOptimization))
	mux.HandleFunc("GET /api/v1/campaigns/{id}/optimizations", a.protect(a.handleListOptimizations))
}
