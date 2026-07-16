package module0_sales

import (
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/money"
)

func rp(t *testing.T, s string) money.Money {
	t.Helper()
	m, err := money.Parse(s)
	if err != nil {
		t.Fatalf("money.Parse(%q): %v", s, err)
	}
	return m
}

func TestComputeSubtotal(t *testing.T) {
	cases := []struct {
		name string
		p    PriceParams
		want string
	}{
		{"flat qty 1", PriceParams{Mode: PricingFlat, UnitPrice: rp(t, "150000"), Quantity: 1}, "150000.00"},
		{"flat qty 4", PriceParams{Mode: PricingFlat, UnitPrice: rp(t, "150000"), Quantity: 4}, "600000.00"},

		// min_floor min=5 price=150000: qty 3 -> 750000; qty 7 -> 1050000.
		{"min_floor below floor", PriceParams{Mode: PricingMinFloor, UnitPrice: rp(t, "150000"), Quantity: 3, MinQty: 5}, "750000.00"},
		{"min_floor above floor", PriceParams{Mode: PricingMinFloor, UnitPrice: rp(t, "150000"), Quantity: 7, MinQty: 5}, "1050000.00"},
		{"min_floor at floor", PriceParams{Mode: PricingMinFloor, UnitPrice: rp(t, "150000"), Quantity: 5, MinQty: 5}, "750000.00"},

		// min_floor min=300 price=10000 ppn: qty 300 -> 3000000 + 330000.
		{"min_floor ppn", PriceParams{Mode: PricingMinFloor, UnitPrice: rp(t, "10000"), Quantity: 300, MinQty: 300, ApplyPPN: true}, "3330000.00"},

		// batch_ceiling min=5 price=50000: qty 7 -> 500000; qty 5 -> 250000.
		{"batch_ceiling round up", PriceParams{Mode: PricingBatchCeiling, UnitPrice: rp(t, "50000"), Quantity: 7, MinQty: 5}, "500000.00"},
		{"batch_ceiling exact", PriceParams{Mode: PricingBatchCeiling, UnitPrice: rp(t, "50000"), Quantity: 5, MinQty: 5}, "250000.00"},
		{"batch_ceiling one over", PriceParams{Mode: PricingBatchCeiling, UnitPrice: rp(t, "50000"), Quantity: 6, MinQty: 5}, "500000.00"},
		// min=1 behaves as flat.
		{"batch_ceiling min 1 is flat", PriceParams{Mode: PricingBatchCeiling, UnitPrice: rp(t, "50000"), Quantity: 7, MinQty: 1}, "350000.00"},

		// passthrough ppn: amount 8500000 -> 9435000.
		{"passthrough", PriceParams{Mode: PricingPassthrough, InputAmount: rp(t, "8500000")}, "8500000.00"},
		{"passthrough ppn", PriceParams{Mode: PricingPassthrough, InputAmount: rp(t, "8500000"), ApplyPPN: true}, "9435000.00"},
		// passthrough ignores unit price entirely.
		{"passthrough ignores unit price", PriceParams{Mode: PricingPassthrough, UnitPrice: rp(t, "999"), InputAmount: rp(t, "8500000")}, "8500000.00"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := ComputeSubtotal(c.p)
			if err != nil {
				t.Fatalf("ComputeSubtotal: %v", err)
			}
			if want := rp(t, c.want); got != want {
				t.Errorf("ComputeSubtotal = %s, want %s", got.Format(), want.Format())
			}
		})
	}
}

func TestComputeSubtotalRejects(t *testing.T) {
	cases := []struct {
		name string
		p    PriceParams
	}{
		{"unknown mode", PriceParams{Mode: "tiered", UnitPrice: rp(t, "1000"), Quantity: 1}},
		{"flat qty 0", PriceParams{Mode: PricingFlat, UnitPrice: rp(t, "1000"), Quantity: 0}},
		{"min_floor missing min", PriceParams{Mode: PricingMinFloor, UnitPrice: rp(t, "1000"), Quantity: 3, MinQty: 0}},
		{"batch missing min", PriceParams{Mode: PricingBatchCeiling, UnitPrice: rp(t, "1000"), Quantity: 3, MinQty: 0}},
		{"passthrough zero amount", PriceParams{Mode: PricingPassthrough, InputAmount: 0}},
		{"passthrough negative amount", PriceParams{Mode: PricingPassthrough, InputAmount: -100}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, err := ComputeSubtotal(c.p); !errors.Is(err, ErrIncomplete) {
				t.Errorf("ComputeSubtotal err = %v, want ErrIncomplete", err)
			}
		})
	}
}

func TestComputeSubtotalOverflow(t *testing.T) {
	// A huge quantity × min_qty product must error, not wrap negative.
	p := PriceParams{Mode: PricingBatchCeiling, UnitPrice: rp(t, "1000"), Quantity: 1<<62 + 1, MinQty: 1 << 62}
	if _, err := ComputeSubtotal(p); err == nil {
		t.Error("overflowing batch product should return an error")
	}
}

func TestParseWholeQty(t *testing.T) {
	ok := map[string]int64{"5": 5, "5.00": 5, "300.00": 300, "1": 1}
	for s, want := range ok {
		got, valid := parseWholeQty(s)
		if !valid || got != want {
			t.Errorf("parseWholeQty(%q) = (%d,%v), want (%d,true)", s, got, valid, want)
		}
	}
	for _, s := range []string{"", "0", "-1", "5.50", "0.01", "abc"} {
		if _, valid := parseWholeQty(s); valid {
			t.Errorf("parseWholeQty(%q) should be invalid", s)
		}
	}
}

func TestCommissionOnSubtotal(t *testing.T) {
	// "10% of standard price" now computes on the LINE SUBTOTAL: 10% of 1.050.000
	// = 105.000. A flat rule is unchanged regardless of subtotal.
	pct := mustRule(t, "10% of standard price")
	got, err := pct.Compute(rp(t, "1050000"))
	if err != nil {
		t.Fatalf("Compute: %v", err)
	}
	if want := rp(t, "105000"); got != want {
		t.Errorf("pct commission = %s, want %s", got.Format(), want.Format())
	}

	flat := mustRule(t, "flat Rp 500.000")
	got, err = flat.Compute(rp(t, "1050000"))
	if err != nil {
		t.Fatalf("Compute: %v", err)
	}
	if want := rp(t, "500000"); got != want {
		t.Errorf("flat commission = %s, want %s", got.Format(), want.Format())
	}
}

// TestBuildQuoteCalculator exercises the calculator through BuildQuote end to
// end: mixed modes, PPN, and commission computed on each line subtotal.
func TestBuildQuoteCalculator(t *testing.T) {
	lines := []ServiceLine{
		{ServiceID: "S1", Name: "Konten", StandardPrice: rp(t, "150000"), Mode: PricingMinFloor,
			Quantity: 7, MinQty: 5, Unit: "per produk", Rule: mustRule(t, "10% of standard price")},
		{ServiceID: "S2", Name: "Passthrough Ads", StandardPrice: 0, Mode: PricingPassthrough,
			InputAmount: rp(t, "8500000"), ApplyPPN: true, Unit: "Paket", Rule: mustRule(t, "flat Rp 500.000")},
	}
	q, err := BuildQuote(lines)
	if err != nil {
		t.Fatalf("BuildQuote: %v", err)
	}
	// Line 1 subtotal = 7 × 150000 = 1.050.000; komisi 10% = 105.000.
	if q.Lines[0].SubtotalIDR != "Rp. 1.050.000,00" {
		t.Errorf("line0 subtotal = %q", q.Lines[0].SubtotalIDR)
	}
	if q.Lines[0].KomisiIDR != "Rp. 105.000,00" {
		t.Errorf("line0 komisi = %q", q.Lines[0].KomisiIDR)
	}
	if q.Lines[0].Quantity != 7 || q.Lines[0].Unit != "per produk" {
		t.Errorf("line0 qty/unit = %d/%q", q.Lines[0].Quantity, q.Lines[0].Unit)
	}
	// Line 2 subtotal = 8.500.000 + 11% = 9.435.000; komisi flat = 500.000.
	if q.Lines[1].SubtotalIDR != "Rp. 9.435.000,00" {
		t.Errorf("line1 subtotal = %q", q.Lines[1].SubtotalIDR)
	}
	if q.Lines[1].KomisiIDR != "Rp. 500.000,00" {
		t.Errorf("line1 komisi = %q", q.Lines[1].KomisiIDR)
	}
	// Estimasi Nilai = 1.050.000 + 9.435.000 = 10.485.000.
	if q.EstimasiNilaiIDR != "Rp. 10.485.000,00" {
		t.Errorf("estimasi nilai = %q, want Rp. 10.485.000,00", q.EstimasiNilaiIDR)
	}
	if q.TotalKomisiIDR != "Rp. 605.000,00" {
		t.Errorf("total komisi = %q, want Rp. 605.000,00", q.TotalKomisiIDR)
	}
}
