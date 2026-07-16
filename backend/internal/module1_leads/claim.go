// claim.go — W1-03 pool claim. A salesperson claims a lead from the Pool,
// spawning their own prospect attempt. Multiple different salespeople may hold
// concurrent open attempts on the same Pool lead (the contest, M1-OA-1); the
// same salesperson cannot open a second open attempt on a lead they already
// pursue.
package module1_leads

import (
	"context"
	"database/sql"
	"errors"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// msgDeniedClaim is the canonical BI access-denial string.
const msgDeniedClaim = statemachine.RoleDeniedMessage

// ErrLeadNotFound is returned when a claim targets a missing lead.
var ErrLeadNotFound = errors.New("module1_leads: lead not found")

// ErrAlreadyPursuing is an internal sentinel: the actor already has an open
// attempt on this lead. The PRD gives no BI string (the Pool view hides
// already-claimed leads), so this never surfaces to the user verbatim.
var ErrAlreadyPursuing = errors.New("module1_leads: actor already has an open attempt on this lead")

// ClaimFromPool spawns a prospect attempt for actor on an existing lead (Pool
// contest). Sales division (or Director) only.
func (s *Service) ClaimFromPool(ctx context.Context, actor permission.Actor, leadID string) (Attempt, error) {
	if !(actor.Role.Director || actor.Role.Division == SalesDivision) {
		return Attempt{}, &ErrBlocked{Message: msgDeniedClaim}
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Attempt{}, err
	}
	defer tx.Rollback()

	var exists string
	err = tx.QueryRowContext(ctx, `SELECT id FROM leads WHERE id = ? FOR UPDATE`, leadID).Scan(&exists)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Attempt{}, ErrLeadNotFound
		}
		return Attempt{}, err
	}

	// Guard: the same salesperson may not double-open on one lead (shared with the
	// collaborative-join guard — one implementation of M1-OA-1).
	open, err := s.actorHasOpenAttempt(ctx, tx, leadID, actor.EmployeeID)
	if err != nil {
		return Attempt{}, err
	}
	if open {
		return Attempt{}, ErrAlreadyPursuing
	}

	att, err := s.insertAttempt(ctx, tx, leadID, actor)
	if err != nil {
		return Attempt{}, err
	}
	if err := tx.Commit(); err != nil {
		return Attempt{}, err
	}
	return att, nil
}
