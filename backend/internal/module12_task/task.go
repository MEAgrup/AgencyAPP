// Package module12_task is Module 12 — the canonical Task Execution engine.
//
// "Task" is NOT an entity (DATA_MODEL §1): it is the role played by an Asset
// (AST-, Creative/M7), a Creator Booking (BKG-, KOL/M9), or the Brief itself for
// single-unit divisions like Ads (BRF-as-task). All three run the SAME brief_task
// state machine (STATE_MACHINES §7) and gain the SAME computed fields. Today the
// only Task rows that exist are `briefs`; M7/M9 plug their rows into this engine
// later. Module 12 therefore owns:
//
//   - the DIVISION-side execution edges of the brief_task machine that M6
//     deliberately left undriven (STATE_MACHINES §7 / W2-M6-C4 deferral):
//     [To Do]            -> [In Progress]   (PIC claims / starts — StartTask)
//     [In Progress]      -> [Submitted]     (PIC submits — SubmitTask)
//     [Revision Requested] -> [In Progress] (PIC reworks — ReworkTask)
//     [In Progress]      -> [Blocked]       (SPV/Lead only — block.go)
//     [Blocked]          -> [In Progress]   (SPV/Lead only — ResumeTask)
//     The AM-side review edges ([Submitted]->[In Review]->[Approved]/[Revision
//     Requested]) stay in module6_account (brief_review.go) — this package never
//     drives them.
//   - Assign-PIC and Set-SLA by the target division's Lead/SPV (assign.go).
//   - The read-only computed fields, recomputed from the audit log (metrics.go).
//
// House rules honoured here:
//   - a status column is ONLY ever written through the transition engine (house
//     rule 2); this package never raw-UPDATEs briefs.status.
//   - when a Brief FIRST leaves [To Do], its parent Service advances [Briefed] ->
//     [In Execution] in the SAME transaction via module6_account.OnBriefLeavesToDo
//     (M6 §5 Flow 3). The hook is reached through an injected interface so this
//     package does not hard-depend on module6_account's Service type (there is no
//     import cycle — module6_account does not import module12_task — but the
//     interface keeps the coupling one-way and testable).
//   - computed fields are derived, never stored (house rules 3/4); SLA Target is
//     an input (set by Lead), not auto-calculated, so it is a plain audited field.
package module12_task

import (
	"context"
	"database/sql"
	"errors"

	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// AccountDivision is the CDPS division that owns the Client/Brief relationship;
// its lead sees every division's task (read gate), mirroring module6_account.
const AccountDivision = "Account"

// DivisionLiveStream is the outsourced-vendor division. Its Briefs are off-machine
// ([Dispatched to Vendor], M6 §6 Rule 2 / STATE_MACHINES §7) and are explicitly
// EXCLUDED from this engine (M12 §2 Rule 3) — they are never timed Tasks.
const DivisionLiveStream = "Live Stream"

// brief_task status labels (STATE_MACHINES §7). Kept local so this package is the
// authority for the division-side edges it drives.
const (
	StatusToDo             = "[To Do]"
	StatusInProgress       = "[In Progress]"
	StatusSubmitted        = "[Submitted]"
	StatusInReview         = "[In Review]"
	StatusApproved         = "[Approved]"
	StatusRevisionReq      = "[Revision Requested]"
	StatusBlocked          = "[Blocked]"
	StatusVendorDispatched = "[Dispatched to Vendor]"
)

// Sentinel errors carrying the exact Bahasa Indonesia message (house rule 5). The
// PRD quotes none of these verbatim, so they follow the W1-09 precedent and are
// listed in DECISIONS.md for orchestrator sign-off.
var (
	// ErrTaskNotFound: the referenced Task (Brief) does not exist.
	ErrTaskNotFound = errors.New("[task tidak ditemukan]")
	// ErrTaskViewForbidden: actor may not read this Task.
	ErrTaskViewForbidden = errors.New("[anda tidak memiliki akses ke task ini]")
	// ErrExecForbidden: actor may not drive this Task's execution (not the target
	// division's staff/lead, not the assigned PIC where one is set).
	ErrExecForbidden = errors.New("[anda tidak memiliki akses untuk mengerjakan task ini]")
	// ErrAssignForbidden: actor may not assign a PIC / set the SLA (not the target
	// division's Lead/SPV nor Director).
	ErrAssignForbidden = errors.New("[anda tidak memiliki akses untuk menugaskan PIC atau menetapkan SLA task ini]")
	// ErrNotATask: the Brief is off-machine (Live Stream, dispatched to a vendor)
	// and is not an execution Task (§2 Rule 3).
	ErrNotATask = errors.New("[brief ini bukan task yang dieksekusi, di-dispatch ke vendor]")
	// ErrInvalidPIC: chosen PIC is not an active staff of the target division.
	ErrInvalidPIC = errors.New("[PIC tidak valid: harus staff divisi tujuan yang aktif]")
	// ErrInvalidSLA: SLA Target must be a positive number of hours.
	ErrInvalidSLA = errors.New("[target SLA harus lebih dari 0 jam]")
	// ErrBlockRequestForbidden: actor may not submit a block request for this Task.
	ErrBlockRequestForbidden = errors.New("[anda tidak memiliki akses untuk mengajukan permintaan block task ini]")
	// ErrBlockDecideForbidden: actor may not decide a block request (SPV/Lead only).
	ErrBlockDecideForbidden = errors.New("[anda tidak memiliki akses untuk memutuskan permintaan block]")
	// ErrBlockReasonRequired: a block request must carry a reason.
	ErrBlockReasonRequired = errors.New("[alasan permintaan block wajib diisi]")
	// ErrBlockRequestNotFound: no such pending block request on this Task.
	ErrBlockRequestNotFound = errors.New("[permintaan block tidak ditemukan]")
	// ErrBlockRequestClosed: the block request was already approved/rejected.
	ErrBlockRequestClosed = errors.New("[permintaan block sudah diproses]")
)

// AccountService is the one-way hook into module6_account: when a Brief first
// leaves [To Do], its parent Service advances [Briefed] -> [In Execution] in the
// caller's transaction (M6 §5 Flow 3). *module6_account.Service satisfies it.
type AccountService interface {
	OnBriefLeavesToDo(ctx context.Context, tx *sql.Tx, actor permission.Actor, serviceID string) error
}

// Service is the M12 persistence surface.
type Service struct {
	DB     *sql.DB
	Engine *statemachine.Engine
	// Account fires the Service [Briefed] -> [In Execution] advance when a Brief
	// leaves [To Do]. Required for StartTask; the other actions do not use it.
	Account AccountService
	// Catalog is the FROZEN notification catalog (Phase 0 v2 §9). Nil-guarded: when
	// unset, block-request emissions are skipped (most unit tests). M12 emits ONLY
	// events already in the catalog (EvBlockRequestSubmitted / EvBlockRequestDecided);
	// it NEVER emits EvRevisionCountFlag — that emitter is canonical in M6's Brief
	// review (DECISIONS W2-M6-C4), never double-emitted here.
	Catalog *notification.Catalog
}

// engine returns the configured engine, or a fresh canonical one if unset (the
// config is stateless — same fallback as module6_account).
func (s *Service) engine() *statemachine.Engine {
	if s.Engine != nil {
		return s.Engine
	}
	return statemachine.New()
}

// taskRow is the slim projection the execution/permission gates need.
type taskRow struct {
	briefID     string
	serviceID   string
	division    string
	assignedPIC string
	status      string
	ownerAM     string
}

// lockTask row-locks a Brief and returns the fields the gates need, joining to the
// owning AM for the read predicate. A missing Brief is ErrTaskNotFound.
func lockTask(ctx context.Context, tx *sql.Tx, briefID string) (taskRow, error) {
	var r taskRow
	var pic, owner sql.NullString
	err := tx.QueryRowContext(ctx,
		`SELECT b.id, b.service_id, b.assigned_division, b.assigned_pic, b.status, c.assigned_am_id
		   FROM briefs b
		   JOIN services sv ON sv.id = b.service_id
		   JOIN clients c ON c.id = sv.client_id
		  WHERE b.id = ? FOR UPDATE`, briefID).
		Scan(&r.briefID, &r.serviceID, &r.division, &pic, &r.status, &owner)
	if errors.Is(err, sql.ErrNoRows) {
		return taskRow{}, ErrTaskNotFound
	}
	if err != nil {
		return taskRow{}, err
	}
	r.assignedPIC = pic.String
	r.ownerAM = owner.String
	return r, nil
}

// canExecute is the §2 Rule 1 execution gate. The accountable staff member drives
// the work: Director always; otherwise the actor must belong to the Brief's target
// division (staff or lead). Where a PIC is assigned, only that PIC or the division
// lead may drive it (the accountable person or their supervisor); an unassigned
// Task may be driven by any staff/lead of the division (claim model, consistent
// with the division-wide queue in W2-M6-C3). The AM and other divisions are denied
// — the AM's authority is the review edges (M6 §7), not execution.
func canExecute(a permission.Actor, r taskRow) bool {
	if a.Role.Director {
		return true
	}
	if a.Role.Division != r.division ||
		(a.Role.Level != permission.LevelStaff && a.Role.Level != permission.LevelLead) {
		return false
	}
	if r.assignedPIC != "" {
		return a.EmployeeID == r.assignedPIC || a.Role.Level == permission.LevelLead
	}
	return true
}

// StartTask drives [To Do] -> [In Progress] (§3 step 2, the moment the Turnaround
// clock starts, §2 Rule 4). This is the ONLY transition that makes a Brief leave
// [To Do], so it is where the parent Service advances to [In Execution] (M6 §5
// Flow 3) — atomically, via the injected AccountService hook.
func (s *Service) StartTask(ctx context.Context, actor permission.Actor, briefID string) (statemachine.Result, error) {
	return s.driveExecEdge(ctx, actor, briefID, StatusToDo, StatusInProgress, true)
}

// SubmitTask drives [In Progress] -> [Submitted] (§3 step 3). The PIC hands the
// deliverable to the AM for review.
func (s *Service) SubmitTask(ctx context.Context, actor permission.Actor, briefID string) (statemachine.Result, error) {
	return s.driveExecEdge(ctx, actor, briefID, StatusInProgress, StatusSubmitted, false)
}

// ReworkTask drives [Revision Requested] -> [In Progress] (§3 step 5). The PIC
// resumes the SAME cumulative timer (Rule 5 — revision rounds never reset it); the
// Service is already [In Execution], so no hook fires.
func (s *Service) ReworkTask(ctx context.Context, actor permission.Actor, briefID string) (statemachine.Result, error) {
	return s.driveExecEdge(ctx, actor, briefID, StatusRevisionReq, StatusInProgress, false)
}

// driveExecEdge is the shared, gated engine driver for the division-side edges.
// requireFrom pins the expected source state so StartTask and ReworkTask stay
// distinct even though both target [In Progress]; a wrong source is rejected with
// the machine's block message (nothing changes). fireHook advances the Service.
func (s *Service) driveExecEdge(ctx context.Context, actor permission.Actor, briefID, requireFrom, to string, fireHook bool) (statemachine.Result, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return statemachine.Result{}, err
	}
	defer tx.Rollback()

	r, err := lockTask(ctx, tx, briefID)
	if err != nil {
		return statemachine.Result{}, err
	}
	if r.status == StatusVendorDispatched {
		return statemachine.Result{}, ErrNotATask
	}
	if !canExecute(actor, r) {
		return statemachine.Result{}, ErrExecForbidden
	}
	// Pin the source state so each action means exactly one edge.
	if r.status != requireFrom {
		return statemachine.Result{}, &statemachine.BlockedError{Message: statemachine.DefaultBlockMessage}
	}
	res, err := s.engine().Transition(ctx, tx, statemachine.Request{
		Machine: statemachine.MBriefTask, EntityType: "brief", Table: "briefs",
		EntityID: briefID, To: to, Actor: actor,
	})
	if err != nil {
		return statemachine.Result{}, err
	}
	if fireHook {
		if s.Account == nil {
			return statemachine.Result{}, errors.New("module12_task: AccountService hook not wired")
		}
		if err := s.Account.OnBriefLeavesToDo(ctx, tx, actor, r.serviceID); err != nil {
			return statemachine.Result{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return statemachine.Result{}, err
	}
	return res, nil
}
