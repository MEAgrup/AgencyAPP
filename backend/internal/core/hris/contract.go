// Package hris integrates with MEA's existing HRIS — the single source of
// truth for people data (docs/HRIS API CONTRACT.md). CDPS never keeps its
// own employee master or password store.
package hris

import (
	"context"
	"errors"
	"time"
)

type Employee struct {
	EmployeeID  string
	Nama        string
	Email       string
	Divisi      string
	Jabatan     string
	StatusAktif bool
	UpdatedAt   time.Time
}

// EmployeeSource abstracts where employees come from: HTTP (production) or
// CSV import (dev/staging contingency, Build Plan R1). Consumers must not
// care which implementation is wired.
type EmployeeSource interface {
	// Fetch returns employees updated since the given time; zero time means
	// full sync.
	Fetch(ctx context.Context, updatedSince time.Time) ([]Employee, error)
}

// Authenticator verifies end-user credentials against the HRIS.
type Authenticator interface {
	// Verify returns the HRIS employee_id on success.
	Verify(ctx context.Context, email, password string) (string, error)
}

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	// ErrHRISUnreachable maps to msg.HRISTidakDapatDihubungi at the API layer;
	// login fails closed (no cached-password fallback).
	ErrHRISUnreachable = errors.New("hris unreachable")
)
