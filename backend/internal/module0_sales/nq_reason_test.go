package sales

import (
	"testing"
)

// TestNotQualifiedReasonTaxonomy validates M1-OA-8 reason taxonomy enforcement
// (W1-04). The closed list is: [Bukan seller], [Tidak ada budget],
// [Kontak salah/tidak valid], [Tidak ada respon], [Sudah jadi klien],
// [Spam/duplikat], plus [Lainnya ...] <detail>.
func TestNotQualifiedReasonTaxonomy(t *testing.T) {
	tests := []struct {
		name    string
		reason  string
		want    bool
		desc    string
	}{
		// Valid closed-list reasons (byte-exact)
		{
			name:   "reason_bukan_seller",
			reason: "[Bukan seller]",
			want:   true,
			desc:   "closed reason: Bukan seller",
		},
		{
			name:   "reason_tidak_ada_budget",
			reason: "[Tidak ada budget]",
			want:   true,
			desc:   "closed reason: Tidak ada budget",
		},
		{
			name:   "reason_kontak_salah",
			reason: "[Kontak salah/tidak valid]",
			want:   true,
			desc:   "closed reason: Kontak salah/tidak valid",
		},
		{
			name:   "reason_tidak_ada_respon",
			reason: "[Tidak ada respon]",
			want:   true,
			desc:   "closed reason: Tidak ada respon",
		},
		{
			name:   "reason_sudah_jadi_klien",
			reason: "[Sudah jadi klien]",
			want:   true,
			desc:   "closed reason: Sudah jadi klien",
		},
		{
			name:   "reason_spam_duplikat",
			reason: "[Spam/duplikat]",
			want:   true,
			desc:   "closed reason: Spam/duplikat",
		},

		// Valid "Lainnya ..." with free-text (must have detail after prefix)
		{
			name:   "lainnya_with_detail",
			reason: "[Lainnya ...] Tidak punya dana", // M1-OA-8 example in PRD
			want:   true,
			desc:   "Lainnya with free-text detail",
		},
		{
			name:   "lainnya_short_detail",
			reason: "[Lainnya ...] x",
			want:   true,
			desc:   "Lainnya with minimal detail (1 char)",
		},
		{
			name:   "lainnya_complex_detail",
			reason: "[Lainnya ...] Belum siap ekspansi, tunggu Q3 2026",
			want:   true,
			desc:   "Lainnya with complex detail",
		},

		// Invalid: bare "[Lainnya ...]" without detail
		{
			name:   "lainnya_bare",
			reason: "[Lainnya ...]",
			want:   false,
			desc:   "bare Lainnya (no detail) is invalid",
		},
		{
			name:   "lainnya_trailing_space",
			reason: "[Lainnya ...] ",
			want:   false,
			desc:   "Lainnya with only space (no meaningful detail) is invalid",
		},

		// Invalid: typos, missing brackets, case mismatch
		{
			name:   "reason_typo_bukan",
			reason: "[Bukan penjual]", // Should be "seller"
			want:   false,
			desc:   "typo: Bukan penjual (not seller)",
		},
		{
			name:   "reason_case_mismatch",
			reason: "[bukan seller]", // Lowercase
			want:   false,
			desc:   "case mismatch: lowercase reason",
		},
		{
			name:   "reason_missing_bracket",
			reason: "Bukan seller",
			want:   false,
			desc:   "missing brackets",
		},
		{
			name:   "reason_wrong_bracket",
			reason: "[Bukan seller", // Missing closing bracket
			want:   false,
			desc:   "malformed: missing closing bracket",
		},
		{
			name:   "reason_unknown",
			reason: "[Tidak tertarik]",
			want:   false,
			desc:   "unknown closed reason",
		},

		// Edge cases
		{
			name:   "reason_empty",
			reason: "",
			want:   false,
			desc:   "empty string is invalid",
		},
		{
			name:   "reason_whitespace_only",
			reason: "   ",
			want:   false,
			desc:   "whitespace-only is invalid",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isValidNotQualifiedReason(tt.reason)
			if got != tt.want {
				t.Errorf("%s: isValidNotQualifiedReason(%q) = %v, want %v",
					tt.desc, tt.reason, got, tt.want)
			}
		})
	}
}

// TestNotQualifiedReasonConstants validates that the NotQualifiedReasons
// map contains exactly the M1-OA-8 closed list (byte-exact).
func TestNotQualifiedReasonConstants(t *testing.T) {
	expectedReasons := []string{
		"[Bukan seller]",
		"[Tidak ada budget]",
		"[Kontak salah/tidak valid]",
		"[Tidak ada respon]",
		"[Sudah jadi klien]",
		"[Spam/duplikat]",
		"[Lainnya ...]",
	}

	// Check all expected reasons are present
	for _, reason := range expectedReasons {
		if !NotQualifiedReasons[reason] {
			t.Errorf("NotQualifiedReasons missing expected reason: %q", reason)
		}
	}

	// Check no extra reasons are present (exact match)
	if len(NotQualifiedReasons) != len(expectedReasons) {
		t.Errorf("NotQualifiedReasons has %d entries, want %d",
			len(NotQualifiedReasons), len(expectedReasons))
	}
}
