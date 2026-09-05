// This file implements the read side of Module 3 Cluster 1: Get one Campaign and List
// campaigns, each scoped by the §5 visibility rules. The read-only rollups (Leads
// generated, Real leads, Clients won, Total value won) are NOT computed here — they are
// the linkage cluster (W3-M3-C2); this record carries identity + lifecycle + ownership.
package module3_campaign

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// Campaign is one acquisition Campaign (CMP-) — its §6.3 identity/lifecycle/ownership
// projection. Budget/metrics (Module 2) and the leads/clients rollups (Cluster 2) are
// deliberately absent.
type Campaign struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Channel   string  `json:"channel"`
	Online    bool    `json:"online"`
	Offline   bool    `json:"offline"`
	StartDate string  `json:"start_date"`
	EndDate   *string `json:"end_date"` // nil until [Closed] (§6.3)
	Owner     string  `json:"owner_employee_id"`
	Status    string  `json:"status"`

	CreatedBy string    `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
}

// Get returns one Campaign if the actor may view it (§5 read gate). A missing row is
// ErrNotFound; an existing row the actor cannot see is ErrForbidden.
func (s *Service) Get(ctx context.Context, actor permission.Actor, campaignID string) (Campaign, error) {
	c, err := scanCampaign(s.DB.QueryRowContext(ctx, selectCampaign+` WHERE id = ?`, campaignID))
	if errors.Is(err, sql.ErrNoRows) {
		return Campaign{}, ErrNotFound
	}
	if err != nil {
		return Campaign{}, err
	}
	if !canViewCampaign(actor, c.Owner) {
		return Campaign{}, ErrForbidden
	}
	return c, nil
}

// List returns the Campaigns visible to the actor (§5): a Marketing lead/head, OD or
// Director sees ALL; a Marketing staff sees only OWN campaigns; any other division is
// denied (ErrForbidden). Newest first.
func (s *Service) List(ctx context.Context, actor permission.Actor) ([]Campaign, error) {
	seeAll := actor.CanReadDivision(MarketingDivision) // Marketing lead, OD, Director
	ownOnly := !seeAll && actor.Role.Division == MarketingDivision
	if !seeAll && !ownOnly {
		return nil, ErrForbidden
	}

	q := selectCampaign
	var args []any
	if ownOnly {
		q += ` WHERE owner_employee_id = ?`
		args = append(args, actor.EmployeeID)
	}
	q += ` ORDER BY created_at DESC, id DESC`

	rows, err := s.DB.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Campaign{}
	for rows.Next() {
		c, err := scanCampaign(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

const selectCampaign = `SELECT id, name, channel, is_online, is_offline, start_date, end_date,
        owner_employee_id, status, created_by, created_at
   FROM campaigns`

// scanner is satisfied by *sql.Row and *sql.Rows.
type scanner interface{ Scan(dest ...any) error }

func scanCampaign(sc scanner) (Campaign, error) {
	var c Campaign
	var online, offline int
	var start time.Time
	var end sql.NullTime
	if err := sc.Scan(&c.ID, &c.Name, &c.Channel, &online, &offline, &start, &end,
		&c.Owner, &c.Status, &c.CreatedBy, &c.CreatedAt); err != nil {
		return Campaign{}, err
	}
	c.Online = online == 1
	c.Offline = offline == 1
	c.StartDate = start.Format("2006-01-02")
	if end.Valid {
		s := end.Time.Format("2006-01-02")
		c.EndDate = &s
	}
	return c, nil
}
