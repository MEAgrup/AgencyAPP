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
	// Catalog emits the collaborative-join notification (D4). It may be nil for
	// consumers that don't need notifications (e.g. plain tests); emit is skipped
	// when nil so those consumers are not forced to wire a catalog.
	Catalog *notification.Catalog
}

// Querier is the minimal read surface MatchByPhone needs; satisfied by both
// *sql.Tx and *sql.DB so the importer (O19) can reuse the exact match logic.
type Querier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
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

// RegisterResult is the full outcome of a single registration (D7). Info carries
// the non-blocking collaborative message (MsgCollabJoined, interpolated) when the
// actor joined an existing lead; JoinedExisting flags that path.
type RegisterResult struct {
	Lead           Lead
	Attempt        Attempt
	JoinedExisting bool
	Info           string
}

// Register is Sales single registration of a scouted lead (M1 §4). It is a thin
// back-compat wrapper over RegisterWithResult, kept so existing callers that
// don't need the collaborative info (module0_sales flow / integration tests)
// compile unchanged. New callers should prefer RegisterWithResult.
func (s *Service) Register(ctx context.Context, actor permission.Actor, in RegisterInput) (Lead, Attempt, error) {
	res, err := s.RegisterWithResult(ctx, actor, in)
	return res.Lead, res.Attempt, err
}

// RegisterWithResult runs the collaborative dedup door (D2 ChannelSingleReg) and
// either creates a fresh active LEAD + PRSP, JOINS an existing lead with a
// parallel attempt (collaboration), reopens a terminal record and attaches an
// attempt, or blocks with the verbatim BI message. Every outcome is audit-logged
// (M1 §5 Rule 6).
func (s *Service) RegisterWithResult(ctx context.Context, actor permission.Actor, in RegisterInput) (RegisterResult, error) {
	if !in.valid() {
		return RegisterResult{}, ErrIncomplete
	}
	phoneNorm := NormalizePhone(in.PhoneNumber)

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return RegisterResult{}, err
	}
	defer tx.Rollback()

	match, err := MatchByPhone(ctx, tx, phoneNorm, actor.EmployeeID)
	if err != nil {
		return RegisterResult{}, err
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
		return RegisterResult{}, &ErrBlocked{Message: decision.Message}

	case OutcomeJoin:
		res, err := s.joinExisting(ctx, tx, decision.JoinLeadID, actor, match)
		if err != nil {
			return RegisterResult{}, err
		}
		if err := tx.Commit(); err != nil {
			return RegisterResult{}, err
		}
		return res, nil

	case OutcomeReopen:
		// Terminal -> [Pool] -> active, then attach this salesperson's attempt.
		if err := s.transition(ctx, tx, decision.ReopenLeadID, RecordPool, actor); err != nil {
			return RegisterResult{}, err
		}
		if err := s.transition(ctx, tx, decision.ReopenLeadID, RecordActive, actor); err != nil {
			return RegisterResult{}, err
		}
		att, err := s.insertAttempt(ctx, tx, decision.ReopenLeadID, actor)
		if err != nil {
			return RegisterResult{}, err
		}
		lead, err := s.loadLead(ctx, tx, decision.ReopenLeadID)
		if err != nil {
			return RegisterResult{}, err
		}
		if err := tx.Commit(); err != nil {
			return RegisterResult{}, err
		}
		return RegisterResult{Lead: lead, Attempt: att}, nil

	default: // OutcomeCreate
		leadID, err := ident.Next(ctx, tx, "LEAD", time.Now())
		if err != nil {
			return RegisterResult{}, err
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO leads (id, lead_name, phone_number, phone_norm, email, source, origin_division, record_status, created_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			leadID, in.LeadName, in.PhoneNumber, phoneNorm, nullString(in.Email), in.Source, SalesDivision, RecordActive, actor.EmployeeID); err != nil {
			return RegisterResult{}, err
		}
		if err := audit.Write(ctx, tx, audit.Record{
			EntityType: "lead", EntityID: leadID, Actor: actor.EmployeeID,
			Action: "create", After: map[string]any{"record_status": RecordActive, "source": in.Source},
		}); err != nil {
			return RegisterResult{}, err
		}
		att, err := s.insertAttempt(ctx, tx, leadID, actor)
		if err != nil {
			return RegisterResult{}, err
		}
		if err := tx.Commit(); err != nil {
			return RegisterResult{}, err
		}
		return RegisterResult{
			Lead: Lead{ID: leadID, LeadName: in.LeadName, PhoneNumber: in.PhoneNumber, Source: in.Source, RecordStatus: RecordActive},
			Attempt: att,
		}, nil
	}
}

// joinExisting attaches the actor's parallel attempt to an existing lead (D7
// collaborative join). It locks the lead row (as ClaimFromPool does) so parallel
// joins serialise, re-checks the double-open guard under the lock (the dedup door
// already blocks it, but the lock closes the race window), inserts the attempt,
// appends a collab_joined audit row, and notifies the existing non-terminal
// owners (D4) — record_status is NOT transitioned. The actor gets the collab
// message back as Info instead of a notification row.
func (s *Service) joinExisting(ctx context.Context, tx *sql.Tx, leadID string, actor permission.Actor, match *ExistingLead) (RegisterResult, error) {
	var exists string
	if err := tx.QueryRowContext(ctx, `SELECT id FROM leads WHERE id = ? FOR UPDATE`, leadID).Scan(&exists); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return RegisterResult{}, ErrLeadNotFound
		}
		return RegisterResult{}, err
	}
	open, err := s.actorHasOpenAttempt(ctx, tx, leadID, actor.EmployeeID)
	if err != nil {
		return RegisterResult{}, err
	}
	if open {
		return RegisterResult{}, &ErrBlocked{Message: MsgAlreadyOwnAttempt}
	}

	att, err := s.insertAttempt(ctx, tx, leadID, actor)
	if err != nil {
		return RegisterResult{}, err
	}

	// Existing collaborators to notify/audit: non-terminal owners other than the
	// joining actor (the actor has no attempt on this lead yet, but guard anyway).
	var recipients []string
	for _, o := range match.ActiveOwners {
		if o.EmployeeID != "" && o.EmployeeID != actor.EmployeeID {
			recipients = append(recipients, o.EmployeeID)
		}
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "lead", EntityID: leadID, Actor: actor.EmployeeID,
		Action: "collab_joined",
		After:  map[string]any{"joiner": actor.EmployeeID, "existing_owners": recipients},
	}); err != nil {
		return RegisterResult{}, err
	}
	if s.Catalog != nil && len(recipients) > 0 {
		if _, err := s.Catalog.Emit(ctx, tx, notification.Emission{
			Event: notification.EvCollabJoined, EntityType: "lead", EntityID: leadID,
			Actor: actor.EmployeeID, ExplicitRecipients: recipients,
		}); err != nil {
			return RegisterResult{}, err
		}
	}

	lead, err := s.loadLead(ctx, tx, leadID)
	if err != nil {
		return RegisterResult{}, err
	}
	// The collab info only applies when someone else is actually working the
	// lead; a solo join (pool-claim equivalent, no live attempt) carries none.
	info := ""
	if len(recipients) > 0 {
		info = interpolateOwner(MsgCollabJoined, match.ActiveOwnerName)
	}
	return RegisterResult{Lead: lead, Attempt: att, JoinedExisting: true, Info: info}, nil
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

// MatchByPhone returns the most-recent lead matching phoneNorm (or nil), with its
// record status and the full set of non-terminal attempt owners. actorEmployeeID
// lets the caller learn whether the registering salesperson already holds a live
// attempt (ActorHasActiveAttempt) — the pivot between "collaborate" and "block"
// in the single-reg door (D6).
//
// The owner query uses a LEFT JOIN employees (+ COALESCE on the name): an attempt
// whose owner has not yet been HRIS-synced STILL counts as active. Dedup must not
// hinge on sync timing (O19) — a lead being worked is a lead being worked whether
// or not its holder's employee row has landed. The name is simply empty for such
// owners, so the "(nama)" placeholder is left in the interpolated message.
func MatchByPhone(ctx context.Context, q Querier, phoneNorm, actorEmployeeID string) (*ExistingLead, error) {
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
		`SELECT pa.owner_employee_id, COALESCE(e.nama, ''), pa.status
		   FROM prospect_attempts pa
		   LEFT JOIN employees e ON e.employee_id = pa.owner_employee_id
		  WHERE pa.lead_id = ?`, m.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var ownerID, name, status string
		if err := rows.Scan(&ownerID, &name, &status); err != nil {
			return nil, err
		}
		if IsTerminalAttempt(status) {
			continue
		}
		m.ActiveOwners = append(m.ActiveOwners, AttemptOwner{EmployeeID: ownerID, Name: name})
		if ownerID == actorEmployeeID {
			m.ActorHasActiveAttempt = true
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Derived fields for low-churn legacy consumers (importer, older tests).
	m.HasActiveScoutedAttempt = len(m.ActiveOwners) > 0
	if m.HasActiveScoutedAttempt {
		m.ActiveOwnerName = m.ActiveOwners[0].Name
	}
	return &m, nil
}

// actorHasOpenAttempt reports whether employeeID already holds a non-terminal
// attempt on leadID. Shared by ClaimFromPool and the collaborative join guard so
// the "no double-open" rule (M1-OA-1) has a single implementation.
func (s *Service) actorHasOpenAttempt(ctx context.Context, tx *sql.Tx, leadID, employeeID string) (bool, error) {
	rows, err := tx.QueryContext(ctx,
		`SELECT status FROM prospect_attempts WHERE lead_id = ? AND owner_employee_id = ?`,
		leadID, employeeID)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var st string
		if err := rows.Scan(&st); err != nil {
			return false, err
		}
		if !IsTerminalAttempt(st) {
			return true, nil
		}
	}
	return false, rows.Err()
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
