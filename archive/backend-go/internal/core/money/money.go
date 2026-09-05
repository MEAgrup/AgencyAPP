// Package money is the shared IDR money type + house formatting (CLAUDE.md #7).
//
// Money is stored as an integer number of *minor units* (hundredths of a
// rupiah) so all arithmetic is exact — no float rounding ever touches a
// commission, allocation, or installment total. DB DECIMAL(15,2) columns
// round-trip through Parse/Decimal without loss.
//
// House display convention: "Rp. X.XXX.XXX,00" (thousands dot-separated, a
// literal ",00" suffix — MEA does not track real cents in the UI). This mirrors
// web-internal/src/lib/money.ts exactly so the two sides never disagree.
package money

import (
	"errors"
	"fmt"
	"math/big"
	"strings"
)

// Money is an amount in minor units (1/100 rupiah). 900000000 == Rp. 9.000.000,00.
type Money int64

// ErrBadAmount is returned when a decimal string cannot be parsed.
var ErrBadAmount = errors.New("money: invalid amount")

// Parse reads a DECIMAL string such as "9000000.00" (or "9000000") into Money.
// Up to two fractional digits are honoured; more are rejected rather than
// silently truncated.
func Parse(s string) (Money, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, ErrBadAmount
	}
	neg := false
	switch s[0] {
	case '-':
		neg, s = true, s[1:]
	case '+':
		s = s[1:]
	}
	intPart, fracPart := s, ""
	if i := strings.IndexByte(s, '.'); i >= 0 {
		intPart, fracPart = s[:i], s[i+1:]
	}
	// Require at least one digit somewhere: reject "", "-", "+", ".", "-.".
	if intPart == "" && fracPart == "" {
		return 0, fmt.Errorf("%w: %q", ErrBadAmount, s)
	}
	if intPart == "" {
		intPart = "0"
	}
	if len(fracPart) > 2 {
		return 0, fmt.Errorf("%w: too many decimal places in %q", ErrBadAmount, s)
	}
	for _, c := range intPart + fracPart {
		if c < '0' || c > '9' {
			return 0, fmt.Errorf("%w: %q", ErrBadAmount, s)
		}
	}
	// Pad fraction to exactly two digits (minor units).
	frac := (fracPart + "00")[:2]
	rupiah := new(big.Int)
	if _, ok := rupiah.SetString(intPart, 10); !ok {
		return 0, fmt.Errorf("%w: %q", ErrBadAmount, s)
	}
	minor := new(big.Int).Mul(rupiah, big.NewInt(100))
	fracVal := new(big.Int)
	fracVal.SetString(frac, 10)
	minor.Add(minor, fracVal)
	if !minor.IsInt64() {
		return 0, fmt.Errorf("%w: overflow %q", ErrBadAmount, s)
	}
	v := Money(minor.Int64())
	if neg {
		v = -v
	}
	return v, nil
}

// Decimal renders Money as a DECIMAL(15,2) string ("9000000.00") for storage.
func (m Money) Decimal() string {
	neg := ""
	v := int64(m)
	if v < 0 {
		neg, v = "-", -v
	}
	return fmt.Sprintf("%s%d.%02d", neg, v/100, v%100)
}

// Format renders Money in the house IDR convention "Rp. X.XXX.XXX,00".
// Matches web-internal/src/lib/money.ts (whole rupiah grouped by '.', literal
// ",00"). Cents are dropped from display by design.
func (m Money) Format() string {
	neg := ""
	v := int64(m)
	if v < 0 {
		neg, v = "-", -v
	}
	rupiah := fmt.Sprintf("%d", v/100)
	return fmt.Sprintf("%sRp. %s,00", neg, groupThousands(rupiah))
}

func groupThousands(digits string) string {
	n := len(digits)
	if n <= 3 {
		return digits
	}
	var b strings.Builder
	pre := n % 3
	if pre > 0 {
		b.WriteString(digits[:pre])
		if n > pre {
			b.WriteByte('.')
		}
	}
	for i := pre; i < n; i += 3 {
		b.WriteString(digits[i : i+3])
		if i+3 < n {
			b.WriteByte('.')
		}
	}
	return b.String()
}

// PercentOf returns pct percent of base, rounded half-up to a whole rupiah
// (the result is always an exact multiple of 100 minor units). pctNumerator and
// pctScale express the percentage exactly: value = pctNumerator / 10^pctScale.
// e.g. 4.5% -> (45, 1); 10% -> (10, 0). All arithmetic is exact via math/big;
// a result that cannot be represented in a Money (int64 minor units) returns
// ErrBadAmount rather than silently wrapping.
func PercentOf(base Money, pctNumerator int64, pctScale int) (Money, error) {
	// commission_rupiah = base_minor * pct / (100 * 100)  where pct = num/10^scale
	//                   = base_minor * num / (10000 * 10^scale)
	num := new(big.Int).Mul(big.NewInt(int64(base)), big.NewInt(pctNumerator))
	den := new(big.Int).Mul(big.NewInt(10000), pow10(pctScale))
	rupiah := roundHalfUp(num, den)
	minor := rupiah.Mul(rupiah, big.NewInt(100))
	if !minor.IsInt64() {
		return 0, fmt.Errorf("%w: commission result out of range", ErrBadAmount)
	}
	return Money(minor.Int64()), nil
}

// Mul returns m multiplied by the whole factor n, guarding against int64
// overflow: a product that cannot be represented in Money (minor units) returns
// ErrBadAmount rather than silently wrapping. Used by the pricing calculator for
// quantity × unit price.
func Mul(m Money, n int64) (Money, error) {
	prod := new(big.Int).Mul(big.NewInt(int64(m)), big.NewInt(n))
	if !prod.IsInt64() {
		return 0, fmt.Errorf("%w: product out of range", ErrBadAmount)
	}
	return Money(prod.Int64()), nil
}

func pow10(n int) *big.Int {
	r := big.NewInt(1)
	ten := big.NewInt(10)
	for i := 0; i < n; i++ {
		r.Mul(r, ten)
	}
	return r
}

// roundHalfUp returns round(num/den) with .5 rounding away from zero. den > 0
// and even (a multiple of 10000). Returns a *big.Int so the caller can range-check.
func roundHalfUp(num, den *big.Int) *big.Int {
	neg := num.Sign() < 0
	n := new(big.Int).Abs(num)
	// (n + den/2) / den
	half := new(big.Int).Rsh(den, 1) // den is even (multiple of 10000); exact
	n.Add(n, half)
	q := new(big.Int).Quo(n, den)
	if neg {
		q.Neg(q)
	}
	return q
}
