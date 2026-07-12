package httpapi

import (
	"errors"
	"net/http"

	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module6_account"
)

// accountSvc builds the Module 6 service (Cluster 1 intake & AM assignment +
// Cluster 2 Strategy & Plan). The engine is used by the STR- / Service machines.
func (a *App) accountSvc() *module6_account.Service {
	return &module6_account.Service{DB: a.DB, Engine: a.Engine}
}

func (a *App) handleAccountIntake(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	q, err := a.accountSvc().IntakeQueue(r.Context(), actor)
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": q})
}

func (a *App) handleAccountWorkload(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	wl, err := a.accountSvc().Workload(r.Context(), actor)
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": wl})
}

type assignAMBody struct {
	AMID string `json:"am_id"`
}

func (a *App) handleAssignAM(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var body assignAMBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusUnprocessableEntity, module6_account.ErrInvalidAM.Error())
		return
	}
	res, err := a.accountSvc().AssignAM(r.Context(), actor, r.PathValue("id"), body.AMID)
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

type reassignAMBody struct {
	AMID   string `json:"am_id"`
	Reason string `json:"reason"`
}

func (a *App) handleReassignAM(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var body reassignAMBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusUnprocessableEntity, module6_account.ErrInvalidAM.Error())
		return
	}
	res, err := a.accountSvc().ReassignAM(r.Context(), actor, r.PathValue("id"), body.AMID, body.Reason)
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// writeAccountErr maps M6 sentinels to HTTP status + their verbatim BI message.
func writeAccountErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, module6_account.ErrIntakeForbidden),
		errors.Is(err, module6_account.ErrAssignForbidden),
		errors.Is(err, module6_account.ErrNotOwnerAM),
		errors.Is(err, module6_account.ErrApproveForbidden),
		errors.Is(err, module6_account.ErrStrategyForbidden):
		writeErr(w, http.StatusForbidden, err.Error())
	case errors.Is(err, module6_account.ErrNotFound),
		errors.Is(err, module6_account.ErrServiceNotFound),
		errors.Is(err, module6_account.ErrStrategyNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, module6_account.ErrAlreadyAssigned),
		errors.Is(err, module6_account.ErrNotAssigned),
		errors.Is(err, module6_account.ErrInvalidAM),
		errors.Is(err, module6_account.ErrSameAM),
		errors.Is(err, module6_account.ErrReasonRequired),
		errors.Is(err, module6_account.ErrNotPlanGated),
		errors.Is(err, module6_account.ErrServiceNotAwaiting),
		errors.Is(err, module6_account.ErrStrategyExists),
		errors.Is(err, module6_account.ErrNotDraft),
		errors.Is(err, module6_account.ErrRevisionNotesRequired),
		errors.Is(err, module6_account.ErrInvalidDivisions),
		errors.Is(err, module6_account.ErrIncomplete),
		errors.Is(err, module6_account.ErrStrategyRequired):
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

type strategyBody struct {
	Objective           string   `json:"objective"`
	TargetKPI           string   `json:"target_kpi"`
	DivisionsInvolved   []string `json:"divisions_involved"`
	PlannedBriefOutline string   `json:"planned_brief_outline"`
	TimelineStart       string   `json:"timeline_start"`
	TimelineEnd         string   `json:"timeline_end"`
}

func (b strategyBody) input() module6_account.StrategyInput {
	return module6_account.StrategyInput{
		Objective: b.Objective, TargetKPI: b.TargetKPI, DivisionsInvolved: b.DivisionsInvolved,
		PlannedBriefOutline: b.PlannedBriefOutline, TimelineStart: b.TimelineStart, TimelineEnd: b.TimelineEnd,
	}
}

func (a *App) handleListStrategies(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	list, err := a.accountSvc().ListStrategies(r.Context(), actor)
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": list})
}

func (a *App) handleGetStrategy(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	st, err := a.accountSvc().GetStrategy(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (a *App) handleCreateStrategy(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b strategyBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	st, err := a.accountSvc().CreateStrategy(r.Context(), actor, r.PathValue("id"), b.input())
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (a *App) handleUpdateStrategy(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b strategyBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	if err := a.accountSvc().UpdateDraft(r.Context(), actor, r.PathValue("id"), b.input()); err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id")})
}

func (a *App) handleSubmitStrategy(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.accountSvc().SubmitStrategy(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleApproveStrategy(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	if err := a.accountSvc().ApproveStrategy(r.Context(), actor, r.PathValue("id")); err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id"), "status": module6_account.StrategyStatusApproved})
}

type revisionBody struct {
	Notes string `json:"notes"`
}

func (a *App) handleRequestStrategyRevision(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b revisionBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	if err := a.accountSvc().RequestRevision(r.Context(), actor, r.PathValue("id"), b.Notes); err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id"), "status": module6_account.StrategyStatusDrafting})
}
