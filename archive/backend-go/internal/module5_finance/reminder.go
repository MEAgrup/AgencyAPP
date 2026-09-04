package module5_finance

// reminder.go is the payment reminder dashboard + dual-audience scan (W1-17,
// M5 §6 + DECISIONS O5-M5/OD-3) and the soft 7-day contract expectation
// (W1-18, M5 §7 Rule 3 / M5-OA-3). All three sweeps are fire-once (idempotent)
// so ScanReminders may run on every dashboard load AND on a nightly cron
// without ever double-notifying (M5 §6 Flow 1: "nightly or on dashboard
// load").
//
// The engine's event hook (httpapi.App.onTransition, api.go) is FROZEN and
// cannot be extended for this build stream (docs/handoff/WAVE1_PARALLEL_PLAN.md
// §5), and two of the three sweeps here (H-3 reminder, contract flag) do not
// even involve a status transition to hook into. So this file emits
// notifications directly via the caller-supplied *notification.Catalog rather
// than through the engine hook — the catalog is passed as a parameter instead
// of added to Service, keeping module5_finance/transaction.go untouched.

import (
	"context"
	"database/sql"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/core/tz"
)

// systemActor drives the fire-once [Belum Jatuh Tempo] -> [Jatuh Tempo]
// transition during an automated scan (M5 §6 Flow 1) — no human actor
// initiates it. The edge carries no requireLead gate (STATE_MACHINES.md §5),
// so a synthetic actor with no division/level never hits the engine's role
// gate; it is only ever used for this one edge.
var systemActor = permission.Actor{EmployeeID: "system"}

// ScanResult tallies what one ScanReminders pass actually fired (for the scan
// endpoint's summary response, M5 §6).
type ScanResult struct {
	OverdueFlagged      int `json:"overdue_flagged"`
	H3RemindersSent     int `json:"h3_reminders_sent"`
	ContractFlagsRaised int `json:"contract_flags_raised"`
}

// ScanReminders runs the M5 §6 dual-audience reminder sweep plus the M5 §7
// soft 7-day contract expectation (W1-18). Three independent passes, each row
// fire-once guarded by its own *_at column:
//
//  1. Overdue: [Belum Jatuh Tempo] installments whose due_date has passed ->
//     transition to [Jatuh Tempo] (STATE_MACHINES.md §5) + set the parallel
//     jatuh_tempo flag + notify the dual audience (Commission & Payment PIC ∪
//     Finance lead — DECISIONS O5-M5/OD-3) exactly once.
//  2. H-3: due within the next 3 days, not yet due -> notify the SAME dual
//     audience once, WITHOUT any status transition (still [Belum Jatuh
//     Tempo] — M5 §6 Flow 2).
//  3. Contract 7-day (W1-18): Transactions released to Account more than 7
//     days ago with no contract attached -> notify Finance leads once.
//     Non-blocking: never touches status or routing (M5-OA-3).
//
// Bayar Sebagian's open-ended remainder never creates an installment row (M5
// §4 Rule 2), so it never enters this scan at all — by construction, not by a
// special-case filter.
func (s *Service) ScanReminders(ctx context.Context, cat *notification.Catalog, now time.Time) (ScanResult, error) {
	var res ScanResult
	// Calendar "today" is bucketed in WIB, not UTC (DECISIONS O20): due-date
	// comparisons and the H-3 window are civil-date operations. Absolute
	// timestamps written by the sweeps (NOW()) are untouched.
	today := tz.Date(now)

	n, err := s.scanOverdue(ctx, cat, today)
	if err != nil {
		return res, err
	}
	res.OverdueFlagged = n

	n, err = s.scanH3(ctx, cat, today)
	if err != nil {
		return res, err
	}
	res.H3RemindersSent = n

	n, err = s.scanContractOverdue(ctx, cat, now)
	if err != nil {
		return res, err
	}
	res.ContractFlagsRaised = n

	return res, nil
}

// canRunScan: Finance (any level) or Director may trigger the scan endpoint
// on demand (M5 §8.1 — Finance owns the reminder dashboard).
func canRunScan(a permission.Actor) bool {
	if a.Role.Director {
		return true
	}
	return a.Role.Division == FinanceDivision
}

// RunScan is the authorised entry point for POST /finance/reminders/scan.
func (s *Service) RunScan(ctx context.Context, cat *notification.Catalog, actor permission.Actor, now time.Time) (ScanResult, error) {
	if !canRunScan(actor) {
		return ScanResult{}, ErrForbidden
	}
	return s.ScanReminders(ctx, cat, now)
}

// ---- overdue pass ----

func (s *Service) scanOverdue(ctx context.Context, cat *notification.Catalog, today time.Time) (int, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, transaction_id FROM installments WHERE status = ? AND due_date < ?`,
		InstBelumJatuhTempo, today.Format("2006-01-02"))
	if err != nil {
		return 0, err
	}
	type cand struct{ id, trx string }
	var cands []cand
	for rows.Next() {
		var c cand
		if err := rows.Scan(&c.id, &c.trx); err != nil {
			rows.Close()
			return 0, err
		}
		cands = append(cands, c)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()

	fired := 0
	for _, c := range cands {
		ok, err := s.fireOverdue(ctx, cat, c.id, c.trx)
		if err != nil {
			return fired, err
		}
		if ok {
			fired++
		}
	}
	return fired, nil
}

func (s *Service) fireOverdue(ctx context.Context, cat *notification.Catalog, instID, trxID string) (bool, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	var status string
	var notifiedAt sql.NullTime
	if err := tx.QueryRowContext(ctx,
		`SELECT status, overdue_notified_at FROM installments WHERE id = ? FOR UPDATE`, instID).
		Scan(&status, &notifiedAt); err != nil {
		return false, err
	}
	if status != InstBelumJatuhTempo {
		// Already moved on since we listed candidates (verified, or a prior
		// scan already flagged it) — nothing to do.
		return false, nil
	}

	if _, err := s.Engine.Transition(ctx, tx, statemachine.Request{
		Machine: statemachine.MInstallment, EntityType: "installment", Table: "installments",
		EntityID: instID, To: InstJatuhTempo, Actor: systemActor,
	}); err != nil {
		return false, err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE installments SET jatuh_tempo = 1 WHERE id = ?`, instID); err != nil {
		return false, err
	}

	if !notifiedAt.Valid {
		pic, err := commissionPIC(ctx, tx, trxID)
		if err != nil {
			return false, err
		}
		if _, err := cat.Emit(ctx, tx, notification.Emission{
			Event: notification.EvInstallmentDue, EntityType: "installment", EntityID: instID,
			Actor: systemActor.EmployeeID, Division: FinanceDivision, ExplicitRecipients: []string{pic},
		}); err != nil {
			return false, err
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE installments SET overdue_notified_at = NOW() WHERE id = ?`, instID); err != nil {
			return false, err
		}
	}

	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

// ---- H-3 pass ----

func (s *Service) scanH3(ctx context.Context, cat *notification.Catalog, today time.Time) (int, error) {
	windowEnd := today.AddDate(0, 0, 3)
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, transaction_id FROM installments
		   WHERE status = ? AND due_date BETWEEN ? AND ? AND reminder_h3_sent_at IS NULL`,
		InstBelumJatuhTempo, today.Format("2006-01-02"), windowEnd.Format("2006-01-02"))
	if err != nil {
		return 0, err
	}
	type cand struct{ id, trx string }
	var cands []cand
	for rows.Next() {
		var c cand
		if err := rows.Scan(&c.id, &c.trx); err != nil {
			rows.Close()
			return 0, err
		}
		cands = append(cands, c)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()

	fired := 0
	for _, c := range cands {
		ok, err := s.fireH3(ctx, cat, c.id, c.trx)
		if err != nil {
			return fired, err
		}
		if ok {
			fired++
		}
	}
	return fired, nil
}

func (s *Service) fireH3(ctx context.Context, cat *notification.Catalog, instID, trxID string) (bool, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	var status string
	var sent sql.NullTime
	if err := tx.QueryRowContext(ctx,
		`SELECT status, reminder_h3_sent_at FROM installments WHERE id = ? FOR UPDATE`, instID).
		Scan(&status, &sent); err != nil {
		return false, err
	}
	if status != InstBelumJatuhTempo || sent.Valid {
		return false, nil
	}

	pic, err := commissionPIC(ctx, tx, trxID)
	if err != nil {
		return false, err
	}
	if _, err := cat.Emit(ctx, tx, notification.Emission{
		Event: notification.EvInstallmentDue, EntityType: "installment", EntityID: instID,
		Actor: systemActor.EmployeeID, Division: FinanceDivision, ExplicitRecipients: []string{pic},
	}); err != nil {
		return false, err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE installments SET reminder_h3_sent_at = NOW() WHERE id = ?`, instID); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

// commissionPIC resolves the Commission & Payment PIC for the client that owns
// trxID (M4 §5 Rule 5 / DECISIONS OD-3 — collection reminders target this
// role, not necessarily the Primary Sales PIC).
func commissionPIC(ctx context.Context, q queryRower, trxID string) (string, error) {
	var pic string
	err := q.QueryRowContext(ctx,
		`SELECT c.commission_payment_pic_id FROM transactions t JOIN clients c ON c.id = t.client_id WHERE t.id = ?`,
		trxID).Scan(&pic)
	return pic, err
}

// ---- contract 7-day pass (W1-18) ----

func (s *Service) scanContractOverdue(ctx context.Context, cat *notification.Catalog, now time.Time) (int, error) {
	cutoff := now.Add(-7 * 24 * time.Hour)
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id FROM transactions
		   WHERE released_to_account_at IS NOT NULL
		     AND contract_attachment IS NULL
		     AND released_to_account_at < ?
		     AND contract_overdue_flagged_at IS NULL`, cutoff)
	if err != nil {
		return 0, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()

	fired := 0
	for _, id := range ids {
		ok, err := s.fireContractOverdue(ctx, cat, id, cutoff)
		if err != nil {
			return fired, err
		}
		if ok {
			fired++
		}
	}
	return fired, nil
}

func (s *Service) fireContractOverdue(ctx context.Context, cat *notification.Catalog, trxID string, cutoff time.Time) (bool, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	var released sql.NullTime
	var contract sql.NullString
	var flaggedAt sql.NullTime
	if err := tx.QueryRowContext(ctx,
		`SELECT released_to_account_at, contract_attachment, contract_overdue_flagged_at
		   FROM transactions WHERE id = ? FOR UPDATE`, trxID).
		Scan(&released, &contract, &flaggedAt); err != nil {
		return false, err
	}
	if flaggedAt.Valid || contract.Valid || !released.Valid || !released.Time.Before(cutoff) {
		return false, nil
	}

	if _, err := cat.Emit(ctx, tx, notification.Emission{
		Event: notification.EvContractNotReceived, EntityType: "transaction", EntityID: trxID,
		Actor: systemActor.EmployeeID, Division: FinanceDivision,
	}); err != nil {
		return false, err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE transactions SET contract_overdue_flagged_at = NOW() WHERE id = ?`, trxID); err != nil {
		return false, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "transaction", EntityID: trxID, Actor: systemActor.EmployeeID,
		Action: "contract:overdue_flagged",
		After:  map[string]any{"released_to_account_at": released.Time},
	}); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

// ---- dashboard (M5 §6) ----

// ReminderRow is one dashboard row — an installment due soon or already
// overdue (M5 §6 Rule 1-2).
type ReminderRow struct {
	ClientID      string      `json:"client_id"`
	Toko          string      `json:"toko"`
	TransactionID string      `json:"transaction_id"`
	InstallmentID string      `json:"installment_id"`
	InstallmentNo int         `json:"installment_no"`
	Amount        money.Money `json:"-"`
	DueDate       time.Time   `json:"due_date"`
	Status        string      `json:"status"`
	DaysOverdue   int         `json:"days_overdue"`
	Label         string      `json:"label,omitempty"`
	overdue       bool
}

// OutstandingRow is one Bayar Sebagian awareness-only row: verified partial,
// open-ended remainder, no due date and no overdue logic (M5 §6 Rule 4 /
// M5-OA-2).
type OutstandingRow struct {
	ClientID          string
	Toko              string
	TransactionID     string
	AmountOutstanding money.Money
}

// Dashboard is the M5 §6 payment reminder dashboard payload.
type Dashboard struct {
	Reminders            []ReminderRow
	OutstandingNoDueDate []OutstandingRow
}

// dashboardVisibility mirrors trxVisibility but the dashboard is NOT an M5 §5
// gate check on a single record — it is a role-scoped list. Account has no
// audience role in M5 §6 at all (Rule 3: Sales chases, Finance verifies), so
// Account gets ErrForbidden rather than an empty/filtered list.
func dashboardVisibility(actor permission.Actor) (clause string, args []any, ok bool) {
	if actor.Role.Director || actor.Role.OD {
		return "1=1", nil, true
	}
	switch actor.Role.Division {
	case FinanceDivision:
		return "1=1", nil, true
	case SalesDivision:
		if actor.Role.Level == permission.LevelLead {
			return "1=1", nil, true
		}
		return "(c.sales_pic_id = ? OR EXISTS (" +
				"SELECT 1 FROM client_sales_allocations a WHERE a.client_id = c.id AND a.salesperson_id = ?))",
			[]any{actor.EmployeeID, actor.EmployeeID}, true
	default:
		return "", nil, false
	}
}

// Dashboard runs ScanReminders(now) first (M5 §6 Flow 1: "on dashboard load"),
// then returns the role-scoped reminder list + the outstanding-no-due-date
// awareness list.
func (s *Service) Dashboard(ctx context.Context, cat *notification.Catalog, actor permission.Actor, now time.Time) (Dashboard, error) {
	clause, visArgs, ok := dashboardVisibility(actor)
	if !ok {
		return Dashboard{}, ErrForbidden
	}
	if _, err := s.ScanReminders(ctx, cat, now); err != nil {
		return Dashboard{}, err
	}

	today := tz.Date(now) // WIB calendar day (DECISIONS O20)
	windowEnd := today.AddDate(0, 0, 3)

	q := `SELECT i.id, i.installment_no, i.amount, i.due_date, i.status, i.transaction_id, c.id, c.toko
	        FROM installments i
	        JOIN transactions t ON t.id = i.transaction_id
	        JOIN clients c ON c.id = t.client_id
	       WHERE ((i.status = ? AND i.due_date BETWEEN ? AND ?) OR i.status = ?) AND (` + clause + `)`
	args := append([]any{InstBelumJatuhTempo, today.Format("2006-01-02"), windowEnd.Format("2006-01-02"), InstJatuhTempo}, visArgs...)

	rows, err := s.DB.QueryContext(ctx, q, args...)
	if err != nil {
		return Dashboard{}, err
	}
	var reminders []ReminderRow
	for rows.Next() {
		var r ReminderRow
		var amt string
		var due time.Time
		if err := rows.Scan(&r.InstallmentID, &r.InstallmentNo, &amt, &due, &r.Status, &r.TransactionID, &r.ClientID, &r.Toko); err != nil {
			rows.Close()
			return Dashboard{}, err
		}
		m, err := money.Parse(amt)
		if err != nil {
			rows.Close()
			return Dashboard{}, err
		}
		r.Amount = m
		r.DueDate = due
		r.overdue = r.Status == InstJatuhTempo
		if r.overdue {
			days := tz.DaysBetween(due, now)
			if days < 0 {
				days = 0
			}
			r.DaysOverdue = days
			r.Label = overdueLabel(days)
		}
		reminders = append(reminders, r)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return Dashboard{}, err
	}
	rows.Close()

	sortReminders(reminders)

	outstanding, err := s.outstandingNoDueDate(ctx, clause, visArgs)
	if err != nil {
		return Dashboard{}, err
	}

	return Dashboard{Reminders: reminders, OutstandingNoDueDate: outstanding}, nil
}

// overdueLabel renders the exact M5 §6 Flow 2 string, e.g. "[jatuh tempo 3
// hari, segera tindak lanjuti]".
func overdueLabel(days int) string {
	return "[jatuh tempo " + itoa(days) + " hari, segera tindak lanjuti]"
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// sortReminders puts overdue rows first (earliest due date = most overdue
// first), then upcoming rows by due date ascending (M5 §6 Rule 1: "sorted
// overdue-first").
func sortReminders(rows []ReminderRow) {
	for i := 1; i < len(rows); i++ {
		for j := i; j > 0 && reminderLess(rows[j], rows[j-1]); j-- {
			rows[j], rows[j-1] = rows[j-1], rows[j]
		}
	}
}

func reminderLess(a, b ReminderRow) bool {
	if a.overdue != b.overdue {
		return a.overdue // overdue sorts before upcoming
	}
	return a.DueDate.Before(b.DueDate)
}

// outstandingNoDueDate lists verified-partial Transactions with NO
// installment schedule at all — by construction, the Bayar Sebagian scheme
// (M5 §4 Rule 2 / §6 Rule 4): genuinely open-ended, no due date, awareness
// only.
func (s *Service) outstandingNoDueDate(ctx context.Context, clause string, args []any) ([]OutstandingRow, error) {
	q := `SELECT t.id, t.total_agreed_value, c.id, c.toko
	        FROM transactions t JOIN clients c ON c.id = t.client_id
	       WHERE t.payment_status = ?
	         AND NOT EXISTS (SELECT 1 FROM installments i WHERE i.transaction_id = t.id)
	         AND (` + clause + `)`
	qArgs := append([]any{TrxTerverifikasiSebagian}, args...)
	rows, err := s.DB.QueryContext(ctx, q, qArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []OutstandingRow
	for rows.Next() {
		var r OutstandingRow
		var total string
		if err := rows.Scan(&r.TransactionID, &total, &r.ClientID, &r.Toko); err != nil {
			return nil, err
		}
		totalMoney, err := money.Parse(total)
		if err != nil {
			return nil, err
		}
		direct, err := directVerifiedTotal(ctx, s.DB, r.TransactionID)
		if err != nil {
			return nil, err
		}
		r.AmountOutstanding = aggregate(totalMoney, nil, direct).AmountOutstanding()
		out = append(out, r)
	}
	return out, rows.Err()
}
