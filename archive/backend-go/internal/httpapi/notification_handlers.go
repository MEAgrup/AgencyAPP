package httpapi

import (
	"net/http"
	"strconv"

	"github.com/meagrup/agencyapp/backend/internal/core/notification"
)

func (a *App) handleListNotifications(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	unreadOnly := r.URL.Query().Get("unread") == "1"
	list, err := notification.List(r.Context(), a.DB, actor.EmployeeID, unreadOnly)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		return
	}
	count, err := notification.UnreadCount(r.Context(), a.DB, actor.EmployeeID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": list, "unread_count": count})
}

func (a *App) handleMarkRead(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "[id tidak valid]")
		return
	}
	if err := notification.MarkRead(r.Context(), a.DB, id, actor.EmployeeID); err != nil {
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
