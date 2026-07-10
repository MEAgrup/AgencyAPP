package authz_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/authz"
)

func TestMiddleware(t *testing.T) {
	staff := authz.Identity{EmployeeID: "EMP-1", Divisi: "Sales", Roles: []authz.Role{authz.RoleStaff}}

	identifyAs := func(id authz.Identity, ok bool) func(*http.Request) (authz.Identity, bool) {
		return func(*http.Request) (authz.Identity, bool) { return id, ok }
	}
	buildReq := func(req authz.Request, ok bool) func(*http.Request, authz.Identity) (authz.Request, bool) {
		return func(*http.Request, authz.Identity) (authz.Request, bool) { return req, ok }
	}

	var reached bool
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.WriteHeader(http.StatusOK)
	})

	run := func(mw func(http.Handler) http.Handler) *httptest.ResponseRecorder {
		reached = false
		rec := httptest.NewRecorder()
		mw(next).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/msl/1", nil))
		return rec
	}

	t.Run("allow passes through", func(t *testing.T) {
		mw := authz.Middleware(
			identifyAs(staff, true),
			buildReq(authz.Request{Action: authz.ActionRead, OwnerEmployeeID: "EMP-1"}, true),
			authz.NewMatrixChecker(),
		)
		rec := run(mw)
		if !reached || rec.Code != http.StatusOK {
			t.Fatalf("allow: reached=%v code=%d", reached, rec.Code)
		}
	})

	t.Run("unauthenticated is 401", func(t *testing.T) {
		mw := authz.Middleware(
			identifyAs(authz.Identity{}, false),
			buildReq(authz.Request{Action: authz.ActionRead}, true),
			authz.NewMatrixChecker(),
		)
		rec := run(mw)
		if reached || rec.Code != http.StatusUnauthorized {
			t.Fatalf("unauth: reached=%v code=%d", reached, rec.Code)
		}
	})

	t.Run("checker deny is 403", func(t *testing.T) {
		// Staff reading someone else's data: matrix denies.
		mw := authz.Middleware(
			identifyAs(staff, true),
			buildReq(authz.Request{Action: authz.ActionRead, OwnerEmployeeID: "EMP-999"}, true),
			authz.NewMatrixChecker(),
		)
		rec := run(mw)
		if reached || rec.Code != http.StatusForbidden {
			t.Fatalf("deny: reached=%v code=%d", reached, rec.Code)
		}
	})

	t.Run("build failure is deny-by-default 403", func(t *testing.T) {
		mw := authz.Middleware(
			identifyAs(staff, true),
			buildReq(authz.Request{}, false),
			authz.NewMatrixChecker(),
		)
		rec := run(mw)
		if reached || rec.Code != http.StatusForbidden {
			t.Fatalf("build-fail: reached=%v code=%d", reached, rec.Code)
		}
	})
}
