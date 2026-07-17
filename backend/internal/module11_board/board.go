// Package module11_board is Module 11 — Project Management / Kanban. It adds two
// cross-division views ON TOP of the per-division machines (M6–M10, M12) without a
// machine of its own:
//
//   - Dependency (DEP-): a formal, AM/SPV-declared link between two Briefs of the
//     same Client (M11 §2/§5.1). Its STATUS (Pending/Blocking/Satisfied) is DERIVED
//     from the Source Brief's live status — never stored (house rule #4). A Blocking
//     Dependency locks the Target Brief's FINAL transition ([In Review] -> [Approved])
//     until the Source reaches its terminal status; this is enforced as a CODE guard
//     the Brief-approval clusters call (module6_account.ApproveGuard,
//     module12_task.ApproveGuard), the same precedent as the Void-Service /
//     ADC-Launch code guards. When the Source reaches terminal the Dependency turns
//     Satisfied and EvDependencySatisfied fires once to the Target Brief's PIC.
//
//   - Read-models (board.go views): the Client Board (all Briefs of one Client,
//     grouped by Universal Column, §5.3) and My Tasks (the actor's own work units
//     across Clients, §5.4). Both are computed on read; nothing is stored.
//
// This package OWNS no state machine (the Dependency status is auto-computed,
// STATE_MACHINES §12) and does NOT rewrite M6/M12 — it plugs into them through the
// small injected guard/hook interfaces those packages already use for cross-module
// gates (BriefSubmitGuard precedent).
//
// House rules honoured here:
//   - the DEP- id is minted (ident.Next) ONLY after create-time validation passes
//     (house rule 1: same Client, no duplicate active pair, no cycle, valid types);
//   - every create appends an immutable audit row (house rule 3); there is no
//     cancel/delete path in v1 (the PRD defines none);
//   - the Dependency status and every board/My-Tasks column are DERIVED on read
//     from live statuses (house rule 4), never stored.
package module11_board

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
)

// AccountDivision is the CDPS division that owns the Client relationship; its lead
// (SPV/Head Account) may declare Dependencies and read every Client Board.
const AccountDivision = "Account"

// Dependency types (M11 §2 Rule 5 / §5.1).
const (
	TypeBlocking      = "Blocking"
	TypeInformational = "Informational"
)

// Derived Dependency status labels (M11 §5.1 / STATE_MACHINES §12). NOT stored.
const (
	StatusPending   = "Pending"   // Source not started
	StatusBlocking  = "Blocking"  // Source unfinished & type=Blocking
	StatusSatisfied = "Satisfied" // Source reached terminal
)

// entityBrief is the only sanctioned source/target entity type (M11 §5.1 — Source
// Brief ID / Target Brief ID, both ref BRF). Stored lower-case in source_type/
// target_type; no other type is accepted in v1.
const entityBrief = "brief"

// briefTerminal is the Source's "status akhir" that satisfies a Dependency (§5.1).
// A voided Brief ([Cancelled — Service Voided]) does NOT satisfy — only a genuine
// completion counts.
const briefTerminal = "[Approved]"

// briefToDo is the "not started" status used to distinguish Pending from Blocking.
const briefToDo = "[To Do]"

// Sentinel errors carrying the exact Bahasa Indonesia message (house rule 5). The
// PRD quotes none of these verbatim except the gate template (STATE_MACHINES §12),
// so the rest follow the W1-09 precedent and are listed in the report for sign-off.
var (
	// ErrDepCreateForbidden: actor may not declare a Dependency — only the owning
	// AM, an Account lead/SPV, or Director (§6.1 Adopted).
	ErrDepCreateForbidden = errors.New("[hanya Account Manager pemilik klien atau SPV/Lead Account yang dapat membuat Dependency]")
	// ErrDepIncomplete: a mandatory field (source/target/type) is missing.
	ErrDepIncomplete = errors.New("[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]")
	// ErrDepInvalidType: Type is outside Blocking / Informational (§5.1).
	ErrDepInvalidType = errors.New("[tipe dependency tidak valid: harus Blocking atau Informational]")
	// ErrDepInvalidEntity: a source/target entity type other than Brief was supplied
	// (only Brief<->Brief is sanctioned, §5.1).
	ErrDepInvalidEntity = errors.New("[dependency hanya dapat dibuat antar Brief]")
	// ErrDepSelf: source and target are the same Brief (a Brief cannot depend on itself).
	ErrDepSelf = errors.New("[Source dan Target Dependency tidak boleh Brief yang sama]")
	// ErrDepBriefNotFound: a referenced Brief does not exist.
	ErrDepBriefNotFound = errors.New("[brief tidak ditemukan]")
	// ErrDepCrossClient: source and target belong to different Clients (§2 Rule 4).
	ErrDepCrossClient = errors.New("[dependency hanya bisa dibuat antar Brief dalam Client yang sama]")
	// ErrDepDuplicate: an active Dependency already exists for this (Source, Target)
	// pair (§5.1 constraint).
	ErrDepDuplicate = errors.New("[dependency untuk pasangan Brief ini sudah ada]")
	// ErrDepCycle: creating this Dependency would form a circular dependency (§2
	// Rule 6, graph traversal).
	ErrDepCycle = errors.New("[dependency ini membentuk siklus (circular dependency) dan ditolak]")
	// ErrDepNotFound: the referenced Dependency does not exist.
	ErrDepNotFound = errors.New("[dependency tidak ditemukan]")
	// ErrDepViewForbidden: actor may not read this Dependency / board.
	ErrDepViewForbidden = errors.New("[anda tidak memiliki akses ke data ini]")
)

// Service is the M11 persistence surface.
type Service struct {
	DB *sql.DB
	// Catalog is the FROZEN notification catalog (Phase 0 v2 §9). Nil-guarded: when
	// unset (most unit tests) EvDependencySatisfied emission is skipped. M11 emits
	// ONLY the already-registered EvDependencySatisfied — the catalog is not extended.
	Catalog *notification.Catalog
}

// Dependency is one DEP- row plus its DERIVED status (never stored).
type Dependency struct {
	ID         string    `json:"id"`
	SourceType string    `json:"source_type"`
	SourceID   string    `json:"source_id"`
	TargetType string    `json:"target_type"`
	TargetID   string    `json:"target_id"`
	Type       string    `json:"type"`
	Note       string    `json:"note,omitempty"`
	ClientID   string    `json:"client_id"`
	Status     string    `json:"status"` // DERIVED: Pending | Blocking | Satisfied (§5.1)
	CreatedBy  string    `json:"created_by"`
	CreatedAt  time.Time `json:"created_at"`
}

// DependencyInput carries the create fields (M11 §5.1). SourceType/TargetType
// default to "brief" when omitted (the only sanctioned type).
type DependencyInput struct {
	SourceType string
	SourceID   string
	TargetType string
	TargetID   string
	Type       string
	Note       string
}

// CreateDependency declares a cross-Brief Dependency (M11 §3 step 2 / §5.1). All
// validation is server-side and runs BEFORE the DEP- id is minted (house rule 1):
// entity types (Brief only), self-reference, both Briefs exist, same Client
// (§2 Rule 4), no duplicate active pair, no cycle (§2 Rule 6). Authority: owning AM
// / Account lead / Director (§6.1). No approval gate — it takes effect immediately
// (§6.2).
func (s *Service) CreateDependency(ctx context.Context, actor permission.Actor, in DependencyInput) (Dependency, error) {
	srcType := normEntity(in.SourceType)
	tgtType := normEntity(in.TargetType)
	srcID := strings.TrimSpace(in.SourceID)
	tgtID := strings.TrimSpace(in.TargetID)
	depType := strings.TrimSpace(in.Type)

	if srcID == "" || tgtID == "" || depType == "" {
		return Dependency{}, ErrDepIncomplete
	}
	if depType != TypeBlocking && depType != TypeInformational {
		return Dependency{}, ErrDepInvalidType
	}
	if srcType != entityBrief || tgtType != entityBrief {
		return Dependency{}, ErrDepInvalidEntity
	}
	if srcID == tgtID {
		return Dependency{}, ErrDepSelf
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Dependency{}, err
	}
	defer tx.Rollback()

	// Both Briefs must exist; capture each one's Client + owning AM (for the gate).
	srcClient, _, err := lockBriefClient(ctx, tx, srcID)
	if err != nil {
		return Dependency{}, err
	}
	tgtClient, tgtOwnerAM, err := lockBriefClient(ctx, tx, tgtID)
	if err != nil {
		return Dependency{}, err
	}
	// §2 Rule 4: same Client only.
	if srcClient != tgtClient {
		return Dependency{}, ErrDepCrossClient
	}
	// §6.1 authority: owning AM of the Client, Account lead/SPV, or Director.
	if !canCreateDependency(actor, tgtOwnerAM) {
		return Dependency{}, ErrDepCreateForbidden
	}
	// §5.1: one active Dependency per ordered pair.
	dup, err := pairExists(ctx, tx, srcID, tgtID)
	if err != nil {
		return Dependency{}, err
	}
	if dup {
		return Dependency{}, ErrDepDuplicate
	}
	// §2 Rule 6: reject a cycle. Adding source->target forms a cycle iff source is
	// already reachable FROM target via the existing active edges.
	cyclic, err := reachable(ctx, tx, tgtID, srcID)
	if err != nil {
		return Dependency{}, err
	}
	if cyclic {
		return Dependency{}, ErrDepCycle
	}

	id, err := ident.Next(ctx, tx, "DEP", time.Now())
	if err != nil {
		return Dependency{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO dependencies
		   (id, source_type, source_id, target_type, target_id, dependency_type, note, client_id, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, srcType, srcID, tgtType, tgtID, depType, nullStr(in.Note), srcClient, actor.EmployeeID); err != nil {
		return Dependency{}, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "dependency", EntityID: id, Actor: actor.EmployeeID, Action: "create",
		After: map[string]any{
			"source_id": srcID, "target_id": tgtID, "type": depType, "client_id": srcClient,
		},
	}); err != nil {
		return Dependency{}, err
	}
	if err := tx.Commit(); err != nil {
		return Dependency{}, err
	}

	out := Dependency{
		ID: id, SourceType: srcType, SourceID: srcID, TargetType: tgtType, TargetID: tgtID,
		Type: depType, Note: strings.TrimSpace(in.Note), ClientID: srcClient,
		CreatedBy: actor.EmployeeID, CreatedAt: time.Now(),
	}
	// Status derived from the Source's live status (already read above via lock; the
	// Source has not changed inside this tx).
	srcStatus, err := briefStatus(ctx, s.DB, srcID)
	if err != nil {
		return Dependency{}, err
	}
	out.Status = derivedStatus(srcStatus, depType)
	return out, nil
}

// derivedStatus computes a Dependency's status from the Source Brief's live status
// and the Dependency type (M11 §5.1). Precedence:
//   - Source terminal ([Approved])                    -> Satisfied
//   - type=Blocking & Source started (not [To Do])    -> Blocking
//   - otherwise (not started, or Informational)       -> Pending
//
// The gate itself (whether the Target may be approved) is a stricter, separate
// predicate (blockingSourceUnsatisfied): a Blocking Dependency blocks the Target
// while the Source is not terminal REGARDLESS of whether it has started — a Source
// still in [To Do] is shown Pending but still holds the Target back.
func derivedStatus(sourceStatus, depType string) string {
	if sourceStatus == briefTerminal {
		return StatusSatisfied
	}
	if depType == TypeBlocking && sourceStatus != briefToDo {
		return StatusBlocking
	}
	return StatusPending
}

// canCreateDependency is the §6.1 authority gate: Director, an Account lead/SPV, or
// the owning AM of the Client (Account staff whose id is the Client's assigned AM).
// Division staff and non-owning AMs are denied (§6.1 "not staff at the division
// level"; consistent with the owning-AM Brief-creation gate).
func canCreateDependency(a permission.Actor, ownerAM string) bool {
	if a.Role.Director {
		return true
	}
	if a.IsLead(AccountDivision) {
		return true
	}
	return a.Role.Division == AccountDivision && a.Role.Level == permission.LevelStaff &&
		ownerAM != "" && a.EmployeeID == ownerAM
}

// ---- brief lookups ------------------------------------------------------------

// lockBriefClient row-locks a Brief and returns its Client id and the Client's
// owning AM. A missing Brief is ErrDepBriefNotFound.
func lockBriefClient(ctx context.Context, tx *sql.Tx, briefID string) (clientID, ownerAM string, err error) {
	var owner sql.NullString
	err = tx.QueryRowContext(ctx,
		`SELECT sv.client_id, c.assigned_am_id
		   FROM briefs b
		   JOIN services sv ON sv.id = b.service_id
		   JOIN clients c ON c.id = sv.client_id
		  WHERE b.id = ? FOR UPDATE`, briefID).Scan(&clientID, &owner)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", ErrDepBriefNotFound
	}
	if err != nil {
		return "", "", err
	}
	return clientID, owner.String, nil
}

// briefStatus reads a Brief's live status (no lock).
func briefStatus(ctx context.Context, db interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, briefID string) (string, error) {
	var st string
	err := db.QueryRowContext(ctx, `SELECT status FROM briefs WHERE id = ?`, briefID).Scan(&st)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrDepBriefNotFound
	}
	return st, err
}

// pairExists reports whether an active Dependency already links (source -> target).
func pairExists(ctx context.Context, tx *sql.Tx, sourceID, targetID string) (bool, error) {
	var n int
	err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM dependencies WHERE source_id = ? AND target_id = ?`,
		sourceID, targetID).Scan(&n)
	return n > 0, err
}

// reachable reports whether `to` is reachable FROM `from` by following active
// Dependency edges (source -> target). Used for the cycle check: adding s->t is
// safe unless s is already reachable from t. Bounded BFS over the edge set; the
// visited set makes it terminate even on pre-existing (malformed) cycles.
func reachable(ctx context.Context, tx *sql.Tx, from, to string) (bool, error) {
	visited := map[string]bool{}
	queue := []string{from}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		if cur == to {
			return true, nil
		}
		if visited[cur] {
			continue
		}
		visited[cur] = true
		rows, err := tx.QueryContext(ctx,
			`SELECT target_id FROM dependencies WHERE source_id = ?`, cur)
		if err != nil {
			return false, err
		}
		var next []string
		for rows.Next() {
			var t string
			if err := rows.Scan(&t); err != nil {
				rows.Close()
				return false, err
			}
			next = append(next, t)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return false, err
		}
		rows.Close()
		queue = append(queue, next...)
	}
	return false, nil
}

// ---- read APIs ----------------------------------------------------------------

// GetDependency returns one Dependency with its derived status, if the actor may
// see the underlying Client (§5.3 read scope).
func (s *Service) GetDependency(ctx context.Context, actor permission.Actor, depID string) (Dependency, error) {
	d, err := s.loadDependency(ctx, depID)
	if err != nil {
		return Dependency{}, err
	}
	ok, err := s.canSeeClient(ctx, actor, d.ClientID)
	if err != nil {
		return Dependency{}, err
	}
	if !ok {
		return Dependency{}, ErrDepViewForbidden
	}
	if err := s.fillStatus(ctx, &d); err != nil {
		return Dependency{}, err
	}
	return d, nil
}

// ListDependencies returns Dependencies filtered by target and/or source Brief
// (either may be empty), each with its derived status. Only rows whose Client the
// actor may see are returned. The M8 implicit Asset->Launch guardrail (§2 Rule 9 /
// §6.4) is NEVER a row here — it is hardcoded in module8_ads and never declared, so
// it can never appear in this listing.
func (s *Service) ListDependencies(ctx context.Context, actor permission.Actor, sourceID, targetID string) ([]Dependency, error) {
	q := `SELECT id, source_type, source_id, target_type, target_id, dependency_type,
	             COALESCE(note,''), client_id, created_by, created_at
	        FROM dependencies WHERE 1=1`
	var args []any
	if strings.TrimSpace(sourceID) != "" {
		q += " AND source_id = ?"
		args = append(args, strings.TrimSpace(sourceID))
	}
	if strings.TrimSpace(targetID) != "" {
		q += " AND target_id = ?"
		args = append(args, strings.TrimSpace(targetID))
	}
	q += " ORDER BY id ASC"
	rows, err := s.DB.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var deps []Dependency
	for rows.Next() {
		d, err := scanDependency(rows)
		if err != nil {
			return nil, err
		}
		deps = append(deps, d)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := []Dependency{}
	seen := map[string]bool{} // client visibility cache
	allow := map[string]bool{}
	for _, d := range deps {
		if !seen[d.ClientID] {
			ok, err := s.canSeeClient(ctx, actor, d.ClientID)
			if err != nil {
				return nil, err
			}
			seen[d.ClientID] = true
			allow[d.ClientID] = ok
		}
		if !allow[d.ClientID] {
			continue
		}
		if err := s.fillStatus(ctx, &d); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, nil
}

// fillStatus derives d.Status from the Source Brief's live status.
func (s *Service) fillStatus(ctx context.Context, d *Dependency) error {
	st, err := briefStatus(ctx, s.DB, d.SourceID)
	if err != nil {
		return err
	}
	d.Status = derivedStatus(st, d.Type)
	return nil
}

func (s *Service) loadDependency(ctx context.Context, depID string) (Dependency, error) {
	row := s.DB.QueryRowContext(ctx,
		`SELECT id, source_type, source_id, target_type, target_id, dependency_type,
		        COALESCE(note,''), client_id, created_by, created_at
		   FROM dependencies WHERE id = ?`, depID)
	d, err := scanDependency(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Dependency{}, ErrDepNotFound
	}
	return d, err
}

// rowScanner is satisfied by *sql.Row and *sql.Rows.
type rowScanner interface{ Scan(dest ...any) error }

func scanDependency(sc rowScanner) (Dependency, error) {
	var d Dependency
	if err := sc.Scan(&d.ID, &d.SourceType, &d.SourceID, &d.TargetType, &d.TargetID,
		&d.Type, &d.Note, &d.ClientID, &d.CreatedBy, &d.CreatedAt); err != nil {
		return Dependency{}, err
	}
	return d, nil
}

// canSeeClient is the §5.3 read predicate: AM/SPV/OD/Director see every Client;
// a staff member sees a Client only where they are PIC of at least one of that
// Client's work units (Brief / Asset / Booking). Live Stream Sessions carry no
// per-session PIC, so LS ownership is via the Brief's assigned PIC.
func (s *Service) canSeeClient(ctx context.Context, actor permission.Actor, clientID string) (bool, error) {
	if actor.CanReadAll() { // OD / Director
		return true, nil
	}
	if actor.CanReadDivision(AccountDivision) { // Account lead/SPV
		return true, nil
	}
	// Owning AM of the Client (Account staff).
	var ownerAM sql.NullString
	if err := s.DB.QueryRowContext(ctx,
		`SELECT assigned_am_id FROM clients WHERE id = ?`, clientID).Scan(&ownerAM); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	if ownerAM.Valid && ownerAM.String == actor.EmployeeID {
		return true, nil
	}
	// Division staff/lead who is PIC of some unit of this Client.
	var n int
	if err := s.DB.QueryRowContext(ctx,
		`SELECT
		   (SELECT COUNT(*) FROM briefs b JOIN services sv ON sv.id = b.service_id
		     WHERE sv.client_id = ? AND b.assigned_pic = ?)
		 + (SELECT COUNT(*) FROM assets a JOIN briefs b ON b.id = a.brief_id
		      JOIN services sv ON sv.id = b.service_id
		     WHERE sv.client_id = ? AND a.assigned_pic = ?)
		 + (SELECT COUNT(*) FROM creator_bookings k JOIN briefs b ON b.id = k.brief_id
		      JOIN services sv ON sv.id = b.service_id
		     WHERE sv.client_id = ? AND k.assigned_coordinator = ?)`,
		clientID, actor.EmployeeID, clientID, actor.EmployeeID, clientID, actor.EmployeeID).Scan(&n); err != nil {
		return false, err
	}
	return n > 0, nil
}

// ---- helpers ------------------------------------------------------------------

func normEntity(t string) string {
	t = strings.ToLower(strings.TrimSpace(t))
	if t == "" {
		return entityBrief // default: Brief (the only sanctioned type)
	}
	return t
}

func nullStr(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return strings.TrimSpace(s)
}
