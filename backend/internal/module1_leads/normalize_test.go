package leads

import "testing"

// TestNormalize_Default covers M1 §5 rule 2 / §9.4: strip leading `+62`/`0`,
// spaces, dashes; configurable; no time-window semantics (pure function of the
// input). All Indonesian phone conventions collapse onto one key.
func TestNormalize_Default(t *testing.T) {
	n := DefaultNormalizer()
	tests := []struct {
		in, want string
	}{
		{"08123456789", "8123456789"},
		{"+628123456789", "8123456789"},
		{"628123456789", "8123456789"},
		{"8123456789", "8123456789"},
		{"0812-3456-789", "8123456789"},
		{"+62 812 3456 789", "8123456789"},
		{" 0812 3456-789 ", "8123456789"},
		// only ONE leading prefix is stripped: 0062... is not double-stripped
		{"0062812", "062812"},
		// a bare 0 mid-number is preserved
		{"081203", "81203"},
		{"", ""},
	}
	for _, tc := range tests {
		if got := n.Normalize(tc.in); got != tc.want {
			t.Errorf("Normalize(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// TestNormalize_Configurable pins M1-OA-4/§9.4 "phone normalization
// configurable": a different prefix set changes behaviour without code edits.
func TestNormalize_Configurable(t *testing.T) {
	n := Normalizer{StripSpaces: true, StripPrefixes: []string{"+65"}}
	if got := n.Normalize("+65 8123 4567"); got != "81234567" {
		t.Fatalf("custom prefix: got %q", got)
	}
	if got := n.Normalize("081234567"); got != "081234567" {
		t.Fatalf("custom config must not strip 0: got %q", got)
	}
}

// TestNameDiffersSubstantially covers the M1-OA-4 manual-review heuristic:
// same/contained names are the same business (shared office number edge case
// stays quiet), disjoint names flag for review.
func TestNameDiffersSubstantially(t *testing.T) {
	tests := []struct {
		a, b string
		want bool
	}{
		{"Sini Store", "Sini Store", false},
		{"Sini Store", "sini store", false},
		{"PT Sini Store", "Sini Store", false}, // containment = same business
		{"Sini Store", "SINI-STORE", false},    // punctuation-insensitive
		{"Sini Store", "Warung Budi", true},    // disjoint -> manual review
		{"Alpha Digital", "Unicorn Media", true},
		{"", "Warung Budi", false}, // cannot judge, no false flag
	}
	for _, tc := range tests {
		if got := nameDiffersSubstantially(tc.a, tc.b); got != tc.want {
			t.Errorf("nameDiffersSubstantially(%q, %q) = %v, want %v", tc.a, tc.b, got, tc.want)
		}
	}
}
