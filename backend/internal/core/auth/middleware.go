package auth

import (
	"context"
	"net/http"
	"strings"
)

type contextKey int

const sessionContextKey contextKey = iota

// Middleware reads "Authorization: Bearer <token>", resolves it via
// svc.Authenticate, and rejects the request with 401 if missing or invalid
// (unknown/expired/revoked token, or a since-deactivated employee). On
// success the resolved *Session is attached to the request context,
// retrievable with FromContext.
func Middleware(svc *Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token, ok := bearerToken(r)
			if !ok {
				unauthorized(w)
				return
			}

			sess, err := svc.Authenticate(r.Context(), token)
			if err != nil {
				unauthorized(w)
				return
			}

			ctx := context.WithValue(r.Context(), sessionContextKey, sess)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// FromContext retrieves the *Session attached by Middleware.
func FromContext(ctx context.Context) (*Session, bool) {
	sess, ok := ctx.Value(sessionContextKey).(*Session)
	return sess, ok
}

func bearerToken(r *http.Request) (string, bool) {
	const prefix = "Bearer "
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, prefix) {
		return "", false
	}
	token := strings.TrimSpace(strings.TrimPrefix(h, prefix))
	if token == "" {
		return "", false
	}
	return token, true
}

func unauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(`{"error":"unauthorized"}`))
}
