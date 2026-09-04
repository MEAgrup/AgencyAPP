package httpapi

import (
	"errors"
	"net/http"

	"github.com/meagrup/agencyapp/backend/internal/module11_board"
)

// boardSvc builds the Module 11 (PM / Kanban) service. The FROZEN catalog backs the
// EvDependencySatisfied emission (M11 §5.5) fired from the engine's post-transition
// hook (onTransition) when a Source Brief reaches [Approved]; handlers never emit.
func (a *App) boardSvc() *module11_board.Service {
	return &module11_board.Service{DB: a.DB, Catalog: a.Catalog}
}

type createDependencyBody struct {
	SourceType string `json:"source_type"`
	SourceID   string `json:"source_id"`
	TargetType string `json:"target_type"`
	TargetID   string `json:"target_id"`
	Type       string `json:"type"`
	Note       string `json:"note"`
}

func (a *App) handleCreateDependency(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b createDependencyBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	dep, err := a.boardSvc().CreateDependency(r.Context(), actor, module11_board.DependencyInput{
		SourceType: b.SourceType, SourceID: b.SourceID, TargetType: b.TargetType,
		TargetID: b.TargetID, Type: b.Type, Note: b.Note,
	})
	if err != nil {
		writeBoardErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, dep)
}

func (a *App) handleListDependencies(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	deps, err := a.boardSvc().ListDependencies(r.Context(), actor, r.URL.Query().Get("source"), r.URL.Query().Get("target"))
	if err != nil {
		writeBoardErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": deps})
}

func (a *App) handleGetDependency(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	dep, err := a.boardSvc().GetDependency(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeBoardErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, dep)
}

func (a *App) handleClientBoard(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	cards, err := a.boardSvc().ClientBoard(r.Context(), actor, r.URL.Query().Get("client"))
	if err != nil {
		writeBoardErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": cards})
}

func (a *App) handleMyTasks(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	cards, err := a.boardSvc().MyTasks(r.Context(), actor, r.URL.Query().Get("employee"))
	if err != nil {
		writeBoardErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": cards})
}

// writeBoardErr maps M11 sentinels to HTTP status + verbatim BI message
// (forbidden->403, not-found->404, domain-validation->422), mirroring the other
// modules' handler-error convention.
func writeBoardErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, module11_board.ErrDepCreateForbidden),
		errors.Is(err, module11_board.ErrDepViewForbidden):
		writeErr(w, http.StatusForbidden, err.Error())
	case errors.Is(err, module11_board.ErrDepNotFound),
		errors.Is(err, module11_board.ErrDepBriefNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, module11_board.ErrDepIncomplete),
		errors.Is(err, module11_board.ErrDepInvalidType),
		errors.Is(err, module11_board.ErrDepInvalidEntity),
		errors.Is(err, module11_board.ErrDepSelf),
		errors.Is(err, module11_board.ErrDepCrossClient),
		errors.Is(err, module11_board.ErrDepDuplicate),
		errors.Is(err, module11_board.ErrDepCycle):
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
	default:
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
	}
}
