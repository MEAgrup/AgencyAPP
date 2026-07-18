package httpapi

import "net/http"

// registerPortalRoutes wires the Module 15 Team Portal (INTERNAL) read-model surfaces:
// the staff landing (/portal/me), the SPV/Lead variant (/portal/team) and the
// Director/OD Management Dashboard (/portal/management). All three are pure
// aggregation over M11/M12/M13/M14 — no new entity, no status write, no emission
// (Rule 8). The Client Portal (M15-C2) is a separate blocked track and is NOT wired
// here.
func (a *App) registerPortalRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/portal/me", a.protect(a.handlePortalMe))
	mux.HandleFunc("GET /api/v1/portal/team", a.protect(a.handlePortalTeam))
	mux.HandleFunc("GET /api/v1/portal/management", a.protect(a.handlePortalManagement))
}
