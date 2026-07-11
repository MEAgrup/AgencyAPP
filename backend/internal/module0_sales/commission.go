package sales

// commission.go — W1-06 money math for the Qualified Lead Form (M0 §4.3):
// the commission-rule evaluator behind the auto-computed, read-only
// "Perhitungan Komisi" (house convention #4) and the IDR render helpers
// (house convention #7: `Rp. X.XXX.XXX,00`; empty/uncomputable renders `—`,
// never an error).
//
// All money travels as integer IDR cents (matching the DECIMAL(18,2)
// columns) or as decimal string literals ("21900000.00") — never floats.
// Percent math goes through math/big.Rat so a hand-computed fixture matches
// exactly (W1-06 AC).
//
// These helpers are exported deliberately: W1-07/08 (negotiation) re-evaluate
// commission against proposed prices with the same rules, and W1-09 (closing)
// formats final values. If a third module needs them, promote to a core
// package (decision-log it) rather than duplicating.

import (
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"regexp"
	"strconv"
	"strings"
)

// Dash is the render for an empty/uncomputable metric value (house
// convention #7 / Phase 0 §2.7): division-by-zero or a not-yet-known number
// displays `—`, never an error.
const Dash = "—"

// decimalAmountPattern accepts non-negative DECIMAL(18,2)-style literals,
// same shape internal/core/msl enforces for standard prices.
var decimalAmountPattern = regexp.MustCompile(`^\d+(\.\d{1,2})?$`)

// ParseDecimalCents converts a non-negative decimal literal ("21900000",
// "21900000.5", "21900000.00") to integer IDR cents. ok is false for
// anything else (negative, malformed, >2 decimals, overflow).
func ParseDecimalCents(s string) (cents int64, ok bool) {
	if !decimalAmountPattern.MatchString(s) {
		return 0, false
	}
	intPart, frac, _ := strings.Cut(s, ".")
	n, err := strconv.ParseInt(intPart, 10, 64)
	if err != nil {
		return 0, false
	}
	for len(frac) < 2 {
		frac += "0"
	}
	f, err := strconv.ParseInt(frac, 10, 64)
	if err != nil {
		return 0, false
	}
	if n > (math.MaxInt64-f)/100 {
		return 0, false
	}
	return n*100 + f, true
}

// CentsToDecimal renders non-negative IDR cents as the canonical DECIMAL(18,2)
// literal ("21900000.00") stored in the money columns.
func CentsToDecimal(cents int64) string {
	return fmt.Sprintf("%d.%02d", cents/100, cents%100)
}

// FormatIDR renders a decimal amount literal in the house IDR format
// `Rp. X.XXX.XXX,00` (CLAUDE.md convention #7). An empty or malformed
// amount renders Dash (`—`), never an error (§2.7).
func FormatIDR(amount string) string {
	cents, ok := ParseDecimalCents(amount)
	if !ok {
		return Dash
	}
	return FormatIDRCents(cents)
}

// FormatIDRCents renders non-negative IDR cents as `Rp. X.XXX.XXX,00`.
func FormatIDRCents(cents int64) string {
	intPart := strconv.FormatInt(cents/100, 10)
	var b strings.Builder
	for i := 0; i < len(intPart); i++ {
		if i > 0 && (len(intPart)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteByte(intPart[i])
	}
	return fmt.Sprintf("Rp. %s,%02d", b.String(), cents%100)
}

// CommissionRuleError reports a Master Service List commission rule this
// evaluator cannot understand (malformed JSON, unknown type, negative or
// missing operand). It is an internal data-integrity failure — NOT a BI
// validation message — because the salesperson cannot fix the master list;
// the submit is blocked with zero side effects and the MSL entry needs a
// Sales Head/SPV correction.
type CommissionRuleError struct {
	Rule   string
	Reason string
}

func (e *CommissionRuleError) Error() string {
	return fmt.Sprintf("sales: unsupported commission rule %s: %s", e.Rule, e.Reason)
}

// commissionRuleJSON is the decoded shape of a Master Service List
// commission rule. Numbers stay json.Number so percent values are evaluated
// exactly (no float64 detour).
type commissionRuleJSON struct {
	Type   string      `json:"type"`
	Value  json.Number `json:"value"`  // percent: percent of the standard price
	Amount json.Number `json:"amount"` // flat: integer IDR amount
}

// CommissionRulePending is the seed placeholder type that MUST NOT be
// computed (docs/HANDOFF.md, Build Plan R3): the validated master list from
// the Sales Head is still outstanding, so commission stays NULL and the form
// is flagged commission_pending instead of guessing a number.
const CommissionRulePending = "pending_master_list"

// EvaluateCommissionRule evaluates one Master Service List commission rule
// against a service's standard price (integer IDR cents):
//
//   - {"type":"percent","value":<number>} → round-half-up(price × value/100),
//     evaluated exactly via math/big.Rat;
//   - {"type":"flat","amount":<int IDR>}  → amount × 100 cents (price-independent);
//   - {"type":"pending_master_list"}      → pending=true, no amount (never guessed);
//   - anything else → *CommissionRuleError (submit blocked, zero side effects).
func EvaluateCommissionRule(ruleJSON string, standardPriceCents int64) (amountCents int64, pending bool, err error) {
	dec := json.NewDecoder(strings.NewReader(ruleJSON))
	dec.UseNumber()
	dec.DisallowUnknownFields()
	var rule commissionRuleJSON
	if err := dec.Decode(&rule); err != nil {
		return 0, false, &CommissionRuleError{Rule: ruleJSON, Reason: "malformed JSON: " + err.Error()}
	}

	switch rule.Type {
	case CommissionRulePending:
		return 0, true, nil

	case "percent":
		if rule.Value == "" {
			return 0, false, &CommissionRuleError{Rule: ruleJSON, Reason: `percent rule missing "value"`}
		}
		val, ok := new(big.Rat).SetString(rule.Value.String())
		if !ok || val.Sign() < 0 {
			return 0, false, &CommissionRuleError{Rule: ruleJSON, Reason: `percent "value" is not a non-negative number`}
		}
		if standardPriceCents < 0 {
			return 0, false, &CommissionRuleError{Rule: ruleJSON, Reason: "negative standard price"}
		}
		// commission = price × value / 100, rounded half-up to whole cents.
		r := new(big.Rat).SetInt64(standardPriceCents)
		r.Mul(r, val)
		r.Quo(r, big.NewRat(100, 1))
		cents, ok := ratToCentsHalfUp(r)
		if !ok {
			return 0, false, &CommissionRuleError{Rule: ruleJSON, Reason: "percent result overflows int64 cents"}
		}
		return cents, false, nil

	case "flat":
		if rule.Amount == "" {
			return 0, false, &CommissionRuleError{Rule: ruleJSON, Reason: `flat rule missing "amount"`}
		}
		amt, err := rule.Amount.Int64()
		if err != nil || amt < 0 {
			return 0, false, &CommissionRuleError{Rule: ruleJSON, Reason: `flat "amount" is not a non-negative integer IDR value`}
		}
		if amt > math.MaxInt64/100 {
			return 0, false, &CommissionRuleError{Rule: ruleJSON, Reason: "flat amount overflows int64 cents"}
		}
		return amt * 100, false, nil

	default:
		return 0, false, &CommissionRuleError{Rule: ruleJSON, Reason: fmt.Sprintf("unknown rule type %q", rule.Type)}
	}
}

// ratToCentsHalfUp rounds a non-negative big.Rat (already denominated in
// cents) half-up to an integer: floor((2·num + den) / (2·den)).
func ratToCentsHalfUp(r *big.Rat) (int64, bool) {
	num := new(big.Int).Set(r.Num())
	den := new(big.Int).Set(r.Denom()) // always > 0 for big.Rat
	two := big.NewInt(2)

	num.Mul(num, two)
	num.Add(num, den)
	den.Mul(den, two)
	num.Div(num, den) // Euclidean-style floor is fine: operands non-negative

	if !num.IsInt64() {
		return 0, false
	}
	return num.Int64(), true
}
