package httpapi

import "net/http"

// registerMarketingRoutes wires the Module 2 (Marketing) HTTP routes — the Marketing
// Performance Record (budget input, M2 §3), its read-only Auto-Metrics (M2 §4), and the
// Lead/Staff dashboard split (M2 §5).
//
// Path prefix mirrors the acquisition Campaign surface (routes_campaign.go): the record is
// 1:1 with a Campaign (CMP-), so it hangs off "/api/v1/marketing/campaigns/{id}/...". The
// cross-campaign dashboard is "/api/v1/marketing/performance-dashboard".
func (a *App) registerMarketingRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/marketing/campaigns/{id}/performance", a.protect(a.handleCreatePerformanceRecord))
	mux.HandleFunc("GET /api/v1/marketing/campaigns/{id}/performance", a.protect(a.handleGetPerformance))
	mux.HandleFunc("POST /api/v1/marketing/campaigns/{id}/performance/budget", a.protect(a.handleUpdatePerformanceBudget))
	mux.HandleFunc("PATCH /api/v1/marketing/campaigns/{id}/performance/budget", a.protect(a.handleUpdatePerformanceBudget))
	mux.HandleFunc("GET /api/v1/marketing/performance-dashboard", a.protect(a.handlePerformanceDashboard))
}
