// LEAD / PRSP persistence for Module 1 (W1-01 registration door, W1-03 claim).
// Applies the pure dedup decision (dedup.go) inside a transaction, generating
// LEAD-/PRSP- ids only after validation passes and routing every status change
// through the state-machine engine (house rule: no raw status writes).
package module1_leads

import (
	"context"
	"database/sql"
	"errors"
	"strings"
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
	DB      *sql.DB
	Engine  *statemachine.Engine
	Catalog *notification.Catalog // may be nil (notifications become no-ops)
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

// JoinNotice is the informational (non-error) result of a collaborative Join:
// the sales registration attached a new attempt to a lead already worked by
// other salespeople (DECISIONS 2026-07-10). Message carries the BI text shown to
// the registrant; NotifiedOwners are the other active owners that were notified.
// It is nil for a fresh create or a reopen (no collaboration).
type JoinNotice struct {
	Message        string   `json:"message"`
	NotifiedOwners []string `json:"notified_owners"`
}

// Register is Sales single registration of a lead (M1 §4). It runs the dedup
// door (collaborative for this channel, DECISIONS 2026-07-10) and either creates
// a fresh active LEAD + PRSP, reopens a terminal record and attaches an attempt,
// JOINs an existing in-process lead (attaching this registrant's attempt +
// notifying the other owners), or blocks (only when the lead is already a
// client). A non-nil *JoinNotice is returned only for the Join outcome.
func (s *Service) Register(ctx context.Context, actor permission.Actor, in RegisterInput) (Lead, Attempt, *JoinNotice, error) {
	if !in.valid() {
		return Lead{}, Attempt{}, nil, ErrIncomplete
	}
	phoneNorm := NormalizePhone(in.PhoneNumber)

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Lead{}, Attempt{}, nil, err
	}
	defer tx.Rollback()

	match, err := s.matchByPhone(ctx, tx, phoneNorm)
	if err != nil {
		return Lead{}, Attempt{}, nil, err
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
		return Lead{}, Attempt{}, nil, &ErrBlocked{Message: decision.Message}

	case OutcomeJoin:
		return s.registerJoin(ctx, tx, actor, match, decision.JoinLeadID)

	case OutcomeReopen:
		// Terminal -> [Pool] -> active, then attach this salesperson's attempt.
		if err := s.transition(ctx, tx, decision.ReopenLeadID, RecordPool, actor); err != nil {
			return Lead{}, Attempt{}, nil, err
		}
		if err := s.transition(ctx, tx, decision.ReopenLeadID, RecordActive, actor); err != nil {
			return Lead{}, Attempt{}, nil, err
		}
		att, err := s.insertAttempt(ctx, tx, decision.ReopenLeadID, actor)
		if err != nil {
			return Lead{}, Attempt{}, nil, err
		}
		lead, err := s.loadLead(ctx, tx, decision.ReopenLeadID)
		if err != nil {
			return Lead{}, Attempt{}, nil, err
		}
		if err := tx.Commit(); err != nil {
			return Lead{}, Attempt{}, nil, err
		}
		return lead, att, nil, nil

	default: // OutcomeCreate
		leadID, err := ident.Next(ctx, tx, "LEAD", time.Now())
		if err != nil {
			return Lead{}, Attempt{}, nil, err
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO leads (id, lead_name, phone_number, phone_norm, email, source, origin_division, record_status, created_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			leadID, in.LeadName, in.PhoneNumber, phoneNorm, nullString(in.Email), in.Source, SalesDivision, RecordActive, actor.EmployeeID); err != nil {
			return Lead{}, Attempt{}, nil, err
		}
		if err := audit.Write(ctx, tx, audit.Record{
			EntityType: "lead", EntityID: leadID, Actor: actor.EmployeeID,
			Action: "create", After: map[string]any{"record_status": RecordActive, "source": in.Source},
		}); err != nil {
			return Lead{}, Attempt{}, nil, err
		}
		att, err := s.insertAttempt(ctx, tx, leadID, actor)
		if err != nil {
			return Lead{}, Attempt{}, nil, err
		}
		if err := tx.Commit(); err != nil {
			return Lead{}, Attempt{}, nil, err
		}
		return Lead{ID: leadID, LeadName: in.LeadName, PhoneNumber: in.PhoneNumber, Source: in.Source, RecordStatus: RecordActive}, att, nil, nil
	}
}

// registerJoin attaches this registrant's attempt to an existing in-process lead
// (collaborative dedup, DECISIONS 2026-07-10), notifies the OTHER active owners,
// and audits the join. The record status is left untouched (no reopen, no new
// lead): multiple active attempts coexist on the one Lead record, exactly as a
// competitive Pool claim (M1 §6). The same-salesperson guard (a registrant who
// already has an open attempt on this lead) rejects with ErrAlreadyPursuing,
// consistent with ClaimFromPool.
func (s *Service) registerJoin(ctx context.Context, tx *sql.Tx, actor permission.Actor, match *ExistingLead, leadID string) (Lead, Attempt, *JoinNotice, error) {
	for _, o := range match.ActiveOwners {
		if o.EmployeeID == actor.EmployeeID {
			return Lead{}, Attempt{}, nil, ErrAlreadyPursuing
		}
	}
	others := otherOwners(match.ActiveOwners, actor.EmployeeID)

	att, err := s.insertAttempt(ctx, tx, leadID, actor)
	if err != nil {
		return Lead{}, Attempt{}, nil, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "lead", EntityID: leadID, Actor: actor.EmployeeID,
		Action: "dedup_join",
		Before: map[string]any{"active_owners": ownerIDs(match.ActiveOwners)},
		After: map[string]any{
			"channel": "single_reg", "attempt_id": att.ID, "notified_owners": ownerIDs(others),
		},
	}); err != nil {
		return Lead{}, Attempt{}, nil, err
	}
	// Notify every OTHER active owner that the lead is also being worked (derived
	// from the audit event above, per the notification convention).
	if s.Catalog != nil && len(others) > 0 {
		if _, err := s.Catalog.Emit(ctx, tx, notification.Emission{
			Event: notification.EvLeadAlsoPursued, EntityType: "lead", EntityID: leadID,
			Actor: actor.EmployeeID, ExplicitRecipients: ownerIDs(others),
		}); err != nil {
			return Lead{}, Attempt{}, nil, err
		}
	}
	lead, err := s.loadLead(ctx, tx, leadID)
	if err != nil {
		return Lead{}, Attempt{}, nil, err
	}
	if err := tx.Commit(); err != nil {
		return Lead{}, Attempt{}, nil, err
	}
	return lead, att, joinNotice(others), nil
}

// otherOwners returns the active owners other than the registrant.
func otherOwners(owners []ActiveOwner, exclude string) []ActiveOwner {
	out := make([]ActiveOwner, 0, len(owners))
	for _, o := range owners {
		if o.EmployeeID != exclude {
			out = append(out, o)
		}
	}
	return out
}

func ownerIDs(owners []ActiveOwner) []string {
	out := make([]string, 0, len(owners))
	for _, o := range owners {
		out = append(out, o.EmployeeID)
	}
	return out
}

func ownerNames(owners []ActiveOwner) []string {
	out := make([]string, 0, len(owners))
	for _, o := range owners {
		out = append(out, o.Name)
	}
	return out
}

// joinNotice builds the informational Join result. When there are other owners
// the BI message interpolates their (comma-separated) names; with none it is a
// silent join (pure Pool claim) carrying an empty message.
func joinNotice(others []ActiveOwner) *JoinNotice {
	n := &JoinNotice{NotifiedOwners: ownerIDs(others)}
	if len(others) > 0 {
		n.Message = interpolateOwner(MsgAlsoWorkedByOthers, strings.Join(ownerNames(others), ", "))
	}
	return n
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
	// Every in-process (non-terminal) attempt marks the lead as being worked and
	// contributes an ActiveOwner (for the collaborative Join message + notify).
	// LEFT JOIN (DECISIONS O19, resolved 2026-07-16): an attempt owned by an
	// employee not yet synced from HRIS must NOT vanish from dedup — the owner
	// name falls back to owner_employee_id when the employees row is absent.
	rows, err := tx.QueryContext(ctx,
		`SELECT pa.owner_employee_id, e.nama, pa.status
		   FROM prospect_attempts pa
		   LEFT JOIN employees e ON e.employee_id = pa.owner_employee_id
		  WHERE pa.lead_id = ?`, m.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var ownerID, status string
		var name sql.NullString
		if err := rows.Scan(&ownerID, &name, &status); err != nil {
			return nil, err
		}
		if terminalAttemptStatuses[status] {
			continue
		}
		display := ownerID
		if name.Valid && name.String != "" {
			display = name.String
		}
		if !m.HasActiveScoutedAttempt {
			m.HasActiveScoutedAttempt = true
			m.ActiveOwnerName = display
		}
		m.ActiveOwners = append(m.ActiveOwners, ActiveOwner{EmployeeID: ownerID, Name: display})
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
