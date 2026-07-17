// Live Stream Session creation (M10 §3). One Session is created per scheduled/held
// vendor broadcast toward a Live Stream Brief (§2 fan-out; M10-OA-4 — one Brief holds
// many Sessions). The LSS- id is minted only after the §6.3 mandatory request fields
// validate (house rule 1); the birth status [Requested] is set at INSERT (a creation,
// not a transition — precedent BKG/ADC).
package module10_livestream

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/ident"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// SessionInput carries the caller-supplied §6.3 REQUEST fields. Brief ID and Status
// are NOT here — the Brief is the parent argument and the status is born [Requested].
// Result fields (actual datetime, GMV, …) are supplied later via LogResults, not here.
type SessionInput struct {
	Platform            string // mandatory: TikTok Shop Live / Shopee Live
	RequestedDatetime   string // mandatory: "2006-01-02 15:04:05" or RFC3339
	TargetDurationHours string // mandatory: decimal hours, e.g. "2" or "1.5"
	ProductsTalent      string // optional: products/talent to feature
	SpecialInstructions string // optional
}

// Session is one Live Stream Session (LSS-) with request + result on one record. Money
// fields carry both the raw value and the house-formatted display (house rule 7).
type Session struct {
	ID                  string     `json:"id"`
	BriefID             string     `json:"brief_id"`
	Platform            string     `json:"platform"`
	RequestedDatetime   time.Time  `json:"requested_datetime"`
	TargetDurationHours float64    `json:"target_duration_hours"`
	ProductsTalent      string     `json:"products_talent,omitempty"`
	SpecialInstructions string     `json:"special_instructions,omitempty"`
	Status              string     `json:"status"`
	ActualDatetime      *time.Time `json:"actual_datetime,omitempty"`
	ActualDurationHours *float64   `json:"actual_duration_hours,omitempty"`
	ViewersPeak         *int       `json:"viewers_peak,omitempty"`
	ViewersAvg          *int       `json:"viewers_avg,omitempty"`
	OrdersGenerated     *int       `json:"orders_generated,omitempty"`
	GMV                 *float64   `json:"gmv,omitempty"`
	GMVDisplay          string     `json:"gmv_display,omitempty"` // "Rp. X.XXX.XXX,00"
	VendorReportLink    string     `json:"vendor_report_link,omitempty"`
	ReconciliationNotes string     `json:"reconciliation_notes,omitempty"`
	// DataConfidenceTier is auto (§5 Rule 2 / M10-OA-5): always Vendor-Reported here,
	// a visible badge — the GMV is never numerically discounted.
	DataConfidenceTier string    `json:"data_confidence_tier"`
	CreatedBy          string    `json:"created_by"`
	CreatedAt          time.Time `json:"created_at"`
}

// CreateSession records a request to the vendor for one live-stream broadcast (§3).
// Creatable by the owning AM or Director (§6.1) while the parent Live Stream Brief is
// dispatched ([Dispatched to Vendor]). Born [Requested].
func (s *Service) CreateSession(ctx context.Context, actor permission.Actor, briefID string, in SessionInput) (Session, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Session{}, err
	}
	defer tx.Rollback()

	// Lock the parent Brief and join up to the owning AM (the §6.1 authority).
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
		return Session{}, ErrBriefNotFound
	}
	if err != nil {
		return Session{}, err
	}
	if division != LiveStreamDivision {
		return Session{}, ErrNotLiveStreamBrief
	}
	// A voided Brief accepts no new Sessions (scope: void interaction); an [Approved]
	// Brief is closed. Only a dispatched Brief takes Sessions.
	if briefStatus == BriefVoided {
		return Session{}, ErrBriefVoided
	}
	if briefStatus != BriefVendorDispatched {
		return Session{}, ErrBriefNotOpenForSession
	}
	if !canManageSession(actor, ownerAM.String) {
		return Session{}, ErrSessionManageForbidden
	}

	// §6.3 mandatory REQUEST-field validation BEFORE any id is minted (house rule 1).
	platform := strings.TrimSpace(in.Platform)
	if platform == "" || strings.TrimSpace(in.RequestedDatetime) == "" || strings.TrimSpace(in.TargetDurationHours) == "" {
		return Session{}, ErrIncomplete
	}
	if !validPlatforms[platform] {
		return Session{}, ErrInvalidPlatform
	}
	reqAt, err := parseDatetime(in.RequestedDatetime)
	if err != nil {
		return Session{}, err
	}
	targetDur, err := parseDuration(in.TargetDurationHours)
	if err != nil {
		return Session{}, err
	}

	id, err := ident.Next(ctx, tx, "LSS", time.Now())
	if err != nil {
		return Session{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO live_stream_sessions
		   (id, brief_id, platform, requested_datetime, target_duration_hours,
		    products_talent, special_instructions, status, data_confidence_tier, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, briefID, platform, reqAt, targetDur,
		nullStr(in.ProductsTalent), nullStr(in.SpecialInstructions), LssRequested,
		DataConfidenceVendorReported, actor.EmployeeID); err != nil {
		return Session{}, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "live_stream_session", EntityID: id, Actor: actor.EmployeeID, Action: "create",
		After: map[string]any{"status": LssRequested, "brief_id": briefID, "platform": platform},
	}); err != nil {
		return Session{}, err
	}
	if err := tx.Commit(); err != nil {
		return Session{}, err
	}
	return Session{
		ID: id, BriefID: briefID, Platform: platform, RequestedDatetime: reqAt,
		TargetDurationHours: targetDur, ProductsTalent: strings.TrimSpace(in.ProductsTalent),
		SpecialInstructions: strings.TrimSpace(in.SpecialInstructions), Status: LssRequested,
		DataConfidenceTier: DataConfidenceVendorReported, CreatedBy: actor.EmployeeID, CreatedAt: time.Now(),
	}, nil
}

// parseDatetime accepts a MySQL DATETIME literal or an RFC3339 timestamp, returning
// ErrBadDatetime on anything unparseable (keeps the BI-message contract instead of
// surfacing a raw driver error).
func parseDatetime(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	for _, layout := range []string{"2006-01-02 15:04:05", time.RFC3339, "2006-01-02T15:04:05", "2006-01-02 15:04", "2006-01-02T15:04"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, ErrBadDatetime
}

// parseDuration parses positive decimal hours; zero/negative/unparseable → ErrInvalidDuration.
func parseDuration(s string) (float64, error) {
	f, err := parseFloat(strings.TrimSpace(s))
	if err != nil || f <= 0 {
		return 0, ErrInvalidDuration
	}
	return f, nil
}

func nullStr(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return strings.TrimSpace(s)
}
