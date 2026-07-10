package authz

import "net/http"

// Middleware is the S0-08 HTTP enforcement point for the Phase 0 §4 matrix.
// It is deliberately dependency-free (it does NOT import the auth package):
// callers adapt their own authentication — e.g. auth.FromContext — into the
// identify function, keeping authz a pure policy layer.
//
//   - identify resolves the request's Identity. Returning ok=false means the
//     caller is unauthenticated → 401.
//   - build derives the per-request authz.Request (action, division, owner,
//     capability) from the route + resolved Identity. Returning ok=false is a
//     deny-by-default signal (e.g. a malformed/unroutable resource) → 403.
//   - checker enforces the matrix; any Check error → 403.
//
// On allow, the request passes through unchanged to next.
func Middleware(
	identify func(*http.Request) (Identity, bool),
	build func(*http.Request, Identity) (Request, bool),
	checker Checker,
) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id, ok := identify(r)
			if !ok {
				writeJSONError(w, http.StatusUnauthorized, "unauthorized")
				return
			}
			req, ok := build(r, id)
			if !ok {
				writeJSONError(w, http.StatusForbidden, "forbidden")
				return
			}
			if err := checker.Check(id, req); err != nil {
				writeJSONError(w, http.StatusForbidden, "forbidden")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(`{"error":"` + msg + `"}`))
}
