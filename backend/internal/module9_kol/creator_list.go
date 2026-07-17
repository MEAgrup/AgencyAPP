// Compiled Creator List output (M9 §6 / §10.5). The eligibility logic is AUTO — a
// Booking becomes list-eligible the instant it reaches [QC Passed] (§6 Rule 2), with
// no parallel manual sheet — but producing the shareable Drive document is a MANUAL,
// Coordinator-triggered one-click action (M9-OA-3): the system records the supplied
// Drive link, a snapshot of the included Bookings, and the compile timestamp. The
// Drive document itself lives OUTSIDE CDPS; only the link is stored (no Drive
// integration). Escalated/Dropped Bookings never appear (§6 Rule 3) — only [QC
// Passed] rows are eligible.
package module9_kol

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// CreatorList is the Brief-level compiled output (§10.5).
type CreatorList struct {
	BriefID          string     `json:"brief_id"`
	CreatorListLink  string     `json:"creator_list_link,omitempty"`
	IncludedBookings []string   `json:"included_bookings"` // snapshot at last compile
	LastCompiled     *time.Time `json:"last_compiled,omitempty"`
	// EligibleBookings is the LIVE auto-computed eligibility (every current [QC
	// Passed] Booking), which may differ from the snapshot if Bookings passed after
	// the last compile — the system always knows what qualifies (§6 Flow 2).
	EligibleBookings []string `json:"eligible_bookings"`
}

// GenerateCreatorList compiles/refreshes the Brief's Creator List (§6 Flow 2 /
// M9-OA-3). The Coordinator supplies the Drive document link; the system snapshots
// the currently-eligible ([QC Passed]) Bookings and records the compile time. Upserts
// the single per-Brief row. Allowed for the Brief's KOL staff/lead (Coordinator), the
// owning AM, or Director.
func (s *Service) GenerateCreatorList(ctx context.Context, actor permission.Actor, briefID, link string) (CreatorList, error) {
	if trim(link) == "" {
		return CreatorList{}, ErrCreatorListLinkRequired
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return CreatorList{}, err
	}
	defer tx.Rollback()

	var division string
	var ownerAM sql.NullString
	err = tx.QueryRowContext(ctx,
		`SELECT b.assigned_division, c.assigned_am_id
		   FROM briefs b JOIN services sv ON sv.id = b.service_id JOIN clients c ON c.id = sv.client_id
		  WHERE b.id = ? FOR UPDATE`, briefID).Scan(&division, &ownerAM)
	if errors.Is(err, sql.ErrNoRows) {
		return CreatorList{}, ErrBriefNotFound
	}
	if err != nil {
		return CreatorList{}, err
	}
	if division != KOLDivision {
		return CreatorList{}, ErrNotKOLBrief
	}
	if !canManageCreatorList(actor, ownerAM.String) {
		return CreatorList{}, ErrCreatorListForbidden
	}

	eligible, err := eligibleBookings(ctx, tx, briefID)
	if err != nil {
		return CreatorList{}, err
	}
	snapshot, err := json.Marshal(eligible)
	if err != nil {
		return CreatorList{}, err
	}
	now := time.Now()
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO creator_lists (brief_id, creator_list_link, included_bookings, last_compiled, created_by)
		 VALUES (?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE creator_list_link = VALUES(creator_list_link),
		   included_bookings = VALUES(included_bookings), last_compiled = VALUES(last_compiled)`,
		briefID, trim(link), string(snapshot), now, actor.EmployeeID); err != nil {
		return CreatorList{}, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "creator_list", EntityID: briefID, Actor: actor.EmployeeID, Action: "compiled",
		After: map[string]any{"link": trim(link), "included_bookings": eligible},
	}); err != nil {
		return CreatorList{}, err
	}
	if err := tx.Commit(); err != nil {
		return CreatorList{}, err
	}
	return CreatorList{
		BriefID: briefID, CreatorListLink: trim(link), IncludedBookings: eligible,
		LastCompiled: &now, EligibleBookings: eligible,
	}, nil
}

// GetCreatorList returns the compiled Creator List for a Brief plus the LIVE eligible
// set. Same read gate as the Brief's Bookings. A Brief that has never been compiled
// returns an empty list with the live eligible set.
func (s *Service) GetCreatorList(ctx context.Context, actor permission.Actor, briefID string) (CreatorList, error) {
	var division string
	var ownerAM sql.NullString
	err := s.DB.QueryRowContext(ctx,
		`SELECT b.assigned_division, c.assigned_am_id
		   FROM briefs b JOIN services sv ON sv.id = b.service_id JOIN clients c ON c.id = sv.client_id
		  WHERE b.id = ?`, briefID).Scan(&division, &ownerAM)
	if errors.Is(err, sql.ErrNoRows) {
		return CreatorList{}, ErrBriefNotFound
	}
	if err != nil {
		return CreatorList{}, err
	}
	if division != KOLDivision {
		return CreatorList{}, ErrNotKOLBrief
	}
	if !canSeeBooking(actor, ownerAM.String, division) {
		return CreatorList{}, ErrBookingViewForbidden
	}

	cl := CreatorList{BriefID: briefID, IncludedBookings: []string{}}
	var link sql.NullString
	var included sql.NullString
	var lastCompiled sql.NullTime
	err = s.DB.QueryRowContext(ctx,
		`SELECT creator_list_link, included_bookings, last_compiled FROM creator_lists WHERE brief_id = ?`, briefID).
		Scan(&link, &included, &lastCompiled)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return CreatorList{}, err
	}
	if err == nil {
		cl.CreatorListLink = link.String
		if included.Valid && included.String != "" {
			var ids []string
			if e := json.Unmarshal([]byte(included.String), &ids); e == nil {
				cl.IncludedBookings = ids
			}
		}
		if lastCompiled.Valid {
			t := lastCompiled.Time
			cl.LastCompiled = &t
		}
	}
	eligible, err := eligibleBookings(ctx, s.DB, briefID)
	if err != nil {
		return CreatorList{}, err
	}
	cl.EligibleBookings = eligible
	return cl, nil
}

// canManageCreatorList: the Brief's KOL staff/lead (Coordinator), the owning AM, or
// Director (§6 "AM/Coordinator generates").
func canManageCreatorList(a permission.Actor, ownerAM string) bool {
	if a.Role.Director {
		return true
	}
	if a.EmployeeID == ownerAM {
		return true
	}
	return a.Role.Division == KOLDivision &&
		(a.Role.Level == permission.LevelStaff || a.Role.Level == permission.LevelLead)
}

// queryer is satisfied by *sql.DB and *sql.Tx.
type queryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// eligibleBookings returns the ids of every [QC Passed] Booking under a Brief, in id
// order — the auto-compiled eligibility set (§6 Rule 2). Escalated/Dropped excluded
// (§6 Rule 3).
func eligibleBookings(ctx context.Context, q queryer, briefID string) ([]string, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT id FROM creator_bookings WHERE brief_id = ? AND status = ? ORDER BY id ASC`,
		briefID, BkgQCPassed)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
