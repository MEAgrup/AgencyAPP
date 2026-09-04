// Package tz centralises calendar-date bucketing in WIB (Waktu Indonesia
// Barat, Asia/Jakarta).
//
// House rule (DECISIONS O20, 2026-07-17): every derivation that buckets an
// instant into a calendar DAY or MONTH — the house-ID period, the payment
// reminder "today"/day-overdue math, the MSL "effective today" date — is done
// in WIB, not UTC. Absolute timestamps (audit created_at, DB NOW(), session
// expiry, sync markers) are NOT affected; only civil-date derivations are.
//
// WIB is a fixed UTC+7 offset with no daylight-saving time, so we build it with
// time.FixedZone rather than time.LoadLocation("Asia/Jakarta"). This keeps the
// binary independent of the tzdata database being present in the runtime
// container, and is correct forever because WIB has no DST transitions.
package tz

import "time"

// WIB is the fixed UTC+7 Western Indonesian Time zone.
var WIB = time.FixedZone("WIB", 7*3600)

// Date returns midnight (00:00:00) of the WIB calendar day that instant t falls
// on, expressed in WIB. Use it whenever you need the start of "today" for
// calendar bucketing.
func Date(t time.Time) time.Time {
	w := t.In(WIB)
	return time.Date(w.Year(), w.Month(), w.Day(), 0, 0, 0, 0, WIB)
}

// DateString formats the WIB calendar date of t as "2006-01-02".
func DateString(t time.Time) string {
	return t.In(WIB).Format("2006-01-02")
}

// Period formats the WIB calendar month of t as "200601" — the house-ID month
// bucket (PREFIX-YYYYMM-NNNN).
func Period(t time.Time) string {
	return t.In(WIB).Format("200601")
}

// DaysBetween returns the whole number of calendar days from the WIB date of
// `from` to the WIB date of `to` (i.e. to - from). Both operands are first
// reduced to WIB midnight, so the result is a pure calendar-day difference,
// independent of the clock time within each day. Because WIB has no DST the
// reduced instants differ by exact multiples of 24h, so the division is exact.
func DaysBetween(from, to time.Time) int {
	return int(Date(to).Sub(Date(from)).Hours() / 24)
}
