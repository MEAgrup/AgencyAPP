package importer

// leads.go lands existing leads through the Module 1 dedup engine (Permintaan #3
// path 1). It reuses the exported dedup DECISION (module1_leads.Decide) and phone
// NORMALIZATION; the local match-query mirror (terminalAttempt map, matchLead,
// rowQuerier) is GONE — O19 RESOLVED 2026-07-16 ruled the mirror's INNER JOIN
// drop-on-unsynced-employee behavior a defect, not an intended divergence, so
// there is no longer a reason to keep a second copy of the query. The importer
// now calls module1_leads.MatchByPhone directly: one official match query,
// LEFT JOIN employees, shared with live Register. An attempt owned by a
// not-yet-HRIS-synced employee is therefore VISIBLE to import dedup exactly as
// it is to live registration (owner name falls back to the raw employee id).
// Import-channel dedup outcomes (block/reopen/create) are otherwise UNCHANGED.

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
	match, err := module1_leads.MatchByPhone(ctx, tx, phoneNorm)
	if err != nil {
		return leadAction{}, err
	}
	// The import channel ignores the actor argument (decideImport never joins);
	// the importing Director never owns an attempt.
	dec := module1_leads.Decide(module1_leads.ChannelImport, match, actor.EmployeeID)

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
