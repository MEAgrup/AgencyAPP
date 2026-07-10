// LEAD / PRSP persistence for Module 1 (W1-01 registration door, W1-03 claim).
// Applies the pure dedup decision (dedup.go) inside a transaction, generating
// LEAD-/PRSP- ids only after validation passes and routing every status change
// through the state-machine engine (house rule: no raw status writes).
package module1_leads

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/ident"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// Lead record statuses (subset used at birth; lead_record machine governs moves).
const (
	RecordActive = "active"
	RecordPool   = "[Pool]"
)

// Prospect attempt birth status (post-validation; PRSP id minted here — §1.2).
const AttemptNewLead = "New Lead"

// SalesDivision is the CDPS division that owns scouted leads / attempts.
const SalesDivision = "Sales"

// openAttemptStatuses is the set treated as "in-process" for dedup: an attempt
// in any of these blocks a new external intake (M1 §5 Rule 4).
var terminalAttemptStatuses = map[string]bool{
	"Not Qualified":              true,
	"Closed-Success":             true,
	"Closed-Lost":                true,
	"Blocked":                    true,
	"[Closed - Kalah Kompetisi]": true,
}

// ErrIncomplete is the mandatory-field gate for a single registration.
var ErrIncomplete = errors.New(MsgSingleIncomplete)

// ErrBlocked wraps a dedup block with its verbatim BI message.
type ErrBlocked struct{ Message string }

func (e *ErrBlocked) Error() string { return e.Message }

// Service is the M1 persistence surface.
type Service struct {
	DB     *sql.DB
	Engine *statemachine.Engine
}

// Lead is a lead record row (subset).
type Lead struct {
	ID           string `json:"id"`
	LeadName     string `json:"lead_name"`
	PhoneNumber  string `json:"phone_number"`
	Source       string `json:"source"`
	RecordStatus string `json:"record_status"`
}

// Attempt is a prospect attempt row (subset).
type Attempt struct {
	ID     string `json:"id"`
	LeadID string `json:"lead_id"`
	Owner  string `json:"owner_employee_id"`
	Status string `json:"status"`
}

// RegisterInput carries the Sales single-registration fields.
type RegisterInput struct {
	LeadName    string
	PhoneNumber string
	Email       string
	Source      string
}

func (in RegisterInput) valid() bool {
	return in.LeadName != "" && in.PhoneNumber != "" && in.Source != ""
}

// Register is Sales single registration of a scouted lead (M1 §4). It runs the
// dedup door and either creates a fresh active LEAD + PRSP, reopens a terminal
// record and attaches an attempt, or blocks with the verbatim BI message.
func (s *Service) Register(ctx context.Context, actor permission.Actor, in RegisterInput) (Lead, Attempt, error) {
	if !in.valid() {
		return Lead{}, Attempt{}, ErrIncomplete
	}
	phoneNorm := NormalizePhone(in.PhoneNumber)

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Lead{}, Attempt{}, err
	}
	defer tx.Rollback()

	match, err := s.matchByPhone(ctx, tx, phoneNorm)
	if err != nil {
		return Lead{}, Attempt{}, err
	}
	decision := Decide(ChannelSingleReg, match)

	switch decision.Outcome {
	case OutcomeBlock:
		// Audit the blocked attempt on the matched record (M1 §5 Rule 6).
		if match != nil {
			_ = audit.Write(ctx, tx, audit.Record{
				EntityType: "lead", EntityID: match.ID, Actor: actor.EmployeeID,
				Action: "dedup_blocked", After: map[string]any{"channel": "single_reg", "message": decision.Message},
			})
			_ = tx.Commit()
		}
		return Lead{}, Attempt{}, &ErrBlocked{Message: decision.Message}

	case OutcomeReopen:
		// Terminal -> [Pool] -> active, then attach this salesperson's attempt.
		if err := s.transition(ctx, tx, decision.ReopenLeadID, RecordPool, actor); err != nil {
			return Lead{}, Attempt{}, err
		}
		if err := s.transition(ctx, tx, decision.ReopenLeadID, RecordActive, actor); err != nil {
			return Lead{}, Attempt{}, err
		}
		att, err := s.insertAttempt(ctx, tx, decision.ReopenLeadID, actor)
		if err != nil {
			return Lead{}, Attempt{}, err
		}
		lead, err := s.loadLead(ctx, tx, decision.ReopenLeadID)
		if err != nil {
			return Lead{}, Attempt{}, err
		}
		if err := tx.Commit(); err != nil {
			return Lead{}, Attempt{}, err
		}
		return lead, att, nil

	default: // OutcomeCreate
		leadID, err := ident.Next(ctx, tx, "LEAD", time.Now())
		if err != nil {
			return Lead{}, Attempt{}, err
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO leads (id, lead_name, phone_number, phone_norm, email, source, origin_division, record_status, created_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			leadID, in.LeadName, in.PhoneNumber, phoneNorm, nullString(in.Email), in.Source, SalesDivision, RecordActive, actor.EmployeeID); err != nil {
			return Lead{}, Attempt{}, err
		}
		if err := audit.Write(ctx, tx, audit.Record{
			EntityType: "lead", EntityID: leadID, Actor: actor.EmployeeID,
			Action: "create", After: map[string]any{"record_status": RecordActive, "source": in.Source},
		}); err != nil {
			return Lead{}, Attempt{}, err
		}
		att, err := s.insertAttempt(ctx, tx, leadID, actor)
		if err != nil {
			return Lead{}, Attempt{}, err
		}
		if err := tx.Commit(); err != nil {
			return Lead{}, Attempt{}, err
		}
		return Lead{ID: leadID, LeadName: in.LeadName, PhoneNumber: in.PhoneNumber, Source: in.Source, RecordStatus: RecordActive}, att, nil
	}
}

// insertAttempt mints a PRSP owned by actor at New Lead (post-validation).
func (s *Service) insertAttempt(ctx context.Context, tx *sql.Tx, leadID string, actor permission.Actor) (Attempt, error) {
	id, err := ident.Next(ctx, tx, "PRSP", time.Now())
	if err != nil {
		return Attempt{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO prospect_attempts (id, lead_id, owner_employee_id, status, created_by) VALUES (?, ?, ?, ?, ?)`,
		id, leadID, actor.EmployeeID, AttemptNewLead, actor.EmployeeID); err != nil {
		return Attempt{}, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "prospect_attempt", EntityID: id, Actor: actor.EmployeeID,
		Action: "create", After: map[string]any{"status": AttemptNewLead, "lead_id": leadID},
	}); err != nil {
		return Attempt{}, err
	}
	return Attempt{ID: id, LeadID: leadID, Owner: actor.EmployeeID, Status: AttemptNewLead}, nil
}

// transition drives the lead_record machine for a lead within tx.
func (s *Service) transition(ctx context.Context, tx *sql.Tx, leadID, to string, actor permission.Actor) error {
	_, err := s.Engine.Transition(ctx, tx, statemachine.Request{
		Machine:      statemachine.MLeadRecord,
		EntityType:   "lead",
		Table:        "leads",
		StatusColumn: "record_status",
		EntityID:     leadID,
		To:           to,
		Actor:        actor,
	})
	return err
}

// matchByPhone returns the most-recent lead matching phoneNorm (or nil), with
// its record status and whether an in-process attempt exists (+ owner name).
func (s *Service) matchByPhone(ctx context.Context, tx *sql.Tx, phoneNorm string) (*ExistingLead, error) {
	var m ExistingLead
	err := tx.QueryRowContext(ctx,
		`SELECT id, record_status FROM leads WHERE phone_norm = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
		phoneNorm).Scan(&m.ID, &m.RecordStatus)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	// Any in-process (non-terminal) attempt marks the lead as being worked.
	rows, err := tx.QueryContext(ctx,
		`SELECT e.nama, pa.status
		   FROM prospect_attempts pa
		   JOIN employees e ON e.employee_id = pa.owner_employee_id
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
		if !terminalAttemptStatuses[status] {
			m.HasActiveScoutedAttempt = true
			m.ActiveOwnerName = name
			break
		}
	}
	return &m, rows.Err()
}

func (s *Service) loadLead(ctx context.Context, tx *sql.Tx, id string) (Lead, error) {
	var l Lead
	var email sql.NullString
	err := tx.QueryRowContext(ctx,
		`SELECT id, lead_name, phone_number, email, source, record_status FROM leads WHERE id = ?`, id).
		Scan(&l.ID, &l.LeadName, &l.PhoneNumber, &email, &l.Source, &l.RecordStatus)
	return l, err
}

func nullString(s string) any {
	if s == "" {
		return nil
	}
	return s
}
