// This file implements the Campaign lifecycle (STATE_MACHINES §3 / M3 §3):
// Draft -> Active <-> Paused -> Closed -> Archived. Every move goes through the
// transition engine (house rule 2) — the ONLY path that writes the status column and
// the ONLY thing that appends the transition audit row. The engine blocks any edge not
// in the table with its configured BI message ("[transisi status tidak diizinkan]").
//
// Reaching 'Closed' additionally stamps end_date = today (WIB) — a DATA-column effect
// (§6.3 "Set on [Closed]"), not a status. That write + its own audit row are committed
// inside the same transaction as the transition, so the whole move is atomic.
package module3_campaign

import (
	"context"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// Transition drives a Campaign to the target status through the engine (§3 Rule 3/4).
// Authority (§6.1) is checked in code BEFORE the engine runs, so a denied actor changes
// nothing: the owning Marketing staff, any Marketing lead/head, or a Director may drive
// it; OD and other divisions are rejected with ErrForbidden. An illegal edge is rejected
// by the engine with a BlockedError carrying "[transisi status tidak diizinkan]".
func (s *Service) Transition(ctx context.Context, actor permission.Actor, campaignID, to string) (statemachine.Result, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return statemachine.Result{}, err
	}
	defer tx.Rollback()

	row, err := lockCampaign(ctx, tx, campaignID)
	if err != nil {
		return statemachine.Result{}, err
	}
	if !canManageCampaign(actor, row.owner) {
		return statemachine.Result{}, ErrForbidden
	}

	res, err := s.engine().Transition(ctx, tx, statemachine.Request{
		Machine: statemachine.MCampaign, EntityType: "campaign", Table: "campaigns",
		EntityID: campaignID, To: to, Actor: actor,
	})
	if err != nil {
		return statemachine.Result{}, err
	}

	// §6.3: reaching 'Closed' sets end_date = today (WIB). Data-column effect, audited.
	if to == StatusClosed {
		end := closedEndDate()
		if _, err := tx.ExecContext(ctx,
			`UPDATE campaigns SET end_date = ? WHERE id = ?`, end, campaignID); err != nil {
			return statemachine.Result{}, err
		}
		if err := audit.Write(ctx, tx, audit.Record{
			EntityType: "campaign", EntityID: campaignID, Actor: actor.EmployeeID, Action: "set_end_date",
			Before: map[string]any{"end_date": nil},
			After:  map[string]any{"end_date": end},
		}); err != nil {
			return statemachine.Result{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return statemachine.Result{}, err
	}
	return res, nil
}
