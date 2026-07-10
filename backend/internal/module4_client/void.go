package module4_client

import (
	"context"
	"database/sql"
	"errors"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// Void terminal status shared by Service and Brief (STATE_MACHINES.md §6/§7).
const StatusServiceVoided = "[Cancelled — Service Voided]"

// BriefApproved is the one brief status the void cascade leaves untouched
// (M4-OA-5): already-Approved work is delivered and never cancelled.
const BriefApproved = "[Approved]"

// ErrVoidForbidden: the actor may not void a service (M4-OA-5 approval gate).
var ErrVoidForbidden = errors.New(statemachine.RoleDeniedMessage)

// VoidResult reports what the void cascade did.
type VoidResult struct {
	ServiceID       string   `json:"service_id"`
	VoidedBriefs    []string `json:"voided_briefs"`
	SkippedApproved []string `json:"skipped_approved_briefs"`
}

// canVoid is the M4-OA-5 approval gate: SPV/Head Sales (Sales lead), Account
// Lead, or Director. OD (read-only) and any staff are denied. This is stricter
// than the engine's requireLead edge (which is division-agnostic), so it is
// checked before the transition.
func canVoid(a permission.Actor) bool {
	if a.Role.Director {
		return true
	}
	if a.Role.Level != permission.LevelLead {
		return false
	}
	return a.Role.Division == SalesDivision || a.Role.Division == AccountDivision
}

// VoidService voids a Service (M4-OA-5) and cascade-cancels its child Briefs that
// are not yet [Approved], all in one transaction. Approved Briefs are left
// intact; nothing is ever deleted. Both the Service and each cancelled Brief move
// through the state-machine engine (audit rows written per transition).
func (s *Service) VoidService(ctx context.Context, actor permission.Actor, serviceID string) (VoidResult, error) {
	if !canVoid(actor) {
		return VoidResult{}, ErrVoidForbidden
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return VoidResult{}, err
	}
	defer tx.Rollback()

	// Prove the service exists AND its owning client is visible to the actor
	// (M4 §6, same predicate as Get/List) — clean 404 instead of the engine's
	// generic error, and closing the gap that otherwise let Account Lead void a
	// service on a client Account cannot even read yet (pre-release).
	clause, visArgs, ok := visibility(actor)
	if !ok {
		return VoidResult{}, ErrNotFound
	}
	var probe string
	probeQ := `SELECT s.id FROM services s JOIN clients c ON c.id = s.client_id WHERE s.id = ? AND (` + clause + `)`
	if err := tx.QueryRowContext(ctx, probeQ, append([]any{serviceID}, visArgs...)...).Scan(&probe); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return VoidResult{}, ErrNotFound
		}
		return VoidResult{}, err
	}

	// Void the service (engine enforces the requireLead void edge + blocks a
	// terminal service with [transisi status tidak diizinkan]).
	if _, err := s.Engine.Transition(ctx, tx, statemachine.Request{
		Machine:    statemachine.MService,
		EntityType: "service",
		Table:      "services",
		EntityID:   serviceID,
		To:         StatusServiceVoided,
		Actor:      actor,
	}); err != nil {
		return VoidResult{}, err
	}

	// Collect child briefs to cancel (not Approved, not already voided). Read
	// them fully before issuing the per-brief transitions.
	rows, err := tx.QueryContext(ctx,
		`SELECT id FROM briefs WHERE service_id = ? AND status NOT IN (?, ?) ORDER BY id`,
		serviceID, BriefApproved, StatusServiceVoided)
	if err != nil {
		return VoidResult{}, err
	}
	var toCancel []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return VoidResult{}, err
		}
		toCancel = append(toCancel, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return VoidResult{}, err
	}
	rows.Close()

	res := VoidResult{ServiceID: serviceID, VoidedBriefs: []string{}, SkippedApproved: []string{}}
	for _, id := range toCancel {
		if _, err := s.Engine.Transition(ctx, tx, statemachine.Request{
			Machine:    statemachine.MBriefTask,
			EntityType: "brief",
			Table:      "briefs",
			EntityID:   id,
			To:         StatusServiceVoided,
			Actor:      actor,
		}); err != nil {
			return VoidResult{}, err
		}
		res.VoidedBriefs = append(res.VoidedBriefs, id)
	}

	// Record which Approved briefs were deliberately preserved (reporting only).
	arows, err := tx.QueryContext(ctx,
		`SELECT id FROM briefs WHERE service_id = ? AND status = ? ORDER BY id`, serviceID, BriefApproved)
	if err != nil {
		return VoidResult{}, err
	}
	for arows.Next() {
		var id string
		if err := arows.Scan(&id); err != nil {
			arows.Close()
			return VoidResult{}, err
		}
		res.SkippedApproved = append(res.SkippedApproved, id)
	}
	if err := arows.Err(); err != nil {
		arows.Close()
		return VoidResult{}, err
	}
	arows.Close()

	if err := tx.Commit(); err != nil {
		return VoidResult{}, err
	}
	return res, nil
}
