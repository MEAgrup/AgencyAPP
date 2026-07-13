// Asset read paths + the shared §9.1 read predicate. Revision Count is DERIVED
// from the immutable audit log (house rules 3/4), never stored.
package module7_creative

import (
	"context"
	"database/sql"
	"errors"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

const assetSelect = `SELECT a.id, a.brief_id, a.asset_type, a.sequence_no, COALESCE(a.assigned_pic,''),
	        COALESCE(a.output_link,''), a.status, a.sla_target_hours, a.revision_sla_target_hours,
	        a.hours_logged, a.attributed_gmv, a.created_by, a.created_at, b.assigned_division, c.assigned_am_id
	   FROM assets a
	   JOIN briefs b ON b.id = a.brief_id
	   JOIN services sv ON sv.id = b.service_id
	   JOIN clients c ON c.id = sv.client_id`

// GetAsset returns one Asset with its derived Revision Count / flag, if the actor
// may see it (§9.1): OD/Director everywhere; Account lead (division-wide); the
// owning AM; and staff/lead of the Brief's Creative division.
func (s *Service) GetAsset(ctx context.Context, actor permission.Actor, assetID string) (Asset, error) {
	a, division, ownerAM, err := s.loadAsset(ctx, assetID)
	if err != nil {
		return Asset{}, err
	}
	if !canSeeAsset(actor, ownerAM, division) {
		return Asset{}, ErrAssetForbidden
	}
	entries, err := audit.List(ctx, s.DB, audit.Filter{EntityType: "asset", EntityID: assetID})
	if err != nil {
		return Asset{}, err
	}
	a.RevisionCount = deriveAssetRevisionCount(entries)
	a.RevisionFlagged = a.RevisionCount >= assetRevisionFlagThreshold
	return a, nil
}

// ListBriefAssets returns all Assets of a Brief (progress: "5 of 12 created",
// §4 Rule 1), ordered by Sequence #. Same read gate as GetAsset, resolved from the
// parent Brief's division/owner.
func (s *Service) ListBriefAssets(ctx context.Context, actor permission.Actor, briefID string) ([]Asset, error) {
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
	if !canSeeAsset(actor, ownerAM.String, division) {
		return nil, ErrAssetForbidden
	}
	rows, err := s.DB.QueryContext(ctx, assetSelect+` WHERE a.brief_id = ? ORDER BY a.sequence_no ASC`, briefID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Asset{}
	for rows.Next() {
		a, _, _, err := scanAsset(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// canSeeAsset is the §9.1 read predicate (mirrors module6_account.canSeeBrief).
func canSeeAsset(a permission.Actor, ownerAM, division string) bool {
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

// loadAsset returns one Asset plus its Brief division and owning AM (read gate).
func (s *Service) loadAsset(ctx context.Context, assetID string) (Asset, string, string, error) {
	row := s.DB.QueryRowContext(ctx, assetSelect+` WHERE a.id = ?`, assetID)
	a, division, ownerAM, err := scanAsset(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Asset{}, "", "", ErrAssetNotFound
	}
	if err != nil {
		return Asset{}, "", "", err
	}
	return a, division, ownerAM, nil
}

// scanner is satisfied by *sql.Row and *sql.Rows.
type scanner interface {
	Scan(dest ...any) error
}

func scanAsset(sc scanner) (Asset, string, string, error) {
	var a Asset
	var pic, link string
	var sla, revSLA, hours, gmv sql.NullFloat64
	var division string
	var ownerAM sql.NullString
	if err := sc.Scan(&a.ID, &a.BriefID, &a.AssetType, &a.SequenceNo, &pic, &link, &a.Status,
		&sla, &revSLA, &hours, &gmv, &a.CreatedBy, &a.CreatedAt, &division, &ownerAM); err != nil {
		return Asset{}, "", "", err
	}
	a.AssignedPIC = pic
	a.OutputLink = link
	a.SLATargetHours = nullFloatPtr(sla)
	a.RevisionSLAHours = nullFloatPtr(revSLA)
	a.HoursLogged = nullFloatPtr(hours)
	a.AttributedGMV = nullFloatPtr(gmv)
	return a, division, ownerAM.String, nil
}

// deriveAssetRevisionCount counts [In Review] -> [Revision Requested] transitions
// in the immutable audit log (§6 Rule 2 — derived, never stored).
func deriveAssetRevisionCount(entries []audit.Entry) int {
	n := 0
	want := "transition:[In Review]->[Revision Requested]"
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
