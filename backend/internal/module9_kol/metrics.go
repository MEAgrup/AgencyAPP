// Creator Booking time-tracking + Speed Score (M9 §7 + §11 mapping). ALL values are
// DERIVED from the immutable status-transition log (house rules 3/4) — never stored.
//
//   - Sourcing Turnaround = [Booked] timestamp − Booking created (§7 Rule 1 / §10.3):
//     how hard the creator was to land.
//   - Delivery Turnaround  = [Content Submitted] timestamp − [Booked] timestamp
//     (§7 Rule 1 / §10.3): how reliably they deliver once committed.
//   - Overall Speed Score  = turnaround_time ÷ SLA Target using the §11 mapping of the
//     8 native Booking states onto the canonical Task machine — reusing Module 12's
//     exact metric core via module12_task.ComputeMappedMetrics (translation-layer
//     integration; the Booking is NOT a taskSource because its machine differs). A
//     [Dropped] Booking is EXCLUDED ENTIRELY from Speed Score (§11 — not scored 0/100,
//     simply omitted); its two sub-turnarounds still render as diagnostics.
//
// Missing SLA ⇒ Speed Score N/A (never backfilled); zero SLA ⇒ "—" (house rule 7) —
// both inherited from the shared M12 core.
package module9_kol

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/module12_task"
)

// BookingMetrics is the read-only computed view of one Booking's time-tracking.
type BookingMetrics struct {
	BookingID string `json:"booking_id"`
	Status    string `json:"status"`

	SLATargetHours          *float64 `json:"sla_target_hours"`
	SourcingTurnaroundHours *float64 `json:"sourcing_turnaround_hours"`
	DeliveryTurnaroundHours *float64 `json:"delivery_turnaround_hours"`

	// Overall (§11 mapping), from the shared M12 core.
	OverallTurnaroundHours *float64 `json:"overall_turnaround_hours"`
	SpeedScorePct          *float64 `json:"speed_score_pct"`
	SpeedScoreDisplay      string   `json:"speed_score_display"` // "112.50%" | "N/A" | "—"

	RevisionCount          int    `json:"revision_count"`
	ExcludedFromSpeedScore bool   `json:"excluded_from_speed_score"` // §11: [Dropped]
	ApprovedPeriodWIB      string `json:"approved_period_wib"`       // "YYYY-MM" (WIB, O20); "" if not passed
}

// bkgTransition is one native Booking status change parsed from the audit log.
type bkgTransition struct {
	to string
	at time.Time
}

// BookingMetrics returns a Booking's recomputed-from-log metrics if the actor may
// view it (same §10.1 read gate as GetBooking).
func (s *Service) BookingMetrics(ctx context.Context, actor permission.Actor, bookingID string) (BookingMetrics, error) {
	var division, status string
	var createdAt time.Time
	var sla sql.NullFloat64
	var owner sql.NullString
	err := s.DB.QueryRowContext(ctx,
		`SELECT b.assigned_division, bk.status, bk.created_at, bk.sla_target_hours, c.assigned_am_id
		   FROM creator_bookings bk
		   JOIN briefs b ON b.id = bk.brief_id
		   JOIN services sv ON sv.id = b.service_id
		   JOIN clients c ON c.id = sv.client_id
		  WHERE bk.id = ?`, bookingID).Scan(&division, &status, &createdAt, &sla, &owner)
	if errors.Is(err, sql.ErrNoRows) {
		return BookingMetrics{}, ErrBookingNotFound
	}
	if err != nil {
		return BookingMetrics{}, err
	}
	if !canSeeBooking(actor, owner.String, division) {
		return BookingMetrics{}, ErrBookingViewForbidden
	}
	entries, err := audit.List(ctx, s.DB, audit.Filter{EntityType: "creator_booking", EntityID: bookingID})
	if err != nil {
		return BookingMetrics{}, err
	}
	evs := parseBkgTransitions(entries)
	return computeBookingMetrics(bookingID, status, createdAt, nullFloatPtr(sla), evs), nil
}

// ComputeBookingMetricsFromLog is the exported, gate-free entry to the pure Booking
// metric core (§7 / §11): it parses a Booking's immutable audit log into the native
// transition list and returns the same recomputed metrics BookingMetrics serves —
// Speed Score, Sourcing/Delivery turnaround, Revision Count, ApprovedPeriodWIB.
// Module 14 (Team Performance) calls this to fold KOL Speed Score / Creator Count
// into its per-staff rollup WITHOUT re-implementing the §11 mapping (O19 precedent:
// export the live helper, never mirror it). It does NO permission check — the caller
// (a monthly batch or an already-gated read) owns visibility.
func ComputeBookingMetricsFromLog(bookingID, status string, createdAt time.Time, sla *float64, entries []audit.Entry) BookingMetrics {
	return computeBookingMetrics(bookingID, status, createdAt, sla, parseBkgTransitions(entries))
}

// computeBookingMetrics is the pure core (unit-testable with controlled timestamps).
// `evs` MUST be chronologically ascending; `createdAt` is the birth ([Sourcing])
// timestamp used both as the Sourcing-Turnaround start and as the injected first
// [In Progress] for the §11-mapped overall turnaround.
func computeBookingMetrics(bookingID, status string, createdAt time.Time, sla *float64, evs []bkgTransition) BookingMetrics {
	m := BookingMetrics{BookingID: bookingID, Status: status, SLATargetHours: sla}
	m.RevisionCount = countBkg(evs, BkgQCFailed) // [QC Failed - Revision Requested] entries

	// Sub-turnarounds (§7 Rule 1).
	booked := firstBkg(evs, BkgBooked)
	submitted := firstBkg(evs, BkgContentSubmit)
	if booked != nil {
		d := booked.Sub(createdAt).Hours()
		m.SourcingTurnaroundHours = &d
	}
	if booked != nil && submitted != nil {
		d := submitted.Sub(*booked).Hours()
		m.DeliveryTurnaroundHours = &d
	}

	// Overall Speed Score via the §11 mapping + the shared M12 core.
	if status == BkgDropped {
		// §11: a Dropped Booking is excluded ENTIRELY from Speed Score (not 0/100).
		m.ExcludedFromSpeedScore = true
		m.SpeedScoreDisplay = "N/A"
		return m
	}
	mapped := mapToCanonical(createdAt, evs)
	cm := module12_task.ComputeMappedMetrics(mapped, sla)
	m.OverallTurnaroundHours = cm.TurnaroundHours
	m.SpeedScorePct = cm.SpeedScorePct
	m.SpeedScoreDisplay = cm.SpeedScoreDisplay
	m.ApprovedPeriodWIB = cm.ApprovedPeriodWIB
	return m
}

// mapToCanonical builds the §11-mapped canonical transition list: the birth into
// [Sourcing] is injected as the first canonical [In Progress] at createdAt (so the
// overall turnaround spans creation → [QC Passed]); each later native transition is
// translated to its canonical label ([Dropped] maps to nothing and is dropped).
func mapToCanonical(createdAt time.Time, evs []bkgTransition) []module12_task.Transition {
	out := []module12_task.Transition{{To: module12_task.StatusInProgress, At: createdAt}}
	for _, e := range evs {
		if c, ok := nativeToCanonical(e.to); ok {
			out = append(out, module12_task.Transition{To: c, At: e.at})
		}
	}
	return out
}

// nativeToCanonical maps a native Booking state to its canonical Task label (§11).
// [Dropped] returns ok=false (excluded from the Speed Score history entirely).
func nativeToCanonical(native string) (string, bool) {
	switch native {
	case BkgSourcing, BkgBooked, BkgContentInProg:
		return module12_task.StatusInProgress, true
	case BkgContentSubmit:
		return module12_task.StatusSubmitted, true
	case BkgQCReview:
		return module12_task.StatusInReview, true
	case BkgQCPassed:
		return module12_task.StatusApproved, true
	case BkgQCFailed:
		return module12_task.StatusRevisionReq, true
	case BkgEscalated:
		return module12_task.StatusBlocked, true
	default: // BkgDropped
		return "", false
	}
}

// parseBkgTransitions turns the (DESC) audit log into an ascending native-transition
// list; only "transition:<from>-><to>" rows contribute (field edits are ignored).
func parseBkgTransitions(entries []audit.Entry) []bkgTransition {
	out := make([]bkgTransition, 0, len(entries))
	for i := len(entries) - 1; i >= 0; i-- { // entries are DESC by id
		to, ok := transitionTarget(entries[i].Action)
		if !ok {
			continue
		}
		out = append(out, bkgTransition{to: to, at: entries[i].CreatedAt})
	}
	return out
}

// transitionTarget extracts the destination state from a "transition:A->B" action.
func transitionTarget(action string) (string, bool) {
	const prefix = "transition:"
	if len(action) < len(prefix) || action[:len(prefix)] != prefix {
		return "", false
	}
	rest := action[len(prefix):]
	for i := 0; i+1 < len(rest); i++ {
		if rest[i] == '-' && rest[i+1] == '>' {
			return rest[i+2:], true
		}
	}
	return "", false
}

func firstBkg(evs []bkgTransition, to string) *time.Time {
	for i := range evs {
		if evs[i].to == to {
			t := evs[i].at
			return &t
		}
	}
	return nil
}

func countBkg(evs []bkgTransition, to string) int {
	n := 0
	for i := range evs {
		if evs[i].to == to {
			n++
		}
	}
	return n
}
