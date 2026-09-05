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
// Client rows now replay their payments too — via the finance InTx variants on
// the same tx (AttachContractInTx / VerifyInTx) — so a dry run exercises the
// FULL official money path (routing gate, [Lunas] contract gate, over-verify)
// with zero mutation, instead of only pre-validating the plan.
//
// A SAVEPOINT rollback/release that itself errors (e.g. a deadlock that rolled
// back the whole transaction) makes every later row's verdict untrustworthy, so
// it ABORTS the entire DryRun with a wrapping error rather than being swallowed.
//
// DryRun lock retention: the whole batch runs in ONE transaction, and InnoDB
// does NOT release row locks on ROLLBACK TO SAVEPOINT — the FOR UPDATE / gap
// locks each row takes on id_sequences (via ident.Next) are held until the final
// batch rollback. Concurrent LIVE id issuance for the same prefixes therefore
// blocks for the whole dry run. Run imports in a maintenance window.
//
// Apply is per-row atomic in ONE transaction: create (CLI/SVC/TRX/INST) +
// contract attach + every payment replay, then a single commit. On ANY error the
// whole row rolls back utuh — nothing lands and no IssuedIDs are reported. One
// failed row never stops the others.

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// savepoint / rollbackToSavepoint / releaseSavepoint wrap the SAVEPOINT verbs.
// The rollback/release errors are FATAL to a dry run: if the engine cannot honour
// them the transaction state is unknown and the report can no longer be trusted.
func savepoint(ctx context.Context, tx *sql.Tx, name string) error {
	_, err := tx.ExecContext(ctx, "SAVEPOINT "+name)
	return err
}

func rollbackToSavepoint(ctx context.Context, tx *sql.Tx, name string) error {
	if _, err := tx.ExecContext(ctx, "ROLLBACK TO SAVEPOINT "+name); err != nil {
		return fmt.Errorf("dry run aborted: ROLLBACK TO SAVEPOINT %s failed, report untrustworthy: %w", name, err)
	}
	return nil
}

func releaseSavepoint(ctx context.Context, tx *sql.Tx, name string) error {
	if _, err := tx.ExecContext(ctx, "RELEASE SAVEPOINT "+name); err != nil {
		return fmt.Errorf("dry run aborted: RELEASE SAVEPOINT %s failed, report untrustworthy: %w", name, err)
	}
	return nil
}

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
		out, fatal := s.dryRunLead(ctx, tx, actor, row, i)
		if fatal != nil {
			return Report{}, fatal
		}
		rep.add(out)
	}
	for i, row := range clients {
		out, fatal := s.dryRunClient(ctx, tx, actor, row, i)
		if fatal != nil {
			return Report{}, fatal
		}
		rep.add(out)
	}
	rep.recount()
	// Explicit rollback so a rollback error surfaces (the defer would swallow it).
	if err := tx.Rollback(); err != nil {
		return Report{}, err
	}
	return rep, nil
}

// dryRunLead returns the row verdict and, as its second value, a BATCH-FATAL
// error: a nil fatal means continue; a non-nil fatal means a savepoint op failed
// and the whole DryRun must abort (the report is no longer trustworthy).
func (s *Service) dryRunLead(ctx context.Context, tx *sql.Tx, actor permission.Actor, row LeadRow, index int) (RowOutcome, error) {
	out := RowOutcome{Index: index, Entity: "lead"}
	if err := validateLeadRow(row); err != nil {
		out.Status, out.Message = RowError, err.Error()
		return out, nil
	}
	sp := fmt.Sprintf("sp_lead_%d", index)
	if err := savepoint(ctx, tx, sp); err != nil {
		out.Status, out.Message = RowError, err.Error()
		return out, nil
	}
	res, err := s.applyLeadTx(ctx, tx, actor, row, index)
	if err != nil {
		if fatal := rollbackToSavepoint(ctx, tx, sp); fatal != nil {
			return out, fatal
		}
		out.Status, out.Message = RowError, err.Error()
		return out, nil
	}
	switch res.Action {
	case "block":
		// Nothing to keep for a blocked row; discard its provenance write too.
		if fatal := rollbackToSavepoint(ctx, tx, sp); fatal != nil {
			return out, fatal
		}
		out.Status, out.Message = RowDuplikat, res.Message
	case "reopen":
		// Keep it visible so a later same-phone row dedups against the reopen.
		if fatal := releaseSavepoint(ctx, tx, sp); fatal != nil {
			return out, fatal
		}
		out.Status, out.Detail = RowValid, "reopen "+res.LeadID
	default: // create
		if fatal := releaseSavepoint(ctx, tx, sp); fatal != nil {
			return out, fatal
		}
		out.Status = RowValid
	}
	return out, nil
}

// dryRunClient exercises the FULL money path (create + contract attach + payment
// replay) under a savepoint, then rolls it back. Second return value is a
// batch-fatal savepoint error (see dryRunLead).
func (s *Service) dryRunClient(ctx context.Context, tx *sql.Tx, actor permission.Actor, row ClientRow, index int) (RowOutcome, error) {
	out := RowOutcome{Index: index, Entity: "client"}
	if err := validateClientRow(row); err != nil {
		out.Status, out.Message = RowError, err.Error()
		return out, nil
	}
	sp := fmt.Sprintf("sp_client_%d", index)
	if err := savepoint(ctx, tx, sp); err != nil {
		out.Status, out.Message = RowError, err.Error()
		return out, nil
	}
	// Run the real create + contract attach + payment replay to surface any
	// routing/contract-gate/over-verify or DB-level problem, then discard (clients
	// need no cross-row visibility).
	if _, err := s.landClientTx(ctx, tx, actor, row, index); err != nil {
		if fatal := rollbackToSavepoint(ctx, tx, sp); fatal != nil {
			return out, fatal
		}
		out.Status, out.Message = RowError, err.Error()
		return out, nil
	}
	if fatal := rollbackToSavepoint(ctx, tx, sp); fatal != nil {
		return out, fatal
	}
	out.Status = RowValid
	return out, nil
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
	if err := validateClientRow(row); err != nil {
		out.Status, out.Message = RowFailed, err.Error()
		return out
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		out.Status, out.Message = RowFailed, err.Error()
		return out
	}
	defer tx.Rollback()

	// ONE transaction: create + contract attach + all payment replays. Any error
	// rolls the whole row back utuh — nothing landed, no IssuedIDs reported.
	ids, err := s.landClientTx(ctx, tx, actor, row, index)
	if err != nil {
		out.Status, out.Message = RowFailed, err.Error()
		return out
	}
	if err := tx.Commit(); err != nil {
		out.Status, out.Message = RowFailed, err.Error()
		return out
	}
	out.Status, out.IssuedIDs = RowApplied, ids.all()
	return out
}
