// Package auth handles login via the HRIS (S0-07) and CDPS-owned sessions.
// CDPS never stores a password; it forwards credentials to the HRIS for
// verification and then issues its own opaque session bound to the synced,
// active employee record.
package auth

import (
	"context"
	"errors"
)

// HRISUnreachableMessage is the exact BI message returned when the HRIS cannot
// be reached at login (fail closed — no cached-password fallback).
const HRISUnreachableMessage = "[sistem HRIS tidak dapat dihubungi, coba beberapa saat lagi]"

// Sentinel errors from an Authenticator.
var (
	// ErrInvalidCredentials => 401 rejected.
	ErrInvalidCredentials = errors.New("auth: invalid credentials")
	// ErrUnreachable => 503 with HRISUnreachableMessage (fail closed).
	ErrUnreachable = errors.New("auth: hris unreachable")
)

// Authenticator verifies end-user credentials against the HRIS. It returns the
// HRIS employee_id on success. Implementations must map connection failures to
// ErrUnreachable and bad credentials to ErrInvalidCredentials.
type Authenticator interface {
	Verify(ctx context.Context, email, password string) (employeeID string, err error)
}
