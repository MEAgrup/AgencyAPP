package auth_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/auth"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
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

// TestResolveActor_LayeredRoles checks that each layered role resolves onto
// the correct, distinct Role flag — in particular that "viewer" sets
// Role.Viewer without ever setting Role.OD or Role.Director (viewer is read-
// only everywhere like OD, but carries none of OD's OKR/other authority).
func TestResolveActor_LayeredRoles(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()

	testutil.InsertEmployee(t, d, "EMP-0900", "Vira", "vira@mea.co.id", "Data & BI", "Analyst", true)
	testutil.InsertLayeredRole(t, d, "EMP-0900", "viewer")

	testutil.InsertEmployee(t, d, "EMP-0901", "Oskar", "oskar@mea.co.id", "Operasional", "OD", true)
	testutil.InsertLayeredRole(t, d, "EMP-0901", "od")

	testutil.InsertEmployee(t, d, "EMP-0902", "Dara", "dara@mea.co.id", "Management", "Director", true)
	testutil.InsertLayeredRole(t, d, "EMP-0902", "director")

	viewerActor, err := auth.ResolveActor(ctx, d, "EMP-0900")
	if err != nil {
		t.Fatal(err)
	}
	if !viewerActor.Role.Viewer {
		t.Fatal("Role.Viewer must be true for viewer layered role")
	}
	if viewerActor.Role.OD || viewerActor.Role.Director {
		t.Fatalf("viewer must not also resolve as OD/Director, got %+v", viewerActor.Role)
	}

	odActor, err := auth.ResolveActor(ctx, d, "EMP-0901")
	if err != nil {
		t.Fatal(err)
	}
	if !odActor.Role.OD || odActor.Role.Viewer || odActor.Role.Director {
		t.Fatalf("od resolution unexpected: %+v", odActor.Role)
	}

	directorActor, err := auth.ResolveActor(ctx, d, "EMP-0902")
	if err != nil {
		t.Fatal(err)
	}
	if !directorActor.Role.Director || directorActor.Role.Viewer || directorActor.Role.OD {
		t.Fatalf("director resolution unexpected: %+v", directorActor.Role)
	}
}
