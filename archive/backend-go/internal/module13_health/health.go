// Package module13_health is Module 13 (Client Health Report). It is a pure
// AGGREGATION and scoring layer (M13 §1): it introduces no new raw data, only a
// weighted 0–100 Health Score per Client, computed from data that already lives
// in Modules 4 (GMV), 5 (payment), 6 (complaints), 8 (ROAS) and 12 (task
// completion / revision count).
//
// The month boundary produces one immutable snapshot per Client (CHR-, §5.1);
// the current not-yet-closed month is available as a read-only live preview that
// is never stored (Rule 10). Everything a snapshot persists is recomputable from
// the immutable event/timestamp logs of the source modules (house rule 4).
//
// This file holds the PURE scoring core — the seven components, the confirmed
// weights (Rule 3), the missing-component proportional redistribution (Rule 4),
// the 0–100 capping (Rule 5/6) and the band assignment (Rule 7). It has no DB
// dependency, so the worked example (§4) and every edge (div-zero, all-excluded)
// are exhaustively unit-testable with controlled inputs. compute.go gathers the
// inputs from the DB; snapshot.go persists / previews / trends them.
package module13_health

import "math"

// Component names (M13 §2 Rule 2). Stable string keys — they are persisted in
// components_json and surfaced in the API, so they never change.
const (
	CompGMVGrowth         = "gmv_growth"
	CompROASAttainment    = "roas_attainment"
	CompTaskCompletion    = "task_completion"
	CompRevisionBurden    = "revision_burden"
	CompComplaints        = "complaints"
	CompSatisfaction      = "satisfaction"
	CompPaymentTimeliness = "payment_timeliness"
)

// baseWeights are the confirmed component weights (M13 §2 Rule 3 / §6 OA-1),
// expressed out of 100. They sum to exactly 100.
var baseWeights = map[string]float64{
	CompGMVGrowth:         25,
	CompROASAttainment:    25,
	CompTaskCompletion:    10,
	CompRevisionBurden:    10,
	CompComplaints:        10,
	CompSatisfaction:      10,
	CompPaymentTimeliness: 10,
}

// Bands (M13 §2 Rule 7 / §6 OA-2).
const (
	BandHealthy = "Healthy" // 80–100
	BandWatch   = "Watch"   // 60–79
	BandAtRisk  = "At Risk" // below 60
)

// bandRank orders the bands so a month-over-month DROP (Rule 12) is a strictly
// decreasing rank. Higher = healthier.
func bandRank(band string) int {
	switch band {
	case BandHealthy:
		return 3
	case BandWatch:
		return 2
	case BandAtRisk:
		return 1
	default:
		return 0
	}
}

// bandFor assigns the band from a final score (Rule 7). Boundaries are inclusive
// at the bottom of the healthier band: >=80 Healthy, >=60 Watch, else At Risk.
func bandFor(score float64) string {
	switch {
	case score >= 80:
		return BandHealthy
	case score >= 60:
		return BandWatch
	default:
		return BandAtRisk
	}
}

// Component is one scored (or excluded) component of the Health Score. Raw is the
// UNCAPPED sub-metric kept for diagnosis (Rule 6 "raw, uncapped sub-metrics are
// always shown"); Capped is the [0,100] value used in the composite math (Rule 5
// header "capped 0–100 each"). When Included is false the component contributed
// nothing and its weight was redistributed (Rule 4) — Raw/Capped are then zero
// and ExcludedReason explains why (§5.6).
type Component struct {
	Name            string   `json:"name"`
	Included        bool     `json:"included"`
	Raw             *float64 `json:"raw"`              // uncapped; nil when excluded
	Capped          *float64 `json:"capped"`           // clamp(raw,0,100); nil when excluded
	BaseWeight      float64  `json:"base_weight"`      // Rule 3 confirmed weight (out of 100)
	EffectiveWeight float64  `json:"effective_weight"` // post-redistribution weight (out of 100); 0 when excluded
	ExcludedReason  string   `json:"excluded_reason,omitempty"`
}

// candidate is the raw pre-scoring input for one component (compute.go builds
// these): whether data was available, the uncapped raw value, and — when it was
// not available — the reason it is excluded (Rule 4 / §5.6).
type candidate struct {
	name     string
	included bool
	raw      float64
	reason   string
}

// clamp01to100 caps a value to the [0,100] sub-score range (Rule 5 header).
func clamp01to100(v float64) float64 {
	if v > 100 {
		return 100
	}
	if v < 0 {
		return 0
	}
	return v
}

// score turns the per-component candidates into the finished [Component] list
// plus the final weighted Health Score (0–100) and its band (Rules 3–7).
//
// Redistribution (Rule 4): the base weights of the AVAILABLE components are
// re-normalised to sum to 100 — each available weight is scaled by
// 100/Σ(available base weights) — so an excluded component (missing data, toggle
// off, grace period, or the always-N/A Satisfaction placeholder) is never scored
// as 0 or 100. The excluded components keep EffectiveWeight 0.
//
// scoreOK is false only in the defensive all-excluded case (no component had
// data at all); the caller renders the score as "—" (house rule 7) and no band.
func score(cands []candidate) (comps []Component, finalScore float64, band string, scoreOK bool) {
	var availableBase float64
	for _, c := range cands {
		if c.included {
			availableBase += baseWeights[c.name]
		}
	}

	comps = make([]Component, 0, len(cands))
	var weighted float64
	for _, c := range cands {
		comp := Component{Name: c.name, BaseWeight: baseWeights[c.name]}
		if c.included && availableBase > 0 {
			raw := c.raw
			capped := clamp01to100(raw)
			eff := baseWeights[c.name] * 100 / availableBase
			comp.Included = true
			comp.Raw = &raw
			comp.Capped = &capped
			comp.EffectiveWeight = eff
			weighted += eff / 100 * capped
		} else {
			comp.Included = false
			comp.ExcludedReason = c.reason
		}
		comps = append(comps, comp)
	}

	if availableBase == 0 {
		return comps, 0, "", false
	}
	// Guard against float dust just past 100/0 from the re-normalisation.
	finalScore = math.Round(weighted*1000) / 1000
	if finalScore > 100 {
		finalScore = 100
	}
	if finalScore < 0 {
		finalScore = 0
	}
	return comps, finalScore, bandFor(finalScore), true
}
