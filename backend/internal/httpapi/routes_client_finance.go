package httpapi

import "net/http"

// registerClientFinanceRoutes wires the M4 (Client Record) + M5 (Finance) HTTP
// routes.
//
// OWNED BY BUILD STREAM B (alur klien → uang). Add every M4/M5 route and its
// handler here (and in sibling *_handlers.go files you create), so Team A's
// router file is never touched.
func (a *App) registerClientFinanceRoutes(mux *http.ServeMux) {
	// M4 — Client Record (W1-10 provenance/visibility).
	mux.HandleFunc("GET /api/v1/clients", a.protect(a.handleListClients))
	mux.HandleFunc("GET /api/v1/clients/{id}", a.protect(a.handleGetClient))
}
