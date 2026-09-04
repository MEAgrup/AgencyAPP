package module14_performance

import (
	"context"
	"database/sql"
	"encoding/json"
	"sort"
)

// This file computes the cross-division Client-Outcome Modifier (M14 §2 Rule 3 /
// §5.3 / OA-3/OA-4). For Creative/Ads/KOL only (AM has none): the average of the
// Module 13 Health-Score sub-component most attributable to the role — Creative →
// Revision Burden, Ads → ROAS Attainment, KOL → Task Completion — across the CHR-
// snapshots (SAME period) of the Clients the staff member touched that month, then
// clamp((avg − 80) ÷ 2, −10, +10).
//
// Decision point 3 ("clients touched"): a Client contributes when (a) it has a CHR
// snapshot for the scored period AND (b) the staff member is PIC on ≥1 Brief/Task
// for that Client (§5.3 "PIC on at least one Brief/Task that month" — the PIC
// linkage below; the period scoping comes from requiring a same-period CHR
// snapshot). When no such Client/CHR data exists the modifier is ABSENT (effective
// 0), recorded on the snapshot rather than silently dropped (decision point 3 —
// "layered on top"; no data source → modifier absent, not a fabricated 0-from-80).

// chrComponent is one entry of a CHR snapshot's components_json (module13_health
// §5.6). Only the fields the modifier needs are decoded.
type chrComponent struct {
	Name     string   `json:"name"`
	Included bool     `json:"included"`
	Capped   *float64 `json:"capped"`
}

// computeModifier builds the Client-Outcome Modifier for one staff member. Returns
// an absent modifier (Present=false, Value 0) for AM, and for any role with no
// touched-Client CHR data in the period.
func (s *Service) computeModifier(ctx context.Context, q rowQuerier, staffID, roleType string, per period) (Modifier, error) {
	comp, ok := modifierComponent[roleType]
	if !ok {
		return Modifier{}, nil // AM — no modifier (Rule 3)
	}
	clients, err := s.touchedClients(ctx, q, staffID, roleType)
	if err != nil {
		return Modifier{}, err
	}

	var sum float64
	var used []string
	for _, cid := range clients {
		sub, ok, err := chrSubScore(ctx, q, cid, per, comp)
		if err != nil {
			return Modifier{}, err
		}
		if !ok {
			continue
		}
		sum += sub
		used = append(used, cid)
	}
	if len(used) == 0 {
		return Modifier{SourceComponent: comp}, nil // absent (effective 0), recorded
	}
	sort.Strings(used)
	avg := sum / float64(len(used))
	return Modifier{
		Present:         true,
		Value:           clampModifier(avg),
		SourceComponent: comp,
		SourceClients:   used,
		RawAverage:      &avg,
	}, nil
}

// chrSubScore reads the CHR snapshot for (client, period) and returns the CAPPED
// sub-score of the requested component. ok=false when there is no snapshot for the
// period, or the component is absent/excluded in it.
func chrSubScore(ctx context.Context, q rowQuerier, clientID string, per period, comp string) (float64, bool, error) {
	var raw []byte
	err := q.QueryRowContext(ctx,
		`SELECT components_json FROM client_health_snapshots WHERE client_id = ? AND period_start = ?`,
		clientID, per.startDate).Scan(&raw)
	if err == sql.ErrNoRows {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	var comps []chrComponent
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &comps); err != nil {
			return 0, false, err
		}
	}
	for _, c := range comps {
		if c.Name == comp && c.Included && c.Capped != nil {
			return *c.Capped, true, nil
		}
	}
	return 0, false, nil
}

// touchedClients returns the distinct Client IDs the staff member is PIC on for the
// role (decision point 3). The period scoping is enforced downstream by requiring a
// same-period CHR snapshot (chrSubScore), so this returns the PIC linkage per role:
//   - Creative: Clients of Assets the staff is assigned_pic on.
//   - Ads:      Clients of the setup Briefs the staff is assigned_pic on (the Briefs
//     above the campaigns they manage).
//   - KOL:      Clients of Bookings the staff is the assigned_coordinator on.
func (s *Service) touchedClients(ctx context.Context, q rowQuerier, staffID, roleType string) ([]string, error) {
	var query string
	switch roleType {
	case RoleCreative:
		query = `SELECT DISTINCT sv.client_id
		           FROM assets a
		           JOIN briefs b ON b.id = a.brief_id
		           JOIN services sv ON sv.id = b.service_id
		          WHERE a.assigned_pic = ?`
	case RoleAds:
		query = `SELECT DISTINCT sv.client_id
		           FROM briefs b
		           JOIN services sv ON sv.id = b.service_id
		          WHERE b.assigned_pic = ? AND b.assigned_division = 'Ads'`
	case RoleKOL:
		query = `SELECT DISTINCT sv.client_id
		           FROM creator_bookings bk
		           JOIN briefs b ON b.id = bk.brief_id
		           JOIN services sv ON sv.id = b.service_id
		          WHERE bk.assigned_coordinator = ?`
	default:
		return nil, nil
	}
	rows, err := q.QueryContext(ctx, query, staffID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
