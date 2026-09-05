package module0_sales

// pricing.go is the MSL v2 "Kalkulator Service Jasa" line-subtotal engine
// (DECISIONS 2026-07-16). Semantics are copied verbatim from the sales sheet:
//
//	flat:          subtotal = qty × unit_price                         (qty ≥ 1)
//	min_floor:     subtotal = max(qty, min_qty) × unit_price           (IF(qty<=min, min*price, qty*price))
//	batch_ceiling: subtotal = ceil(qty / min_qty) × min_qty × unit_price   (CEILING(qty, min)*price)
//	passthrough:   subtotal = input_amount (rupiah)                    (unit_price ignored)
//	apply_ppn:     subtotal += round_half_up(subtotal × 11%)
//
// Quantities are whole numbers; min_qty is stored DECIMAL but must be a whole
// positive integer. All rupiah arithmetic is exact via core/money (CLAUDE.md #4)
// and int64 overflow on multiplication is guarded, never silently wrapped.

import (
	"errors"

	"github.com/meagrup/agencyapp/backend/internal/core/money"
)

// Pricing modes (MSL v2 calculator).
const (
	PricingFlat         = "flat"
	PricingMinFloor     = "min_floor"
	PricingBatchCeiling = "batch_ceiling"
	PricingPassthrough  = "passthrough"
)

// PPN surcharge: 11% of the subtotal, expressed for money.PercentOf.
const (
	ppnNumerator int64 = 11
	ppnScale           = 0
)

var pricingModeSet = map[string]bool{
	PricingFlat: true, PricingMinFloor: true, PricingBatchCeiling: true, PricingPassthrough: true,
}

// errPriceOverflow is an engineering guard (not a BI prompt): a quantity product
// that cannot fit int64 surfaces rather than wrapping to a negative subtotal.
var errPriceOverflow = errors.New("module0_sales: price calculation overflow")

// PriceParams are the resolved calculator inputs for one service line.
type PriceParams struct {
	Mode        string
	UnitPrice   money.Money
	Quantity    int64
	MinQty      int64
	InputAmount money.Money
	ApplyPPN    bool
}

// ComputeSubtotal returns the line subtotal per the sheet formulas. Business-rule
// violations (bad mode, qty < 1, missing min_qty, non-positive passthrough
// amount) return ErrIncomplete; an out-of-range product returns errPriceOverflow.
func ComputeSubtotal(p PriceParams) (money.Money, error) {
	if !pricingModeSet[p.Mode] {
		return 0, ErrIncomplete
	}

	if p.Mode == PricingPassthrough {
		if p.InputAmount <= 0 {
			return 0, ErrIncomplete
		}
		return applyPPN(p.InputAmount, p.ApplyPPN)
	}

	if p.Quantity < 1 {
		return 0, ErrIncomplete
	}

	var effQty int64
	switch p.Mode {
	case PricingFlat:
		effQty = p.Quantity
	case PricingMinFloor:
		if p.MinQty < 1 {
			return 0, ErrIncomplete
		}
		effQty = p.Quantity
		if p.MinQty > effQty {
			effQty = p.MinQty
		}
	case PricingBatchCeiling:
		if p.MinQty < 1 {
			return 0, ErrIncomplete
		}
		batches := (p.Quantity + p.MinQty - 1) / p.MinQty
		var err error
		if effQty, err = mulQty(batches, p.MinQty); err != nil {
			return 0, err
		}
	}

	subtotal, err := money.Mul(p.UnitPrice, effQty)
	if err != nil {
		return 0, err
	}
	return applyPPN(subtotal, p.ApplyPPN)
}

// applyPPN adds 11% PPN (half-up to whole rupiah) when the flag is set.
func applyPPN(subtotal money.Money, apply bool) (money.Money, error) {
	if !apply {
		return subtotal, nil
	}
	ppn, err := money.PercentOf(subtotal, ppnNumerator, ppnScale)
	if err != nil {
		return 0, err
	}
	return subtotal + ppn, nil
}

// mulQty multiplies two non-negative whole quantities, guarding int64 overflow.
func mulQty(a, b int64) (int64, error) {
	if a == 0 || b == 0 {
		return 0, nil
	}
	p := a * b
	if p/b != a {
		return 0, errPriceOverflow
	}
	return p, nil
}

// parseWholeQty parses a DECIMAL string into a whole positive integer, rejecting
// fractional or non-positive values. Reuses money.Parse for exact decimal
// reading (minor units), then requires an exact multiple of 100 (no cents).
func parseWholeQty(s string) (int64, bool) {
	m, err := money.Parse(s)
	if err != nil || m <= 0 || int64(m)%100 != 0 {
		return 0, false
	}
	return int64(m) / 100, true
}
