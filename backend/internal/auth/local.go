package auth

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// Password policy and lockout constants.
const (
	// MinPasswordLen is the minimum password length in characters.
	MinPasswordLen = 8
	// MaxPasswordBytes is the bcrypt input limit (a longer input is truncated by
	// bcrypt, so we reject it up front to avoid a silent surprise).
	MaxPasswordBytes = 72
	// MaxFailedAttempts locks the account when reached (consecutive failures).
	MaxFailedAttempts = 5
	// LockDuration is how long an account stays locked after MaxFailedAttempts.
	LockDuration = 15 * time.Minute
)

// Sentinel errors mapped to HTTP status + BI messages by the handlers.
var (
	// ErrInvalidCredentials => 401 [email atau password salah].
	ErrInvalidCredentials = errors.New("auth: invalid credentials")
	// ErrNotProvisioned => 401 (active employee, no credentials row yet).
	ErrNotProvisioned = errors.New("auth: account not provisioned")
	// ErrLocked => 423 (locked_until in the future).
	ErrLocked = errors.New("auth: account locked")
	// ErrOldPasswordMismatch => 401 [password lama tidak sesuai].
	ErrOldPasswordMismatch = errors.New("auth: old password mismatch")
	// ErrWeakPassword => 400 [password minimal 8 karakter].
	ErrWeakPassword = errors.New("auth: password too short")
	// ErrPasswordTooLong => 400 [password maksimal 72 karakter].
	ErrPasswordTooLong = errors.New("auth: password too long")
	// ErrForbidden => 403 (admin not allowed to manage the target).
	ErrForbidden = errors.New("auth: forbidden")
)

// validatePassword enforces the length policy (chars min, bytes max).
func validatePassword(p string) error {
	if len([]rune(p)) < MinPasswordLen {
		return ErrWeakPassword
	}
	if len(p) > MaxPasswordBytes {
		return ErrPasswordTooLong
	}
	return nil
}

// VerifyLocal authenticates an active employee by email + password against the
// locally stored bcrypt hash, applying the failed-attempt lockout. It returns
// the employee id and whether a forced password change is pending.
//
// Ordering matters: the lock is checked BEFORE the hash, so a correct password
// is still rejected while the account is locked.
func VerifyLocal(ctx context.Context, d *sql.DB, email, password string) (empID string, mustChange bool, err error) {
	// Resolve the employee. An unknown email or a deactivated employee is
	// reported with the same generic credentials error (no account enumeration).
	var active bool
	err = d.QueryRowContext(ctx,
		`SELECT employee_id, status_aktif FROM employees WHERE email = ?`, email).Scan(&empID, &active)
	if err == sql.ErrNoRows || (err == nil && !active) {
		return "", false, ErrInvalidCredentials
	}
	if err != nil {
		return "", false, err
	}

	var (
		hash           string
		failedAttempts int
		lockedUntil    sql.NullTime
		mustChangeFlag bool
	)
	err = d.QueryRowContext(ctx,
		`SELECT password_hash, must_change_password, failed_attempts, locked_until
		   FROM employee_credentials WHERE employee_id = ?`, empID).
		Scan(&hash, &mustChangeFlag, &failedAttempts, &lockedUntil)
	if err == sql.ErrNoRows {
		return "", false, ErrNotProvisioned
	}
	if err != nil {
		return "", false, err
	}

	// Locked window: reject before verifying the hash.
	if lockedUntil.Valid && lockedUntil.Time.After(time.Now()) {
		return "", false, ErrLocked
	}

	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		if err := registerFailure(ctx, d, empID, failedAttempts); err != nil {
			return "", false, err
		}
		return "", false, ErrInvalidCredentials
	}

	// Success: clear the failure counter and any (expired) lock.
	if _, err := d.ExecContext(ctx,
		`UPDATE employee_credentials SET failed_attempts = 0, locked_until = NULL WHERE employee_id = ?`,
		empID); err != nil {
		return "", false, err
	}
	return empID, mustChangeFlag, nil
}

// registerFailure increments the consecutive-failure counter and, on the fifth
// failure, sets the lock and resets the counter so the next post-lock cycle
// starts fresh from one. The lock event is audited (no secret material).
func registerFailure(ctx context.Context, d *sql.DB, empID string, prev int) error {
	next := prev + 1
	if next >= MaxFailedAttempts {
		if _, err := d.ExecContext(ctx,
			`UPDATE employee_credentials SET failed_attempts = 0, locked_until = ? WHERE employee_id = ?`,
			time.Now().Add(LockDuration), empID); err != nil {
			return err
		}
		return audit.Write(ctx, d, audit.Record{
			EntityType: "employee_credential", EntityID: empID, Actor: empID,
			Action: "account_locked", After: map[string]any{"lock_minutes": int(LockDuration.Minutes())},
		})
	}
	_, err := d.ExecContext(ctx,
		`UPDATE employee_credentials SET failed_attempts = ? WHERE employee_id = ?`, next, empID)
	return err
}

// ChangePassword lets a logged-in employee change their own password. It clears
// the force-change gate, revokes every OTHER session, and audits the change.
//
// The failed-attempt lockout is shared with VerifyLocal: the lock is checked
// BEFORE the hash (a correct old password is still rejected while locked), and
// an old-password mismatch increments the SAME counter, so a stolen session
// cannot brute-force the old password without tripping the lock. The success
// path clears the counter and any lock.
func ChangePassword(ctx context.Context, d *sql.DB, empID, keepToken, oldPassword, newPassword string) error {
	var (
		hash           string
		failedAttempts int
		lockedUntil    sql.NullTime
	)
	err := d.QueryRowContext(ctx,
		`SELECT password_hash, failed_attempts, locked_until FROM employee_credentials WHERE employee_id = ?`, empID).
		Scan(&hash, &failedAttempts, &lockedUntil)
	if err == sql.ErrNoRows {
		return ErrNotProvisioned
	}
	if err != nil {
		return err
	}
	// Locked window: reject before verifying the hash.
	if lockedUntil.Valid && lockedUntil.Time.After(time.Now()) {
		return ErrLocked
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(oldPassword)) != nil {
		if err := registerFailure(ctx, d, empID, failedAttempts); err != nil {
			return err
		}
		return ErrOldPasswordMismatch
	}
	if err := validatePassword(newPassword); err != nil {
		return err
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	if _, err := d.ExecContext(ctx,
		`UPDATE employee_credentials
		    SET password_hash = ?, must_change_password = 0, password_changed_at = NOW(),
		        failed_attempts = 0, locked_until = NULL
		  WHERE employee_id = ?`, string(newHash), empID); err != nil {
		return err
	}
	if err := RevokeOtherSessions(ctx, d, empID, keepToken); err != nil {
		return err
	}
	return audit.Write(ctx, d, audit.Record{
		EntityType: "employee_credential", EntityID: empID, Actor: empID,
		Action: "password_changed_self", After: map[string]any{"must_change_password": false},
	})
}

// SetPassword lets an authorized admin set a temporary password for a target
// employee, forcing a change on next login. It revokes all of the target's
// sessions and audits the action.
func SetPassword(ctx context.Context, d *sql.DB, admin permission.Actor, targetID, tempPassword string) error {
	// Only Director or a division Lead can ever set a password.
	if !admin.Role.Director && admin.Role.Level != permission.LevelLead {
		return ErrForbidden
	}

	// Target must exist (active or not — a reactivated employee keeps its creds).
	var divisi, jabatan string
	err := d.QueryRowContext(ctx,
		`SELECT divisi, jabatan FROM employees WHERE employee_id = ?`, targetID).Scan(&divisi, &jabatan)
	if err == sql.ErrNoRows {
		return ErrEmployeeNotFound
	}
	if err != nil {
		return err
	}

	ok, err := adminMayManage(ctx, d, admin, targetID, divisi, jabatan)
	if err != nil {
		return err
	}
	if !ok {
		return ErrForbidden
	}

	if err := validatePassword(tempPassword); err != nil {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(tempPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	if _, err := d.ExecContext(ctx,
		`INSERT INTO employee_credentials (employee_id, password_hash, must_change_password, failed_attempts, locked_until, created_by)
		 VALUES (?, ?, 1, 0, NULL, ?)
		 ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), must_change_password = 1,
		                         failed_attempts = 0, locked_until = NULL`,
		targetID, string(hash), admin.EmployeeID); err != nil {
		return err
	}
	if err := RevokeAllSessions(ctx, d, targetID); err != nil {
		return err
	}
	return audit.Write(ctx, d, audit.Record{
		EntityType: "employee_credential", EntityID: targetID, Actor: admin.EmployeeID,
		Action: "password_set_admin", After: map[string]any{"must_change_password": true},
	})
}

// adminMayManage applies the authorization rule for admin password management:
// Director -> everyone; Lead -> same-division targets that are NOT layered
// (od/director) — a target with no role mapping is manageable by Director only.
func adminMayManage(ctx context.Context, d *sql.DB, admin permission.Actor, targetID, divisi, jabatan string) (bool, error) {
	if admin.Role.Director {
		return true, nil
	}
	if admin.Role.Level != permission.LevelLead || admin.Role.Division == "" {
		return false, nil
	}
	// Target's mapped division.
	var division sql.NullString
	err := d.QueryRowContext(ctx,
		`SELECT division FROM role_mappings WHERE divisi = ? AND jabatan = ?`, divisi, jabatan).Scan(&division)
	if err == sql.ErrNoRows || (err == nil && !division.Valid) {
		return false, nil // no mapping => Director only
	}
	if err != nil {
		return false, err
	}
	if division.String != admin.Role.Division {
		return false, nil
	}
	// A layered (od/director) target cannot be managed by a Lead (no escalation).
	var layered int
	if err := d.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM employee_layered_roles WHERE employee_id = ? AND enabled = 1 AND role IN ('od','director')`,
		targetID).Scan(&layered); err != nil {
		return false, err
	}
	return layered == 0, nil
}

// MustChangePassword reports whether the employee has a pending forced change.
// A missing credentials row reports false (login is impossible without one, so
// the force-change gate never applies to it).
func MustChangePassword(ctx context.Context, d *sql.DB, empID string) (bool, error) {
	var must bool
	err := d.QueryRowContext(ctx,
		`SELECT must_change_password FROM employee_credentials WHERE employee_id = ?`, empID).Scan(&must)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return must, nil
}

// CredentialInfo is one row of the admin credentials panel.
type CredentialInfo struct {
	EmployeeID         string     `json:"employee_id"`
	Nama               string     `json:"nama"`
	Email              string     `json:"email"`
	Divisi             string     `json:"divisi"`
	Jabatan            string     `json:"jabatan"`
	HasPassword        bool       `json:"has_password"`
	MustChangePassword bool       `json:"must_change_password"`
	LockedUntil        *time.Time `json:"locked_until"`
	PasswordChangedAt  *time.Time `json:"password_changed_at"`
}

// ListCredentials returns the credential status of active employees visible to
// the admin: Director -> everyone; Lead -> own division; others -> ErrForbidden.
func ListCredentials(ctx context.Context, d *sql.DB, admin permission.Actor) ([]CredentialInfo, error) {
	if !admin.Role.Director && admin.Role.Level != permission.LevelLead {
		return nil, ErrForbidden
	}

	q := `SELECT e.employee_id, e.nama, e.email, e.divisi, e.jabatan,
	             c.employee_id IS NOT NULL AS has_password,
	             COALESCE(c.must_change_password, 0),
	             c.locked_until, c.password_changed_at
	        FROM employees e
	        LEFT JOIN role_mappings rm ON rm.divisi = e.divisi AND rm.jabatan = e.jabatan
	        LEFT JOIN employee_credentials c ON c.employee_id = e.employee_id
	       WHERE e.status_aktif = 1`
	var args []any
	if !admin.Role.Director {
		q += ` AND rm.division = ?`
		args = append(args, admin.Role.Division)
	}
	q += ` ORDER BY e.employee_id`

	rows, err := d.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CredentialInfo{} // non-nil so the API renders [] (not null) when empty
	for rows.Next() {
		var ci CredentialInfo
		var locked, changed sql.NullTime
		if err := rows.Scan(&ci.EmployeeID, &ci.Nama, &ci.Email, &ci.Divisi, &ci.Jabatan,
			&ci.HasPassword, &ci.MustChangePassword, &locked, &changed); err != nil {
			return nil, err
		}
		if locked.Valid {
			t := locked.Time
			ci.LockedUntil = &t
		}
		if changed.Valid {
			t := changed.Time
			ci.PasswordChangedAt = &t
		}
		out = append(out, ci)
	}
	return out, rows.Err()
}
