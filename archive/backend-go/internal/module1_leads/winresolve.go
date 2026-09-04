// winresolve.go — M1 §6 rule 5 win resolution (W1-03). When a contested pool
// lead is won at closing, every OTHER open attempt on that lead is closed as
// [Closed - Kalah Kompetisi] and the lead's winning attempt is recorded — all
// inside the closing transaction, so there is never more than one winner.
package module1_leads

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// AttemptClosedKalah is the auto pool-competition loss status.
const AttemptClosedKalah = "[Closed - Kalah Kompetisi]"

// ErrAlreadyResolved is returned when a lead's win has already been resolved
// (a second resolution is rejected — M1 §9.4 atomicity).
var ErrAlreadyResolved = errors.New("module1_leads: lead win already resolved")

// systemActor drives the auto competition-loss transitions. Director authority
// lets it pass any role gate; the audit row records SYSTEM as the actor.
var systemActor = permission.Actor{EmployeeID: "SYSTEM", Role: permission.Role{Director: true}}

// ResolveWin closes competing open attempts and records the winner. Its
// signature matches module0_sales.WinResolverFunc so the closing flow binds to
// it without a leads import. It MUST run inside the caller's transaction (the
// closing tx) so the win is atomic with the Closed-Success transition.
func (s *Service) ResolveWin(ctx context.Context, tx *sql.Tx, leadID, winningAttemptID, winnerEmployeeID string, now time.Time) error {
	// Lock the lead row so concurrent resolutions serialise (no two winners).
	var currentWinner sql.NullString
	if err := tx.QueryRowContext(ctx,
		`SELECT winning_attempt_id FROM leads WHERE id = ? FOR UPDATE`, leadID).
		Scan(&currentWinner); err != nil {
		if err == sql.ErrNoRows {
			return ErrIncomplete
		}
		return err
	}
	if currentWinner.Valid && currentWinner.String != "" {
		return ErrAlreadyResolved
	}

	if _, err := tx.ExecContext(ctx,
		`UPDATE leads SET winning_attempt_id = ? WHERE id = ?`, winningAttemptID, leadID); err != nil {
		return err
	}

	// Close every OTHER non-terminal attempt on this lead as Kalah Kompetisi.
	rows, err := tx.QueryContext(ctx,
		`SELECT id, status FROM prospect_attempts WHERE lead_id = ? AND id <> ?`, leadID, winningAttemptID)
	if err != nil {
		return err
	}
	var losers []string
	func() {
		defer rows.Close()
		for rows.Next() {
			var id, status string
			if err = rows.Scan(&id, &status); err != nil {
				return
			}
			if !terminalAttemptStatuses[status] {
				losers = append(losers, id)
			}
		}
	}()
	if err != nil {
		return err
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, id := range losers {
		if _, err := s.Engine.Transition(ctx, tx, statemachine.Request{
			Machine:    statemachine.MProspectAttempt,
			EntityType: "prospect_attempt",
			Table:      "prospect_attempts",
			EntityID:   id,
			To:         AttemptClosedKalah,
			Actor:      systemActor,
		}); err != nil {
			return err
		}
	}

	return audit.Write(ctx, tx, audit.Record{
		EntityType: "lead", EntityID: leadID, Actor: "SYSTEM",
		Action: "win_resolved",
		After: map[string]any{
			"winning_attempt_id": winningAttemptID,
			"winner":             winnerEmployeeID,
			"losers":             losers,
			"note":               "[lead dimenangkan oleh sales lain (nama)]",
		},
	})
}
