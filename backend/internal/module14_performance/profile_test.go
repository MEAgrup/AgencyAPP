package module14_performance

import (
	"math"
	"testing"
)

func approx(t *testing.T, got, want float64, ctx string) {
	t.Helper()
	if math.Abs(got-want) > 0.001 {
		t.Errorf("%s = %v, want %v", ctx, got, want)
	}
}

// adsWeights are the seeded §2 Rule 2 Ads weights.
var adsWeights = map[string]float64{
	CompSpeedScore: 25, CompROASAttainment: 30, CompGMVImpact: 25, CompOptimizationActivity: 20,
}

// ---- Kenny §4 worked example (profile 86.4, modifier +2 from avg 84, final 88.4) ----

func TestKennyWorkedExample(t *testing.T) {
	// Speed avg 95% ≤100 → sub-score 100; ROAS 88; GMV 80; Opt 75.
	cands := []candidate{
		{name: CompSpeedScore, included: true, raw: transformSpeed(95)},
		{name: CompROASAttainment, included: true, raw: 88},
		{name: CompGMVImpact, included: true, raw: 80},
		{name: CompOptimizationActivity, included: true, raw: 75},
	}
	comps, profile, ok := scoreProfile(adsWeights, cands)
	if !ok {
		t.Fatal("profile not ok")
	}
	approx(t, profile, 86.4, "KPI Profile")

	// No redistribution when all present — effective weights equal base.
	for _, c := range comps {
		approx(t, c.EffectiveWeight, c.BaseWeight, "eff weight "+c.Name)
	}

	// Modifier from avg ROAS Attainment sub-score 84 → clamp((84−80)/2) = +2.
	mod := Modifier{Present: true, Value: clampModifier(84)}
	approx(t, mod.Value, 2, "modifier")

	final := boundFinal(&profile, mod)
	if final == nil {
		t.Fatal("final nil")
	}
	approx(t, *final, 88.4, "Final Score")
}

// ---- Speed transform OA-1: 100 at/under SLA, 200−x above, floor 0 ----

func TestTransformSpeedOA1(t *testing.T) {
	cases := []struct{ in, want float64 }{
		{50, 100},       // well under SLA
		{100, 100},      // exactly at SLA (boundary)
		{100.01, 99.99}, // just over
		{120, 80},       // 200−120
		{150, 50},
		{200, 0}, // 200−200
		{250, 0}, // floored
	}
	for _, c := range cases {
		approx(t, transformSpeed(c.in), c.want, "transformSpeed")
	}
}

// ---- OA-2 cap: raw-value normalization capped at 100 ----

func TestNormalizationCap(t *testing.T) {
	// A component whose Actual÷Target×100 = 150 must cap to 100 in the weighted math.
	w := map[string]float64{CompSpeedScore: 100}
	comps, profile, ok := scoreProfile(w, []candidate{{name: CompSpeedScore, included: true, raw: 150}})
	if !ok {
		t.Fatal("not ok")
	}
	approx(t, profile, 100, "capped profile")
	if comps[0].Capped == nil || *comps[0].Capped != 100 {
		t.Errorf("capped = %v, want 100", comps[0].Capped)
	}
	if comps[0].Raw == nil || *comps[0].Raw != 150 {
		t.Errorf("raw uncapped = %v, want 150 preserved", comps[0].Raw)
	}
}

// ---- redistribution (Rule 6): a missing component's weight spreads over the rest ----

func TestRedistribution(t *testing.T) {
	// Ads with GMV Impact missing: base 25+30+20 = 75 available; each scaled ×100/75.
	cands := []candidate{
		{name: CompSpeedScore, included: true, raw: 100},
		{name: CompROASAttainment, included: true, raw: 90},
		{name: CompGMVImpact, included: false, reason: "no data"},
		{name: CompOptimizationActivity, included: true, raw: 60},
	}
	comps, profile, ok := scoreProfile(adsWeights, cands)
	if !ok {
		t.Fatal("not ok")
	}
	// Effective weights: speed 25×100/75=33.333, roas 40, opt 26.667; excluded 0.
	eff := map[string]float64{}
	for _, c := range comps {
		eff[c.Name] = c.EffectiveWeight
	}
	approx(t, eff[CompSpeedScore], 100.0/3, "eff speed")
	approx(t, eff[CompROASAttainment], 40, "eff roas")
	approx(t, eff[CompOptimizationActivity], 80.0/3, "eff opt")
	approx(t, eff[CompGMVImpact], 0, "eff excluded")
	// Weighted = (100×25 + 90×30 + 60×20)/75 = (2500+2700+1200)/75 = 85.333.
	approx(t, profile, 6400.0/75, "redistributed profile")
}

// ---- modifier clamp both directions (±10) ----

func TestModifierClampBothDirections(t *testing.T) {
	approx(t, clampModifier(80), 0, "avg 80 → 0")
	approx(t, clampModifier(84), 2, "avg 84 → +2")
	approx(t, clampModifier(100), 10, "avg 100 → +10 (clamped from 10)")
	approx(t, clampModifier(120), 10, "avg 120 → +10 clamp")
	approx(t, clampModifier(60), -10, "avg 60 → −10 (clamped from −10)")
	approx(t, clampModifier(40), -10, "avg 40 → −10 clamp")
	approx(t, clampModifier(70), -5, "avg 70 → −5")
}

// ---- final bounded 0..100 (Rule 4) ----

func TestFinalBounded(t *testing.T) {
	hi := 98.0
	mod := Modifier{Value: 10}
	f := boundFinal(&hi, mod)
	approx(t, *f, 100, "bounded high")

	lo := 3.0
	f = boundFinal(&lo, Modifier{Value: -10})
	approx(t, *f, 0, "bounded low")

	// All-excluded profile → nil final (renders "—").
	if boundFinal(nil, Modifier{}) != nil {
		t.Error("nil profile must yield nil final")
	}
	if scoreDisplay(nil) != "—" {
		t.Errorf("nil final display = %q, want —", scoreDisplay(nil))
	}
}

// ---- all-excluded → not ok ----

func TestAllExcluded(t *testing.T) {
	cands := []candidate{
		{name: CompSpeedScore, included: false, reason: "x"},
		{name: CompROASAttainment, included: false, reason: "x"},
		{name: CompGMVImpact, included: false, reason: "x"},
		{name: CompOptimizationActivity, included: false, reason: "x"},
	}
	_, _, ok := scoreProfile(adsWeights, cands)
	if ok {
		t.Error("all-excluded must return ok=false")
	}
}

// ---- AM profile: avg CHR 50% weight dominates ----

func TestAMProfileWeighting(t *testing.T) {
	w := map[string]float64{
		CompCHRAverage: 50, CompComplaintResolutionSpeed: 25, CompRevisionEscalationRate: 25,
	}
	cands := []candidate{
		{name: CompCHRAverage, included: true, raw: 84},
		{name: CompComplaintResolutionSpeed, included: true, raw: 100},
		{name: CompRevisionEscalationRate, included: true, raw: 80},
	}
	_, profile, ok := scoreProfile(w, cands)
	if !ok {
		t.Fatal("not ok")
	}
	// 0.5×84 + 0.25×100 + 0.25×80 = 42 + 25 + 20 = 87.
	approx(t, profile, 87, "AM profile")
}

// ---- diagnostic component reported, unweighted ----

func TestDiagnosticUnweighted(t *testing.T) {
	w := map[string]float64{CompCreatorCount: 100}
	cands := []candidate{
		{name: CompCreatorCount, included: true, raw: 50},
		{name: CompSourcingTurnaround, diagnostic: true, included: true, raw: 12.5}, // hours
	}
	comps, profile, ok := scoreProfile(w, cands)
	if !ok {
		t.Fatal("not ok")
	}
	// Diagnostic must not affect the weighted score (creator count only → 50).
	approx(t, profile, 50, "profile ignores diagnostic")
	var diag Component
	for _, c := range comps {
		if c.Name == CompSourcingTurnaround {
			diag = c
		}
	}
	if !diag.Diagnostic || diag.EffectiveWeight != 0 || diag.Raw == nil || *diag.Raw != 12.5 {
		t.Errorf("diagnostic component = %+v, want reported raw 12.5 weight 0", diag)
	}
	if diag.Capped != nil {
		t.Error("diagnostic Capped must be nil (no sub-score)")
	}
}
