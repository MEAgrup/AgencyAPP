package httpapi

import "net/http"

// registerClientFinanceRoutes wires the M4 (Client Record) + M5 (Finance) HTTP
// routes.
//
// OWNED BY BUILD STREAM B (alur klien → uang). Add every M4/M5 route and its
// handler here (and in sibling *_handlers.go files you create), so Team A's
// router file is never touched.
func (a *App) registerClientFinanceRoutes(mux *http.ServeMux) {
	// Example (uncomment/extend as tickets land):
	//   mux.HandleFunc("GET /api/v1/clients/{id}", a.protect(a.handleGetClient))
	//   mux.HandleFunc("POST /api/v1/clients/{id}/payment-intent", a.protect(a.handlePaymentIntent))
	//   mux.HandleFunc("POST /api/v1/transactions/{id}/verify", a.protect(a.handleVerifyPayment))
	//   mux.HandleFunc("POST /api/v1/services/{id}/void", a.protect(a.handleVoidService))
}
