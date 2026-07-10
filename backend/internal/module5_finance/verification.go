package module5_finance

// verification.go is the payment-verification write flow (W1-15, M5 §3–4 + §7).
// It is the ONLY place Payment Status advances, always through the frozen rollup
// math (DesiredStatus) and the state-machine engine. Every verification appends
// an immutable payment_verifications row (M5 §7 Rule 1: one proof per event) and,
// on the first confirmed money in, fires the routing gate (routing.go, W1-16).

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// VerifyRequest is one verification event. InstallmentID is optional: set it to
// satisfy a specific INST- row (Termin / Bayar di Belakang); leave it empty for a
// direct verification (Lunas single payment / Bayar Sebagian upfront partial).
// Proof is optional (recommended, M5 §8.4).
type VerifyRequest struct {
	InstallmentID string
	Amount        money.Money
	ReceivedDate  time.Time
	Proof         string
}

// Verify confirms actual receipt of money against a transaction (M5 §3). Only
// Admin & Finance (staff/lead) or Director may verify; everyone else is denied
// with the transition-forbidden message. The whole operation is one DB
// transaction: over-verification, the per-installment amount rule, the [Lunas]
// contract gate (M5 §7 Rule 2) and the routing gate all commit or roll back
// together, so a blocked verification leaves no trace.
func (s *Service) Verify(ctx context.Context, actor permission.Actor, transactionID string, req VerifyRequest) (TransactionRecord, error) {
	if !canVerify(actor) {
		return TransactionRecord{}, ErrForbidden
	}
	if req.Amount <= 0 || req.ReceivedDate.IsZero() {
		return TransactionRecord{}, ErrIncomplete
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return TransactionRecord{}, err
	}
	defer tx.Rollback()

	// Lock the TRX row and read authoritative state.
	var total, status, clientID string
	var contract sql.NullString
	var releasedAt sql.NullTime
	err = tx.QueryRowContext(ctx,
		`SELECT total_agreed_value, payment_status, client_id, contract_attachment, released_to_account_at
		   FROM transactions WHERE id = ? FOR UPDATE`, transactionID).Scan(&total, &status, &clientID, &contract, &releasedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return TransactionRecord{}, ErrNotFound
	}
	if err != nil {
		return TransactionRecord{}, err
	}
	totalMoney, err := money.Parse(total)
	if err != nil {
		return TransactionRecord{}, err
	}

	// Current aggregate (pre-event) for the over-verification guard.
	insts, err := loadInstallments(ctx, tx, transactionID)
	if err != nil {
		return TransactionRecord{}, err
	}
	direct, err := directVerifiedTotal(ctx, tx, transactionID)
	if err != nil {
		return TransactionRecord{}, err
	}
	pre := aggregate(totalMoney, insts, direct)
	if err := CheckVerification(totalMoney, pre.AmountVerified(), req.Amount); err != nil {
		return TransactionRecord{}, err // ErrOverVerified / ErrEmptySchedule (PRD-verbatim)
	}

	// Branch: per-installment vs direct verification.
	if req.InstallmentID != "" {
		if err := s.verifyInstallment(ctx, tx, actor, transactionID, req); err != nil {
			return TransactionRecord{}, err
		}
	} else {
		if len(insts) > 0 {
			return TransactionRecord{}, ErrDirectOnScheduled
		}
		if err := insertVerification(ctx, tx, actor, transactionID, "", req); err != nil {
			return TransactionRecord{}, err
		}
	}

	// The verification row that (may) trigger the routing gate.
	var triggerVerID int64
	if err := tx.QueryRowContext(ctx,
		`SELECT id FROM payment_verifications WHERE transaction_id = ? ORDER BY id DESC LIMIT 1`, transactionID).Scan(&triggerVerID); err != nil {
		return TransactionRecord{}, err
	}

	// Recompute the aggregate AFTER the event and drive the payment status.
	insts, err = loadInstallments(ctx, tx, transactionID)
	if err != nil {
		return TransactionRecord{}, err
	}
	direct, err = directVerifiedTotal(ctx, tx, transactionID)
	if err != nil {
		return TransactionRecord{}, err
	}
	desired := aggregate(totalMoney, insts, direct).DesiredStatus()

	if desired != status {
		// [Lunas] contract gate (M5 §7 Rule 2): block the WHOLE verification if the
		// contract is missing. Rollback leaves no log written.
		if desired == TrxLunas && !contract.Valid {
			return TransactionRecord{}, ErrContractRequired
		}
		res, err := s.Engine.Transition(ctx, tx, statemachine.Request{
			Machine:      statemachine.MTransactionPayment,
			EntityType:   "transaction",
			Table:        "transactions",
			StatusColumn: "payment_status",
			EntityID:     transactionID,
			To:           desired,
			Actor:        actor,
		})
		if err != nil {
			return TransactionRecord{}, err
		}
		// Routing gate: first confirmed money in releases the client (W1-16).
		if err := s.applyRoutingGate(ctx, tx, actor, transactionID, clientID, res.From, res.To, triggerVerID); err != nil {
			return TransactionRecord{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return TransactionRecord{}, err
	}
	return s.LoadTransaction(ctx, actor, transactionID)
}

// verifyInstallment verifies one INST- row in full: the amount must equal the
// installment amount (per-installment partials are not in the PRD). It writes
// the verification log + the installment's non-status columns, then drives the
// installment to [Terverifikasi] through the engine (which blocks an already-
// verified/terminal row with [transisi status tidak diizinkan]).
func (s *Service) verifyInstallment(ctx context.Context, tx *sql.Tx, actor permission.Actor, transactionID string, req VerifyRequest) error {
	var instTrx, amtStr string
	err := tx.QueryRowContext(ctx,
		`SELECT transaction_id, amount FROM installments WHERE id = ? FOR UPDATE`, req.InstallmentID).Scan(&instTrx, &amtStr)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrInstallmentNotInTrx
	}
	if err != nil {
		return err
	}
	if instTrx != transactionID {
		return ErrInstallmentNotInTrx
	}
	instAmt, err := money.Parse(amtStr)
	if err != nil {
		return err
	}
	if req.Amount != instAmt {
		return ErrInstallmentAmount
	}

	if err := insertVerification(ctx, tx, actor, transactionID, req.InstallmentID, req); err != nil {
		return err
	}
	// The only non-status columns written on an installment: verification detail.
	var proof any
	if req.Proof != "" {
		proof = req.Proof
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE installments SET verified_date = ?, verified_by = ?, proof_of_payment = ? WHERE id = ?`,
		req.ReceivedDate.Format("2006-01-02"), actor.EmployeeID, proof, req.InstallmentID); err != nil {
		return err
	}
	if _, err := s.Engine.Transition(ctx, tx, statemachine.Request{
		Machine:    statemachine.MInstallment,
		EntityType: "installment",
		Table:      "installments",
		EntityID:   req.InstallmentID,
		To:         InstTerverifikasi,
		Actor:      actor,
	}); err != nil {
		return err
	}
	// [Jatuh Tempo] is a parallel flag, not the status itself (M5 §2) — clear
	// it automatically now that this installment is verified (W1-17).
	if _, err := tx.ExecContext(ctx,
		`UPDATE installments SET jatuh_tempo = 0 WHERE id = ?`, req.InstallmentID); err != nil {
		return err
	}
	return nil
}

// insertVerification appends one immutable verification event (M5 §7 Rule 1).
func insertVerification(ctx context.Context, tx *sql.Tx, actor permission.Actor, transactionID, installmentID string, req VerifyRequest) error {
	var instArg, proofArg any
	if installmentID != "" {
		instArg = installmentID
	}
	if req.Proof != "" {
		proofArg = req.Proof
	}
	_, err := tx.ExecContext(ctx,
		`INSERT INTO payment_verifications (transaction_id, installment_id, amount, received_date, proof_of_payment, verified_by, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		transactionID, instArg, req.Amount.Decimal(), req.ReceivedDate.Format("2006-01-02"), proofArg, actor.EmployeeID, actor.EmployeeID)
	return err
}

// AttachContract sets/supersedes the Transaction's contract attachment (M5 §7
// Rule 4 — superseding is logged, never deleted). Authority: Finance, the
// client's Sales PIC / allocation member / Sales Lead, or Director.
func (s *Service) AttachContract(ctx context.Context, actor permission.Actor, transactionID, link string) error {
	if link == "" {
		return ErrIncomplete
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var clientID, salesPIC string
	var before sql.NullString
	err = tx.QueryRowContext(ctx,
		`SELECT t.client_id, c.sales_pic_id, t.contract_attachment
		   FROM transactions t JOIN clients c ON c.id = t.client_id
		  WHERE t.id = ? FOR UPDATE`, transactionID).Scan(&clientID, &salesPIC, &before)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	member, err := isAllocationMember(ctx, tx, clientID, actor.EmployeeID)
	if err != nil {
		return err
	}
	if !canAttachContract(actor, salesPIC, member) {
		return ErrForbidden
	}

	if _, err := tx.ExecContext(ctx,
		`UPDATE transactions SET contract_attachment = ? WHERE id = ?`, link, transactionID); err != nil {
		return err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "transaction", EntityID: transactionID, Actor: actor.EmployeeID,
		Action: "contract:attached",
		Before: map[string]string{"contract_attachment": before.String},
		After:  map[string]string{"contract_attachment": link},
	}); err != nil {
		return err
	}
	return tx.Commit()
}

// canVerify: Admin & Finance (any level) or Director (M5 §3 Rule 5 / §8.1).
func canVerify(a permission.Actor) bool {
	if a.Role.Director {
		return true
	}
	return a.Role.Division == FinanceDivision
}

func canAttachContract(a permission.Actor, salesPIC string, allocationMember bool) bool {
	if a.Role.Director {
		return true
	}
	switch a.Role.Division {
	case FinanceDivision:
		return true
	case SalesDivision:
		return a.Role.Level == permission.LevelLead || a.EmployeeID == salesPIC || allocationMember
	}
	return false
}
