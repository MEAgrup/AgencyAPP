package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/module11_board"
	"github.com/meagrup/agencyapp/backend/internal/module14_performance"
	"github.com/meagrup/agencyapp/backend/internal/module15_portal"
)

// portalSvc builds the Module 15 (Team Portal) read-model service. It holds no state
// of its own — it delegates to the M11 (board), M14 (performance) and M12 (task)
// services already wired elsewhere, so every action still runs through its owning
// module (and its FROZEN-catalog emissions). The Client Portal (M15-C2) is a separate
// blocked track and is wired nowhere here.
func (a *App) portalSvc() *module15_portal.Service {
	return &module15_portal.Service{
		DB:    a.DB,
		Board: a.boardSvc(),
		Perf:  a.perfSvc(),
		Task:  a.taskSvc(),
	}
}

// handlePortalMe: GET /api/v1/portal/me — the staff landing page (Rule 9): own open
// tasks (SLA-risk first) + running current-month Performance Score + trend.
func (a *App) handlePortalMe(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	land, err := a.portalSvc().StaffLandingFor(r.Context(), actor, time.Now())
	if err != nil {
		writePortalErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, land)
}

// handlePortalTeam: GET /api/v1/portal/team[?division=&period=YYYYMM] — the SPV/Lead
// landing (Rule 10): division Performance rollup + Client-Board shortcuts + the
// pending block-request approval queue. division defaults to the actor's own.
func (a *App) handlePortalTeam(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	team, err := a.portalSvc().TeamPortalFor(r.Context(), actor,
		r.URL.Query().Get("division"), r.URL.Query().Get("period"))
	if err != nil {
		writePortalErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, team)
}

// handlePortalManagement: GET /api/v1/portal/management[?band=&am=&sort=am] — the
// Director/OD portfolio-wide Client-health scan (Rule 11 / §6.3). Read-only.
func (a *App) handlePortalManagement(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	dash, err := a.portalSvc().ManagementDashboardFor(r.Context(), actor,
		r.URL.Query().Get("band"), r.URL.Query().Get("am"), r.URL.Query().Get("sort"))
	if err != nil {
		writePortalErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, dash)
}

// writePortalErr maps M15 + delegated-module sentinels to HTTP status + verbatim BI
// message. M15 adds no new sentinel of its own beyond the shared access-denied string;
// the delegated M11/M14 forbidden/not-found sentinels surface straight through.
func writePortalErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, module15_portal.ErrForbidden),
		errors.Is(err, module14_performance.ErrForbidden),
		errors.Is(err, module11_board.ErrDepViewForbidden):
		writeErr(w, http.StatusForbidden, err.Error())
	case errors.Is(err, module14_performance.ErrNotFound),
		errors.Is(err, module11_board.ErrDepNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	default:
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
	}
}
