package module13_health

import (
	"math"
	"testing"
)

// find returns the scored Component with the given name.
func find(comps []Component, name string) Component {
	for _, c := range comps {
		if c.Name == name {
			return c
		}
	}
	return Component{}
}

// TestScore_AlphaDigitalWorkedExample reproduces PRD §4 EXACTLY: Satisfaction
// excluded, its 10% redistributed across the other six (÷0.9), final ≈ 74.6 →
// Watch. GMV 40, ROAS 84, Task 90, Revision 76, Complaints 95, Payment 100.
func TestScore_AlphaDigitalWorkedExample(t *testing.T) {
	cands := []candidate{
		{name: CompGMVGrowth, included: true, raw: 40},
		{name: CompROASAttainment, included: true, raw: 84},
		{name: CompTaskCompletion, included: true, raw: 90},
		{name: CompRevisionBurden, included: true, raw: 76},
		{name: CompComplaints, included: true, raw: 95},
		{name: CompSatisfaction, included: false, raw: 0},
		{name: CompPaymentTimeliness, included: true, raw: 100},
	}
	comps, final, band, ok := score(cands)
	if !ok {
		t.Fatal("scoreOK = false, want true")
	}
	// 6710/90 = 74.5555… (PRD "≈ 74.6").
	want := 6710.0 / 90.0
	if math.Abs(final-math.Round(want*1000)/1000) > 0.001 {
		t.Fatalf("final = %v, want ≈ %v", final, want)
	}
	if band != BandWatch {
		t.Fatalf("band = %q, want Watch", band)
	}
	// Redistribution ÷0.9: GMV/ROAS 27.777…, the four 10%-ers 11.111….
	if g := find(comps, CompGMVGrowth); math.Abs(g.EffectiveWeight-25*100.0/90.0) > 0.001 {
		t.Errorf("GMV effective weight = %v, want 27.78", g.EffectiveWeight)
	}
	if p := find(comps, CompPaymentTimeliness); math.Abs(p.EffectiveWeight-10*100.0/90.0) > 0.001 {
		t.Errorf("Payment effective weight = %v, want 11.11", p.EffectiveWeight)
	}
	// Satisfaction stays excluded with zero effective weight and nil sub-scores.
	sat := find(comps, CompSatisfaction)
	if sat.Included || sat.EffectiveWeight != 0 || sat.Raw != nil || sat.Capped != nil {
		t.Errorf("Satisfaction should be excluded/zero/nil, got %+v", sat)
	}
	// Effective weights of included components sum to 100 (Rule 4 re-normalisation).
	var sumEff float64
	for _, c := range comps {
		sumEff += c.EffectiveWeight
	}
	if math.Abs(sumEff-100) > 0.001 {
		t.Errorf("Σ effective weights = %v, want 100", sumEff)
	}
}

// TestScore_CappingClampsBothEnds: an over-performing raw (>100) and a negative
// raw are both clamped into [0,100] for the composite, while the raw uncapped
// value is preserved for diagnosis (Rule 5 header / Rule 6).
func TestScore_CappingClampsBothEnds(t *testing.T) {
	cands := []candidate{
		{name: CompROASAttainment, included: true, raw: 250}, // wildly over target
		{name: CompGMVGrowth, included: true, raw: -30},      // shrank below baseline
	}
	comps, _, _, ok := score(cands)
	if !ok {
		t.Fatal("scoreOK = false")
	}
	roas := find(comps, CompROASAttainment)
	if *roas.Raw != 250 || *roas.Capped != 100 {
		t.Errorf("ROAS raw/capped = %v/%v, want 250/100", *roas.Raw, *roas.Capped)
	}
	gmv := find(comps, CompGMVGrowth)
	if *gmv.Raw != -30 || *gmv.Capped != 0 {
		t.Errorf("GMV raw/capped = %v/%v, want -30/0", *gmv.Raw, *gmv.Capped)
	}
}

// TestScore_RedistributionMovesBand: excluding a strong component and
// redistributing its weight changes the composite (proof redistribution is not a
// silent zero/100 fill).
func TestScore_AllExcludedIsNotAnError(t *testing.T) {
	cands := []candidate{
		{name: CompGMVGrowth, included: false, reason: "grace"},
		{name: CompSatisfaction, included: false, reason: "placeholder"},
	}
	comps, final, band, ok := score(cands)
	if ok {
		t.Fatalf("scoreOK = true, want false (all excluded); final=%v band=%q", final, band)
	}
	if len(comps) != 2 || comps[0].Included || comps[1].Included {
		t.Fatalf("expected two excluded components, got %+v", comps)
	}
}

// TestBandFor covers the Rule 7 boundaries exactly.
func TestBandFor(t *testing.T) {
	cases := []struct {
		score float64
		want  string
	}{
		{100, BandHealthy}, {80, BandHealthy}, {79.999, BandWatch},
		{60, BandWatch}, {59.999, BandAtRisk}, {0, BandAtRisk},
	}
	for _, c := range cases {
		if got := bandFor(c.score); got != c.want {
			t.Errorf("bandFor(%v) = %q, want %q", c.score, got, c.want)
		}
	}
}
