package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// HRISAuthenticator verifies credentials via POST /api/v1/auth/verify
// (docs/HRIS_API_CONTRACT.md §2).
type HRISAuthenticator struct {
	BaseURL string
	Client  *http.Client
}

// NewHRISAuthenticator builds an HRIS-backed authenticator.
func NewHRISAuthenticator(baseURL string) *HRISAuthenticator {
	return &HRISAuthenticator{BaseURL: baseURL, Client: &http.Client{Timeout: 10 * time.Second}}
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

// Verify implements Authenticator.
func (h *HRISAuthenticator) Verify(ctx context.Context, email, password string) (string, error) {
	body, _ := json.Marshal(verifyRequest{Email: email, Password: password})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.BaseURL+"/api/v1/auth/verify", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := h.Client.Do(req)
	if err != nil {
		// Network / connection failure => fail closed.
		return "", ErrUnreachable
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		var vr verifyResponse
		if err := json.NewDecoder(resp.Body).Decode(&vr); err != nil {
			return "", err
		}
		if !vr.Valid || vr.EmployeeID == "" {
			return "", ErrInvalidCredentials
		}
		return vr.EmployeeID, nil
	case http.StatusUnauthorized:
		return "", ErrInvalidCredentials
	case http.StatusServiceUnavailable, http.StatusBadGateway, http.StatusGatewayTimeout:
		return "", ErrUnreachable
	default:
		return "", fmt.Errorf("auth: unexpected HRIS status %d", resp.StatusCode)
	}
}
