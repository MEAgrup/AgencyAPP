// Live Stream Session lifecycle (M10 §3/§4), driven through the live_stream_session
// machine (STATE_MACHINES §10) — every move goes through the transition engine (house
// rule 2); no status is ever raw-UPDATEd. The chain is:
//
//	[Requested] → [Confirmed by Vendor] → [Completed] → { [Reconciled] (terminal)
//	                                                     | [Discrepancy Flagged] → [Reconciled] }
//
// Who may drive (§6.1 — this is a TRACKER the AM owns, NOT an execution division):
// every edge is the owning AM or Director. Account lead/SPV reads and runs the
// off-system vendor follow-up, but the in-system record is the owning AM's.
//
// Two edges carry mandatory gates enforced here (code guards, before the engine move):
//   - [Completed]: result fields + Vendor Report Link mandatory (§4 Rule 2 / §6.3).
//   - [Discrepancy Flagged]: Reconciliation Notes mandatory (§4 Rule 3 / §6.3). The
//     real-time SPV notification (M10-OA-3, EvSessionDiscrepancyFlagged) is emitted by
//     the engine's transition hook — already cataloged and wired in httpapi.onTransition,
//     so this module does NOT emit directly (anti-double-emit, precedent M9).
//
// When a Session reaches [Reconciled] the parent (off-machine) Brief roll-up is
// recomputed in the SAME transaction: once every Session of the Brief is [Reconciled]
// the Brief closes to [Approved] via an audited off-machine UPDATE (rollup.go).
package module10_livestream

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// sessionRow is the slim locked projection the gates + roll-up need.
type sessionRow struct {
	id          string
	briefID     string
	status      string
	briefStatus string
	ownerAM     string
}

// lockSession row-locks a Session and joins up to the parent Brief status + owning AM.
func lockSession(ctx context.Context, tx *sql.Tx, id string) (sessionRow, error) {
	var r sessionRow
	var owner sql.NullString
	err := tx.QueryRowContext(ctx,
		`SELECT ls.id, ls.brief_id, ls.status, b.status, c.assigned_am_id
		   FROM live_stream_sessions ls
		   JOIN briefs b ON b.id = ls.brief_id
		   JOIN services sv ON sv.id = b.service_id
		   JOIN clients c ON c.id = sv.client_id
		  WHERE ls.id = ? FOR UPDATE`, id).
		Scan(&r.id, &r.briefID, &r.status, &r.briefStatus, &owner)
	if errors.Is(err, sql.ErrNoRows) {
		return sessionRow{}, ErrSessionNotFound
	}
	if err != nil {
		return sessionRow{}, err
	}
	r.ownerAM = owner.String
	return r, nil
}

// edge is the shared, gated engine driver for one Session transition. It locks the
// row, freezes Sessions of a voided Brief (scope: void interaction — no further moves),
// applies the §6.1 owning-AM/Director gate, pins the allowed source states (so each
// method means exactly its edge(s)), runs an optional field-write / pre-check `mutate`
// inside the transaction BEFORE the status changes, drives the engine, and — for a move
// into [Reconciled] — recomputes the parent Brief roll-up, all atomically.
func (s *Service) edge(ctx context.Context, actor permission.Actor, id string, from []string, to string,
	mutate func(context.Context, *sql.Tx, sessionRow) error) (statemachine.Result, error) {

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return statemachine.Result{}, err
	}
	defer tx.Rollback()

	r, err := lockSession(ctx, tx, id)
	if err != nil {
		return statemachine.Result{}, err
	}
	// A Session whose parent Brief was voided is frozen: no further lifecycle moves
	// (the underlying service was cancelled; there is no engine cancel edge for a
	// Session, and we invent none — scope). Honest data, immutable history.
	if r.briefStatus == BriefVoided {
		return statemachine.Result{}, ErrBriefVoided
	}
	if !canManageSession(actor, r.ownerAM) {
		return statemachine.Result{}, ErrSessionManageForbidden
	}
	if !contains(from, r.status) {
		return statemachine.Result{}, &statemachine.BlockedError{Message: statemachine.DefaultBlockMessage}
	}
	if mutate != nil {
		if err := mutate(ctx, tx, r); err != nil {
			return statemachine.Result{}, err
		}
	}
	res, err := s.engine().Transition(ctx, tx, statemachine.Request{
		Machine: statemachine.MLiveStreamSession, EntityType: "live_stream_session",
		Table: "live_stream_sessions", EntityID: id, To: to, Actor: actor,
	})
	if err != nil {
		return statemachine.Result{}, err
	}
	if to == LssReconciled {
		if err := s.rollupBriefOnReconcile(ctx, tx, actor, r.briefID); err != nil {
			return statemachine.Result{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return statemachine.Result{}, err
	}
	return res, nil
}

// ConfirmByVendor logs the vendor accepting the schedule: [Requested] → [Confirmed by
// Vendor] (§3 Rule 3). Vendor confirmation arrives out-of-system; the AM records it.
func (s *Service) ConfirmByVendor(ctx context.Context, actor permission.Actor, id string) (statemachine.Result, error) {
	return s.edge(ctx, actor, id, []string{LssRequested}, LssConfirmed, nil)
}

// ResultInput carries the vendor-reported RESULT fields (§4 Rule 1 / §6.3). All the
// gate fields are mandatory before [Completed]; Viewers are optional (depend on the
// vendor's reporting detail).
type ResultInput struct {
	ActualDatetime      string // mandatory: when the stream was actually held
	ActualDurationHours string // mandatory: decimal hours actually streamed
	ViewersPeak         *int   // optional
	ViewersAvg          *int   // optional
	OrdersGenerated     *int   // mandatory: orders generated in the session
	GMV                 string // mandatory: GMV from live (Rp), money core
	VendorReportLink    string // mandatory: the vendor's own report/proof (audit trail)
}

// LogResults enters the vendor-reported result and completes the Session: [Confirmed by
// Vendor] → [Completed] (§4 Flow 2). Gate (§4 Rule 2 / §6.3): actual datetime, actual
// duration, orders, GMV and the Vendor Report Link are all mandatory; viewers optional.
func (s *Service) LogResults(ctx context.Context, actor permission.Actor, id string, in ResultInput) (statemachine.Result, error) {
	return s.edge(ctx, actor, id, []string{LssConfirmed}, LssCompleted,
		func(ctx context.Context, tx *sql.Tx, r sessionRow) error {
			// Vendor Report Link is called out specifically (§6.3 — audit trail).
			link := strings.TrimSpace(in.VendorReportLink)
			if link == "" {
				return ErrVendorReportLinkRequired
			}
			// Remaining result fields: all required before [Completed].
			if strings.TrimSpace(in.ActualDatetime) == "" || strings.TrimSpace(in.ActualDurationHours) == "" ||
				in.OrdersGenerated == nil || strings.TrimSpace(in.GMV) == "" {
				return ErrIncomplete
			}
			actualAt, err := parseDatetime(in.ActualDatetime)
			if err != nil {
				return err
			}
			actualDur, err := parseDuration(in.ActualDurationHours)
			if err != nil {
				return err
			}
			if *in.OrdersGenerated < 0 {
				return ErrIncomplete
			}
			gmv, err := money.Parse(in.GMV)
			if err != nil || gmv < 0 {
				return ErrBadAmount
			}
			_, err = tx.ExecContext(ctx,
				`UPDATE live_stream_sessions
				    SET actual_datetime = ?, actual_duration_hours = ?, viewers_peak = ?,
				        viewers_avg = ?, orders_generated = ?, gmv = ?, vendor_report_link = ?
				  WHERE id = ?`,
				actualAt, actualDur, nullInt(in.ViewersPeak), nullInt(in.ViewersAvg),
				*in.OrdersGenerated, gmv.Decimal(), link, id)
			return err
		})
}

// Reconcile closes the requested-vs-actual review with a match: → [Reconciled]
// (terminal, §4 Rule 3). Valid from [Completed] (matched straight away) or from
// [Discrepancy Flagged] (a flagged gap addressed/accepted after the off-system vendor
// conversation, §4 Flow 4 — non-blocking). Rolls the parent Brief up on success.
func (s *Service) Reconcile(ctx context.Context, actor permission.Actor, id string) (statemachine.Result, error) {
	return s.edge(ctx, actor, id, []string{LssCompleted, LssDiscrepancy}, LssReconciled, nil)
}

// FlagDiscrepancy raises a meaningful requested-vs-actual gap: [Completed] →
// [Discrepancy Flagged] (§4 Rule 3), with mandatory Reconciliation Notes. Non-blocking
// (§4 Rule 4): the Session may still reach [Reconciled] later. The real-time SPV
// notification (M10-OA-3) is emitted by the engine hook, not here.
func (s *Service) FlagDiscrepancy(ctx context.Context, actor permission.Actor, id, notes string) (statemachine.Result, error) {
	return s.edge(ctx, actor, id, []string{LssCompleted}, LssDiscrepancy,
		func(ctx context.Context, tx *sql.Tx, r sessionRow) error {
			if strings.TrimSpace(notes) == "" {
				return ErrReconNotesRequired
			}
			_, err := tx.ExecContext(ctx,
				`UPDATE live_stream_sessions SET reconciliation_notes = ? WHERE id = ?`,
				strings.TrimSpace(notes), id)
			return err
		})
}

func contains(xs []string, v string) bool {
	for _, x := range xs {
		if x == v {
			return true
		}
	}
	return false
}

func nullInt(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}
