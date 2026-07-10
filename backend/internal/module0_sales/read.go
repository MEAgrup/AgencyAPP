package sales

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

const selectAttemptCols = `prospect_id, lead_id, owner_employee_id, status, not_qualified_reason, contact_action_type, last_status_at, created_at, created_by`

func scanAttempt(row interface {
	Scan(dest ...any) error
}) (*Attempt, error) {
	var a Attempt
	var status string
	var notQualified, contactType sql.NullString
	if err := row.Scan(&a.ProspectID, &a.LeadID, &a.OwnerEmployeeID, &status, &notQualified, &contactType, &a.LastStatusAt, &a.CreatedAt, &a.CreatedBy); err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	a.Status = statemachine.Status(status)
	if notQualified.Valid {
		v := notQualified.String
		a.NotQualifiedReason = &v
	}
	if contactType.Valid {
		v := contactType.String
		a.ContactActionType = &v
	}
	return &a, nil
}

// loadAttempt reads one prospect_attempts row. Used internally by the write
// paths (to discover OwnerEmployeeID for the permission check) and by
// GetAttempt. Callers can errors.Is(err, ErrNotFound) when the id doesn't
// exist -- the sentinel is returned unwrapped so it survives errors.Is.
func loadAttempt(ctx context.Context, q db.Queryer, prospectID string) (*Attempt, error) {
	row := q.QueryRowContext(ctx, `SELECT `+selectAttemptCols+` FROM prospect_attempts WHERE prospect_id = ?`, prospectID)
	a, err := scanAttempt(row)
	if err == ErrNotFound {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("sales: load attempt %s: %w", prospectID, err)
	}
	return a, nil
}

// GetAttempt reads one Prospect attempt by id (workspace/detail view).
//
// Permission (M0 §7.1): Staff may read only an attempt they own; Head/SPV
// Sales read division-wide; OD read-only everywhere; Director full. An
// unauthenticated/unmapped identity is denied with the typed authz denial
// (errors.Is(err, authz.ErrDenied)).
func (s *Attempts) GetAttempt(ctx context.Context, q db.Queryer, actor authz.Identity, prospectID string) (*Attempt, error) {
	if !actor.Authenticated() {
		return nil, readDenied(actor)
	}
	att, err := loadAttempt(ctx, q, prospectID)
	if err != nil {
		return nil, err
	}
	if err := s.requireRead(actor, att.OwnerEmployeeID); err != nil {
		return nil, err
	}
	return att, nil
}

// ListByOwner lists every Prospect attempt owned by ownerEmployeeID (the
// salesperson workspace view).
//
// Permission: a Staff actor may only list their own workspace
// (ownerEmployeeID == actor.EmployeeID); Head/SPV Sales, OD, and Director may
// list any owner's workspace per the same division/read-only/full rules as
// GetAttempt.
func (s *Attempts) ListByOwner(ctx context.Context, q db.Queryer, actor authz.Identity, ownerEmployeeID string) ([]Attempt, error) {
	if !actor.Authenticated() {
		return nil, readDenied(actor)
	}
	if err := s.requireRead(actor, ownerEmployeeID); err != nil {
		return nil, err
	}
	rows, err := q.QueryContext(ctx, `SELECT `+selectAttemptCols+` FROM prospect_attempts WHERE owner_employee_id = ? ORDER BY created_at, prospect_id`, ownerEmployeeID)
	if err != nil {
		return nil, fmt.Errorf("sales: list by owner: %w", err)
	}
	defer rows.Close()
	return scanAttempts(rows)
}

// ListByLead lists every Prospect attempt against a single Lead record
// (surfaces contested/pool-claim competition, M1 §6).
//
// Permission: Head/SPV Sales, OD, and Director see every attempt on the
// lead (division-wide/read-only/full). A plain Staff actor sees only the
// attempt(s) they themselves own on that lead -- never a competitor's
// attempt -- per M0 §7.1 own-data-only; this is a filter, not a denial, so
// an owning Staff member still gets their own rows back.
func (s *Attempts) ListByLead(ctx context.Context, q db.Queryer, actor authz.Identity, leadID string) ([]Attempt, error) {
	if !actor.Authenticated() {
		return nil, readDenied(actor)
	}
	rows, err := q.QueryContext(ctx, `SELECT `+selectAttemptCols+` FROM prospect_attempts WHERE lead_id = ? ORDER BY created_at, prospect_id`, leadID)
	if err != nil {
		return nil, fmt.Errorf("sales: list by lead: %w", err)
	}
	defer rows.Close()
	all, err := scanAttempts(rows)
	if err != nil {
		return nil, err
	}

	// Division-wide/read-only/full roles (Head/SPV Sales, OD, Director) see
	// every attempt on the lead: probe with an owner-agnostic read request.
	if err := s.checker.Check(actor, authz.Request{Action: authz.ActionRead, Division: DivisiSales}); err == nil {
		return all, nil
	}

	var mine []Attempt
	for _, a := range all {
		if a.OwnerEmployeeID == actor.EmployeeID {
			mine = append(mine, a)
		}
	}
	return mine, nil
}

func scanAttempts(rows *sql.Rows) ([]Attempt, error) {
	var out []Attempt
	for rows.Next() {
		a, err := scanAttempt(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}
