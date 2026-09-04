package httpapi

import (
	"errors"
	"net/http"

	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/demo"
)

func (a *App) handleListDemoTasks(w http.ResponseWriter, r *http.Request) {
	tasks, err := a.Demo.List(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": tasks})
}

func (a *App) handleCreateDemoTask(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var body struct {
		Title       string `json:"title"`
		Description string `json:"description"`
	}
	_ = decodeJSON(r, &body)
	task, err := a.Demo.Create(r.Context(), actor, body.Title, body.Description)
	if err != nil {
		if errors.Is(err, demo.ErrIncomplete) {
			writeErr(w, http.StatusUnprocessableEntity, demo.IncompleteMessage)
			return
		}
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (a *App) handleGetDemoTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	task, allowed, trail, err := a.Demo.Get(r.Context(), id)
	if err != nil {
		if errors.Is(err, demo.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "[demo task tidak ditemukan]")
			return
		}
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": task, "allowed_transitions": allowed, "audit": trail})
}

func (a *App) handleTransitionDemoTask(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	id := r.PathValue("id")
	var body struct {
		To string `json:"to"`
	}
	if err := decodeJSON(r, &body); err != nil || body.To == "" {
		writeErr(w, http.StatusUnprocessableEntity, "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]")
		return
	}
	res, err := a.Demo.Transition(r.Context(), actor, id, body.To)
	if err != nil {
		var blocked *statemachine.BlockedError
		var roleErr *statemachine.RoleError
		switch {
		case errors.As(err, &blocked):
			writeErr(w, http.StatusUnprocessableEntity, blocked.Message)
		case errors.As(err, &roleErr):
			writeErr(w, http.StatusForbidden, roleErr.Message)
		case errors.Is(err, demo.ErrNotFound):
			writeErr(w, http.StatusNotFound, "[demo task tidak ditemukan]")
		default:
			writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"from": res.From, "to": res.To})
}

func (a *App) handleBlockRequest(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	id := r.PathValue("id")
	var body struct {
		Reason string `json:"reason"`
	}
	_ = decodeJSON(r, &body)
	req, err := a.Demo.SubmitBlockRequest(r.Context(), actor, id, body.Reason)
	if err != nil {
		switch {
		case errors.Is(err, demo.ErrIncomplete):
			writeErr(w, http.StatusUnprocessableEntity, demo.IncompleteMessage)
		case errors.Is(err, demo.ErrNotFound):
			writeErr(w, http.StatusNotFound, "[demo task tidak ditemukan]")
		default:
			writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		}
		return
	}
	writeJSON(w, http.StatusOK, req)
}

func (a *App) handleApproveBlockRequest(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	id := r.PathValue("id")
	reqID := r.PathValue("reqId")
	err := a.Demo.ApproveBlockRequest(r.Context(), actor, id, reqID)
	if err != nil {
		var blocked *statemachine.BlockedError
		switch {
		case errors.Is(err, demo.ErrForbidden):
			writeErr(w, http.StatusForbidden, statemachine.RoleDeniedMessage)
		case errors.As(err, &blocked):
			writeErr(w, http.StatusUnprocessableEntity, blocked.Message)
		case errors.Is(err, demo.ErrNotFound):
			writeErr(w, http.StatusNotFound, "[demo task atau block request tidak ditemukan]")
		case errors.Is(err, demo.ErrRequestClosed):
			writeErr(w, http.StatusUnprocessableEntity, "[block request sudah diproses]")
		default:
			writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "approved"})
}
