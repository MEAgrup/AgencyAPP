package permission_test

import (
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

func TestNormalizeDivision(t *testing.T) {
	cases := []struct {
		in     string
		want   string
		wantOK bool
	}{
		{"marketing", "Marketing", true},
		{"Marketing", "Marketing", true},
		{"MARKETING", "Marketing", true},
		{"livestream", "Live Stream", true},
		{"live stream", "Live Stream", true},
		{"LIVE STREAM", "Live Stream", true},
		{"live-stream", "Live Stream", true},
		{"kol", "KOL", true},
		{"KOL", "KOL", true},
		{"Sales", "Sales", true},
		{"finance", "Finance", true},
		{"account", "Account", true},
		{"creative", "Creative", true},
		{"ads", "Ads", true},
		{"growth", "", false},
		{"", "", false},
		{"marketingg", "", false},
	}
	for _, c := range cases {
		got, ok := permission.NormalizeDivision(c.in)
		if got != c.want || ok != c.wantOK {
			t.Errorf("NormalizeDivision(%q) = (%q, %v), want (%q, %v)", c.in, got, ok, c.want, c.wantOK)
		}
	}
}

func TestCanonicalDivisions(t *testing.T) {
	want := []string{"Marketing", "Sales", "Finance", "Account", "Creative", "Ads", "KOL", "Live Stream"}
	if len(permission.CanonicalDivisions) != len(want) {
		t.Fatalf("CanonicalDivisions len=%d want %d", len(permission.CanonicalDivisions), len(want))
	}
	for i, w := range want {
		if permission.CanonicalDivisions[i] != w {
			t.Errorf("CanonicalDivisions[%d]=%q want %q", i, permission.CanonicalDivisions[i], w)
		}
	}
	// Every canonical value must round-trip through NormalizeDivision unchanged.
	for _, d := range permission.CanonicalDivisions {
		got, ok := permission.NormalizeDivision(d)
		if !ok || got != d {
			t.Errorf("canonical %q did not round-trip: (%q, %v)", d, got, ok)
		}
	}
}
