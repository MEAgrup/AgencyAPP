// Sales Allocation for the Closing Form (M0 §6, W1-09; OD-1 Sales Allocation).
//
// Rules enforced server-side (PERMISSIONS.md M0: "allocation Σ=100% enforced"):
//   - Primary Salesperson is mandatory and must be one of the allocation rows.
//   - At most 5 salespeople total (Primary + up to 4).
//   - Every share is a positive percentage; the shares sum to EXACTLY 100%.
//   - Commission & Payment PIC is mandatory when >1 salesperson and must be an
//     allocation member; when closing solo it defaults to the Primary (OD-1/OD-3).
//
// Percentages are held as integer basis points (100% == 10000) so the Σ=100%
// check is exact — no float ever decides whether a split is valid.
package module0_sales

import (
	"errors"
	"fmt"
	"strings"
)

// MaxSalespeople is the Closing Form cap (M0 §6 rule 3).
const MaxSalespeople = 5

// FullAllocationBP is 100% expressed in basis points.
const FullAllocationBP = 10000

// Exact Bahasa Indonesia messages (authorized in DECISIONS.md 2026-07-09).
const (
	AllocationTotalMessage    = "[total alokasi sales harus 100%]"
	TooManySalespeopleMessage = "[maksimal 5 salesperson per closing!]"
)

// Sentinel errors.
var (
	ErrAllocationTotal      = errors.New(AllocationTotalMessage)
	ErrTooManySalespeople   = errors.New(TooManySalespeopleMessage)
	ErrAllocationIncomplete = errors.New(IncompleteMessage)
)

// Allocation is one salesperson's share of a closing.
type Allocation struct {
	SalespersonID string `json:"salesperson_id"`
	BasisPoints   int    `json:"basis_points"` // 100% == 10000
}

// PercentString renders the share as a percentage string, e.g. "33.34" or "50".
func (a Allocation) PercentString() string { return bpToPercent(a.BasisPoints) }

// ClosingParties is the salespeople side of a Closing Form submission.
type ClosingParties struct {
	PrimarySalespersonID   string       `json:"primary_salesperson_id"`
	Allocations            []Allocation `json:"allocations"`
	CommissionPaymentPICID string       `json:"commission_payment_pic_id"`
}

// Validate enforces the full allocation rule set (M0 §6). Order of checks is
// chosen so the most specific money rule (Σ=100%) and the count rule surface
// their own BI messages; structural problems fall back to the incomplete
// default.
func (c ClosingParties) Validate() error {
	if strings.TrimSpace(c.PrimarySalespersonID) == "" || len(c.Allocations) == 0 {
		return ErrAllocationIncomplete
	}
	if len(c.Allocations) > MaxSalespeople {
		return ErrTooManySalespeople
	}

	seen := map[string]bool{}
	primaryIncluded := false
	sum := 0
	for _, a := range c.Allocations {
		id := strings.TrimSpace(a.SalespersonID)
		if id == "" || a.BasisPoints <= 0 {
			return ErrAllocationIncomplete
		}
		if seen[id] {
			return ErrAllocationIncomplete // a salesperson may appear at most once
		}
		seen[id] = true
		if id == c.PrimarySalespersonID {
			primaryIncluded = true
		}
		sum += a.BasisPoints
	}
	if !primaryIncluded {
		return ErrAllocationIncomplete // Primary must hold a share
	}
	if sum != FullAllocationBP {
		return ErrAllocationTotal
	}

	// Commission & Payment PIC: mandatory when >1 salesperson, must be a member.
	if len(c.Allocations) > 1 {
		pic := strings.TrimSpace(c.CommissionPaymentPICID)
		if pic == "" {
			return ErrAllocationIncomplete
		}
		if !seen[pic] {
			return ErrAllocationIncomplete
		}
	}
	return nil
}

// ResolvedPIC returns the Commission & Payment PIC, defaulting to the Primary
// Salesperson when closing solo (OD-1). Call only after Validate passes.
func (c ClosingParties) ResolvedPIC() string {
	if len(c.Allocations) == 1 || strings.TrimSpace(c.CommissionPaymentPICID) == "" {
		return c.PrimarySalespersonID
	}
	return c.CommissionPaymentPICID
}

// bpToPercent renders basis points as a minimal percentage string.
func bpToPercent(bp int) string {
	whole := bp / 100
	frac := bp % 100
	if frac == 0 {
		return fmt.Sprintf("%d", whole)
	}
	s := fmt.Sprintf("%d.%02d", whole, frac)
	return strings.TrimRight(s, "0")
}
