package module0_sales

import (
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/money"
)

func mustRule(t *testing.T, s string) CommissionRule {
	t.Helper()
	r, err := ParseCommissionRule(s)
	if err != nil {
		t.Fatalf("ParseCommissionRule(%q): %v", s, err)
	}
	return r
}

func TestParseCommissionRule(t *testing.T) {
	rp := func(s string) money.Money { m, _ := money.Parse(s); return m }
	cases := []struct {
		rule  string
		price string
		want  money.Money
	}{
		{"5% of standard price", "9000000.00", rp("450000.00")},
		{"4% of standard price", "7500000.00", rp("300000.00")},
		{"4.5% of standard price", "10000000.00", rp("450000.00")},
		{"flat Rp 500.000", "12000000.00", rp("500000.00")},
		{"flat Rp 1.250.000", "99999999.00", rp("1250000.00")},
	}
	for _, c := range cases {
		r := mustRule(t, c.rule)
		price, _ := money.Parse(c.price)
		if got := r.Compute(price); got != c.want {
			t.Errorf("rule %q on %s = %s, want %s", c.rule, c.price, got.Format(), c.want.Format())
		}
		if r.String() != c.rule {
			t.Errorf("String() = %q, want %q", r.String(), c.rule)
		}
	}
}

func TestParseCommissionRuleRejectsUnknown(t *testing.T) {
	for _, bad := range []string{
		"", "10%", "10 percent", "flat 500000", "flat Rp abc",
		"5% of price", "tiered", "Rp 500.000",
	} {
		if _, err := ParseCommissionRule(bad); !errors.Is(err, ErrBadCommissionRule) {
			t.Errorf("ParseCommissionRule(%q) err = %v, want ErrBadCommissionRule", bad, err)
		}
	}
}

// TestQuoteAlphaDigital reproduces the M0 §4.3 worked example: three services
// summing to Estimasi Nilai Transaksi = Rp. 21.900.000,00. Commission rules are
// test fixtures (the PRD gives no commission numbers for this example — see M0
// spec / DECISIONS O14), chosen to exercise both rule shapes.
func TestQuoteAlphaDigital(t *testing.T) {
	lines := []ServiceLine{
		mustLine(t, "SVC-A", "Pendampingan Establish TikTok", "9000000.00", "5% of standard price"),
		mustLine(t, "SVC-B", "Jasa Buka Toko Online Basic", "6000000.00", "flat Rp 500.000"),
		mustLine(t, "SVC-C", "Jasa Live Streaming Basic", "6900000.00", "4% of standard price"),
	}
	q, err := BuildQuote(lines)
	if err != nil {
		t.Fatalf("BuildQuote: %v", err)
	}
	if q.EstimasiNilaiIDR != "Rp. 21.900.000,00" {
		t.Errorf("Estimasi Nilai = %q, want Rp. 21.900.000,00", q.EstimasiNilaiIDR)
	}
	// 450.000 + 500.000 + 276.000 = 1.226.000
	if q.TotalKomisiIDR != "Rp. 1.226.000,00" {
		t.Errorf("Total Komisi = %q, want Rp. 1.226.000,00", q.TotalKomisiIDR)
	}
	if len(q.Lines) != 3 {
		t.Fatalf("want 3 line quotes, got %d", len(q.Lines))
	}
	if q.Lines[2].KomisiIDR != "Rp. 276.000,00" {
		t.Errorf("Live Streaming komisi = %q, want Rp. 276.000,00", q.Lines[2].KomisiIDR)
	}
}

func TestBuildQuoteLimits(t *testing.T) {
	// Empty selection -> incomplete.
	if _, err := BuildQuote(nil); !errors.Is(err, ErrNoServices) {
		t.Errorf("empty BuildQuote err = %v, want ErrNoServices", err)
	}
	// Exactly 5 is allowed.
	five := make([]ServiceLine, 5)
	for i := range five {
		five[i] = mustLine(t, "S", "svc", "1000000.00", "10% of standard price")
	}
	if _, err := BuildQuote(five); err != nil {
		t.Errorf("5 services should be allowed, got %v", err)
	}
	// 6 is blocked with the exact BI message.
	six := append(five, mustLine(t, "S6", "svc", "1000000.00", "10% of standard price"))
	_, err := BuildQuote(six)
	if !errors.Is(err, ErrTooManyServices) {
		t.Fatalf("6 services err = %v, want ErrTooManyServices", err)
	}
	if err.Error() != "[maksimal pilih 5 jasa saja!]" {
		t.Errorf("message = %q, want [maksimal pilih 5 jasa saja!]", err.Error())
	}
}

func mustLine(t *testing.T, id, name, price, rule string) ServiceLine {
	t.Helper()
	l, err := NewServiceLine(id, name, price, rule)
	if err != nil {
		t.Fatalf("NewServiceLine(%q,%q): %v", price, rule, err)
	}
	return l
}
