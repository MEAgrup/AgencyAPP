// Package module1_leads holds Module 1 (Leads Database) domain logic.
//
// This file: phone normalization — the dedup PRIMARY key (M1 §5, §9.4). The
// default rule (configurable per §9.4) strips the country code (+62 / 62) or a
// single leading zero plus all non-digit separators, so "+62 812-3456",
// "0812 3456" and "812.3456" all collapse to the same canonical "8123456".
package module1_leads

import "strings"

// NormalizePhone returns the canonical dedup key for a phone number.
//
//   - all non-digit characters (spaces, dashes, parens, dots, '+') are removed;
//   - a leading "62" country code is dropped;
//   - otherwise a single leading "0" is dropped.
//
// An empty / digit-less input returns "".
func NormalizePhone(raw string) string {
	var digits strings.Builder
	for _, r := range raw {
		if r >= '0' && r <= '9' {
			digits.WriteRune(r)
		}
	}
	d := digits.String()
	switch {
	case strings.HasPrefix(d, "62") && len(d) > 2:
		return d[2:]
	case strings.HasPrefix(d, "0"):
		return strings.TrimPrefix(d, "0")
	default:
		return d
	}
}
