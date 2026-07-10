package auth_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/auth"
	"github.com/meagrup/agencyapp/backend/internal/core/hris"
)

// fakeHRISVerify implements the docs/HRIS API CONTRACT.md §2 contract:
// POST /api/v1/auth/verify -> 200 {valid, employee_id} | 401 {valid:false,...}.
func fakeHRISVerify(t *testing.T, want map[string][2]string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/auth/verify" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer test-service-token" {
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]any{"valid": false, "reason": "bad_service_token"})
			return
		}
		var body struct{ Email, Password string }
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "bad body", http.StatusBadRequest)
			return
		}
		cred, ok := want[body.Email]
		if !ok || cred[0] != body.Password {
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]any{"valid": false, "reason": "invalid_credentials"})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"valid": true, "employee_id": cred[1]})
	}))
}

func TestHTTPAuthenticator_Valid(t *testing.T) {
	srv := fakeHRISVerify(t, map[string][2]string{"sinta@mea.co.id": {"correct-horse", "EMP-0001"}})
	t.Cleanup(srv.Close)

	a := &auth.HTTPAuthenticator{BaseURL: srv.URL, ServiceToken: "test-service-token"}
	id, err := a.Verify(t.Context(), "sinta@mea.co.id", "correct-horse")
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if id != "EMP-0001" {
		t.Fatalf("employee id = %q, want EMP-0001", id)
	}
}

func TestHTTPAuthenticator_InvalidCredentials(t *testing.T) {
	srv := fakeHRISVerify(t, map[string][2]string{"sinta@mea.co.id": {"correct-horse", "EMP-0001"}})
	t.Cleanup(srv.Close)

	a := &auth.HTTPAuthenticator{BaseURL: srv.URL, ServiceToken: "test-service-token"}
	_, err := a.Verify(t.Context(), "sinta@mea.co.id", "wrong")
	if !errors.Is(err, hris.ErrInvalidCredentials) {
		t.Fatalf("err = %v, want hris.ErrInvalidCredentials", err)
	}
}

func TestHTTPAuthenticator_Unreachable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)

	a := &auth.HTTPAuthenticator{BaseURL: srv.URL, ServiceToken: "test-service-token"}
	_, err := a.Verify(t.Context(), "sinta@mea.co.id", "whatever")
	if !errors.Is(err, hris.ErrHRISUnreachable) {
		t.Fatalf("err = %v, want hris.ErrHRISUnreachable for a 5xx", err)
	}
}

func TestHTTPAuthenticator_ConnectionRefused(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	srv.Close() // guarantees connection refused: nothing is listening anymore

	a := &auth.HTTPAuthenticator{BaseURL: srv.URL, ServiceToken: "test-service-token"}
	_, err := a.Verify(t.Context(), "sinta@mea.co.id", "whatever")
	if !errors.Is(err, hris.ErrHRISUnreachable) {
		t.Fatalf("err = %v, want hris.ErrHRISUnreachable for a connection error", err)
	}
}
