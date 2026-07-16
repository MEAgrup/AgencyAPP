package importer

// leads.go lands existing leads through the Module 1 dedup engine (Permintaan #3
// path 1). It reuses the exported dedup DECISION (module1_leads.Decide) and phone
// NORMALIZATION. The phone-match SELECT itself is no longer mirrored here: M1 v2
// exported module1_leads.MatchByPhone (+ IsTerminalAttempt) precisely so this
// package could call the live match instead of duplicating it (O19 resolved
// 2026-07-16, docs/DECISIONS.md — "importer mengikuti"). MatchByPhone's owner
// query is a LEFT JOIN employees (+ COALESCE on the name): an attempt owned by an
// employee_id not present in employees STILL counts as active, so import
// dry-run/apply outcomes can shift slightly versus the old INNER-JOIN mirror for
// that edge case — that shift is intentional (dedup must not hinge on HRIS sync
// timing), not a regression.

import (
	"context"
	"database/sql"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/ident"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module1_leads"
)

// leadAction is the applied dedup outcome for one row.
type leadAction struct {
	Action  string // "create" | "reopen" | "block"
	LeadID  string // created or reopened id
	Message string // BI block message (Action == "block")
}

// applyLeadTx runs the dedup door for one lead inside tx and performs the write
// for create/reopen (block writes only an audit-provenance row). It does NOT
// commit — the caller (per-row tx in Apply, shared savepoint tx in DryRun) owns
// the transaction lifecycle. Row must already have passed validateLeadRow.
func (s *Service) applyLeadTx(ctx context.Context, tx *sql.Tx, actor permission.Actor, row LeadRow, index int) (leadAction, error) {
	phoneNorm := module1_leads.NormalizePhone(row.NoTelepon)
	// actor.EmployeeID is threaded through only because MatchByPhone's signature
	// needs it (ActorHasActiveAttempt); ChannelImport's decision table never reads
	// that field — import has no notion of "the actor already holds an attempt".
	match, err := module1_leads.MatchByPhone(ctx, tx, phoneNorm, actor.EmployeeID)
	if err != nil {
		return leadAction{}, err
	}
	dec := module1_leads.Decide(module1_leads.ChannelImport, match)

	switch dec.Outcome {
	case module1_leads.OutcomeBlock:
		// Record the blocked import attempt on the matched lead (provenance).
		if match != nil {
			if err := audit.Write(ctx, tx, audit.Record{
				EntityType: "lead", EntityID: match.ID, Actor: actor.EmployeeID,
				Action: "import:lead_blocked",
				After:  map[string]any{"row_index": index, "source": row.Sumber, "message": dec.Message},
			}); err != nil {
				return leadAction{}, err
			}
		}
		return leadAction{Action: "block", Message: dec.Message}, nil

	case module1_leads.OutcomeReopen:
		// Terminal ([Rejected]/[Not Qualified]) -> [Pool] via the engine.
		if _, err := s.Engine.Transition(ctx, tx, statemachine.Request{
			Machine:      statemachine.MLeadRecord,
			EntityType:   "lead",
			Table:        "leads",
			StatusColumn: "record_status",
			EntityID:     dec.ReopenLeadID,
			To:           module1_leads.StatusPool,
			Actor:        actor,
		}); err != nil {
			return leadAction{}, err
		}
		if err := audit.Write(ctx, tx, audit.Record{
			EntityType: "lead", EntityID: dec.ReopenLeadID, Actor: actor.EmployeeID,
			Action: "import:lead",
			After:  map[string]any{"row_index": index, "source": row.Sumber, "outcome": "reopen"},
		}); err != nil {
			return leadAction{}, err
		}
		return leadAction{Action: "reopen", LeadID: dec.ReopenLeadID}, nil

	default: // OutcomeCreate
		return s.createLead(ctx, tx, actor, row, phoneNorm, index)
	}
}

// createLead mints a LEAD- and births it at its mapped record_status (a
// birth-insert of the initial status is allowed; later moves go through the
// engine — same pattern as module1_leads.Register). When the lead is being
// worked and carries a holding salesperson, a PRSP- attempt is minted for
// provenance so the lead reads as actively owned.
func (s *Service) createLead(ctx context.Context, tx *sql.Tx, actor permission.Actor, row LeadRow, phoneNorm string, index int) (leadAction, error) {
	status, _ := mapLeadStatus(row.StatusTerakhir) // validated already
	leadID, err := ident.Next(ctx, tx, "LEAD", time.Now())
	if err != nil {
		return leadAction{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO leads (id, lead_name, phone_number, phone_norm, email, source, origin_division, record_status, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		leadID, row.NamaLead, row.NoTelepon, phoneNorm, nullStr(row.Email), row.Sumber,
		module1_leads.SalesDivision, status, actor.EmployeeID); err != nil {
		return leadAction{}, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "lead", EntityID: leadID, Actor: actor.EmployeeID,
		Action: "import:lead",
		After: map[string]any{
			"row_index": index, "source": row.Sumber, "record_status": status, "outcome": "create",
		},
	}); err != nil {
		return leadAction{}, err
	}

	// Attach a provenance attempt for an in-process, owned lead.
	if status == module1_leads.StatusActive && row.SalesPemegang != "" {
		attemptID, err := ident.Next(ctx, tx, "PRSP", time.Now())
		if err != nil {
			return leadAction{}, err
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO prospect_attempts (id, lead_id, owner_employee_id, status, created_by) VALUES (?, ?, ?, ?, ?)`,
			attemptID, leadID, row.SalesPemegang, module1_leads.AttemptNewLead, actor.EmployeeID); err != nil {
			return leadAction{}, err
		}
		if err := audit.Write(ctx, tx, audit.Record{
			EntityType: "prospect_attempt", EntityID: attemptID, Actor: actor.EmployeeID,
			Action: "import:lead_attempt",
			After:  map[string]any{"row_index": index, "owner": row.SalesPemegang, "lead_id": leadID},
		}); err != nil {
			return leadAction{}, err
		}
	}
	return leadAction{Action: "create", LeadID: leadID}, nil
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
