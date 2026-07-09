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
	Employee employeeDTO `json:"employee"`
	Role     roleDTO     `json:"role"`
}

func identityOf(a permission.Actor) identityDTO {
	return identityDTO{
		Employee: employeeDTO{EmployeeID: a.EmployeeID, Nama: a.Nama, Email: a.Email, Divisi: a.Divisi, Jabatan: a.Jabatan},
		Role:     roleDTO{Division: a.Role.Division, Level: a.Role.Level, OD: a.Role.OD, Director: a.Role.Director},
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

	empID, err := a.Auth.Verify(r.Context(), body.Email, body.Password)
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrUnreachable):
			writeErr(w, http.StatusServiceUnavailable, auth.HRISUnreachableMessage)
		case errors.Is(err, auth.ErrInvalidCredentials):
			writeErr(w, http.StatusUnauthorized, "[email atau password salah]")
		default:
			writeErr(w, http.StatusServiceUnavailable, auth.HRISUnreachableMessage)
		}
		return
	}

	// Must be an active, synced employee.
	if err := auth.LookupActiveEmployee(r.Context(), a.DB, empID); err != nil {
		writeErr(w, http.StatusUnauthorized, "[akun tidak aktif atau tidak terdaftar di CDPS]")
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
	writeJSON(w, http.StatusOK, identityOf(actor))
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
	writeJSON(w, http.StatusOK, identityOf(actor))
}
