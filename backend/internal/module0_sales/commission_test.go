package sales_test

// W1-06 money-math unit tests (tests-first house rule for money math,
// CLAUDE.md "Working style"). Pure functions — no DB. Every expected number
// is hand-computed so the evaluator is checked against arithmetic, not
// against itself.

import (
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/module0_sales"
)

func TestParseDecimalCents(t *testing.T) {
	ok := []struct {
		in    string
		cents int64
	}{
		{"0", 0},
		{"9000000", 900000000},
		{"9000000.5", 900000050},
		{"21900000.00", 2190000000},
		{"1234567.89", 123456789},
	}
	for _, tc := range ok {
		got, valid := sales.ParseDecimalCents(tc.in)
		if !valid || got != tc.cents {
			t.Errorf("ParseDecimalCents(%q) = %d, %v; want %d, true", tc.in, got, valid, tc.cents)
		}
	}
	for _, bad := range []string{"", "-5", "1.234", "abc", "1,5", "Rp. 1.000", "1.000.000", " 5"} {
		if _, valid := sales.ParseDecimalCents(bad); valid {
			t.Errorf("ParseDecimalCents(%q) accepted, want rejected", bad)
		}
	}
}

func TestCentsToDecimal_RoundTrip(t *testing.T) {
	for _, c := range []int64{0, 5, 50, 900000000, 2190000000, 123456789} {
		s := sales.CentsToDecimal(c)
		back, ok := sales.ParseDecimalCents(s)
		if !ok || back != c {
			t.Errorf("round-trip %d -> %q -> %d, %v", c, s, back, ok)
		}
	}
}

// TestFormatIDR pins house convention #7: `Rp. X.XXX.XXX,00`, and Dash for
// anything uncomputable (§2.7 — never an error).
func TestFormatIDR(t *testing.T) {
	cases := []struct{ in, want string }{
		{"21900000.00", "Rp. 21.900.000,00"},
		{"9000000", "Rp. 9.000.000,00"},
		{"6900000.00", "Rp. 6.900.000,00"},
		{"1234567.89", "Rp. 1.234.567,89"},
		{"0", "Rp. 0,00"},
		{"500", "Rp. 500,00"},
		{"", sales.Dash},
		{"abc", sales.Dash},
		{"-1", sales.Dash},
	}
	for _, tc := range cases {
		if got := sales.FormatIDR(tc.in); got != tc.want {
			t.Errorf("FormatIDR(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestEvaluateCommissionRule_Percent(t *testing.T) {
	cases := []struct {
		name       string
		rule       string
		priceCents int64
		wantCents  int64
	}{
		// Alpha Digital worked example scale: 10% of Rp 9.000.000 = Rp 900.000.
		{"10 pct of 9jt", `{"type":"percent","value":10}`, 900000000, 90000000},
		// Fractional percent stays exact: 12.5% of Rp 6.900.000 = Rp 862.500.
		{"12.5 pct of 6.9jt", `{"type":"percent","value":12.5}`, 690000000, 86250000},
		{"0 pct", `{"type":"percent","value":0}`, 900000000, 0},
		{"100 pct", `{"type":"percent","value":100}`, 900000000, 900000000},
		// Sub-cent result rounds HALF-UP: 0.5% of 1 cent = 0.005 cents -> 0;
		// 0.5% of Rp 1 (100 cents) = 0.5 cents -> 1 cent.
		{"half-up boundary up", `{"type":"percent","value":0.5}`, 100, 1},
		{"half-up boundary down", `{"type":"percent","value":0.5}`, 1, 0},
	}
	for _, tc := range cases {
		got, pending, err := sales.EvaluateCommissionRule(tc.rule, tc.priceCents)
		if err != nil || pending {
			t.Errorf("%s: err=%v pending=%v", tc.name, err, pending)
			continue
		}
		if got != tc.wantCents {
			t.Errorf("%s: got %d cents, want %d", tc.name, got, tc.wantCents)
		}
	}
}

func TestEvaluateCommissionRule_FlatAndPending(t *testing.T) {
	got, pending, err := sales.EvaluateCommissionRule(`{"type":"flat","amount":500000}`, 600000000)
	if err != nil || pending || got != 50000000 {
		t.Fatalf("flat: got %d, pending=%v, err=%v; want 50000000 cents", got, pending, err)
	}

	// The seed placeholder is NEVER computed (Build Plan R3): pending, no amount.
	got, pending, err = sales.EvaluateCommissionRule(`{"type":"pending_master_list"}`, 600000000)
	if err != nil || !pending || got != 0 {
		t.Fatalf("pending: got %d, pending=%v, err=%v; want 0, true", got, pending, err)
	}
}

func TestEvaluateCommissionRule_BadRules(t *testing.T) {
	bad := []string{
		`not json`,
		`{"type":"margin","value":10}`,         // unknown type
		`{"type":"percent"}`,                   // missing value
		`{"type":"percent","value":-10}`,       // negative percent
		`{"type":"flat"}`,                      // missing amount
		`{"type":"flat","amount":-1}`,          // negative flat
		`{"type":"flat","amount":1.5}`,         // non-integer IDR flat
		`{"type":"percent","value":"sepuluh"}`, // non-numeric
	}
	for _, rule := range bad {
		_, _, err := sales.EvaluateCommissionRule(rule, 100000)
		var ruleErr *sales.CommissionRuleError
		if !errors.As(err, &ruleErr) {
			t.Errorf("rule %s: err = %v, want *CommissionRuleError", rule, err)
		}
	}
}
