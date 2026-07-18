package module14_performance

import (
	"fmt"
	"math"
)

// This file is the PURE scoring core of Module 14 — the confirmed transforms
// (OA-1 Speed, OA-2 raw-value cap), the KPI-Profile weighting with missing-
// component redistribution (Rule 6, identical to Module 13 §4), the Client-Outcome
// Modifier clamp (Rule 3 / OA-3), and the 0..100 bounding of the Final Score
// (Rule 4). It has NO DB dependency, so the Kenny §4 worked example and every edge
// (redistribution, all-excluded, modifier both directions, bounding) are
// exhaustively unit-testable with controlled inputs (perf_test.go). compute.go
// gathers the raw inputs; modifier.go builds the modifier; snapshot.go persists.

// Component is one scored (or excluded, or diagnostic) component of a Performance
// Score. Raw is the UNCAPPED sub-metric kept for diagnosis (§5.5 full breakdown);
// Capped is the [0,100] value used in the weighted math. When Included is false the
// component contributed nothing and its weight was redistributed (Rule 6) —
// Raw/Capped are then nil and ExcludedReason explains why. A Diagnostic component
// (KOL Sourcing Turnaround) is REPORTED with its raw value but carries no weight
// and never participates in redistribution (§2 Rule 2).
type Component struct {
	Name            string   `json:"name"`
	Included        bool     `json:"included"`
	Diagnostic      bool     `json:"diagnostic,omitempty"` // reported, unweighted (Rule 2)
	Raw             *float64 `json:"raw"`                  // uncapped; nil when excluded
	Capped          *float64 `json:"capped"`               // clamp(raw,0,100); nil when excluded
	BaseWeight      float64  `json:"base_weight"`          // configured weight (out of 100); 0 for diagnostic
	EffectiveWeight float64  `json:"effective_weight"`     // post-redistribution weight (out of 100); 0 when excluded/diagnostic
	ExcludedReason  string   `json:"excluded_reason,omitempty"`
}

// candidate is the raw pre-scoring input for one component (compute.go builds
// these): whether data was available, the uncapped raw sub-score, the reason it is
// excluded (Rule 6), and whether it is a diagnostic (unweighted) row.
type candidate struct {
	name       string
	included   bool
	raw        float64
	reason     string
	diagnostic bool
}

// transformSpeed applies the confirmed Speed KPI transform (OA-1): 100 when the
// Speed Score is at/under 100% of SLA (no bonus for finishing early — avoids
// rewarding rushed setup), else 200 − Speed Score, floored at 0. speedPct is the
// average Speed Score percentage (M12) across the staff's period-approved tasks.
func transformSpeed(speedPct float64) float64 {
	if speedPct <= 100 {
		return 100
	}
	v := 200 - speedPct
	if v < 0 {
		return 0
	}
	return v
}

// clamp01to100 caps a value to the [0,100] sub-score range. It also implements the
// OA-2 "capped at 100" rule for the raw-value components (whose raw = Actual ÷
// Period Target × 100 can exceed 100).
func clamp01to100(v float64) float64 {
	if v > 100 {
		return 100
	}
	if v < 0 {
		return 0
	}
	return v
}

// scoreProfile turns the per-component candidates into the finished []Component
// list plus the weighted KPI Profile score (0..100) using the supplied per-role
// weights (from perf_kpi_weights, §5.2). Redistribution (Rule 6, identical to
// Module 13 §4): the base weights of the AVAILABLE weighted components are
// re-normalised to sum to 100 — each available weight is scaled by
// 100/Σ(available base weights) — so an excluded component (missing data, new hire)
// is never scored as 0. Diagnostic candidates are appended as reported-only rows
// (weight 0) and never enter the base or the weighted sum.
//
// profileOK is false only in the all-excluded case (no weighted component had
// data); the caller renders the score as "—" (house rule 7) and no band.
func scoreProfile(weights map[string]float64, cands []candidate) (comps []Component, profile float64, profileOK bool) {
	var availableBase float64
	for _, c := range cands {
		if c.diagnostic {
			continue
		}
		if c.included {
			availableBase += weights[c.name]
		}
	}

	comps = make([]Component, 0, len(cands))
	var weighted float64
	for _, c := range cands {
		if c.diagnostic {
			// Diagnostic rows are reported by their RAW value only (e.g. Sourcing
			// Turnaround in hours). Capped stays nil — a diagnostic carries no
			// 0..100 sub-score and never enters the weighted math (§2 Rule 2).
			comp := Component{Name: c.name, Diagnostic: true}
			if c.included {
				raw := c.raw
				comp.Included = true
				comp.Raw = &raw
			} else {
				comp.ExcludedReason = c.reason
			}
			comps = append(comps, comp)
			continue
		}
		comp := Component{Name: c.name, BaseWeight: weights[c.name]}
		if c.included && availableBase > 0 {
			raw := c.raw
			capped := clamp01to100(raw)
			eff := weights[c.name] * 100 / availableBase
			comp.Included = true
			comp.Raw = &raw
			comp.Capped = &capped
			comp.EffectiveWeight = eff
			weighted += eff / 100 * capped
		} else {
			comp.ExcludedReason = c.reason
		}
		comps = append(comps, comp)
	}

	if availableBase == 0 {
		return comps, 0, false
	}
	// Guard against float dust just past 100/0 from the re-normalisation.
	profile = math.Round(weighted*1000) / 1000
	if profile > 100 {
		profile = 100
	}
	if profile < 0 {
		profile = 0
	}
	return comps, profile, true
}

// Modifier is the Client-Outcome Modifier (§2 Rule 3 / §5.3): the value applied on
// top of the KPI Profile, the Module 13 sub-component it drew from, the clients
// that contributed, and the raw average before the clamp. Present=false when the
// role has no modifier (AM) or no CHR source data was available — in which case the
// effective value is 0 (recorded, not silently dropped; decision point 3).
type Modifier struct {
	Present         bool     `json:"present"`
	Value           float64  `json:"value"`            // clamped ±10; 0 when absent
	SourceComponent string   `json:"source_component"` // e.g. "roas_attainment"; "" when absent
	SourceClients   []string `json:"source_clients"`   // Clients whose CHR sub-score fed the average
	RawAverage      *float64 `json:"raw_average"`      // the averaged sub-score before the clamp; nil when absent
}

// clampModifier applies the confirmed formula (OA-3): clamp((avg − 80) ÷ 2, −10,
// +10).
func clampModifier(avg float64) float64 {
	v := (avg - 80) / 2
	if v > 10 {
		return 10
	}
	if v < -10 {
		return -10
	}
	return v
}

// boundFinal computes the Final Individual Score = KPI Profile + Modifier, bounded
// 0..100 (Rule 4). profile is nil in the all-excluded case, which yields a nil
// final (rendered "—"); a role with a profile still applies its modifier here.
func boundFinal(profile *float64, mod Modifier) *float64 {
	if profile == nil {
		return nil
	}
	f := *profile + mod.Value
	if f > 100 {
		f = 100
	}
	if f < 0 {
		f = 0
	}
	f = math.Round(f*1000) / 1000
	return &f
}

// scoreDisplay renders a final score for the UI: two decimals, or "—" when no
// weighted component was available (house rule 7).
func scoreDisplay(final *float64) string {
	if final == nil {
		return "—"
	}
	return fmt.Sprintf("%.2f", *final)
}
