// This file implements Module 6 — Cluster 2: Strategy & Plan (M6 §2 + §4),
// the plan-gated execution path.
//
// A Strategy & Plan (STR-) is created by the OWNING Account Manager for each
// Service whose pinned catalog flag `requires_strategy_plan` is Yes (M6 §4
// Rule 1, 1:1 with the Service). It runs the STR- state machine
// (STATE_MACHINES §6a): [Strategy Drafting] → [Strategy Submitted for Approval]
// → [Strategy Approved]. Submit is the owning AM's action; approve / request-
// revision are SPV/Head Account (Account lead) or Director. On approval the
// parent Service is driven [Awaiting Onboarding] → [Strategy Approved] in the
// SAME transaction (M6 §4 Rule 3), unlocking Brief creation (§4 Rule 5).
//
// House rules honoured here:
//   - the STR ID is minted (ident.Next) ONLY after mandatory-field validation
//     passes (house rule 1);
//   - no status field is ever written by raw UPDATE — status moves only through
//     the transition engine (house rule 2);
//   - revision count is DERIVED from the immutable audit log, never a stored
//     tally (house rule 3/4);
//   - approval / revision are gated division-specifically (Account lead /
//     Director) in code BEFORE the engine transition — stricter than the
//     engine's division-agnostic requireLead, mirroring the Void-Service gate
//     (STATE_MACHINES §6a).
package module6_account

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/ident"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// STR- machine states (STATE_MACHINES §6a) and the parent-Service target.
const (
	StrategyStatusDrafting  = "[Strategy Drafting]"
	StrategyStatusSubmitted = "[Strategy Submitted for Approval]"
	StrategyStatusApproved  = "[Strategy Approved]"

	serviceStatusAwaitingOnboarding = "[Awaiting Onboarding]"
	serviceStatusStrategyApproved   = "[Strategy Approved]"
)

// allowedDivisions is the M6 §4 "Divisions Involved" multi-select set, in
// canonical order (used both to validate input and to store it deterministically).
var allowedDivisions = []string{"Creative", "Ads", "KOL", "Live Stream"}

// Sentinel errors carrying the exact Bahasa Indonesia message the API returns
// (house rule 5). Only ErrStrategyRequired is a PRD/§6-approved string; the rest
// are NEW strings following the W1-09 precedent, listed for orchestrator sign-off.
var (
	// ErrServiceNotFound: the referenced Service does not exist.
	ErrServiceNotFound = errors.New("[layanan tidak ditemukan]")
	// ErrStrategyNotFound: the referenced Strategy & Plan does not exist.
	ErrStrategyNotFound = errors.New("[Strategy & Plan tidak ditemukan]")
	// ErrNotOwnerAM: actor is not the AM who owns this Service's client (§4 Rule 1).
	ErrNotOwnerAM = errors.New("[hanya Account Manager pemilik klien yang dapat mengelola Strategy & Plan layanan ini]")
	// ErrNotPlanGated: Service's catalog flag is No — no Strategy exists (§4 Rule 6).
	ErrNotPlanGated = errors.New("[layanan ini tidak memerlukan Strategy & Plan]")
	// ErrServiceNotAwaiting: a Strategy can only be drafted for an Awaiting-Onboarding Service.
	ErrServiceNotAwaiting = errors.New("[Strategy & Plan hanya dapat dibuat saat layanan berstatus Awaiting Onboarding]")
	// ErrStrategyExists: a Strategy already exists for this Service (1:1, §4 Rule 1).
	ErrStrategyExists = errors.New("[Strategy & Plan untuk layanan ini sudah ada]")
	// ErrNotDraft: draft edits allowed only in [Strategy Drafting].
	ErrNotDraft = errors.New("[Strategy & Plan hanya dapat diubah saat berstatus Strategy Drafting]")
	// ErrApproveForbidden: actor may not approve / request revision (not Account lead / Director).
	ErrApproveForbidden = errors.New("[anda tidak memiliki akses untuk menyetujui atau meminta revisi Strategy & Plan]")
	// ErrRevisionNotesRequired: revision notes are mandatory when requesting a revision (§4 Rule 4).
	ErrRevisionNotesRequired = errors.New("[catatan revisi wajib diisi]")
	// ErrInvalidDivisions: Divisions Involved contains a value outside the allowed set.
	ErrInvalidDivisions = errors.New("[divisi yang terlibat tidak valid]")
	// ErrStrategyForbidden: actor may not read this Strategy & Plan (not owner AM / Account lead / OD / Director).
	ErrStrategyForbidden = errors.New("[anda tidak memiliki akses ke Strategy & Plan ini]")
	// ErrIncomplete: a mandatory field is missing (default house-rule-5 message).
	ErrIncomplete = errors.New("[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]")
	// ErrStrategyRequired: §6-approved guard string — a plan-gated Service must reach
	// [Strategy Approved] before any Brief is created (used by GuardBriefCreation).
	ErrStrategyRequired = errors.New("[layanan ini wajib memiliki Strategy & Plan yang disetujui sebelum dibuatkan Brief]")
)

// StrategyInput carries the mandatory Strategy & Plan content fields (M6 §9.3).
type StrategyInput struct {
	Objective           string
	TargetKPI           string
	DivisionsInvolved   []string
	PlannedBriefOutline string
	TimelineStart       string // YYYY-MM-DD
	TimelineEnd         string // YYYY-MM-DD
}

// Strategy is a Strategy & Plan record.
type Strategy struct {
	ID                  string    `json:"id"`
	ServiceID           string    `json:"service_id"`
	Objective           string    `json:"objective"`
	TargetKPI           string    `json:"target_kpi"`
	DivisionsInvolved   []string  `json:"divisions_involved"`
	PlannedBriefOutline string    `json:"planned_brief_outline"`
	TimelineStart       string    `json:"timeline_start"`
	TimelineEnd         string    `json:"timeline_end"`
	Status              string    `json:"status"`
	ApprovedBy          string    `json:"approved_by,omitempty"`
	RevisionNotes       string    `json:"revision_notes,omitempty"`
	RevisionCount       int       `json:"revision_count"`
	CreatedBy           string    `json:"created_by"`
	CreatedAt           time.Time `json:"created_at"`
}

// canApproveStrategy is the §4 Rule 4 gate: Account lead (SPV/Head Account) or
// Director. IsLead already grants Directors lead authority everywhere.
func canApproveStrategy(a permission.Actor) bool { return a.IsLead(AccountDivision) }

// normalizeAndValidate checks mandatory fields and canonicalizes divisions.
// Returns the canonical comma-joined divisions string on success.
func (in StrategyInput) normalizeAndValidate() (string, error) {
	if strings.TrimSpace(in.Objective) == "" || strings.TrimSpace(in.TargetKPI) == "" ||
		strings.TrimSpace(in.PlannedBriefOutline) == "" ||
		strings.TrimSpace(in.TimelineStart) == "" || strings.TrimSpace(in.TimelineEnd) == "" ||
		len(in.DivisionsInvolved) == 0 {
		return "", ErrIncomplete
	}
	// Timeline must be valid dates with start <= end (date range, §9.3).
	start, err := time.Parse("2006-01-02", strings.TrimSpace(in.TimelineStart))
	if err != nil {
		return "", ErrIncomplete
	}
	end, err := time.Parse("2006-01-02", strings.TrimSpace(in.TimelineEnd))
	if err != nil {
		return "", ErrIncomplete
	}
	if end.Before(start) {
		return "", ErrIncomplete
	}
	// Validate + canonicalize the multi-select against the allowed set, dedup,
	// preserve canonical order for deterministic storage.
	want := map[string]bool{}
	for _, d := range in.DivisionsInvolved {
		d = strings.TrimSpace(d)
		if d == "" {
			return "", ErrInvalidDivisions
		}
		ok := false
		for _, a := range allowedDivisions {
			if a == d {
				ok = true
				break
			}
		}
		if !ok {
			return "", ErrInvalidDivisions
		}
		want[d] = true
	}
	var canon []string
	for _, a := range allowedDivisions {
		if want[a] {
			canon = append(canon, a)
		}
	}
	return strings.Join(canon, ", "), nil
}

func splitDivisions(s string) []string {
	if strings.TrimSpace(s) == "" {
		return []string{}
	}
	parts := strings.Split(s, ", ")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// CreateStrategy drafts a Strategy & Plan for a plan-gated Service (§4 Rules 1,
// 6). Only the owning AM, only while the Service is [Awaiting Onboarding], only
// once (1:1). The STR- ID is minted after validation passes.
func (s *Service) CreateStrategy(ctx context.Context, actor permission.Actor, serviceID string, in StrategyInput) (Strategy, error) {
	divisions, err := in.normalizeAndValidate()
	if err != nil {
		return Strategy{}, err
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Strategy{}, err
	}
	defer tx.Rollback()

	var status string
	var requiresPlan int
	var ownerAM sql.NullString
	err = tx.QueryRowContext(ctx,
		`SELECT sv.status, sv.requires_strategy_plan, c.assigned_am_id
		   FROM services sv JOIN clients c ON c.id = sv.client_id
		  WHERE sv.id = ? FOR UPDATE`, serviceID).Scan(&status, &requiresPlan, &ownerAM)
	if errors.Is(err, sql.ErrNoRows) {
		return Strategy{}, ErrServiceNotFound
	}
	if err != nil {
		return Strategy{}, err
	}
	// Owner AM saja — kecuali Director (akses penuh, preseden W1-13: otoritas
	// per-identitas selalu "PIC itu sendiri ATAU Director").
	if !actor.Role.Director && (!ownerAM.Valid || ownerAM.String != actor.EmployeeID) {
		return Strategy{}, ErrNotOwnerAM
	}
	if requiresPlan != 1 {
		return Strategy{}, ErrNotPlanGated
	}
	if status != serviceStatusAwaitingOnboarding {
		return Strategy{}, ErrServiceNotAwaiting
	}
	// 1:1 guard (explicit, so we return the BI message rather than a raw
	// duplicate-key error from the UNIQUE index).
	var existing string
	err = tx.QueryRowContext(ctx, `SELECT id FROM strategy_plans WHERE service_id = ?`, serviceID).Scan(&existing)
	if err == nil {
		return Strategy{}, ErrStrategyExists
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Strategy{}, err
	}

	id, err := ident.Next(ctx, tx, "STR", time.Now())
	if err != nil {
		return Strategy{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO strategy_plans
		   (id, service_id, objective, target_kpi, divisions_involved, planned_brief_outline,
		    timeline_start, timeline_end, status, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, serviceID, in.Objective, in.TargetKPI, divisions, in.PlannedBriefOutline,
		in.TimelineStart, in.TimelineEnd, StrategyStatusDrafting, actor.EmployeeID); err != nil {
		return Strategy{}, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "strategy_plan", EntityID: id, Actor: actor.EmployeeID, Action: "create",
		After: map[string]any{"status": StrategyStatusDrafting, "service_id": serviceID},
	}); err != nil {
		return Strategy{}, err
	}
	if err := tx.Commit(); err != nil {
		return Strategy{}, err
	}
	return Strategy{
		ID: id, ServiceID: serviceID, Objective: in.Objective, TargetKPI: in.TargetKPI,
		DivisionsInvolved: splitDivisions(divisions), PlannedBriefOutline: in.PlannedBriefOutline,
		TimelineStart: in.TimelineStart, TimelineEnd: in.TimelineEnd, Status: StrategyStatusDrafting,
		CreatedBy: actor.EmployeeID, CreatedAt: time.Now(),
	}, nil
}

// UpdateDraft edits a Strategy's content while it is still in draft. Only the
// owning AM, only in [Strategy Drafting].
func (s *Service) UpdateDraft(ctx context.Context, actor permission.Actor, strategyID string, in StrategyInput) error {
	divisions, err := in.normalizeAndValidate()
	if err != nil {
		return err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	status, ownerAM, _, err := lockStrategy(ctx, tx, strategyID)
	if err != nil {
		return err
	}
	// Owner AM saja — kecuali Director (preseden W1-13).
	if !actor.Role.Director && (!ownerAM.Valid || ownerAM.String != actor.EmployeeID) {
		return ErrNotOwnerAM
	}
	if status != StrategyStatusDrafting {
		return ErrNotDraft
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE strategy_plans SET objective=?, target_kpi=?, divisions_involved=?,
		   planned_brief_outline=?, timeline_start=?, timeline_end=? WHERE id=?`,
		in.Objective, in.TargetKPI, divisions, in.PlannedBriefOutline,
		in.TimelineStart, in.TimelineEnd, strategyID); err != nil {
		return err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "strategy_plan", EntityID: strategyID, Actor: actor.EmployeeID, Action: "update_draft",
		After: map[string]any{"objective": in.Objective, "divisions_involved": divisions},
	}); err != nil {
		return err
	}
	return tx.Commit()
}

// SubmitStrategy moves the Plan [Strategy Drafting] → [Strategy Submitted for
// Approval] (§4 Rule 3). Owning AM (or Director). Driven through the engine.
func (s *Service) SubmitStrategy(ctx context.Context, actor permission.Actor, strategyID string) (statemachine.Result, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return statemachine.Result{}, err
	}
	defer tx.Rollback()

	_, ownerAM, _, err := lockStrategy(ctx, tx, strategyID)
	if err != nil {
		return statemachine.Result{}, err
	}
	// Owner AM saja — kecuali Director (preseden W1-13).
	if !actor.Role.Director && (!ownerAM.Valid || ownerAM.String != actor.EmployeeID) {
		return statemachine.Result{}, ErrNotOwnerAM
	}
	res, err := s.engine().Transition(ctx, tx, statemachine.Request{
		Machine: statemachine.MStrategyPlan, EntityType: "strategy_plan", Table: "strategy_plans",
		EntityID: strategyID, To: StrategyStatusSubmitted, Actor: actor,
	})
	if err != nil {
		return statemachine.Result{}, err
	}
	if err := tx.Commit(); err != nil {
		return statemachine.Result{}, err
	}
	return res, nil
}

// ApproveStrategy approves a submitted Plan (§4 Rule 4). Account lead / Director
// only. On approval the STR- transitions to [Strategy Approved] AND the parent
// Service is driven [Awaiting Onboarding] → [Strategy Approved] in the SAME
// transaction; Approved By is recorded.
func (s *Service) ApproveStrategy(ctx context.Context, actor permission.Actor, strategyID string) error {
	if !canApproveStrategy(actor) {
		return ErrApproveForbidden
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, _, serviceID, err := lockStrategy(ctx, tx, strategyID)
	if err != nil {
		return err
	}
	// 1) STR- [Strategy Submitted for Approval] → [Strategy Approved].
	if _, err := s.engine().Transition(ctx, tx, statemachine.Request{
		Machine: statemachine.MStrategyPlan, EntityType: "strategy_plan", Table: "strategy_plans",
		EntityID: strategyID, To: StrategyStatusApproved, Actor: actor,
	}); err != nil {
		return err
	}
	// 2) Parent Service [Awaiting Onboarding] → [Strategy Approved], same tx (§4 Rule 3).
	if _, err := s.engine().Transition(ctx, tx, statemachine.Request{
		Machine: statemachine.MService, EntityType: "service", Table: "services",
		EntityID: serviceID, To: serviceStatusStrategyApproved, Actor: actor,
	}); err != nil {
		return err
	}
	// 3) Record Approved By.
	if _, err := tx.ExecContext(ctx,
		`UPDATE strategy_plans SET approved_by=? WHERE id=?`, actor.EmployeeID, strategyID); err != nil {
		return err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "strategy_plan", EntityID: strategyID, Actor: actor.EmployeeID, Action: "strategy_approved",
		After: map[string]any{"approved_by": actor.EmployeeID, "service_id": serviceID},
	}); err != nil {
		return err
	}
	return tx.Commit()
}

// RequestRevision sends a submitted Plan back to [Strategy Drafting] (§4 Rule 4).
// Account lead / Director only; revision notes mandatory. Revision count is
// derived from the audit log (the count of these revision transitions).
func (s *Service) RequestRevision(ctx context.Context, actor permission.Actor, strategyID, notes string) error {
	notes = strings.TrimSpace(notes)
	if notes == "" {
		return ErrRevisionNotesRequired
	}
	if !canApproveStrategy(actor) {
		return ErrApproveForbidden
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, _, _, err := lockStrategy(ctx, tx, strategyID); err != nil {
		return err
	}
	if _, err := s.engine().Transition(ctx, tx, statemachine.Request{
		Machine: statemachine.MStrategyPlan, EntityType: "strategy_plan", Table: "strategy_plans",
		EntityID: strategyID, To: StrategyStatusDrafting, Actor: actor,
	}); err != nil {
		return err
	}
	// Latest revision note for display; the immutable per-event record is the
	// audit row below (revision count derives from these).
	if _, err := tx.ExecContext(ctx,
		`UPDATE strategy_plans SET revision_notes=? WHERE id=?`, notes, strategyID); err != nil {
		return err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "strategy_plan", EntityID: strategyID, Actor: actor.EmployeeID, Action: "revision_requested",
		After: map[string]any{"revision_notes": notes},
	}); err != nil {
		return err
	}
	return tx.Commit()
}

// GetStrategy returns one Strategy & Plan with its derived revision count, if the
// actor may see it (owning AM, or Account lead / OD / Director).
func (s *Service) GetStrategy(ctx context.Context, actor permission.Actor, strategyID string) (Strategy, error) {
	st, ownerAM, err := s.loadStrategy(ctx, s.DB, strategyID)
	if err != nil {
		return Strategy{}, err
	}
	if !(actor.CanReadDivision(AccountDivision) || ownerAM == actor.EmployeeID) {
		return Strategy{}, ErrStrategyForbidden
	}
	entries, err := audit.List(ctx, s.DB, audit.Filter{EntityType: "strategy_plan", EntityID: strategyID})
	if err != nil {
		return Strategy{}, err
	}
	st.RevisionCount = deriveRevisionCount(entries)
	return st, nil
}

// ListStrategies returns the Strategies visible to the actor (§3 visibility):
// Account lead / OD / Director see all; an AM sees those on clients they own.
func (s *Service) ListStrategies(ctx context.Context, actor permission.Actor) ([]Strategy, error) {
	var (
		rows *sql.Rows
		err  error
	)
	base := `SELECT sp.id, sp.service_id, sp.objective, sp.target_kpi, sp.divisions_involved,
	                sp.planned_brief_outline, sp.timeline_start, sp.timeline_end, sp.status,
	                COALESCE(sp.approved_by,''), COALESCE(sp.revision_notes,''), sp.created_by, sp.created_at
	           FROM strategy_plans sp`
	switch {
	case actor.CanReadDivision(AccountDivision):
		rows, err = s.DB.QueryContext(ctx, base+` ORDER BY sp.id DESC`)
	case actor.Role.Division == AccountDivision && actor.Role.Level == permission.LevelStaff:
		rows, err = s.DB.QueryContext(ctx,
			base+` JOIN services sv ON sv.id = sp.service_id
			        JOIN clients c ON c.id = sv.client_id
			       WHERE c.assigned_am_id = ? ORDER BY sp.id DESC`, actor.EmployeeID)
	default:
		return nil, ErrStrategyForbidden
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Strategy{}
	for rows.Next() {
		st, err := scanStrategy(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, st)
	}
	return out, rows.Err()
}

// GuardBriefCreation is the §6 data-dependent guard the Brief-creation cluster
// must call BEFORE driving a Service's [Awaiting Onboarding] → [Briefed] edge.
// A plan-gated Service (requires_strategy_plan = Yes) still at [Awaiting
// Onboarding] has not cleared its Strategy gate, so Brief creation is rejected
// with ErrStrategyRequired. Direct Services (flag = No), or plan-gated Services
// already past [Strategy Approved], pass. The engine cannot see the per-row
// flag, so this stays a code guard (STATE_MACHINES §6/§6a).
func GuardBriefCreation(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, serviceID string) error {
	var status string
	var requiresPlan int
	err := q.QueryRowContext(ctx,
		`SELECT status, requires_strategy_plan FROM services WHERE id = ?`, serviceID).Scan(&status, &requiresPlan)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrServiceNotFound
	}
	if err != nil {
		return err
	}
	if requiresPlan == 1 && status == serviceStatusAwaitingOnboarding {
		return ErrStrategyRequired
	}
	return nil
}

// ---- helpers ----------------------------------------------------------------

// lockStrategy takes the row lock and returns (status, owning-AM, service_id).
func lockStrategy(ctx context.Context, tx *sql.Tx, strategyID string) (status string, ownerAM sql.NullString, serviceID string, err error) {
	err = tx.QueryRowContext(ctx,
		`SELECT sp.status, sp.service_id, c.assigned_am_id
		   FROM strategy_plans sp
		   JOIN services sv ON sv.id = sp.service_id
		   JOIN clients c ON c.id = sv.client_id
		  WHERE sp.id = ? FOR UPDATE`, strategyID).Scan(&status, &serviceID, &ownerAM)
	if errors.Is(err, sql.ErrNoRows) {
		return "", sql.NullString{}, "", ErrStrategyNotFound
	}
	if err != nil {
		return "", sql.NullString{}, "", err
	}
	return status, ownerAM, serviceID, nil
}

func (s *Service) loadStrategy(ctx context.Context, q *sql.DB, strategyID string) (Strategy, string, error) {
	var st Strategy
	var ownerAM sql.NullString
	var approvedBy, revNotes sql.NullString
	var tStart, tEnd time.Time
	var divisions string
	err := q.QueryRowContext(ctx,
		`SELECT sp.id, sp.service_id, sp.objective, sp.target_kpi, sp.divisions_involved,
		        sp.planned_brief_outline, sp.timeline_start, sp.timeline_end, sp.status,
		        sp.approved_by, sp.revision_notes, sp.created_by, sp.created_at, c.assigned_am_id
		   FROM strategy_plans sp
		   JOIN services sv ON sv.id = sp.service_id
		   JOIN clients c ON c.id = sv.client_id
		  WHERE sp.id = ?`, strategyID).Scan(
		&st.ID, &st.ServiceID, &st.Objective, &st.TargetKPI, &divisions,
		&st.PlannedBriefOutline, &tStart, &tEnd, &st.Status,
		&approvedBy, &revNotes, &st.CreatedBy, &st.CreatedAt, &ownerAM)
	if errors.Is(err, sql.ErrNoRows) {
		return Strategy{}, "", ErrStrategyNotFound
	}
	if err != nil {
		return Strategy{}, "", err
	}
	st.DivisionsInvolved = splitDivisions(divisions)
	st.TimelineStart = tStart.Format("2006-01-02")
	st.TimelineEnd = tEnd.Format("2006-01-02")
	st.ApprovedBy = approvedBy.String
	st.RevisionNotes = revNotes.String
	return st, ownerAM.String, nil
}

func scanStrategy(rows *sql.Rows) (Strategy, error) {
	var st Strategy
	var approvedBy, revNotes string
	var tStart, tEnd time.Time
	var divisions string
	if err := rows.Scan(&st.ID, &st.ServiceID, &st.Objective, &st.TargetKPI, &divisions,
		&st.PlannedBriefOutline, &tStart, &tEnd, &st.Status,
		&approvedBy, &revNotes, &st.CreatedBy, &st.CreatedAt); err != nil {
		return Strategy{}, err
	}
	st.DivisionsInvolved = splitDivisions(divisions)
	st.TimelineStart = tStart.Format("2006-01-02")
	st.TimelineEnd = tEnd.Format("2006-01-02")
	st.ApprovedBy = approvedBy
	st.RevisionNotes = revNotes
	return st, nil
}

// deriveRevisionCount counts revision-request transitions in the immutable audit
// log (§4 Rule 4 — revision count is derived, never a stored tally).
func deriveRevisionCount(entries []audit.Entry) int {
	n := 0
	want := "transition:" + StrategyStatusSubmitted + "->" + StrategyStatusDrafting
	for _, e := range entries {
		if e.Action == want {
			n++
		}
	}
	return n
}
