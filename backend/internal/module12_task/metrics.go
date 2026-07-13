// This file implements the M12 §5.1/§5.2 computed fields. ALL of them are DERIVED
// from the immutable status-transition history (house rules 3/4, DATA_MODEL §1) —
// never stored, always recomputable and auditable from the timestamp log.
//
// Definitions (M12 §2/§5.1, transcribed exactly — do not invent):
//   - turnaround_time (hours): from the FIRST entry into [In Progress] to the FIRST
//     entry into [Approved] (Rule 4), INCLUDING all revision cycles (Rule 5 — never
//     reset), EXCLUDING every [Blocked] interval (Rule 7 / §5.4 — each [Blocked]->
//     [In Progress] pair is summed and subtracted).
//   - revision_turnaround (hours): the LATEST [Revision Requested] -> next
//     [Submitted] interval (Rule 6) — how fast the PIC fixed the most recent round.
//   - speed_score (%): turnaround_time ÷ SLA Target, UNCAPPED (Rule 12 — a Task may
//     read 300%+ on purpose). Missing SLA Target ⇒ N/A, never backfilled (§5.3). A
//     zero SLA (never settable, guarded defensively) ⇒ "—" (house convention 7,
//     division-by-zero renders an em dash, never an error).
//   - revision_count (int): number of [In Review] -> [Revision Requested]
//     transitions (§6 Rule 4 pattern); ≥3 raises the Quality flag (Rule 15).
//
// The math lives in a PURE function (computeMetrics) over an ordered transition
// list, so it is exhaustively unit-testable with controlled timestamps; the
// DB-backed TaskMetrics simply parses the audit log into that list.
package module12_task

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/tz"
)

// revisionFlagThreshold is the §2 Rule 15 Quality-review auto-flag (working
// default; open to per-division retuning — O8).
const revisionFlagThreshold = 3

// Metrics is the read-only computed view of one Task (M12 §5.1). Pointer fields are
// nil when the value is Not-Applicable (e.g. Speed Score before the Task is
// approved, or with no SLA Target). Display strings apply the house-convention
// rendering ("N/A" / "—").
type Metrics struct {
	BriefID string `json:"brief_id"`
	Status  string `json:"status"`

	SLATargetHours          *float64 `json:"sla_target_hours"`
	TurnaroundHours         *float64 `json:"turnaround_hours"`
	RevisionTurnaroundHours *float64 `json:"revision_turnaround_hours"`
	SpeedScorePct           *float64 `json:"speed_score_pct"`
	SpeedScoreDisplay       string   `json:"speed_score_display"` // "112.50%" | "N/A" | "—"

	// Revision SLA Target + revision_speed_score (M7-OA-3 / M12 §5.1 addition):
	// the diagnostic parallel to Speed Score, measured against the SEPARATE, shorter
	// revision SLA — shown alongside, NEVER blended into Speed Score. Nil/"N/A" when
	// no revision SLA is set or there has been no revision round yet (e.g. always for
	// a Brief-as-task, which carries no revision SLA).
	RevisionSLATargetHours    *float64 `json:"revision_sla_target_hours"`
	RevisionSpeedScorePct     *float64 `json:"revision_speed_score_pct"`
	RevisionSpeedScoreDisplay string   `json:"revision_speed_score_display"` // "75.00%" | "N/A" | "—"

	RevisionCount   int  `json:"revision_count"`
	RevisionFlagged bool `json:"revision_flagged"` // §2 Rule 15: >=3

	ApprovedAt        *time.Time `json:"approved_at"`
	ApprovedPeriodWIB string     `json:"approved_period_wib"` // "YYYY-MM" (WIB, O20), "" if not approved
}

// transition is one status change: the state entered and when.
type transition struct {
	to string
	at time.Time
}

// computeMetrics is the pure core. `evs` MUST be in chronological (ascending)
// order. `sla` is the Task-level SLA Target in hours, or nil if unset.
func computeMetrics(evs []transition, sla *float64) Metrics {
	m := Metrics{SLATargetHours: sla}

	var firstInProg, firstApproved *time.Time
	for i := range evs {
		switch evs[i].to {
		case StatusInProgress:
			if firstInProg == nil {
				firstInProg = &evs[i].at
			}
		case StatusApproved:
			if firstApproved == nil {
				firstApproved = &evs[i].at
			}
		case StatusRevisionReq:
			m.RevisionCount++
		}
	}
	m.RevisionFlagged = m.RevisionCount >= revisionFlagThreshold

	// Turnaround: only defined once the Task has both started and been approved.
	if firstInProg != nil && firstApproved != nil {
		total := firstApproved.Sub(*firstInProg)
		total -= blockedDuration(evs, *firstInProg, *firstApproved)
		h := hours(total)
		m.TurnaroundHours = &h
		at := *firstApproved
		m.ApprovedAt = &at
		m.ApprovedPeriodWIB = at.In(tz.Jakarta()).Format("2006-01")
	}

	// Revision Turnaround: latest [Revision Requested] -> next [Submitted].
	if d, ok := revisionTurnaround(evs); ok {
		m.RevisionTurnaroundHours = &d
	}

	m.SpeedScorePct, m.SpeedScoreDisplay = speedScore(m.TurnaroundHours, sla)
	m.RevisionSpeedScoreDisplay = "N/A" // default until a revision SLA is applied
	return m
}

// Transition is one canonical-Task status change (destination state + timestamp),
// exported so an OFF-MACHINE source can feed a status-mapped history into the shared
// metric core. It exists for M9's Creator Booking (BKG-), whose NATIVE machine (§8)
// differs from the canonical Task machine, so it is NOT registered as a taskSource;
// instead M9 maps its 8 native states onto the canonical labels (§11 mapping) and
// reuses the exact turnaround/speed_score math here, without duplicating it.
type Transition struct {
	To string    // a canonical Status* label (StatusInProgress / StatusSubmitted / ...)
	At time.Time // the transition timestamp
}

// ComputeMappedMetrics computes the canonical Task metrics (§5.1) from an already
// status-mapped, chronologically ASCENDING transition list plus an optional SLA
// Target (hours). It is the additive integration point for off-machine sources
// (M9 Creator Booking, §11): the caller translates its native lifecycle into the
// canonical labels and gets back the same turnaround_time / speed_score / N/A / "—"
// treatment every Task uses. It does NOT change any existing M12 API.
func ComputeMappedMetrics(evs []Transition, slaHours *float64) Metrics {
	internal := make([]transition, len(evs))
	for i, e := range evs {
		internal[i] = transition{to: e.To, at: e.At}
	}
	return computeMetrics(internal, slaHours)
}

// applyRevisionSpeedScore fills revision_speed_score = revision_turnaround ÷
// Revision SLA Target (M7-OA-3 / §9.3). Same house-convention rendering as Speed
// Score: N/A when the revision SLA is unset or there has been no revision round;
// "—" on a zero revision SLA (guarded defensively). Diagnostic only.
func applyRevisionSpeedScore(m *Metrics, revisionSLA *float64) {
	m.RevisionSLATargetHours = revisionSLA
	m.RevisionSpeedScorePct, m.RevisionSpeedScoreDisplay = speedScore(m.RevisionTurnaroundHours, revisionSLA)
}

// blockedDuration sums every [Blocked] -> [In Progress] interval that begins within
// [start, end) (Rule 7 / §5.4). A Task can be blocked more than once.
func blockedDuration(evs []transition, start, end time.Time) time.Duration {
	var sum time.Duration
	for i := 0; i < len(evs); i++ {
		if evs[i].to != StatusBlocked {
			continue
		}
		tb := evs[i].at
		if tb.Before(start) || !tb.Before(end) {
			continue
		}
		for j := i + 1; j < len(evs); j++ {
			if evs[j].to == StatusInProgress {
				tr := evs[j].at
				if tr.After(end) {
					tr = end
				}
				sum += tr.Sub(tb)
				break
			}
		}
	}
	return sum
}

// revisionTurnaround returns the hours from the LATEST [Revision Requested] to the
// next [Submitted] (Rule 6). ok=false if there is no revision, or the latest one
// has not yet been resubmitted.
func revisionTurnaround(evs []transition) (float64, bool) {
	lastRev := -1
	for i := range evs {
		if evs[i].to == StatusRevisionReq {
			lastRev = i
		}
	}
	if lastRev < 0 {
		return 0, false
	}
	for j := lastRev + 1; j < len(evs); j++ {
		if evs[j].to == StatusSubmitted {
			return hours(evs[j].at.Sub(evs[lastRev].at)), true
		}
	}
	return 0, false
}

// speedScore applies Rule 12 with the house-convention rendering. Returns the raw
// percentage (nil when N/A) and its display string.
func speedScore(turnaround, sla *float64) (*float64, string) {
	if sla == nil || turnaround == nil {
		return nil, "N/A" // no SLA set (§5.3), or not yet approved
	}
	if *sla == 0 {
		return nil, "—" // division-by-zero (house convention 7)
	}
	pct := *turnaround / *sla * 100
	return &pct, fmt.Sprintf("%.2f%%", pct)
}

// hours converts a duration to fractional hours.
func hours(d time.Duration) float64 { return d.Hours() }

// parseTransitions turns the audit log of a Brief into an ascending transition
// list. audit.List returns newest-first, so it is reversed here; only
// "transition:<from>-><to>" rows contribute (field edits like sla_target_set are
// ignored). Each row's created_at is the authoritative transition timestamp.
func parseTransitions(entries []audit.Entry) []transition {
	out := make([]transition, 0, len(entries))
	// entries are DESC by id; walk in reverse for ascending chronological order.
	for i := len(entries) - 1; i >= 0; i-- {
		e := entries[i]
		to, ok := transitionTarget(e.Action)
		if !ok {
			continue
		}
		out = append(out, transition{to: to, at: e.CreatedAt})
	}
	return out
}

// transitionTarget extracts the destination state from a "transition:A->B" action.
func transitionTarget(action string) (string, bool) {
	const prefix = "transition:"
	if !strings.HasPrefix(action, prefix) {
		return "", false
	}
	rest := action[len(prefix):]
	idx := strings.Index(rest, "->")
	if idx < 0 {
		return "", false
	}
	return rest[idx+2:], true
}

// TaskMetrics loads a Brief-as-Task and returns its recomputed-from-log metrics.
func (s *Service) TaskMetrics(ctx context.Context, actor permission.Actor, briefID string) (Metrics, error) {
	return s.metricsFor(ctx, actor, sourceBrief, briefID)
}

// AssetMetrics loads a Creative Asset and returns its recomputed-from-log metrics
// (M12 §5.1 + the Revision SLA / revision_speed_score of M7-OA-3). Same read gate.
func (s *Service) AssetMetrics(ctx context.Context, actor permission.Actor, assetID string) (Metrics, error) {
	return s.metricsFor(ctx, actor, sourceAsset, assetID)
}

// metricsFor returns a Task's metrics for any source, recomputed purely from the
// immutable transition log (house rule 4), if the actor may view it. Read gate
// (§6/§9.1, mirrors module6_account.GetBrief): OD/Director everywhere; Account
// lead (division-wide); the owning AM; and staff/lead of the Task's division.
func (s *Service) metricsFor(ctx context.Context, actor permission.Actor, src taskSource, id string) (Metrics, error) {
	var division, status string
	var owner sql.NullString
	var sla, revSLA sql.NullFloat64
	var err error
	switch src.table {
	case "assets":
		err = s.DB.QueryRowContext(ctx,
			`SELECT b.assigned_division, a.status, a.sla_target_hours, a.revision_sla_target_hours, c.assigned_am_id
			   FROM assets a
			   JOIN briefs b ON b.id = a.brief_id
			   JOIN services sv ON sv.id = b.service_id
			   JOIN clients c ON c.id = sv.client_id
			  WHERE a.id = ?`, id).Scan(&division, &status, &sla, &revSLA, &owner)
	default: // briefs
		err = s.DB.QueryRowContext(ctx,
			`SELECT b.assigned_division, b.status, b.sla_target_hours, c.assigned_am_id
			   FROM briefs b
			   JOIN services sv ON sv.id = b.service_id
			   JOIN clients c ON c.id = sv.client_id
			  WHERE b.id = ?`, id).Scan(&division, &status, &sla, &owner)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return Metrics{}, ErrTaskNotFound
	}
	if err != nil {
		return Metrics{}, err
	}
	if !canViewTask(actor, owner.String, division) {
		return Metrics{}, ErrTaskViewForbidden
	}
	entries, err := audit.List(ctx, s.DB, audit.Filter{EntityType: src.entityType, EntityID: id})
	if err != nil {
		return Metrics{}, err
	}
	m := computeMetrics(parseTransitions(entries), nullFloatPtr(sla))
	applyRevisionSpeedScore(&m, nullFloatPtr(revSLA))
	m.BriefID = id
	m.Status = status
	return m, nil
}

// nullFloatPtr converts a NULL-able float to *float64 (nil when NULL).
func nullFloatPtr(v sql.NullFloat64) *float64 {
	if !v.Valid {
		return nil
	}
	f := v.Float64
	return &f
}

// canViewTask is the §6/§9.1 read predicate (kept local; mirrors the equivalent
// gate in module6_account.GetBrief).
func canViewTask(a permission.Actor, ownerAM, division string) bool {
	if a.CanReadAll() { // OD / Director
		return true
	}
	if a.CanReadDivision(AccountDivision) { // Account lead (division-wide)
		return true
	}
	if a.EmployeeID == ownerAM { // owning AM
		return true
	}
	return a.Role.Division == division &&
		(a.Role.Level == permission.LevelStaff || a.Role.Level == permission.LevelLead)
}

// trim is strings.TrimSpace, shared across the package.
func trim(s string) string { return strings.TrimSpace(s) }
