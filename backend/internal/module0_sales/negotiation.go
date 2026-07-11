package module0_sales

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/ident"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// Negotiation decisions (superior's call — M0 §5 Flow Superior approval).
const (
	DecisionApprove = "approve"
	DecisionRevise  = "revise"
	DecisionReject  = "reject"
)

// ErrCustomTermRequiresNegotiation: a no-negotiation submission carried a custom
// term. The PRD gives no BI prompt for "switch to negotiation" — treated as an
// internal sentinel (DECISIONS, stream A W1-07/08 (d)).
var ErrCustomTermRequiresNegotiation = errors.New("module0_sales: custom terms require the negotiation path")

// ProposalLine is one negotiated service line (custom price / commission).
type ProposalLine struct {
	MasterServiceID string `json:"master_service_id"`
	ProposedPrice   string `json:"proposed_price"`
	CommissionRule  string `json:"commission_rule"`
	PaymentTerms    string `json:"payment_terms"`
}

// SubmitNegotiation opens the negotiation from a Qualified attempt. noNego=true
// takes the standard terms (from the Qualified Form snapshot) straight to
// Negotiation - Auto Approved (bypasses superior). Otherwise the custom lines
// are versioned and routed to the superior as Negotiation - Pending Approval,
// firing the pending-approval notification.
func (s *Service) SubmitNegotiation(ctx context.Context, actor permission.Actor, attemptID string, lines []ProposalLine, noNego bool) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	a, err := loadAttempt(ctx, tx, attemptID, true)
	if err != nil {
		return err
	}
	if !canWriteAttempt(actor, a.ownerID) {
		return &blockedError{msgDenied}
	}

	if noNego {
		if len(lines) > 0 {
			return ErrCustomTermRequiresNegotiation
		}
		std, err := s.standardLines(ctx, tx, attemptID)
		if err != nil {
			return err
		}
		if err := s.writeProposal(ctx, tx, actor, attemptID, std); err != nil {
			return err
		}
		return finishTx(tx, s.transition(ctx, tx, attemptID, StatusNegAutoApprove, actor))
	}

	if len(lines) == 0 {
		return ErrIncomplete
	}
	if err := s.writeProposal(ctx, tx, actor, attemptID, lines); err != nil {
		return err
	}
	if err := s.transition(ctx, tx, attemptID, StatusNegPending, actor); err != nil {
		return err
	}
	if err := s.emitPendingApproval(ctx, tx, actor, a, attemptID); err != nil {
		return err
	}
	return tx.Commit()
}

// Resubmit sends a fresh proposal version after a Revision Required or a Reject
// (M0 §5 line 122/123 — salesperson action). Both routes go back to
// Negotiation - Pending Approval.
func (s *Service) Resubmit(ctx context.Context, actor permission.Actor, attemptID string, lines []ProposalLine) error {
	if len(lines) == 0 {
		return ErrIncomplete
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	a, err := loadAttempt(ctx, tx, attemptID, true)
	if err != nil {
		return err
	}
	if !canWriteAttempt(actor, a.ownerID) {
		return &blockedError{msgDenied}
	}
	if err := s.writeProposal(ctx, tx, actor, attemptID, lines); err != nil {
		return err
	}
	if err := s.transition(ctx, tx, attemptID, StatusNegPending, actor); err != nil {
		return err
	}
	if err := s.emitPendingApproval(ctx, tx, actor, a, attemptID); err != nil {
		return err
	}
	return tx.Commit()
}

// DecideNegotiation is the superior's decision on a Pending Approval attempt.
// The prospect_attempt machine enforces Lead/Director-only on these edges; the
// decision note is recorded on the latest proposal version and an event fires
// to the salesperson.
func (s *Service) DecideNegotiation(ctx context.Context, actor permission.Actor, attemptID, decision, note string) error {
	var to string
	switch decision {
	case DecisionApprove:
		to = StatusNegApproved
	case DecisionRevise:
		to = StatusNegRevision
	case DecisionReject:
		to = StatusNegRejected
	default:
		return ErrIncomplete
	}
	if (decision == DecisionRevise || decision == DecisionReject) && note == "" {
		return ErrIncomplete // mandatory notes (M0 §5)
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	a, err := loadAttempt(ctx, tx, attemptID, true)
	if err != nil {
		return err
	}
	if err := s.transition(ctx, tx, attemptID, to, actor); err != nil {
		return err // engine returns RoleError for non-superiors
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE negotiation_proposals SET decision_note = ?
		  WHERE attempt_id = ? AND decision_note IS NULL
		  ORDER BY version_no DESC LIMIT 1`, note, attemptID); err != nil {
		return err
	}
	if err := s.emitDecision(ctx, tx, actor, a, attemptID); err != nil {
		return err
	}
	return tx.Commit()
}

// AcceptCounter is the salesperson accepting the superior's counter-offer
// (M0 §5 line 122 — "system syncs values"): Negotiation - Revision Required →
// Negotiation - Approved. Owner-driven (DECISIONS O18).
func (s *Service) AcceptCounter(ctx context.Context, actor permission.Actor, attemptID string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	a, err := loadAttempt(ctx, tx, attemptID, true)
	if err != nil {
		return err
	}
	if !canWriteAttempt(actor, a.ownerID) {
		return &blockedError{msgDenied}
	}
	if err := s.transition(ctx, tx, attemptID, StatusNegApproved, actor); err != nil {
		return err
	}
	return tx.Commit()
}

// ---- helpers ---------------------------------------------------------------

// standardLines builds proposal lines from the Qualified Form snapshot (no-nego
// path takes standard price + commission verbatim).
func (s *Service) standardLines(ctx context.Context, tx *sql.Tx, attemptID string) ([]ProposalLine, error) {
	rows, err := tx.QueryContext(ctx,
		`SELECT master_service_id, standard_price, commission_rule
		   FROM qualified_form_services WHERE attempt_id = ? ORDER BY id`, attemptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ProposalLine
	for rows.Next() {
		var l ProposalLine
		if err := rows.Scan(&l.MasterServiceID, &l.ProposedPrice, &l.CommissionRule); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, ErrIncomplete
	}
	return out, nil
}

// writeProposal appends a new immutable proposal version + its lines. Each
// line's commission_rule and price are validated (money math never guessed).
func (s *Service) writeProposal(ctx context.Context, tx *sql.Tx, actor permission.Actor, attemptID string, lines []ProposalLine) error {
	if len(lines) == 0 || len(lines) > MaxServices {
		return ErrIncomplete
	}
	var maxVer sql.NullInt64
	if err := tx.QueryRowContext(ctx,
		`SELECT MAX(version_no) FROM negotiation_proposals WHERE attempt_id = ?`, attemptID).Scan(&maxVer); err != nil {
		return err
	}
	version := int(maxVer.Int64) + 1

	propID, err := ident.Next(ctx, tx, "NEG", time.Now())
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO negotiation_proposals (id, attempt_id, version_no, proposed_by, created_by)
		 VALUES (?, ?, ?, ?, ?)`, propID, attemptID, version, actor.EmployeeID, actor.EmployeeID); err != nil {
		return err
	}
	for _, l := range lines {
		if l.MasterServiceID == "" || l.ProposedPrice == "" || l.CommissionRule == "" {
			return ErrIncomplete
		}
		// Validate the commission rule (and, implicitly, that it is one of the
		// two accepted shapes) before persisting.
		if _, err := ParseCommissionRule(l.CommissionRule); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO negotiation_proposal_lines
			   (proposal_id, master_service_id, proposed_price, commission_rule, payment_terms, created_by)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			propID, l.MasterServiceID, l.ProposedPrice, l.CommissionRule, nullString(l.PaymentTerms), actor.EmployeeID); err != nil {
			return err
		}
	}
	return audit.Write(ctx, tx, audit.Record{
		EntityType: "prospect_attempt", EntityID: attemptID, Actor: actor.EmployeeID,
		Action: "negotiation_version", After: map[string]any{"proposal_id": propID, "version_no": version, "lines": len(lines)},
	})
}

func (s *Service) emitPendingApproval(ctx context.Context, tx *sql.Tx, actor permission.Actor, a attemptInfo, attemptID string) error {
	if s.Catalog == nil {
		return nil
	}
	_, err := s.Catalog.Emit(ctx, tx, notification.Emission{
		Event: notification.EvNegotiationPendingApproval, EntityType: "prospect_attempt", EntityID: attemptID,
		Actor: actor.EmployeeID, Division: SalesDivision,
	})
	return err
}

func (s *Service) emitDecision(ctx context.Context, tx *sql.Tx, actor permission.Actor, a attemptInfo, attemptID string) error {
	if s.Catalog == nil {
		return nil
	}
	_, err := s.Catalog.Emit(ctx, tx, notification.Emission{
		Event: notification.EvNegotiationDecision, EntityType: "prospect_attempt", EntityID: attemptID,
		Actor: actor.EmployeeID, Division: SalesDivision, ExplicitRecipients: []string{a.ownerID},
	})
	return err
}

// finishTx commits tx when the step succeeded, otherwise propagates the error
// (the deferred Rollback then fires).
func finishTx(tx *sql.Tx, stepErr error) error {
	if stepErr != nil {
		return stepErr
	}
	return tx.Commit()
}
