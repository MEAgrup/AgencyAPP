package httpapi

import "net/http"

// registerKOLRoutes wires the Module 9 (KOL) HTTP routes — the Creator Booking (BKG-)
// entity end to end: creation under a KOL Brief (§4), the NATIVE 8-state lifecycle incl.
// QC done by KOL itself (§5), Coordinator assignment / SLA / Hours (§3 / §7), the Creator
// Payment Request (CPR-, §8, request side KOL / executing side Finance), the compiled
// Creator List (§6), and the recompute-from-log Booking metrics (§7 / §11).
//
// Kept in its own registration file per the per-stream convention.
func (a *App) registerKOLRoutes(mux *http.ServeMux) {
	// Booking breakdown + reads (§4 / §10.1). Creatable by the Brief's KOL staff/lead
	// (self-claim or Team Leader) or Director; read gate = §10.1.
	mux.HandleFunc("POST /api/v1/briefs/{id}/bookings", a.protect(a.handleCreateBooking))
	mux.HandleFunc("GET /api/v1/briefs/{id}/bookings", a.protect(a.handleListBriefBookings))
	mux.HandleFunc("GET /api/v1/bookings/{id}", a.protect(a.handleGetBooking))
	mux.HandleFunc("GET /api/v1/bookings/{id}/metrics", a.protect(a.handleBookingMetrics))

	// Native lifecycle edges (§4 / §5) — claim model (pre-/post-Coordinator).
	mux.HandleFunc("POST /api/v1/bookings/{id}/book", a.protect(a.handleBook))
	mux.HandleFunc("POST /api/v1/bookings/{id}/start-content", a.protect(a.handleStartContent))
	mux.HandleFunc("POST /api/v1/bookings/{id}/submit-content", a.protect(a.handleSubmitContent))
	mux.HandleFunc("POST /api/v1/bookings/{id}/send-qc", a.protect(a.handleSendToQCReview))
	mux.HandleFunc("POST /api/v1/bookings/{id}/pass-qc", a.protect(a.handlePassQC))
	mux.HandleFunc("POST /api/v1/bookings/{id}/fail-qc", a.protect(a.handleFailQC))
	mux.HandleFunc("POST /api/v1/bookings/{id}/escalate", a.protect(a.handleEscalate))
	mux.HandleFunc("POST /api/v1/bookings/{id}/resubmit", a.protect(a.handleResubmit))
	mux.HandleFunc("POST /api/v1/bookings/{id}/continue", a.protect(a.handleContinueFromEscalation))
	mux.HandleFunc("POST /api/v1/bookings/{id}/drop", a.protect(a.handleDropBooking))

	// Coordinator assignment / SLA / Hours (§3 Rule 3 / §7 Rule 2).
	mux.HandleFunc("POST /api/v1/bookings/{id}/assign-coordinator", a.protect(a.handleAssignCoordinator))
	mux.HandleFunc("POST /api/v1/bookings/{id}/sla", a.protect(a.handleSetBookingSLA))
	mux.HandleFunc("POST /api/v1/bookings/{id}/hours", a.protect(a.handleLogBookingHours))

	// Attributed GMV write-back (§10.3 / M9-OA-4): manual per-Booking, [QC Passed]
	// only; Coordinator/KOL lead/Director. Never estimated; NULL if no link.
	mux.HandleFunc("POST /api/v1/bookings/{id}/attributed-gmv", a.protect(a.handleRecordAttributedGMV))

	// Creator Payment Request (§8). Request side (create) = Coordinator/Director;
	// executing side (receive/pay/reject) = Finance staff/lead or Director.
	mux.HandleFunc("POST /api/v1/bookings/{id}/payment-request", a.protect(a.handleCreatePaymentRequest))
	mux.HandleFunc("GET /api/v1/payment-requests/{id}", a.protect(a.handleGetPaymentRequest))
	mux.HandleFunc("POST /api/v1/payment-requests/{id}/receive", a.protect(a.handleReceivePayment))
	mux.HandleFunc("POST /api/v1/payment-requests/{id}/pay", a.protect(a.handleMarkPaid))
	mux.HandleFunc("POST /api/v1/payment-requests/{id}/reject", a.protect(a.handleRejectPayment))

	// Compiled Creator List (§6 / §10.5): generate/refresh + read.
	mux.HandleFunc("POST /api/v1/briefs/{id}/creator-list", a.protect(a.handleGenerateCreatorList))
	mux.HandleFunc("GET /api/v1/briefs/{id}/creator-list", a.protect(a.handleGetCreatorList))
}
