package tz_test

import (
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/tz"
)

func TestLocation_IsJakarta(t *testing.T) {
	if got := tz.Location().String(); got != "Asia/Jakarta" {
		t.Fatalf("Location() = %q, want Asia/Jakarta", got)
	}
	// WIB is a fixed +7 offset (no DST).
	ref := time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC).In(tz.Location())
	_, off := ref.Zone()
	if off != 7*3600 {
		t.Fatalf("WIB offset = %ds, want %ds", off, 7*3600)
	}
}

func TestBusinessDate(t *testing.T) {
	cases := []struct {
		name    string
		in      time.Time
		wantY   int
		wantM   time.Month
		wantD   int
	}{
		{
			// 2026-07-15T18:30:00Z == 2026-07-16 01:30 WIB → business day 16 Jul.
			name: "utc evening rolls to next WIB day",
			in:   time.Date(2026, 7, 15, 18, 30, 0, 0, time.UTC),
			wantY: 2026, wantM: time.July, wantD: 16,
		},
		{
			// 16:59Z == 23:59 WIB, still the same WIB day.
			name: "just before WIB midnight stays same day",
			in:   time.Date(2026, 7, 15, 16, 59, 0, 0, time.UTC),
			wantY: 2026, wantM: time.July, wantD: 15,
		},
		{
			// 17:00Z == 00:00 WIB next day.
			name: "exactly WIB midnight flips day",
			in:   time.Date(2026, 7, 15, 17, 0, 0, 0, time.UTC),
			wantY: 2026, wantM: time.July, wantD: 16,
		},
		{
			// A stored DATE (midnight UTC) maps to the same calendar date.
			name: "pure date preserves calendar day",
			in:   time.Date(2026, 6, 17, 0, 0, 0, 0, time.UTC),
			wantY: 2026, wantM: time.June, wantD: 17,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := tz.BusinessDate(c.in)
			if got.Year() != c.wantY || got.Month() != c.wantM || got.Day() != c.wantD {
				t.Fatalf("BusinessDate(%s) = %s, want %04d-%02d-%02d", c.in, got, c.wantY, c.wantM, c.wantD)
			}
			if got.Location() != tz.Location() {
				t.Fatalf("BusinessDate location = %s, want WIB", got.Location())
			}
			if h, m, s := got.Clock(); h != 0 || m != 0 || s != 0 {
				t.Fatalf("BusinessDate not midnight: %02d:%02d:%02d", h, m, s)
			}
		})
	}
}

// Subtracting two BusinessDate values yields whole days even across a WIB
// midnight flip — the property overdue-day counting relies on.
func TestBusinessDate_WholeDayDelta(t *testing.T) {
	today := tz.BusinessDate(time.Date(2026, 7, 15, 18, 30, 0, 0, time.UTC)) // 16 Jul WIB
	due := tz.BusinessDate(time.Date(2026, 7, 10, 0, 0, 0, 0, time.UTC))     // 10 Jul (stored DATE)
	days := int(today.Sub(due).Hours() / 24)
	if days != 6 {
		t.Fatalf("day delta = %d, want 6", days)
	}
}

func TestPeriod(t *testing.T) {
	cases := []struct {
		name string
		in   time.Time
		want string
	}{
		{
			// 2026-07-31T17:30:00Z == 2026-08-01 00:30 WIB → month bucket Aug.
			name: "month-end UTC evening rolls to next WIB month",
			in:   time.Date(2026, 7, 31, 17, 30, 0, 0, time.UTC),
			want: "202608",
		},
		{
			// 2026-07-31T16:59:00Z == 23:59 WIB 31 Jul → still July.
			name: "just before WIB midnight stays same month",
			in:   time.Date(2026, 7, 31, 16, 59, 0, 0, time.UTC),
			want: "202607",
		},
		{
			// Midnight UTC on the 1st is already 07:00 WIB same day → same month.
			name: "first-of-month midnight utc",
			in:   time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC),
			want: "202607",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := tz.Period(c.in); got != c.want {
				t.Fatalf("Period(%s) = %s, want %s", c.in, got, c.want)
			}
		})
	}
}
