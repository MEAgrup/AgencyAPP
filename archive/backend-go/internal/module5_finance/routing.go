package module5_finance

// routing.go is the routing gate (W1-16, M5 §5, M5-OA-1): the FIRST confirmed
// payment releases the Client Record to Account intake. It runs inside the
// verification transaction (verification.go) so the release is atomic with the
// payment-status transition that triggered it.

import (
	"context"
	"database/sql"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// applyRoutingGate stamps released_to_account_at on BOTH the transaction and its
// client the first time payment status leaves [Menunggu Verifikasi] into a
// verified state (M5 §5 Rule 1). It is fire-once: the timestamp is only written
// when still NULL, so a later verification never overwrites it (M5 §5 example).
// The release is logged as an immutable event on the client, referencing the
// verification that triggered it (M5 §5 Rule 3).
//
// Notification note (M5 §5 Flow 3 mentions "Account is notified"): the frozen
// notification catalog has no "released to Account" event, so this fires only
// the audit log for now — deferral recorded in docs/DECISIONS.md.
func (s *Service) applyRoutingGate(ctx context.Context, tx *sql.Tx, actor permission.Actor, transactionID, clientID, from, to string, triggerVerID int64) error {
	if !ReleasesToAccount(from, to) {
		return nil
	}

	// Fire-once on the transaction (the TRX row is already locked FOR UPDATE by
	// the caller). If somehow already stamped, do nothing.
	res, err := tx.ExecContext(ctx,
		`UPDATE transactions SET released_to_account_at = NOW()
		  WHERE id = ? AND released_to_account_at IS NULL`, transactionID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return nil // already released; never overwrite (fire-once).
	}

	// Mirror onto the client row (M4 visibility filters on this column) — also
	// fire-once guarded.
	if _, err := tx.ExecContext(ctx,
		`UPDATE clients SET released_to_account_at = NOW()
		  WHERE id = ? AND released_to_account_at IS NULL`, clientID); err != nil {
		return err
	}

	return audit.Write(ctx, tx, audit.Record{
		EntityType: "client", EntityID: clientID, Actor: actor.EmployeeID,
		Action: "released_to_account",
		After: map[string]any{
			"transaction_id":  transactionID,
			"verification_id": triggerVerID,
			"payment_status":  to,
		},
	})
}
