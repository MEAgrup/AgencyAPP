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

// terminalAttemptStatuses is the set of prospect-attempt statuses that are NOT
// "in-process": an attempt in any of these does not mark the lead as being
// actively worked (M1 §5 Rule 4). Kept internal; query via IsTerminalAttempt.
var terminalAttemptStatuses = map[string]bool{
	"Not Qualified":              true,
	"Closed-Success":             true,
	"Closed-Lost":                true,
	"Blocked":                    true,
	"[Closed - Kalah Kompetisi]": true,
}

// IsTerminalAttempt reports whether a prospect-attempt status is terminal (not
// in-process). Exported so the importer shares one source of truth (O19).
func IsTerminalAttempt(status string) bool {
	return terminalAttemptStatuses[status]
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
	Catalog *notification.Catalog // required for the M1 v2 collaborative-join notification
}

// JoinInfo is the inline notice returned to the registrant when their single
// registration JOINS a lead already worked by other salespeople (M1 v2). It is
// non-nil only when at least one other salesperson is pursuing the lead.
type JoinInfo struct {
	Message    string   `json:"message"`     // MsgCollabJoin
	OtherSales []string `json:"other_sales"` // display names of the other owners
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

// Register is Sales single registration of a scouted lead (M1 §4, M1 v2). It
// runs the collaborative dedup door and either creates a fresh active LEAD +
// PRSP, reopens a terminal record and attaches an attempt, JOINS an existing
// lead already worked by others (notifying them), or blocks with the verbatim
// BI message. The returned *JoinInfo is non-nil only on a JOIN with other
// owners; it carries the inline notice for the registrant.
func (s *Service) Register(ctx context.Context, actor permission.Actor, in RegisterInput) (Lead, Attempt, *JoinInfo, error) {
	if !in.valid() {
		return Lead{}, Attempt{}, nil, ErrIncomplete
	}
	phoneNorm := NormalizePhone(in.PhoneNumber)

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Lead{}, Attempt{}, nil, err
	}
	defer tx.Rollback()

	match, err := MatchByPhone(ctx, tx, phoneNorm)
	if err != nil {
		return Lead{}, Attempt{}, nil, err
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
			_ = tx.Commit()
		}
		return Lead{}, Attempt{}, nil, &ErrBlocked{Message: decision.Message}

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

	case OutcomeJoin:
		// M1 v2 — attach a collaborative attempt to the matched lead. No status
		// write on the lead; every salesperson pursuing it is recorded.
		leadID := decision.JoinLeadID
		att, err := s.insertAttempt(ctx, tx, leadID, actor)
		if err != nil {
			return Lead{}, Attempt{}, nil, err
		}
		others := uniqueOwners(decision.OtherOwners)
		otherIDs := make([]string, 0, len(others))
		for _, o := range others {
			otherIDs = append(otherIDs, o.OwnerID)
		}
		if err := audit.Write(ctx, tx, audit.Record{
			EntityType: "lead", EntityID: leadID, Actor: actor.EmployeeID,
			Action: "dedup_join",
			After: map[string]any{
				"channel": "single_reg", "attempt_id": att.ID,
				"owner": actor.EmployeeID, "other_owners": otherIDs,
			},
		}); err != nil {
			return Lead{}, Attempt{}, nil, err
		}
		var join *JoinInfo
		if len(decision.OtherOwners) > 0 {
			// Notification registration is a house rule — the catalog is required.
			if s.Catalog == nil {
				return Lead{}, Attempt{}, nil, errors.New("module1_leads: notification.Catalog is required for a collaborative join")
			}
			// Notify ONLY the other open-attempt owners (explicit resolver); the
			// registrant learns via JoinInfo, not a self-notification.
			if _, err := s.Catalog.Emit(ctx, tx, notification.Emission{
				Event:              notification.EvLeadCollabAttempt,
				EntityType:         "lead",
				EntityID:           leadID,
				Actor:              actor.EmployeeID,
				Division:           SalesDivision,
				ExplicitRecipients: otherIDs,
			}); err != nil {
				return Lead{}, Attempt{}, nil, err
			}
			names := make([]string, 0, len(others))
			for _, o := range others {
				names = append(names, o.OwnerName)
			}
			join = &JoinInfo{Message: decision.Message, OtherSales: names}
		}
		lead, err := s.loadLead(ctx, tx, leadID)
		if err != nil {
			return Lead{}, Attempt{}, nil, err
		}
		if err := tx.Commit(); err != nil {
			return Lead{}, Attempt{}, nil, err
		}
		return lead, att, join, nil

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

// uniqueOwners collapses duplicate owner ids (a lead can carry several attempts)
// to one OpenAttempt per owner, preserving order.
func uniqueOwners(owners []OpenAttempt) []OpenAttempt {
	seen := map[string]bool{}
	out := make([]OpenAttempt, 0, len(owners))
	for _, o := range owners {
		if o.OwnerID == "" || seen[o.OwnerID] {
			continue
		}
		seen[o.OwnerID] = true
		out = append(out, o)
	}
	return out
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
// *sql.DB, so both live Register and the importer share one match query (O19).
type Querier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// MatchByPhone returns the most-recent lead matching phoneNorm (or nil), with
// its record status and EVERY open (non-terminal) attempt on it.
//
// O19 resolution (DECISIONS 2026-07-16): the attempt query LEFT JOINs employees
// (name falls back to the raw owner_employee_id) so an attempt owned by an
// employee not yet HRIS-synced is NEVER dropped from dedup — the collaborative
// model must record ALL salespeople. Attempts are collected in full, ordered by
// pa.id for determinism (no early break).
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
		  WHERE pa.lead_id = ?
		  ORDER BY pa.id`, m.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var ownerID, name, status string
		if err := rows.Scan(&ownerID, &name, &status); err != nil {
			return nil, err
		}
		if !IsTerminalAttempt(status) {
			m.OpenAttempts = append(m.OpenAttempts, OpenAttempt{OwnerID: ownerID, OwnerName: name})
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
