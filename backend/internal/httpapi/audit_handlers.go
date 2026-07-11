package httpapi

import (
	"net/http"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
)

func (a *App) handleAudit(w http.ResponseWriter, r *http.Request) {
	f := audit.Filter{
		EntityType: r.URL.Query().Get("entity_type"),
		EntityID:   r.URL.Query().Get("entity_id"),
		Limit:      500,
	}
	entries, err := audit.List(r.Context(), a.DB, f)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": entries})
}
