package main

// Field-level validation of one CSV row into an admin.ServiceInput. Pure
// (no DB): the same enums/rules as admin.ServiceInput.normalize (which stays
// the authoritative server-side gate — this is an early, row-addressable
// error report so a bad seed CSV fails fast with a useful line number instead
// of a generic [data tidak lengkap...] from deep inside admin).
//
// Local literal copies of admin's pricing-mode/frequency enums: admin.go
// deliberately keeps them unexported (and never imports module0_sales, to
// avoid an import cycle — module0_sales imports admin). This cmd is a leaf
// package, so it may import both.

import (
	"fmt"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/admin"
	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/module0_sales"
)

const (
	pricingFlat         = "flat"
	pricingMinFloor     = "min_floor"
	pricingBatchCeiling = "batch_ceiling"
	pricingPassthrough  = "passthrough"
)

var validPricingModes = map[string]bool{
	pricingFlat: true, pricingMinFloor: true, pricingBatchCeiling: true, pricingPassthrough: true,
}

var validFrequencies = map[string]bool{"Monthly": true, "One-time": true, "Campaign": true}

// errf builds a row-addressable error (line number + service_key for
// grep-ability in a 32-row CSV).
func (r Row) errf(format string, args ...any) error {
	return fmt.Errorf("baris %d (%s): "+format, append([]any{r.Line, r.ServiceKey}, args...)...)
}

// ToServiceInput validates one raw CSV row and converts it to an
// admin.ServiceInput. It is the single source of truth for "is this row
// well-formed" — both dry-run and apply call it before touching the DB.
func (r Row) ToServiceInput() (admin.ServiceInput, error) {
	name := strings.TrimSpace(r.Name)
	if name == "" {
		return admin.ServiceInput{}, r.errf("name kosong")
	}

	mode := strings.TrimSpace(r.PricingMode)
	if mode == "" {
		mode = pricingFlat
	}
	if !validPricingModes[mode] {
		return admin.ServiceInput{}, r.errf("pricing_mode tidak dikenal: %q", r.PricingMode)
	}

	freq := strings.TrimSpace(r.Frequency)
	if freq != "" && !validFrequencies[freq] {
		return admin.ServiceInput{}, r.errf("frequency tidak dikenal: %q", r.Frequency)
	}

	minQty := strings.TrimSpace(r.MinQty)
	needsMinQty := mode == pricingMinFloor || mode == pricingBatchCeiling
	if needsMinQty && minQty == "" {
		return admin.ServiceInput{}, r.errf("min_qty wajib diisi untuk pricing_mode=%s", mode)
	}
	if !needsMinQty && minQty != "" {
		return admin.ServiceInput{}, r.errf("min_qty harus kosong untuk pricing_mode=%s (hanya berlaku untuk min_floor/batch_ceiling)", mode)
	}
	if needsMinQty {
		m, err := money.Parse(minQty)
		if err != nil || m <= 0 || int64(m)%100 != 0 {
			return admin.ServiceInput{}, r.errf("min_qty bukan bilangan bulat positif: %q", r.MinQty)
		}
	}

	priceRaw := strings.TrimSpace(r.UnitPrice)
	if priceRaw == "" {
		priceRaw = "0"
	}
	price, err := money.Parse(priceRaw)
	if err != nil {
		return admin.ServiceInput{}, r.errf("unit_price tidak valid: %q", r.UnitPrice)
	}
	if mode == pricingPassthrough {
		if price < 0 {
			return admin.ServiceInput{}, r.errf("unit_price tidak boleh negatif untuk passthrough: %q", r.UnitPrice)
		}
	} else if price <= 0 {
		return admin.ServiceInput{}, r.errf("unit_price harus > 0 untuk pricing_mode=%s: %q", mode, r.UnitPrice)
	}

	applyPPN, err := parseZeroOne(r.ApplyPPN)
	if err != nil {
		return admin.ServiceInput{}, r.errf(`apply_ppn harus "0" atau "1": %q`, r.ApplyPPN)
	}

	active, err := parseTrueFalse(r.Active)
	if err != nil {
		return admin.ServiceInput{}, r.errf(`active harus "true" atau "false": %q`, r.Active)
	}

	commissionRule := strings.TrimSpace(r.CommissionRule)
	if _, err := module0_sales.ParseCommissionRule(commissionRule); err != nil {
		return admin.ServiceInput{}, r.errf("commission_rule tidak dikenal (grammar DECISIONS O14): %q", commissionRule)
	}

	effFrom := strings.TrimSpace(r.EffectiveFrom)
	if _, err := time.Parse("2006-01-02", effFrom); err != nil {
		return admin.ServiceInput{}, r.errf("effective_from harus YYYY-MM-DD: %q", r.EffectiveFrom)
	}

	return admin.ServiceInput{
		Name:           name,
		StandardPrice:  price.Decimal(),
		CommissionRule: commissionRule,
		Category:       strings.TrimSpace(r.Category),
		Unit:           strings.TrimSpace(r.Unit),
		MinQty:         minQty,
		PricingMode:    mode,
		ApplyPPN:       applyPPN,
		Frequency:      freq,
		PriceNote:      strings.TrimSpace(r.PriceNote),
		Description:    strings.TrimSpace(r.Description),
		Active:         active,
		EffectiveFrom:  effFrom,
	}, nil
}

// parseZeroOne parses the CSV boolean convention for apply_ppn ("0"/"1").
func parseZeroOne(s string) (bool, error) {
	switch strings.TrimSpace(s) {
	case "0":
		return false, nil
	case "1":
		return true, nil
	default:
		return false, fmt.Errorf("bukan 0/1: %q", s)
	}
}

// parseTrueFalse parses the CSV boolean convention for active ("true"/"false").
func parseTrueFalse(s string) (bool, error) {
	switch strings.TrimSpace(s) {
	case "true":
		return true, nil
	case "false":
		return false, nil
	default:
		return false, fmt.Errorf("bukan true/false: %q", s)
	}
}
