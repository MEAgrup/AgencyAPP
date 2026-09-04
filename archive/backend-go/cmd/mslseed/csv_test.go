package main

// Pure CSV parse/validation tests — no DB, no network.

import (
	"os"
	"strings"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/admin"
)

const validHeader = "service_key,name,category,unit,min_qty,unit_price,pricing_mode,apply_ppn,frequency,price_note,commission_rule,effective_from,active,description,source_row\n"

func TestParseCSV_RealSeedFile(t *testing.T) {
	// The real seed file must always parse cleanly: 32 rows, no error.
	f, err := os.Open(FindSeedCSV())
	if err != nil {
		t.Fatalf("open real seed csv: %v", err)
	}
	defer f.Close()
	rows, err := ParseCSV(f)
	if err != nil {
		t.Fatalf("parse real seed csv: %v", err)
	}
	if len(rows) != 32 {
		t.Fatalf("got %d rows, want 32", len(rows))
	}
	// Every row must validate cleanly too (the real file is the contract).
	for _, r := range rows {
		if _, err := r.ToServiceInput(); err != nil {
			t.Errorf("row %d (%s) failed validation: %v", r.Line, r.ServiceKey, err)
		}
	}
}

func TestParseCSV_HeaderMismatch(t *testing.T) {
	bad := "a,b,c\n1,2,3\n"
	if _, err := ParseCSV(strings.NewReader(bad)); err == nil {
		t.Fatal("expected error on wrong header")
	}
}

func TestParseCSV_WrongColumnCount(t *testing.T) {
	bad := validHeader + "k1,Name One,Cat,Unit,,10000,flat,0,Monthly,,0% of standard price,2026-01-01,true,desc\n" // 14 not 15
	if _, err := ParseCSV(strings.NewReader(bad)); err == nil {
		t.Fatal("expected error on short row")
	}
}

func TestParseCSV_MultilineQuotedField(t *testing.T) {
	body := validHeader +
		"k1,Name One,Cat,Unit,,10000,flat,0,Monthly,,0% of standard price,2026-01-01,true,\"line one\nline two\",1\n"
	rows, err := ParseCSV(strings.NewReader(body))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(rows))
	}
	if rows[0].Description != "line one\nline two" {
		t.Fatalf("description=%q", rows[0].Description)
	}
}

func row(overrides map[string]string) Row {
	r := Row{
		Line:           2,
		ServiceKey:     "svc",
		Name:           "Sample Service",
		Category:       "Cat",
		Unit:           "unit",
		MinQty:         "",
		UnitPrice:      "10000",
		PricingMode:    "flat",
		ApplyPPN:       "0",
		Frequency:      "Monthly",
		PriceNote:      "",
		CommissionRule: "0% of standard price",
		EffectiveFrom:  "2026-01-01",
		Active:         "true",
		Description:    "desc",
		SourceRow:      "1",
	}
	for k, v := range overrides {
		switch k {
		case "ServiceKey":
			r.ServiceKey = v
		case "Name":
			r.Name = v
		case "Category":
			r.Category = v
		case "Unit":
			r.Unit = v
		case "MinQty":
			r.MinQty = v
		case "UnitPrice":
			r.UnitPrice = v
		case "PricingMode":
			r.PricingMode = v
		case "ApplyPPN":
			r.ApplyPPN = v
		case "Frequency":
			r.Frequency = v
		case "PriceNote":
			r.PriceNote = v
		case "CommissionRule":
			r.CommissionRule = v
		case "EffectiveFrom":
			r.EffectiveFrom = v
		case "Active":
			r.Active = v
		case "Description":
			r.Description = v
		}
	}
	return r
}

func TestToServiceInput_Valid(t *testing.T) {
	in, err := row(nil).ToServiceInput()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := admin.ServiceInput{
		Name: "Sample Service", StandardPrice: "10000.00", CommissionRule: "0% of standard price",
		Category: "Cat", Unit: "unit", MinQty: "", PricingMode: "flat", ApplyPPN: false,
		Frequency: "Monthly", PriceNote: "", Description: "desc", Active: true, EffectiveFrom: "2026-01-01",
	}
	if in != want {
		t.Fatalf("got %+v\nwant %+v", in, want)
	}
}

func TestToServiceInput_PricingModeInvalid(t *testing.T) {
	if _, err := row(map[string]string{"PricingMode": "bogus"}).ToServiceInput(); err == nil {
		t.Fatal("expected error")
	}
}

func TestToServiceInput_FrequencyInvalid(t *testing.T) {
	if _, err := row(map[string]string{"Frequency": "Yearly"}).ToServiceInput(); err == nil {
		t.Fatal("expected error")
	}
}

func TestToServiceInput_MinFloorRequiresMinQty(t *testing.T) {
	if _, err := row(map[string]string{"PricingMode": "min_floor", "MinQty": ""}).ToServiceInput(); err == nil {
		t.Fatal("expected error: min_floor needs min_qty")
	}
}

func TestToServiceInput_BatchCeilingRequiresMinQty(t *testing.T) {
	if _, err := row(map[string]string{"PricingMode": "batch_ceiling", "MinQty": ""}).ToServiceInput(); err == nil {
		t.Fatal("expected error: batch_ceiling needs min_qty")
	}
}

func TestToServiceInput_FlatRejectsMinQty(t *testing.T) {
	if _, err := row(map[string]string{"PricingMode": "flat", "MinQty": "5"}).ToServiceInput(); err == nil {
		t.Fatal("expected error: flat must not carry min_qty")
	}
}

func TestToServiceInput_PassthroughRejectsMinQty(t *testing.T) {
	if _, err := row(map[string]string{"PricingMode": "passthrough", "MinQty": "5", "UnitPrice": "0"}).ToServiceInput(); err == nil {
		t.Fatal("expected error: passthrough must not carry min_qty")
	}
}

func TestToServiceInput_MinQtyMustBeWholePositive(t *testing.T) {
	for _, bad := range []string{"0", "-5", "1.5", "abc"} {
		if _, err := row(map[string]string{"PricingMode": "min_floor", "MinQty": bad}).ToServiceInput(); err == nil {
			t.Fatalf("min_qty=%q: expected error", bad)
		}
	}
}

func TestToServiceInput_UnitPriceMustBePositiveForNonPassthrough(t *testing.T) {
	for _, bad := range []string{"0", "-100", ""} {
		if _, err := row(map[string]string{"UnitPrice": bad}).ToServiceInput(); err == nil {
			t.Fatalf("unit_price=%q: expected error", bad)
		}
	}
}

func TestToServiceInput_PassthroughAllowsZeroPrice(t *testing.T) {
	in, err := row(map[string]string{"PricingMode": "passthrough", "UnitPrice": "0"}).ToServiceInput()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if in.StandardPrice != "0.00" {
		t.Fatalf("StandardPrice=%q want 0.00", in.StandardPrice)
	}
}

func TestToServiceInput_PassthroughRejectsNegativePrice(t *testing.T) {
	if _, err := row(map[string]string{"PricingMode": "passthrough", "UnitPrice": "-1"}).ToServiceInput(); err == nil {
		t.Fatal("expected error")
	}
}

func TestToServiceInput_CommissionRuleMustParse(t *testing.T) {
	if _, err := row(map[string]string{"CommissionRule": "not a rule"}).ToServiceInput(); err == nil {
		t.Fatal("expected error")
	}
}

func TestToServiceInput_CommissionRuleFlatRupiah(t *testing.T) {
	if _, err := row(map[string]string{"CommissionRule": "flat Rp 500.000"}).ToServiceInput(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestToServiceInput_EffectiveFromMustBeISODate(t *testing.T) {
	for _, bad := range []string{"", "16-07-2026", "2026/07/16", "not-a-date"} {
		if _, err := row(map[string]string{"EffectiveFrom": bad}).ToServiceInput(); err == nil {
			t.Fatalf("effective_from=%q: expected error", bad)
		}
	}
}

func TestToServiceInput_ApplyPPNMustBeZeroOrOne(t *testing.T) {
	for _, bad := range []string{"", "true", "2", "yes"} {
		if _, err := row(map[string]string{"ApplyPPN": bad}).ToServiceInput(); err == nil {
			t.Fatalf("apply_ppn=%q: expected error", bad)
		}
	}
	in, err := row(map[string]string{"ApplyPPN": "1"}).ToServiceInput()
	if err != nil || !in.ApplyPPN {
		t.Fatalf("apply_ppn=1: in=%+v err=%v", in, err)
	}
}

func TestToServiceInput_ActiveMustBeTrueOrFalse(t *testing.T) {
	for _, bad := range []string{"", "1", "yes", "TRUE"} {
		if _, err := row(map[string]string{"Active": bad}).ToServiceInput(); err == nil {
			t.Fatalf("active=%q: expected error", bad)
		}
	}
	in, err := row(map[string]string{"Active": "false"}).ToServiceInput()
	if err != nil || in.Active {
		t.Fatalf("active=false: in=%+v err=%v", in, err)
	}
}

func TestToServiceInput_NameRequired(t *testing.T) {
	if _, err := row(map[string]string{"Name": "  "}).ToServiceInput(); err == nil {
		t.Fatal("expected error")
	}
}

func TestSameService_IdenticalIsTrue(t *testing.T) {
	in, err := row(nil).ToServiceInput()
	if err != nil {
		t.Fatal(err)
	}
	existing := admin.ServiceView{
		Name: in.Name, StandardPrice: "10000.00", CommissionRule: in.CommissionRule,
		Category: in.Category, Unit: in.Unit, MinQty: "", PricingMode: in.PricingMode,
		ApplyPPN: in.ApplyPPN, Frequency: in.Frequency, PriceNote: in.PriceNote,
		Description: in.Description, Active: in.Active, EffectiveFrom: in.EffectiveFrom,
	}
	same, err := sameService(existing, in)
	if err != nil {
		t.Fatal(err)
	}
	if !same {
		t.Fatal("expected identical service to compare same")
	}
}

func TestSameService_PriceFormatDoesNotMatterMoneyValueDoes(t *testing.T) {
	in, err := row(map[string]string{"UnitPrice": "10000"}).ToServiceInput()
	if err != nil {
		t.Fatal(err)
	}
	existing := admin.ServiceView{
		Name: in.Name, StandardPrice: "10000.00", CommissionRule: in.CommissionRule,
		Category: in.Category, Unit: in.Unit, PricingMode: in.PricingMode,
		ApplyPPN: in.ApplyPPN, Frequency: in.Frequency, PriceNote: in.PriceNote,
		Description: in.Description, Active: in.Active, EffectiveFrom: in.EffectiveFrom,
	}
	same, err := sameService(existing, in)
	if err != nil || !same {
		t.Fatalf("expected same (format-only diff): same=%v err=%v", same, err)
	}
}

func TestSameService_PriceChangeDiffers(t *testing.T) {
	in, err := row(map[string]string{"UnitPrice": "20000"}).ToServiceInput()
	if err != nil {
		t.Fatal(err)
	}
	existing := admin.ServiceView{
		Name: in.Name, StandardPrice: "10000.00", CommissionRule: in.CommissionRule,
		Category: in.Category, Unit: in.Unit, PricingMode: in.PricingMode,
		ApplyPPN: in.ApplyPPN, Frequency: in.Frequency, PriceNote: in.PriceNote,
		Description: in.Description, Active: in.Active, EffectiveFrom: in.EffectiveFrom,
	}
	same, err := sameService(existing, in)
	if err != nil {
		t.Fatal(err)
	}
	if same {
		t.Fatal("expected price change to differ")
	}
}

func TestSameOptionalQty(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"", "", true},
		{"", "5", false},
		{"5", "", false},
		{"300", "300.00", true},
		{"300", "301", false},
	}
	for _, c := range cases {
		if got := sameOptionalQty(c.a, c.b); got != c.want {
			t.Errorf("sameOptionalQty(%q,%q)=%v want %v", c.a, c.b, got, c.want)
		}
	}
}
