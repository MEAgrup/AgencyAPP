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
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
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

// terminalAttemptStatuses is the set NOT treated as "in-process" for dedup: an
// attempt in any of these no longer marks the lead as being actively worked
// (M1 §5 Rule 4).
var terminalAttemptStatuses = map[string]bool{
	"Not Qualified":              true,
	"Closed-Success":             true,
	"Closed-Lost":                true,
	"Blocked":                    true,
	"[Closed - Kalah Kompetisi]": true,
}

// IsTerminalAttemptStatus reports whether an attempt status is terminal (does
// not mark a lead as being actively worked). Exported so the importer shares
// one source of truth instead of mirroring the set (DECISIONS O19).
func IsTerminalAttemptStatus(status string) bool {
	return terminalAttemptStatuses[status]
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
	// Catalog emits the co-pursuit notification on OutcomeJoin. Every real
	// constructor (httpapi, tests) wires it; the emission is nil-guarded only so
	// a future mis-wiring degrades to "no notification" instead of a panic.
	Catalog *notification.Catalog
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
	// CampaignID optionally links the intake to a Campaign (CMP-, M3). When set,
	// the campaign gate (O13 auto-activate/block) runs, Source is auto-derived
	// from the Campaign Channel (overriding Source above), and origin/last-touch
	// linkage is written (campaign_link.go). Empty = no campaign (Source used
	// as-is, origin/last-touch left NULL).
	CampaignID string
}

func (in RegisterInput) valid() bool {
	return in.LeadName != "" && in.PhoneNumber != "" && in.Source != ""
}

// Register is Sales single registration of a scouted lead (M1 §4, dedup v2). It
// runs the dedup door and either creates a fresh active LEAD + PRSP, reopens a
// terminal record and attaches an attempt, joins an already-worked lead as a
// co-pursuit (attaching an attempt without touching record_status), or blocks
// with the verbatim BI message.
//
// The returned notice is a NON-error Bahasa Indonesia message; it is set only
// on a co-pursuit join with other active owners (MsgLeadCoWorked) and empty
// otherwise.
func (s *Service) Register(ctx context.Context, actor permission.Actor, in RegisterInput) (Lead, Attempt, string, error) {
	if !in.valid() {
		return Lead{}, Attempt{}, "", ErrIncomplete
	}
	phoneNorm := NormalizePhone(in.PhoneNumber)

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Lead{}, Attempt{}, "", err
	}
	defer tx.Rollback()

	// Campaign gate + Source auto-set (M3 §2 / O13). Runs BEFORE any lead write so
	// a missing/closed Campaign rejects the registration cleanly; on success it
	// returns the Channel-derived Source (which WINS over in.Source).
	source := in.Source
	if in.CampaignID != "" {
		derived, err := s.resolveCampaignForIntake(ctx, tx, in.CampaignID, actor)
		if err != nil {
			return Lead{}, Attempt{}, "", err
		}
		source = derived
	}

	match, err := MatchByPhone(ctx, tx, phoneNorm)
	if err != nil {
		return Lead{}, Attempt{}, "", err
	}
	decision := Decide(ChannelSingleReg, match, actor.EmployeeID)

	switch decision.Outcome {
	case OutcomeBlock:
		// Audit the blocked attempt on the matched record (M1 §5 Rule 6).
		if match != nil {
			_ = audit.Write(ctx, tx, audit.Record{
				EntityType: "lead", EntityID: match.ID, Actor: actor.EmployeeID,
				Action: "dedup_blocked", After: map[string]any{"channel": "single_reg", "message": decision.Message},
			})
			// M1 §5: a block-as-Pool-duplicate under a Campaign still records the
			// newer Campaign as Last-Touch (non-destructive; origin untouched).
			if in.CampaignID != "" && decision.Message == MsgDuplicatePool {
				if err := s.updateLastTouch(ctx, tx, match.ID, in.CampaignID, actor); err != nil {
					return Lead{}, Attempt{}, "", err
				}
			}
			_ = tx.Commit()
		}
		return Lead{}, Attempt{}, "", &ErrBlocked{Message: decision.Message}

	case OutcomeReopen:
		// Terminal -> [Pool] -> active, then attach this salesperson's attempt.
		if err := s.transition(ctx, tx, decision.ReopenLeadID, RecordPool, actor); err != nil {
			return Lead{}, Attempt{}, "", err
		}
		if err := s.transition(ctx, tx, decision.ReopenLeadID, RecordActive, actor); err != nil {
			return Lead{}, Attempt{}, "", err
		}
		// M1 §5: a campaign-scoped reopen touches the existing lead -> last-touch.
		if err := s.updateLastTouch(ctx, tx, decision.ReopenLeadID, in.CampaignID, actor); err != nil {
			return Lead{}, Attempt{}, "", err
		}
		att, err := s.insertAttempt(ctx, tx, decision.ReopenLeadID, actor)
		if err != nil {
			return Lead{}, Attempt{}, "", err
		}
		lead, err := s.loadLead(ctx, tx, decision.ReopenLeadID)
		if err != nil {
			return Lead{}, Attempt{}, "", err
		}
		if err := tx.Commit(); err != nil {
			return Lead{}, Attempt{}, "", err
		}
		return lead, att, "", nil

	case OutcomeJoin:
		// Co-pursuit: attach a new attempt to the existing lead WITHOUT any
		// record_status transition (the lead stays active; house rule: status
		// only ever moves through the transition engine, never here).
		att, err := s.insertAttempt(ctx, tx, decision.JoinLeadID, actor)
		if err != nil {
			return Lead{}, Attempt{}, "", err
		}
		if err := audit.Write(ctx, tx, audit.Record{
			EntityType: "lead", EntityID: decision.JoinLeadID, Actor: actor.EmployeeID,
			Action: "dedup_join",
			After:  map[string]any{"channel": "single_reg", "attempt_id": att.ID, "co_owners": decision.CoOwners},
		}); err != nil {
			return Lead{}, Attempt{}, "", err
		}
		// M1 §5: a campaign-scoped co-pursuit touches the existing lead -> last-touch.
		if err := s.updateLastTouch(ctx, tx, decision.JoinLeadID, in.CampaignID, actor); err != nil {
			return Lead{}, Attempt{}, "", err
		}
		notice := ""
		if len(decision.CoOwners) > 0 {
			// Notify the other active owners AND the registrant (NotifyActor).
			if s.Catalog != nil {
				recipients := append(append([]string{}, decision.CoOwners...), actor.EmployeeID)
				if _, err := s.Catalog.Emit(ctx, tx, notification.Emission{
					Event:              notification.EvLeadCoPursuit,
					EntityType:         "lead",
					EntityID:           decision.JoinLeadID,
					Actor:              actor.EmployeeID,
					ExplicitRecipients: recipients,
					NotifyActor:        true,
				}); err != nil {
					return Lead{}, Attempt{}, "", err
				}
			}
			notice = MsgLeadCoWorked
		}
		lead, err := s.loadLead(ctx, tx, decision.JoinLeadID)
		if err != nil {
			return Lead{}, Attempt{}, "", err
		}
		if err := tx.Commit(); err != nil {
			return Lead{}, Attempt{}, "", err
		}
		return lead, att, notice, nil

	default: // OutcomeCreate
		leadID, err := ident.Next(ctx, tx, "LEAD", time.Now())
		if err != nil {
			return Lead{}, Attempt{}, "", err
		}
		// A NEW lead born under a Campaign gets origin = last-touch = that Campaign
		// (origin is IMMUTABLE hereafter); both NULL when no campaign (M1 §5 / §9.3).
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO leads (id, lead_name, phone_number, phone_norm, email, source, origin_division, origin_campaign_id, last_touch_campaign_id, record_status, created_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			leadID, in.LeadName, in.PhoneNumber, phoneNorm, nullString(in.Email), source, SalesDivision,
			campaignArg(in.CampaignID), campaignArg(in.CampaignID), RecordActive, actor.EmployeeID); err != nil {
			return Lead{}, Attempt{}, "", err
		}
		if err := audit.Write(ctx, tx, audit.Record{
			EntityType: "lead", EntityID: leadID, Actor: actor.EmployeeID,
			Action: "create", After: map[string]any{"record_status": RecordActive, "source": source, "origin_campaign_id": campaignArg(in.CampaignID)},
		}); err != nil {
			return Lead{}, Attempt{}, "", err
		}
		att, err := s.insertAttempt(ctx, tx, leadID, actor)
		if err != nil {
			return Lead{}, Attempt{}, "", err
		}
		if err := tx.Commit(); err != nil {
			return Lead{}, Attempt{}, "", err
		}
		return Lead{ID: leadID, LeadName: in.LeadName, PhoneNumber: in.PhoneNumber, Source: source, RecordStatus: RecordActive}, att, "", nil
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

// Querier is the read surface MatchByPhone needs; satisfied by *sql.Tx and
// *sql.DB (and thus reusable by the importer's dry-run/apply transactions, O19).
type Querier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// MatchByPhone returns the most-recent lead matching phoneNorm (or nil), with
// EVERY open (non-terminal) attempt currently on it.
//
// O19: employees is LEFT JOINed and the owner name COALESCEd to the raw
// employee id, so an attempt owned by an employee not yet synced from HRIS is
// still counted for dedup — the previous INNER JOIN silently dropped such an
// attempt, a latent bug that could let a duplicate slip past the door.
func MatchByPhone(ctx context.Context, q Querier, phoneNorm string) (*ExistingLead, error) {
	if phoneNorm == "" {
		return nil, nil
	}
	var m ExistingLead
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
		`SELECT pa.owner_employee_id, COALESCE(e.nama, pa.owner_employee_id), pa.status
		   FROM prospect_attempts pa
		   LEFT JOIN employees e ON e.employee_id = pa.owner_employee_id
		  WHERE pa.lead_id = ?`, m.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var ownerID, ownerName, status string
		if err := rows.Scan(&ownerID, &ownerName, &status); err != nil {
			return nil, err
		}
		if !IsTerminalAttemptStatus(status) {
			m.OpenAttempts = append(m.OpenAttempts, OpenAttempt{OwnerEmployeeID: ownerID, OwnerName: ownerName})
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
