package module13_health

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/ident"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// chrPrefix is the house-ID prefix for a Client Health Report Snapshot
// (DATA_MODEL §1). The YYYYMM bucket is the scored PERIOD month, not the run
// month (see migration 0035 / DECISIONS W3-M13-C1).
const chrPrefix = "CHR"

// Snapshot is the API view of a Client Health Report — a stored snapshot, or a
// computed-in-memory live preview (Rule 10). Live previews carry ID "" / an empty
// ComputedAt and are never persisted (Preview).
type Snapshot struct {
	ID               string      `json:"id"`
	ClientID         string      `json:"client_id"`
	PeriodStart      string      `json:"period_start"`
	PeriodEnd        string      `json:"period_end"`
	FinalHealthScore *float64    `json:"final_health_score"`
	ScoreDisplay     string      `json:"score_display"` // e.g. "74.60" or "—" (all-excluded, house rule 7)
	Band             string      `json:"band"`
	ROASToggleState  bool        `json:"roas_toggle_state"`
	Components       []Component `json:"components"`
	ComputedAt       time.Time   `json:"computed_at,omitempty"`
	ComputedBy       string      `json:"computed_by,omitempty"`
	Preview          bool        `json:"preview"` // true for a live, unstored current-month view
}

// computed is the raw output of scoring one Client + period.
type computed struct {
	components []Component
	finalScore *float64 // nil in the defensive all-excluded case
	band       string
	roasState  bool
}

// scoreDisplay renders the composite for the UI: two decimals, or "—" when no
// component was available (house rule 7 division-by-zero rendering).
func scoreDisplay(final *float64) string {
	if final == nil {
		return "—"
	}
	return fmt.Sprintf("%.2f", *final)
}

// computeFor gathers the inputs and runs the pure scoring core for one Client +
// period, against either *sql.DB (preview/read) or *sql.Tx (batch).
func (s *Service) computeFor(ctx context.Context, q rowQuerier, clientID string, per period) (computed, error) {
	cands, roasState, err := s.gatherComponents(ctx, q, clientID, per)
	if err != nil {
		return computed{}, err
	}
	comps, final, band, ok := score(cands)
	c := computed{components: comps, band: band, roasState: roasState}
	if ok {
		f := final
		c.finalScore = &f
	}
	return c, nil
}

// ---- monthly batch sweep (M13 §3 / §5.2) ----

// ScanResult tallies one RunSnapshotJob pass.
type ScanResult struct {
	Period           string `json:"period"`
	SnapshotsMade    int    `json:"snapshots_made"`
	BandDropsFlagged int    `json:"band_drops_flagged"`
}

// RunScan is the authorised entry point for the snapshot-sweep endpoint. Gate =
// Account (any level) or Director (canRunScan), mirroring module5_finance.RunScan
// / module7_creative.RunHoursReminderScan.
func (s *Service) RunScan(ctx context.Context, actor permission.Actor, now time.Time) (ScanResult, error) {
	if !canRunScan(actor) {
		return ScanResult{}, ErrScanForbidden
	}
	return s.RunSnapshotJob(ctx, now)
}

// RunSnapshotJob is the monthly batch (M13 §5.2): it scores every Client for the
// most-recently CLOSED calendar month and writes one immutable snapshot each.
// Idempotent — a client that already has a snapshot for the period is skipped, so
// the job is safe to re-run (dashboard load OR nightly cron), exactly like the M5
// / M7 fire-once sweeps. Each client is scored + inserted in its own row-locked
// transaction so concurrent runs never double-insert (UNIQUE key + re-check).
func (s *Service) RunSnapshotJob(ctx context.Context, now time.Time) (ScanResult, error) {
	per := closedMonthPeriod(now)
	res := ScanResult{Period: per.id}

	rows, err := s.DB.QueryContext(ctx, `SELECT id FROM clients`)
	if err != nil {
		return res, err
	}
	var clientIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return res, err
		}
		clientIDs = append(clientIDs, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return res, err
	}
	rows.Close()

	for _, id := range clientIDs {
		made, dropped, err := s.fireSnapshot(ctx, id, per)
		if err != nil {
			return res, err
		}
		if made {
			res.SnapshotsMade++
		}
		if dropped {
			res.BandDropsFlagged++
		}
	}
	return res, nil
}

// fireSnapshot scores one Client for the period and inserts an immutable snapshot
// if none exists yet (fire-once). It locks the client row so concurrent sweeps
// serialise per client; the UNIQUE(client_id, period_start) key is the ultimate
// idempotency guard. Band-drop emission (Rule 12) happens inside the SAME
// transaction as the insert, so it is naturally fire-once — a re-run finds the
// snapshot already there and does nothing.
func (s *Service) fireSnapshot(ctx context.Context, clientID string, per period) (made, dropped bool, err error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return false, false, err
	}
	defer tx.Rollback()

	// Serialise per-client snapshot creation.
	var lockID string
	if err := tx.QueryRowContext(ctx, `SELECT id FROM clients WHERE id = ? FOR UPDATE`, clientID).Scan(&lockID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, false, nil // client vanished since we listed — skip
		}
		return false, false, err
	}

	// Already snapshotted for this period? Idempotent no-op.
	var existing string
	err = tx.QueryRowContext(ctx,
		`SELECT id FROM client_health_snapshots WHERE client_id = ? AND period_start = ?`,
		clientID, per.startDate).Scan(&existing)
	if err == nil {
		return false, false, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return false, false, err
	}

	c, err := s.computeFor(ctx, tx, clientID, per)
	if err != nil {
		return false, false, err
	}
	compJSON, err := json.Marshal(c.components)
	if err != nil {
		return false, false, err
	}

	// Previous snapshot's band (most recent earlier period) for the drop check.
	prevBand, hasPrev, err := previousBand(ctx, tx, clientID, per.startDate)
	if err != nil {
		return false, false, err
	}

	id, err := ident.Next(ctx, tx, chrPrefix, per.start)
	if err != nil {
		return false, false, err
	}

	var scoreArg any
	if c.finalScore != nil {
		scoreArg = *c.finalScore
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO client_health_snapshots
		   (id, client_id, period_start, period_end, final_health_score, band, roas_toggle_state, components_json, computed_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'system')`,
		id, clientID, per.startDate, per.endDate, scoreArg, c.band, boolToInt(c.roasState), compJSON); err != nil {
		return false, false, err
	}

	// Band drop (Rule 12): a strictly lower band than the previous snapshot →
	// visibility flag to SPV (no gate). Fire-once by construction (one insert).
	if hasPrev && c.band != "" && bandRank(c.band) < bandRank(prevBand) {
		if err := s.emitBandDrop(ctx, tx, clientID, id); err != nil {
			return false, false, err
		}
		dropped = true
	}

	if err := tx.Commit(); err != nil {
		return false, false, err
	}
	return true, dropped, nil
}

// emitBandDrop fires EvClientBandDrop (M13 §Rule 12 / catalog FROZEN). The
// catalog's leadsOfDivision resolver, given Division "Account", routes it to the
// Account leads/SPV. No-op when the catalog is not wired (unit tests).
func (s *Service) emitBandDrop(ctx context.Context, tx *sql.Tx, clientID, snapshotID string) error {
	if s.Catalog == nil {
		return nil
	}
	_, err := s.Catalog.Emit(ctx, tx, notification.Emission{
		Event:      notification.EvClientBandDrop,
		EntityType: "client_health_snapshot",
		EntityID:   snapshotID,
		Actor:      "system",
		Division:   AccountDivision,
	})
	return err
}

// previousBand returns the band of the Client's most recent snapshot strictly
// before periodStart (the trend-continuity comparison for Rule 12).
func previousBand(ctx context.Context, q rowQuerier, clientID, periodStart string) (band string, ok bool, err error) {
	err = q.QueryRowContext(ctx,
		`SELECT band FROM client_health_snapshots
		   WHERE client_id = ? AND period_start < ?
		   ORDER BY period_start DESC LIMIT 1`, clientID, periodStart).Scan(&band)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return band, true, nil
}

// ---- reads (Rule 9 trend, Rule 11 visibility) ----

// Trend returns every stored snapshot for a Client, oldest first (Rule 9 — trend
// reads stored snapshots only, never a retroactive recompute). Visibility gated
// (Rule 11).
func (s *Service) Trend(ctx context.Context, actor permission.Actor, clientID string) ([]Snapshot, error) {
	if err := s.assertCanView(ctx, actor, clientID); err != nil {
		return nil, err
	}
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, client_id, period_start, period_end, final_health_score, band, roas_toggle_state, components_json, computed_at, computed_by
		   FROM client_health_snapshots WHERE client_id = ? ORDER BY period_start ASC`, clientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Snapshot{}
	for rows.Next() {
		snap, err := scanSnapshot(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, snap)
	}
	return out, rows.Err()
}

// GetSnapshot returns one stored snapshot for a Client. periodID ("YYYYMM") picks
// a month; empty picks the latest. Visibility gated (Rule 11). ErrNotFound when
// the client is invisible/absent or has no snapshot for the period.
func (s *Service) GetSnapshot(ctx context.Context, actor permission.Actor, clientID, periodID string) (Snapshot, error) {
	if err := s.assertCanView(ctx, actor, clientID); err != nil {
		return Snapshot{}, err
	}
	q := `SELECT id, client_id, period_start, period_end, final_health_score, band, roas_toggle_state, components_json, computed_at, computed_by
	        FROM client_health_snapshots WHERE client_id = ?`
	args := []any{clientID}
	if periodID != "" {
		q += ` AND DATE_FORMAT(period_start, '%Y%m') = ?`
		args = append(args, periodID)
	}
	q += ` ORDER BY period_start DESC LIMIT 1`
	snap, err := scanSnapshot(s.DB.QueryRowContext(ctx, q, args...))
	if errors.Is(err, sql.ErrNoRows) {
		return Snapshot{}, ErrNotFound
	}
	if err != nil {
		return Snapshot{}, err
	}
	return snap, nil
}

// Preview computes the CURRENT, not-yet-closed month's score read-only (Rule 10 /
// §5.3). It is NEVER stored and never appears on the trend. Visibility gated.
func (s *Service) Preview(ctx context.Context, actor permission.Actor, clientID string, now time.Time) (Snapshot, error) {
	if err := s.assertCanView(ctx, actor, clientID); err != nil {
		return Snapshot{}, err
	}
	per := monthPeriod(now)
	c, err := s.computeFor(ctx, s.DB, clientID, per)
	if err != nil {
		return Snapshot{}, err
	}
	return Snapshot{
		ClientID:         clientID,
		PeriodStart:      per.startDate,
		PeriodEnd:        per.endDate,
		FinalHealthScore: c.finalScore,
		ScoreDisplay:     scoreDisplay(c.finalScore),
		Band:             c.band,
		ROASToggleState:  c.roasState,
		Components:       c.components,
		Preview:          true,
	}, nil
}

// assertCanView loads the Client's owner AM and applies the Rule 11 gate.
// Non-existent or invisible clients are ErrNotFound (an AM cannot probe outside
// its book); a role with no M13 scope at all is ErrForbidden.
func (s *Service) assertCanView(ctx context.Context, actor permission.Actor, clientID string) error {
	if !canScope(actor) {
		return ErrForbidden
	}
	ownerAM, err := clientOwnerAM(ctx, s.DB, clientID)
	if err != nil {
		return err
	}
	if !canView(actor, ownerAM) {
		return ErrNotFound
	}
	return nil
}

// scanSnapshot reads one persisted snapshot row (components_json → []Component).
func scanSnapshot(sc interface{ Scan(...any) error }) (Snapshot, error) {
	var s Snapshot
	var final sql.NullFloat64
	var toggle int
	var compJSON []byte
	var start, end time.Time
	if err := sc.Scan(&s.ID, &s.ClientID, &start, &end, &final, &s.Band, &toggle, &compJSON, &s.ComputedAt, &s.ComputedBy); err != nil {
		return Snapshot{}, err
	}
	s.PeriodStart = start.Format("2006-01-02")
	s.PeriodEnd = end.Format("2006-01-02")
	if final.Valid {
		f := final.Float64
		s.FinalHealthScore = &f
	}
	s.ScoreDisplay = scoreDisplay(s.FinalHealthScore)
	s.ROASToggleState = toggle != 0
	if len(compJSON) > 0 {
		if err := json.Unmarshal(compJSON, &s.Components); err != nil {
			return Snapshot{}, err
		}
	}
	if s.Components == nil {
		s.Components = []Component{}
	}
	return s, nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
