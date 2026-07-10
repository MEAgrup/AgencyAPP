package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/hris"
)

// Errors returned by Service, in addition to hris.ErrInvalidCredentials and
// hris.ErrHRISUnreachable which Login passes through unchanged from the
// Authenticator (docs/HRIS API CONTRACT.md §3: HRIS-unreachable is a typed
// error the API layer maps to msg.HRISTidakDapatDihubungi).
var (
	// ErrUnknownOrInactiveEmployee is returned when HRIS verifies the
	// credentials but the employee has no active row in the CDPS employees
	// mirror (never synced, or status_aktif=false).
	ErrUnknownOrInactiveEmployee = errors.New("unknown or inactive employee")
	// ErrInvalidSession is returned by Authenticate for a token that does not
	// resolve to a live, unexpired, unrevoked session.
	ErrInvalidSession = errors.New("invalid or expired session")
)

// Session is the resolved identity behind a valid CDPS token. Later tickets
// (S0-08 role mapping) key off Divisi/Jabatan.
type Session struct {
	EmployeeID string
	Nama       string
	Email      string
	Divisi     string
	Jabatan    string
}

// Service issues and validates CDPS sessions bound to HRIS-verified
// employees. It holds NO password of any kind.
type Service struct {
	DB            *sql.DB
	Authenticator hris.Authenticator
	// TTL is the session lifetime; required (no default — Sprint 0 does not
	// fix a house-wide value, see final report ambiguity note).
	TTL time.Duration
	// Now defaults to time.Now when nil; override in tests for determinism.
	Now func() time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// Login verifies email+password against the HRIS (failing closed on
// hris.ErrHRISUnreachable — no cached-password fallback), requires the
// employee to exist in the CDPS employees mirror and be status_aktif, then
// issues a new session. The plaintext token is returned once; only its
// SHA-256 hash is stored.
func (s *Service) Login(ctx context.Context, email, password string) (token string, employeeID string, err error) {
	if s.TTL <= 0 {
		return "", "", fmt.Errorf("auth: Service.TTL must be positive")
	}

	empID, err := s.Authenticator.Verify(ctx, email, password)
	if err != nil {
		// Pass through hris.ErrInvalidCredentials / hris.ErrHRISUnreachable
		// unchanged so the API layer can map them to the exact BI messages.
		return "", "", err
	}

	var active bool
	row := s.DB.QueryRowContext(ctx, `SELECT status_aktif FROM employees WHERE employee_id = ?`, empID)
	if scanErr := row.Scan(&active); scanErr != nil {
		if errors.Is(scanErr, sql.ErrNoRows) {
			return "", "", ErrUnknownOrInactiveEmployee
		}
		return "", "", fmt.Errorf("auth: lookup employee %s: %w", empID, scanErr)
	}
	if !active {
		return "", "", ErrUnknownOrInactiveEmployee
	}

	token, err = newToken()
	if err != nil {
		return "", "", fmt.Errorf("auth: generate token: %w", err)
	}
	now := s.now()
	_, err = s.DB.ExecContext(ctx, `
		INSERT INTO sessions (token_hash, employee_id, created_at, expires_at)
		VALUES (?, ?, ?, ?)`,
		hashToken(token), empID, now, now.Add(s.TTL))
	if err != nil {
		return "", "", fmt.Errorf("auth: create session: %w", err)
	}

	return token, empID, nil
}

// Authenticate resolves a bearer token to the employee behind it. It rejects
// unknown, expired, or revoked sessions, and rejects sessions whose employee
// is no longer status_aktif even if the session itself is still live (e.g. a
// deactivation that raced ahead of the session's natural expiry, or a
// deactivation sync that ran without revoking — defense in depth alongside
// Syncer's explicit revoke-on-deactivate).
func (s *Service) Authenticate(ctx context.Context, token string) (*Session, error) {
	var employeeID string
	var expiresAt time.Time
	var revokedAt sql.NullTime

	row := s.DB.QueryRowContext(ctx, `
		SELECT employee_id, expires_at, revoked_at FROM sessions WHERE token_hash = ?`, hashToken(token))
	if err := row.Scan(&employeeID, &expiresAt, &revokedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrInvalidSession
		}
		return nil, fmt.Errorf("auth: lookup session: %w", err)
	}

	now := s.now()
	if revokedAt.Valid || !now.Before(expiresAt) {
		return nil, ErrInvalidSession
	}

	var sess Session
	sess.EmployeeID = employeeID
	var active bool
	row = s.DB.QueryRowContext(ctx, `
		SELECT nama, email, divisi, jabatan, status_aktif FROM employees WHERE employee_id = ?`, employeeID)
	if err := row.Scan(&sess.Nama, &sess.Email, &sess.Divisi, &sess.Jabatan, &active); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrUnknownOrInactiveEmployee
		}
		return nil, fmt.Errorf("auth: lookup employee %s: %w", employeeID, err)
	}
	if !active {
		return nil, ErrUnknownOrInactiveEmployee
	}

	return &sess, nil
}

// Logout revokes the session behind token. Idempotent: revoking twice, or
// revoking an already-expired/unknown token, is not an error.
func (s *Service) Logout(ctx context.Context, token string) error {
	_, err := s.DB.ExecContext(ctx, `
		UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`,
		s.now(), hashToken(token))
	if err != nil {
		return fmt.Errorf("auth: revoke session: %w", err)
	}
	return nil
}

func newToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
