package httpapi

import (
	"errors"
	"net/http"

	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module9_kol"
)

// kolSvc builds the Module 9 (KOL) service. The Account hook fires the parent Service
// [Briefed] -> [In Execution] advance when the first Booking leaves [Sourcing] via the
// roll-up (M9 §2 / M6 §5 Flow 3) — *module6_account.Service satisfies AccountService.
// EvKOLQCFailedOrEscalated is emitted by the engine's onTransition hook (already wired);
// handlers never emit.
func (a *App) kolSvc() *module9_kol.Service {
	return &module9_kol.Service{DB: a.DB, Engine: a.Engine, Account: a.accountSvc()}
}

// ---- Booking breakdown + reads (M9 §4 / §10.1) ----

type createBookingBody struct {
	CreatorName         string `json:"creator_name"`
	CreatorHandle       string `json:"creator_handle"`
	Platform            string `json:"platform"`
	Niche               string `json:"niche"`
	SourcePool          string `json:"source_pool"`
	PoolReference       string `json:"pool_reference"`
	AgreedRate          string `json:"agreed_rate"`
	AssignedCoordinator string `json:"assigned_coordinator"`
}

func (a *App) handleCreateBooking(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b createBookingBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	bk, err := a.kolSvc().CreateBooking(r.Context(), actor, r.PathValue("id"), module9_kol.BookingInput{
		CreatorName: b.CreatorName, CreatorHandle: b.CreatorHandle, Platform: b.Platform,
		Niche: b.Niche, SourcePool: b.SourcePool, PoolReference: b.PoolReference,
		AgreedRate: b.AgreedRate, AssignedCoordinator: b.AssignedCoordinator,
	})
	if err != nil {
		writeKOLErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, bk)
}

func (a *App) handleListBriefBookings(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	list, err := a.kolSvc().ListBriefBookings(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeKOLErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": list})
}

func (a *App) handleGetBooking(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	bk, err := a.kolSvc().GetBooking(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeKOLErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, bk)
}

func (a *App) handleBookingMetrics(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	m, err := a.kolSvc().BookingMetrics(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeKOLErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

// ---- Native lifecycle edges (M9 §4 / §5) ----

type contentLinkBody struct {
	ContentLink string `json:"content_link"`
}

type qcNotesBody struct {
	QCNotes string `json:"qc_notes"`
}

type reasonBody struct {
	Reason string `json:"reason"`
}

func (a *App) handleBook(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.kolSvc().Book(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeKOLErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleStartContent(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.kolSvc().StartContent(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeKOLErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleSubmitContent(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b contentLinkBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	res, err := a.kolSvc().SubmitContent(r.Context(), actor, r.PathValue("id"), b.ContentLink)
	if err != nil {
		writeKOLErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleSendToQCReview(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.kolSvc().SendToQCReview(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeKOLErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handlePassQC(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.kolSvc().PassQC(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeKOLErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleFailQC(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b qcNotesBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	res, err := a.kolSvc().FailQC(r.Context(), actor, r.PathValue("id"), b.QCNotes)
	if err != nil {
		writeKOLErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleEscalate(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b qcNotesBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	res, err := a.kolSvc().Escalate(r.Context(), actor, r.PathValue("id"), b.QCNotes)
	if err != nil {
		writeKOLErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleResubmit(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b contentLinkBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	res, err := a.kolSvc().Resubmit(r.Context(), actor, r.PathValue("id"), b.ContentLink)
	if err != nil {
		writeKOLErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleContinueFromEscalation(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b contentLinkBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	res, err := a.kolSvc().ContinueFromEscalation(r.Context(), actor, r.PathValue("id"), b.ContentLink)
	if err != nil {
		writeKOLErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleDropBooking(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b reasonBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	res, err := a.kolSvc().Drop(r.Context(), actor, r.PathValue("id"), b.Reason)
	if err != nil {
		writeKOLErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// ---- Coordinator assignment / SLA / Hours (M9 §3 Rule 3 / §7 Rule 2) ----

type assignCoordinatorBody struct {
	CoordinatorID string `json:"coordinator_id"`
	Reason        string `json:"reason"`
}

func (a *App) handleAssignCoordinator(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b assignCoordinatorBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	if err := a.kolSvc().AssignCoordinator(r.Context(), actor, r.PathValue("id"), b.CoordinatorID, b.Reason); err != nil {
		writeKOLErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id"), "assigned_coordinator": b.CoordinatorID})
}

func (a *App) handleSetBookingSLA(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b slaBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	if err := a.kolSvc().SetSLATarget(r.Context(), actor, r.PathValue("id"), b.Hours); err != nil {
		writeKOLErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id"), "sla_target_hours": b.Hours})
}

func (a *App) handleLogBookingHours(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b hoursBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	if err := a.kolSvc().LogHours(r.Context(), actor, r.PathValue("id"), b.Hours); err != nil {
		writeKOLErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id"), "hours_logged": b.Hours})
}

// ---- Creator Payment Request (M9 §8) ----

type createPaymentRequestBody struct {
	Amount         string `json:"amount"`
	PaymentDetails string `json:"payment_details"`
}

func (a *App) handleCreatePaymentRequest(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b createPaymentRequestBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	pr, err := a.kolSvc().CreatePaymentRequest(r.Context(), actor, r.PathValue("id"), b.Amount, b.PaymentDetails)
	if err != nil {
		writeKOLErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, pr)
}

func (a *App) handleGetPaymentRequest(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	pr, err := a.kolSvc().GetPaymentRequest(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeKOLErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, pr)
}

func (a *App) handleReceivePayment(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.kolSvc().ReceiveByFinance(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeKOLErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleMarkPaid(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.kolSvc().MarkPaid(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeKOLErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleRejectPayment(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b reasonBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	res, err := a.kolSvc().Reject(r.Context(), actor, r.PathValue("id"), b.Reason)
	if err != nil {
		writeKOLErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// ---- Compiled Creator List (M9 §6 / §10.5) ----

type creatorListBody struct {
	Link string `json:"link"`
}

func (a *App) handleGenerateCreatorList(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b creatorListBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	cl, err := a.kolSvc().GenerateCreatorList(r.Context(), actor, r.PathValue("id"), b.Link)
	if err != nil {
		writeKOLErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, cl)
}

func (a *App) handleGetCreatorList(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	cl, err := a.kolSvc().GetCreatorList(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeKOLErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, cl)
}

// writeKOLErr maps M9 sentinels to HTTP status + their verbatim BI message, following
// the account_handlers.go convention (forbidden->403, not-found->404, domain-validation
// ->422; statemachine BlockedError->422, RoleError->403).
func writeKOLErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, module9_kol.ErrBookingViewForbidden),
		errors.Is(err, module9_kol.ErrExecForbidden),
		errors.Is(err, module9_kol.ErrEscalateForbidden),
		errors.Is(err, module9_kol.ErrDropForbidden),
		errors.Is(err, module9_kol.ErrAssignForbidden),
		errors.Is(err, module9_kol.ErrPaymentManageForbidden),
		errors.Is(err, module9_kol.ErrFinanceForbidden),
		errors.Is(err, module9_kol.ErrCreatorListForbidden):
		writeErr(w, http.StatusForbidden, err.Error())
	case errors.Is(err, module9_kol.ErrBriefNotFound),
		errors.Is(err, module9_kol.ErrBookingNotFound),
		errors.Is(err, module9_kol.ErrPaymentRequestNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, module9_kol.ErrIncomplete),
		errors.Is(err, module9_kol.ErrNotKOLBrief),
		errors.Is(err, module9_kol.ErrBriefNotBookable),
		errors.Is(err, module9_kol.ErrInvalidSourcePool),
		errors.Is(err, module9_kol.ErrInvalidCoordinator),
		errors.Is(err, module9_kol.ErrReassignReasonRequired),
		errors.Is(err, module9_kol.ErrInvalidSLA),
		errors.Is(err, module9_kol.ErrContentLinkRequired),
		errors.Is(err, module9_kol.ErrQCNotesRequired),
		errors.Is(err, module9_kol.ErrDropReasonRequired),
		errors.Is(err, module9_kol.ErrRevisionCapReached),
		errors.Is(err, module9_kol.ErrPaymentBookingNotPassed),
		errors.Is(err, module9_kol.ErrPaymentDetailsRequired),
		errors.Is(err, module9_kol.ErrPaymentAmountMismatch),
		errors.Is(err, module9_kol.ErrPaymentAlreadyRequested),
		errors.Is(err, module9_kol.ErrCreatorListLinkRequired),
		errors.Is(err, module9_kol.ErrRejectionReasonRequired),
		errors.Is(err, module9_kol.ErrBadAmount):
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
	default:
		var be *statemachine.BlockedError
		var re *statemachine.RoleError
		switch {
		case errors.As(err, &be):
			writeErr(w, http.StatusUnprocessableEntity, be.Message)
		case errors.As(err, &re):
			writeErr(w, http.StatusForbidden, re.Message)
		default:
			writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		}
	}
}
