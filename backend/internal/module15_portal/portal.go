// Package module15_portal is Module 15 — Team Portal (the INTERNAL half of M15;
// the Client Portal, M15-C2, is a separate blocked track and lives nowhere in this
// package). It introduces NO new entities and NO new state machine (M15 §3 Rule 8):
// it is a pure READ-MODEL / delegation layer that aggregates what Modules 11 (My
// Tasks / Client Board), 12 (block-request queue), 13 (Client Health snapshots) and
// 14 (Performance Score) already produce, into three role-based landing surfaces:
//
//   - StaffLanding (Rule 9): the actor's own open tasks (M11 My Tasks, sorted
//     SLA-risk first) + a RUNNING current-month Performance Score with breakdown
//     and trend (M14). The running score is computed-on-read and NEVER stored
//     (parallels the M13 live preview / house rule 4) — it delegates to
//     module14_performance.PreviewCurrent (an additive export, no gatherer
//     duplication). Quick actions need no endpoint here — they delegate to the
//     existing M7/M8/M9/M10/M12 execution routes.
//
//   - TeamPortal (Rule 10, SPV/Lead + Director): the lead's division Performance
//     rollup (M14), a Client Board shortcut list (M11) for the team's Clients, and
//     the Block-request approval QUEUE — the pending requests (M12 §5.3a) the lead
//     may action. The approve/reject ACTIONS are NOT reimplemented here; they stay
//     on the existing M12 endpoints (ApproveBlockRequest / RejectBlockRequest),
//     which drive [Blocked] through the engine and emit the already-cataloged
//     EvBlockRequestDecided — this package emits nothing.
//
//   - ManagementDashboard (Rule 11 / §6.3, Director/OD only): every Client's latest
//     Health band (M13) across the whole client base, with trend direction and the
//     dragging (lowest) sub-component, filterable/sortable by band (At Risk first)
//     and AM. Read-only; drill-through is by reference id (client id / snapshot id).
//
// No status is ever written here, no ID minted, no notification emitted — the whole
// package is reads plus delegation to the owning modules.
package module15_portal

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/module11_board"
	"github.com/meagrup/agencyapp/backend/internal/module12_task"
	"github.com/meagrup/agencyapp/backend/internal/module13_health"
	"github.com/meagrup/agencyapp/backend/internal/module14_performance"
)

// AccountDivision is the CDPS division whose lead oversees the whole client book;
// its Team Portal Client-Board shortcut lists every Client (its AMs' portfolios),
// not just Clients with an Account-labelled Brief.
const AccountDivision = "Account"

// Trend-direction values for the Management Dashboard (data enums, not user-facing
// validation strings).
const (
	TrendUp   = "up"
	TrendDown = "down"
	TrendFlat = "flat"
)

// Sentinel errors reuse the shared house BI strings (CLAUDE.md §5) — Module 15 adds
// NO new BI string (Rule 8 "no new entities"; the access-denied string is the same
// one M11/M13/M14 already use).
var (
	// ErrForbidden: the actor may not see this portal surface (e.g. staff hitting the
	// team or management view, a lead hitting management).
	ErrForbidden = errors.New("[anda tidak memiliki akses ke data ini]")
)

// Service is the Module 15 read-model surface. It holds pointers to the owning
// modules' services and delegates every action/query to them — it never touches a
// status column, mints an id, or emits a notification of its own.
type Service struct {
	DB    *sql.DB
	Board *module11_board.Service
	Perf  *module14_performance.Service
	Task  *module12_task.Service
}

// ---- Staff landing (Rule 9 / §4) ----

// StaffLanding is the default staff home base (Rule 9): open tasks (SLA-risk first)
// plus the running current-month Performance Score and its trend.
type StaffLanding struct {
	EmployeeID   string                          `json:"employee_id"`
	OpenTasks    []module11_board.Card           `json:"open_tasks"`
	RunningScore *module14_performance.Snapshot  `json:"running_score"` // nil when the actor has no KPI Profile role
	Trend        []module14_performance.Snapshot `json:"trend"`
}

// StaffLandingFor builds the landing page for the actor's OWN data (Role Matrix:
// Staff = own). Open tasks come from M11 My Tasks (own scope), filtered to not-Done
// and sorted SLA-risk first (decision point 1: overdue first, then nearest due date,
// then no-due-date last). The running score is the M14 current-month preview
// (computed-on-read, never stored); a role without a KPI Profile (Sales/Finance/
// Marketing, or a lead) simply has a nil RunningScore — not an error.
func (s *Service) StaffLandingFor(ctx context.Context, actor permission.Actor, now time.Time) (StaffLanding, error) {
	out := StaffLanding{EmployeeID: actor.EmployeeID, OpenTasks: []module11_board.Card{}, Trend: []module14_performance.Snapshot{}}

	cards, err := s.Board.MyTasks(ctx, actor, "")
	if err != nil {
		return StaffLanding{}, err
	}
	open := make([]module11_board.Card, 0, len(cards))
	for _, c := range cards {
		if c.UniversalCol == module11_board.UCDone {
			continue // "open" = not yet Done
		}
		open = append(open, c)
	}
	sortBySLARisk(open)
	out.OpenTasks = open

	// Running current-month Performance Score (never stored). ErrNotFound => the
	// actor has no scored role; leave RunningScore nil.
	snap, err := s.Perf.PreviewCurrent(ctx, actor, actor.EmployeeID, now)
	switch {
	case err == nil:
		out.RunningScore = &snap
	case errors.Is(err, module14_performance.ErrNotFound):
		// no KPI Profile — no running score section
	default:
		return StaffLanding{}, err
	}

	// Prior-month trend (stored snapshots only). No snapshots => empty slice.
	trend, err := s.Perf.Trend(ctx, actor, actor.EmployeeID)
	if err != nil && !errors.Is(err, module14_performance.ErrNotFound) {
		return StaffLanding{}, err
	}
	if trend != nil {
		out.Trend = trend
	}
	return out, nil
}

// sortBySLARisk orders cards "nearest SLA-risk first" (decision point 1) using the
// fields the M11 read-model already exposes (Overdue, DueDate): overdue cards first
// (earliest due first), then cards with an upcoming due date (earliest first), then
// cards with no due date. Stable, so same-key cards keep My Tasks' id order.
func sortBySLARisk(cards []module11_board.Card) {
	group := func(c module11_board.Card) int {
		switch {
		case c.Overdue:
			return 0
		case c.DueDate != "":
			return 1
		default:
			return 2
		}
	}
	sort.SliceStable(cards, func(i, j int) bool {
		gi, gj := group(cards[i]), group(cards[j])
		if gi != gj {
			return gi < gj
		}
		// Same group: earliest due date first (YYYY-MM-DD sorts lexicographically).
		if cards[i].DueDate != cards[j].DueDate {
			return cards[i].DueDate < cards[j].DueDate
		}
		return false
	})
}

// ---- Team Portal (Rule 10 / §6.2) ----

// ClientShortcut is one Client-Board drill-through row on the Team Portal (Rule 10 —
// "Client Board shortcut for their team's Clients"). It is a reference only (client
// id + a board deep-link hint), not a copy of the board's cards.
type ClientShortcut struct {
	ClientID   string `json:"client_id"`
	ClientName string `json:"client_name"`
	AssignedAM string `json:"assigned_am"`
	BoardRef   string `json:"board_ref"` // deep-link hint into the Client Board (M11)
}

// TeamPortal is the SPV/Lead landing (Rule 10): the division Performance rollup, the
// Client-Board shortcuts for the team, and the pending block-request approval queue.
type TeamPortal struct {
	Division   string                              `json:"division"`
	Rollup     module14_performance.TeamRollup     `json:"performance_rollup"`
	Clients    []ClientShortcut                    `json:"client_shortcuts"`
	BlockQueue []module12_task.PendingBlockRequest `json:"block_queue"`
}

// TeamPortalFor builds the lead landing for a division (Rule 10). division defaults
// to the actor's own division; a Director may pass any division. Only a lead of that
// division (or a Director) may view it — mirroring the M14 team-rollup and M12 decide
// gates. periodID (optional) selects the rollup month; empty = latest present.
func (s *Service) TeamPortalFor(ctx context.Context, actor permission.Actor, division, periodID string) (TeamPortal, error) {
	if division == "" {
		division = actor.Role.Division
	}
	if division == "" || !actor.IsLead(division) {
		return TeamPortal{}, ErrForbidden
	}

	rollup, err := s.Perf.TeamRollup(ctx, actor, division, periodID)
	if err != nil {
		return TeamPortal{}, err
	}
	clients, err := s.teamClients(ctx, division)
	if err != nil {
		return TeamPortal{}, err
	}
	// Block-approval queue: pending requests the actor may action (M12 scopes it to
	// the lead's division / Director). Reuses the M12 read-model; approve/reject stay
	// on the existing M12 endpoints.
	queue, err := s.Task.PendingBlockRequests(ctx, actor)
	if err != nil {
		return TeamPortal{}, err
	}
	return TeamPortal{Division: division, Rollup: rollup, Clients: clients, BlockQueue: queue}, nil
}

// teamClients lists the Clients whose board the lead should be able to jump to. An
// Account lead / Director oversees the whole client book (their AMs' portfolios); any
// other division lead sees the Clients with at least one Brief in that division
// (decision point 4). Reference rows only.
func (s *Service) teamClients(ctx context.Context, division string) ([]ClientShortcut, error) {
	var rows *sql.Rows
	var err error
	if division == AccountDivision {
		rows, err = s.DB.QueryContext(ctx,
			`SELECT id, toko, COALESCE(assigned_am_id,'') FROM clients ORDER BY id`)
	} else {
		rows, err = s.DB.QueryContext(ctx,
			`SELECT DISTINCT c.id, c.toko, COALESCE(c.assigned_am_id,'')
			   FROM clients c
			   JOIN services sv ON sv.client_id = c.id
			   JOIN briefs b ON b.service_id = sv.id
			  WHERE b.assigned_division = ?
			  ORDER BY c.id`, division)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ClientShortcut{}
	for rows.Next() {
		var c ClientShortcut
		if err := rows.Scan(&c.ClientID, &c.ClientName, &c.AssignedAM); err != nil {
			return nil, err
		}
		c.BoardRef = "/api/v1/board?client=" + c.ClientID
		out = append(out, c)
	}
	return out, rows.Err()
}

// ---- Management Dashboard (Rule 11 / §6.3) ----

// MgmtRow is one Client's line on the Management Dashboard: its latest Health band,
// trend direction, and the sub-component currently dragging its score the most, plus
// the reference ids for drill-through (Rule 11 — no new data, only references).
type MgmtRow struct {
	ClientID          string   `json:"client_id"`
	ClientName        string   `json:"client_name"`
	AssignedAM        string   `json:"assigned_am"`
	SnapshotID        string   `json:"snapshot_id"` // "" when the Client has no snapshot yet
	Period            string   `json:"period"`      // "YYYY-MM-DD" of the latest snapshot; "" when none
	ScoreDisplay      string   `json:"score_display"`
	Band              string   `json:"band"`               // "" when no snapshot
	TrendDirection    string   `json:"trend_direction"`    // up | down | flat
	DraggingComponent string   `json:"dragging_component"` // lowest included capped sub-score; "" when none
	DraggingCapped    *float64 `json:"dragging_capped"`
}

// ManagementDashboard is the portfolio-wide health scan (Rule 11).
type ManagementDashboard struct {
	FilterBand string    `json:"filter_band"`
	FilterAM   string    `json:"filter_am"`
	Sort       string    `json:"sort"`
	Rows       []MgmtRow `json:"rows"`
}

// ManagementDashboardFor builds the Director/OD portfolio view (Rule 11 / §6.3 —
// decision point 5: "management-level roles" = Director + OD, the only cross-portfolio
// read roles in the Role Matrix; no new role invented). Read-only. filterBand /
// filterAM narrow the rows; sortBy "am" groups by AM (then band), anything else
// defaults to band with At Risk first.
func (s *Service) ManagementDashboardFor(ctx context.Context, actor permission.Actor, filterBand, filterAM, sortBy string) (ManagementDashboard, error) {
	if !(actor.Role.Director || actor.Role.OD) {
		return ManagementDashboard{}, ErrForbidden
	}
	out := ManagementDashboard{FilterBand: filterBand, FilterAM: filterAM, Sort: sortBy, Rows: []MgmtRow{}}

	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, toko, COALESCE(assigned_am_id,'') FROM clients ORDER BY id`)
	if err != nil {
		return ManagementDashboard{}, err
	}
	type clientRow struct{ id, name, am string }
	var clients []clientRow
	for rows.Next() {
		var c clientRow
		if err := rows.Scan(&c.id, &c.name, &c.am); err != nil {
			rows.Close()
			return ManagementDashboard{}, err
		}
		clients = append(clients, c)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return ManagementDashboard{}, err
	}
	rows.Close()

	for _, c := range clients {
		if filterAM != "" && c.am != filterAM {
			continue
		}
		row, err := s.mgmtRowFor(ctx, c.id, c.name, c.am)
		if err != nil {
			return ManagementDashboard{}, err
		}
		if filterBand != "" && row.Band != filterBand {
			continue
		}
		out.Rows = append(out.Rows, row)
	}
	sortMgmtRows(out.Rows, sortBy)
	return out, nil
}

// mgmtRowFor loads one Client's latest + previous snapshot and derives the band,
// trend direction and dragging component. A Client with no snapshot yet is rendered
// with an empty band / "—" score (house rule 7) and flat trend.
func (s *Service) mgmtRowFor(ctx context.Context, clientID, name, am string) (MgmtRow, error) {
	row := MgmtRow{ClientID: clientID, ClientName: name, AssignedAM: am, ScoreDisplay: "—", TrendDirection: TrendFlat}

	var id string
	var start time.Time
	var score sql.NullFloat64
	var band string
	var compJSON []byte
	err := s.DB.QueryRowContext(ctx,
		`SELECT id, period_start, final_health_score, band, components_json
		   FROM client_health_snapshots
		  WHERE client_id = ? ORDER BY period_start DESC LIMIT 1`, clientID).
		Scan(&id, &start, &score, &band, &compJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return row, nil // no snapshot yet
	}
	if err != nil {
		return MgmtRow{}, err
	}
	row.SnapshotID = id
	row.Period = start.Format("2006-01-02")
	row.Band = band
	if score.Valid {
		row.ScoreDisplay = fmt.Sprintf("%.2f", score.Float64)
	}

	// Previous snapshot for trend direction.
	var prevScore sql.NullFloat64
	var prevBand string
	perr := s.DB.QueryRowContext(ctx,
		`SELECT final_health_score, band FROM client_health_snapshots
		   WHERE client_id = ? AND period_start < ? ORDER BY period_start DESC LIMIT 1`,
		clientID, start).Scan(&prevScore, &prevBand)
	if perr == nil {
		row.TrendDirection = trendDirection(score, prevScore, band, prevBand)
	} else if !errors.Is(perr, sql.ErrNoRows) {
		return MgmtRow{}, perr
	}

	// Dragging component = the lowest included, capped sub-score (§6.3).
	name2, capped := draggingComponent(compJSON)
	row.DraggingComponent = name2
	row.DraggingCapped = capped
	return row, nil
}

// trendDirection compares the latest and previous snapshot. Numeric scores are the
// primary signal; when either score is absent it falls back to band rank; ties are
// flat.
func trendDirection(cur, prev sql.NullFloat64, curBand, prevBand string) string {
	if cur.Valid && prev.Valid {
		switch {
		case cur.Float64 > prev.Float64:
			return TrendUp
		case cur.Float64 < prev.Float64:
			return TrendDown
		default:
			return TrendFlat
		}
	}
	switch {
	case bandRank(curBand) > bandRank(prevBand):
		return TrendUp
	case bandRank(curBand) < bandRank(prevBand):
		return TrendDown
	default:
		return TrendFlat
	}
}

// draggingComponent returns the name and capped value of the lowest INCLUDED sub-score
// in a Health snapshot's components_json (§6.3 "which component is currently dragging
// the score"). Excluded components (redistributed, no capped value) are ignored;
// "" / nil when nothing is included.
func draggingComponent(compJSON []byte) (string, *float64) {
	if len(compJSON) == 0 {
		return "", nil
	}
	var comps []module13_health.Component
	if err := json.Unmarshal(compJSON, &comps); err != nil {
		return "", nil
	}
	var name string
	var lowest *float64
	for _, c := range comps {
		if !c.Included || c.Capped == nil {
			continue
		}
		if lowest == nil || *c.Capped < *lowest {
			v := *c.Capped
			lowest = &v
			name = c.Name
		}
	}
	return name, lowest
}

// bandRank orders the health bands for sorting / trend (At Risk lowest). An unknown /
// empty band (no snapshot) ranks below At Risk so it sorts last on the dashboard.
func bandRank(band string) int {
	switch band {
	case module13_health.BandHealthy:
		return 3
	case module13_health.BandWatch:
		return 2
	case module13_health.BandAtRisk:
		return 1
	default:
		return 0
	}
}

// bandSortKey orders rows so At Risk surfaces FIRST (Rule 11 default), then Watch,
// then Healthy, then Clients with no snapshot.
func bandSortKey(band string) int {
	switch band {
	case module13_health.BandAtRisk:
		return 0
	case module13_health.BandWatch:
		return 1
	case module13_health.BandHealthy:
		return 2
	default:
		return 3 // no snapshot / unknown — last
	}
}

// sortMgmtRows applies the dashboard ordering: by AM (then band) when sortBy=="am",
// otherwise band with At Risk first (the default, Rule 11).
func sortMgmtRows(rows []MgmtRow, sortBy string) {
	sort.SliceStable(rows, func(i, j int) bool {
		if sortBy == "am" {
			if rows[i].AssignedAM != rows[j].AssignedAM {
				return rows[i].AssignedAM < rows[j].AssignedAM
			}
		}
		ki, kj := bandSortKey(rows[i].Band), bandSortKey(rows[j].Band)
		if ki != kj {
			return ki < kj
		}
		return rows[i].ClientID < rows[j].ClientID
	})
}
