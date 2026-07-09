package auth_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/auth"
)

func TestHRISAuthenticator_Valid(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"valid":true,"employee_id":"EMP-1"}`))
	}))
	defer srv.Close()
	id, err := auth.NewHRISAuthenticator(srv.URL).Verify(context.Background(), "a@mea.co.id", "pw")
	if err != nil {
		t.Fatal(err)
	}
	if id != "EMP-1" {
		t.Fatalf("id=%q want EMP-1", id)
	}
}

func TestHRISAuthenticator_Invalid(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"valid":false,"reason":"invalid_credentials"}`))
	}))
	defer srv.Close()
	_, err := auth.NewHRISAuthenticator(srv.URL).Verify(context.Background(), "a@mea.co.id", "bad")
	if !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("want ErrInvalidCredentials, got %v", err)
	}
}

func TestHRISAuthenticator_Unreachable(t *testing.T) {
	// Point at a closed port (server created then immediately closed).
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	url := srv.URL
	srv.Close()
	_, err := auth.NewHRISAuthenticator(url).Verify(context.Background(), "a@mea.co.id", "pw")
	if !errors.Is(err, auth.ErrUnreachable) {
		t.Fatalf("want ErrUnreachable, got %v", err)
	}
}
