// Creator Payment Request (CPR-, M9 §8): KOL REQUESTS a creator payment; Admin &
// Finance (Module 5) EXECUTES it (§8 Rule 1 / M9-OA-5). The request side (create) is
// the Booking's Coordinator/Director; the executing side (receive/pay/reject) is
// Finance staff/lead or Director — the same verification discipline as client
// payments (M5), just outgoing. The lifecycle runs the creator_payment_request
// machine (STATE_MACHINES §9) through the engine (house rule 2). The Booking's
// Payment Status is a READ-ONLY reflection of the linked request (§8 Rule 4), derived
// at read time (read.go), never a mutable Booking column.
package module9_kol

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/ident"
	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// PaymentRequest is one Creator Payment Request (CPR-).
type PaymentRequest struct {
	ID              string    `json:"id"`
	BookingID       string    `json:"booking_id"`
	Amount          float64   `json:"amount"`
	AmountDisplay   string    `json:"amount_display"` // "Rp. X.XXX.XXX,00"
	PaymentDetails  string    `json:"payment_details"`
	Status          string    `json:"status"`
	RejectionReason string    `json:"rejection_reason,omitempty"`
	RequestedBy     string    `json:"requested_by"`
	PaidBy          string    `json:"paid_by,omitempty"`
	CreatedBy       string    `json:"created_by"`
	CreatedAt       time.Time `json:"created_at"`
}

// CreatePaymentRequest opens a Creator Payment Request once a Booking is [QC Passed]
// (§8 Rule 2). The Amount MUST equal the Booking's Agreed Rate; payment details are
// mandatory. Request side (§8): the Booking's Coordinator (or Director). Blocks if an
// active (non-[Rejected]) request already exists for the Booking.
func (s *Service) CreatePaymentRequest(ctx context.Context, actor permission.Actor, bookingID, amountStr, paymentDetails string) (PaymentRequest, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return PaymentRequest{}, err
	}
	defer tx.Rollback()

	r, err := lockBooking(ctx, tx, bookingID)
	if err != nil {
		return PaymentRequest{}, err
	}
	// Request side authority: the Booking's Coordinator or Director (canExecute is
	// exactly that gate — the assigned Coordinator, KOL lead, or Director).
	if !canExecute(actor, r) {
		return PaymentRequest{}, ErrPaymentManageForbidden
	}
	if r.status != BkgQCPassed {
		return PaymentRequest{}, ErrPaymentBookingNotPassed
	}
	if trim(paymentDetails) == "" {
		return PaymentRequest{}, ErrPaymentDetailsRequired
	}
	// Amount must match the Agreed Rate (§8 Rule 2 / §10.4).
	var rateStr string
	if err := tx.QueryRowContext(ctx,
		`SELECT agreed_rate FROM creator_bookings WHERE id = ?`, bookingID).Scan(&rateStr); err != nil {
		return PaymentRequest{}, err
	}
	rate, err := money.Parse(rateStr)
	if err != nil {
		return PaymentRequest{}, err
	}
	amount, err := money.Parse(amountStr)
	if err != nil {
		return PaymentRequest{}, ErrBadAmount
	}
	if amount != rate {
		return PaymentRequest{}, ErrPaymentAmountMismatch
	}
	// One active request at a time: a [Rejected] one may be superseded, others not.
	var active int
	if err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM creator_payment_requests WHERE booking_id = ? AND status <> ?`,
		bookingID, CprRejected).Scan(&active); err != nil {
		return PaymentRequest{}, err
	}
	if active > 0 {
		return PaymentRequest{}, ErrPaymentAlreadyRequested
	}

	id, err := ident.Next(ctx, tx, "CPR", time.Now())
	if err != nil {
		return PaymentRequest{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO creator_payment_requests
		   (id, booking_id, amount, payment_details, status, requested_by, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, bookingID, amount.Decimal(), trim(paymentDetails), CprRequested, actor.EmployeeID, actor.EmployeeID); err != nil {
		return PaymentRequest{}, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "creator_payment_request", EntityID: id, Actor: actor.EmployeeID, Action: "create",
		After: map[string]any{"status": CprRequested, "booking_id": bookingID, "amount": amount.Decimal()},
	}); err != nil {
		return PaymentRequest{}, err
	}
	if err := tx.Commit(); err != nil {
		return PaymentRequest{}, err
	}
	return PaymentRequest{
		ID: id, BookingID: bookingID, Amount: float64(amount) / 100, AmountDisplay: amount.Format(),
		PaymentDetails: trim(paymentDetails), Status: CprRequested, RequestedBy: actor.EmployeeID,
		CreatedBy: actor.EmployeeID, CreatedAt: time.Now(),
	}, nil
}

// ReceiveByFinance moves a request into Finance's queue: [Requested] → [Received by
// Finance] (§8 Flow 2). Finance staff/lead or Director.
func (s *Service) ReceiveByFinance(ctx context.Context, actor permission.Actor, requestID string) (statemachine.Result, error) {
	return s.driveCPR(ctx, actor, requestID, CprReceived, "")
}

// MarkPaid confirms disbursement: [Received by Finance] → [Paid] (§8 Flow 2, mirrors
// M5's verification discipline outgoing). Finance staff/lead or Director; records the
// paying Finance PIC. The Booking then reflects [Paid] on read (§8 Rule 4).
func (s *Service) MarkPaid(ctx context.Context, actor permission.Actor, requestID string) (statemachine.Result, error) {
	return s.driveCPR(ctx, actor, requestID, CprPaid, "")
}

// Reject flags an issue and sends the request back to KOL with a mandatory reason:
// [Received by Finance] → [Rejected] (§8 Rule 3). Finance staff/lead or Director.
func (s *Service) Reject(ctx context.Context, actor permission.Actor, requestID, reason string) (statemachine.Result, error) {
	if trim(reason) == "" {
		return statemachine.Result{}, ErrRejectionReasonRequired
	}
	return s.driveCPR(ctx, actor, requestID, CprRejected, reason)
}

// driveCPR is the shared Finance-side engine driver for the request lifecycle. All
// three edges are Finance-only (or Director); the engine records the transition and
// this writes the side columns (paid_by / rejection_reason) in the same transaction.
func (s *Service) driveCPR(ctx context.Context, actor permission.Actor, requestID, to, reason string) (statemachine.Result, error) {
	if !canFinance(actor) {
		return statemachine.Result{}, ErrFinanceForbidden
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return statemachine.Result{}, err
	}
	defer tx.Rollback()

	var status string
	err = tx.QueryRowContext(ctx,
		`SELECT status FROM creator_payment_requests WHERE id = ? FOR UPDATE`, requestID).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return statemachine.Result{}, ErrPaymentRequestNotFound
	}
	if err != nil {
		return statemachine.Result{}, err
	}
	res, err := s.engine().Transition(ctx, tx, statemachine.Request{
		Machine: statemachine.MCreatorPaymentReq, EntityType: "creator_payment_request", Table: "creator_payment_requests",
		EntityID: requestID, To: to, Actor: actor,
	})
	if err != nil {
		return statemachine.Result{}, err
	}
	switch to {
	case CprPaid:
		if _, err := tx.ExecContext(ctx,
			`UPDATE creator_payment_requests SET paid_by = ? WHERE id = ?`, actor.EmployeeID, requestID); err != nil {
			return statemachine.Result{}, err
		}
	case CprRejected:
		if _, err := tx.ExecContext(ctx,
			`UPDATE creator_payment_requests SET rejection_reason = ? WHERE id = ?`, trim(reason), requestID); err != nil {
			return statemachine.Result{}, err
		}
		if err := audit.Write(ctx, tx, audit.Record{
			EntityType: "creator_payment_request", EntityID: requestID, Actor: actor.EmployeeID, Action: "rejection_reason",
			After: map[string]any{"reason": trim(reason)},
		}); err != nil {
			return statemachine.Result{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return statemachine.Result{}, err
	}
	return res, nil
}

// canFinance: Admin & Finance (any level) or Director (§8 Rule 1, mirrors M5 canVerify).
func canFinance(a permission.Actor) bool {
	if a.Role.Director {
		return true
	}
	return a.Role.Division == FinanceDivision
}
