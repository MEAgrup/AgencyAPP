// Brief -> Creator Booking roll-up (M9 §2): a KOL Brief's status is NOT driven
// directly — it is a roll-up of its child Bookings, exactly like Creative's Brief is
// a roll-up of its Assets (M7 §2 / module12_task.rollup.go). The wrinkle: a Booking
// runs its OWN native machine (§8), so this maps the Booking states onto the KOL
// Brief's canonical brief_task chain (STATE_MACHINES §7):
//
//	[To Do]        — no Booking has left [Sourcing] yet.
//	[In Progress]  — at least one Booking left [Sourcing] (reached [Booked]+); this is
//	                 the edge that makes the Brief leave [To Do] (§2), advancing the
//	                 Service to [In Execution] via the injected AccountService hook.
//	[Submitted]    — every EXPECTED Booking has at least delivered content (§2:
//	                 "[Submitted] once every expected Booking has at least delivered").
//	[In Review]    — all delivered and QC is underway (some in QC / not all passed).
//	[Approved]     — every Booking is [QC Passed] or [Dropped] (§2 — passed, or
//	                 formally dropped/replaced).
//
// "Expected" is the Brief's Quantity/Target ("Book 5 Micro KOLs" = 5). Dropped and
// Escalated Bookings never appear in the Creator List (§6 Rule 3), but a Dropped
// Booking is a RESOLVED outcome for the roll-up (a re-source is a new Booking row).
// The roll-up is forward-only and steps each intermediate edge through the engine
// (house rule 2 — never a raw status UPDATE); it never drags the Brief backward.
package module9_kol

import (
	"context"
	"database/sql"
	"errors"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// brief_task status labels (STATE_MACHINES §7), the roll-up TARGET chain.
const (
	briefToDo       = "[To Do]"
	briefInProgress = "[In Progress]"
	briefSubmitted  = "[Submitted]"
	briefInReview   = "[In Review]"
	briefApproved   = "[Approved]"

	serviceInExecution = "[In Execution]"
)

var rollupChain = []string{briefToDo, briefInProgress, briefSubmitted, briefInReview, briefApproved}

func chainRank(status string) int {
	for i, s := range rollupChain {
		if s == status {
			return i
		}
	}
	return -1
}

// recomputeBriefRollup recomputes a KOL Brief's roll-up status from its Bookings and
// drives it forward through the engine, inside the caller's transaction. Called after
// every Booking transition. Idempotent and forward-only: if the Brief is already at
// (or past) the computed target it is a no-op. When the Brief first leaves [To Do]
// the parent Service advances to [In Execution] via the injected AccountService hook.
//
// Defensive no-ops: a Brief with no Bookings, or one off the roll-up chain (e.g. a
// terminal or off-machine status), is left untouched.
func (s *Service) recomputeBriefRollup(ctx context.Context, tx *sql.Tx, actor permission.Actor, briefID string) error {
	if briefID == "" {
		return nil
	}
	var status, serviceID string
	var quantityTarget int
	err := tx.QueryRowContext(ctx,
		`SELECT status, service_id, quantity_target FROM briefs WHERE id = ? FOR UPDATE`,
		briefID).Scan(&status, &serviceID, &quantityTarget)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrBriefNotFound
	}
	if err != nil {
		return err
	}
	cur := chainRank(status)
	if cur < 0 {
		return nil // Brief off the roll-up chain; leave it.
	}

	statuses, err := bookingStatuses(ctx, tx, briefID)
	if err != nil {
		return err
	}
	if len(statuses) == 0 {
		return nil // no Bookings yet — nothing to roll up.
	}
	tgt := chainRank(rollupTarget(statuses, quantityTarget))

	for cur < tgt {
		from := rollupChain[cur]
		to := rollupChain[cur+1]
		if _, err := s.engine().Transition(ctx, tx, statemachine.Request{
			Machine: statemachine.MBriefTask, EntityType: "brief", Table: "briefs",
			EntityID: briefID, To: to, Actor: actor,
		}); err != nil {
			return err
		}
		// The moment the Brief leaves [To Do], advance the parent Service (§2 / M6 §5
		// Flow 3) — the same hook M7/M12 fire.
		if from == briefToDo {
			if s.Account == nil {
				return errors.New("module9_kol: AccountService hook not wired")
			}
			if err := s.Account.OnBriefLeavesToDo(ctx, tx, actor, serviceID); err != nil {
				return err
			}
		}
		cur++
	}
	return nil
}

// rollupTarget maps the set of Booking statuses (+ the expected count) to the Brief's
// roll-up target status (M9 §2). Mirrors module12_task.rollupTarget in shape, over the
// native Booking states.
func rollupTarget(statuses []string, expected int) string {
	created := len(statuses)
	anyStarted := false // any Booking left [Sourcing]
	allResolved := true // every Booking [QC Passed] or [Dropped]
	allDeliveredOrDropped := true
	allExactlySubmittedOrDropped := true
	for _, st := range statuses {
		if st != BkgSourcing {
			anyStarted = true
		}
		if !bkgResolved(st) {
			allResolved = false
		}
		if !(bkgDelivered(st) || st == BkgDropped) {
			allDeliveredOrDropped = false
		}
		if !(st == BkgContentSubmit || st == BkgDropped) {
			allExactlySubmittedOrDropped = false
		}
	}
	// Every expected Booking must exist before the Brief can be "all delivered".
	allExist := expected > 0 && created >= expected

	switch {
	case allExist && allResolved:
		return briefApproved
	case allExist && allDeliveredOrDropped:
		// All delivered. If every non-dropped Booking is exactly [Content Submitted]
		// the Brief is [Submitted]; once QC starts (any in review / passed) it is
		// [In Review].
		if allExactlySubmittedOrDropped {
			return briefSubmitted
		}
		return briefInReview
	case anyStarted:
		return briefInProgress
	default:
		return briefToDo
	}
}

// bkgDelivered reports whether a Booking has delivered content at least once, i.e. is
// in (or past) [Content Submitted] on the native machine. All these states are only
// reachable after content was first submitted.
func bkgDelivered(st string) bool {
	switch st {
	case BkgContentSubmit, BkgQCReview, BkgQCPassed, BkgQCFailed, BkgEscalated:
		return true
	}
	return false
}

// bkgResolved reports a terminal Booking outcome for the roll-up: [QC Passed] or
// [Dropped] (§2 — passed, or formally dropped/replaced).
func bkgResolved(st string) bool {
	return st == BkgQCPassed || st == BkgDropped
}

// bookingStatuses returns every child Booking's status for a Brief (roll-up input).
func bookingStatuses(ctx context.Context, tx *sql.Tx, briefID string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `SELECT status FROM creator_bookings WHERE brief_id = ?`, briefID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var st string
		if err := rows.Scan(&st); err != nil {
			return nil, err
		}
		out = append(out, st)
	}
	return out, rows.Err()
}
