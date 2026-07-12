// Package tz provides timezone utilities for calendar bucketing in CDPS.
// O20 Decision: all calendar bucketing (YYYYMM, daily buckets for reminders) uses
// Asia/Jakarta (WIB), while storage timestamps in DB and audit records remain UTC.
package tz

import (
	"sync"
	"time"
	// Import _ "time/tzdata" to embed tzdata in the binary, avoiding OS dependency.
	_ "time/tzdata"
)

var (
	// Location is the singleton Asia/Jakarta timezone used for all calendar bucketing.
	// Initialized once on first access to avoid repeated lookups.
	jakartaOnce sync.Once
	jakartaLoc  *time.Location
	jakartaErr  error
)

// Jakarta returns the Asia/Jakarta timezone (WIB) for calendar bucketing operations.
// This is used when generating YYYYMM components in IDs, determining daily buckets
// for reminders, and other calendar-derived fields. Storage timestamps and audit
// records remain UTC.
func Jakarta() *time.Location {
	jakartaOnce.Do(func() {
		jakartaLoc, jakartaErr = time.LoadLocation("Asia/Jakarta")
	})
	if jakartaErr != nil {
		// Fallback: this should never happen with _ "time/tzdata", but fail hard if it does.
		panic("tz: failed to load Asia/Jakarta: " + jakartaErr.Error())
	}
	return jakartaLoc
}

// TodayWIB returns midnight (00:00:00) on today's date in WIB (Asia/Jakarta),
// given a UTC moment. This is the correct way to bucket to a daily calendar slot
// for reminders and other calendar-driven operations.
//
// Example: given 2026-07-11T18:30:00Z (= 2026-07-12T01:30:00 WIB),
// returns 2026-07-12T00:00:00+07:00 (which is 2026-07-11T17:00:00Z).
func TodayWIB(utcNow time.Time) time.Time {
	jakartaLoc := Jakarta()
	wibTime := utcNow.In(jakartaLoc)
	year, month, day := wibTime.Date()
	return time.Date(year, month, day, 0, 0, 0, 0, jakartaLoc)
}
