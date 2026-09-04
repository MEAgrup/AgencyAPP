package module4_client

// intent.go is the Payment-Intent handoff (W1-13, M4 §5): the Sales PIC's
// single client-level declaration that routes the Client Record into Admin &
// Finance's queue. It is a bridge, not a duplicate of Module 5 — the intent is
// stamped on BOTH clients.payment_intent (Module 4's own field) and the
// linked transactions.payment_intent_scheme (M5 §8.3: "Set by Sales (Module 4
// §5); changeable by Finance with logged reason"), in one DB transaction, with
// a before->after audit row on each entity.
//
// Once Finance has recorded ANY verification, or the Transaction has moved
// off [Menunggu Verifikasi], the scheme becomes Finance's to change — Module
// 5's existing ChangeScheme (M5-OA-6, module5_finance.Service.ChangeScheme,
// W1-14) is the only path from that point on; this file refuses the edit and
// points the caller there (ErrIntentLocked) instead of duplicating that logic.
//
// Handoff notification (M4 §5 Flow 2, "system ... notifies Finance") has no
// home in the frozen notification catalog (core/notification/notification.go)
// — no matching event exists, and the catalog cannot be extended unilaterally
// (docs/handoff/WAVE1_PARALLEL_PLAN.md §5). No event fires here; the deferral
// is logged in docs/DECISIONS.md (same precedent as W1-16's released-to-
// Account deferral). The Transaction is already visible to Finance from the
// moment M0/closing creates it at [Menunggu Verifikasi] (M5 §3 Rule 1), so
// nothing is functionally lost — only the notification ping is deferred.
//
// If the intent is Termin / Bayar di Belakang, the installment schedule is
// built through Module 5's existing CreateSchedule endpoint (W1-14, already
// wired at POST /api/v1/transactions/{id}/schedule) — this file never creates
// installments itself.

import (
	"context"
	"database/sql"
	"errors"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module5_finance"
)

// Payment Intent options — verbatim M4 §5 Rule 2. [Bayar Penuh (Lunas)] is the
// UI-default selection; the other three are equally valid choices. These
// alias module5_finance's scheme constants (the exact same stored string, the
// same field from two modules' perspective) rather than re-typing them, so
// the two packages can never silently drift apart.
const (
	IntentLunas           = module5_finance.SchemeLunas
	IntentBayarSebagian   = module5_finance.SchemeBayarSebagian
	IntentTermin          = module5_finance.SchemeTermin
	IntentBayarDiBelakang = module5_finance.SchemeBayarDiBelakang
)

// MsgIntentLocked: the handoff has already progressed past Sales' control — a
// verification exists, or the Transaction left [Menunggu Verifikasi]. Not a
// PRD-verbatim string (the PRD only states the rule, M5 §8.3); adopted
// following the W1-09/W1-14 precedent for engineering-authored BI messages
// (see docs/DECISIONS.md, logged alongside this ticket).
const MsgIntentLocked = "[transaksi sudah diverifikasi, perubahan skema pembayaran selanjutnya melalui Finance]"

var (
	// ErrIntentForbidden: only the client's Primary Sales PIC or Director may
	// set the handoff intent (M4 §5 Flow 1) — not another salesperson, an
	// allocation member, Sales Lead, Finance, Account, or OD.
	ErrIntentForbidden = errors.New(statemachine.RoleDeniedMessage)
	// ErrIntentLocked: Finance has already taken over the scheme (M5 §8.3).
	ErrIntentLocked = errors.New(MsgIntentLocked)
)

func validIntent(v string) bool {
	switch v {
	case IntentLunas, IntentBayarSebagian, IntentTermin, IntentBayarDiBelakang:
		return true
	}
	return false
}

// SetPaymentIntent is the M4 §5 handoff: the client's Primary Sales PIC (or
// Director) declares the payment scheme. This stamps BOTH the Client Record
// and its linked Transaction — the Transaction already sits in Finance's queue
// at [Menunggu Verifikasi] since M0/closing (M5 §3 Rule 1); this call only
// records which scheme Finance should expect to verify against.
//
// Blocked once Finance has recorded any verification, or the Transaction has
// moved off [Menunggu Verifikasi] — from that point the scheme belongs to
// Finance (ErrIntentLocked directs the caller to module5_finance.ChangeScheme,
// M5-OA-6).
func (s *Service) SetPaymentIntent(ctx context.Context, actor permission.Actor, clientID, intent string) error {
	if !validIntent(intent) {
		return ErrInvalidField
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var salesPIC, transactionID sql.NullString
	err = tx.QueryRowContext(ctx,
		`SELECT sales_pic_id, transaction_id FROM clients WHERE id = ? FOR UPDATE`, clientID).
		Scan(&salesPIC, &transactionID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	if !canSetIntent(actor, salesPIC.String) {
		return ErrIntentForbidden
	}
	if !transactionID.Valid || transactionID.String == "" {
		// Every client is born with a linked Transaction at closing (M4 §2);
		// this guards a malformed/legacy row, not a reachable user path.
		return ErrNotFound
	}

	var trxStatus, beforeScheme string
	err = tx.QueryRowContext(ctx,
		`SELECT payment_status, payment_intent_scheme FROM transactions WHERE id = ? FOR UPDATE`,
		transactionID.String).Scan(&trxStatus, &beforeScheme)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if trxStatus != module5_finance.TrxMenungguVerifikasi {
		return ErrIntentLocked
	}
	var verCount int
	if err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM payment_verifications WHERE transaction_id = ?`, transactionID.String).
		Scan(&verCount); err != nil {
		return err
	}
	if verCount > 0 {
		return ErrIntentLocked
	}

	var beforeIntent sql.NullString
	if err := tx.QueryRowContext(ctx,
		`SELECT payment_intent FROM clients WHERE id = ?`, clientID).Scan(&beforeIntent); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx,
		`UPDATE clients SET payment_intent = ? WHERE id = ?`, intent, clientID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE transactions SET payment_intent_scheme = ? WHERE id = ?`, intent, transactionID.String); err != nil {
		return err
	}

	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "client", EntityID: clientID, Actor: actor.EmployeeID,
		Action: "payment_intent:set",
		Before: map[string]string{"payment_intent": beforeIntent.String},
		After:  map[string]string{"payment_intent": intent},
	}); err != nil {
		return err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "transaction", EntityID: transactionID.String, Actor: actor.EmployeeID,
		Action: "payment_intent_scheme:set",
		Before: map[string]string{"payment_intent_scheme": beforeScheme},
		After:  map[string]string{"payment_intent_scheme": intent},
	}); err != nil {
		return err
	}

	return tx.Commit()
}

// canSetIntent: the client's Primary Sales PIC (identity match) or Director.
// Deliberately NOT level-gated — a Sales Lead who is not this client's PIC is
// denied the same as any other non-owning salesperson (M4 §5 Flow 1 names the
// Sales PIC specifically, not "any Sales role").
func canSetIntent(a permission.Actor, salesPIC string) bool {
	if a.Role.Director {
		return true
	}
	return a.Role.Division == SalesDivision && a.EmployeeID == salesPIC
}
