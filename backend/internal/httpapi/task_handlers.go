package httpapi

import (
	"errors"
	"net/http"

	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module12_task"
	"github.com/meagrup/agencyapp/backend/internal/module8_ads"
)

// taskSvc builds the Module 12 (Task Execution) service. The Account hook fires
// the parent Service [Briefed] -> [In Execution] advance when a Brief/Asset first
// leaves [To Do] (M6 §5 Flow 3); the FROZEN catalog backs the §5.3a block-request
// notifications (EvBlockRequestSubmitted / EvBlockRequestDecided) the domain emits
// itself — handlers never emit. SubmitGuard wires the M8 Ads campaign-completeness
// gate (M8 §4 Rule 3): an Ads Brief cannot be submitted until a campaign with
// linked creative assets exists. *module6_account.Service and *module8_ads.Service
// satisfy the respective interfaces (AccountService, BriefSubmitGuard).
func (a *App) taskSvc() *module12_task.Service {
	return &module12_task.Service{
		DB:          a.DB,
		Engine:      a.Engine,
		Catalog:     a.Catalog,
		Account:     a.accountSvc(),
		SubmitGuard: a.adsSvc(),
	}
}

// ---- Brief-as-task execution edges (M12 §3, division-side) ----

func (a *App) handleStartTask(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.taskSvc().StartTask(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeTaskErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleSubmitTask(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.taskSvc().SubmitTask(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeTaskErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleReworkTask(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.taskSvc().ReworkTask(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeTaskErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleResumeTask(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.taskSvc().ResumeTask(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeTaskErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// ---- PIC assignment + SLA (M12 §5.3, target-division Lead/SPV or Director) ----

type assignPICBody struct {
	PICID string `json:"pic_id"`
}

func (a *App) handleAssignTaskPIC(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b assignPICBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	if err := a.taskSvc().AssignPIC(r.Context(), actor, r.PathValue("id"), b.PICID); err != nil {
		writeTaskErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id"), "assigned_pic": b.PICID})
}

type slaBody struct {
	Hours float64 `json:"hours"`
}

func (a *App) handleSetTaskSLA(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b slaBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	if err := a.taskSvc().SetSLATarget(r.Context(), actor, r.PathValue("id"), b.Hours); err != nil {
		writeTaskErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id"), "sla_target_hours": b.Hours})
}

// ---- Block request queue (M12 §5.3a) ----

type blockRequestBody struct {
	Reason string `json:"reason"`
}

func (a *App) handleTaskBlockRequest(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b blockRequestBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	br, err := a.taskSvc().SubmitBlockRequest(r.Context(), actor, r.PathValue("id"), b.Reason)
	if err != nil {
		writeTaskErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, br)
}

func (a *App) handleApproveTaskBlock(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	if err := a.taskSvc().ApproveBlockRequest(r.Context(), actor, r.PathValue("id"), r.PathValue("reqId")); err != nil {
		writeTaskErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id"), "request_id": r.PathValue("reqId"), "status": "approved"})
}

func (a *App) handleRejectTaskBlock(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	if err := a.taskSvc().RejectBlockRequest(r.Context(), actor, r.PathValue("id"), r.PathValue("reqId")); err != nil {
		writeTaskErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id"), "request_id": r.PathValue("reqId"), "status": "rejected"})
}

func (a *App) handleTaskMetrics(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	m, err := a.taskSvc().TaskMetrics(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeTaskErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

// ---- Asset execution edges (M12 owns the division-side edges of the Asset,
// M7 §4 / §6). The Asset entity (create/review/hours) lives in creative_handlers. ----

func (a *App) handleStartAsset(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.taskSvc().StartAsset(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeTaskErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

type submitAssetBody struct {
	OutputLink string `json:"output_link"`
}

func (a *App) handleSubmitAsset(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b submitAssetBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	res, err := a.taskSvc().SubmitAsset(r.Context(), actor, r.PathValue("id"), b.OutputLink)
	if err != nil {
		writeTaskErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleReworkAsset(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.taskSvc().ReworkAsset(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeTaskErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleResumeAsset(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.taskSvc().ResumeAsset(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeTaskErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleAssignAssetPIC(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b assignPICBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	if err := a.taskSvc().AssignAssetPIC(r.Context(), actor, r.PathValue("id"), b.PICID); err != nil {
		writeTaskErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id"), "assigned_pic": b.PICID})
}

func (a *App) handleSetAssetSLA(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b slaBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	if err := a.taskSvc().SetAssetSLA(r.Context(), actor, r.PathValue("id"), b.Hours); err != nil {
		writeTaskErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id"), "sla_target_hours": b.Hours})
}

func (a *App) handleSetAssetRevisionSLA(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b slaBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	if err := a.taskSvc().SetAssetRevisionSLA(r.Context(), actor, r.PathValue("id"), b.Hours); err != nil {
		writeTaskErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id"), "revision_sla_target_hours": b.Hours})
}

func (a *App) handleAssetBlockRequest(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b blockRequestBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	br, err := a.taskSvc().SubmitAssetBlockRequest(r.Context(), actor, r.PathValue("id"), b.Reason)
	if err != nil {
		writeTaskErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, br)
}

func (a *App) handleApproveAssetBlock(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	if err := a.taskSvc().ApproveAssetBlockRequest(r.Context(), actor, r.PathValue("id"), r.PathValue("reqId")); err != nil {
		writeTaskErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id"), "request_id": r.PathValue("reqId"), "status": "approved"})
}

func (a *App) handleRejectAssetBlock(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	if err := a.taskSvc().RejectAssetBlockRequest(r.Context(), actor, r.PathValue("id"), r.PathValue("reqId")); err != nil {
		writeTaskErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id"), "request_id": r.PathValue("reqId"), "status": "rejected"})
}

func (a *App) handleAssetMetrics(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	m, err := a.taskSvc().AssetMetrics(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeTaskErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

// writeTaskErr maps M12 sentinels to HTTP status + their verbatim BI message,
// following the account_handlers.go convention (forbidden->403, not-found->404,
// domain-validation->422; statemachine BlockedError->422, RoleError->403).
func writeTaskErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, module12_task.ErrTaskViewForbidden),
		errors.Is(err, module12_task.ErrExecForbidden),
		errors.Is(err, module12_task.ErrAssignForbidden),
		errors.Is(err, module12_task.ErrBlockRequestForbidden),
		errors.Is(err, module12_task.ErrBlockDecideForbidden):
		writeErr(w, http.StatusForbidden, err.Error())
	case errors.Is(err, module12_task.ErrTaskNotFound),
		errors.Is(err, module12_task.ErrBlockRequestNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, module12_task.ErrNotATask),
		errors.Is(err, module12_task.ErrInvalidPIC),
		errors.Is(err, module12_task.ErrInvalidSLA),
		errors.Is(err, module12_task.ErrBlockReasonRequired),
		errors.Is(err, module12_task.ErrBlockRequestClosed),
		errors.Is(err, module12_task.ErrOutputLinkRequired),
		errors.Is(err, module8_ads.ErrCampaignIncompleteForSubmit):
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
