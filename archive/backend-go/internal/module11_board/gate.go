package module11_board

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// This file holds the two cross-module integrations M11 plugs into the Brief
// machine WITHOUT rewriting M6/M12:
//
//   - ValidateBriefApproval — the Blocking-gate code guard. module6_account and
//     module12_task call it just before driving a Target Brief's FINAL transition
//     ([In Review] -> [Approved]); while a Blocking Dependency's Source is not yet
//     terminal it returns a BlockedError with the STATE_MACHINES §12 template
//     message and nothing changes. It satisfies the BriefApproveGuard interfaces
//     declared in those packages (structural typing — no import cycle).
//
//   - OnBriefReachedTerminal — the emission hook. When a Source Brief reaches its
//     terminal ([Approved]) every Dependency it sources turns Satisfied; this fires
//     EvDependencySatisfied ONCE per Dependency to the Target Brief's PIC (fire-once
//     via satisfied_notified_at). It is called from the engine's post-transition
//     hook (httpapi.onTransition) for MBriefTask -> [Approved], covering both the
//     AM approval (module6) and the Creative/KOL roll-up (module12) paths, since
//     both drive [Approved] through the engine.

// gateMessageTemplate is the STATE_MACHINES §12 Blocking-gate message, verbatim in
// format (the bracketed target status and the Source Brief id(s) are the dynamic
// fills). The doc example fills the status with [In Execution] illustratively; the
// real fill is the target status actually attempted — always [Approved], the Brief's
// final transition (§6.3 Resolved: "Target can't pass its final transition until
// Source reaches its terminal status"). See DECISIONS W3-M11-C1 for the [In Execution]
// vs [Approved] wording resolution.
func gateMessage(targetStatus string, sourceIDs []string) string {
	return fmt.Sprintf("Brief ini belum bisa lanjut ke %s karena menunggu %s selesai Approved.",
		targetStatus, strings.Join(sourceIDs, ", "))
}

// ValidateBriefApproval is the Blocking-gate guard (M11 §2 Rule 7 / §6.3). It is
// called inside the caller's transaction, immediately before a Target Brief is
// driven [In Review] -> [Approved]. If any active Blocking Dependency targets this
// Brief whose Source has NOT reached terminal, it returns a *statemachine.BlockedError
// carrying the §12 template message and the caller must abort the transition
// (nothing changes). Informational Dependencies never block. A Brief with no
// Blocking Dependency (the common case) passes cheaply.
func (s *Service) ValidateBriefApproval(ctx context.Context, tx *sql.Tx, briefID string) error {
	unsatisfied, err := blockingSourcesUnsatisfied(ctx, tx, briefID)
	if err != nil {
		return err
	}
	if len(unsatisfied) == 0 {
		return nil
	}
	return &statemachine.BlockedError{Message: gateMessage(briefTerminal, unsatisfied)}
}

// blockingSourcesUnsatisfied returns the Source Brief ids of every active Blocking
// Dependency targeting briefID whose Source has not reached terminal ([Approved]).
// A Blocking Dependency holds the Target back for the whole time its Source is
// unfinished — regardless of whether the Source has started (a Source still in
// [To Do] blocks too), matching §2 Rule 8 ("until the Source reaches its terminal").
func blockingSourcesUnsatisfied(ctx context.Context, q interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, briefID string) ([]string, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT d.source_id
		   FROM dependencies d
		   JOIN briefs sb ON sb.id = d.source_id
		  WHERE d.target_id = ?
		    AND d.dependency_type = ?
		    AND sb.status <> ?
		  ORDER BY d.source_id ASC`,
		briefID, TypeBlocking, briefTerminal)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// OnBriefReachedTerminal fires EvDependencySatisfied for every Dependency sourced by
// briefID, once each, to the Target Brief's assigned PIC (M11 §2 Rule 8 / §5.5). It
// runs inside the triggering transition's transaction (atomic with the Source's move
// to [Approved]). Fire-once is enforced by stamping satisfied_notified_at with a row
// lock, so re-entry (e.g. a re-run roll-up) never double-sends. Nil-catalog is a
// no-op (unit tests without the catalog wired).
//
// Only Blocking Dependencies notify a "now unblocked" PIC; Informational ones carry
// no gate, so an Informational Source reaching terminal simply stamps the row (no
// recipient) — keeping the fire-once bookkeeping uniform without sending a spurious
// "dependency satisfied" nudge for a link that never blocked anything.
func (s *Service) OnBriefReachedTerminal(ctx context.Context, tx *sql.Tx, actor permission.Actor, briefID string) error {
	if s.Catalog == nil {
		return nil
	}
	rows, err := tx.QueryContext(ctx,
		`SELECT id, target_id, dependency_type
		   FROM dependencies
		  WHERE source_id = ? AND satisfied_notified_at IS NULL
		  FOR UPDATE`, briefID)
	if err != nil {
		return err
	}
	type dep struct{ id, targetID, depType string }
	var deps []dep
	for rows.Next() {
		var d dep
		if err := rows.Scan(&d.id, &d.targetID, &d.depType); err != nil {
			rows.Close()
			return err
		}
		deps = append(deps, d)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	for _, d := range deps {
		// Stamp fire-once first (inside the same tx / row lock) so a concurrent or
		// re-entrant call cannot double-emit.
		if _, err := tx.ExecContext(ctx,
			`UPDATE dependencies SET satisfied_notified_at = NOW(6)
			  WHERE id = ? AND satisfied_notified_at IS NULL`, d.id); err != nil {
			return err
		}
		if d.depType != TypeBlocking {
			continue // Informational: no "unblocked" recipient (§2 Rule 5).
		}
		pic, err := briefPIC(ctx, tx, d.targetID)
		if err != nil {
			return err
		}
		if pic == "" {
			continue // no PIC assigned yet — nothing to notify.
		}
		if _, err := s.Catalog.Emit(ctx, tx, notification.Emission{
			Event: notification.EvDependencySatisfied, EntityType: "dependency", EntityID: d.id,
			Actor: actor.EmployeeID, ExplicitRecipients: []string{pic},
		}); err != nil {
			return err
		}
	}
	return nil
}

// briefPIC returns a Brief's assigned PIC (empty if unassigned).
func briefPIC(ctx context.Context, tx *sql.Tx, briefID string) (string, error) {
	var pic sql.NullString
	err := tx.QueryRowContext(ctx, `SELECT assigned_pic FROM briefs WHERE id = ?`, briefID).Scan(&pic)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return pic.String, nil
}
