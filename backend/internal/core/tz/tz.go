// Package tz is the single source of truth for CDPS business-date bucketing.
//
// Per DECISIONS.md O20 (resolved 2026-07-16): every derivation of a "business
// date" or "business month" from an instant uses Asia/Jakarta (WIB, UTC+7),
// NOT UTC. Stored timestamps (created_at, released_to_account_at, session TTLs,
// …) are unaffected — only the calendar bucket derived from an instant moves.
//
// tzdata is embedded (import _ "time/tzdata") so behaviour never depends on the
// host container carrying an Asia/Jakarta zone file.
package tz

import (
	"time"
	_ "time/tzdata" // embed the IANA tz database; do not rely on the host
)

// jakarta is the business timezone, resolved once at init from the embedded db.
var jakarta = func() *time.Location {
	loc, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		// With time/tzdata embedded this is unreachable; panic loudly rather
		// than silently bucketing in UTC and re-introducing the O20 bug.
		panic("tz: load Asia/Jakarta failed despite embedded tzdata: " + err.Error())
	}
	return loc
}()

// Location returns the business timezone (Asia/Jakarta / WIB, UTC+7).
func Location() *time.Location { return jakarta }

// BusinessDate returns midnight of t's WIB calendar date, expressed in WIB.
// Use it to answer "which business day is this instant?" and to compute
// whole-day differences: subtracting two BusinessDate values yields an exact
// multiple of 24h. A pure DATE value (stored as midnight UTC) maps back to the
// same calendar date, since +7h never crosses a day boundary from 00:00.
func BusinessDate(t time.Time) time.Time {
	w := t.In(jakarta)
	return time.Date(w.Year(), w.Month(), w.Day(), 0, 0, 0, 0, jakarta)
}

// Period returns the WIB business month of t formatted YYYYMM (e.g. "202607"),
// the bucket used by the house ID scheme PREFIX-YYYYMM-NNNN.
func Period(t time.Time) string {
	return t.In(jakarta).Format("200601")
}
