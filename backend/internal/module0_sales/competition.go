package sales

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// This file is Module 0's half of ticket W1-03 (M1 §6 competitive claim & win
// resolution). module1_leads owns the Lead-record side (ClaimPoolLead,
// ResolveWin) and consumes these two methods through its CompetitionResolver
// interface — the same dependency-injection seam as AttemptCreator, so the
// leads package never touches prospect_attempts directly.

// OpenAttempts returns prospectID → ownerEmployeeID for every attempt on
// leadID that has not yet reached a terminal state (Not Qualified, Blocked,
// Closed-Success, Closed-Lost, [Closed - Kalah Kompetisi]). These are the
// attempts still "in play": win resolution auto-closes them, and a pool claim
// uses the owner set to refuse a second attempt by the same salesperson.
//
// No permission check: this is a system-side read consumed inside
// module1_leads' claim/win transactions, never exposed to a user-facing
// endpoint (workspace reads go through GetAttempt/ListByLead, which do
// enforce M0 §7.1).
func (s *Attempts) OpenAttempts(ctx context.Context, q db.Queryer, leadID string) (map[string]string, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT prospect_id, owner_employee_id FROM prospect_attempts
		  WHERE lead_id = ? AND status NOT IN (?, ?, ?, ?, ?)`,
		leadID,
		string(statemachine.ProspectNotQualified),
		string(statemachine.ProspectBlocked),
		string(statemachine.ProspectClosedSuccess),
		string(statemachine.ProspectClosedLost),
		string(statemachine.ProspectClosedKalah),
	)
	if err != nil {
		return nil, fmt.Errorf("sales: open attempts for %s: %w", leadID, err)
	}
	defer rows.Close()
	open := make(map[string]string)
	for rows.Next() {
		var prospectID, owner string
		if err := rows.Scan(&prospectID, &owner); err != nil {
			return nil, err
		}
		open[prospectID] = owner
	}
	return open, rows.Err()
}

// CloseKalah auto-transitions one open competing attempt to
// `[Closed - Kalah Kompetisi]` inside the caller's transaction (M1 §6 rule 5).
// The edge is Auto-only in the engine, so it runs as statemachine.ActorSystem
// — a human actor can never take it via UpdateStatus — and the engine itself
// appends the immutable transition audit row. Called ONLY by module1_leads'
// ResolveWin, inside the same locked transaction that sets the Lead record's
// winner, so the winner write and every competitor close commit or roll back
// together.
func (s *Attempts) CloseKalah(ctx context.Context, tx *sql.Tx, prospectID string) error {
	return s.engine.Transition(ctx, tx, statemachine.TransitionRequest{
		EntityType: statemachine.EntityProspect,
		EntityID:   prospectID,
		To:         statemachine.ProspectClosedKalah,
		Actor:      statemachine.ActorSystem,
	})
}
