package auth

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"time"
)

// CookieName is the CDPS session cookie.
const CookieName = "cdps_session"

// SessionTTL is how long a CDPS session lives.
const SessionTTL = 12 * time.Hour

// ErrNoSession indicates the session is missing, expired, revoked, or bound to
// an inactive employee.
var ErrNoSession = errors.New("auth: no valid session")

// NewToken returns a random opaque session token.
func NewToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// CreateSession issues a new session for an employee.
func CreateSession(ctx context.Context, d *sql.DB, employeeID string) (string, error) {
	tok, err := NewToken()
	if err != nil {
		return "", err
	}
	_, err = d.ExecContext(ctx,
		`INSERT INTO sessions (token, employee_id, expires_at, created_by) VALUES (?, ?, ?, ?)`,
		tok, employeeID, time.Now().Add(SessionTTL), employeeID)
	if err != nil {
		return "", err
	}
	return tok, nil
}

// RevokeSession revokes a single session by token (idempotent).
func RevokeSession(ctx context.Context, d *sql.DB, token string) error {
	_, err := d.ExecContext(ctx,
		`UPDATE sessions SET revoked_at = NOW() WHERE token = ? AND revoked_at IS NULL`, token)
	return err
}

// RevokeAllSessions revokes every active session of an employee (idempotent).
func RevokeAllSessions(ctx context.Context, d *sql.DB, employeeID string) error {
	_, err := d.ExecContext(ctx,
		`UPDATE sessions SET revoked_at = NOW() WHERE employee_id = ? AND revoked_at IS NULL`, employeeID)
	return err
}

// RevokeOtherSessions revokes every active session of an employee EXCEPT the
// given token (used after a self password change to keep the current session).
func RevokeOtherSessions(ctx context.Context, d *sql.DB, employeeID, keepToken string) error {
	_, err := d.ExecContext(ctx,
		`UPDATE sessions SET revoked_at = NOW() WHERE employee_id = ? AND token <> ? AND revoked_at IS NULL`,
		employeeID, keepToken)
	return err
}

// ResolveSession returns the employee id for a valid session token: not expired,
// not revoked, and bound to an ACTIVE employee. Otherwise ErrNoSession.
func ResolveSession(ctx context.Context, d *sql.DB, token string) (string, error) {
	if token == "" {
		return "", ErrNoSession
	}
	var employeeID string
	var expiresAt time.Time
	var revoked sql.NullTime
	var active bool
	err := d.QueryRowContext(ctx,
		`SELECT s.employee_id, s.expires_at, s.revoked_at, e.status_aktif
		   FROM sessions s JOIN employees e ON e.employee_id = s.employee_id
		  WHERE s.token = ?`, token).Scan(&employeeID, &expiresAt, &revoked, &active)
	if err == sql.ErrNoRows {
		return "", ErrNoSession
	}
	if err != nil {
		return "", err
	}
	if revoked.Valid || time.Now().After(expiresAt) || !active {
		return "", ErrNoSession
	}
	return employeeID, nil
}
