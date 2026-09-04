// Creator Booking creation (M9 §4). One Booking is created per creator secured
// toward a KOL Brief's Quantity/Target (§2 fan-out). The BKG- id is minted only
// after the §10.3 mandatory fields validate (house rule 1); the birth status
// [Sourcing] is set at INSERT (a creation, not a transition).
package module9_kol

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/ident"
	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// BookingInput carries the caller-supplied §10.3 fields. Brief ID and Status are
// NOT here — the Brief is the parent argument and the status is born [Sourcing].
// AssignedCoordinator is optional: a KOL staff member self-claims (defaults to the
// actor) while the Team Leader may create it unassigned or name the Coordinator.
type BookingInput struct {
	CreatorName         string // Creator Name / Handle (mandatory)
	CreatorHandle       string // optional separate handle
	Platform            string // mandatory
	Niche               string // optional
	SourcePool          string // mandatory (M9-OA-1 set)
	PoolReference       string // conditional
	AgreedRate          string // decimal string, e.g. "1500000" or "1500000.00" (mandatory)
	AssignedCoordinator string // optional
}

// Booking is one Creator Booking (BKG-) with its derived, read-only fields filled
// on read (metrics/payment reflection live in read.go / metrics.go).
type Booking struct {
	ID                  string   `json:"id"`
	BriefID             string   `json:"brief_id"`
	CreatorName         string   `json:"creator_name"`
	CreatorHandle       string   `json:"creator_handle,omitempty"`
	Platform            string   `json:"platform"`
	Niche               string   `json:"niche,omitempty"`
	SourcePool          string   `json:"source_pool"`
	PoolReference       string   `json:"pool_reference,omitempty"`
	AgreedRate          float64  `json:"agreed_rate"`
	AgreedRateDisplay   string   `json:"agreed_rate_display"` // "Rp. X.XXX.XXX,00"
	Status              string   `json:"status"`
	ContentLink         string   `json:"content_link,omitempty"`
	QCNotes             string   `json:"qc_notes,omitempty"`
	SLATargetHours      *float64 `json:"sla_target_hours,omitempty"`
	HoursLogged         *float64 `json:"hours_logged,omitempty"`
	AssignedCoordinator string   `json:"assigned_coordinator,omitempty"`
	AttributedGMV       *float64 `json:"attributed_gmv,omitempty"`

	// Derived, read-only (house rules 3/4), filled by GetBooking.
	RevisionCount int    `json:"revision_count"`
	PaymentStatus string `json:"payment_status"` // reflection of the linked CPR (§8 Rule 4); "" if none

	CreatedBy string    `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
}

// CreateBooking breaks one creator engagement out of a KOL Brief (§4). Creatable by
// the Brief's KOL division staff/lead (self-claim or Team Leader) or Director while
// the Brief is live. Born [Sourcing] (§4 Rule 1).
func (s *Service) CreateBooking(ctx context.Context, actor permission.Actor, briefID string, in BookingInput) (Booking, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Booking{}, err
	}
	defer tx.Rollback()

	var division, status string
	err = tx.QueryRowContext(ctx,
		`SELECT assigned_division, status FROM briefs WHERE id = ? FOR UPDATE`, briefID).
		Scan(&division, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return Booking{}, ErrBriefNotFound
	}
	if err != nil {
		return Booking{}, err
	}
	if division != KOLDivision {
		return Booking{}, ErrNotKOLBrief
	}
	// Only creatable while the Brief is live (not yet approved/cancelled).
	if status == "[Approved]" || status == "[Cancelled — Service Voided]" {
		return Booking{}, ErrBriefNotBookable
	}
	// Creator = the Brief's KOL staff/lead, or Director. AM/OD/other divisions no.
	if !canCreateBooking(actor) {
		return Booking{}, ErrExecForbidden
	}

	// §10.3 mandatory-field validation BEFORE any id is minted (house rule 1).
	creatorName := strings.TrimSpace(in.CreatorName)
	platform := strings.TrimSpace(in.Platform)
	pool := strings.TrimSpace(in.SourcePool)
	if creatorName == "" || platform == "" || pool == "" || strings.TrimSpace(in.AgreedRate) == "" {
		return Booking{}, ErrIncomplete
	}
	if !validSourcePools[pool] {
		return Booking{}, ErrInvalidSourcePool
	}
	rate, err := money.Parse(in.AgreedRate)
	if err != nil || rate <= 0 {
		return Booking{}, ErrIncomplete
	}

	// Resolve the Coordinator: an explicit value is validated; a self-claiming KOL
	// staff member defaults to themselves; a lead may leave it unassigned.
	coord := strings.TrimSpace(in.AssignedCoordinator)
	if coord == "" && actor.Role.Division == KOLDivision && actor.Role.Level == permission.LevelStaff {
		coord = actor.EmployeeID // self-claim (§3)
	}
	if coord != "" {
		if err := validateKOLStaff(ctx, tx, coord); err != nil {
			return Booking{}, err
		}
	}

	id, err := ident.Next(ctx, tx, "BKG", time.Now())
	if err != nil {
		return Booking{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO creator_bookings
		   (id, brief_id, creator_name, creator_handle, platform, niche, source_pool,
		    pool_reference, agreed_rate, status, assigned_coordinator, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, briefID, creatorName, nullStr(in.CreatorHandle), platform, nullStr(in.Niche), pool,
		nullStr(in.PoolReference), rate.Decimal(), BkgSourcing, nullStr(coord), actor.EmployeeID); err != nil {
		return Booking{}, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "creator_booking", EntityID: id, Actor: actor.EmployeeID, Action: "create",
		After: map[string]any{"status": BkgSourcing, "brief_id": briefID, "source_pool": pool, "agreed_rate": rate.Decimal()},
	}); err != nil {
		return Booking{}, err
	}
	if err := tx.Commit(); err != nil {
		return Booking{}, err
	}
	return Booking{
		ID: id, BriefID: briefID, CreatorName: creatorName, CreatorHandle: strings.TrimSpace(in.CreatorHandle),
		Platform: platform, Niche: strings.TrimSpace(in.Niche), SourcePool: pool,
		PoolReference: strings.TrimSpace(in.PoolReference), AgreedRate: float64(rate) / 100,
		AgreedRateDisplay: rate.Format(), Status: BkgSourcing, AssignedCoordinator: coord,
		CreatedBy: actor.EmployeeID, CreatedAt: time.Now(),
	}, nil
}

// canCreateBooking gates Booking creation: the Brief's KOL staff/lead (self-claim /
// Team Leader) or Director. AM, OD and other divisions cannot create.
func canCreateBooking(a permission.Actor) bool {
	if a.Role.Director {
		return true
	}
	return a.Role.Division == KOLDivision &&
		(a.Role.Level == permission.LevelStaff || a.Role.Level == permission.LevelLead)
}

// validateKOLStaff enforces that id is an ACTIVE employee whose resolved CDPS
// division is KOL and whose level is staff (a single accountable Coordinator, §3).
// Mirrors module12_task.validatePICForDivision / module7's validateCreativeStaff.
func validateKOLStaff(ctx context.Context, tx *sql.Tx, id string) error {
	var active int
	var div, level sql.NullString
	err := tx.QueryRowContext(ctx,
		`SELECT e.status_aktif, rm.division, rm.level
		   FROM employees e
		   LEFT JOIN role_mappings rm ON rm.divisi = e.divisi AND rm.jabatan = e.jabatan
		  WHERE e.employee_id = ?`, id).Scan(&active, &div, &level)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrInvalidCoordinator
	}
	if err != nil {
		return err
	}
	if active != 1 || !div.Valid || div.String != KOLDivision ||
		!level.Valid || level.String != permission.LevelStaff {
		return ErrInvalidCoordinator
	}
	return nil
}

func nullStr(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return strings.TrimSpace(s)
}
