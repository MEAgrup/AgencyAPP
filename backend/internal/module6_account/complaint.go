// This file implements Module 6 — Cluster 4 (part B): Complaint door #2, the
// AM-via-WhatsApp channel (M6 §8). WhatsApp is outside the system, so the AM
// MANUALLY logs a Complaint (CPL-) after receiving one (§8 Rule 2) — there is no
// auto-capture. The Complaint is ONE entity with a Source field (§9.5) designed
// for all three effective doors; only door #2 (WhatsApp/AM) is wired here, doors
// #1 (Sales, M4 §6) and #3 (Client Portal, M15) add their own logging paths
// against the same table later.
//
// Lifecycle (STATE_MACHINES §11): [Open] -> [In Progress] -> [Resolved] ->
// [Closed]. [Closed] is distinct from [Resolved]: the AM confirms the client is
// satisfied before closing (§8 Rule 5). Resolution ownership stays with the AM
// regardless of who contributes (§8 Rule 4) — divisions never close complaints.
//
// House rules honoured here:
//   - the CPL- id is minted (ident.Next) ONLY after mandatory-field validation
//     passes (house rule 1);
//   - the birth status [Open] is set at INSERT (a creation, not a transition —
//     same precedent as strategy.go / brief.go); every later status move goes
//     through the engine, never a raw UPDATE (house rule 2);
//   - status/edit history is immutable in the audit log; the open-complaint count
//     that feeds Health Score (§8 Rule 6, M13) derives from it (house rules 3/4);
//   - EvComplaintLogged (Phase 0 v2 §9, already in the FROZEN catalog) is emitted
//     on logging — the DoD requires firing cataloged events (nil-guarded).
package module6_account

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

// Complaint Source values (§9.5, single choice). Only door #2 is wired here.
const (
	ComplaintSourceWhatsApp     = "WhatsApp (AM-logged)"
	ComplaintSourceClientPortal = "Client Portal"
	ComplaintSourceSales        = "Sales"
)

// Complaint lifecycle states (STATE_MACHINES §11).
const (
	ComplaintStatusOpen       = "[Open]"
	ComplaintStatusInProgress = "[In Progress]"
	ComplaintStatusResolved   = "[Resolved]"
	ComplaintStatusClosed     = "[Closed]"
)

// allowedSeverities is the §9.5 Severity single-choice set (M6-OA-4).
var allowedSeverities = map[string]bool{"Low": true, "Medium": true, "High": true}

// Sentinel errors carrying the exact Bahasa Indonesia message (house rule 5).
// All NEW here (the PRD quotes none verbatim), following the W1-09 precedent and
// listed in the report for orchestrator sign-off. Description-missing reuses the
// default ErrIncomplete; a missing/unreleased client reuses ErrNotFound.
var (
	// ErrComplaintNotFound: the referenced Complaint does not exist.
	ErrComplaintNotFound = errors.New("[komplain tidak ditemukan]")
	// ErrComplaintForbidden: actor may not read this Complaint.
	ErrComplaintForbidden = errors.New("[anda tidak memiliki akses ke komplain ini]")
	// ErrLogComplaintForbidden: actor is not the owning AM (nor Director) — door #2
	// is the client's AM logging a WhatsApp complaint (§8 / §9.1).
	ErrLogComplaintForbidden = errors.New("[hanya Account Manager pemilik klien yang dapat mencatat komplain untuk klien ini]")
	// ErrComplaintManageForbidden: actor may not drive this Complaint's status
	// (only the owning AM, Account lead/SPV or Director — §8 Rule 4 / §9.1).
	ErrComplaintManageForbidden = errors.New("[anda tidak memiliki akses untuk mengelola komplain ini]")
	// ErrInvalidSeverity: Severity is outside Low/Medium/High (§9.5).
	ErrInvalidSeverity = errors.New("[tingkat keparahan tidak valid]")
	// ErrInvalidRelatedRef: the optional Related Service/Brief does not reference a
	// Service or Brief of THIS client (§8 Rule 3, integrity).
	ErrInvalidRelatedRef = errors.New("[referensi layanan atau brief tidak valid]")
	// ErrResolutionNotesRequired: Resolution Notes are mandatory before [Resolved] (§9.5).
	ErrResolutionNotesRequired = errors.New("[catatan penyelesaian wajib diisi]")
)

// ComplaintInput carries the §9.5 caller-supplied Complaint fields. Mandatory:
// Description, Severity. Optional: RelatedRef (a SVC-/BRF- of the same client).
type ComplaintInput struct {
	Description string
	Severity    string
	RelatedRef  string
}

// Complaint is a Complaint record (CPL-).
type Complaint struct {
	ID              string    `json:"id"`
	ClientID        string    `json:"client_id"`
	RelatedRef      string    `json:"related_ref,omitempty"`
	Source          string    `json:"source"`
	Description     string    `json:"description"`
	Severity        string    `json:"severity"`
	Status          string    `json:"status"`
	AssignedTo      string    `json:"assigned_to,omitempty"`
	ResolutionNotes string    `json:"resolution_notes,omitempty"`
	CreatedBy       string    `json:"created_by"`
	CreatedAt       time.Time `json:"created_at"`
}

func (in ComplaintInput) validate() error {
	if strings.TrimSpace(in.Description) == "" || strings.TrimSpace(in.Severity) == "" {
		return ErrIncomplete
	}
	if !allowedSeverities[in.Severity] {
		return ErrInvalidSeverity
	}
	return nil
}

// LogComplaint records a WhatsApp complaint against a client (door #2, §8). The
// owning AM (or Director) only; Source is fixed to WhatsApp (AM-logged). The
// CPL- id is minted after validation; assigned_to defaults to the owning AM
// (§9.5); birth status is [Open].
func (s *Service) LogComplaint(ctx context.Context, actor permission.Actor, clientID string, in ComplaintInput) (Complaint, error) {
	if err := in.validate(); err != nil {
		return Complaint{}, err
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Complaint{}, err
	}
	defer tx.Rollback()

	// Client must exist and be released to Account (invisible pre-release, M5 §5
	// Rule 2 — reported not-found), and its owning AM is the door-#2 logger.
	var releasedAt sql.NullTime
	var ownerAM sql.NullString
	err = tx.QueryRowContext(ctx,
		`SELECT released_to_account_at, assigned_am_id FROM clients WHERE id = ? FOR UPDATE`, clientID).
		Scan(&releasedAt, &ownerAM)
	if errors.Is(err, sql.ErrNoRows) {
		return Complaint{}, ErrNotFound
	}
	if err != nil {
		return Complaint{}, err
	}
	if !releasedAt.Valid {
		return Complaint{}, ErrNotFound
	}
	// Owner AM only — except Director (full access, precedent W1-13).
	if !actor.Role.Director && (!ownerAM.Valid || ownerAM.String != actor.EmployeeID) {
		return Complaint{}, ErrLogComplaintForbidden
	}
	// Optional Related Service/Brief must belong to THIS client (§8 Rule 3).
	relatedRef := strings.TrimSpace(in.RelatedRef)
	if relatedRef != "" {
		if err := validateRelatedRef(ctx, tx, clientID, relatedRef); err != nil {
			return Complaint{}, err
		}
	}

	id, err := ident.Next(ctx, tx, "CPL", time.Now())
	if err != nil {
		return Complaint{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO complaints
		   (id, client_id, related_ref, source, description, severity, status, assigned_to, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, clientID, nullStr(relatedRef), ComplaintSourceWhatsApp, in.Description, in.Severity,
		ComplaintStatusOpen, nullNullString(ownerAM), actor.EmployeeID); err != nil {
		return Complaint{}, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "complaint", EntityID: id, Actor: actor.EmployeeID, Action: "create",
		After: map[string]any{"status": ComplaintStatusOpen, "client_id": clientID, "severity": in.Severity, "source": ComplaintSourceWhatsApp},
	}); err != nil {
		return Complaint{}, err
	}
	// EvComplaintLogged (Phase 0 v2 §9, FROZEN catalog) -> AM + SPV Account.
	// explicitOrLeads unions Account leads with the owning AM; the logging actor
	// is excluded by default, so a self-logging AM notifies only the SPV.
	if s.Catalog != nil {
		var recips []string
		if ownerAM.Valid {
			recips = []string{ownerAM.String}
		}
		if _, err := s.Catalog.Emit(ctx, tx, notification.Emission{
			Event: notification.EvComplaintLogged, EntityType: "complaint", EntityID: id,
			Actor: actor.EmployeeID, Division: AccountDivision, ExplicitRecipients: recips,
		}); err != nil {
			return Complaint{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Complaint{}, err
	}
	return Complaint{
		ID: id, ClientID: clientID, RelatedRef: relatedRef, Source: ComplaintSourceWhatsApp,
		Description: in.Description, Severity: in.Severity, Status: ComplaintStatusOpen,
		AssignedTo: ownerAM.String, CreatedBy: actor.EmployeeID, CreatedAt: time.Now(),
	}, nil
}

// StartComplaint moves a Complaint [Open] -> [In Progress] (§8 Rule 5). Owning
// AM, Account lead/SPV (escalation, §9.1) or Director.
func (s *Service) StartComplaint(ctx context.Context, actor permission.Actor, complaintID string) (statemachine.Result, error) {
	return s.transitionComplaint(ctx, actor, complaintID, ComplaintStatusInProgress, "", false)
}

// ResolveComplaint moves a Complaint [In Progress] -> [Resolved] (§8 Rule 5,
// "action was taken"). Resolution notes are mandatory (§9.5). Owning AM, Account
// lead/SPV or Director.
func (s *Service) ResolveComplaint(ctx context.Context, actor permission.Actor, complaintID, notes string) (statemachine.Result, error) {
	notes = strings.TrimSpace(notes)
	if notes == "" {
		return statemachine.Result{}, ErrResolutionNotesRequired
	}
	return s.transitionComplaint(ctx, actor, complaintID, ComplaintStatusResolved, notes, true)
}

// CloseComplaint moves a Complaint [Resolved] -> [Closed] (§8 Rule 5 — the AM
// confirms the client is satisfied, distinct from Resolved). Owning AM, Account
// lead/SPV or Director.
func (s *Service) CloseComplaint(ctx context.Context, actor permission.Actor, complaintID string) (statemachine.Result, error) {
	return s.transitionComplaint(ctx, actor, complaintID, ComplaintStatusClosed, "", false)
}

// transitionComplaint is the shared owner/lead-gated engine driver for the CPL-
// status moves. requireNotes stores resolution_notes for display (immutably
// mirrored in the audit log).
func (s *Service) transitionComplaint(ctx context.Context, actor permission.Actor, complaintID, to, notes string, storeNotes bool) (statemachine.Result, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return statemachine.Result{}, err
	}
	defer tx.Rollback()

	ownerAM, err := lockComplaintOwner(ctx, tx, complaintID)
	if err != nil {
		return statemachine.Result{}, err
	}
	if !canManageComplaint(actor, ownerAM) {
		return statemachine.Result{}, ErrComplaintManageForbidden
	}
	res, err := s.engine().Transition(ctx, tx, statemachine.Request{
		Machine: statemachine.MComplaint, EntityType: "complaint", Table: "complaints",
		EntityID: complaintID, To: to, Actor: actor,
	})
	if err != nil {
		return statemachine.Result{}, err
	}
	if storeNotes {
		if _, err := tx.ExecContext(ctx,
			`UPDATE complaints SET resolution_notes = ? WHERE id = ?`, notes, complaintID); err != nil {
			return statemachine.Result{}, err
		}
		if err := audit.Write(ctx, tx, audit.Record{
			EntityType: "complaint", EntityID: complaintID, Actor: actor.EmployeeID, Action: "resolution_notes",
			After: map[string]any{"resolution_notes": notes},
		}); err != nil {
			return statemachine.Result{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return statemachine.Result{}, err
	}
	return res, nil
}

// GetComplaint returns one Complaint if the actor may see it (§8 Rule 4 / §9.1):
// OD/Director everywhere; Account lead (division-wide); the owning AM; and — when
// the Complaint is tied to a Brief — that Brief's division staff/lead (read-only
// context).
func (s *Service) GetComplaint(ctx context.Context, actor permission.Actor, complaintID string) (Complaint, error) {
	c, ownerAM, relatedBriefDivision, err := s.loadComplaint(ctx, complaintID)
	if err != nil {
		return Complaint{}, err
	}
	if !canSeeComplaint(actor, ownerAM, relatedBriefDivision) {
		return Complaint{}, ErrComplaintForbidden
	}
	return c, nil
}

// ListClientComplaints returns a client's complaints (visibility follows the
// client, §8 Rule 3 / ticket point 3): the owning AM, Account lead, OD and
// Director. Division context read is per-complaint (GetComplaint), not here.
func (s *Service) ListClientComplaints(ctx context.Context, actor permission.Actor, clientID string) ([]Complaint, error) {
	var ownerAM sql.NullString
	var releasedAt sql.NullTime
	err := s.DB.QueryRowContext(ctx,
		`SELECT released_to_account_at, assigned_am_id FROM clients WHERE id = ?`, clientID).
		Scan(&releasedAt, &ownerAM)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if !releasedAt.Valid {
		return nil, ErrNotFound
	}
	if !(actor.CanReadDivision(AccountDivision) || (ownerAM.Valid && ownerAM.String == actor.EmployeeID)) {
		return nil, ErrComplaintForbidden
	}
	rows, err := s.DB.QueryContext(ctx, complaintSelect+` WHERE c.client_id = ? ORDER BY c.id DESC`, clientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanComplaints(rows)
}

// ---- helpers ----------------------------------------------------------------

const complaintSelect = `SELECT c.id, c.client_id, COALESCE(c.related_ref,''), c.source, c.description,
	        c.severity, c.status, COALESCE(c.assigned_to,''), COALESCE(c.resolution_notes,''),
	        c.created_by, c.created_at
	   FROM complaints c`

// canManageComplaint is the §8 Rule 4 / §9.1 write gate: owning AM, Account
// lead/SPV (escalation) or Director. IsLead already grants Directors and Account
// leads; other divisions and OD are denied.
func canManageComplaint(actor permission.Actor, ownerAM string) bool {
	return actor.IsLead(AccountDivision) || actor.EmployeeID == ownerAM
}

// canSeeComplaint is the §8 Rule 4 read predicate.
func canSeeComplaint(actor permission.Actor, ownerAM, relatedBriefDivision string) bool {
	if actor.CanReadAll() { // OD / Director
		return true
	}
	if actor.CanReadDivision(AccountDivision) { // Account lead (division-wide)
		return true
	}
	if actor.EmployeeID == ownerAM { // owning AM
		return true
	}
	// §8 Rule 4: a Brief-tied complaint is visible to that Brief's division
	// (read-only context) — staff or lead of the division.
	if relatedBriefDivision != "" && actor.Role.Division == relatedBriefDivision &&
		(actor.Role.Level == permission.LevelStaff || actor.Role.Level == permission.LevelLead) {
		return true
	}
	return false
}

// validateRelatedRef checks the optional Related Service/Brief points at a
// Service OR a Brief of this client (§8 Rule 3). No single FK spans both tables.
func validateRelatedRef(ctx context.Context, tx *sql.Tx, clientID, ref string) error {
	var one int
	err := tx.QueryRowContext(ctx,
		`SELECT 1 FROM services WHERE id = ? AND client_id = ?`, ref, clientID).Scan(&one)
	if err == nil {
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	err = tx.QueryRowContext(ctx,
		`SELECT 1 FROM briefs b JOIN services sv ON sv.id = b.service_id
		  WHERE b.id = ? AND sv.client_id = ?`, ref, clientID).Scan(&one)
	if err == nil {
		return nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return ErrInvalidRelatedRef
	}
	return err
}

// lockComplaintOwner row-locks a Complaint and returns its owning AM (the
// client's assigned AM) for the write gate.
func lockComplaintOwner(ctx context.Context, tx *sql.Tx, complaintID string) (ownerAM string, err error) {
	var owner sql.NullString
	err = tx.QueryRowContext(ctx,
		`SELECT c.assigned_am_id
		   FROM complaints cp JOIN clients c ON c.id = cp.client_id
		  WHERE cp.id = ? FOR UPDATE`, complaintID).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrComplaintNotFound
	}
	if err != nil {
		return "", err
	}
	return owner.String, nil
}

// loadComplaint reads a Complaint plus the owning AM and, when the related ref is
// a Brief, that Brief's division (for the §8 Rule 4 read predicate).
func (s *Service) loadComplaint(ctx context.Context, complaintID string) (Complaint, string, string, error) {
	// complaintSelect already contains "FROM complaints c"; splice in the extra
	// selected columns (owning AM + related-Brief division) and joins by replacing
	// that clause, then append the WHERE.
	q := strings.Replace(complaintSelect, "\n\t   FROM complaints c",
		", COALESCE(cl.assigned_am_id,''), COALESCE(b.assigned_division,'')\n\t   FROM complaints c"+
			" JOIN clients cl ON cl.id = c.client_id LEFT JOIN briefs b ON b.id = c.related_ref", 1) +
		` WHERE c.id = ?`
	var c Complaint
	var relatedRef, assignedTo, resolutionNotes, ownerAM, briefDivision string
	err := s.DB.QueryRowContext(ctx, q, complaintID).Scan(
		&c.ID, &c.ClientID, &relatedRef, &c.Source, &c.Description, &c.Severity, &c.Status,
		&assignedTo, &resolutionNotes, &c.CreatedBy, &c.CreatedAt, &ownerAM, &briefDivision)
	if errors.Is(err, sql.ErrNoRows) {
		return Complaint{}, "", "", ErrComplaintNotFound
	}
	if err != nil {
		return Complaint{}, "", "", err
	}
	c.RelatedRef = relatedRef
	c.AssignedTo = assignedTo
	c.ResolutionNotes = resolutionNotes
	return c, ownerAM, briefDivision, nil
}

func scanComplaints(rows *sql.Rows) ([]Complaint, error) {
	out := []Complaint{}
	for rows.Next() {
		var c Complaint
		var relatedRef, assignedTo, resolutionNotes string
		if err := rows.Scan(&c.ID, &c.ClientID, &relatedRef, &c.Source, &c.Description, &c.Severity,
			&c.Status, &assignedTo, &resolutionNotes, &c.CreatedBy, &c.CreatedAt); err != nil {
			return nil, err
		}
		c.RelatedRef = relatedRef
		c.AssignedTo = assignedTo
		c.ResolutionNotes = resolutionNotes
		out = append(out, c)
	}
	return out, rows.Err()
}

// nullNullString maps a sql.NullString to an INSERT arg (NULL when absent).
func nullNullString(v sql.NullString) any {
	if !v.Valid || strings.TrimSpace(v.String) == "" {
		return nil
	}
	return v.String
}
