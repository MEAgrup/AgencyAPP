package module5_finance

// bermasalah.go implements the [Bermasalah] dispute flag and its joint-SPV
// resolution (W1-18, M5 §5 Rule 5 + M5-OA-5). [Bermasalah] is a parallel flag
// on the Transaction (STATE_MACHINES.md §4), never a status — flagging never
// touches released_to_account_at or payment_status; Account's work already in
// flight is never silently pulled back (M5 §5 Rule 5).
//
// Resolution requires BOTH SPV Finance and SPV Account to cast the CURRENT
// cycle's latest vote as "setuju" before the flag clears; a disagreement
// between the two escalates to the Director, who may rule at any time
// (immediately resolving or keeping the flag). "Current cycle" is bounded by
// transactions.bermasalah_flagged_at (migration 0012) — a vote cast before the
// most recent flag never counts toward this cycle's resolution, so a re-flag
// after resolution starts clean.

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// Vote decisions — the only two values transaction_issue_approvals.decision
// may hold (M5-OA-5).
const (
	DecisionSetuju = "setuju"
	DecisionTolak  = "tolak"
)

// Bahasa Indonesia messages new to this ticket (no PRD-verbatim string is
// quoted for these guards; adopted following the W1-09/W1-14 precedent for
// engineering-authored `[...]` messages — logged in docs/DECISIONS.md).
const (
	MsgNotBermasalah     = "[transaksi tidak sedang berstatus bermasalah]"
	MsgAlreadyBermasalah = "[transaksi sudah berstatus bermasalah]"
)

var (
	// ErrNotBermasalah: an attempt to vote/resolve a Transaction that is not
	// currently flagged.
	ErrNotBermasalah = errors.New(MsgNotBermasalah)
	// ErrAlreadyBermasalah: an attempt to flag a Transaction that is already
	// flagged in the current cycle.
	ErrAlreadyBermasalah = errors.New(MsgAlreadyBermasalah)
)

// canFlagBermasalah: Admin & Finance (staff or lead) or Director (M5 §5 Rule
// 5 — Finance is the one who discovers/declares a dispute/reversal).
func canFlagBermasalah(a permission.Actor) bool {
	if a.Role.Director {
		return true
	}
	return a.Role.Division == FinanceDivision
}

// FlagBermasalah raises the [Bermasalah] flag with a mandatory reason (M5 §5
// Rule 5). It never touches payment_status or released_to_account_at — this
// is a flag, not a status, and Account's ongoing work is never pulled back.
func (s *Service) FlagBermasalah(ctx context.Context, actor permission.Actor, transactionID, reason string) error {
	if !canFlagBermasalah(actor) {
		return ErrForbidden
	}
	if reason == "" {
		return ErrIncomplete
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var bermasalah int
	err = tx.QueryRowContext(ctx,
		`SELECT bermasalah FROM transactions WHERE id = ? FOR UPDATE`, transactionID).Scan(&bermasalah)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if bermasalah != 0 {
		return ErrAlreadyBermasalah
	}

	if _, err := tx.ExecContext(ctx,
		`UPDATE transactions SET bermasalah = 1, bermasalah_flagged_at = NOW(6) WHERE id = ?`, transactionID); err != nil {
		return err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "transaction", EntityID: transactionID, Actor: actor.EmployeeID,
		Action: "bermasalah:flagged",
		Before: map[string]any{"bermasalah": false},
		After:  map[string]any{"bermasalah": true, "reason": reason},
	}); err != nil {
		return err
	}
	return tx.Commit()
}

// voterDivision resolves which "seat" the actor votes from: SPV Finance, SPV
// Account, or Director (a layered Director vote is recorded under its own
// "Director" division and decides immediately, M5-OA-5). Any other actor
// (staff of any division, OD, a Lead outside Finance/Account) has no seat.
func voterDivision(a permission.Actor) (division string, isDirector bool) {
	if a.Role.Director {
		return "Director", true
	}
	if a.Role.Level != permission.LevelLead {
		return "", false
	}
	switch a.Role.Division {
	case FinanceDivision, AccountDivision:
		return a.Role.Division, false
	}
	return "", false
}

func validDecision(d string) bool {
	return d == DecisionSetuju || d == DecisionTolak
}

// VoteBermasalah casts one vote (SPV Finance, SPV Account) or one final
// ruling (Director) on a currently-flagged Transaction (M5-OA-5). Votes are
// append-only; only the CURRENT cycle's latest vote per division/Director
// counts (bounded by bermasalah_flagged_at, see file doc).
//
//   - SPV Finance + SPV Account both "setuju" (current cycle) -> resolved
//     (bermasalah cleared), audited.
//   - Either "tolak", or only one has voted -> still flagged; if BOTH have
//     voted and disagree, GetBermasalahStatus reports "escalated" until a
//     Director rules.
//   - Director may vote at any time; the Director's decision is final and
//     immediate (resolved on "setuju", stays flagged on "tolak"), audited,
//     independent of the two SPVs' votes.
func (s *Service) VoteBermasalah(ctx context.Context, actor permission.Actor, transactionID, decision, note string) error {
	if !validDecision(decision) {
		return ErrIncomplete
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var bermasalah int
	var flaggedAt sql.NullTime
	err = tx.QueryRowContext(ctx,
		`SELECT bermasalah, bermasalah_flagged_at FROM transactions WHERE id = ? FOR UPDATE`, transactionID).
		Scan(&bermasalah, &flaggedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if bermasalah == 0 {
		return ErrNotBermasalah
	}

	division, isDirector := voterDivision(actor)
	if division == "" {
		return ErrForbidden
	}

	var noteArg any
	if note != "" {
		noteArg = note
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO transaction_issue_approvals (transaction_id, division, decision, note, created_by) VALUES (?, ?, ?, ?, ?)`,
		transactionID, division, decision, noteArg, actor.EmployeeID); err != nil {
		return err
	}

	if isDirector {
		resolved := decision == DecisionSetuju
		if resolved {
			if _, err := tx.ExecContext(ctx,
				`UPDATE transactions SET bermasalah = 0 WHERE id = ?`, transactionID); err != nil {
				return err
			}
		}
		if err := audit.Write(ctx, tx, audit.Record{
			EntityType: "transaction", EntityID: transactionID, Actor: actor.EmployeeID,
			Action: "bermasalah:director_decision",
			After:  map[string]any{"decision": decision, "resolved": resolved},
		}); err != nil {
			return err
		}
		return tx.Commit()
	}

	finVote, err := latestVote(ctx, tx, transactionID, FinanceDivision, flaggedAt)
	if err != nil {
		return err
	}
	accVote, err := latestVote(ctx, tx, transactionID, AccountDivision, flaggedAt)
	if err != nil {
		return err
	}
	if finVote == DecisionSetuju && accVote == DecisionSetuju {
		if _, err := tx.ExecContext(ctx,
			`UPDATE transactions SET bermasalah = 0 WHERE id = ?`, transactionID); err != nil {
			return err
		}
		if err := audit.Write(ctx, tx, audit.Record{
			EntityType: "transaction", EntityID: transactionID, Actor: actor.EmployeeID,
			Action: "bermasalah:resolved",
			After:  map[string]any{"finance_vote": finVote, "account_vote": accVote},
		}); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// latestVote returns the most recent vote decision cast by division in the
// CURRENT cycle (created_at after flaggedAt, or all rows if flaggedAt is
// unset), "" if none.
func latestVote(ctx context.Context, q queryRower, transactionID, division string, flaggedAt sql.NullTime) (string, error) {
	query := `SELECT decision FROM transaction_issue_approvals WHERE transaction_id = ? AND division = ?`
	args := []any{transactionID, division}
	if flaggedAt.Valid {
		query += ` AND created_at >= ?`
		args = append(args, flaggedAt.Time)
	}
	query += ` ORDER BY id DESC LIMIT 1`
	var d string
	err := q.QueryRowContext(ctx, query, args...).Scan(&d)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return d, err
}

// VoteRecord is one append-only vote/ruling (for the GET status response).
type VoteRecord struct {
	Division  string `json:"division"`
	Decision  string `json:"decision"`
	Note      string `json:"note,omitempty"`
	Actor     string `json:"actor"`
	CreatedAt string `json:"created_at"`
}

// BermasalahStatus is the GET .../bermasalah response body (flag + votes +
// escalation state).
type BermasalahStatus struct {
	TransactionID string       `json:"transaction_id"`
	Flagged       bool         `json:"flagged"`
	FinanceVote   string       `json:"finance_vote,omitempty"`
	AccountVote   string       `json:"account_vote,omitempty"`
	DirectorVote  string       `json:"director_vote,omitempty"`
	Escalated     bool         `json:"escalated"`
	Votes         []VoteRecord `json:"votes"`
}

// GetBermasalahStatus reports the flag + current-cycle votes + whether the
// case is escalated (both SPVs voted and disagree, no Director ruling yet).
// Visibility follows Transaction visibility (M5 §5, trxVisibility) — the same
// rule the rest of Module 5 uses.
func (s *Service) GetBermasalahStatus(ctx context.Context, actor permission.Actor, transactionID string) (BermasalahStatus, error) {
	rec, err := s.LoadTransaction(ctx, actor, transactionID)
	if err != nil {
		return BermasalahStatus{}, err
	}

	var flaggedAt sql.NullTime
	if err := s.DB.QueryRowContext(ctx,
		`SELECT bermasalah_flagged_at FROM transactions WHERE id = ?`, transactionID).Scan(&flaggedAt); err != nil {
		return BermasalahStatus{}, err
	}

	query := `SELECT division, decision, COALESCE(note, ''), created_by, created_at
	            FROM transaction_issue_approvals WHERE transaction_id = ?`
	args := []any{transactionID}
	if flaggedAt.Valid {
		query += ` AND created_at >= ?`
		args = append(args, flaggedAt.Time)
	}
	query += ` ORDER BY id ASC`
	rows, err := s.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return BermasalahStatus{}, err
	}
	defer rows.Close()

	status := BermasalahStatus{TransactionID: transactionID, Flagged: rec.Bermasalah, Votes: []VoteRecord{}}
	for rows.Next() {
		var v VoteRecord
		var createdAt time.Time
		if err := rows.Scan(&v.Division, &v.Decision, &v.Note, &v.Actor, &createdAt); err != nil {
			return BermasalahStatus{}, err
		}
		v.CreatedAt = createdAt.Format(time.RFC3339)
		status.Votes = append(status.Votes, v)
		switch v.Division {
		case FinanceDivision:
			status.FinanceVote = v.Decision
		case AccountDivision:
			status.AccountVote = v.Decision
		case "Director":
			status.DirectorVote = v.Decision
		}
	}
	if err := rows.Err(); err != nil {
		return BermasalahStatus{}, err
	}

	status.Escalated = status.Flagged && status.DirectorVote == "" &&
		status.FinanceVote != "" && status.AccountVote != "" && status.FinanceVote != status.AccountVote

	return status, nil
}
