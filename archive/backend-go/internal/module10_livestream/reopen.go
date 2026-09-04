// Live Stream Brief reopening (DECISIONS O27 / W2-M10-C2): a Brief once closed to
// [Approved] may be reopened back to [Dispatched to Vendor] to add Sessions for a
// recurring package's running period (M10-OA-4). This is an off-machine audited action
// (ls_brief_reopened — simetris ls_brief_reconciled), allowed ONLY from [Approved],
// ONLY for a Live-Stream-division Brief, NEVER for a voided Brief; actor gate = owning
// AM or Director (same §6.1 write gate as Sessions). After reopen, the existing roll-up
// re-closes the Brief once ALL Sessions (old + new) are [Reconciled].
package module10_livestream

import (
	"context"
	"database/sql"
	"errors"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// ReopenBrief reopens an [Approved] Live Stream Brief back to [Dispatched to Vendor]
// (DECISIONS O27 / W2-M10-C2: one off-machine audited action, M10-OA-4). Only the
// owning AM or Director may reopen. All Sessions of the Brief are unaffected; once
// new Sessions are added and reconciled, the Brief rolls up again to [Approved]
// (idempotent via rollupBriefOnReconcile). Creatable only from [Approved] status.
func (s *Service) ReopenBrief(ctx context.Context, actor permission.Actor, briefID string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Lock the Brief and fetch its status, division, and owning AM.
	var division, briefStatus string
	var ownerAM sql.NullString
	err = tx.QueryRowContext(ctx,
		`SELECT b.assigned_division, b.status, c.assigned_am_id
		   FROM briefs b
		   JOIN services sv ON sv.id = b.service_id
		   JOIN clients c ON c.id = sv.client_id
		  WHERE b.id = ? FOR UPDATE`, briefID).
		Scan(&division, &briefStatus, &ownerAM)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrBriefNotFound
	}
	if err != nil {
		return err
	}

	// Guard: must be a Live Stream Brief.
	if division != LiveStreamDivision {
		return ErrNotLiveStreamBrief
	}

	// Guard: brief voided accepts no reopening.
	if briefStatus == BriefVoided {
		return ErrBriefVoided
	}

	// Guard: permission — owning AM or Director only (same gate as create/manage Session).
	if !canManageSession(actor, ownerAM.String) {
		return ErrBriefReopenForbidden
	}

	// Guard: only [Approved] Briefs can be reopened.
	if briefStatus != BriefApproved {
		return ErrBriefNotReopenable
	}

	// Reopen: UPDATE Brief status from [Approved] to [Dispatched to Vendor].
	if _, err := tx.ExecContext(ctx,
		`UPDATE briefs SET status = ? WHERE id = ?`, BriefVendorDispatched, briefID); err != nil {
		return err
	}

	// Audit the off-machine action (simetris ls_brief_reconciled in rollup.go).
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "brief", EntityID: briefID, Actor: actor.EmployeeID, Action: "ls_brief_reopened",
		Before: map[string]any{"status": BriefApproved},
		After:  map[string]any{"status": BriefVendorDispatched},
	}); err != nil {
		return err
	}

	return tx.Commit()
}
