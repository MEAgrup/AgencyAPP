// Asset-level revision loop (M7 §6) + AM review at Asset granularity (§4 Flow 3).
//
// The AM acts as the client's proxy (M6 §6 Rule 3), exercised here PER ASSET
// (§9.1): the AM pulls a [Submitted] Asset into [In Review], then approves it or
// sends it back with mandatory feedback to [Revision Requested] — which loops the
// Asset (and only that Asset) back to [In Progress] via module12_task.ReworkAsset,
// leaving its siblings untouched (§6 Rule 2). Every review edge recomputes the
// parent Brief's roll-up (M7 §2) in the same transaction.
//
// AM-side edges only (mirrors module6_account/brief_review.go one level deeper):
//
//	[Submitted]  -> [In Review]          (AM picks the Asset up)
//	[In Review]  -> [Approved]           (AM approves)
//	[In Review]  -> [Revision Requested] (AM requests revision, feedback mandatory)
//
// The division-side edges (Start/Submit/Rework/Block) live in module12_task.
package module7_creative

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

// ReviewAsset pulls a [Submitted] Asset into [In Review] (§4 Flow 3). Owning AM or
// Director only. A wrong-state Asset is rejected by the engine (BlockedError).
func (s *Service) ReviewAsset(ctx context.Context, actor permission.Actor, assetID string) (statemachine.Result, error) {
	return s.driveReviewEdge(ctx, actor, assetID, StatusInReview, "")
}

// ApproveAsset approves an Asset under review ([In Review] -> [Approved], §4 Flow
// 3). Owning AM or Director only. When this is the LAST Asset to be approved the
// Brief roll-up reaches [Approved] (M7 §2).
func (s *Service) ApproveAsset(ctx context.Context, actor permission.Actor, assetID string) (statemachine.Result, error) {
	return s.driveReviewEdge(ctx, actor, assetID, StatusApproved, "")
}

// RequestAssetRevision sends an Asset under review back to the PIC with mandatory
// feedback ([In Review] -> [Revision Requested], §6 Rule 1). Owning AM or Director
// only. The Revision Count derives from the audit log; on the exact 3rd revision
// the per-Asset Team-Leader visibility flag fires (§6 Rule 4).
func (s *Service) RequestAssetRevision(ctx context.Context, actor permission.Actor, assetID, feedback string) (statemachine.Result, error) {
	feedback = strings.TrimSpace(feedback)
	if feedback == "" {
		return statemachine.Result{}, ErrRevisionFeedbackRequired
	}
	return s.driveReviewEdge(ctx, actor, assetID, StatusRevisionReq, feedback)
}

// driveReviewEdge is the shared owner-gated engine driver for the AM review edges.
// It locks the Asset, enforces the owning-AM gate, drives the edge, records the
// mandatory feedback (revision only), fires the §6 Rule 4 flag on the 3rd revision,
// and recomputes the parent Brief's roll-up — all in one transaction.
func (s *Service) driveReviewEdge(ctx context.Context, actor permission.Actor, assetID, to, feedback string) (statemachine.Result, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return statemachine.Result{}, err
	}
	defer tx.Rollback()

	briefID, division, err := lockAssetOwner(ctx, tx, actor, assetID)
	if err != nil {
		return statemachine.Result{}, err
	}
	res, err := s.engine().Transition(ctx, tx, statemachine.Request{
		Machine: statemachine.MBriefTask, EntityType: "asset", Table: "assets",
		EntityID: assetID, To: to, Actor: actor,
	})
	if err != nil {
		return statemachine.Result{}, err
	}
	if to == StatusRevisionReq {
		// §6 Rule 1: mandatory feedback recorded immutably in the audit log (no
		// invented §9.3 column — Revision Feedback lives in the log).
		if err := audit.Write(ctx, tx, audit.Record{
			EntityType: "asset", EntityID: assetID, Actor: actor.EmployeeID, Action: "revision_feedback",
			After: map[string]any{"feedback": feedback},
		}); err != nil {
			return statemachine.Result{}, err
		}
		// §6 Rule 4: fire the per-Asset Quality flag on the exact 3rd revision (once).
		entries, err := audit.List(ctx, tx, audit.Filter{EntityType: "asset", EntityID: assetID})
		if err != nil {
			return statemachine.Result{}, err
		}
		if deriveAssetRevisionCount(entries) == assetRevisionFlagThreshold {
			if err := s.emitRevisionFlag(ctx, tx, actor, assetID, division); err != nil {
				return statemachine.Result{}, err
			}
		}
	}
	// M7 §2: recompute the parent Brief's roll-up after every Asset status change.
	if s.Tasks != nil {
		if err := s.Tasks.RecomputeBriefRollup(ctx, tx, actor, briefID); err != nil {
			return statemachine.Result{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return statemachine.Result{}, err
	}
	return res, nil
}

// emitRevisionFlag fires the ALREADY-CATALOGED EvRevisionCountFlag for an Asset
// crossing 3 revisions (§6 Rule 4). This is a per-Asset flag (entity_type=asset),
// distinct from M6's per-Brief flag — NOT a double-emit of the same occurrence.
// Recipients resolve to the Creative division lead(s). Catalog stays FROZEN.
func (s *Service) emitRevisionFlag(ctx context.Context, tx *sql.Tx, actor permission.Actor, assetID, division string) error {
	if s.Catalog == nil {
		return nil
	}
	_, err := s.Catalog.Emit(ctx, tx, notification.Emission{
		Event: notification.EvRevisionCountFlag, EntityType: "asset", EntityID: assetID,
		Actor: actor.EmployeeID, Division: division,
	})
	return err
}

// lockAssetOwner row-locks an Asset and returns its (parent Brief id, Creative
// division), enforcing the §4 Flow 3 review gate: owning AM or Director only.
func lockAssetOwner(ctx context.Context, tx *sql.Tx, actor permission.Actor, assetID string) (briefID, division string, err error) {
	var owner sql.NullString
	err = tx.QueryRowContext(ctx,
		`SELECT a.brief_id, b.assigned_division, c.assigned_am_id
		   FROM assets a
		   JOIN briefs b ON b.id = a.brief_id
		   JOIN services sv ON sv.id = b.service_id
		   JOIN clients c ON c.id = sv.client_id
		  WHERE a.id = ? FOR UPDATE`, assetID).Scan(&briefID, &division, &owner)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", ErrAssetNotFound
	}
	if err != nil {
		return "", "", err
	}
	if !actor.Role.Director && (!owner.Valid || owner.String != actor.EmployeeID) {
		return "", "", ErrReviewForbidden
	}
	return briefID, division, nil
}
