package main

// CSV parsing for backend/seed/msl_kalkulator.csv — the MSL v2 calculator
// canonical seed file (docs/handoff/MSL_KALKULATOR_VALIDASI.md). Pure
// file-level parsing only: no DB, no validation of field values (that is
// Row.ToServiceInput in validate.go).

import (
	"encoding/csv"
	"fmt"
	"io"
)

// wantHeader is the exact column order the seed CSV must have.
var wantHeader = []string{
	"service_key", "name", "category", "unit", "min_qty", "unit_price",
	"pricing_mode", "apply_ppn", "frequency", "price_note", "commission_rule",
	"effective_from", "active", "description", "source_row",
}

// Row is one raw CSV data row (untrimmed, unvalidated field strings) plus its
// 1-based line number in the source file (header = line 1) for error
// reporting.
type Row struct {
	Line           int
	ServiceKey     string
	Name           string
	Category       string
	Unit           string
	MinQty         string
	UnitPrice      string
	PricingMode    string
	ApplyPPN       string
	Frequency      string
	PriceNote      string
	CommissionRule string
	EffectiveFrom  string
	Active         string
	Description    string
	SourceRow      string
}

// ParseCSV reads the seed CSV, checking the header matches wantHeader exactly
// and every data row has all 15 columns. It does not validate field values.
func ParseCSV(r io.Reader) ([]Row, error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1

	header, err := cr.Read()
	if err != nil {
		return nil, fmt.Errorf("baca header: %w", err)
	}
	if len(header) != len(wantHeader) {
		return nil, fmt.Errorf("header: %d kolom, ingin %d (%v)", len(header), len(wantHeader), wantHeader)
	}
	for i, h := range header {
		if h != wantHeader[i] {
			return nil, fmt.Errorf("header kolom %d: %q, ingin %q", i+1, h, wantHeader[i])
		}
	}

	var rows []Row
	line := 1
	for {
		rec, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("baca baris setelah line %d: %w", line, err)
		}
		line++
		if len(rec) != len(wantHeader) {
			return nil, fmt.Errorf("baris %d: %d kolom, ingin %d", line, len(rec), len(wantHeader))
		}
		rows = append(rows, Row{
			Line:           line,
			ServiceKey:     rec[0],
			Name:           rec[1],
			Category:       rec[2],
			Unit:           rec[3],
			MinQty:         rec[4],
			UnitPrice:      rec[5],
			PricingMode:    rec[6],
			ApplyPPN:       rec[7],
			Frequency:      rec[8],
			PriceNote:      rec[9],
			CommissionRule: rec[10],
			EffectiveFrom:  rec[11],
			Active:         rec[12],
			Description:    rec[13],
			SourceRow:      rec[14],
		})
	}
	return rows, nil
}
