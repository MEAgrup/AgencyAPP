// Package auth owns CDPS authentication. As of the 2026-07-19 auth decision the
// HRIS is a data source ONLY (employee sync); CDPS verifies a locally stored
// bcrypt password (see local.go) and issues its own opaque session (session.go)
// bound to the synced, active employee record (actor.go).
package auth
