package httpapi

import (
	"errors"
	"net/http"

	"github.com/meagrup/agencyapp/backend/internal/auth"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

type employeeDTO struct {
	EmployeeID string `json:"employee_id"`
	Nama       string `json:"nama"`
	Email      string `json:"email"`
	Divisi     string `json:"divisi"`
	Jabatan    string `json:"jabatan"`
}

type roleDTO struct {
	Division string `json:"division"`
	Level    string `json:"level"`
	OD       bool   `json:"od"`
	Director bool   `json:"director"`
}

type identityDTO struct {
	Employee           employeeDTO `json:"employee"`
	Role               roleDTO     `json:"role"`
	MustChangePassword bool        `json:"must_change_password"`
}

func identityOf(a permission.Actor, mustChange bool) identityDTO {
	return identityDTO{
		Employee:           employeeDTO{EmployeeID: a.EmployeeID, Nama: a.Nama, Email: a.Email, Divisi: a.Divisi, Jabatan: a.Jabatan},
		Role:               roleDTO{Division: a.Role.Division, Level: a.Role.Level, OD: a.Role.OD, Director: a.Role.Director},
		MustChangePassword: mustChange,
	}
}

func (a *App) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Email == "" || body.Password == "" {
		writeErr(w, http.StatusBadRequest, "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]")
		return
	}

	empID, mustChange, err := auth.VerifyLocal(r.Context(), a.DB, body.Email, body.Password)
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrNotProvisioned):
			writeErr(w, http.StatusUnauthorized, "[akun belum diaktifkan, hubungi admin untuk pengaturan password awal]")
		case errors.Is(err, auth.ErrLocked):
			writeErr(w, http.StatusLocked, "[akun terkunci sementara karena percobaan gagal berulang, coba lagi dalam 15 menit]")
		case errors.Is(err, auth.ErrInvalidCredentials):
			writeErr(w, http.StatusUnauthorized, "[email atau password salah]")
		default:
			writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		}
		return
	}

	token, err := auth.CreateSession(r.Context(), a.DB, empID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(auth.SessionTTL.Seconds()),
	})

	actor, err := auth.ResolveActor(r.Context(), a.DB, empID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		return
	}
	writeJSON(w, http.StatusOK, identityOf(actor, mustChange))
}

func (a *App) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(auth.CookieName); err == nil {
		_ = auth.RevokeSession(r.Context(), a.DB, c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: auth.CookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
	w.WriteHeader(http.StatusNoContent)
}

func (a *App) handleMe(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	mustChange, _ := mustChangeFrom(r.Context())
	writeJSON(w, http.StatusOK, identityOf(actor, mustChange))
}

// handleChangePassword lets the logged-in employee change their own password.
// It is deliberately NOT blocked by the force-change gate.
func (a *App) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var body struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := decodeJSON(r, &body); err != nil || body.OldPassword == "" || body.NewPassword == "" {
		writeErr(w, http.StatusBadRequest, "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]")
		return
	}
	var keepToken string
	if c, err := r.Cookie(auth.CookieName); err == nil {
		keepToken = c.Value
	}
	err := auth.ChangePassword(r.Context(), a.DB, actor.EmployeeID, keepToken, body.OldPassword, body.NewPassword)
	switch {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, auth.ErrLocked):
		writeErr(w, http.StatusLocked, "[akun terkunci sementara karena percobaan gagal berulang, coba lagi dalam 15 menit]")
	case errors.Is(err, auth.ErrOldPasswordMismatch):
		writeErr(w, http.StatusUnauthorized, "[password lama tidak sesuai]")
	case errors.Is(err, auth.ErrWeakPassword):
		writeErr(w, http.StatusBadRequest, "[password minimal 8 karakter]")
	case errors.Is(err, auth.ErrPasswordTooLong):
		writeErr(w, http.StatusBadRequest, "[password maksimal 72 karakter]")
	default:
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
	}
}

// handleAdminSetPassword lets an authorized admin set a temporary password.
func (a *App) handleAdminSetPassword(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var body struct {
		EmployeeID   string `json:"employee_id"`
		TempPassword string `json:"temp_password"`
	}
	if err := decodeJSON(r, &body); err != nil || body.EmployeeID == "" || body.TempPassword == "" {
		writeErr(w, http.StatusBadRequest, "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]")
		return
	}
	err := auth.SetPassword(r.Context(), a.DB, actor, body.EmployeeID, body.TempPassword)
	switch {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, auth.ErrForbidden):
		writeErr(w, http.StatusForbidden, "[anda tidak memiliki akses untuk mengatur password karyawan ini]")
	case errors.Is(err, auth.ErrEmployeeNotFound):
		writeErr(w, http.StatusNotFound, "[karyawan tidak ditemukan]")
	case errors.Is(err, auth.ErrWeakPassword):
		writeErr(w, http.StatusBadRequest, "[password minimal 8 karakter]")
	case errors.Is(err, auth.ErrPasswordTooLong):
		writeErr(w, http.StatusBadRequest, "[password maksimal 72 karakter]")
	default:
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
	}
}

// handleAdminCredentials lists the credential status of employees the admin may
// manage (Director -> all; Lead -> own division; others -> 403).
func (a *App) handleAdminCredentials(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	rows, err := auth.ListCredentials(r.Context(), a.DB, actor)
	if err != nil {
		if errors.Is(err, auth.ErrForbidden) {
			writeErr(w, http.StatusForbidden, "[anda tidak memiliki akses untuk mengatur password karyawan ini]")
			return
		}
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": rows})
}
