package module11_board

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// This file holds the two computed read-models (M11 §5.2–§5.4): the Universal
// Column mapping and the Client Board / My Tasks card lists. Everything here is
// derived on read from live statuses (house rule #4) — nothing is stored.

// Universal Column labels (M11 §5.2). The five buckets every division maps into.
const (
	UCToDo        = "To Do"
	UCInProgress  = "In Progress"
	UCAwaitingRev = "Awaiting Review"
	UCBlockedRev  = "Blocked/Revision"
	UCDone        = "Done"
	ucUnknown     = "" // status outside the mapping (defensive)
)

// Card is one work unit on a board — a Brief on the Client Board (§5.3) or a work
// unit (Brief/Asset/Booking/Session) on My Tasks (§5.4). All computed fields are
// derived on read.
type Card struct {
	ID             string     `json:"id"`               // unit id (BRF/AST/BKG/LSS)
	Type           string     `json:"type"`             // entity type: brief|asset|booking|session
	Division       string     `json:"division"`         // Creative/Ads/KOL/Live Stream/...
	ClientID       string     `json:"client_id"`        //
	BriefID        string     `json:"brief_id"`         // owning Brief (== ID for a brief card)
	PIC            string     `json:"pic,omitempty"`    // assigned PIC
	NativeStatus   string     `json:"native_status"`    // the unit's own live status
	UniversalCol   string     `json:"universal_column"` // §5.2 mapping
	DueDate        string     `json:"due_date,omitempty"`
	Overdue        bool       `json:"overdue"`                    // vs Brief SLA/DueDate (§5.3, §6.5)
	DependencyNote string     `json:"dependency_badge,omitempty"` // "Menunggu Dependency" / informational link
	CreatedAt      *time.Time `json:"created_at,omitempty"`
}

// ---- Universal Column mapping (§5.2) -----------------------------------------

// briefTaskUniversal maps a §7 brief_task status (Creative/Ads Brief, and any
// Asset, which run the same machine) to a Universal Column (§5.2 Creative/Ads rows).
func briefTaskUniversal(status string) string {
	switch status {
	case "[To Do]":
		return UCToDo
	case "[In Progress]":
		return UCInProgress
	case "[Submitted]", "[In Review]":
		return UCAwaitingRev
	case "[Revision Requested]", "[Blocked]":
		return UCBlockedRev
	case "[Approved]":
		return UCDone
	default:
		return ucUnknown
	}
}

// kolUniversal maps a set of Creator Booking statuses to a Universal Column via the
// §5.2 KOL roll-up rules (worst-case, §2 Rule 3): any [Escalated] -> Blocked/Revision;
// all [QC Passed] -> Done; else if any is still Submitted/QC Review and none earlier
// -> Awaiting Review; else In Progress. [Dropped] bookings are excluded (STATE_MACHINES
// §8 — excluded from Speed Score); an all-Dropped brief has no active work -> Done-less
// empty maps to To Do defensively.
func kolUniversal(statuses []string) string {
	active := make([]string, 0, len(statuses))
	for _, st := range statuses {
		if st == "[Dropped]" {
			continue
		}
		active = append(active, st)
	}
	if len(active) == 0 {
		return UCToDo
	}
	anyEscalated := false
	anyRevision := false
	allQCPassed := true
	anyEarly := false     // Sourcing/Booked/Content In Progress
	anyMidReview := false // Content Submitted / QC Review
	for _, st := range active {
		switch st {
		case "[Escalated - Creator Unresponsive]":
			anyEscalated = true
		case "[QC Failed - Revision Requested]":
			anyRevision = true
		case "[QC Passed]":
			// terminal-good
		case "[Sourcing]", "[Booked]", "[Content In Progress]":
			anyEarly = true
		case "[Content Submitted]", "[QC Review]":
			anyMidReview = true
		}
		if st != "[QC Passed]" {
			allQCPassed = false
		}
	}
	switch {
	case anyEscalated || anyRevision:
		return UCBlockedRev
	case allQCPassed:
		return UCDone
	case anyEarly:
		return UCInProgress
	case anyMidReview:
		return UCAwaitingRev
	default:
		return UCInProgress
	}
}

// lsUniversal maps a Live Stream Session status to a Universal Column (§5.2 LS row).
func lsUniversal(status string) string {
	switch status {
	case "[Requested]":
		return UCToDo
	case "[Confirmed by Vendor]":
		return UCInProgress
	case "[Completed]":
		return UCAwaitingRev
	case "[Reconciled]":
		return UCDone
	case "[Discrepancy Flagged]":
		return UCBlockedRev // non-blocking flag, still shown (§5.2)
	default:
		return ucUnknown
	}
}

// ucRank orders the Universal Columns from least to most advanced, for the §2 Rule 3
// worst-case roll-up across many sub-entities.
func ucRank(uc string) int {
	switch uc {
	case UCToDo:
		return 0
	case UCInProgress:
		return 1
	case UCAwaitingRev:
		return 2
	case UCBlockedRev:
		// A revision/blocked sub-entity is "not done" — worst-case keeps the Brief off
		// Done. Ranked between Awaiting Review and Done so it dominates only once all
		// forward work has otherwise reached review (§2 Rule 3 "least-advanced stage").
		return 2
	case UCDone:
		return 3
	default:
		return -1
	}
}

// lsBriefUniversal rolls up a Live Stream Brief's Sessions worst-case (§2 Rule 3).
func lsBriefUniversal(sessionStatuses []string) string {
	if len(sessionStatuses) == 0 {
		return UCToDo
	}
	worst := UCDone
	worstR := ucRank(UCDone)
	anyBlocked := false
	for _, st := range sessionStatuses {
		uc := lsUniversal(st)
		if uc == UCBlockedRev {
			anyBlocked = true
		}
		if r := ucRank(uc); r >= 0 && r < worstR {
			worstR = r
			worst = uc
		}
	}
	if worst == UCDone && anyBlocked {
		return UCBlockedRev
	}
	return worst
}

// ---- Client Board (§5.3) ------------------------------------------------------

// ClientBoard returns every Brief of one Client as a Card, grouped implicitly by
// Universal Column (§5.3). Client filter is mandatory. Read scope (§5.3): AM/SPV/OD/
// Director see any Client; a staff member only a Client where they are PIC of a unit.
func (s *Service) ClientBoard(ctx context.Context, actor permission.Actor, clientID string) ([]Card, error) {
	clientID = strings.TrimSpace(clientID)
	if clientID == "" {
		return nil, ErrDepIncomplete
	}
	ok, err := s.canSeeClient(ctx, actor, clientID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrDepViewForbidden
	}
	rows, err := s.DB.QueryContext(ctx,
		`SELECT b.id, b.assigned_division, COALESCE(b.assigned_pic,''), b.status, b.due_date, sv.client_id, b.created_at
		   FROM briefs b
		   JOIN services sv ON sv.id = b.service_id
		  WHERE sv.client_id = ?
		  ORDER BY b.id ASC`, clientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cards []Card
	for rows.Next() {
		c, err := s.scanBriefCard(rows)
		if err != nil {
			return nil, err
		}
		cards = append(cards, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Fill each Brief's Universal Column (may roll up sub-entities) and Dependency badge.
	for i := range cards {
		if err := s.fillBriefCard(ctx, &cards[i]); err != nil {
			return nil, err
		}
	}
	if cards == nil {
		cards = []Card{}
	}
	return cards, nil
}

// scanBriefCard reads a Brief row into a Card (native status + due date), leaving the
// Universal Column / badge to fillBriefCard.
func (s *Service) scanBriefCard(rows *sql.Rows) (Card, error) {
	var c Card
	var due sql.NullTime
	var created time.Time
	if err := rows.Scan(&c.ID, &c.Division, &c.PIC, &c.NativeStatus, &due, &c.ClientID, &created); err != nil {
		return Card{}, err
	}
	c.Type = entityBrief
	c.BriefID = c.ID
	c.CreatedAt = &created
	if due.Valid {
		c.DueDate = due.Time.Format("2006-01-02")
		// Overdue vs Brief SLA (§5.3 / §6.5): due date passed and the Brief is not Done.
		if due.Time.Before(startOfDay(time.Now())) {
			c.Overdue = true
		}
	}
	return c, nil
}

// fillBriefCard computes a Brief card's Universal Column (rolling up KOL Bookings /
// LS Sessions where the Brief's own status does not already reflect them) and its
// Dependency badge (§5.3).
func (s *Service) fillBriefCard(ctx context.Context, c *Card) error {
	switch c.Division {
	case "KOL":
		statuses, err := childStatuses(ctx, s.DB, "creator_bookings", c.BriefID)
		if err != nil {
			return err
		}
		c.UniversalCol = kolUniversal(statuses)
	case "Live Stream":
		statuses, err := childStatuses(ctx, s.DB, "live_stream_sessions", c.BriefID)
		if err != nil {
			return err
		}
		c.UniversalCol = lsBriefUniversal(statuses)
	default: // Creative / Ads — brief.status already reflects the Asset roll-up.
		c.UniversalCol = briefTaskUniversal(c.NativeStatus)
	}
	if c.UniversalCol == UCDone {
		c.Overdue = false // a finished Brief is never "overdue".
	}
	// Dependency badge (§5.3 / §2 Rule 7): a Target with an unsatisfied Blocking
	// Dependency shows "Menunggu Dependency"; an Informational link is noted too.
	badge, err := s.dependencyBadge(ctx, c.BriefID)
	if err != nil {
		return err
	}
	c.DependencyNote = badge
	return nil
}

// dependencyBadge returns the board badge for a Target Brief (§2 Rule 7): if any
// active Blocking Dependency's Source is not yet terminal -> "Menunggu Dependency";
// else if it is an Informational target -> a short link note; else empty.
func (s *Service) dependencyBadge(ctx context.Context, briefID string) (string, error) {
	unsatisfied, err := blockingSourcesUnsatisfied(ctx, s.DB, briefID)
	if err != nil {
		return "", err
	}
	if len(unsatisfied) > 0 {
		return "Menunggu Dependency", nil
	}
	var srcID sql.NullString
	if err := s.DB.QueryRowContext(ctx,
		`SELECT source_id FROM dependencies
		  WHERE target_id = ? AND dependency_type = ? ORDER BY id ASC LIMIT 1`,
		briefID, TypeInformational).Scan(&srcID); err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", err
	}
	if srcID.Valid {
		return "Informational (link ke " + srcID.String + ")", nil
	}
	return "", nil
}

// ---- My Tasks (§5.4) ----------------------------------------------------------

// MyTasks returns the actor's own work units across all Clients (§5.4): Brief-as-task
// rows they PIC (single-unit divisions like Ads), Creative Assets they PIC, KOL
// Bookings they coordinate, and Live Stream Sessions of Briefs they PIC. Each unit is
// a Card with its native status mapped to a Universal Column (§5.2). Read scope is
// intrinsically "own" (default filter PIC = self, §5.4); OD/Director/Account-lead may
// pass a target employee to view that person's tasks (division-wide read, Role Matrix).
func (s *Service) MyTasks(ctx context.Context, actor permission.Actor, forEmployee string) ([]Card, error) {
	target := strings.TrimSpace(forEmployee)
	if target == "" || target == actor.EmployeeID {
		target = actor.EmployeeID
	} else if !(actor.CanReadAll() || actor.CanReadDivision(AccountDivision)) {
		// A staff member may only see their OWN tasks (§5.4 / Role Matrix: Staff = own).
		return nil, ErrDepViewForbidden
	}

	cards := []Card{}

	// Brief-as-task units the actor PICs (Ads and any single-unit Brief).
	briefRows, err := s.DB.QueryContext(ctx,
		`SELECT b.id, b.assigned_division, b.status, b.due_date, sv.client_id
		   FROM briefs b JOIN services sv ON sv.id = b.service_id
		  WHERE b.assigned_pic = ? ORDER BY b.id ASC`, target)
	if err != nil {
		return nil, err
	}
	briefCards, err := scanUnitRows(briefRows, entityBrief, func(division, status string) string {
		return briefTaskUniversal(status)
	})
	if err != nil {
		return nil, err
	}
	cards = append(cards, briefCards...)

	// Creative Assets the actor PICs.
	assetRows, err := s.DB.QueryContext(ctx,
		`SELECT a.id, b.assigned_division, a.status, b.due_date, sv.client_id, a.brief_id
		   FROM assets a JOIN briefs b ON b.id = a.brief_id JOIN services sv ON sv.id = b.service_id
		  WHERE a.assigned_pic = ? ORDER BY a.id ASC`, target)
	if err != nil {
		return nil, err
	}
	assetCards, err := scanChildUnitRows(assetRows, "asset", func(division, status string) string {
		return briefTaskUniversal(status) // Assets run the §7 machine.
	})
	if err != nil {
		return nil, err
	}
	cards = append(cards, assetCards...)

	// KOL Bookings the actor coordinates.
	bkgRows, err := s.DB.QueryContext(ctx,
		`SELECT k.id, b.assigned_division, k.status, b.due_date, sv.client_id, k.brief_id
		   FROM creator_bookings k JOIN briefs b ON b.id = k.brief_id JOIN services sv ON sv.id = b.service_id
		  WHERE k.assigned_coordinator = ? ORDER BY k.id ASC`, target)
	if err != nil {
		return nil, err
	}
	bkgCards, err := scanChildUnitRows(bkgRows, "booking", func(division, status string) string {
		return kolUniversal([]string{status})
	})
	if err != nil {
		return nil, err
	}
	cards = append(cards, bkgCards...)

	// Live Stream Sessions of Briefs the actor PICs (LS has no per-session PIC, §6.3;
	// the AM assigned to the LS Brief owns them).
	lssRows, err := s.DB.QueryContext(ctx,
		`SELECT l.id, b.assigned_division, l.status, b.due_date, sv.client_id, l.brief_id
		   FROM live_stream_sessions l JOIN briefs b ON b.id = l.brief_id JOIN services sv ON sv.id = b.service_id
		  WHERE b.assigned_pic = ? ORDER BY l.id ASC`, target)
	if err != nil {
		return nil, err
	}
	lssCards, err := scanChildUnitRows(lssRows, "session", func(division, status string) string {
		return lsUniversal(status)
	})
	if err != nil {
		return nil, err
	}
	cards = append(cards, lssCards...)

	// Stamp each card's PIC (the target) so the row is self-describing.
	for i := range cards {
		cards[i].PIC = target
	}
	return cards, nil
}

// scanUnitRows scans Brief-as-task rows (id, division, status, due, client) into
// Cards, mapping native status -> Universal Column with mapUC.
func scanUnitRows(rows *sql.Rows, typ string, mapUC func(division, status string) string) ([]Card, error) {
	defer rows.Close()
	var out []Card
	for rows.Next() {
		var c Card
		var due sql.NullTime
		if err := rows.Scan(&c.ID, &c.Division, &c.NativeStatus, &due, &c.ClientID); err != nil {
			return nil, err
		}
		c.Type = typ
		c.BriefID = c.ID
		c.UniversalCol = mapUC(c.Division, c.NativeStatus)
		fillDue(&c, due)
		out = append(out, c)
	}
	return out, rows.Err()
}

// scanChildUnitRows scans sub-entity rows that trail a brief_id (Asset/Booking/Session).
func scanChildUnitRows(rows *sql.Rows, typ string, mapUC func(division, status string) string) ([]Card, error) {
	defer rows.Close()
	var out []Card
	for rows.Next() {
		var c Card
		var due sql.NullTime
		if err := rows.Scan(&c.ID, &c.Division, &c.NativeStatus, &due, &c.ClientID, &c.BriefID); err != nil {
			return nil, err
		}
		c.Type = typ
		c.UniversalCol = mapUC(c.Division, c.NativeStatus)
		fillDue(&c, due)
		out = append(out, c)
	}
	return out, rows.Err()
}

func fillDue(c *Card, due sql.NullTime) {
	if !due.Valid {
		return
	}
	c.DueDate = due.Time.Format("2006-01-02")
	if c.UniversalCol != UCDone && due.Time.Before(startOfDay(time.Now())) {
		c.Overdue = true
	}
}

// childStatuses returns every child row's status for a Brief (KOL bookings / LS
// sessions). table is a fixed, package-controlled identifier (never user input).
func childStatuses(ctx context.Context, db *sql.DB, table, briefID string) ([]string, error) {
	rows, err := db.QueryContext(ctx, "SELECT status FROM "+table+" WHERE brief_id = ?", briefID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var st string
		if err := rows.Scan(&st); err != nil {
			return nil, err
		}
		out = append(out, st)
	}
	return out, rows.Err()
}

func startOfDay(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, t.Location())
}
