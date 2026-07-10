package leads

import "strings"

// Normalizer produces the deduplication primary key from a raw phone number
// (§5 rule 2, M1-OA-4). It is configurable and applies NO time window — a lead
// from years ago normalises to the same key and matches its original record.
//
// Default rules (M1 §9.4): strip spaces and dashes, then strip a single
// leading international prefix `+62` or a single leading trunk `0`, collapsing
// both Indonesian conventions (`08123`, `+628123`, `628123`, `8123`) onto one
// canonical key. Configure StripPrefixes to change the recognised prefixes.
type Normalizer struct {
	// StripSpaces removes ASCII spaces and dashes (default true).
	StripSpaces bool
	// StripPrefixes is the ordered list of leading tokens to strip (first
	// match wins, applied once). Default {"+62", "62", "0"}.
	StripPrefixes []string
}

// DefaultNormalizer returns the M1 §9.4 default configuration.
func DefaultNormalizer() Normalizer {
	return Normalizer{
		StripSpaces:   true,
		StripPrefixes: []string{"+62", "62", "0"},
	}
}

// Normalize returns the canonical dedup key for raw.
func (n Normalizer) Normalize(raw string) string {
	s := raw
	if n.StripSpaces {
		s = strings.ReplaceAll(s, " ", "")
		s = strings.ReplaceAll(s, "-", "")
		s = strings.ReplaceAll(s, "\t", "")
	}
	for _, p := range n.StripPrefixes {
		if p != "" && strings.HasPrefix(s, p) {
			s = s[len(p):]
			break // strip a single leading prefix only
		}
	}
	return s
}

// normalizeName collapses a lead name for the M1-OA-4 "substantially different"
// comparison: lowercased, punctuation dropped, whitespace collapsed. It is NOT
// a storage value (the original Lead Name is preserved verbatim) — only a
// comparison basis for raising the manual-review flag.
func normalizeName(s string) string {
	var b strings.Builder
	lastSpace := false
	for _, r := range strings.ToLower(strings.TrimSpace(s)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastSpace = false
		case r == ' ':
			if !lastSpace && b.Len() > 0 {
				b.WriteRune(' ')
				lastSpace = true
			}
		default:
			// drop punctuation entirely
		}
	}
	return strings.TrimSpace(b.String())
}

// nameDiffersSubstantially reports whether two lead names are substantially
// different for M1-OA-4. Heuristic (flagged in the build report): the
// normalised forms are unequal AND neither is a substring/prefix of the other
// — so "PT Sini Store" vs "Sini Store" is the SAME business (no flag), while
// "Sini Store" vs "Warung Budi" flags for manual review.
func nameDiffersSubstantially(a, b string) bool {
	na, nb := normalizeName(a), normalizeName(b)
	if na == "" || nb == "" {
		return false // cannot judge; do not raise a false flag
	}
	if na == nb {
		return false
	}
	if strings.Contains(na, nb) || strings.Contains(nb, na) {
		return false
	}
	return true
}
