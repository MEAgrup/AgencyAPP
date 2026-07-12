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
	return m
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

// TaskMetrics loads a Brief-as-Task and returns its recomputed-from-log metrics,
// if the actor may view it. Read gate (§6/§9.1, mirrors module6_account.GetBrief):
// OD/Director everywhere; Account lead (division-wide); the owning AM; and
// staff/lead of the Brief's target division.
func (s *Service) TaskMetrics(ctx context.Context, actor permission.Actor, briefID string) (Metrics, error) {
	var division, status string
	var pic, owner sql.NullString
	var sla sql.NullFloat64
	err := s.DB.QueryRowContext(ctx,
		`SELECT b.assigned_division, b.status, b.assigned_pic, b.sla_target_hours, c.assigned_am_id
		   FROM briefs b
		   JOIN services sv ON sv.id = b.service_id
		   JOIN clients c ON c.id = sv.client_id
		  WHERE b.id = ?`, briefID).Scan(&division, &status, &pic, &sla, &owner)
	if errors.Is(err, sql.ErrNoRows) {
		return Metrics{}, ErrTaskNotFound
	}
	if err != nil {
		return Metrics{}, err
	}
	if !canViewTask(actor, owner.String, division) {
		return Metrics{}, ErrTaskViewForbidden
	}
	entries, err := audit.List(ctx, s.DB, audit.Filter{EntityType: "brief", EntityID: briefID})
	if err != nil {
		return Metrics{}, err
	}
	var slaPtr *float64
	if sla.Valid {
		v := sla.Float64
		slaPtr = &v
	}
	m := computeMetrics(parseTransitions(entries), slaPtr)
	m.BriefID = briefID
	m.Status = status
	return m, nil
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
