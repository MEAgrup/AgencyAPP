// This file implements the Brief -> Asset roll-up (M7 §2): a Creative Brief's
// status is NOT driven directly, it is a roll-up of its child Assets. The rules
// (M7 §2), mapped onto the canonical brief_task chain (STATE_MACHINES §7):
//
//	[To Do]        — no Asset has started work yet.
//	[In Progress]  — at least one Asset started, but not every EXPECTED Asset has
//	                 reached [Submitted] (this is the edge that makes the Brief
//	                 leave [To Do], advancing the Service to [In Execution]).
//	[Submitted]    — every expected Asset (== the Brief's Quantity/Target) has
//	                 reached at least [Submitted] and none has entered review yet.
//	[In Review]    — all reached [Submitted] and review is in progress: any Asset
//	                 is mid-review / in revision, or some (not all) are approved.
//	[Approved]     — every Asset is [Approved].
//
// "Expected" is the Brief's Quantity/Target (§4 Rule 1: Assets are created
// incrementally, so the Brief cannot roll up to [Submitted]/[Approved] until all
// expected Asset rows exist AND have advanced). The roll-up only ever moves the
// Brief FORWARD along the chain and steps through each intermediate edge via the
// engine (house rule 2 — never a raw status UPDATE); a single Asset bouncing back
// to revision keeps the Brief at [In Review] (M7 §2 "stays [In Review] as long as
// any Asset is still mid-review or in revision"), it does not drag the Brief back.
package module12_task

import (
	"context"
	"database/sql"
	"errors"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// rollupChain is the forward brief_task path the roll-up walks. The Brief-level
// [Revision Requested] node is intentionally NOT part of it — under an Asset
// breakdown, revisions are per-Asset (M7 §6) and the Brief stays [In Review].
var rollupChain = []string{StatusToDo, StatusInProgress, StatusSubmitted, StatusInReview, StatusApproved}

func chainRank(status string) int {
	for i, s := range rollupChain {
		if s == status {
			return i
		}
	}
	return -1
}

// RecomputeBriefRollup recomputes a Brief's roll-up status from its Assets and
// drives it forward through the engine, inside the caller's transaction. It is
// called after every Asset transition (execution edges here, AM review edges in
// module7_creative). Idempotent and forward-only: if the Brief is already at (or
// past) the computed target it is a no-op. When the Brief first leaves [To Do] the
// parent Service advances to [In Execution] via the injected AccountService hook.
//
// Defensive no-ops: a Brief with no Assets, an off-machine (Live Stream) Brief, or
// a Brief already terminal / off the roll-up chain is left untouched.
func (s *Service) RecomputeBriefRollup(ctx context.Context, tx *sql.Tx, actor permission.Actor, briefID string) error {
	if briefID == "" {
		return nil
	}
	var status, division string
	var serviceID string
	var quantityTarget int
	err := tx.QueryRowContext(ctx,
		`SELECT status, assigned_division, service_id, quantity_target FROM briefs WHERE id = ? FOR UPDATE`,
		briefID).Scan(&status, &division, &serviceID, &quantityTarget)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrTaskNotFound
	}
	if err != nil {
		return err
	}
	cur := chainRank(status)
	if cur < 0 {
		return nil // Brief off the roll-up chain (e.g. [Dispatched to Vendor]); leave it.
	}

	statuses, err := assetStatuses(ctx, tx, briefID)
	if err != nil {
		return err
	}
	if len(statuses) == 0 {
		return nil // no Assets yet — nothing to roll up.
	}
	target := rollupTarget(statuses, quantityTarget)
	tgt := chainRank(target)

	// Forward-only: step one legal edge at a time toward the target.
	for cur < tgt {
		from := rollupChain[cur]
		to := rollupChain[cur+1]
		if _, err := s.engine().Transition(ctx, tx, statemachine.Request{
			Machine: statemachine.MBriefTask, EntityType: "brief", Table: "briefs",
			EntityID: briefID, To: to, Actor: actor,
		}); err != nil {
			return err
		}
		// The moment the Brief leaves [To Do], advance the parent Service (M6 §5
		// Flow 3) — the same hook a Brief-as-task fires directly.
		if from == StatusToDo {
			if s.Account == nil {
				return errors.New("module12_task: AccountService hook not wired")
			}
			if err := s.Account.OnBriefLeavesToDo(ctx, tx, actor, serviceID); err != nil {
				return err
			}
		}
		cur++
	}
	return nil
}

// rollupTarget maps the current set of Asset statuses (and the expected count =
// Quantity/Target) to the Brief's roll-up target status (M7 §2).
func rollupTarget(statuses []string, expected int) string {
	created := len(statuses)
	anyStarted := false
	allApproved := true
	allExactlySubmitted := true
	anyWorking := false // in {[To Do],[In Progress],[Blocked]} — not yet handed in
	for _, st := range statuses {
		if st != StatusToDo {
			anyStarted = true
		}
		if st != StatusApproved {
			allApproved = false
		}
		if st != StatusSubmitted {
			allExactlySubmitted = false
		}
		if st == StatusToDo || st == StatusInProgress || st == StatusBlocked {
			anyWorking = true
		}
	}
	// Every expected Asset must exist before the Brief can be "all handed in".
	allExist := expected > 0 && created >= expected

	switch {
	case allExist && allApproved:
		return StatusApproved
	case allExist && !anyWorking:
		// All expected Assets reached >= [Submitted]. If every one is exactly
		// [Submitted] the Brief is [Submitted]; once review starts (any in review /
		// revision, or some already approved) it is [In Review].
		if allExactlySubmitted {
			return StatusSubmitted
		}
		return StatusInReview
	case anyStarted:
		return StatusInProgress
	default:
		return StatusToDo
	}
}

// assetStatuses returns every child Asset's status for a Brief (roll-up input).
func assetStatuses(ctx context.Context, tx *sql.Tx, briefID string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `SELECT status FROM assets WHERE brief_id = ?`, briefID)
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
