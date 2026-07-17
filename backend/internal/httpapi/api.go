// Package httpapi wires the CDPS HTTP contract (stdlib net/http, Go 1.22
// pattern routing). All error bodies are {"message":"[...]"} with BI text.
package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/meagrup/agencyapp/backend/internal/auth"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/demo"
	"github.com/meagrup/agencyapp/backend/internal/hris"
)

// App holds shared dependencies for the handlers.
type App struct {
	DB         *sql.DB
	Engine     *statemachine.Engine
	Catalog    *notification.Catalog
	Auth       auth.Authenticator
	Demo       *demo.Service
	HRISSource hris.EmployeeSource
}

// New builds an App and wires the notification emitter as the engine hook.
func New(d *sql.DB, engine *statemachine.Engine, catalog *notification.Catalog, authn auth.Authenticator, src hris.EmployeeSource) *App {
	a := &App{
		DB:         d,
		Engine:     engine,
		Catalog:    catalog,
		Auth:       authn,
		HRISSource: src,
		Demo:       &demo.Service{DB: d, Engine: engine, Catalog: catalog},
	}
	engine.SetHook(a.onTransition)
	return a
}

// onTransition maps selected state transitions to notification-catalog events,
// demonstrating the engine's event hook. Runs in the transition's transaction.
func (a *App) onTransition(ev statemachine.Event) error {
	switch ev.Machine {
	case statemachine.MCreatorBooking:
		if ev.To == "[QC Failed - Revision Requested]" || ev.To == "[Escalated - Creator Unresponsive]" {
			_, err := a.Catalog.Emit(ev.Ctx, ev.Tx, notification.Emission{
				Event: notification.EvKOLQCFailedOrEscalated, EntityType: ev.EntityType, EntityID: ev.EntityID,
				Actor: ev.Actor.EmployeeID, Division: "KOL",
			})
			return err
		}
	case statemachine.MLiveStreamSession:
		if ev.To == "[Discrepancy Flagged]" {
			_, err := a.Catalog.Emit(ev.Ctx, ev.Tx, notification.Emission{
				Event: notification.EvSessionDiscrepancyFlagged, EntityType: ev.EntityType, EntityID: ev.EntityID,
				Actor: ev.Actor.EmployeeID, Division: "Account",
			})
			return err
		}
	case statemachine.MBriefTask:
		// M11 §5.5: when a Source Brief reaches its terminal ([Approved]) every
		// Dependency it sources turns Satisfied — fire EvDependencySatisfied once per
		// Dependency to the Target Brief's PIC. Covers BOTH the AM approval (module6)
		// and the Creative/KOL roll-up (module12) paths, since both drive [Approved]
		// through this engine. Runs in the transition's transaction (atomic).
		if ev.To == "[Approved]" {
			return a.boardSvc().OnBriefReachedTerminal(ev.Ctx, ev.Tx, ev.Actor, ev.EntityID)
		}
	}
	return nil
}

// Router returns the configured HTTP handler.
func (a *App) Router() http.Handler {
	mux := http.NewServeMux()

	// Auth
	mux.HandleFunc("POST /api/v1/auth/login", a.handleLogin)
	mux.HandleFunc("POST /api/v1/auth/logout", a.protect(a.handleLogout))
	mux.HandleFunc("GET /api/v1/me", a.protect(a.handleMe))

	// Notifications
	mux.HandleFunc("GET /api/v1/notifications", a.protect(a.handleListNotifications))
	mux.HandleFunc("POST /api/v1/notifications/{id}/read", a.protect(a.handleMarkRead))

	// Admin
	mux.HandleFunc("GET /api/v1/admin/employees", a.protect(a.handleListEmployees))
	mux.HandleFunc("POST /api/v1/admin/employee-sync", a.protect(a.handleEmployeeSync))
	mux.HandleFunc("GET /api/v1/admin/role-mappings", a.protect(a.handleListRoleMappings))
	mux.HandleFunc("POST /api/v1/admin/role-mappings", a.protect(a.handleCreateRoleMapping))
	mux.HandleFunc("DELETE /api/v1/admin/role-mappings/{id}", a.protect(a.handleDeleteRoleMapping))
	mux.HandleFunc("GET /api/v1/admin/layered-roles", a.protect(a.handleListLayeredRoles))
	mux.HandleFunc("POST /api/v1/admin/layered-roles", a.protect(a.handleSetLayeredRole))

	// Master Service List
	mux.HandleFunc("GET /api/v1/master-services", a.protect(a.handleListMasterServices))
	mux.HandleFunc("POST /api/v1/master-services", a.protect(a.handleCreateMasterService))
	mux.HandleFunc("PUT /api/v1/master-services/{id}", a.protect(a.handleUpdateMasterService))
	mux.HandleFunc("GET /api/v1/master-services/{id}/versions", a.protect(a.handleMasterServiceVersions))

	// Demo tasks
	mux.HandleFunc("GET /api/v1/demo-tasks", a.protect(a.handleListDemoTasks))
	mux.HandleFunc("POST /api/v1/demo-tasks", a.protect(a.handleCreateDemoTask))
	mux.HandleFunc("GET /api/v1/demo-tasks/{id}", a.protect(a.handleGetDemoTask))
	mux.HandleFunc("POST /api/v1/demo-tasks/{id}/transition", a.protect(a.handleTransitionDemoTask))
	mux.HandleFunc("POST /api/v1/demo-tasks/{id}/block-request", a.protect(a.handleBlockRequest))
	mux.HandleFunc("POST /api/v1/demo-tasks/{id}/block-requests/{reqId}/approve", a.protect(a.handleApproveBlockRequest))

	// Audit
	mux.HandleFunc("GET /api/v1/audit", a.protect(a.handleAudit))

	// Wave 1 money-path routes. Each build stream owns its own registration file
	// so the two teams never edit the same router block:
	//   - registerLeadsSalesRoutes   -> routes_leads_sales.go   (M1 + M0, Team A)
	//   - registerClientFinanceRoutes -> routes_client_finance.go (M4 + M5, Team B)
	a.registerLeadsSalesRoutes(mux)
	a.registerClientFinanceRoutes(mux)

	// Wave 2 — Module 6 (Account & Service), Cluster 1 (intake & AM assignment).
	a.registerAccountRoutes(mux)

	// Wave 2 — Module 12 (Task Execution) + Module 7 (Creative) HTTP surfaces.
	a.registerTaskRoutes(mux)
	a.registerCreativeRoutes(mux)

	// Wave 2 — Module 8 (Ads) + Module 9 (KOL) + Module 10 (Live Stream) HTTP surfaces.
	a.registerAdsRoutes(mux)
	a.registerKOLRoutes(mux)
	a.registerLiveStreamRoutes(mux)

	// Wave 3 — Module 3 (Campaign), Cluster 1: the acquisition Campaign (CMP-).
	a.registerCampaignRoutes(mux)

	// Wave 3 — Module 2 (Marketing), Cluster 1: the 1:1 Performance Record + Auto-Metrics.
	a.registerMarketingRoutes(mux)

	// Wave 3 — Module 11 (PM/Kanban): cross-Brief Dependencies + Client Board + My Tasks.
	a.registerBoardRoutes(mux)

	// Wave 3 — Module 13 (Client Health Report): monthly CHR- snapshots + trend +
	// live preview + ROAS toggle.
	a.registerHealthRoutes(mux)

	return mux
}

// ---- context / actor plumbing ----

type ctxKey int

const actorKey ctxKey = 1

func withActor(ctx context.Context, a permission.Actor) context.Context {
	return context.WithValue(ctx, actorKey, a)
}

func actorFrom(ctx context.Context) (permission.Actor, bool) {
	a, ok := ctx.Value(actorKey).(permission.Actor)
	return a, ok
}

// protect resolves the session cookie into an Actor, returning 401 if absent.
func (a *App) protect(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(auth.CookieName)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "[sesi tidak valid, silahkan login kembali]")
			return
		}
		empID, err := auth.ResolveSession(r.Context(), a.DB, c.Value)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "[sesi tidak valid, silahkan login kembali]")
			return
		}
		actor, err := auth.ResolveActor(r.Context(), a.DB, empID)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "[sesi tidak valid, silahkan login kembali]")
			return
		}
		next(w, r.WithContext(withActor(r.Context(), actor)))
	}
}

// ---- response helpers ----

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"message": msg})
}

func decodeJSON(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}
