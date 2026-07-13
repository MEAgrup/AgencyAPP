// This file implements the [Blocked] workflow (M12 §2 Rule 8 / §5.3a). Blocking
// pauses the Turnaround clock (Rule 7), so it must not be self-set by the PIC
// whose own speed is being measured: Staff and the AM may SUBMIT a block request,
// but only SPV/Lead may action it. The [Blocked] status itself is written ONLY by
// the brief_task engine (its [In Progress]->[Blocked] and [Blocked]->[In Progress]
// edges are requireLead), so the engine double-enforces the SPV/Lead restriction;
// this file adds the request/approval queue and fires the two ALREADY-CATALOGED
// notification events (EvBlockRequestSubmitted / EvBlockRequestDecided, Phase 0 v2
// §9). No catalog event is added; nothing is emitted when Catalog is nil.
package module12_task

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/ident"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// BlockRequest is one pending/resolved block request on a Task (Brief or Asset).
type BlockRequest struct {
	ID          string     `json:"id"`
	EntityID    string     `json:"entity_id"` // the Brief or Asset the request is on
	Reason      string     `json:"reason"`
	Status      string     `json:"status"`
	RequestedBy string     `json:"requested_by"`
	ResolvedBy  *string    `json:"resolved_by"`
	ResolvedAt  *time.Time `json:"resolved_at"`
	CreatedAt   time.Time  `json:"created_at"`
}

// canRequestBlock is the §5.3a request gate: the target division's staff/lead, the
// owning AM, or Director. (Leads/Director can also set [Blocked] directly, but may
// still file a request for the audit trail.)
func canRequestBlock(a permission.Actor, r taskRow) bool {
	if a.Role.Director {
		return true
	}
	if a.EmployeeID == r.ownerAM {
		return true
	}
	return a.Role.Division == r.division &&
		(a.Role.Level == permission.LevelStaff || a.Role.Level == permission.LevelLead)
}

// SubmitBlockRequest files a pending block request on a Brief-as-task (§5.3a).
func (s *Service) SubmitBlockRequest(ctx context.Context, actor permission.Actor, briefID, reason string) (BlockRequest, error) {
	return s.submitBlockRequest(ctx, actor, sourceBrief, briefID, reason)
}

// SubmitAssetBlockRequest files a pending block request on a Creative Asset
// (§5.3a). Same rule: staff/AM request, only SPV/Lead action it.
func (s *Service) SubmitAssetBlockRequest(ctx context.Context, actor permission.Actor, assetID, reason string) (BlockRequest, error) {
	return s.submitBlockRequest(ctx, actor, sourceAsset, assetID, reason)
}

// submitBlockRequest files a pending block request for any source. It does NOT
// change the Task status — only an SPV/Lead approval does. Division leads are
// notified via the cataloged EvBlockRequestSubmitted event.
func (s *Service) submitBlockRequest(ctx context.Context, actor permission.Actor, src taskSource, id, reason string) (BlockRequest, error) {
	reason = trim(reason)
	if reason == "" {
		return BlockRequest{}, ErrBlockReasonRequired
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return BlockRequest{}, err
	}
	defer tx.Rollback()

	r, err := lockTask(ctx, tx, src, id)
	if err != nil {
		return BlockRequest{}, err
	}
	if r.status == StatusVendorDispatched {
		return BlockRequest{}, ErrNotATask
	}
	if !canRequestBlock(actor, r) {
		return BlockRequest{}, ErrBlockRequestForbidden
	}
	reqID, err := ident.Next(ctx, tx, src.blockIDPrefix, time.Now())
	if err != nil {
		return BlockRequest{}, err
	}
	if _, err := tx.ExecContext(ctx,
		"INSERT INTO "+src.blockTable+" (id, "+src.blockFKCol+", reason, status, requested_by, created_by)"+
			" VALUES (?, ?, ?, 'pending', ?, ?)",
		reqID, id, reason, actor.EmployeeID, actor.EmployeeID); err != nil {
		return BlockRequest{}, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: src.entityType, EntityID: id, Actor: actor.EmployeeID, Action: "block_request_submitted",
		After: map[string]any{"request_id": reqID, "reason": reason},
	}); err != nil {
		return BlockRequest{}, err
	}
	if s.Catalog != nil {
		if _, err := s.Catalog.Emit(ctx, tx, notification.Emission{
			Event: notification.EvBlockRequestSubmitted, EntityType: src.entityType, EntityID: id,
			Actor: actor.EmployeeID, Division: r.division,
		}); err != nil {
			return BlockRequest{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return BlockRequest{}, err
	}
	return BlockRequest{ID: reqID, EntityID: id, Reason: reason, Status: "pending", RequestedBy: actor.EmployeeID, CreatedAt: time.Now()}, nil
}

// ApproveBlockRequest approves a pending request and drives the Brief-as-task into
// [Blocked] via the engine (SPV/Lead-only edge, §2 Rule 8). The clock pauses on
// entry (Rule 7). The requester is notified (EvBlockRequestDecided).
func (s *Service) ApproveBlockRequest(ctx context.Context, actor permission.Actor, briefID, reqID string) error {
	return s.decideBlockRequest(ctx, actor, sourceBrief, briefID, reqID, true)
}

// RejectBlockRequest rejects a pending Brief-as-task request without touching the
// Task status. The requester is notified (EvBlockRequestDecided).
func (s *Service) RejectBlockRequest(ctx context.Context, actor permission.Actor, briefID, reqID string) error {
	return s.decideBlockRequest(ctx, actor, sourceBrief, briefID, reqID, false)
}

// ApproveAssetBlockRequest / RejectAssetBlockRequest are the Asset-source
// equivalents (§5.3a). Approving drives the Asset into [Blocked] and recomputes
// the parent Brief's roll-up.
func (s *Service) ApproveAssetBlockRequest(ctx context.Context, actor permission.Actor, assetID, reqID string) error {
	return s.decideBlockRequest(ctx, actor, sourceAsset, assetID, reqID, true)
}
func (s *Service) RejectAssetBlockRequest(ctx context.Context, actor permission.Actor, assetID, reqID string) error {
	return s.decideBlockRequest(ctx, actor, sourceAsset, assetID, reqID, false)
}

func (s *Service) decideBlockRequest(ctx context.Context, actor permission.Actor, src taskSource, id, reqID string, approve bool) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	r, err := lockTask(ctx, tx, src, id)
	if err != nil {
		return err
	}
	// §5.3a: only SPV/Lead of the target division (or Director) may action a request.
	if !actor.IsLead(r.division) {
		return ErrBlockDecideForbidden
	}
	var status, requestedBy string
	err = tx.QueryRowContext(ctx,
		"SELECT status, requested_by FROM "+src.blockTable+" WHERE id = ? AND "+src.blockFKCol+" = ? FOR UPDATE",
		reqID, id).Scan(&status, &requestedBy)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrBlockRequestNotFound
	}
	if err != nil {
		return err
	}
	if status != "pending" {
		return ErrBlockRequestClosed
	}

	newStatus := "rejected"
	if approve {
		newStatus = "approved"
		if _, err := s.engine().Transition(ctx, tx, statemachine.Request{
			Machine: statemachine.MBriefTask, EntityType: src.entityType, Table: src.table,
			EntityID: id, To: StatusBlocked, Actor: actor,
		}); err != nil {
			return err
		}
		// An Asset entering [Blocked] recomputes its Brief's roll-up (M7 §2).
		if src.table == "assets" {
			if err := s.RecomputeBriefRollup(ctx, tx, actor, r.parentBriefID); err != nil {
				return err
			}
		}
	}
	if _, err := tx.ExecContext(ctx,
		"UPDATE "+src.blockTable+" SET status = ?, resolved_by = ?, resolved_at = NOW() WHERE id = ?",
		newStatus, actor.EmployeeID, reqID); err != nil {
		return err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: src.entityType, EntityID: id, Actor: actor.EmployeeID,
		Action: "block_request_" + newStatus,
		After:  map[string]any{"request_id": reqID},
	}); err != nil {
		return err
	}
	if s.Catalog != nil {
		if _, err := s.Catalog.Emit(ctx, tx, notification.Emission{
			Event: notification.EvBlockRequestDecided, EntityType: src.entityType, EntityID: id,
			Actor: actor.EmployeeID, ExplicitRecipients: []string{requestedBy},
		}); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ResumeTask drives a Brief-as-task [Blocked] -> [In Progress] (§3 step 6),
// resuming the clock. SPV/Lead-only (the engine edge is requireLead); Director
// allowed. Blocked time is excluded from Turnaround (Rule 7).
func (s *Service) ResumeTask(ctx context.Context, actor permission.Actor, briefID string) (statemachine.Result, error) {
	return s.resumeTask(ctx, actor, sourceBrief, briefID)
}

// ResumeAsset drives a Creative Asset [Blocked] -> [In Progress], resuming the
// clock, and recomputes the parent Brief's roll-up.
func (s *Service) ResumeAsset(ctx context.Context, actor permission.Actor, assetID string) (statemachine.Result, error) {
	return s.resumeTask(ctx, actor, sourceAsset, assetID)
}

func (s *Service) resumeTask(ctx context.Context, actor permission.Actor, src taskSource, id string) (statemachine.Result, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return statemachine.Result{}, err
	}
	defer tx.Rollback()

	r, err := lockTask(ctx, tx, src, id)
	if err != nil {
		return statemachine.Result{}, err
	}
	if !actor.IsLead(r.division) {
		return statemachine.Result{}, ErrBlockDecideForbidden
	}
	res, err := s.engine().Transition(ctx, tx, statemachine.Request{
		Machine: statemachine.MBriefTask, EntityType: src.entityType, Table: src.table,
		EntityID: id, To: StatusInProgress, Actor: actor,
	})
	if err != nil {
		return statemachine.Result{}, err
	}
	if src.table == "assets" {
		if err := s.RecomputeBriefRollup(ctx, tx, actor, r.parentBriefID); err != nil {
			return statemachine.Result{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return statemachine.Result{}, err
	}
	return res, nil
}
