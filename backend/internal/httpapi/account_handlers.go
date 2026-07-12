package httpapi

import (
	"errors"
	"net/http"

	"github.com/meagrup/agencyapp/backend/internal/module6_account"
)

// accountSvc builds the Module 6 (Cluster 1: intake & AM assignment) service.
func (a *App) accountSvc() *module6_account.Service {
	return &module6_account.Service{DB: a.DB}
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
		errors.Is(err, module6_account.ErrAssignForbidden):
		writeErr(w, http.StatusForbidden, err.Error())
	case errors.Is(err, module6_account.ErrNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, module6_account.ErrAlreadyAssigned),
		errors.Is(err, module6_account.ErrNotAssigned),
		errors.Is(err, module6_account.ErrInvalidAM),
		errors.Is(err, module6_account.ErrSameAM),
		errors.Is(err, module6_account.ErrReasonRequired):
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
	default:
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
	}
}
