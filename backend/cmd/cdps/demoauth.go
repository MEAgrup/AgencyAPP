package main

import (
	"context"
	"os"
	"strings"

	"github.com/meagrup/agencyapp/backend/internal/auth"
	"github.com/meagrup/agencyapp/backend/internal/hris"
)

// csvAuthenticator verifies credentials against the bundled fixture CSV. It is
// used ONLY in demo/QA mode (CDPS_DEMO_MODE=1) when no real HRIS is available,
// so a deployed instance can be exercised end-to-end with the seeded accounts.
//
// It implements auth.Authenticator. Like the real HRIS path, CDPS itself stores
// no password — the check is against the fixture file, never the CDPS database.
// The fixture passwords are public, so this MUST never be enabled against real
// data.
type csvAuthenticator struct {
	byEmail map[string]hris.CSVRecord
}

func newCSVAuthenticator(csvPath string) (*csvAuthenticator, error) {
	f, err := os.Open(csvPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	records, err := hris.ParseEmployeeCSV(f)
	if err != nil {
		return nil, err
	}
	byEmail := make(map[string]hris.CSVRecord, len(records))
	for _, r := range records {
		byEmail[strings.ToLower(strings.TrimSpace(r.Employee.Email))] = r
	}
	return &csvAuthenticator{byEmail: byEmail}, nil
}

// Verify returns the fixture employee_id when email+password match, else
// auth.ErrInvalidCredentials (mapped by the login handler to 401).
func (c *csvAuthenticator) Verify(_ context.Context, email, password string) (string, error) {
	rec, ok := c.byEmail[strings.ToLower(strings.TrimSpace(email))]
	if !ok || rec.Password != password {
		return "", auth.ErrInvalidCredentials
	}
	return rec.Employee.EmployeeID, nil
}
