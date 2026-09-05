package httpapi

import "net/http"

// registerBoardRoutes wires the Module 11 (PM / Kanban) HTTP routes — cross-Brief
// Dependencies (DEP-, M11 §5.1), the Client Board (§5.3) and My Tasks (§5.4).
//
// Kept in its own registration file per the per-stream convention. Paths use the
// top-level /dependencies, /board and /my-tasks surfaces (M11 is a cross-division
// view, not scoped under one entity); the Client Board takes ?client=, My Tasks an
// optional ?employee= (lead/OD/Director only), Dependency listing ?source=/?target=.
func (a *App) registerBoardRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/dependencies", a.protect(a.handleCreateDependency))
	mux.HandleFunc("GET /api/v1/dependencies", a.protect(a.handleListDependencies))
	mux.HandleFunc("GET /api/v1/dependencies/{id}", a.protect(a.handleGetDependency))
	mux.HandleFunc("GET /api/v1/board", a.protect(a.handleClientBoard))
	mux.HandleFunc("GET /api/v1/my-tasks", a.protect(a.handleMyTasks))
}
