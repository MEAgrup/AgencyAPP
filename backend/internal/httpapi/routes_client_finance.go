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
	// M4 §4 — lock matrix field corrections (W1-11).
	mux.HandleFunc("PATCH /api/v1/clients/{id}", a.protect(a.handleEditClient))
	// M4-OA-5 — Void Service + cascade (W1-12).
	mux.HandleFunc("POST /api/v1/services/{id}/void", a.protect(a.handleVoidService))

	// M5 — Admin & Finance (W1-14/15/16).
	mux.HandleFunc("GET /api/v1/finance/queue", a.protect(a.handleFinanceQueue))
	mux.HandleFunc("GET /api/v1/transactions/{id}", a.protect(a.handleGetTransaction))
	mux.HandleFunc("POST /api/v1/transactions/{id}/schedule", a.protect(a.handleCreateSchedule))
	mux.HandleFunc("POST /api/v1/transactions/{id}/verify", a.protect(a.handleVerify))
	mux.HandleFunc("POST /api/v1/transactions/{id}/contract", a.protect(a.handleAttachContract))
	mux.HandleFunc("POST /api/v1/transactions/{id}/scheme", a.protect(a.handleChangeScheme))

	// M4 §5 — Payment-intent handoff, Sales -> Finance (W1-13).
	mux.HandleFunc("POST /api/v1/clients/{id}/payment-intent", a.protect(a.handleSetPaymentIntent))

	// M5 §6 — Payment reminder dashboard, dual-audience (W1-17).
	mux.HandleFunc("GET /api/v1/finance/reminders", a.protect(a.handleFinanceReminders))
	mux.HandleFunc("POST /api/v1/finance/reminders/scan", a.protect(a.handleScanReminders))

	// M5 §5 Rule 5 / M5-OA-5 — [Bermasalah] flag + joint resolution (W1-18).
	mux.HandleFunc("POST /api/v1/transactions/{id}/bermasalah", a.protect(a.handleFlagBermasalah))
	mux.HandleFunc("POST /api/v1/transactions/{id}/bermasalah/resolve", a.protect(a.handleResolveBermasalah))
	mux.HandleFunc("GET /api/v1/transactions/{id}/bermasalah", a.protect(a.handleGetBermasalah))
}
