package httpapi

import (
	"errors"
	"net/http"

	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module10_livestream"
)

// liveStreamSvc builds the Module 10 (Live Stream) service. It owns the Session entity
// and, on reconciliation, rolls the parent off-machine Brief up to [Approved]. The
// EvSessionDiscrepancyFlagged notification is emitted by the engine's onTransition hook
// (already wired); handlers never emit.
func (a *App) liveStreamSvc() *module10_livestream.Service {
	return &module10_livestream.Service{DB: a.DB, Engine: a.Engine}
}

// ---- Session request creation + reads (M10 §3 / §6.1) ----

type createSessionBody struct {
	Platform            string `json:"platform"`
	RequestedDatetime   string `json:"requested_datetime"`
	TargetDurationHours string `json:"target_duration_hours"`
	ProductsTalent      string `json:"products_talent"`
	SpecialInstructions string `json:"special_instructions"`
}

func (a *App) handleCreateSession(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b createSessionBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	sess, err := a.liveStreamSvc().CreateSession(r.Context(), actor, r.PathValue("id"), module10_livestream.SessionInput{
		Platform: b.Platform, RequestedDatetime: b.RequestedDatetime, TargetDurationHours: b.TargetDurationHours,
		ProductsTalent: b.ProductsTalent, SpecialInstructions: b.SpecialInstructions,
	})
	if err != nil {
		writeLiveStreamErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sess)
}

func (a *App) handleListBriefSessions(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	list, err := a.liveStreamSvc().ListBriefSessions(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeLiveStreamErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": list})
}

func (a *App) handleGetSession(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	sess, err := a.liveStreamSvc().GetSession(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeLiveStreamErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sess)
}

// ---- Lifecycle (M10 §4) ----

func (a *App) handleConfirmByVendor(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.liveStreamSvc().ConfirmByVendor(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeLiveStreamErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

type logResultsBody struct {
	ActualDatetime      string `json:"actual_datetime"`
	ActualDurationHours string `json:"actual_duration_hours"`
	ViewersPeak         *int   `json:"viewers_peak"`
	ViewersAvg          *int   `json:"viewers_avg"`
	OrdersGenerated     *int   `json:"orders_generated"`
	GMV                 string `json:"gmv"`
	VendorReportLink    string `json:"vendor_report_link"`
}

func (a *App) handleLogResults(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b logResultsBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	res, err := a.liveStreamSvc().LogResults(r.Context(), actor, r.PathValue("id"), module10_livestream.ResultInput{
		ActualDatetime: b.ActualDatetime, ActualDurationHours: b.ActualDurationHours,
		ViewersPeak: b.ViewersPeak, ViewersAvg: b.ViewersAvg, OrdersGenerated: b.OrdersGenerated,
		GMV: b.GMV, VendorReportLink: b.VendorReportLink,
	})
	if err != nil {
		writeLiveStreamErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleReconcile(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.liveStreamSvc().Reconcile(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeLiveStreamErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

type discrepancyBody struct {
	Notes string `json:"notes"`
}

func (a *App) handleFlagDiscrepancy(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b discrepancyBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	res, err := a.liveStreamSvc().FlagDiscrepancy(r.Context(), actor, r.PathValue("id"), b.Notes)
	if err != nil {
		writeLiveStreamErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// ---- O27-b Brief reopen (DECISIONS W2-M10-C2) ----

func (a *App) handleReopenBrief(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	if err := a.liveStreamSvc().ReopenBrief(r.Context(), actor, r.PathValue("id")); err != nil {
		writeLiveStreamErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id"), "status": module10_livestream.BriefVendorDispatched})
}

// writeLiveStreamErr maps M10 sentinels to HTTP status + their verbatim BI message,
// following the account_handlers.go convention (forbidden->403, not-found->404,
// domain-validation/transition->422; statemachine BlockedError->422, RoleError->403).
func writeLiveStreamErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, module10_livestream.ErrSessionViewForbidden),
		errors.Is(err, module10_livestream.ErrSessionManageForbidden),
		errors.Is(err, module10_livestream.ErrBriefReopenForbidden):
		writeErr(w, http.StatusForbidden, err.Error())
	case errors.Is(err, module10_livestream.ErrBriefNotFound),
		errors.Is(err, module10_livestream.ErrSessionNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, module10_livestream.ErrIncomplete),
		errors.Is(err, module10_livestream.ErrNotLiveStreamBrief),
		errors.Is(err, module10_livestream.ErrBriefNotOpenForSession),
		errors.Is(err, module10_livestream.ErrBriefVoided),
		errors.Is(err, module10_livestream.ErrInvalidPlatform),
		errors.Is(err, module10_livestream.ErrInvalidDuration),
		errors.Is(err, module10_livestream.ErrBadDatetime),
		errors.Is(err, module10_livestream.ErrReconNotesRequired),
		errors.Is(err, module10_livestream.ErrVendorReportLinkRequired),
		errors.Is(err, module10_livestream.ErrBadAmount),
		errors.Is(err, module10_livestream.ErrBriefNotReopenable):
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
