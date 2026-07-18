package httpapi

import "net/http"

// registerCampaignRoutes wires the Module 3 (Campaign) HTTP routes — the acquisition
// Campaign (CMP-) entity: creation (§3), the status lifecycle (§3 state machine),
// ownership reassignment (§5 / M3-OA-6), and the §5-scoped Get/List.
//
// Path prefix "/api/v1/marketing/campaigns": Module 8 (Ads) already owns the frozen
// "/api/v1/campaigns/{id}" route for its Ad Campaign (ADC-) record, so the acquisition
// Campaign is namespaced under /marketing to avoid the Go 1.22 mux "conflicting patterns"
// panic and keep the two distinct entities (M3-OA-1) on distinct URL spaces. Documented
// in campaign_handlers.go and the cluster report for orchestrator sign-off.
func (a *App) registerCampaignRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/marketing/campaigns", a.protect(a.handleCreateMarketingCampaign))
	mux.HandleFunc("GET /api/v1/marketing/campaigns", a.protect(a.handleListMarketingCampaigns))
	mux.HandleFunc("GET /api/v1/marketing/campaigns/{id}", a.protect(a.handleGetMarketingCampaign))
	mux.HandleFunc("GET /api/v1/marketing/campaigns/{id}/rollup", a.protect(a.handleMarketingCampaignRollup))
	mux.HandleFunc("POST /api/v1/marketing/campaigns/{id}/transition", a.protect(a.handleTransitionMarketingCampaign))
	mux.HandleFunc("POST /api/v1/marketing/campaigns/{id}/reassign", a.protect(a.handleReassignMarketingCampaign))
}
