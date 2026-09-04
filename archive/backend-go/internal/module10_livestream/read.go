// Read paths + the shared §6.1 read predicate. GMV renders in the house IDR format
// (rule 7) at full vendor-reported value (M10-OA-5); the Data Confidence Tier is the
// auto Vendor-Reported badge. Reconciled Sessions' GMV is queryable for the Client
// Health / GMV signal (M13, §5) via the parent Brief → Service → Client join — this
// module only guarantees the data is stored and queryable; it builds no M13 read-model.
package module10_livestream

import (
	"context"
	"database/sql"
	"errors"
	"strconv"

	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

const sessionSelect = `SELECT ls.id, ls.brief_id, ls.platform, ls.requested_datetime, ls.target_duration_hours,
	        COALESCE(ls.products_talent,''), COALESCE(ls.special_instructions,''), ls.status,
	        ls.actual_datetime, ls.actual_duration_hours, ls.viewers_peak, ls.viewers_avg,
	        ls.orders_generated, ls.gmv, COALESCE(ls.vendor_report_link,''),
	        COALESCE(ls.reconciliation_notes,''), ls.data_confidence_tier, ls.created_by, ls.created_at,
	        c.assigned_am_id
	   FROM live_stream_sessions ls
	   JOIN briefs b ON b.id = ls.brief_id
	   JOIN services sv ON sv.id = b.service_id
	   JOIN clients c ON c.id = sv.client_id`

// GetSession returns one Session if the actor may see it (§6.1): OD/Director; Account
// lead/SPV (division-wide); or the owning AM.
func (s *Service) GetSession(ctx context.Context, actor permission.Actor, sessionID string) (Session, error) {
	row := s.DB.QueryRowContext(ctx, sessionSelect+` WHERE ls.id = ?`, sessionID)
	sess, ownerAM, err := scanSession(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Session{}, ErrSessionNotFound
	}
	if err != nil {
		return Session{}, err
	}
	if !canSeeSession(actor, ownerAM) {
		return Session{}, ErrSessionViewForbidden
	}
	return sess, nil
}

// ListBriefSessions returns every Session of a Live Stream Brief (fan-out progress),
// ordered by id. Same read gate, resolved from the parent Brief's owning AM.
func (s *Service) ListBriefSessions(ctx context.Context, actor permission.Actor, briefID string) ([]Session, error) {
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
	if division != LiveStreamDivision {
		return nil, ErrNotLiveStreamBrief
	}
	if !canSeeSession(actor, ownerAM.String) {
		return nil, ErrSessionViewForbidden
	}
	rows, err := s.DB.QueryContext(ctx, sessionSelect+` WHERE ls.brief_id = ? ORDER BY ls.id ASC`, briefID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Session{}
	for rows.Next() {
		sess, _, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, sess)
	}
	return out, rows.Err()
}

// scanner is satisfied by *sql.Row and *sql.Rows.
type scanner interface {
	Scan(dest ...any) error
}

func scanSession(sc scanner) (Session, string, error) {
	var s Session
	var products, instructions, vendorLink, notes string
	var actualAt sql.NullTime
	var actualDur sql.NullFloat64
	var viewersPeak, viewersAvg, orders sql.NullInt64
	var gmvStr sql.NullString
	var ownerAM sql.NullString
	if err := sc.Scan(&s.ID, &s.BriefID, &s.Platform, &s.RequestedDatetime, &s.TargetDurationHours,
		&products, &instructions, &s.Status, &actualAt, &actualDur, &viewersPeak, &viewersAvg,
		&orders, &gmvStr, &vendorLink, &notes, &s.DataConfidenceTier, &s.CreatedBy, &s.CreatedAt,
		&ownerAM); err != nil {
		return Session{}, "", err
	}
	s.ProductsTalent = products
	s.SpecialInstructions = instructions
	s.VendorReportLink = vendorLink
	s.ReconciliationNotes = notes
	if actualAt.Valid {
		t := actualAt.Time
		s.ActualDatetime = &t
	}
	if actualDur.Valid {
		s.ActualDurationHours = &actualDur.Float64
	}
	s.ViewersPeak = nullIntPtr(viewersPeak)
	s.ViewersAvg = nullIntPtr(viewersAvg)
	s.OrdersGenerated = nullIntPtr(orders)
	if gmvStr.Valid {
		amt, err := money.Parse(gmvStr.String)
		if err != nil {
			return Session{}, "", err
		}
		f := float64(amt) / 100
		s.GMV = &f
		s.GMVDisplay = amt.Format()
	}
	return s, ownerAM.String, nil
}

func nullIntPtr(v sql.NullInt64) *int {
	if !v.Valid {
		return nil
	}
	n := int(v.Int64)
	return &n
}

func parseFloat(s string) (float64, error) { return strconv.ParseFloat(s, 64) }
