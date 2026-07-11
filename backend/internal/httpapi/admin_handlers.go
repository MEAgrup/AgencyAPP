package httpapi

import (
	"net/http"
	"strconv"

	"github.com/meagrup/agencyapp/backend/internal/admin"
	"github.com/meagrup/agencyapp/backend/internal/hris"
)

// requireAdmin enforces Director for writes; OD may read admin views.
func (a *App) handleListEmployees(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	if !actor.CanManageAdmin() && !actor.Role.OD {
		writeErr(w, http.StatusForbidden, "[anda tidak memiliki akses ke data ini]")
		return
	}
	rows, err := admin.ListEmployees(r.Context(), a.DB)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": rows})
}

func (a *App) handleEmployeeSync(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	if !actor.CanManageAdmin() {
		writeErr(w, http.StatusForbidden, "[hanya Director yang dapat menjalankan sinkronisasi]")
		return
	}
	if a.HRISSource == nil {
		writeErr(w, http.StatusServiceUnavailable, "[sumber data HRIS tidak dikonfigurasi]")
		return
	}
	res, err := hris.Sync(r.Context(), a.DB, a.HRISSource, actor.EmployeeID, true)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleListRoleMappings(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	if !actor.CanManageAdmin() && !actor.Role.OD {
		writeErr(w, http.StatusForbidden, "[anda tidak memiliki akses ke data ini]")
		return
	}
	rows, err := admin.ListRoleMappings(r.Context(), a.DB)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": rows})
}

func (a *App) handleCreateRoleMapping(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	if !actor.CanManageAdmin() {
		writeErr(w, http.StatusForbidden, "[hanya Director yang dapat mengelola role mapping]")
		return
	}
	var m admin.RoleMapping
	if err := decodeJSON(r, &m); err != nil || m.Divisi == "" || m.Jabatan == "" || m.Division == "" {
		writeErr(w, http.StatusUnprocessableEntity, "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]")
		return
	}
	id, err := admin.UpsertRoleMapping(r.Context(), a.DB, actor, m)
	if err != nil {
		writeErr(w, http.StatusUnprocessableEntity, "["+err.Error()+"]")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
}

func (a *App) handleDeleteRoleMapping(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	if !actor.CanManageAdmin() {
		writeErr(w, http.StatusForbidden, "[hanya Director yang dapat mengelola role mapping]")
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "[id tidak valid]")
		return
	}
	if err := admin.DeleteRoleMapping(r.Context(), a.DB, actor, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *App) handleListLayeredRoles(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	if !actor.CanManageAdmin() && !actor.Role.OD {
		writeErr(w, http.StatusForbidden, "[anda tidak memiliki akses ke data ini]")
		return
	}
	rows, err := admin.ListLayeredRoles(r.Context(), a.DB)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": rows})
}

func (a *App) handleSetLayeredRole(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	if !actor.CanManageAdmin() {
		writeErr(w, http.StatusForbidden, "[hanya Director yang dapat mengelola layered role]")
		return
	}
	var body struct {
		EmployeeID string `json:"employee_id"`
		Role       string `json:"role"`
		Enabled    bool   `json:"enabled"`
	}
	if err := decodeJSON(r, &body); err != nil || body.EmployeeID == "" || body.Role == "" {
		writeErr(w, http.StatusUnprocessableEntity, "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]")
		return
	}
	if err := admin.SetLayeredRole(r.Context(), a.DB, actor, body.EmployeeID, body.Role, body.Enabled); err != nil {
		writeErr(w, http.StatusUnprocessableEntity, "["+err.Error()+"]")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
