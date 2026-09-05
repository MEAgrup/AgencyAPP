// Creator Booking lifecycle (M9 §4/§5), driven through the NATIVE creator_booking
// machine (STATE_MACHINES §8) — NOT the canonical brief_task machine. Every move
// goes through the transition engine (house rule 2); no status is ever raw-UPDATEd.
// After each move the parent KOL Brief's roll-up is recomputed in the SAME
// transaction (§2, rollup.go).
//
// Who may drive what (§10.1, adapted from the M12 claim model, DECISIONS 2026-07-13):
//   - Execution edges (Book → StartContent → SubmitContent → SendToQCReview,
//     Resubmit): before a Coordinator is assigned, any KOL staff/lead may drive the
//     edge; once assigned, only that Coordinator or the KOL lead (or Director).
//   - QC edges (PassQC / FailQC): the QC reviewer — in M9 this is KOL ITSELF
//     (Coordinator/Team Leader), NOT the AM (the key difference from M7 §5). Same
//     gate as execution.
//   - Escalate ([QC Review] → [Escalated]): KOL Team Leader or Director (a
//     lead-level action, config requireLead) — the coordinator raises an
//     unresponsive/failed creator to the lead.
//   - Resolve an escalated Booking (§5 Rule 4 / M9-OA-6): a minimal, log-derivable
//     representation of "AM owner + KOL Team Leader jointly decide, SPV/Head Account
//     tie-breaks" — WITHOUT a voting table:
//   - Drop ([Escalated]/[Booked]/[Sourcing] → [Dropped], the terminal, harsher
//     action, config requireLead): KOL Team Leader, Account lead (the
//     SPV/Head-Account tie-breaker), or Director. Reason mandatory (logged); the
//     owning AM's concurrence is captured in that reason.
//   - Continue ([Escalated] → [Content Submitted]: extend patience / accept
//     content as-is, then re-run QC): the owning AM (client's proxy), the
//     Booking's Coordinator/lead, or Director — giving the AM a representable
//     role in resolution alongside the Team Leader's drop authority.
package module9_kol

import (
	"context"
	"database/sql"
	"errors"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// bookingRow is the slim locked projection the gates + roll-up need.
type bookingRow struct {
	id          string
	briefID     string
	serviceID   string
	division    string // the parent Brief's division (KOL for a real Booking)
	coordinator string
	status      string
	ownerAM     string
}

// lockBooking row-locks a Booking and joins up to the owning AM for the gates. A
// missing row is ErrBookingNotFound.
func lockBooking(ctx context.Context, tx *sql.Tx, id string) (bookingRow, error) {
	var r bookingRow
	var coord, owner sql.NullString
	err := tx.QueryRowContext(ctx,
		`SELECT bk.id, bk.brief_id, b.service_id, b.assigned_division, bk.assigned_coordinator, bk.status, c.assigned_am_id
		   FROM creator_bookings bk
		   JOIN briefs b ON b.id = bk.brief_id
		   JOIN services sv ON sv.id = b.service_id
		   JOIN clients c ON c.id = sv.client_id
		  WHERE bk.id = ? FOR UPDATE`, id).
		Scan(&r.id, &r.briefID, &r.serviceID, &r.division, &coord, &r.status, &owner)
	if errors.Is(err, sql.ErrNoRows) {
		return bookingRow{}, ErrBookingNotFound
	}
	if err != nil {
		return bookingRow{}, err
	}
	r.coordinator = coord.String
	r.ownerAM = owner.String
	return r, nil
}

// canExecute is the §10.1 execution/QC gate (claim model): Director always;
// otherwise KOL staff/lead. With a Coordinator assigned, only that Coordinator or
// the KOL lead; unassigned, any KOL staff/lead. The AM and other divisions no.
func canExecute(a permission.Actor, r bookingRow) bool {
	if a.Role.Director {
		return true
	}
	if a.Role.Division != KOLDivision ||
		(a.Role.Level != permission.LevelStaff && a.Role.Level != permission.LevelLead) {
		return false
	}
	if r.coordinator != "" {
		return a.EmployeeID == r.coordinator || a.Role.Level == permission.LevelLead
	}
	return true
}

// canEscalate: the KOL Team Leader or Director (a lead-level action, §5 Rule 3).
func canEscalate(a permission.Actor, r bookingRow) bool {
	return a.IsLead(KOLDivision)
}

// canDrop: KOL Team Leader, Account lead (SPV/Head Account tie-breaker, M9-OA-6), or
// Director. The engine's requireLead on the drop edges is also satisfied by these.
func canDrop(a permission.Actor, r bookingRow) bool {
	return a.IsLead(KOLDivision) || a.IsLead(AccountDivision)
}

// canContinueEscalation: the owning AM (client's proxy), the Booking's Coordinator/
// lead, or Director — the "extend patience / accept as-is" path off [Escalated].
func canContinueEscalation(a permission.Actor, r bookingRow) bool {
	if a.EmployeeID == r.ownerAM {
		return true
	}
	return canExecute(a, r)
}

// edge is the shared, gated engine driver for one Booking transition. It locks the
// row, applies the authorization gate, pins the source state (so each method means
// exactly one edge), runs an optional field-write / pre-check `mutate` (persist
// content link / QC notes, enforce the revision cap) inside the transaction BEFORE
// the status changes, drives the engine (which also enforces any config requireLead)
// and recomputes the parent Brief roll-up — all atomically.
func (s *Service) edge(ctx context.Context, actor permission.Actor, id, from, to string,
	gate func(permission.Actor, bookingRow) bool, forbidden error,
	mutate func(context.Context, *sql.Tx, bookingRow) error) (statemachine.Result, error) {

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return statemachine.Result{}, err
	}
	defer tx.Rollback()

	r, err := lockBooking(ctx, tx, id)
	if err != nil {
		return statemachine.Result{}, err
	}
	if !gate(actor, r) {
		return statemachine.Result{}, forbidden
	}
	if r.status != from {
		return statemachine.Result{}, &statemachine.BlockedError{Message: statemachine.DefaultBlockMessage}
	}
	if mutate != nil {
		if err := mutate(ctx, tx, r); err != nil {
			return statemachine.Result{}, err
		}
	}
	res, err := s.engine().Transition(ctx, tx, statemachine.Request{
		Machine: statemachine.MCreatorBooking, EntityType: "creator_booking", Table: "creator_bookings",
		EntityID: id, To: to, Actor: actor,
	})
	if err != nil {
		return statemachine.Result{}, err
	}
	if err := s.recomputeBriefRollup(ctx, tx, actor, r.briefID); err != nil {
		return statemachine.Result{}, err
	}
	if err := tx.Commit(); err != nil {
		return statemachine.Result{}, err
	}
	return res, nil
}

// Book confirms terms with a creator: [Sourcing] → [Booked] (§4 Flow 1). This is the
// edge that makes the first Booking leave [Sourcing], advancing the Brief to
// [In Progress] (and the Service to [In Execution]) via the roll-up (§2).
func (s *Service) Book(ctx context.Context, actor permission.Actor, id string) (statemachine.Result, error) {
	return s.edge(ctx, actor, id, BkgSourcing, BkgBooked, canExecute, ErrExecForbidden, nil)
}

// StartContent marks the creator producing content: [Booked] → [Content In Progress]
// (§4 Flow 2).
func (s *Service) StartContent(ctx context.Context, actor permission.Actor, id string) (statemachine.Result, error) {
	return s.edge(ctx, actor, id, BkgBooked, BkgContentInProg, canExecute, ErrExecForbidden, nil)
}

// SubmitContent attaches the delivered content link and moves to [Content Submitted]
// (§4 Flow 3). A content link is mandatory before [Content Submitted] (§4 Rule 3).
func (s *Service) SubmitContent(ctx context.Context, actor permission.Actor, id, contentLink string) (statemachine.Result, error) {
	return s.edge(ctx, actor, id, BkgContentInProg, BkgContentSubmit, canExecute, ErrExecForbidden,
		s.setContentLink(contentLink, true))
}

// SendToQCReview pulls submitted content into QC: [Content Submitted] → [QC Review]
// (§5). QC in M9 is done by KOL itself (Coordinator/Team Leader), not the AM.
func (s *Service) SendToQCReview(ctx context.Context, actor permission.Actor, id string) (statemachine.Result, error) {
	return s.edge(ctx, actor, id, BkgContentSubmit, BkgQCReview, canExecute, ErrExecForbidden, nil)
}

// PassQC marks the content fulfilled: [QC Review] → [QC Passed] (terminal, §5 Rule 2).
func (s *Service) PassQC(ctx context.Context, actor permission.Actor, id string) (statemachine.Result, error) {
	return s.edge(ctx, actor, id, BkgQCReview, BkgQCPassed, canExecute, ErrExecForbidden, nil)
}

// FailQC requests a revision with mandatory written feedback: [QC Review] → [QC
// Failed - Revision Requested] (§5 Rule 2). The M9-OA-2 cap (1 revision round) is
// enforced from the DERIVED revision count: once the cap is reached the only move
// left is escalation (§5 Rule 3). The QC-Failed notification is emitted by the
// engine's transition hook (EvKOLQCFailedOrEscalated, already cataloged/wired).
func (s *Service) FailQC(ctx context.Context, actor permission.Actor, id, qcNotes string) (statemachine.Result, error) {
	return s.edge(ctx, actor, id, BkgQCReview, BkgQCFailed, canExecute, ErrExecForbidden,
		func(ctx context.Context, tx *sql.Tx, r bookingRow) error {
			if trim(qcNotes) == "" {
				return ErrQCNotesRequired
			}
			// Revision cap (M9-OA-2): derived from the immutable log, never a tally.
			entries, err := audit.List(ctx, tx, audit.Filter{EntityType: "creator_booking", EntityID: id})
			if err != nil {
				return err
			}
			if deriveRevisionCount(entries) >= revisionCap {
				return ErrRevisionCapReached
			}
			return setQCNotes(ctx, tx, id, qcNotes)
		})
}

// Escalate routes an unresponsive/uncap-salvageable creator to a decision: [QC
// Review] → [Escalated - Creator Unresponsive] (§5 Rule 3). KOL Team Leader/Director.
// QC notes mandatory. The escalation notification is emitted by the engine hook.
func (s *Service) Escalate(ctx context.Context, actor permission.Actor, id, qcNotes string) (statemachine.Result, error) {
	return s.edge(ctx, actor, id, BkgQCReview, BkgEscalated, canEscalate, ErrEscalateForbidden,
		func(ctx context.Context, tx *sql.Tx, r bookingRow) error {
			if trim(qcNotes) == "" {
				return ErrQCNotesRequired
			}
			return setQCNotes(ctx, tx, id, qcNotes)
		})
}

// Resubmit re-attaches revised content after a failed QC round: [QC Failed -
// Revision Requested] → [Content Submitted] (§5 Rule 2). Content link mandatory.
func (s *Service) Resubmit(ctx context.Context, actor permission.Actor, id, contentLink string) (statemachine.Result, error) {
	return s.edge(ctx, actor, id, BkgQCFailed, BkgContentSubmit, canExecute, ErrExecForbidden,
		s.setContentLink(contentLink, true))
}

// ContinueFromEscalation resolves an escalated Booking by extending patience /
// accepting the content as-is, re-entering the QC flow: [Escalated] → [Content
// Submitted] (§5 Rule 4). Owning AM / Coordinator / KOL lead / Director. A content
// link must be present (a new one may be supplied, else the existing one is kept).
func (s *Service) ContinueFromEscalation(ctx context.Context, actor permission.Actor, id, contentLink string) (statemachine.Result, error) {
	return s.edge(ctx, actor, id, BkgEscalated, BkgContentSubmit, canContinueEscalation, ErrExecForbidden,
		s.setContentLink(contentLink, false))
}

// Drop terminally excludes a Booking (§5 Rule 4). Valid from [Escalated] (drop after
// escalation, re-source = a NEW Booking row) or pre-content ([Booked]/[Sourcing]).
// KOL lead / Account lead / Director; reason mandatory (logged into the audit trail
// and the Booking's notes). A dropped Booking is excluded from Speed Score entirely
// (§11) and never appears in the Creator List (§6 Rule 3).
func (s *Service) Drop(ctx context.Context, actor permission.Actor, id, reason string) (statemachine.Result, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return statemachine.Result{}, err
	}
	defer tx.Rollback()

	r, err := lockBooking(ctx, tx, id)
	if err != nil {
		return statemachine.Result{}, err
	}
	if !canDrop(actor, r) {
		return statemachine.Result{}, ErrDropForbidden
	}
	// The drop edge is valid only from these three source states (config §8).
	if r.status != BkgEscalated && r.status != BkgBooked && r.status != BkgSourcing {
		return statemachine.Result{}, &statemachine.BlockedError{Message: statemachine.DefaultBlockMessage}
	}
	if trim(reason) == "" {
		return statemachine.Result{}, ErrDropReasonRequired
	}
	if err := setQCNotes(ctx, tx, id, reason); err != nil {
		return statemachine.Result{}, err
	}
	res, err := s.engine().Transition(ctx, tx, statemachine.Request{
		Machine: statemachine.MCreatorBooking, EntityType: "creator_booking", Table: "creator_bookings",
		EntityID: id, To: BkgDropped, Actor: actor,
	})
	if err != nil {
		return statemachine.Result{}, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "creator_booking", EntityID: id, Actor: actor.EmployeeID, Action: "drop_reason",
		After: map[string]any{"reason": trim(reason)},
	}); err != nil {
		return statemachine.Result{}, err
	}
	if err := s.recomputeBriefRollup(ctx, tx, actor, r.briefID); err != nil {
		return statemachine.Result{}, err
	}
	if err := tx.Commit(); err != nil {
		return statemachine.Result{}, err
	}
	return res, nil
}

// setContentLink returns a mutate that persists the content link before a move into
// [Content Submitted] and enforces the §4 Rule 3 gate. When required is true a blank
// link is rejected; when false (the [Escalated] continue path) a blank link is
// allowed only if the Booking already carries one.
func (s *Service) setContentLink(link string, required bool) func(context.Context, *sql.Tx, bookingRow) error {
	return func(ctx context.Context, tx *sql.Tx, r bookingRow) error {
		link = trim(link)
		if link == "" {
			if required {
				return ErrContentLinkRequired
			}
			// Continue path: keep the existing link, but it must exist.
			var existing sql.NullString
			if err := tx.QueryRowContext(ctx,
				`SELECT content_link FROM creator_bookings WHERE id = ?`, r.id).Scan(&existing); err != nil {
				return err
			}
			if !existing.Valid || trim(existing.String) == "" {
				return ErrContentLinkRequired
			}
			return nil
		}
		_, err := tx.ExecContext(ctx,
			`UPDATE creator_bookings SET content_link = ? WHERE id = ?`, link, r.id)
		return err
	}
}

// setQCNotes writes the Booking's QC Notes column (the display copy). The immutable
// history stays in the audit log (house rule 3) — QC-fail/escalate/drop each append
// a transition row, and the notes are the last-set display value.
func setQCNotes(ctx context.Context, tx *sql.Tx, id, notes string) error {
	_, err := tx.ExecContext(ctx,
		`UPDATE creator_bookings SET qc_notes = ? WHERE id = ?`, trim(notes), id)
	return err
}
