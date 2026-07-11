// Package module0_sales holds Module 0 (Sales) domain logic. This file is the
// money math for the Qualified Lead Form / Closing (W1-06, W1-09):
//
//   - Estimasi Nilai Transaksi = Σ standard prices of the selected services
//     (from the Master Service List version effective at the reference date).
//   - Perhitungan Komisi       = Σ per-service commission, each computed from
//     that service's own commission_rule.
//
// Both are auto-calculated, read-only, and always recomputable from the master
// version + selection (CLAUDE.md #4). All arithmetic is exact via core/money.
//
// commission_rule grammar (provisional — DECISIONS.md O14): exactly the two
// shapes present in the seed data are accepted; anything else is rejected
// rather than guessed:
//
//	"<N>% of standard price"   percentage of that service's standard price
//	"flat Rp <N>"              fixed rupiah amount (dots = thousands separators)
package module0_sales

import (
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/meagrup/agencyapp/backend/internal/core/money"
)

// MaxServices is the Qualified Lead Form service cap (M0 §4.3).
const MaxServices = 5

// Exact Bahasa Indonesia messages.
const (
	// MaxServicesMessage is M0 §4.3's verbatim over-limit message.
	MaxServicesMessage = "[maksimal pilih 5 jasa saja!]"
	// IncompleteMessage is the house default for a failed mandatory-field gate.
	IncompleteMessage = "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]"
)

// Sentinel errors.
var (
	ErrTooManyServices   = errors.New(MaxServicesMessage)
	ErrNoServices        = errors.New(IncompleteMessage)
	ErrBadCommissionRule = errors.New("module0_sales: unrecognized commission_rule")
)

var (
	rePct = regexp.MustCompile(`^(\d+)(?:\.(\d+))?% of standard price$`)
	// Amount is either a plain digit run ("500000") or properly thousands-grouped
	// ("500.000", "1.250.000"). Malformed dot patterns ("500.00", "1.5") are rejected.
	reFlat = regexp.MustCompile(`^flat Rp (\d+|\d{1,3}(?:\.\d{3})+)$`)
)

// CommissionRule is a parsed, immutable commission rule for one service.
type CommissionRule struct {
	raw      string
	isFlat   bool
	flat     money.Money // when isFlat
	pctNum   int64       // when percentage: value = pctNum / 10^pctScale percent
	pctScale int
}

// ParseCommissionRule parses a Master Service List commission_rule string.
// Only the two documented shapes are accepted (see package doc / DECISIONS O14).
func ParseCommissionRule(rule string) (CommissionRule, error) {
	r := strings.TrimSpace(rule)
	if m := rePct.FindStringSubmatch(r); m != nil {
		whole, frac := m[1], m[2]
		numStr := whole + frac
		var num int64
		if _, err := fmt.Sscanf(numStr, "%d", &num); err != nil {
			return CommissionRule{}, fmt.Errorf("%w: %q", ErrBadCommissionRule, rule)
		}
		return CommissionRule{raw: r, pctNum: num, pctScale: len(frac)}, nil
	}
	if m := reFlat.FindStringSubmatch(r); m != nil {
		// Dots are thousands separators, e.g. "500.000" -> 500000 rupiah.
		digits := strings.ReplaceAll(m[1], ".", "")
		amt, err := money.Parse(digits)
		if err != nil {
			return CommissionRule{}, fmt.Errorf("%w: %q", ErrBadCommissionRule, rule)
		}
		return CommissionRule{raw: r, isFlat: true, flat: amt}, nil
	}
	return CommissionRule{}, fmt.Errorf("%w: %q", ErrBadCommissionRule, rule)
}

// Compute returns the commission for one service given its standard price.
// Percentage commissions round half-up to a whole rupiah (DECISIONS O14). An
// out-of-range percentage result surfaces as an error rather than wrapping.
func (r CommissionRule) Compute(standardPrice money.Money) (money.Money, error) {
	if r.isFlat {
		return r.flat, nil
	}
	return money.PercentOf(standardPrice, r.pctNum, r.pctScale)
}

// String returns the original rule text (for echo/audit).
func (r CommissionRule) String() string { return r.raw }

// ServiceLine is one selected service resolved against the Master Service List
// version effective at the reference date (name/price/rule come from
// admin.EffectiveAt at the persistence layer).
type ServiceLine struct {
	ServiceID     string
	Name          string
	StandardPrice money.Money
	Rule          CommissionRule
}

// NewServiceLine builds a ServiceLine from raw master-version fields
// (standard_price and commission_rule as stored in master_service_versions).
func NewServiceLine(serviceID, name, standardPrice, commissionRule string) (ServiceLine, error) {
	price, err := money.Parse(standardPrice)
	if err != nil {
		return ServiceLine{}, err
	}
	rule, err := ParseCommissionRule(commissionRule)
	if err != nil {
		return ServiceLine{}, err
	}
	return ServiceLine{ServiceID: serviceID, Name: name, StandardPrice: price, Rule: rule}, nil
}

// LineQuote is the computed money view for one service line.
type LineQuote struct {
	ServiceID        string      `json:"service_id"`
	Name             string      `json:"name"`
	StandardPrice    money.Money `json:"-"`
	Komisi           money.Money `json:"-"`
	StandardPriceIDR string      `json:"standard_price_idr"`
	KomisiIDR        string      `json:"komisi_idr"`
}

// Quote is the read-only money summary for a Qualified/Closing selection.
type Quote struct {
	Lines            []LineQuote `json:"lines"`
	EstimasiNilai    money.Money `json:"-"`
	TotalKomisi      money.Money `json:"-"`
	EstimasiNilaiIDR string      `json:"estimasi_nilai_idr"`
	TotalKomisiIDR   string      `json:"total_komisi_idr"`
}

// BuildQuote computes Estimasi Nilai Transaksi and Perhitungan Komisi for the
// selected services. It enforces the 1..MaxServices rule server-side.
func BuildQuote(lines []ServiceLine) (Quote, error) {
	if len(lines) == 0 {
		return Quote{}, ErrNoServices
	}
	if len(lines) > MaxServices {
		return Quote{}, ErrTooManyServices
	}
	q := Quote{Lines: make([]LineQuote, 0, len(lines))}
	for _, l := range lines {
		komisi, err := l.Rule.Compute(l.StandardPrice)
		if err != nil {
			return Quote{}, err
		}
		q.EstimasiNilai += l.StandardPrice
		q.TotalKomisi += komisi
		q.Lines = append(q.Lines, LineQuote{
			ServiceID:        l.ServiceID,
			Name:             l.Name,
			StandardPrice:    l.StandardPrice,
			Komisi:           komisi,
			StandardPriceIDR: l.StandardPrice.Format(),
			KomisiIDR:        komisi.Format(),
		})
	}
	q.EstimasiNilaiIDR = q.EstimasiNilai.Format()
	q.TotalKomisiIDR = q.TotalKomisi.Format()
	return q, nil
}
