// This file implements Module 6 — Cluster 3: Service → Brief breakdown (M6 §5)
// and Brief dispatch (M6 §6).
//
// A Brief (BRF-) is the unit of work Account sends to ONE execution division
// (Creative / Ads / KOL / Live Stream). One Service fans out into many Briefs
// across divisions (M6 §5 Rule 1). Brief creation is the OWNING AM's action
// (plus Director, precedent W1-13), gated by GuardBriefCreation (strategy.go):
// a plan-gated Service must have reached [Strategy Approved] first; a Direct
// Service may be broken down straight away (§5 Rule 5).
//
// Lifecycle (STATE_MACHINES §7, the canonical Task machine): a standard-division
// Brief is born [To Do] and runs the brief_task engine. A Live Stream Brief is
// the exception (§6 Rule 2): it skips that machine entirely and carries an
// off-machine marker status set by the app, routed to Module 10's vendor tracker.
//
// House rules honoured here:
//   - the BRF- id is minted (ident.Next) ONLY after mandatory-field validation
//     passes (house rule 1);
//   - the birth status is set at INSERT (a creation, not a transition — same
//     precedent as strategy.go writing [Strategy Drafting]); every later status
//     move goes through the engine, never a raw UPDATE (house rule 2);
//   - the first Brief drives the parent Service [Awaiting Onboarding]/[Strategy
//     Approved] → [Briefed] in the SAME transaction via the engine (§5 Flow 2);
//   - revision count is DERIVED from the immutable audit log, never stored
//     (house rules 3/4);
//   - a Plan addendum (a Brief added beyond the approved outline, §5 Rule 2) is
//     appended to the audit log, never a silent change (M6-OA-5: light — no plan
//     re-approval).
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

// Brief lifecycle + Service target states (STATE_MACHINES §6/§7).
const (
	// BriefStatusToDo is the birth status of a standard-division Brief.
	BriefStatusToDo = "[To Do]"
	// BriefStatusVendorDispatched is the off-machine marker for a Live Stream
	// Brief (§6 Rule 2 / STATE_MACHINES §7 "skip this machine entirely"). It is
	// NOT a brief_task state — the Brief is tracked by Module 10's vendor tracker,
	// not the internal Kanban. NEW string, flagged for orchestrator sign-off.
	BriefStatusVendorDispatched = "[Dispatched to Vendor]"

	serviceStatusBriefed     = "[Briefed]"
	serviceStatusInExecution = "[In Execution]"

	// DivisionLiveStream is the outsourced-vendor division (§6 Rule 2).
	DivisionLiveStream = "Live Stream"
)

// allowedPriorities is the M6 §9.4 Priority single-choice set.
var allowedPriorities = map[string]bool{"Low": true, "Medium": true, "High": true}

// Sentinel errors carrying the exact Bahasa Indonesia message (house rule 5).
// All NEW here (the PRD quotes none verbatim), following the W1-09 precedent and
// listed in the report for orchestrator sign-off.
var (
	// ErrBriefNotFound: the referenced Brief does not exist.
	ErrBriefNotFound = errors.New("[brief tidak ditemukan]")
	// ErrBriefForbidden: actor may not read this Brief.
	ErrBriefForbidden = errors.New("[anda tidak memiliki akses ke brief ini]")
	// ErrBriefCreateForbidden: actor is not the owning AM (nor Director) — only
	// the AM who owns the client may break a Service into Briefs (§5 / §9.1).
	ErrBriefCreateForbidden = errors.New("[hanya Account Manager pemilik klien yang dapat membuat Brief untuk layanan ini]")
	// ErrServiceNotBriefable: the Service is in a state where no Brief can be
	// created (terminal: Done / Voided).
	ErrServiceNotBriefable = errors.New("[brief tidak dapat dibuat untuk layanan pada status ini]")
	// ErrInvalidDivision: Assigned Division is outside the allowed set (§9.4).
	ErrInvalidDivision = errors.New("[divisi tujuan tidak valid]")
	// ErrInvalidPriority: Priority is outside Low/Medium/High (§9.4).
	ErrInvalidPriority = errors.New("[prioritas tidak valid]")
	// ErrBriefStrategyMismatch: a plan-gated Service's Brief must carry the
	// Strategy ID of that Service's approved Plan (§5 Rule 2, §9.4).
	ErrBriefStrategyMismatch = errors.New("[Strategy ID brief harus menunjuk Strategy & Plan yang disetujui untuk layanan ini]")
	// ErrBriefStrategyNotAllowed: a Direct-path Service has no Plan, so its Brief
	// must not carry a Strategy ID (§5 Rule 3, §9.4 "Null if Direct-path").
	ErrBriefStrategyNotAllowed = errors.New("[layanan Direct tidak boleh memiliki Strategy ID pada brief]")
	// ErrQueueForbidden: actor may not read this division's Brief queue (§6/§9.1).
	ErrQueueForbidden = errors.New("[anda tidak memiliki akses ke antrean brief divisi ini]")
)

// BriefInput carries the M6 §9.4 Brief fields. Mandatory: Title (brief name),
// AssignedDivision, DeliverableType, QuantityTarget, DueDate, Priority. Optional:
// StrategyID (path-dependent), AssignedPIC, the Recurring block, Instructions,
// ReferenceAttachments. IsAddendum flags a Brief added beyond the approved Plan
// outline (§5 Rule 2) so it is logged, not silent.
type BriefInput struct {
	Title                string
	StrategyID           string
	AssignedDivision     string
	AssignedPIC          string
	DeliverableType      string
	QuantityTarget       int
	DueDate              string // YYYY-MM-DD
	Priority             string
	Recurring            bool
	RecurringFrequency   string
	RecurringCount       int
	RecurringEndDate     string // YYYY-MM-DD
	Instructions         string
	ReferenceAttachments string
	IsAddendum           bool
}

// Brief is a Brief record (BRF-).
type Brief struct {
	ID                   string `json:"id"`
	ServiceID            string `json:"service_id"`
	StrategyID           string `json:"strategy_id,omitempty"`
	AssignedDivision     string `json:"assigned_division"`
	AssignedPIC          string `json:"assigned_pic,omitempty"`
	DeliverableType      string `json:"deliverable_type"`
	QuantityTarget       int    `json:"quantity_target"`
	DueDate              string `json:"due_date"`
	Priority             string `json:"priority"`
	Recurring            bool   `json:"recurring"`
	RecurringFrequency   string `json:"recurring_frequency,omitempty"`
	RecurringCount       int    `json:"recurring_count,omitempty"`
	RecurringEndDate     string `json:"recurring_end_date,omitempty"`
	Instructions         string `json:"instructions,omitempty"`
	ReferenceAttachments string `json:"reference_attachments,omitempty"`
	Title                string `json:"title"`
	Status               string `json:"status"`
	RevisionCount        int    `json:"revision_count"`
	// RevisionFlagged is the derived §7 Rule 4 / M6-OA-3 SPV-visibility signal
	// (RevisionCount >= 3). Read-only, computed from the audit log alongside
	// RevisionCount (set only where the count is derived, e.g. GetBrief); it
	// never blocks work, only surfaces it.
	RevisionFlagged bool      `json:"revision_flagged"`
	CreatedBy       string    `json:"created_by"`
	CreatedAt       time.Time `json:"created_at"`
}

// validate checks the M6 §9.4 mandatory fields BEFORE any id is minted. Title is
// treated as the mandatory Brief name (the stub column is NOT NULL and the PRD
// examples always name a Brief). Returns ErrIncomplete / ErrInvalidDivision /
// ErrInvalidPriority.
func (in BriefInput) validate() error {
	if strings.TrimSpace(in.Title) == "" || strings.TrimSpace(in.DeliverableType) == "" ||
		strings.TrimSpace(in.DueDate) == "" || in.QuantityTarget <= 0 {
		return ErrIncomplete
	}
	if strings.TrimSpace(in.AssignedDivision) == "" {
		return ErrIncomplete
	}
	if !isAllowedDivision(in.AssignedDivision) {
		return ErrInvalidDivision
	}
	if strings.TrimSpace(in.Priority) == "" {
		return ErrIncomplete
	}
	if !allowedPriorities[in.Priority] {
		return ErrInvalidPriority
	}
	if _, err := time.Parse("2006-01-02", strings.TrimSpace(in.DueDate)); err != nil {
		return ErrIncomplete
	}
	// Recurring toggle: when on, its sub-fields become mandatory (§9.4 "If yes:
	// frequency, count, end date").
	if in.Recurring {
		if strings.TrimSpace(in.RecurringFrequency) == "" || in.RecurringCount <= 0 ||
			strings.TrimSpace(in.RecurringEndDate) == "" {
			return ErrIncomplete
		}
		if _, err := time.Parse("2006-01-02", strings.TrimSpace(in.RecurringEndDate)); err != nil {
			return ErrIncomplete
		}
	}
	return nil
}

func isAllowedDivision(d string) bool {
	for _, a := range allowedDivisions {
		if a == d {
			return true
		}
	}
	return false
}

// CreateBrief breaks a Service down into one Brief for a target division (§5).
// Owning AM (or Director) only. The Strategy gate is enforced by GuardBriefCreation.
// The first Brief advances the Service to [Briefed] in the same transaction.
func (s *Service) CreateBrief(ctx context.Context, actor permission.Actor, serviceID string, in BriefInput) (Brief, error) {
	if err := in.validate(); err != nil {
		return Brief{}, err
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Brief{}, err
	}
	defer tx.Rollback()

	var status string
	var pin int
	var override sql.NullInt64
	var ownerAM sql.NullString
	err = tx.QueryRowContext(ctx,
		`SELECT sv.status, sv.requires_strategy_plan, sv.requires_strategy_plan_override, c.assigned_am_id
		   FROM services sv JOIN clients c ON c.id = sv.client_id
		  WHERE sv.id = ? FOR UPDATE`, serviceID).Scan(&status, &pin, &override, &ownerAM)
	if errors.Is(err, sql.ErrNoRows) {
		return Brief{}, ErrServiceNotFound
	}
	if err != nil {
		return Brief{}, err
	}
	// Owner AM only — except Director (full access, precedent W1-13).
	if !actor.Role.Director && (!ownerAM.Valid || ownerAM.String != actor.EmployeeID) {
		return Brief{}, ErrBriefCreateForbidden
	}
	// Only briefable while the Service is on the live path (awaiting/strategy-
	// approved/briefed/in-execution). Terminal Services (Done / Voided) reject.
	switch status {
	case serviceStatusAwaitingOnboarding, serviceStatusStrategyApproved, serviceStatusBriefed, serviceStatusInExecution:
	default:
		return Brief{}, ErrServiceNotBriefable
	}
	// §5 Rule 5 gate, full: plan-gated Service still [Awaiting Onboarding] is
	// rejected; Direct (or already-past-strategy) passes.
	if err := GuardBriefCreation(ctx, tx, serviceID); err != nil {
		return Brief{}, err
	}

	// Strategy ID handling by path (§9.4 "Null if Direct-path"; §5 Rule 2 traces
	// a plan-gated Brief back to the approved Plan). The path follows the EFFECTIVE
	// plan-gate (M6-OA-1 per-engagement override honoured, same as the guard above).
	strategyID, err := resolveBriefStrategy(ctx, tx, serviceID, effectiveRequiresPlan(pin, override), strings.TrimSpace(in.StrategyID))
	if err != nil {
		return Brief{}, err
	}

	id, err := ident.Next(ctx, tx, "BRF", time.Now())
	if err != nil {
		return Brief{}, err
	}

	birth := BriefStatusToDo
	if in.AssignedDivision == DivisionLiveStream {
		birth = BriefStatusVendorDispatched // off-machine (§6 Rule 2)
	}

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO briefs
		   (id, service_id, strategy_id, assigned_division, assigned_pic, deliverable_type,
		    quantity_target, due_date, priority, recurring, recurring_frequency, recurring_count,
		    recurring_end_date, instructions, reference_attachments, title, status, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, serviceID, strategyID, in.AssignedDivision, nullStr(in.AssignedPIC), in.DeliverableType,
		in.QuantityTarget, in.DueDate, in.Priority, boolToInt(in.Recurring),
		nullStr(in.RecurringFrequency), nullRecurringCount(in.Recurring, in.RecurringCount),
		nullDate(in.RecurringEndDate), nullStr(in.Instructions), nullStr(in.ReferenceAttachments),
		strings.TrimSpace(in.Title), birth, actor.EmployeeID); err != nil {
		return Brief{}, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "brief", EntityID: id, Actor: actor.EmployeeID, Action: "create",
		After: map[string]any{"status": birth, "service_id": serviceID, "assigned_division": in.AssignedDivision},
	}); err != nil {
		return Brief{}, err
	}

	// §5 Flow 2: the FIRST Brief advances the Service to [Briefed]. "First" is
	// exactly the moment the Service leaves its pre-brief state; subsequent Briefs
	// find it already [Briefed]/[In Execution] and leave it alone.
	if status == serviceStatusAwaitingOnboarding || status == serviceStatusStrategyApproved {
		if _, err := s.engine().Transition(ctx, tx, statemachine.Request{
			Machine: statemachine.MService, EntityType: "service", Table: "services",
			EntityID: serviceID, To: serviceStatusBriefed, Actor: actor,
		}); err != nil {
			return Brief{}, err
		}
	}

	// §5 Rule 2 / M6-OA-5: a Brief added beyond the approved Plan outline is
	// logged as a Plan addendum (immutable, no re-approval). Plan-gated only.
	if effectiveRequiresPlan(pin, override) && in.IsAddendum && strategyID.Valid {
		if err := audit.Write(ctx, tx, audit.Record{
			EntityType: "strategy_plan", EntityID: strategyID.String, Actor: actor.EmployeeID, Action: "plan_addendum",
			After: map[string]any{"brief_id": id, "title": strings.TrimSpace(in.Title)},
		}); err != nil {
			return Brief{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return Brief{}, err
	}

	out := Brief{
		ID: id, ServiceID: serviceID, AssignedDivision: in.AssignedDivision, AssignedPIC: in.AssignedPIC,
		DeliverableType: in.DeliverableType, QuantityTarget: in.QuantityTarget, DueDate: in.DueDate,
		Priority: in.Priority, Recurring: in.Recurring, RecurringFrequency: in.RecurringFrequency,
		RecurringEndDate: in.RecurringEndDate, Instructions: in.Instructions,
		ReferenceAttachments: in.ReferenceAttachments, Title: strings.TrimSpace(in.Title),
		Status: birth, CreatedBy: actor.EmployeeID, CreatedAt: time.Now(),
	}
	if strategyID.Valid {
		out.StrategyID = strategyID.String
	}
	if in.Recurring {
		out.RecurringCount = in.RecurringCount
	}
	return out, nil
}

// resolveBriefStrategy returns the strategy_id to store for a new Brief.
//   - Direct Service (planGated=false): must be NULL; a supplied id is rejected.
//   - Plan-gated Service: must equal the Service's approved Strategy id. The
//     Service is already past [Strategy Approved] (guaranteed by the guard), so
//     that Strategy exists and is approved; the input must point to it (§5 Rule 2).
func resolveBriefStrategy(ctx context.Context, tx *sql.Tx, serviceID string, planGated bool, inStrategyID string) (sql.NullString, error) {
	if !planGated {
		if inStrategyID != "" {
			return sql.NullString{}, ErrBriefStrategyNotAllowed
		}
		return sql.NullString{}, nil
	}
	var strID, strStatus string
	err := tx.QueryRowContext(ctx,
		`SELECT id, status FROM strategy_plans WHERE service_id = ?`, serviceID).Scan(&strID, &strStatus)
	if errors.Is(err, sql.ErrNoRows) {
		// Plan-gated but no Strategy row: should be unreachable past the guard, but
		// treat defensively as the strategy-required gate.
		return sql.NullString{}, ErrStrategyRequired
	}
	if err != nil {
		return sql.NullString{}, err
	}
	if strStatus != StrategyStatusApproved || inStrategyID != strID {
		return sql.NullString{}, ErrBriefStrategyMismatch
	}
	return sql.NullString{String: strID, Valid: true}, nil
}

// OnBriefLeavesToDo advances the parent Service [Briefed] → [In Execution] when
// one of its Briefs leaves [To Do] (§5 Flow 3). The M12 Task machine calls this
// inside its own transaction after moving a Brief out of [To Do]; it is
// idempotent (a Service already [In Execution] — because an earlier Brief already
// moved — is a no-op) and defensively no-ops on any other Service state.
func (s *Service) OnBriefLeavesToDo(ctx context.Context, tx *sql.Tx, actor permission.Actor, serviceID string) error {
	var status string
	err := tx.QueryRowContext(ctx, `SELECT status FROM services WHERE id = ? FOR UPDATE`, serviceID).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrServiceNotFound
	}
	if err != nil {
		return err
	}
	if status != serviceStatusBriefed {
		return nil // already [In Execution], or not yet briefed — nothing to do
	}
	_, err = s.engine().Transition(ctx, tx, statemachine.Request{
		Machine: statemachine.MService, EntityType: "service", Table: "services",
		EntityID: serviceID, To: serviceStatusInExecution, Actor: actor,
	})
	return err
}

// GetBrief returns one Brief with its derived revision count, if the actor may
// see it (§6/§9.1): OD/Director everywhere; Account lead (division-wide); the
// owning AM (client's assigned AM); and staff/lead of the Brief's target
// division. Any other AM or other-division staff is denied.
func (s *Service) GetBrief(ctx context.Context, actor permission.Actor, briefID string) (Brief, error) {
	b, ownerAM, err := s.loadBrief(ctx, briefID)
	if err != nil {
		return Brief{}, err
	}
	if !canSeeBrief(actor, ownerAM, b.AssignedDivision) {
		return Brief{}, ErrBriefForbidden
	}
	entries, err := audit.List(ctx, s.DB, audit.Filter{EntityType: "brief", EntityID: briefID})
	if err != nil {
		return Brief{}, err
	}
	b.RevisionCount = deriveBriefRevisionCount(entries)
	b.RevisionFlagged = b.RevisionCount >= briefRevisionFlagThreshold
	return b, nil
}

// canSeeBrief is the shared §6/§9.1 read predicate.
func canSeeBrief(actor permission.Actor, ownerAM, division string) bool {
	if actor.CanReadAll() { // OD / Director
		return true
	}
	if actor.CanReadDivision(AccountDivision) { // Account lead (division-wide)
		return true
	}
	if actor.EmployeeID == ownerAM { // owning AM
		return true
	}
	// Staff/lead of the Brief's target division see their queue's items.
	if actor.Role.Division == division &&
		(actor.Role.Level == permission.LevelStaff || actor.Role.Level == permission.LevelLead) {
		return true
	}
	return false
}

// ListDivisionQueue returns the Brief queue for a target division (§6 Rule 1),
// oldest first. Readable by staff/lead of that division, Account lead (keputusan
// Nerissa 2026-07-12: pantau dispatch lintas divisi), and OD/Director.
// Interpretation (W2-M6-C3): §9.1 grants "own division's Brief queue" to the
// division as a whole, so ALL staff of the target division see the whole queue
// (not only their assigned rows) — assignment to a PIC is a later, optional step
// (§9.4) owned by Modules 7–9 / M12.
func (s *Service) ListDivisionQueue(ctx context.Context, actor permission.Actor, division string) ([]Brief, error) {
	if !isAllowedDivision(division) {
		return nil, ErrInvalidDivision
	}
	// Keputusan Nerissa (interview 2026-07-12): Account lead (SPV/Head Account)
	// juga boleh membuka queue divisi mana pun untuk memantau dispatch.
	allowed := actor.CanReadAll() ||
		actor.IsLead(AccountDivision) ||
		(actor.Role.Division == division &&
			(actor.Role.Level == permission.LevelStaff || actor.Role.Level == permission.LevelLead))
	if !allowed {
		return nil, ErrQueueForbidden
	}
	rows, err := s.DB.QueryContext(ctx, briefSelect+` WHERE b.assigned_division = ? ORDER BY b.id ASC`, division)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanBriefs(rows)
}

// ListServiceBriefs returns all Briefs of a Service (§5 fan-out), readable by the
// owning AM, Account lead, and OD/Director. Division staff use ListDivisionQueue.
func (s *Service) ListServiceBriefs(ctx context.Context, actor permission.Actor, serviceID string) ([]Brief, error) {
	var ownerAM sql.NullString
	err := s.DB.QueryRowContext(ctx,
		`SELECT c.assigned_am_id FROM services sv JOIN clients c ON c.id = sv.client_id WHERE sv.id = ?`,
		serviceID).Scan(&ownerAM)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrServiceNotFound
	}
	if err != nil {
		return nil, err
	}
	if !(actor.CanReadDivision(AccountDivision) || (ownerAM.Valid && ownerAM.String == actor.EmployeeID)) {
		return nil, ErrBriefForbidden
	}
	rows, err := s.DB.QueryContext(ctx, briefSelect+` WHERE b.service_id = ? ORDER BY b.id ASC`, serviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanBriefs(rows)
}

// ---- helpers ----------------------------------------------------------------

const briefSelect = `SELECT b.id, b.service_id, COALESCE(b.strategy_id,''), b.assigned_division,
	        COALESCE(b.assigned_pic,''), b.deliverable_type, b.quantity_target, b.due_date, b.priority,
	        b.recurring, COALESCE(b.recurring_frequency,''), COALESCE(b.recurring_count,0),
	        b.recurring_end_date, COALESCE(b.instructions,''), COALESCE(b.reference_attachments,''),
	        b.title, b.status, b.created_by, b.created_at
	   FROM briefs b`

func (s *Service) loadBrief(ctx context.Context, briefID string) (Brief, string, error) {
	// briefSelect (19 cols) + the owning AM (c.assigned_am_id) for the read gate.
	q := strings.Replace(briefSelect, "\n\t   FROM briefs b",
		", c.assigned_am_id\n\t   FROM briefs b JOIN services sv ON sv.id = b.service_id JOIN clients c ON c.id = sv.client_id", 1)
	row := s.DB.QueryRowContext(ctx, q+` WHERE b.id = ?`, briefID)
	b, ownerAM, err := scanBriefRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Brief{}, "", ErrBriefNotFound
	}
	if err != nil {
		return Brief{}, "", err
	}
	return b, ownerAM.String, nil
}

// scanBriefRow scans a briefSelect row that additionally trails c.assigned_am_id.
func scanBriefRow(row *sql.Row) (Brief, sql.NullString, error) {
	var b Brief
	var strategyID, assignedPIC, recFreq, instructions, refAttach string
	var recCount int
	var recEnd sql.NullTime
	var dueDate time.Time
	var ownerAM sql.NullString
	if err := row.Scan(&b.ID, &b.ServiceID, &strategyID, &b.AssignedDivision, &assignedPIC,
		&b.DeliverableType, &b.QuantityTarget, &dueDate, &b.Priority, &b.Recurring, &recFreq, &recCount,
		&recEnd, &instructions, &refAttach, &b.Title, &b.Status, &b.CreatedBy, &b.CreatedAt, &ownerAM); err != nil {
		return Brief{}, sql.NullString{}, err
	}
	fillBrief(&b, strategyID, assignedPIC, recFreq, recCount, recEnd, instructions, refAttach, dueDate)
	return b, ownerAM, nil
}

func scanBriefs(rows *sql.Rows) ([]Brief, error) {
	out := []Brief{}
	for rows.Next() {
		var b Brief
		var strategyID, assignedPIC, recFreq, instructions, refAttach string
		var recCount int
		var recEnd sql.NullTime
		var dueDate time.Time
		if err := rows.Scan(&b.ID, &b.ServiceID, &strategyID, &b.AssignedDivision, &assignedPIC,
			&b.DeliverableType, &b.QuantityTarget, &dueDate, &b.Priority, &b.Recurring, &recFreq, &recCount,
			&recEnd, &instructions, &refAttach, &b.Title, &b.Status, &b.CreatedBy, &b.CreatedAt); err != nil {
			return nil, err
		}
		fillBrief(&b, strategyID, assignedPIC, recFreq, recCount, recEnd, instructions, refAttach, dueDate)
		out = append(out, b)
	}
	return out, rows.Err()
}

func fillBrief(b *Brief, strategyID, assignedPIC, recFreq string, recCount int, recEnd sql.NullTime,
	instructions, refAttach string, dueDate time.Time) {
	b.StrategyID = strategyID
	b.AssignedPIC = assignedPIC
	b.RecurringFrequency = recFreq
	b.RecurringCount = recCount
	b.Instructions = instructions
	b.ReferenceAttachments = refAttach
	b.DueDate = dueDate.Format("2006-01-02")
	if recEnd.Valid {
		b.RecurringEndDate = recEnd.Time.Format("2006-01-02")
	}
}

// deriveBriefRevisionCount counts [In Review] → [Revision Requested] transitions
// in the immutable audit log (§6 Rule 4 — derived, never stored).
func deriveBriefRevisionCount(entries []audit.Entry) int {
	n := 0
	want := "transition:[In Review]->[Revision Requested]"
	for _, e := range entries {
		if e.Action == want {
			n++
		}
	}
	return n
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func nullStr(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func nullDate(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func nullRecurringCount(recurring bool, n int) any {
	if !recurring || n <= 0 {
		return nil
	}
	return n
}
