package tz

import (
	"testing"
	"time"
)

func TestJakarta(t *testing.T) {
	loc := Jakarta()
	if loc == nil {
		t.Fatalf("Jakarta() returned nil")
	}
	if loc.String() != "Asia/Jakarta" {
		t.Errorf("expected Asia/Jakarta, got %s", loc.String())
	}

	// Verify that calling Jakarta() multiple times returns the same instance
	// (singleton pattern via sync.Once).
	loc2 := Jakarta()
	if loc != loc2 {
		t.Errorf("Jakarta() should return same instance (singleton), but got different pointers")
	}
}

// TestCalendarBucketing verifies boundary conditions for calendar bucketing.
// Case 1: 2026-07-11T18:30:00Z = 2026-07-12 01:30 WIB
// This moment should bucket to 2026-07-12 in WIB (next day) but 2026-07-11 in UTC.
func TestBucketingUTC2WIB(t *testing.T) {
	// A UTC moment that crosses midnight in WIB
	utcMoment := time.Date(2026, 7, 11, 18, 30, 0, 0, time.UTC)

	// In WIB, this is 2026-07-12 01:30
	jakartaLoc := Jakarta()
	wibTime := utcMoment.In(jakartaLoc)

	// Extract date in WIB
	wibYear, wibMonth, wibDay := wibTime.Date()
	if wibYear != 2026 || wibMonth != time.July || wibDay != 12 {
		t.Errorf("expected 2026-07-12 in WIB, got %04d-%02d-%02d",
			wibYear, int(wibMonth), wibDay)
	}

	// Extract date in UTC for comparison
	utcYear, utcMonth, utcDay := utcMoment.Date()
	if utcYear != 2026 || utcMonth != time.July || utcDay != 11 {
		t.Errorf("expected 2026-07-11 in UTC, got %04d-%02d-%02d",
			utcYear, int(utcMonth), utcDay)
	}
}

// TestMonthBucketing verifies that YYYYMM component generation uses WIB.
// Case: 2026-06-30T17:30:00Z = 2026-07-01 00:30 WIB
// This should bucket to 202607 (July) in WIB, not 202606 (June) in UTC.
func TestMonthBucketingUTC2WIB(t *testing.T) {
	// A UTC moment that crosses month boundary in WIB
	utcMoment := time.Date(2026, 6, 30, 17, 30, 0, 0, time.UTC)

	// In WIB, this is 2026-07-01 00:30
	jakartaLoc := Jakarta()
	wibTime := utcMoment.In(jakartaLoc)

	// Extract YYYYMM in WIB
	wibYYYYMM := wibTime.Format("200601")
	if wibYYYYMM != "202607" {
		t.Errorf("expected YYYYMM=202607 in WIB, got %s", wibYYYYMM)
	}

	// Extract YYYYMM in UTC for comparison
	utcYYYYMM := utcMoment.Format("200601")
	if utcYYYYMM != "202606" {
		t.Errorf("expected YYYYMM=202606 in UTC, got %s", utcYYYYMM)
	}
}

// TestTodayWIB verifies that TodayWIB helper returns correct daily bucket.
func TestTodayWIB(t *testing.T) {
	// 2026-07-11 18:30 UTC = 2026-07-12 01:30 WIB
	// Should bucket to 2026-07-12 00:00 WIB
	utcMoment := time.Date(2026, 7, 11, 18, 30, 0, 0, time.UTC)
	today := TodayWIB(utcMoment)

	// Check the date in WIB
	year, month, day := today.Date()
	if year != 2026 || month != time.July || day != 12 {
		t.Errorf("expected 2026-07-12, got %04d-%02d-%02d", year, int(month), day)
	}

	// Check it's midnight
	if today.Hour() != 0 || today.Minute() != 0 || today.Second() != 0 {
		t.Errorf("expected midnight, got %02d:%02d:%02d", today.Hour(), today.Minute(), today.Second())
	}

	// Check it's in the correct timezone
	if today.Location().String() != "Asia/Jakarta" {
		t.Errorf("expected Asia/Jakarta location, got %s", today.Location())
	}

	// Check UTC equivalent
	todayUTC := today.UTC()
	if todayUTC.Hour() != 17 {
		t.Errorf("2026-07-12T00:00 WIB should be 2026-07-11T17:00 UTC, got hour=%d", todayUTC.Hour())
	}
}

// TestDailyBucketTruncation verifies that truncating to 00:00 WIB works correctly.
// The proper way to truncate to a daily bucket in a specific timezone is to:
// 1. Convert to that timezone
// 2. Extract the date components
// 3. Reconstruct midnight in that timezone
func TestDailyBucketTruncation(t *testing.T) {
	// 2026-07-11 18:30 UTC = 2026-07-12 01:30 WIB
	utcMoment := time.Date(2026, 7, 11, 18, 30, 0, 0, time.UTC)

	jakartaLoc := Jakarta()
	wibTime := utcMoment.In(jakartaLoc)

	// Extract date in WIB
	year, month, day := wibTime.Date()
	// Reconstruct as midnight in WIB
	dailyBucket := time.Date(year, month, day, 0, 0, 0, 0, jakartaLoc)

	// Verify the bucket time is midnight WIB
	if dailyBucket.Hour() != 0 || dailyBucket.Minute() != 0 || dailyBucket.Second() != 0 {
		t.Errorf("daily bucket should be midnight, got %02d:%02d:%02d",
			dailyBucket.Hour(), dailyBucket.Minute(), dailyBucket.Second())
	}

	// Verify the bucket date is 2026-07-12 WIB
	buckYear, buckMonth, buckDay := dailyBucket.Date()
	if buckYear != 2026 || buckMonth != time.July || buckDay != 12 {
		t.Errorf("expected daily bucket date 2026-07-12, got %04d-%02d-%02d",
			buckYear, int(buckMonth), buckDay)
	}

	// Convert bucket back to UTC to verify it's properly timezone-aware
	buckUTC := dailyBucket.UTC()
	if buckUTC.Hour() != 17 || buckUTC.Minute() != 0 {
		t.Errorf("bucket 2026-07-12T00:00 WIB should be 2026-07-11T17:00 UTC, got %02d:%02d",
			buckUTC.Hour(), buckUTC.Minute())
	}
}
