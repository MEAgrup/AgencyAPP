// This file implements Module 6 — Cluster 4 (part A): Revision routing (M6 §7).
//
// The AM acts as the client's proxy for first-pass review (§6 Rule 3): the AM
// pulls a [Submitted] Brief into [In Review], then either approves it or sends
// it back with mandatory written feedback (§7 Rule 2) to [Revision Requested].
// Revisions route to the SAME division/PIC that submitted the work — this is
// intrinsic: the transition stays on the same Brief row, Account never reassigns
// a revision to a different division (§7 Rule 1).
//
// Scope split (per ticket): only the AM-side edges of the brief_task machine
// (STATE_MACHINES §7) live here —
//   - [Submitted]        -> [In Review]         (AM picks the work up)
//   - [In Review]        -> [Approved]          (AM approves; §6 Flow 3)
//   - [In Review]        -> [Revision Requested] (AM requests revision, +1)
//
// The DIVISION-side edges ([To Do]->[In Progress], [In Progress]->[Submitted],
// [Revision Requested]->[In Progress] rework, and [Blocked]) belong to the
// execution divisions' modules (M7–M9 / M12) and are DEFERRED here; the engine
// already carries those edges (config.go), they are just not driven by M6.
//
// House rules honoured here:
//   - no status field is ever written by raw UPDATE — every move goes through the
//     transition engine (house rule 2);
//   - the revision counter is DERIVED from the immutable audit log (the count of
//     [In Review]->[Revision Requested] transitions, §6 Rule 4), never stored
//     (house rules 3/4) — deriveBriefRevisionCount (brief.go) already does this;
//   - the mandatory revision feedback (§7 Rule 2) is appended to the audit log
//     (immutable), never a silent rejection and never an invented column (§9.4
//     has no feedback field);
//   - §7 Rule 4 / M6-OA-3: a Brief crossing 3 revisions is surfaced for SPV
//     visibility — exposed as the derived RevisionFlagged read field AND, on the
//     exact crossing, the cataloged EvRevisionCountFlag notification (nil-guarded).
package module6_account

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// Brief review lifecycle states (STATE_MACHINES §7) driven by the AM.
const (
	BriefStatusSubmitted       = "[Submitted]"
	BriefStatusInReview        = "[In Review]"
	BriefStatusApproved        = "[Approved]"
	BriefStatusRevisionReq     = "[Revision Requested]"
	briefRevisionFlagThreshold = 3 // §7 Rule 4 / M6-OA-3: 3+ revisions -> SPV flag
)

// ErrBriefReviewForbidden: actor is not the owning AM (nor Director) — only the
// AM who owns the client reviews that client's Briefs (§6 Rule 3 / §9.1). NEW
// string, W1-09 precedent, listed for orchestrator sign-off.
var ErrBriefReviewForbidden = errors.New("[hanya Account Manager pemilik klien yang dapat mereview Brief layanan ini]")

// ReviewBrief pulls a [Submitted] Brief into [In Review] (§6 Rule 1, the AM
// proxy review). Owning AM (or Director) only. A wrong-state Brief is rejected
// by the engine (BlockedError); a Live Stream Brief ([Dispatched to Vendor]) has
// no such edge and is likewise rejected — it is tracked in Module 10, not here.
func (s *Service) ReviewBrief(ctx context.Context, actor permission.Actor, briefID string) (statemachine.Result, error) {
	return s.driveReviewEdge(ctx, actor, briefID, BriefStatusInReview)
}

// ApproveBrief approves a Brief under review ([In Review] -> [Approved], §6
// Flow 3). Owning AM (or Director) only. Once [Approved] the AM may send results
// to the client directly (M6-OA-7 — no SPV sign-off gate).
func (s *Service) ApproveBrief(ctx context.Context, actor permission.Actor, briefID string) (statemachine.Result, error) {
	return s.driveReviewEdge(ctx, actor, briefID, BriefStatusApproved)
}

// driveReviewEdge is the shared owner-gated engine driver for the two no-notes
// AM review edges (Submitted->In Review, In Review->Approved).
func (s *Service) driveReviewEdge(ctx context.Context, actor permission.Actor, briefID, to string) (statemachine.Result, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return statemachine.Result{}, err
	}
	defer tx.Rollback()

	if _, _, err := lockBriefOwner(ctx, tx, actor, briefID); err != nil {
		return statemachine.Result{}, err
	}
	// M11 Blocking-Dependency gate (§2 Rule 7 / §6.3): a Brief's FINAL transition
	// ([In Review] -> [Approved]) is held while any Blocking Dependency's Source is
	// not yet terminal. The guard runs in this tx and its BlockedError aborts the
	// approval unchanged. No-op for every non-approval edge and when unset.
	if to == BriefStatusApproved && s.ApproveGuard != nil {
		if err := s.ApproveGuard.ValidateBriefApproval(ctx, tx, briefID); err != nil {
			return statemachine.Result{}, err
		}
	}
	res, err := s.engine().Transition(ctx, tx, statemachine.Request{
		Machine: statemachine.MBriefTask, EntityType: "brief", Table: "briefs",
		EntityID: briefID, To: to, Actor: actor,
	})
	if err != nil {
		return statemachine.Result{}, err
	}
	if err := tx.Commit(); err != nil {
		return statemachine.Result{}, err
	}
	return res, nil
}

// RequestBriefRevision sends a Brief under review back to the division with
// mandatory written feedback ([In Review] -> [Revision Requested], §7). Owning
// AM (or Director) only. The counter derives from the audit log; on the exact
// 3rd revision the SPV-visibility flag fires (§7 Rule 4 / M6-OA-3).
func (s *Service) RequestBriefRevision(ctx context.Context, actor permission.Actor, briefID, feedback string) (statemachine.Result, error) {
	feedback = strings.TrimSpace(feedback)
	if feedback == "" {
		return statemachine.Result{}, ErrRevisionNotesRequired // §7 Rule 2 (reused string)
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return statemachine.Result{}, err
	}
	defer tx.Rollback()

	division, _, err := lockBriefOwner(ctx, tx, actor, briefID)
	if err != nil {
		return statemachine.Result{}, err
	}
	res, err := s.engine().Transition(ctx, tx, statemachine.Request{
		Machine: statemachine.MBriefTask, EntityType: "brief", Table: "briefs",
		EntityID: briefID, To: BriefStatusRevisionReq, Actor: actor,
	})
	if err != nil {
		return statemachine.Result{}, err
	}
	// §7 Rule 2: the mandatory feedback is recorded immutably in the audit log
	// (no invented §9.4 column). The revision-count transition row is written by
	// the engine above; this is the accompanying feedback text.
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "brief", EntityID: briefID, Actor: actor.EmployeeID, Action: "revision_feedback",
		After: map[string]any{"feedback": feedback},
	}); err != nil {
		return statemachine.Result{}, err
	}

	// §7 Rule 4 / M6-OA-3: recompute the derived count from the immutable log and
	// fire the SPV-visibility flag on the exact crossing (once). Non-blocking.
	entries, err := audit.List(ctx, tx, audit.Filter{EntityType: "brief", EntityID: briefID})
	if err != nil {
		return statemachine.Result{}, err
	}
	if deriveBriefRevisionCount(entries) == briefRevisionFlagThreshold {
		if err := s.emitRevisionFlag(ctx, tx, actor, briefID, division); err != nil {
			return statemachine.Result{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return statemachine.Result{}, err
	}
	return res, nil
}

// emitRevisionFlag fires the cataloged EvRevisionCountFlag (§7 Rule 4 / M6-OA-3,
// aligned with M12's Task-level auto-flag). Nil-guarded; recipients resolve to
// the producing division's lead/SPV (leadsOfDivision), matching the catalog's
// "Team Leader/SPV" target. The catalog is NOT extended — this event already
// exists (Phase 0 v2 §9).
func (s *Service) emitRevisionFlag(ctx context.Context, tx *sql.Tx, actor permission.Actor, briefID, division string) error {
	if s.Catalog == nil {
		return nil
	}
	_, err := s.Catalog.Emit(ctx, tx, notification.Emission{
		Event: notification.EvRevisionCountFlag, EntityType: "brief", EntityID: briefID,
		Actor: actor.EmployeeID, Division: division,
	})
	return err
}

// lockBriefOwner row-locks a Brief and returns its (assigned_division, owner AM),
// enforcing the §6 Rule 3 review gate: owning AM or Director only.
func lockBriefOwner(ctx context.Context, tx *sql.Tx, actor permission.Actor, briefID string) (division string, ownerAM string, err error) {
	var owner sql.NullString
	err = tx.QueryRowContext(ctx,
		`SELECT b.assigned_division, c.assigned_am_id
		   FROM briefs b
		   JOIN services sv ON sv.id = b.service_id
		   JOIN clients c ON c.id = sv.client_id
		  WHERE b.id = ? FOR UPDATE`, briefID).Scan(&division, &owner)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", ErrBriefNotFound
	}
	if err != nil {
		return "", "", err
	}
	if !actor.Role.Director && (!owner.Valid || owner.String != actor.EmployeeID) {
		return "", "", ErrBriefReviewForbidden
	}
	return division, owner.String, nil
}
