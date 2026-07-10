// Package auth implements S0-07: CDPS never stores end-user passwords. Login
// delegates credential verification to the HRIS (docs/HRIS API CONTRACT.md
// §2) and CDPS issues its own opaque session bound to the synced employee
// record (internal/core/hris).
package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/meagrup/agencyapp/backend/internal/core/hris"
)

// HTTPAuthenticator implements hris.Authenticator against
// POST /api/v1/auth/verify per docs/HRIS API CONTRACT.md §2.
type HTTPAuthenticator struct {
	// BaseURL is the HRIS root, e.g. "https://hris.internal". Required.
	BaseURL string
	// ServiceToken is sent as "Authorization: Bearer <token>" on the
	// server-to-server call, per the contract's global Security section.
	ServiceToken string
	// HTTPClient defaults to http.DefaultClient when nil.
	HTTPClient *http.Client
}

type verifyRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type verifyResponse struct {
	Valid      bool   `json:"valid"`
	EmployeeID string `json:"employee_id"`
	Reason     string `json:"reason"`
}

var _ hris.Authenticator = (*HTTPAuthenticator)(nil)

// Verify implements hris.Authenticator.
func (a *HTTPAuthenticator) Verify(ctx context.Context, email, password string) (string, error) {
	if a.BaseURL == "" {
		return "", fmt.Errorf("auth: HTTPAuthenticator.BaseURL is required")
	}
	client := a.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}

	payload, err := json.Marshal(verifyRequest{Email: email, Password: password})
	if err != nil {
		return "", fmt.Errorf("auth: encode verify request: %w", err)
	}

	url := strings.TrimRight(a.BaseURL, "/") + "/api/v1/auth/verify"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("auth: build verify request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if a.ServiceToken != "" {
		req.Header.Set("Authorization", "Bearer "+a.ServiceToken)
	}

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("%w: %v", hris.ErrHRISUnreachable, err)
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusOK:
		var out verifyResponse
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
			return "", fmt.Errorf("auth: decode verify response: %w", err)
		}
		if !out.Valid || out.EmployeeID == "" {
			return "", hris.ErrInvalidCredentials
		}
		return out.EmployeeID, nil
	case resp.StatusCode == http.StatusUnauthorized:
		return "", hris.ErrInvalidCredentials
	case resp.StatusCode >= 500:
		return "", fmt.Errorf("%w: verify status %d", hris.ErrHRISUnreachable, resp.StatusCode)
	default:
		return "", fmt.Errorf("auth: verify unexpected status %d", resp.StatusCode)
	}
}
