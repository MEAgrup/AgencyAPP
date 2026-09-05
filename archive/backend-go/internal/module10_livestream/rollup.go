// Session → Live Stream Brief roll-up (M10 §2/§4): "The Brief itself closes to
// [Approved] once its Session(s) reach [Reconciled]." The Live Stream Brief is
// OFF-MACHINE — born [Dispatched to Vendor], it never joined the canonical brief_task
// machine (STATE_MACHINES §7; DECISIONS W2-M6-C3). So it CANNOT be driven by the
// engine; instead — exactly like the void cascade handles an off-machine LS Brief
// (module4_client.VoidService, audit action void_cascade_offmachine) — the close to
// [Approved] is a direct, audited UPDATE (action ls_brief_reconciled), NOT an engine
// transition. This resolves the W2-M6-C3 butir-8 open item (LS Brief lifecycle).
//
// Void interaction (scope): a Brief already [Cancelled — Service Voided] never rolls
// up — it is left untouched. An already-[Approved] Brief is a no-op (idempotent).
package module10_livestream

import (
	"context"
	"database/sql"
	"errors"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// rollupBriefOnReconcile closes the parent Live Stream Brief to [Approved] when every
// one of its Sessions has reached [Reconciled] (and there is at least one), inside the
// caller's transaction. Off-machine (audited UPDATE, not the engine). Idempotent and
// forward-only: it only fires while the Brief is still [Dispatched to Vendor]; a voided
// or already-approved Brief is left alone.
func (s *Service) rollupBriefOnReconcile(ctx context.Context, tx *sql.Tx, actor permission.Actor, briefID string) error {
	if briefID == "" {
		return nil
	}
	var briefStatus string
	err := tx.QueryRowContext(ctx,
		`SELECT status FROM briefs WHERE id = ? FOR UPDATE`, briefID).Scan(&briefStatus)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrBriefNotFound
	}
	if err != nil {
		return err
	}
	// Only a still-dispatched Brief closes here. A voided Brief never rolls up; an
	// already-[Approved] Brief is a no-op.
	if briefStatus != BriefVendorDispatched {
		return nil
	}

	// Count this Brief's Sessions and how many are [Reconciled].
	var total, reconciled int
	if err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*), COALESCE(SUM(status = ?), 0) FROM live_stream_sessions WHERE brief_id = ?`,
		LssReconciled, briefID).Scan(&total, &reconciled); err != nil {
		return err
	}
	if total == 0 || reconciled != total {
		return nil // not every Session reconciled yet (need >= 1 and all)
	}

	// All Sessions reconciled → close the off-machine Brief to [Approved] (audited).
	if _, err := tx.ExecContext(ctx,
		`UPDATE briefs SET status = ? WHERE id = ?`, BriefApproved, briefID); err != nil {
		return err
	}
	return audit.Write(ctx, tx, audit.Record{
		EntityType: "brief", EntityID: briefID, Actor: actor.EmployeeID, Action: "ls_brief_reconciled",
		Before: map[string]any{"status": BriefVendorDispatched},
		After:  map[string]any{"status": BriefApproved, "reconciled_sessions": total},
	})
}
