package module0_sales

import (
	"errors"
	"testing"
)

func TestAllocationValidate(t *testing.T) {
	cases := []struct {
		name    string
		parties ClosingParties
		wantErr error
	}{
		{
			name: "solo 100% (Alpha Digital — Budi closes solo)",
			parties: ClosingParties{
				PrimarySalespersonID: "EMP-BUDI",
				Allocations:          []Allocation{{"EMP-BUDI", 10000}},
			},
			wantErr: nil,
		},
		{
			name: "primary id with surrounding whitespace still matches allocation",
			parties: ClosingParties{
				PrimarySalespersonID: "  EMP-BUDI  ",
				Allocations:          []Allocation{{"EMP-BUDI", 10000}},
			},
			wantErr: nil,
		},
		{
			name: "two-way 50/50 with PIC",
			parties: ClosingParties{
				PrimarySalespersonID:   "EMP-BUDI",
				Allocations:            []Allocation{{"EMP-BUDI", 5000}, {"EMP-RIAN", 5000}},
				CommissionPaymentPICID: "EMP-RIAN",
			},
			wantErr: nil,
		},
		{
			name: "three-way thirds summing exactly to 100%",
			parties: ClosingParties{
				PrimarySalespersonID:   "EMP-A",
				Allocations:            []Allocation{{"EMP-A", 3333}, {"EMP-B", 3333}, {"EMP-C", 3334}},
				CommissionPaymentPICID: "EMP-A",
			},
			wantErr: nil,
		},
		{
			name: "sum 99% blocked",
			parties: ClosingParties{
				PrimarySalespersonID:   "EMP-A",
				Allocations:            []Allocation{{"EMP-A", 5000}, {"EMP-B", 4900}},
				CommissionPaymentPICID: "EMP-A",
			},
			wantErr: ErrAllocationTotal,
		},
		{
			name: "sum 101% blocked",
			parties: ClosingParties{
				PrimarySalespersonID:   "EMP-A",
				Allocations:            []Allocation{{"EMP-A", 6000}, {"EMP-B", 5000}},
				CommissionPaymentPICID: "EMP-A",
			},
			wantErr: ErrAllocationTotal,
		},
		{
			name: "six salespeople blocked",
			parties: ClosingParties{
				PrimarySalespersonID: "EMP-A",
				Allocations: []Allocation{
					{"EMP-A", 2000}, {"EMP-B", 2000}, {"EMP-C", 2000},
					{"EMP-D", 2000}, {"EMP-E", 1000}, {"EMP-F", 1000},
				},
				CommissionPaymentPICID: "EMP-A",
			},
			wantErr: ErrTooManySalespeople,
		},
		{
			name: "empty primary incomplete",
			parties: ClosingParties{
				Allocations: []Allocation{{"EMP-A", 10000}},
			},
			wantErr: ErrAllocationIncomplete,
		},
		{
			name: "primary not among allocations",
			parties: ClosingParties{
				PrimarySalespersonID:   "EMP-X",
				Allocations:            []Allocation{{"EMP-A", 5000}, {"EMP-B", 5000}},
				CommissionPaymentPICID: "EMP-A",
			},
			wantErr: ErrAllocationIncomplete,
		},
		{
			name: "multi salesperson without PIC incomplete",
			parties: ClosingParties{
				PrimarySalespersonID: "EMP-A",
				Allocations:          []Allocation{{"EMP-A", 5000}, {"EMP-B", 5000}},
			},
			wantErr: ErrAllocationIncomplete,
		},
		{
			name: "PIC not a member",
			parties: ClosingParties{
				PrimarySalespersonID:   "EMP-A",
				Allocations:            []Allocation{{"EMP-A", 5000}, {"EMP-B", 5000}},
				CommissionPaymentPICID: "EMP-Z",
			},
			wantErr: ErrAllocationIncomplete,
		},
		{
			name: "duplicate salesperson",
			parties: ClosingParties{
				PrimarySalespersonID:   "EMP-A",
				Allocations:            []Allocation{{"EMP-A", 5000}, {"EMP-A", 5000}},
				CommissionPaymentPICID: "EMP-A",
			},
			wantErr: ErrAllocationIncomplete,
		},
		{
			name: "non-positive share",
			parties: ClosingParties{
				PrimarySalespersonID:   "EMP-A",
				Allocations:            []Allocation{{"EMP-A", 10000}, {"EMP-B", 0}},
				CommissionPaymentPICID: "EMP-A",
			},
			wantErr: ErrAllocationIncomplete,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := c.parties.Validate()
			if !errors.Is(err, c.wantErr) {
				t.Fatalf("Validate() = %v, want %v", err, c.wantErr)
			}
		})
	}
}

func TestResolvedPIC(t *testing.T) {
	solo := ClosingParties{PrimarySalespersonID: "EMP-BUDI", Allocations: []Allocation{{"EMP-BUDI", 10000}}}
	if got := solo.ResolvedPIC(); got != "EMP-BUDI" {
		t.Errorf("solo ResolvedPIC = %q, want EMP-BUDI (defaults to Primary)", got)
	}
	multi := ClosingParties{
		PrimarySalespersonID:   "EMP-BUDI",
		Allocations:            []Allocation{{"EMP-BUDI", 5000}, {"EMP-RIAN", 5000}},
		CommissionPaymentPICID: "EMP-RIAN",
	}
	if got := multi.ResolvedPIC(); got != "EMP-RIAN" {
		t.Errorf("multi ResolvedPIC = %q, want EMP-RIAN", got)
	}
}

func TestAllocationMessages(t *testing.T) {
	if ErrAllocationTotal.Error() != "[total alokasi sales harus 100%]" {
		t.Errorf("total msg = %q", ErrAllocationTotal.Error())
	}
	if ErrTooManySalespeople.Error() != "[maksimal 5 salesperson per closing!]" {
		t.Errorf("count msg = %q", ErrTooManySalespeople.Error())
	}
}

func TestPercentString(t *testing.T) {
	cases := map[int]string{10000: "100", 5000: "50", 3334: "33.34", 3333: "33.33", 2550: "25.5"}
	for bp, want := range cases {
		if got := (Allocation{BasisPoints: bp}).PercentString(); got != want {
			t.Errorf("bp %d -> %q, want %q", bp, got, want)
		}
	}
}
