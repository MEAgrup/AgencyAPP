// Read paths + the shared §10.1 read predicate. All derived fields (Revision Count,
// Payment Status reflection) are computed from the immutable log / linked rows at
// read time (house rules 3/4), never stored on the Booking.
package module9_kol

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

const bookingSelect = `SELECT bk.id, bk.brief_id, bk.creator_name, COALESCE(bk.creator_handle,''),
	        bk.platform, COALESCE(bk.niche,''), bk.source_pool, COALESCE(bk.pool_reference,''),
	        bk.agreed_rate, bk.status, COALESCE(bk.content_link,''), COALESCE(bk.qc_notes,''),
	        bk.sla_target_hours, bk.hours_logged, COALESCE(bk.assigned_coordinator,''), bk.attributed_gmv,
	        bk.created_by, bk.created_at, b.assigned_division, c.assigned_am_id
	   FROM creator_bookings bk
	   JOIN briefs b ON b.id = bk.brief_id
	   JOIN services sv ON sv.id = b.service_id
	   JOIN clients c ON c.id = sv.client_id`

// GetBooking returns one Booking with its derived Revision Count and Payment Status
// reflection, if the actor may see it (§10.1): OD/Director everywhere; Account lead
// (division-wide); the owning AM; and staff/lead of the Brief's KOL division.
func (s *Service) GetBooking(ctx context.Context, actor permission.Actor, bookingID string) (Booking, error) {
	b, division, ownerAM, err := s.loadBooking(ctx, bookingID)
	if err != nil {
		return Booking{}, err
	}
	if !canSeeBooking(actor, ownerAM, division) {
		return Booking{}, ErrBookingViewForbidden
	}
	entries, err := audit.List(ctx, s.DB, audit.Filter{EntityType: "creator_booking", EntityID: bookingID})
	if err != nil {
		return Booking{}, err
	}
	b.RevisionCount = deriveRevisionCount(entries)
	ps, err := s.paymentReflection(ctx, bookingID)
	if err != nil {
		return Booking{}, err
	}
	b.PaymentStatus = ps
	return b, nil
}

// ListBriefBookings returns all Bookings of a KOL Brief (fan-out progress), ordered
// by id. Same read gate, resolved from the parent Brief's division/owner.
func (s *Service) ListBriefBookings(ctx context.Context, actor permission.Actor, briefID string) ([]Booking, error) {
	var division string
	var ownerAM sql.NullString
	err := s.DB.QueryRowContext(ctx,
		`SELECT b.assigned_division, c.assigned_am_id
		   FROM briefs b JOIN services sv ON sv.id = b.service_id JOIN clients c ON c.id = sv.client_id
		  WHERE b.id = ?`, briefID).Scan(&division, &ownerAM)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrBriefNotFound
	}
	if err != nil {
		return nil, err
	}
	if !canSeeBooking(actor, ownerAM.String, division) {
		return nil, ErrBookingViewForbidden
	}
	rows, err := s.DB.QueryContext(ctx, bookingSelect+` WHERE bk.brief_id = ? ORDER BY bk.id ASC`, briefID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Booking{}
	for rows.Next() {
		b, _, _, err := scanBooking(rows)
		if err != nil {
			return nil, err
		}
		// Fill derived fields per row (revision count + payment reflection).
		entries, err := audit.List(ctx, s.DB, audit.Filter{EntityType: "creator_booking", EntityID: b.ID})
		if err != nil {
			return nil, err
		}
		b.RevisionCount = deriveRevisionCount(entries)
		ps, err := s.paymentReflection(ctx, b.ID)
		if err != nil {
			return nil, err
		}
		b.PaymentStatus = ps
		out = append(out, b)
	}
	return out, rows.Err()
}

// GetPaymentRequest returns one Creator Payment Request if the actor may see the
// parent Booking (same read gate as the Booking).
func (s *Service) GetPaymentRequest(ctx context.Context, actor permission.Actor, requestID string) (PaymentRequest, error) {
	var pr PaymentRequest
	var amountStr string
	var rejReason, paidBy sql.NullString
	var division string
	var ownerAM sql.NullString
	err := s.DB.QueryRowContext(ctx,
		`SELECT cpr.id, cpr.booking_id, cpr.amount, cpr.payment_details, cpr.status,
		        cpr.rejection_reason, cpr.requested_by, cpr.paid_by, cpr.created_by, cpr.created_at,
		        b.assigned_division, c.assigned_am_id
		   FROM creator_payment_requests cpr
		   JOIN creator_bookings bk ON bk.id = cpr.booking_id
		   JOIN briefs b ON b.id = bk.brief_id
		   JOIN services sv ON sv.id = b.service_id
		   JOIN clients c ON c.id = sv.client_id
		  WHERE cpr.id = ?`, requestID).
		Scan(&pr.ID, &pr.BookingID, &amountStr, &pr.PaymentDetails, &pr.Status,
			&rejReason, &pr.RequestedBy, &paidBy, &pr.CreatedBy, &pr.CreatedAt, &division, &ownerAM)
	if errors.Is(err, sql.ErrNoRows) {
		return PaymentRequest{}, ErrPaymentRequestNotFound
	}
	if err != nil {
		return PaymentRequest{}, err
	}
	// Finance may always read payment requests (executing side); otherwise the
	// Booking's read gate applies.
	if !(canFinance(actor) || canSeeBooking(actor, ownerAM.String, division)) {
		return PaymentRequest{}, ErrBookingViewForbidden
	}
	amt, err := money.Parse(amountStr)
	if err != nil {
		return PaymentRequest{}, err
	}
	pr.Amount = float64(amt) / 100
	pr.AmountDisplay = amt.Format()
	pr.RejectionReason = rejReason.String
	pr.PaidBy = paidBy.String
	return pr, nil
}

// paymentReflection returns the Booking's Payment Status = the status of its most
// recent Creator Payment Request (§8 Rule 4). Empty string when no request exists.
func (s *Service) paymentReflection(ctx context.Context, bookingID string) (string, error) {
	var status string
	err := s.DB.QueryRowContext(ctx,
		`SELECT status FROM creator_payment_requests WHERE booking_id = ? ORDER BY id DESC LIMIT 1`,
		bookingID).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return status, nil
}

// canSeeBooking is the §10.1 read predicate (mirrors module7.canSeeAsset).
func canSeeBooking(a permission.Actor, ownerAM, division string) bool {
	if a.CanReadAll() { // OD / Director
		return true
	}
	if a.CanReadDivision(AccountDivision) { // Account lead (division-wide)
		return true
	}
	if a.EmployeeID == ownerAM { // owning AM
		return true
	}
	return a.Role.Division == division &&
		(a.Role.Level == permission.LevelStaff || a.Role.Level == permission.LevelLead)
}

// loadBooking returns one Booking plus its Brief division and owning AM (read gate).
func (s *Service) loadBooking(ctx context.Context, bookingID string) (Booking, string, string, error) {
	row := s.DB.QueryRowContext(ctx, bookingSelect+` WHERE bk.id = ?`, bookingID)
	b, division, ownerAM, err := scanBooking(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Booking{}, "", "", ErrBookingNotFound
	}
	if err != nil {
		return Booking{}, "", "", err
	}
	return b, division, ownerAM, nil
}

// scanner is satisfied by *sql.Row and *sql.Rows.
type scanner interface {
	Scan(dest ...any) error
}

func scanBooking(sc scanner) (Booking, string, string, error) {
	var b Booking
	var rateStr string
	var sla, hours, gmv sql.NullFloat64
	var division string
	var ownerAM sql.NullString
	if err := sc.Scan(&b.ID, &b.BriefID, &b.CreatorName, &b.CreatorHandle, &b.Platform, &b.Niche,
		&b.SourcePool, &b.PoolReference, &rateStr, &b.Status, &b.ContentLink, &b.QCNotes,
		&sla, &hours, &b.AssignedCoordinator, &gmv, &b.CreatedBy, &b.CreatedAt, &division, &ownerAM); err != nil {
		return Booking{}, "", "", err
	}
	rate, err := money.Parse(rateStr)
	if err != nil {
		return Booking{}, "", "", err
	}
	b.AgreedRate = float64(rate) / 100
	b.AgreedRateDisplay = rate.Format()
	b.SLATargetHours = nullFloatPtr(sla)
	b.HoursLogged = nullFloatPtr(hours)
	b.AttributedGMV = nullFloatPtr(gmv)
	return b, division, ownerAM.String, nil
}

// deriveRevisionCount counts [QC Review] -> [QC Failed - Revision Requested]
// transitions in the immutable audit log (§5 Rule 5 — derived, never stored).
func deriveRevisionCount(entries []audit.Entry) int {
	n := 0
	want := "transition:" + BkgQCReview + "->" + BkgQCFailed
	for _, e := range entries {
		if e.Action == want {
			n++
		}
	}
	return n
}

func nullFloatPtr(v sql.NullFloat64) *float64 {
	if !v.Valid {
		return nil
	}
	f := v.Float64
	return &f
}

func trim(s string) string { return strings.TrimSpace(s) }
