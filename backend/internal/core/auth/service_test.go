package auth_test

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/auth"
	"github.com/meagrup/agencyapp/backend/internal/core/hris"
	"github.com/meagrup/agencyapp/backend/internal/core/testdb"
)

// fakeAuthenticator implements hris.Authenticator directly against an
// in-memory credential map, so tests don't need to exercise HTTPAuthenticator
// (that gets its own httptest-backed tests below) to test Service's login
// state-machine behavior.
type fakeAuthenticator struct {
	// email -> (password, employee_id)
	creds       map[string][2]string
	unreachable bool
}

func (f *fakeAuthenticator) Verify(_ context.Context, email, password string) (string, error) {
	if f.unreachable {
		return "", hris.ErrHRISUnreachable
	}
	cred, ok := f.creds[email]
	if !ok || cred[0] != password {
		return "", hris.ErrInvalidCredentials
	}
	return cred[1], nil
}

func seedEmployee(t *testing.T, db *sql.DB, id, email string, active bool) {
	t.Helper()
	now := time.Now().UTC()
	_, err := db.Exec(`
		INSERT INTO employees (employee_id, nama, email, divisi, jabatan, status_aktif, hris_updated_at, created_at, updated_at)
		VALUES (?, ?, ?, 'Account', 'Account Manager', ?, ?, ?, ?)`,
		id, "Test User", email, active, now, now, now)
	if err != nil {
		t.Fatalf("seed employee: %v", err)
	}
}

func newService(t *testing.T, authr hris.Authenticator) (*auth.Service, *sql.DB) {
	t.Helper()
	db := testdb.New(t)
	return &auth.Service{DB: db, Authenticator: authr, TTL: time.Hour}, db
}

func TestLogin_HappyPath(t *testing.T) {
	fa := &fakeAuthenticator{creds: map[string][2]string{"sinta@mea.co.id": {"correct-horse", "EMP-0001"}}}
	svc, db := newService(t, fa)
	seedEmployee(t, db, "EMP-0001", "sinta@mea.co.id", true)

	token, employeeID, err := svc.Login(context.Background(), "sinta@mea.co.id", "correct-horse")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if employeeID != "EMP-0001" {
		t.Fatalf("employeeID = %q, want EMP-0001", employeeID)
	}
	if token == "" {
		t.Fatalf("expected a non-empty token")
	}

	sess, err := svc.Authenticate(context.Background(), token)
	if err != nil {
		t.Fatalf("authenticate freshly issued token: %v", err)
	}
	if sess.EmployeeID != "EMP-0001" || sess.Email != "sinta@mea.co.id" {
		t.Fatalf("unexpected session: %+v", sess)
	}

	// The plaintext token must never be recoverable from storage: only its
	// hash exists in sessions, so a lookup by the raw token as if it were a
	// hash must not match anything else stored.
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE token_hash = ?`, token).Scan(&count); err != nil {
		t.Fatalf("count sessions: %v", err)
	}
	if count != 0 {
		t.Fatalf("plaintext token must not be stored as its own hash")
	}
}

func TestLogin_InvalidCredentials(t *testing.T) {
	fa := &fakeAuthenticator{creds: map[string][2]string{"sinta@mea.co.id": {"correct-horse", "EMP-0001"}}}
	svc, db := newService(t, fa)
	seedEmployee(t, db, "EMP-0001", "sinta@mea.co.id", true)

	_, _, err := svc.Login(context.Background(), "sinta@mea.co.id", "wrong-password")
	if !errors.Is(err, hris.ErrInvalidCredentials) {
		t.Fatalf("err = %v, want hris.ErrInvalidCredentials", err)
	}
}

func TestLogin_UnknownEmployeeRejected(t *testing.T) {
	fa := &fakeAuthenticator{creds: map[string][2]string{"ghost@mea.co.id": {"pw", "EMP-9999"}}}
	svc, _ := newService(t, fa)
	// EMP-9999 verified fine by HRIS but was never synced into CDPS.

	_, _, err := svc.Login(context.Background(), "ghost@mea.co.id", "pw")
	if !errors.Is(err, auth.ErrUnknownOrInactiveEmployee) {
		t.Fatalf("err = %v, want ErrUnknownOrInactiveEmployee", err)
	}
}

func TestLogin_InactiveEmployeeRejected(t *testing.T) {
	fa := &fakeAuthenticator{creds: map[string][2]string{"sinta@mea.co.id": {"correct-horse", "EMP-0001"}}}
	svc, db := newService(t, fa)
	seedEmployee(t, db, "EMP-0001", "sinta@mea.co.id", false) // deactivated in HRIS

	_, _, err := svc.Login(context.Background(), "sinta@mea.co.id", "correct-horse")
	if !errors.Is(err, auth.ErrUnknownOrInactiveEmployee) {
		t.Fatalf("err = %v, want ErrUnknownOrInactiveEmployee", err)
	}
}

func TestLogin_HRISUnreachableFailsClosed(t *testing.T) {
	fa := &fakeAuthenticator{unreachable: true}
	svc, db := newService(t, fa)
	seedEmployee(t, db, "EMP-0001", "sinta@mea.co.id", true)

	_, _, err := svc.Login(context.Background(), "sinta@mea.co.id", "anything")
	if !errors.Is(err, hris.ErrHRISUnreachable) {
		t.Fatalf("err = %v, want hris.ErrHRISUnreachable", err)
	}
	// The BI message this maps to at the API layer (msg.HRISTidakDapatDihubungi)
	// is a compile-time string constant in internal/core/msg; this test just
	// asserts the typed sentinel error is surfaced unchanged so that mapping
	// can happen.
}

func TestAuthenticate_InvalidUnknownToken(t *testing.T) {
	svc, _ := newService(t, &fakeAuthenticator{})
	_, err := svc.Authenticate(context.Background(), "no-such-token")
	if !errors.Is(err, auth.ErrInvalidSession) {
		t.Fatalf("err = %v, want ErrInvalidSession", err)
	}
}

func TestLogout_RevokesToken(t *testing.T) {
	fa := &fakeAuthenticator{creds: map[string][2]string{"sinta@mea.co.id": {"pw", "EMP-0001"}}}
	svc, db := newService(t, fa)
	seedEmployee(t, db, "EMP-0001", "sinta@mea.co.id", true)

	token, _, err := svc.Login(context.Background(), "sinta@mea.co.id", "pw")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if _, err := svc.Authenticate(context.Background(), token); err != nil {
		t.Fatalf("authenticate before logout: %v", err)
	}

	if err := svc.Logout(context.Background(), token); err != nil {
		t.Fatalf("logout: %v", err)
	}

	if _, err := svc.Authenticate(context.Background(), token); !errors.Is(err, auth.ErrInvalidSession) {
		t.Fatalf("err after logout = %v, want ErrInvalidSession", err)
	}

	// Logout is idempotent.
	if err := svc.Logout(context.Background(), token); err != nil {
		t.Fatalf("second logout: %v", err)
	}
}

func TestAuthenticate_ExpiredToken(t *testing.T) {
	fa := &fakeAuthenticator{creds: map[string][2]string{"sinta@mea.co.id": {"pw", "EMP-0001"}}}
	db := testdb.New(t)
	clock := time.Date(2026, 7, 10, 8, 0, 0, 0, time.UTC)
	svc := &auth.Service{DB: db, Authenticator: fa, TTL: time.Minute, Now: func() time.Time { return clock }}
	seedEmployee(t, db, "EMP-0001", "sinta@mea.co.id", true)

	token, _, err := svc.Login(context.Background(), "sinta@mea.co.id", "pw")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if _, err := svc.Authenticate(context.Background(), token); err != nil {
		t.Fatalf("authenticate immediately after login: %v", err)
	}

	clock = clock.Add(2 * time.Minute) // past the 1-minute TTL
	if _, err := svc.Authenticate(context.Background(), token); !errors.Is(err, auth.ErrInvalidSession) {
		t.Fatalf("err after expiry = %v, want ErrInvalidSession", err)
	}
}

func TestAuthenticate_DeactivationBlocksLiveSession(t *testing.T) {
	fa := &fakeAuthenticator{creds: map[string][2]string{"sinta@mea.co.id": {"pw", "EMP-0001"}}}
	svc, db := newService(t, fa)
	seedEmployee(t, db, "EMP-0001", "sinta@mea.co.id", true)

	token, _, err := svc.Login(context.Background(), "sinta@mea.co.id", "pw")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if _, err := svc.Authenticate(context.Background(), token); err != nil {
		t.Fatalf("authenticate while active: %v", err)
	}

	// Simulate HRIS deactivation reflected into the employees mirror,
	// without an explicit session revoke (defense in depth: Authenticate
	// itself must reject an inactive employee even with a technically live,
	// unrevoked session).
	if _, err := db.Exec(`UPDATE employees SET status_aktif = 0 WHERE employee_id = ?`, "EMP-0001"); err != nil {
		t.Fatalf("deactivate employee: %v", err)
	}

	if _, err := svc.Authenticate(context.Background(), token); !errors.Is(err, auth.ErrUnknownOrInactiveEmployee) {
		t.Fatalf("err after deactivation = %v, want ErrUnknownOrInactiveEmployee", err)
	}
}

func TestMiddleware(t *testing.T) {
	fa := &fakeAuthenticator{creds: map[string][2]string{"sinta@mea.co.id": {"pw", "EMP-0001"}}}
	svc, db := newService(t, fa)
	seedEmployee(t, db, "EMP-0001", "sinta@mea.co.id", true)

	token, _, err := svc.Login(context.Background(), "sinta@mea.co.id", "pw")
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	var sawEmployeeID string
	handler := auth.Middleware(svc)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sess, ok := auth.FromContext(r.Context())
		if !ok {
			t.Fatalf("session missing from context in protected handler")
		}
		sawEmployeeID = sess.EmployeeID
		w.WriteHeader(http.StatusOK)
	}))

	t.Run("valid token allowed", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if sawEmployeeID != "EMP-0001" {
			t.Fatalf("handler saw employeeID %q", sawEmployeeID)
		}
	})

	t.Run("missing header rejected", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want 401", rec.Code)
		}
	})

	t.Run("invalid token rejected", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("Authorization", "Bearer garbage")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want 401", rec.Code)
		}
	})

	t.Run("deactivated employee blocked mid-session", func(t *testing.T) {
		if _, err := db.Exec(`UPDATE employees SET status_aktif = 0 WHERE employee_id = ?`, "EMP-0001"); err != nil {
			t.Fatalf("deactivate: %v", err)
		}
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want 401 for deactivated employee's next request", rec.Code)
		}
	})
}
