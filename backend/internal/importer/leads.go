package importer

// leads.go lands existing leads through the Module 1 dedup engine (Permintaan #3
// path 1). It reuses the exported dedup DECISION (module1_leads.Decide) and phone
// NORMALIZATION; only the phone-match SELECT is replicated here because
// module1_leads.matchByPhone (and its terminal-attempt set) are unexported and
// that package must not be edited (flagged for the orchestrator). The match query
// LEFT JOINs employees so a still-active attempt is detected even when the owning
// employee has not yet synced from HRIS.

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

// terminalAttempt mirrors module1_leads.terminalAttemptStatuses (unexported): an
// attempt in any of these does NOT mark the lead as being actively worked.
var terminalAttempt = map[string]bool{
	"Not Qualified":              true,
	"Closed-Success":             true,
	"Closed-Lost":                true,
	"Blocked":                    true,
	"[Closed - Kalah Kompetisi]": true,
}

// leadAction is the applied dedup outcome for one row.
type leadAction struct {
	Action  string // "create" | "reopen" | "block"
	LeadID  string // created or reopened id
	Message string // BI block message (Action == "block")
}

// rowQuerier is satisfied by *sql.Tx (read side of the match).
type rowQuerier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// matchLead finds the most-recent lead on the normalized phone and whether it is
// actively worked (for the owner-name interpolation), mirroring the M1 dedup
// match. Returns nil when nothing matches.
func (s *Service) matchLead(ctx context.Context, q rowQuerier, phoneNorm string) (*module1_leads.ExistingLead, error) {
	if phoneNorm == "" {
		return nil, nil
	}
	var m module1_leads.ExistingLead
	err := q.QueryRowContext(ctx,
		`SELECT id, record_status FROM leads WHERE phone_norm = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
		phoneNorm).Scan(&m.ID, &m.RecordStatus)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := q.QueryContext(ctx,
		`SELECT COALESCE(e.nama, pa.owner_employee_id), pa.status
		   FROM prospect_attempts pa
		   LEFT JOIN employees e ON e.employee_id = pa.owner_employee_id
		  WHERE pa.lead_id = ?`, m.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var name, status string
		if err := rows.Scan(&name, &status); err != nil {
			return nil, err
		}
		if !terminalAttempt[status] {
			m.HasActiveScoutedAttempt = true
			m.ActiveOwnerName = name
			break
		}
	}
	return &m, rows.Err()
}

// applyLeadTx runs the dedup door for one lead inside tx and performs the write
// for create/reopen (block writes only an audit-provenance row). It does NOT
// commit — the caller (per-row tx in Apply, shared savepoint tx in DryRun) owns
// the transaction lifecycle. Row must already have passed validateLeadRow.
func (s *Service) applyLeadTx(ctx context.Context, tx *sql.Tx, actor permission.Actor, row LeadRow, index int) (leadAction, error) {
	phoneNorm := module1_leads.NormalizePhone(row.NoTelepon)
	match, err := s.matchLead(ctx, tx, phoneNorm)
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
