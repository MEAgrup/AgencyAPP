package leads

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/db"
)

// ErrLeadNotFound is returned by lookups when no lead matches.
var ErrLeadNotFound = errors.New("leads: lead not found")

// ErrCampaignNotFound is returned when a campaign gate lookup finds nothing.
var ErrCampaignNotFound = errors.New("leads: campaign not found")

const leadColumns = `lead_id, lead_name, phone_raw, phone_normalized, email, source,
	origin_division, origin_campaign, last_touch_campaign, record_status,
	winning_attempt, winning_salesperson_employee_id, scouted_owner_employee_id, manual_review_flag, pool_entered_at`

func scanLead(row interface{ Scan(...any) error }) (*Lead, error) {
	var (
		l                                                                  Lead
		email, originCampaign, lastTouch, winning, winnerEmp, scoutedOwner sql.NullString
		manualReview                                                       bool
		status                                                             string
		poolEnteredAt                                                      sql.NullTime
	)
	if err := row.Scan(
		&l.LeadID, &l.LeadName, &l.PhoneRaw, &l.PhoneNormalized, &email, &l.Source,
		&l.OriginDivision, &originCampaign, &lastTouch, &status,
		&winning, &winnerEmp, &scoutedOwner, &manualReview, &poolEnteredAt,
	); err != nil {
		return nil, err
	}
	l.Email = email.String
	l.OriginCampaign = originCampaign.String
	l.LastTouchCampaign = lastTouch.String
	l.RecordStatus = RecordStatus(status)
	l.WinningAttempt = winning.String
	l.WinningSalespersonID = winnerEmp.String
	l.ScoutedOwnerEmployeeID = scoutedOwner.String
	l.ManualReviewFlag = manualReview
	if poolEnteredAt.Valid {
		l.PoolEnteredAt = poolEnteredAt.Time
	}
	return &l, nil
}

// findByPhone loads the lead whose normalized phone equals key. It uses
// SELECT ... FOR UPDATE so a concurrent intake for the same phone serialises
// on this row (the dedup decision + any write happen atomically). Returns
// ErrLeadNotFound when absent. Must run inside a transaction.
func findByPhone(ctx context.Context, tx *sql.Tx, key string) (*Lead, error) {
	row := tx.QueryRowContext(ctx,
		`SELECT `+leadColumns+` FROM leads WHERE phone_normalized = ? FOR UPDATE`, key)
	l, err := scanLead(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrLeadNotFound
	}
	return l, err
}

// getLeadForUpdate loads one lead by id with SELECT ... FOR UPDATE so
// concurrent claims / win resolutions on the same lead serialise on the row
// (M1 §9.4: win resolution must be atomic — no two winners). Must run inside
// a transaction. Returns ErrLeadNotFound when absent.
func getLeadForUpdate(ctx context.Context, tx *sql.Tx, leadID string) (*Lead, error) {
	row := tx.QueryRowContext(ctx,
		`SELECT `+leadColumns+` FROM leads WHERE lead_id = ? FOR UPDATE`, leadID)
	l, err := scanLead(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrLeadNotFound
	}
	return l, err
}

// setWinner writes the win-resolution outcome on the Lead record in one
// statement: winning attempt + winning salesperson (M1 §6 rule 5) + record
// status won ([Closed - Success], §5 rule 4 row 4). Called ONLY by ResolveWin
// inside its locked transaction; the audit row is the caller's responsibility.
func setWinner(ctx context.Context, q db.Queryer, leadID, winningAttempt, winnerEmployeeID string, now time.Time) error {
	_, err := q.ExecContext(ctx,
		`UPDATE leads
		    SET winning_attempt = ?, winning_salesperson_employee_id = ?, record_status = ?, updated_at = ?
		  WHERE lead_id = ?`,
		winningAttempt, winnerEmployeeID, string(StatusClient), now, leadID)
	return err
}

// GetLead reads one lead by id (no lock). Returns ErrLeadNotFound when absent.
func GetLead(ctx context.Context, q db.Queryer, leadID string) (*Lead, error) {
	row := q.QueryRowContext(ctx, `SELECT `+leadColumns+` FROM leads WHERE lead_id = ?`, leadID)
	l, err := scanLead(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrLeadNotFound
	}
	return l, err
}

// insertLead writes a new lead row. record_status/origin_division/source are
// caller-set; created_at == updated_at == now. pool_entered_at is set when the
// record is born into [Pool] (Marketing import), else NULL.
func insertLead(ctx context.Context, q db.Queryer, l Lead, now time.Time) error {
	var poolEntered any
	if l.RecordStatus == StatusPool {
		poolEntered = now
	}
	_, err := q.ExecContext(ctx,
		`INSERT INTO leads (`+leadColumns+`, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		l.LeadID, l.LeadName, l.PhoneRaw, l.PhoneNormalized, nullStr(l.Email), l.Source,
		l.OriginDivision, nullStr(l.OriginCampaign), nullStr(l.LastTouchCampaign), string(l.RecordStatus),
		nullStr(l.WinningAttempt), nullStr(l.WinningSalespersonID), nullStr(l.ScoutedOwnerEmployeeID), l.ManualReviewFlag,
		poolEntered, now, now,
	)
	if err != nil {
		return fmt.Errorf("leads: insert %s: %w", l.LeadID, err)
	}
	return nil
}

// setRecordStatus updates only record_status (+ optional scouted owner) and
// updated_at; entering [Pool] also stamps pool_entered_at (M1-OA-7 stale
// basis). Used by reopen and by future attempt-driven integration. The audit
// row is the caller's responsibility (service layer).
func setRecordStatus(ctx context.Context, q db.Queryer, leadID string, status RecordStatus, scoutedOwner string, now time.Time) error {
	if status == StatusPool {
		_, err := q.ExecContext(ctx,
			`UPDATE leads SET record_status = ?, scouted_owner_employee_id = ?, pool_entered_at = ?, updated_at = ? WHERE lead_id = ?`,
			string(status), nullStr(scoutedOwner), now, now, leadID)
		return err
	}
	_, err := q.ExecContext(ctx,
		`UPDATE leads SET record_status = ?, scouted_owner_employee_id = ?, updated_at = ? WHERE lead_id = ?`,
		string(status), nullStr(scoutedOwner), now, leadID)
	return err
}

// setLastTouchCampaign writes the non-destructive Last-Touch Campaign field
// (§5). It NEVER touches origin_campaign.
func setLastTouchCampaign(ctx context.Context, q db.Queryer, leadID, campaign string, now time.Time) error {
	_, err := q.ExecContext(ctx,
		`UPDATE leads SET last_touch_campaign = ?, updated_at = ? WHERE lead_id = ?`,
		nullStr(campaign), now, leadID)
	return err
}

// setManualReviewFlag raises the M1-OA-4 manual-review flag on an existing
// record (phone matched but Lead Name differs substantially).
func setManualReviewFlag(ctx context.Context, q db.Queryer, leadID string, now time.Time) error {
	_, err := q.ExecContext(ctx,
		`UPDATE leads SET manual_review_flag = 1, updated_at = ? WHERE lead_id = ?`, now, leadID)
	return err
}

// employeeName resolves an HRIS employee's display name for a block message.
// Falls back to the employee id if the employee row is not present.
func employeeName(ctx context.Context, q db.Queryer, employeeID string) string {
	if employeeID == "" {
		return ""
	}
	var nama string
	err := q.QueryRowContext(ctx, `SELECT nama FROM employees WHERE employee_id = ?`, employeeID).Scan(&nama)
	if err != nil || nama == "" {
		return employeeID
	}
	return nama
}

// getCampaignStub reads the temporary campaign gate row. Returns
// ErrCampaignNotFound when absent.
func getCampaignStub(ctx context.Context, q db.Queryer, campaignID string) (*CampaignStub, error) {
	var c CampaignStub
	err := q.QueryRowContext(ctx,
		`SELECT campaign_id, status, source, owner_employee_id FROM campaign_stub WHERE campaign_id = ?`,
		campaignID,
	).Scan(&c.CampaignID, &c.Status, &c.Source, &c.OwnerEmployeeID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrCampaignNotFound
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// InsertCampaignStub seeds a campaign gate row. This is a TEMPORARY helper for
// the stub table (migrations/0031); it is used by tests and by data-migration
// seeding until the full M3 Campaign entity replaces the stub in Wave 3.
func InsertCampaignStub(ctx context.Context, q db.Queryer, c CampaignStub) error {
	_, err := q.ExecContext(ctx,
		`INSERT INTO campaign_stub (campaign_id, status, source, owner_employee_id, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
		c.CampaignID, c.Status, c.Source, c.OwnerEmployeeID, time.Now().UTC())
	return err
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
