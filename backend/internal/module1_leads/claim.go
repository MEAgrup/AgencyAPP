package leads

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/db"
)

// This file is ticket W1-03 — M1 §6: Competitive Claim, Ownership & Win
// Resolution. Prospect attempts belong to Module 0; this package reaches them
// only through CompetitionResolver (implemented by module0_sales.Attempts),
// mirroring the AttemptCreator seam from W1-01.

// CompetitionResolver is the Module 0 surface win resolution and pool claims
// need: enumerate the attempts still in play on a lead, and auto-close one as
// `[Closed - Kalah Kompetisi]`. Implemented by module0_sales.Attempts
// (structural match — this package never imports module0).
type CompetitionResolver interface {
	// OpenAttempts returns prospectID → ownerEmployeeID for every attempt on
	// leadID not yet in a terminal state.
	OpenAttempts(ctx context.Context, q db.Queryer, leadID string) (map[string]string, error)
	// CloseKalah auto-transitions prospectID to [Closed - Kalah Kompetisi]
	// inside tx (system actor; the engine writes the transition audit row).
	CloseKalah(ctx context.Context, tx *sql.Tx, prospectID string) error
}

const (
	actionClaim       = "claim"        // §6 rule 4: "the claim is logged on the Lead record"
	actionWinResolved = "win_resolved" // §6 rule 5 outcome on the Lead record
)

// ErrAlreadyClaimed — the claiming salesperson already has an open attempt on
// this lead. The PRD allows multiple staff to contest a pool lead (§6 rule 2)
// but nowhere grants the SAME person two parallel attempts, and duplicate
// attempts would double-count contested-attempt metrics (§6 rule 6). No BI
// user string exists for this case (the Pool view hides already-claimed
// leads), so this is a plain sentinel, not a bracketed message.
var ErrAlreadyClaimed = errors.New("leads: salesperson already has an open attempt on this lead")

// ErrWinAlreadyResolved — ResolveWin was called on a lead whose winner is
// already set. First Closed-Success wins (§6 rule 5); a second resolution can
// only be a caller bug, never a legitimate re-run.
var ErrWinAlreadyResolved = errors.New("leads: win already resolved for this lead")

// msgKalahNote is the §6 rule 5 note recorded when competitor attempts
// auto-close, literal template `[lead dimenangkan oleh sales lain (nama)]`;
// "nama" is replaced by the winning salesperson's real name.
func msgKalahNote(winnerName string) string {
	return fmt.Sprintf("[lead dimenangkan oleh sales lain (%s)]", winnerName)
}

// ClaimResult is returned on a successful pool claim.
type ClaimResult struct {
	Lead       *Lead
	ProspectID string
	// Reopened — the record was [Rejected]/[Not Qualified] and the claim went
	// through the reopen path (§6 rule 7 → reference rule 9).
	Reopened bool
}

// ClaimPoolLead is the §6 self-service claim door: any Sales Staff may claim
// a `[Pool]` lead; each claim spawns its own `PRSP-` attempt against the one
// Lead record, and simultaneous claims by different staff are allowed by
// design (M1-OA-1). Outcomes by record status:
//
//   - [Pool]                      → new attempt for the claimant (blocked only
//     if they already own an open attempt — ErrAlreadyClaimed).
//   - [Rejected]/[Not Qualified]  → re-claim (§6 rule 7): record reopens and
//     the claimant gets a fresh attempt, same as the Sales re-registration door.
//   - Scouted-Active              → exclusive, not contestable (§6 rule 3):
//     *BlockedError with the §5 dedup message naming the owner.
//   - [Closed - Success]          → *BlockedError `[lead sudah menjadi klien]`.
//
// The claim (attempt id + claimant) is appended to the Lead record's immutable
// audit log (§6 rule 4, §7).
func (s *Service) ClaimPoolLead(ctx context.Context, conn *sql.DB, actor authz.Identity, resolver CompetitionResolver, leadID string) (*ClaimResult, error) {
	if err := s.authorizeSales(actor); err != nil {
		return nil, err
	}
	var (
		result   *ClaimResult
		blockErr *BlockedError
	)
	err := db.WithTx(ctx, conn, func(tx *sql.Tx) error {
		now := time.Now().UTC()
		l, err := getLeadForUpdate(ctx, tx, leadID)
		if err != nil {
			return err
		}
		switch l.RecordStatus {
		case StatusPool:
			// fall through to the claim below

		case StatusRejected, StatusNotQualified:
			rr, err := s.reopenForSales(ctx, tx, actor, l, now)
			if err != nil {
				return err
			}
			result = &ClaimResult{Lead: rr.Lead, ProspectID: rr.ProspectID, Reopened: true}
			return nil

		case StatusClient:
			blockErr = &BlockedError{Outcome: OutcomeBlockClient, ExistingLeadID: l.LeadID, Message: MsgLeadSudahKlien}
			return nil

		default: // Scouted-Active
			blockErr = &BlockedError{
				Outcome:        OutcomeBlockScouted,
				ExistingLeadID: l.LeadID,
				Message:        msgScoutedDedup(employeeName(ctx, tx, l.ScoutedOwnerEmployeeID)),
			}
			return nil
		}

		open, err := resolver.OpenAttempts(ctx, tx, leadID)
		if err != nil {
			return err
		}
		for _, owner := range open {
			if owner == actor.EmployeeID {
				return ErrAlreadyClaimed
			}
		}
		prsp, err := s.attempts.CreateAttempt(ctx, tx, leadID, actor.EmployeeID, now)
		if err != nil {
			return err
		}
		if err := s.auditLead(ctx, tx, actor.EmployeeID, leadID, actionClaim, nil, mustDoc(map[string]any{
			"lead_id":           leadID,
			"prospect_id":       prsp,
			"owner_employee_id": actor.EmployeeID,
		})); err != nil {
			return err
		}
		result = &ClaimResult{Lead: l, ProspectID: prsp}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if blockErr != nil {
		return nil, blockErr
	}
	return result, nil
}

// ResolveWin fires M1 §6 rule 5 — "the first attempt to reach Closed-Success
// wins the Lead record" — inside the caller's transaction:
//
//  1. Locks the Lead row (no two winners under concurrency) and refuses a
//     second resolution (ErrWinAlreadyResolved).
//  2. Auto-closes every still-open competing attempt as
//     `[Closed - Kalah Kompetisi]` via the resolver (Auto edge, system actor,
//     engine-audited), in deterministic (sorted) order.
//  3. Sets the record's winning attempt + winning salesperson and flips
//     record status to `[Closed - Success]` (§5 rule 4 row 4).
//  4. Appends one `win_resolved` audit row carrying the losers and the §6
//     note `[lead dimenangkan oleh sales lain (nama)]`.
//
// Caller contract: the winning attempt has ALREADY transitioned to
// Closed-Success (module0's engine enforces that lifecycle); ResolveWin is
// invoked in the same transaction by the Closing flow (W1-09) so the closing,
// the winner write, and every competitor close commit or roll back together.
// There is no human actor — resolution is system-fired by the winning close —
// so the audit actor is "system" and no permission check applies.
func (s *Service) ResolveWin(ctx context.Context, tx *sql.Tx, resolver CompetitionResolver, leadID, winningProspectID, winnerEmployeeID string, now time.Time) error {
	l, err := getLeadForUpdate(ctx, tx, leadID)
	if err != nil {
		return err
	}
	if l.WinningAttempt != "" {
		return ErrWinAlreadyResolved
	}

	open, err := resolver.OpenAttempts(ctx, tx, leadID)
	if err != nil {
		return err
	}
	losers := make([]string, 0, len(open))
	for pid := range open {
		// The winner is already terminal (Closed-Success) so it never appears
		// in open; the guard is belt-and-braces against caller misuse.
		if pid != winningProspectID {
			losers = append(losers, pid)
		}
	}
	sort.Strings(losers)
	for _, pid := range losers {
		if err := resolver.CloseKalah(ctx, tx, pid); err != nil {
			return err
		}
	}

	before := leadAfterDoc(*l)
	if err := setWinner(ctx, tx, leadID, winningProspectID, winnerEmployeeID, now); err != nil {
		return err
	}
	return s.auditLead(ctx, tx, "system", leadID, actionWinResolved, before, mustDoc(map[string]any{
		"lead_id":                         leadID,
		"record_status":                   string(StatusClient),
		"winning_attempt":                 winningProspectID,
		"winning_salesperson_employee_id": winnerEmployeeID,
		"kalah_attempts":                  losers,
		"kalah_note":                      msgKalahNote(employeeName(ctx, tx, winnerEmployeeID)),
	}))
}
