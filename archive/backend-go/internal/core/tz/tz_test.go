package tz_test

import (
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/tz"
)

// WIB is a fixed UTC+7 offset with no DST.
func TestWIB_FixedOffsetNoDST(t *testing.T) {
	_, off := time.Date(2026, 7, 17, 0, 0, 0, 0, tz.WIB).Zone()
	if off != 7*3600 {
		t.Fatalf("WIB offset = %d, want %d", off, 7*3600)
	}
	// Same offset in January (no daylight-saving swing).
	_, offJan := time.Date(2026, 1, 15, 0, 0, 0, 0, tz.WIB).Zone()
	if offJan != off {
		t.Fatalf("WIB offset drifted across seasons: jul=%d jan=%d", off, offJan)
	}
}

func TestDate_CrossMidnightBucket(t *testing.T) {
	// 2026-07-16T18:30:00Z == 2026-07-17 01:30 WIB -> bucket day is 17 Jul.
	got := tz.Date(time.Date(2026, 7, 16, 18, 30, 0, 0, time.UTC))
	want := time.Date(2026, 7, 17, 0, 0, 0, 0, tz.WIB)
	if !got.Equal(want) {
		t.Fatalf("Date = %s, want %s", got, want)
	}
	if s := tz.DateString(time.Date(2026, 7, 16, 18, 30, 0, 0, time.UTC)); s != "2026-07-17" {
		t.Fatalf("DateString = %q, want 2026-07-17", s)
	}
}

func TestDate_SameDayWhenBeforeUTCBoundary(t *testing.T) {
	// 2026-07-17T05:00:00Z == 2026-07-17 12:00 WIB -> still 17 Jul.
	if s := tz.DateString(time.Date(2026, 7, 17, 5, 0, 0, 0, time.UTC)); s != "2026-07-17" {
		t.Fatalf("DateString = %q, want 2026-07-17", s)
	}
}

func TestPeriod_MonthRolloverInWIB(t *testing.T) {
	// 2026-06-30T17:30:00Z == 2026-07-01 00:30 WIB -> month bucket 202607.
	if p := tz.Period(time.Date(2026, 6, 30, 17, 30, 0, 0, time.UTC)); p != "202607" {
		t.Fatalf("Period = %q, want 202607", p)
	}
	// 2026-06-30T16:00:00Z == 2026-06-30 23:00 WIB -> still 202606.
	if p := tz.Period(time.Date(2026, 6, 30, 16, 0, 0, 0, time.UTC)); p != "202606" {
		t.Fatalf("Period = %q, want 202606", p)
	}
}

func TestDaysBetween_CalendarDays(t *testing.T) {
	// Due 2026-06-17 (DATE stored as UTC midnight by the driver), "now"
	// 2026-06-20T18:00Z == 2026-06-21 01:00 WIB -> 4 calendar days overdue.
	due := time.Date(2026, 6, 17, 0, 0, 0, 0, time.UTC)
	now := time.Date(2026, 6, 20, 18, 0, 0, 0, time.UTC)
	if d := tz.DaysBetween(due, now); d != 4 {
		t.Fatalf("DaysBetween = %d, want 4", d)
	}
	// Before the WIB midnight roll (2026-06-20T10:00Z == 17:00 WIB) it's 3.
	if d := tz.DaysBetween(due, time.Date(2026, 6, 20, 10, 0, 0, 0, time.UTC)); d != 3 {
		t.Fatalf("DaysBetween = %d, want 3", d)
	}
}
