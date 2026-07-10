package sales

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/ids"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// CreateAttempt registers a Prospect attempt for leadID, owned by
// ownerEmployeeID, at business time at. This is the exact signature
// module1_leads consumes as its Sales-registration / Pool-claim interface
// (Wave 1 backlog W1-01/W1-03): module1_leads runs its own mandatory-field
// validation and dedup decision table (M1 §3-5) BEFORE calling this, so by
// the time CreateAttempt is reached the caller has already decided this is a
// valid, non-duplicate registration/claim — CreateAttempt's own mandatory
// check below only guards this package's own three inputs.
//
// q may be a *sql.DB or, more commonly for this call, a *sql.Tx owned by the
// caller (module1_leads) so the id-sequence increment, the row insert, and
// the create+transition audit rows all commit or roll back atomically with
// the caller's own work — a rolled-back caller transaction leaves no orphan
// PRSP id (internal/core/ids's sequence increment itself rolls back with it)
// and no orphan attempt row.
//
// Internally: mandatory-field validation first (no ID on failure) -> PRSP id
// generated via ids.Generator only after that passes -> row inserted at
// status `Pending Validation` -> a `create` audit row -> immediate transition
// to `New Lead` via statemachine.Engine (which appends its own immutable
// transition audit row), matching M0 §3 rule 4: "status New Lead, submitter =
// official owner, timestamp generated".
//
// NOTE (deferred / DECISIONS.md candidate): because CreateAttempt always
// completes the Pending Validation -> New Lead transition synchronously
// before returning, no attempt is ever externally observable in
// `Pending Validation` — the §1 `Pending Validation -> Blocked` (intake
// collision) auto-edge is therefore only reachable in this package via
// SystemTransition against a row placed there for test/administrative
// purposes; in production, module1_leads' own dedup step blocks the
// collision BEFORE ever calling CreateAttempt (M1 §5), so no PRSP is
// generated for that case at all. See the ticket report for the proposed
// DECISIONS.md row.
func (s *Attempts) CreateAttempt(ctx context.Context, q db.Queryer, leadID, ownerEmployeeID string, at time.Time) (string, error) {
	if leadID == "" || ownerEmployeeID == "" || at.IsZero() {
		return "", validationErr()
	}

	id, err := s.idgen.Next(ctx, q, ids.PrefixProspect, at)
	if err != nil {
		return "", fmt.Errorf("sales: generate prospect id: %w", err)
	}

	now := time.Now().UTC()
	if _, err := q.ExecContext(ctx,
		`INSERT INTO prospect_attempts
			(prospect_id, lead_id, owner_employee_id, status, last_status_at, created_at, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, leadID, ownerEmployeeID, string(statemachine.ProspectPendingValidation), now, now, ownerEmployeeID,
	); err != nil {
		return "", fmt.Errorf("sales: insert prospect attempt: %w", err)
	}

	after, _ := json.Marshal(map[string]any{
		"lead_id":           leadID,
		"owner_employee_id": ownerEmployeeID,
		"status":            string(statemachine.ProspectPendingValidation),
	})
	if _, err := s.auditLg.Append(ctx, q, audit.Entry{
		EntityType: string(statemachine.EntityProspect),
		EntityID:   id,
		Actor:      ownerEmployeeID,
		Action:     "create",
		After:      after,
		At:         now,
	}); err != nil {
		return "", fmt.Errorf("sales: audit create: %w", err)
	}

	if err := s.engine.Transition(ctx, q, statemachine.TransitionRequest{
		EntityType: statemachine.EntityProspect,
		EntityID:   id,
		To:         statemachine.ProspectNewLead,
		Actor:      ownerEmployeeID,
	}); err != nil {
		return "", fmt.Errorf("sales: transition to New Lead: %w", err)
	}

	return id, nil
}

// prospectStatusStore is the statemachine.Store adapter over prospect_attempts
// -- the ONLY code path in this package (indeed, in CDPS) permitted to write
// the `status` column for this entity. It is used exclusively by the
// *statemachine.Engine constructed in NewAttempts.
type prospectStatusStore struct{}

var _ statemachine.Store = prospectStatusStore{}

func (prospectStatusStore) GetStatus(ctx context.Context, q db.Queryer, _ statemachine.EntityType, id string) (statemachine.Status, error) {
	var s string
	err := q.QueryRowContext(ctx, `SELECT status FROM prospect_attempts WHERE prospect_id = ?`, id).Scan(&s)
	if err == sql.ErrNoRows {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("sales: get status for %s: %w", id, err)
	}
	return statemachine.Status(s), nil
}

func (prospectStatusStore) SetStatus(ctx context.Context, q db.Queryer, _ statemachine.EntityType, id string, to statemachine.Status) error {
	res, err := q.ExecContext(ctx,
		`UPDATE prospect_attempts SET status = ?, last_status_at = ? WHERE prospect_id = ?`,
		string(to), time.Now().UTC(), id,
	)
	if err != nil {
		return fmt.Errorf("sales: set status for %s: %w", id, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("sales: rows affected for %s: %w", id, err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
