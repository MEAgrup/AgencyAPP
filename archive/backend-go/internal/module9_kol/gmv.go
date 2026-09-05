// Attributed GMV write-back (M9 §10.3 / M9-OA-4). Where a Booking's content carries a
// trackable affiliate/shop link, the GMV that link drove is a FEEDBACK signal a human
// (the Booking's Coordinator, reading the affiliate platform) records MANUALLY per
// Booking. The system NEVER estimates it (§11): where no trackable link exists the
// figure simply stays NULL. NULL (no data — rendered "—") is semantically DISTINCT
// from a recorded 0 (a live link that drove no sales); the nullable attributed_gmv
// column (migration 0027) carries exactly that distinction.
//
// This is a plain overwrite-and-audit field edit — the latest reading wins while the
// immutable before→after history stays in the audit log (house rules 3/4), mirroring
// the Hours Logged pattern (assign.go). It is NOT a lifecycle status, so it never
// touches the transition engine. It is a read-only auto-fed field on the Booking: the
// stored value is surfaced by GetBooking (read.go), no separate report is built here
// (Monthly KOL Report §9 stays deferred to M14).
package module9_kol

import (
	"context"
	"database/sql"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// RecordAttributedGMV writes back the Attributed GMV for a Booking (§10.3 / M9-OA-4).
// The value is parsed through the shared money core; a negative or unparseable figure
// is rejected as an invalid money value (§4 house rule 5 / reused ErrBadAmount). Zero
// is a LEGITIMATE reading (a link that drove no sales) and is accepted — only a
// missing figure stays NULL, and this method never writes NULL.
//
// Write authority (PRD silent → consistent proposal, logged for sign-off): the
// Booking's assigned Coordinator (who owns the creator relationship and reads the
// affiliate platform), the KOL Team Leader, or the Director — exactly the Hours Logged
// gate (canLogHours). Recordable only once the Booking is [QC Passed] (see
// ErrGMVBookingNotPassed). Returns the stored rupiah value and its house display.
func (s *Service) RecordAttributedGMV(ctx context.Context, actor permission.Actor, bookingID, gmvStr string) (float64, string, error) {
	gmv, err := money.Parse(gmvStr)
	if err != nil || gmv < 0 {
		return 0, "", ErrBadAmount
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, "", err
	}
	defer tx.Rollback()

	r, err := lockBooking(ctx, tx, bookingID)
	if err != nil {
		return 0, "", err
	}
	if !canLogHours(actor, r) {
		return 0, "", ErrExecForbidden
	}
	if r.status != BkgQCPassed {
		return 0, "", ErrGMVBookingNotPassed
	}
	var prev sql.NullFloat64
	if err := tx.QueryRowContext(ctx,
		`SELECT attributed_gmv FROM creator_bookings WHERE id = ?`, bookingID).Scan(&prev); err != nil {
		return 0, "", err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE creator_bookings SET attributed_gmv = ? WHERE id = ?`, gmv.Decimal(), bookingID); err != nil {
		return 0, "", err
	}
	var prevVal any // NULL (no prior data) stays nil in the log, distinct from 0
	if prev.Valid {
		prevVal = prev.Float64
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "creator_booking", EntityID: bookingID, Actor: actor.EmployeeID, Action: "attributed_gmv_recorded",
		Before: map[string]any{"attributed_gmv": prevVal},
		After:  map[string]any{"attributed_gmv": float64(gmv) / 100},
	}); err != nil {
		return 0, "", err
	}
	if err := tx.Commit(); err != nil {
		return 0, "", err
	}
	return float64(gmv) / 100, gmv.Format(), nil
}
