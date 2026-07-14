// Daily Output (M7 §7) — auto-logged, no double entry.
//
// PRD §7 Rule 1: "Every Asset status transition auto-creates a Daily Output
// record for the PIC — no separate manual sheet, no double entry." Every Asset
// status transition ALREADY appends an immutable `transition:[X]->[Y]` row to the
// audit log (actor + timestamp). Daily Output is therefore NOT a typed-in table
// and NOT a nightly snapshot — it is a PURE DERIVED read-model over that immutable
// log (house rule 4: computed, read-only, always recomputable from the timestamp
// log). This is the strongest possible reading of "auto-logged, no double entry":
// there is nothing to write and nothing to double-enter — the production events
// are the audit rows the engine already emits.
//
// Interpretations taken (PRD §7 is terse; logged for DECISIONS, W2-M7-C2):
//
//   - Attribution ("for the PIC", §7 Rule 1): each entry is attributed to the
//     Asset's current Assigned PIC, NOT the transition's actor. §8 Rule 2 confirms
//     this — "Output Quantity KPI = count of [Approved] Assets per PIC", yet the
//     [Approved] transition is driven by the AM; so the output of an approval is
//     the PIC's, not the AM's. A transition on an unassigned Asset (assigned_pic
//     NULL) belongs to no PIC and appears in no feed (it surfaces once claimed).
//
//   - Output Unit Type (§7 Rule 2 / §9.4): derived from the Asset Type
//     (Video / Gambar / Desain / SKU Setup / Copy) — the reliable per-row signal of
//     "what output unit this is". §7 Rule 2 frames the unit by role (Videographer/
//     Editor -> videos, Graphic Designer -> designs, ...), which maps 1:1 to the
//     Asset Type the role produces; the Video/Graphic sub-team role granularity
//     stays deferred (W2-M7-C1).
//
//   - End-of-day lock (§7 Rule 3, "locks at 23:59 local"): "local" = WIB
//     (Asia/Jakarta, O20). Lock is a DERIVED boolean, not a snapshot event: an
//     entry's WIB day is Locked once the current WIB calendar date has moved past
//     it. Because the feed derives from the append-only audit log, past days are
//     immutable BY CONSTRUCTION (there is no edit path at all — stronger than a
//     snapshot). The post-lock "correction requires Team Leader approval" workflow
//     is DEFERRED: the derived model has no mutation surface, and inventing a
//     correction/override entity would require fields/behaviour the PRD does not
//     define (CLAUDE.md: never invent). Flagged for DECISIONS.
//
// Output ID (§9.4, "auto-generated per transition"): the audit row's own id — it is
// exactly one auto-generated identifier per transition, so no new ID scheme is
// minted.
package module7_creative

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/tz"
)

// ErrDailyOutputForbidden: actor may not view this PIC's Daily Output (§9.1 —
// the PIC themselves, the Creative Team Leader, OD, or Director).
var ErrDailyOutputForbidden = errors.New("[anda tidak memiliki akses ke Daily Output ini]")

// timeNow is overridable in tests to exercise the end-of-day lock deterministically.
var timeNow = time.Now

// OutputEntry is one auto-logged Daily Output record (M7 §9.4), derived from a
// single Asset status-transition audit row. Every field is read-only/derived.
type OutputEntry struct {
	OutputID       int64     `json:"output_id"`        // audit row id — auto per transition (§9.4)
	PIC            string    `json:"pic"`              // Asset's Assigned PIC (§7 Rule 1)
	OutputUnitType string    `json:"output_unit_type"` // = Asset Type (§7 Rule 2 / §9.4)
	AssetID        string    `json:"asset_id"`         // Linked Asset (§9.4)
	BriefID        string    `json:"brief_id"`         // Linked Brief (§9.4)
	ClientID       string    `json:"client_id"`        // Linked Client (§9.4)
	Transition     string    `json:"transition"`       // destination status, e.g. "[Approved]"
	Timestamp      time.Time `json:"timestamp"`        // transition timestamp (UTC storage)
	DateWIB        string    `json:"date_wib"`         // WIB calendar-day bucket "2006-01-02" (O20)
	Locked         bool      `json:"locked"`           // §7 Rule 3: WIB day has ended
}

// DailyOutputDay is one PIC's auto-logged output for one WIB calendar day — the
// §7 Flow 2 dashboard view ("today's auto-logged items, nothing to add manually").
type DailyOutputDay struct {
	PIC      string        `json:"pic"`
	DateWIB  string        `json:"date_wib"`
	Locked   bool          `json:"locked"`
	Total    int           `json:"total"`          // all transition outputs that day
	Approved int           `json:"approved_count"` // [Approved] outputs — Output Quantity KPI feed (§8 Rule 2)
	Entries  []OutputEntry `json:"entries"`
}

// DailyOutput returns one PIC's auto-logged Daily Output for the WIB calendar day
// containing `day` (M7 §7). It is recomputed entirely from the immutable audit log;
// it writes nothing. Read gate (§9.1): the PIC themselves, the Creative Team
// Leader (division-wide — sub-team granularity deferred), OD, or Director. Account/
// AM are NOT Daily-Output viewers — this is a Creative-internal production feed,
// distinct from the client-facing Asset read gate.
func (s *Service) DailyOutput(ctx context.Context, actor permission.Actor, pic string, day time.Time) (DailyOutputDay, error) {
	pic = strings.TrimSpace(pic)
	if pic == "" {
		return DailyOutputDay{}, ErrIncomplete
	}
	if !canSeeDailyOutput(actor, pic) {
		return DailyOutputDay{}, ErrDailyOutputForbidden
	}

	// Bucket the target day to WIB (O20). The UTC query window for WIB day D is
	// [D 00:00 WIB, D+1 00:00 WIB) = [(D-1) 17:00 UTC, D 17:00 UTC) — this is why
	// a transition at 01:30 WIB (18:30 UTC the previous UTC date) still lands in
	// day D, the 00:00–07:00 WIB edge the bucketing must get right.
	dayMid := tz.TodayWIB(day)
	nextMid := dayMid.AddDate(0, 0, 1)
	dateWIB := dayMid.Format("2006-01-02")
	locked := dayLocked(dayMid, timeNow())

	rows, err := s.DB.QueryContext(ctx,
		`SELECT al.id, al.action, al.created_at, a.id, a.brief_id, a.asset_type, sv.client_id
		   FROM audit_log al
		   JOIN assets a   ON a.id = al.entity_id
		   JOIN briefs b   ON b.id = a.brief_id
		   JOIN services sv ON sv.id = b.service_id
		  WHERE al.entity_type = 'asset'
		    AND al.action LIKE 'transition:%'
		    AND a.assigned_pic = ?
		    AND al.created_at >= ? AND al.created_at < ?
		  ORDER BY al.created_at ASC, al.id ASC`,
		pic, dayMid.UTC(), nextMid.UTC())
	if err != nil {
		return DailyOutputDay{}, err
	}
	defer rows.Close()

	out := DailyOutputDay{PIC: pic, DateWIB: dateWIB, Locked: locked, Entries: []OutputEntry{}}
	for rows.Next() {
		var (
			id        int64
			action    string
			at        time.Time
			assetID   string
			briefID   string
			assetType string
			clientID  string
		)
		if err := rows.Scan(&id, &action, &at, &assetID, &briefID, &assetType, &clientID); err != nil {
			return DailyOutputDay{}, err
		}
		to, ok := transitionTo(action)
		if !ok {
			continue
		}
		out.Entries = append(out.Entries, OutputEntry{
			OutputID: id, PIC: pic, OutputUnitType: assetType,
			AssetID: assetID, BriefID: briefID, ClientID: clientID,
			Transition: to, Timestamp: at, DateWIB: dateWIB, Locked: locked,
		})
		out.Total++
		if to == StatusApproved {
			out.Approved++
		}
	}
	if err := rows.Err(); err != nil {
		return DailyOutputDay{}, err
	}
	return out, nil
}

// canSeeDailyOutput is the §9.1 Daily-Output read gate: the PIC themselves, the
// Creative Team Leader (division-wide), OD, or Director. Deliberately narrower than
// canSeeAsset — Daily Output is Creative-internal, not client-facing, so Account
// lead / owning AM are excluded.
func canSeeDailyOutput(a permission.Actor, pic string) bool {
	if a.CanReadAll() { // OD / Director
		return true
	}
	if a.IsLead(CreativeDivision) { // Creative Team Leader
		return true
	}
	return a.EmployeeID == pic // own
}

// dayLocked reports whether the WIB day whose midnight is dayMid has ended relative
// to now (§7 Rule 3): locked once the current WIB calendar date is past that day.
// Today's day is still open; future days are not locked.
func dayLocked(dayMid, now time.Time) bool {
	return tz.TodayWIB(now).After(dayMid)
}

// transitionTo extracts the destination state from a "transition:A->B" audit action.
func transitionTo(action string) (string, bool) {
	const prefix = "transition:"
	if !strings.HasPrefix(action, prefix) {
		return "", false
	}
	rest := action[len(prefix):]
	idx := strings.Index(rest, "->")
	if idx < 0 {
		return "", false
	}
	return rest[idx+2:], true
}
