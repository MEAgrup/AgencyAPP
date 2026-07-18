// Package module7_creative is Module 7 (Creative). It introduces the Asset (AST-),
// Creative's actual unit of work: one row per individual output toward a Brief's
// Quantity/Target (M7 §2 — "12 Product Videos" is one Brief but twelve Assets).
//
// Division of responsibility with Module 12 (the canonical Task engine):
//   - This package owns the Asset ENTITY: creation (Brief breakdown, §4), the
//     AM-side review edges at Asset granularity (§4 Flow 3 / §6, review.go), and
//     the manual Hours Logged field (§5 Rule 2, hours.go).
//   - module12_task owns the DIVISION-side execution edges (Start/Submit/Rework/
//     Block), the SLA/PIC writes, and the recompute-from-log metrics — the Asset
//     plugs into that shared engine exactly like the Brief-as-task and (later)
//     KOL's Creator Booking (DATA_MODEL §1). The parent Brief's status is a
//     roll-up of its Assets (M7 §2), recomputed through module12_task after every
//     Asset transition (execution edges there, review edges here).
//
// House rules honoured here:
//   - the AST- id is minted (ident.Next) ONLY after mandatory-field validation
//     passes (house rule 1);
//   - the birth status [To Do] is set at INSERT (a creation, not a transition);
//     every later status move goes through the engine, never a raw UPDATE
//     (house rule 2);
//   - Revision Count / Turnaround / Speed Score are DERIVED from the immutable
//     audit log, never stored (house rules 3/4).
package module7_creative

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/ident"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// CreativeDivision is the only division that breaks Briefs into Assets (DATA_MODEL
// §1: AST is Creative's unit; KOL uses BKG-, Ads uses the Brief-as-task).
const CreativeDivision = "Creative"

// AccountDivision is the client-owning division (its lead reads cross-division).
const AccountDivision = "Account"

// Asset status labels — the canonical brief_task machine (STATE_MACHINES §7),
// per-row (M7 §2 / §4 Rule 2).
const (
	StatusToDo        = "[To Do]"
	StatusInProgress  = "[In Progress]"
	StatusSubmitted   = "[Submitted]"
	StatusInReview    = "[In Review]"
	StatusApproved    = "[Approved]"
	StatusRevisionReq = "[Revision Requested]"
	StatusBlocked     = "[Blocked]"

	assetRevisionFlagThreshold = 3 // §6 Rule 4: a single Asset crossing 3 revisions flags the Team Leader
)

// Sentinel errors carrying the exact Bahasa Indonesia message (house rule 5). The
// verbatim PRD string is used where the PRD quotes one (ErrOutputLinkRequired, in
// module12_task, §4 Rule 3); the rest are NEW (W1-09 precedent), listed in the
// report for orchestrator sign-off.
var (
	// ErrIncomplete: a mandatory field is missing (house-convention default).
	ErrIncomplete = errors.New("[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]")
	// ErrBriefNotFound: the parent Brief does not exist.
	ErrBriefNotFound = errors.New("[brief tidak ditemukan]")
	// ErrAssetNotFound: the referenced Asset does not exist.
	ErrAssetNotFound = errors.New("[aset tidak ditemukan]")
	// ErrAssetForbidden: actor may not read this Asset (§9.1 read gate).
	ErrAssetForbidden = errors.New("[anda tidak memiliki akses ke aset ini]")
	// ErrNotCreativeBrief: the Brief is not a Creative Brief, so it has no Assets.
	ErrNotCreativeBrief = errors.New("[brief ini bukan brief divisi Creative]")
	// ErrAssetCreateForbidden: actor may not create Assets for this Brief (only the
	// Brief's Creative division staff/lead — self-claim or Team Leader — or Director).
	ErrAssetCreateForbidden = errors.New("[anda tidak memiliki akses untuk membuat aset pada brief ini]")
	// ErrBriefNotAssetable: the Brief is in a state where no Asset can be created
	// (terminal: [Approved] / [Cancelled — Service Voided]).
	ErrBriefNotAssetable = errors.New("[aset tidak dapat dibuat untuk brief pada status ini]")
	// ErrInvalidSequence: Sequence # is out of range 1..Quantity/Target (§9.3).
	ErrInvalidSequence = errors.New("[nomor urut aset harus antara 1 dan jumlah target brief]")
	// ErrDuplicateSequence: an Asset with this Sequence # already exists for the Brief.
	ErrDuplicateSequence = errors.New("[nomor urut aset sudah digunakan pada brief ini]")
	// ErrInvalidPIC: the chosen PIC is not an active Creative-division staff member.
	ErrInvalidPIC = errors.New("[PIC tidak valid: harus staff divisi Creative yang aktif]")
	// ErrReviewForbidden: actor is not the owning AM (nor Director) — only the AM who
	// owns the client reviews that client's Assets (§4 Flow 3 / §9.1).
	ErrReviewForbidden = errors.New("[hanya Account Manager pemilik klien yang dapat mereview aset ini]")
	// ErrRevisionFeedbackRequired: revision feedback is mandatory (§6 Rule 1).
	ErrRevisionFeedbackRequired = errors.New("[feedback revisi wajib diisi]")
	// ErrHoursForbidden: actor may not log Hours on this Asset (only the assigned
	// PIC, the Creative lead, or Director; §5 Rule 2).
	ErrHoursForbidden = errors.New("[anda tidak memiliki akses untuk mencatat Hours Logged aset ini]")
	// ErrInvalidHours: Hours Logged must be a positive number.
	ErrInvalidHours = errors.New("[jumlah Hours Logged harus lebih dari 0]")
)

// Rollup is the one-way hook into module12_task: after an Asset's status changes,
// its parent Brief's roll-up is recomputed in the SAME transaction (M7 §2).
// *module12_task.Service satisfies it. Keeping it an interface avoids a hard
// dependency and mirrors module12_task's own AccountService injection.
type Rollup interface {
	RecomputeBriefRollup(ctx context.Context, tx *sql.Tx, actor permission.Actor, briefID string) error
}

// Service is the M7 persistence surface.
type Service struct {
	DB     *sql.DB
	Engine *statemachine.Engine
	// Tasks recomputes the parent Brief's roll-up after an Asset review edge. Only
	// the review methods (review.go) use it; nil-guarded there.
	Tasks Rollup
	// Catalog is the notification catalog. Nil-guarded. M7 emits two cataloged
	// events: EvRevisionCountFlag, on an Asset crossing 3 revisions (§6 Rule 4,
	// review.go) — a per-Asset flag, distinct from M6's per-Brief one — and
	// EvHoursLoggedReminder, the Wave-3-catalog-opening end-of-day Hours Logged
	// nudge (M7-OA-2, DECISIONS O29/W3-CAT-1, reminder.go).
	Catalog *notification.Catalog
}

func (s *Service) engine() *statemachine.Engine {
	if s.Engine != nil {
		return s.Engine
	}
	return statemachine.New()
}

// AssetInput carries the caller-supplied Asset fields (§9.3). Asset Type is NOT
// here — it is inherited read-only from the Brief's Deliverable Type. AssignedPIC
// is optional: a Creative staff member self-claims (defaults to the actor) while a
// lead may create it unassigned or name the PIC.
type AssetInput struct {
	SequenceNo  int
	AssignedPIC string
}

// Asset is one Asset record (AST-).
type Asset struct {
	ID               string    `json:"id"`
	BriefID          string    `json:"brief_id"`
	AssetType        string    `json:"asset_type"`
	SequenceNo       int       `json:"sequence_no"`
	AssignedPIC      string    `json:"assigned_pic,omitempty"`
	OutputLink       string    `json:"output_link,omitempty"`
	Status           string    `json:"status"`
	SLATargetHours   *float64  `json:"sla_target_hours,omitempty"`
	RevisionSLAHours *float64  `json:"revision_sla_target_hours,omitempty"`
	HoursLogged      *float64  `json:"hours_logged,omitempty"`
	AttributedGMV    *float64  `json:"attributed_gmv,omitempty"`
	RevisionCount    int       `json:"revision_count"`
	RevisionFlagged  bool      `json:"revision_flagged"`
	CreatedBy        string    `json:"created_by"`
	CreatedAt        time.Time `json:"created_at"`
}

// CreateAsset breaks one unit of a Creative Brief into an Asset row (M7 §4). Assets
// are created incrementally (§4 Rule 1 / M7-OA-6): the caller supplies the next
// Sequence #; the system tracks Assets-created vs the Brief's Quantity/Target.
// Creatable by the Brief's Creative staff/lead (self-claim or Team Leader) or
// Director. Asset Type is inherited read-only from the Brief's Deliverable Type.
func (s *Service) CreateAsset(ctx context.Context, actor permission.Actor, briefID string, in AssetInput) (Asset, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Asset{}, err
	}
	defer tx.Rollback()

	var division, status, deliverableType string
	var quantityTarget int
	err = tx.QueryRowContext(ctx,
		`SELECT assigned_division, status, deliverable_type, quantity_target
		   FROM briefs WHERE id = ? FOR UPDATE`, briefID).
		Scan(&division, &status, &deliverableType, &quantityTarget)
	if errors.Is(err, sql.ErrNoRows) {
		return Asset{}, ErrBriefNotFound
	}
	if err != nil {
		return Asset{}, err
	}
	if division != CreativeDivision {
		return Asset{}, ErrNotCreativeBrief
	}
	// Only creatable while the Brief is live (not yet approved/cancelled).
	if status == StatusApproved || status == "[Cancelled — Service Voided]" {
		return Asset{}, ErrBriefNotAssetable
	}
	// Creator = the Brief's Creative staff/lead, or Director. AM/OD/other divisions
	// cannot create Assets.
	if !canCreateAsset(actor) {
		return Asset{}, ErrAssetCreateForbidden
	}
	// §9.3 Sequence # mandatory, within 1..Quantity/Target.
	if in.SequenceNo <= 0 {
		return Asset{}, ErrIncomplete
	}
	if in.SequenceNo > quantityTarget {
		return Asset{}, ErrInvalidSequence
	}

	// Resolve the PIC: explicit value is validated; a self-claiming staff member
	// defaults to themselves; a lead may leave it unassigned (auto-assign later,
	// M7-OA-1 deferred).
	picID := strings.TrimSpace(in.AssignedPIC)
	if picID == "" && actor.Role.Division == CreativeDivision && actor.Role.Level == permission.LevelStaff {
		picID = actor.EmployeeID // self-claim (§4 Flow 1 "self-claimed")
	}
	if picID != "" {
		if err := validateCreativeStaff(ctx, tx, picID); err != nil {
			return Asset{}, err
		}
	}

	id, err := ident.Next(ctx, tx, "AST", time.Now())
	if err != nil {
		return Asset{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO assets (id, brief_id, asset_type, sequence_no, assigned_pic, status, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, briefID, deliverableType, in.SequenceNo, nullStr(picID), StatusToDo, actor.EmployeeID); err != nil {
		if isDuplicateKey(err) {
			return Asset{}, ErrDuplicateSequence
		}
		return Asset{}, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "asset", EntityID: id, Actor: actor.EmployeeID, Action: "create",
		After: map[string]any{"status": StatusToDo, "brief_id": briefID, "sequence_no": in.SequenceNo, "asset_type": deliverableType},
	}); err != nil {
		return Asset{}, err
	}
	if err := tx.Commit(); err != nil {
		return Asset{}, err
	}
	return Asset{
		ID: id, BriefID: briefID, AssetType: deliverableType, SequenceNo: in.SequenceNo,
		AssignedPIC: picID, Status: StatusToDo, CreatedBy: actor.EmployeeID, CreatedAt: time.Now(),
	}, nil
}

// canCreateAsset gates Asset creation: the Brief's Creative division staff/lead
// (self-claim / Team Leader, §4/§9.3) or Director. AM, OD and other divisions no.
func canCreateAsset(a permission.Actor) bool {
	if a.Role.Director {
		return true
	}
	return a.Role.Division == CreativeDivision &&
		(a.Role.Level == permission.LevelStaff || a.Role.Level == permission.LevelLead)
}

// validateCreativeStaff enforces that picID is an ACTIVE employee whose resolved
// CDPS division is Creative and whose level is staff (§2 Rule 1 — one accountable
// staff member). Mirrors module12_task.validatePICForDivision.
func validateCreativeStaff(ctx context.Context, tx *sql.Tx, picID string) error {
	var active int
	var div, level sql.NullString
	err := tx.QueryRowContext(ctx,
		`SELECT e.status_aktif, rm.division, rm.level
		   FROM employees e
		   LEFT JOIN role_mappings rm ON rm.divisi = e.divisi AND rm.jabatan = e.jabatan
		  WHERE e.employee_id = ?`, picID).Scan(&active, &div, &level)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrInvalidPIC
	}
	if err != nil {
		return err
	}
	if active != 1 || !div.Valid || div.String != CreativeDivision ||
		!level.Valid || level.String != permission.LevelStaff {
		return ErrInvalidPIC
	}
	return nil
}

func nullStr(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

// isDuplicateKey reports a MySQL duplicate-key (1062) error, used to map the
// UNIQUE(brief_id, sequence_no) violation to ErrDuplicateSequence.
func isDuplicateKey(err error) bool {
	return err != nil && strings.Contains(err.Error(), "1062")
}
