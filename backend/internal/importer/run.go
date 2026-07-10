package importer

// run.go orchestrates the two entry points.
//
// DryRun strategy — "write inside a transaction, then roll back". This is the
// MOST ACCURATE choice for dedup: two rows sharing a phone within one batch must
// collide, so row N must see the leads inserted by rows 0..N-1. A pure in-memory
// check cannot see intra-batch inserts; a per-row rollback would hide them too.
// So DryRun runs the REAL create logic in ONE transaction, isolating each row
// with a SAVEPOINT: a row that errors/blocks is rolled back to its savepoint
// (its partial writes vanish) while successful rows stay VISIBLE to later rows;
// the whole transaction is rolled back at the end, so the DB is never mutated.
// (Verify/AttachContract self-commit and cannot join this transaction, so the
// verified-payment plan is validated purely — validatePayments — rather than
// replayed during a dry run.)
//
// Apply commits per row: a row is one unit of work. Creation is atomic in its
// own transaction (rolled back utuh on any error); on success it commits, then
// the payment replay runs through the official money paths. One failed row never
// stops the others, and each row reports its issued IDs.

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// DryRun validates every row and writes nothing (all work is rolled back).
func (s *Service) DryRun(ctx context.Context, actor permission.Actor, leads []LeadRow, clients []ClientRow) (Report, error) {
	if err := permit(actor); err != nil {
		return Report{}, err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Report{}, err
	}
	defer tx.Rollback() // dry run never persists (safety net)

	var rep Report
	for i, row := range leads {
		rep.add(s.dryRunLead(ctx, tx, actor, row, i))
	}
	for i, row := range clients {
		rep.add(s.dryRunClient(ctx, tx, actor, row, i))
	}
	rep.recount()
	// Explicit rollback so a rollback error surfaces (the defer would swallow it).
	if err := tx.Rollback(); err != nil {
		return Report{}, err
	}
	return rep, nil
}

func (s *Service) dryRunLead(ctx context.Context, tx *sql.Tx, actor permission.Actor, row LeadRow, index int) RowOutcome {
	out := RowOutcome{Index: index, Entity: "lead"}
	if err := validateLeadRow(row); err != nil {
		out.Status, out.Message = RowError, err.Error()
		return out
	}
	sp := fmt.Sprintf("sp_lead_%d", index)
	if _, err := tx.ExecContext(ctx, "SAVEPOINT "+sp); err != nil {
		out.Status, out.Message = RowError, err.Error()
		return out
	}
	res, err := s.applyLeadTx(ctx, tx, actor, row, index)
	if err != nil {
		_, _ = tx.ExecContext(ctx, "ROLLBACK TO SAVEPOINT "+sp)
		out.Status, out.Message = RowError, err.Error()
		return out
	}
	switch res.Action {
	case "block":
		// Nothing to keep for a blocked row; discard its provenance write too.
		_, _ = tx.ExecContext(ctx, "ROLLBACK TO SAVEPOINT "+sp)
		out.Status, out.Message = RowDuplikat, res.Message
	case "reopen":
		// Keep it visible so a later same-phone row dedups against the reopen.
		_, _ = tx.ExecContext(ctx, "RELEASE SAVEPOINT "+sp)
		out.Status, out.Detail = RowValid, "reopen "+res.LeadID
	default: // create
		_, _ = tx.ExecContext(ctx, "RELEASE SAVEPOINT "+sp)
		out.Status = RowValid
	}
	return out
}

func (s *Service) dryRunClient(ctx context.Context, tx *sql.Tx, actor permission.Actor, row ClientRow, index int) RowOutcome {
	out := RowOutcome{Index: index, Entity: "client"}
	if err := validateClientRow(row); err != nil {
		out.Status, out.Message = RowError, err.Error()
		return out
	}
	sp := fmt.Sprintf("sp_client_%d", index)
	if _, err := tx.ExecContext(ctx, "SAVEPOINT "+sp); err != nil {
		out.Status, out.Message = RowError, err.Error()
		return out
	}
	// Exercise the real inserts to catch any DB-level problem, then discard.
	if _, err := s.createClientTx(ctx, tx, actor, row, index); err != nil {
		_, _ = tx.ExecContext(ctx, "ROLLBACK TO SAVEPOINT "+sp)
		out.Status, out.Message = RowError, err.Error()
		return out
	}
	_, _ = tx.ExecContext(ctx, "ROLLBACK TO SAVEPOINT "+sp) // clients need no cross-row visibility
	out.Status = RowValid
	return out
}

// Apply lands the rows for real. Director only.
func (s *Service) Apply(ctx context.Context, actor permission.Actor, leads []LeadRow, clients []ClientRow) (Report, error) {
	if err := permit(actor); err != nil {
		return Report{}, err
	}
	var rep Report
	for i, row := range leads {
		rep.add(s.applyLead(ctx, actor, row, i))
	}
	for i, row := range clients {
		rep.add(s.applyClient(ctx, actor, row, i))
	}
	rep.recount()
	return rep, nil
}

func (s *Service) applyLead(ctx context.Context, actor permission.Actor, row LeadRow, index int) RowOutcome {
	out := RowOutcome{Index: index, Entity: "lead"}
	if err := validateLeadRow(row); err != nil {
		out.Status, out.Message = RowFailed, err.Error()
		return out
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		out.Status, out.Message = RowFailed, err.Error()
		return out
	}
	defer tx.Rollback()

	res, err := s.applyLeadTx(ctx, tx, actor, row, index)
	if err != nil {
		out.Status, out.Message = RowFailed, err.Error()
		return out // rolled back utuh
	}
	// Commit create/reopen (the landed entity) and block (its audit-only
	// provenance row) so the dedup decision is durably recorded.
	if err := tx.Commit(); err != nil {
		out.Status, out.Message = RowFailed, err.Error()
		return out
	}
	switch res.Action {
	case "block":
		out.Status, out.Message = RowDuplikat, res.Message
	case "reopen":
		out.Status, out.Detail, out.IssuedIDs = RowApplied, "reopen "+res.LeadID, []string{res.LeadID}
	default:
		out.Status, out.IssuedIDs = RowApplied, []string{res.LeadID}
	}
	return out
}

func (s *Service) applyClient(ctx context.Context, actor permission.Actor, row ClientRow, index int) RowOutcome {
	out := RowOutcome{Index: index, Entity: "client"}
	// Validate BEFORE any write: a row that would fail replay is rejected here,
	// giving effective per-row atomicity across the create + replay phases.
	if err := validateClientRow(row); err != nil {
		out.Status, out.Message = RowFailed, err.Error()
		return out
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		out.Status, out.Message = RowFailed, err.Error()
		return out
	}
	ids, err := s.createClientTx(ctx, tx, actor, row, index)
	if err != nil {
		_ = tx.Rollback()
		out.Status, out.Message = RowFailed, err.Error()
		return out // rolled back utuh: nothing landed
	}
	if err := tx.Commit(); err != nil {
		_ = tx.Rollback()
		out.Status, out.Message = RowFailed, err.Error()
		return out
	}

	// Post-commit: attach contract + replay verified payments via the official
	// money paths. Pre-validated, so a failure here is an unexpected system error;
	// report it with the IDs already issued (creation is committed).
	if err := s.replayPayments(ctx, actor, row, ids); err != nil {
		out.Status, out.Message, out.IssuedIDs = RowFailed, err.Error(), ids.all()
		return out
	}
	out.Status, out.IssuedIDs = RowApplied, ids.all()
	return out
}
