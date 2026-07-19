package main

import (
	"context"
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/auth"
)

// fixtureCSV is the bundled demo roster used by demo/QA mode.
const fixtureCSV = "../../testdata/employees.csv"

func TestCSVAuthenticator(t *testing.T) {
	a, err := newCSVAuthenticator(fixtureCSV)
	if err != nil {
		t.Fatalf("load fixture: %v", err)
	}
	ctx := context.Background()

	t.Run("valid credentials return the employee id", func(t *testing.T) {
		id, err := a.Verify(ctx, "budi@mea.co.id", "rahasia123")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if id != "EMP-0001" {
			t.Fatalf("got %q, want EMP-0001", id)
		}
	})

	t.Run("email match is case-insensitive", func(t *testing.T) {
		id, err := a.Verify(ctx, "  YOHAN@MEA.CO.ID ", "rahasia123")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if id != "EMP-0008" {
			t.Fatalf("got %q, want EMP-0008", id)
		}
	})

	t.Run("wrong password is rejected", func(t *testing.T) {
		if _, err := a.Verify(ctx, "budi@mea.co.id", "salah"); !errors.Is(err, auth.ErrInvalidCredentials) {
			t.Fatalf("want ErrInvalidCredentials, got %v", err)
		}
	})

	t.Run("unknown email is rejected", func(t *testing.T) {
		if _, err := a.Verify(ctx, "nobody@mea.co.id", "rahasia123"); !errors.Is(err, auth.ErrInvalidCredentials) {
			t.Fatalf("want ErrInvalidCredentials, got %v", err)
		}
	})
}
