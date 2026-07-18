package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module7_creative"
)

// creativeSvc builds the Module 7 (Creative) service. The Tasks hook recomputes
// the parent Brief's roll-up (M7 §2) after every Asset review edge, in the same
// transaction — *module12_task.Service satisfies Rollup. The FROZEN catalog backs
// the per-Asset EvRevisionCountFlag the domain emits itself (§6 Rule 4); handlers
// never emit.
func (a *App) creativeSvc() *module7_creative.Service {
	return &module7_creative.Service{
		DB:      a.DB,
		Engine:  a.Engine,
		Catalog: a.Catalog,
		Tasks:   a.taskSvc(),
	}
}

// ---- Asset breakdown + reads (M7 §4 / §9) ----

type createAssetBody struct {
	SequenceNo  int    `json:"sequence_no"`
	AssignedPIC string `json:"assigned_pic"`
}

func (a *App) handleCreateAsset(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b createAssetBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	asset, err := a.creativeSvc().CreateAsset(r.Context(), actor, r.PathValue("id"), module7_creative.AssetInput{
		SequenceNo: b.SequenceNo, AssignedPIC: b.AssignedPIC,
	})
	if err != nil {
		writeCreativeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, asset)
}

func (a *App) handleListBriefAssets(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	list, err := a.creativeSvc().ListBriefAssets(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeCreativeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": list})
}

func (a *App) handleGetAsset(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	asset, err := a.creativeSvc().GetAsset(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeCreativeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, asset)
}

// ---- AM-side review edges at Asset granularity (M7 §4 Flow 3 / §6) ----

func (a *App) handleReviewAsset(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.creativeSvc().ReviewAsset(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeCreativeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleApproveAsset(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.creativeSvc().ApproveAsset(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeCreativeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

type assetRevisionBody struct {
	Feedback string `json:"feedback"`
}

func (a *App) handleRequestAssetRevision(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b assetRevisionBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	res, err := a.creativeSvc().RequestAssetRevision(r.Context(), actor, r.PathValue("id"), b.Feedback)
	if err != nil {
		writeCreativeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// ---- Hours Logged (M7 §5 Rule 2) ----

type hoursBody struct {
	Hours float64 `json:"hours"`
}

func (a *App) handleLogHours(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b hoursBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	if err := a.creativeSvc().LogHours(r.Context(), actor, r.PathValue("id"), b.Hours); err != nil {
		writeCreativeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id"), "hours_logged": b.Hours})
}

// ---- Hours Logged reminder scan (M7-OA-2, DECISIONS O29/W3-CAT-1) ----

// handleScanHoursReminders serves the on-demand Hours Logged reminder sweep
// (mirrors handleScanReminders, intent_reminder_handlers.go). Creative
// division (any level) or Director only.
func (a *App) handleScanHoursReminders(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.creativeSvc().RunHoursReminderScan(r.Context(), actor, time.Now())
	if err != nil {
		writeCreativeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// writeCreativeErr maps M7 sentinels to HTTP status + their verbatim BI message,
// following the account_handlers.go convention (forbidden->403, not-found->404,
// domain-validation->422; statemachine BlockedError->422, RoleError->403).
// handleDailyOutput serves the M7 §7 Daily Output feed: one PIC's auto-logged
// output for one WIB calendar day (derived read-model, W2-M7-C2). Optional query
// param date=YYYY-MM-DD; default = today.
func (a *App) handleDailyOutput(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	day := time.Now()
	if q := r.URL.Query().Get("date"); q != "" {
		parsed, err := time.Parse("2006-01-02", q)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
			return
		}
		day = parsed
	}
	out, err := a.creativeSvc().DailyOutput(r.Context(), actor, r.PathValue("picId"), day)
	if err != nil {
		writeCreativeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func writeCreativeErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, module7_creative.ErrAssetForbidden),
		errors.Is(err, module7_creative.ErrAssetCreateForbidden),
		errors.Is(err, module7_creative.ErrReviewForbidden),
		errors.Is(err, module7_creative.ErrHoursForbidden),
		errors.Is(err, module7_creative.ErrDailyOutputForbidden),
		errors.Is(err, module7_creative.ErrHoursReminderScanForbidden):
		writeErr(w, http.StatusForbidden, err.Error())
	case errors.Is(err, module7_creative.ErrBriefNotFound),
		errors.Is(err, module7_creative.ErrAssetNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, module7_creative.ErrIncomplete),
		errors.Is(err, module7_creative.ErrNotCreativeBrief),
		errors.Is(err, module7_creative.ErrBriefNotAssetable),
		errors.Is(err, module7_creative.ErrInvalidSequence),
		errors.Is(err, module7_creative.ErrDuplicateSequence),
		errors.Is(err, module7_creative.ErrInvalidPIC),
		errors.Is(err, module7_creative.ErrRevisionFeedbackRequired),
		errors.Is(err, module7_creative.ErrInvalidHours):
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
