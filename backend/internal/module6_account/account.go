// Package module6_account is Module 6 (Account & Service). This file implements
// Cluster 1 — Client intake & AM assignment (M6 §3):
//
//   - The Unassigned Intake Queue: every client released by Finance's routing
//     gate (M5 §5, released_to_account_at IS NOT NULL) that has no AM yet.
//     Visible only to SPV/Head Account (+ OD/Director read), never to individual
//     AMs (§3 Rule 1).
//   - Manual AM assignment by SPV/Head Account (§3 Rule 2) — not round-robin,
//     not self-claim. Exactly one AM owns the whole client relationship
//     (M6-OA-6); reassignment (§3 Rule 3) is the only way to change it and
//     requires a logged reason.
//   - The AM-workload counter for the SPV dashboard (§3 Rule 5) — a read-only,
//     recompute-from-state count, never a stored tally.
//
// House rules honoured here:
//   - assignment is a RELATIONSHIP (a current-AM pointer on the Client Record),
//     not a lifecycle status, so it is written by a plain guarded UPDATE, never
//     the state-machine engine (there is no "assignment" status machine);
//   - every assignment / reassignment appends an immutable audit row (who → whom,
//     when, why); the pointer holds only the CURRENT owner, history lives in the
//     audit log;
//   - the read/write authority split mirrors M4 §6 / the global role matrix.
package module6_account

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// AccountDivision is the CDPS division that owns intake & AM assignment.
const AccountDivision = "Account"

// Sentinel errors surfaced to the HTTP layer. Each carries the exact Bahasa
// Indonesia message the API returns (CLAUDE.md convention 5). The strings are
// not quoted verbatim in the PRD, so they follow the W1-09 precedent (logged in
// DECISIONS.md for orchestrator sign-off).
var (
	// ErrIntakeForbidden: actor may not read the Account intake queue / workload
	// (not SPV/Head Account, OD or Director).
	ErrIntakeForbidden = errors.New("[anda tidak memiliki akses ke antrean intake Account]")
	// ErrAssignForbidden: actor may not assign/reassign an AM (only SPV/Head
	// Account or Director; §3 Rule 2). OD is read-only.
	ErrAssignForbidden = errors.New("[anda tidak memiliki akses untuk menugaskan Account Manager]")
	// ErrNotFound: the client does not exist OR is not yet released to Account,
	// so it is not in Account's world at all (M5 §5 Rule 2). Reported as
	// not-found so a pre-release client stays invisible to Account.
	ErrNotFound = errors.New("[klien tidak ditemukan]")
	// ErrAlreadyAssigned: AssignAM on a client that already has an AM — the
	// caller must use reassignment (§3 Rule 3) so a reason is captured.
	ErrAlreadyAssigned = errors.New("[klien sudah memiliki Account Manager, gunakan reassignment]")
	// ErrNotAssigned: ReassignAM on a client that has no AM yet — assign first.
	ErrNotAssigned = errors.New("[klien belum memiliki Account Manager]")
	// ErrInvalidAM: the chosen assignee is not an active Account-division staff.
	ErrInvalidAM = errors.New("[Account Manager tidak valid: harus staff divisi Account yang aktif]")
	// ErrSameAM: reassignment target equals the current AM (no-op rejected).
	ErrSameAM = errors.New("[Account Manager tujuan sama dengan yang sekarang]")
	// ErrReasonRequired: reassignment reason is mandatory (§3 Rule 3, logged).
	ErrReasonRequired = errors.New("[alasan reassignment wajib diisi]")
)

// Service is the M6 persistence surface. Cluster 1 (intake & AM assignment) uses
// no state-machine engine (assignment is a relationship, not a status). Cluster 2
// (Strategy & Plan, strategy.go) drives the STR- and Service machines, so it may
// carry an Engine; when nil the strategy methods fall back to a fresh engine
// (the config is stateless — see engine()).
type Service struct {
	DB     *sql.DB
	Engine *statemachine.Engine
}

// engine returns the configured engine, or a fresh canonical one if unset.
func (s *Service) engine() *statemachine.Engine {
	if s.Engine != nil {
		return s.Engine
	}
	return statemachine.New()
}

// IntakeClient is one row of the Unassigned Intake Queue (§3 Rule 1) — the slim
// projection SPV needs to pick an AM (client profile + when it was released).
type IntakeClient struct {
	ClientID            string     `json:"client_id"`
	NamaPIC             string     `json:"nama_pic"`
	Toko                string     `json:"toko"`
	Kota                string     `json:"kota"`
	Kategori            string     `json:"kategori"`
	ServiceCount        int        `json:"service_count"`
	ReleasedToAccountAt *time.Time `json:"released_to_account_at"`
}

// AMWorkload is one AM's active-client count for the SPV dashboard (§3 Rule 5).
// It is a soft signal only — no hard capacity cap (M6-OA-2).
type AMWorkload struct {
	AMEmployeeID string `json:"am_employee_id"`
	ActiveCount  int    `json:"active_client_count"`
}

// Assignment reports the outcome of an assign / reassign action.
type Assignment struct {
	ClientID   string `json:"client_id"`
	PreviousAM string `json:"previous_am,omitempty"`
	AssignedAM string `json:"assigned_am"`
	AssignedBy string `json:"assigned_by"`
	Reason     string `json:"reason,omitempty"`
}

// canManageAssignment is the §3 Rule 2 write gate: SPV/Head Account (Account
// lead) or Director. OD (read-only) and any staff/AM are denied.
func canManageAssignment(a permission.Actor) bool { return a.IsLead(AccountDivision) }

// canReadIntake is the §3 Rule 1 read gate: SPV/Head Account, plus OD/Director
// (read-everywhere). Individual AMs (Account staff) and other divisions cannot
// see the unassigned queue.
func canReadIntake(a permission.Actor) bool { return a.CanReadDivision(AccountDivision) }

// IntakeQueue returns every released-but-unassigned client (§3 Rule 1), oldest
// release first so the longest-waiting client surfaces at the top.
func (s *Service) IntakeQueue(ctx context.Context, actor permission.Actor) ([]IntakeClient, error) {
	if !canReadIntake(actor) {
		return nil, ErrIntakeForbidden
	}
	rows, err := s.DB.QueryContext(ctx,
		`SELECT c.id, c.nama_pic, c.toko, c.kota, c.kategori,
		        (SELECT COUNT(*) FROM services s WHERE s.client_id = c.id) AS service_count,
		        c.released_to_account_at
		   FROM clients c
		  WHERE c.released_to_account_at IS NOT NULL
		    AND c.assigned_am_id IS NULL
		    AND c.dormant_at IS NULL
		  ORDER BY c.released_to_account_at ASC, c.id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []IntakeClient{}
	for rows.Next() {
		var ic IntakeClient
		var released sql.NullTime
		if err := rows.Scan(&ic.ClientID, &ic.NamaPIC, &ic.Toko, &ic.Kota, &ic.Kategori, &ic.ServiceCount, &released); err != nil {
			return nil, err
		}
		if released.Valid {
			ic.ReleasedToAccountAt = &released.Time
		}
		out = append(out, ic)
	}
	return out, rows.Err()
}

// Workload returns each AM's active-client count (§3 Rule 5), highest first.
// "Active" = a released, non-dormant client currently owned by that AM.
func (s *Service) Workload(ctx context.Context, actor permission.Actor) ([]AMWorkload, error) {
	if !canReadIntake(actor) {
		return nil, ErrIntakeForbidden
	}
	rows, err := s.DB.QueryContext(ctx,
		`SELECT assigned_am_id, COUNT(*) AS active_count
		   FROM clients
		  WHERE assigned_am_id IS NOT NULL
		    AND released_to_account_at IS NOT NULL
		    AND dormant_at IS NULL
		  GROUP BY assigned_am_id
		  ORDER BY active_count DESC, assigned_am_id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AMWorkload{}
	for rows.Next() {
		var w AMWorkload
		if err := rows.Scan(&w.AMEmployeeID, &w.ActiveCount); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// AssignAM assigns an AM to a released, currently-unassigned client (§3 Rules
// 2–4). One AM owns the entire client relationship (M6-OA-6). The pointer write
// and its immutable audit row commit together.
func (s *Service) AssignAM(ctx context.Context, actor permission.Actor, clientID, amID string) (Assignment, error) {
	if !canManageAssignment(actor) {
		return Assignment{}, ErrAssignForbidden
	}
	amID = strings.TrimSpace(amID)
	if amID == "" {
		return Assignment{}, ErrInvalidAM
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Assignment{}, err
	}
	defer tx.Rollback()

	released, current, err := lockClientForAssignment(ctx, tx, clientID)
	if err != nil {
		return Assignment{}, err
	}
	if !released {
		return Assignment{}, ErrNotFound
	}
	if current.Valid {
		return Assignment{}, ErrAlreadyAssigned
	}
	if err := validateAMCandidate(ctx, tx, amID); err != nil {
		return Assignment{}, err
	}

	if _, err := tx.ExecContext(ctx,
		`UPDATE clients SET assigned_am_id = ? WHERE id = ?`, amID, clientID); err != nil {
		return Assignment{}, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "client", EntityID: clientID, Actor: actor.EmployeeID, Action: "am_assigned",
		Before: map[string]any{"assigned_am_id": nil},
		After:  map[string]any{"assigned_am_id": amID, "assigned_by": actor.EmployeeID},
	}); err != nil {
		return Assignment{}, err
	}
	if err := tx.Commit(); err != nil {
		return Assignment{}, err
	}
	return Assignment{ClientID: clientID, AssignedAM: amID, AssignedBy: actor.EmployeeID}, nil
}

// ReassignAM moves a client from its current AM to a new one (§3 Rule 3,
// M6-OA-6 coverage mechanism). Reason is mandatory and logged. The target must
// be a valid, active Account AM and differ from the current owner.
func (s *Service) ReassignAM(ctx context.Context, actor permission.Actor, clientID, newAMID, reason string) (Assignment, error) {
	if !canManageAssignment(actor) {
		return Assignment{}, ErrAssignForbidden
	}
	newAMID = strings.TrimSpace(newAMID)
	if newAMID == "" {
		return Assignment{}, ErrInvalidAM
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return Assignment{}, ErrReasonRequired
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Assignment{}, err
	}
	defer tx.Rollback()

	released, current, err := lockClientForAssignment(ctx, tx, clientID)
	if err != nil {
		return Assignment{}, err
	}
	if !released {
		return Assignment{}, ErrNotFound
	}
	if !current.Valid {
		return Assignment{}, ErrNotAssigned
	}
	if current.String == newAMID {
		return Assignment{}, ErrSameAM
	}
	if err := validateAMCandidate(ctx, tx, newAMID); err != nil {
		return Assignment{}, err
	}

	if _, err := tx.ExecContext(ctx,
		`UPDATE clients SET assigned_am_id = ? WHERE id = ?`, newAMID, clientID); err != nil {
		return Assignment{}, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "client", EntityID: clientID, Actor: actor.EmployeeID, Action: "am_reassigned",
		Before: map[string]any{"assigned_am_id": current.String},
		After:  map[string]any{"assigned_am_id": newAMID, "assigned_by": actor.EmployeeID, "reason": reason},
	}); err != nil {
		return Assignment{}, err
	}
	if err := tx.Commit(); err != nil {
		return Assignment{}, err
	}
	return Assignment{
		ClientID: clientID, PreviousAM: current.String, AssignedAM: newAMID,
		AssignedBy: actor.EmployeeID, Reason: reason,
	}, nil
}

// lockClientForAssignment takes the row lock and reads the two fields the
// assignment gates need: whether the client is released to Account, and its
// current AM pointer. A missing client is reported as not-found.
func lockClientForAssignment(ctx context.Context, tx *sql.Tx, clientID string) (released bool, current sql.NullString, err error) {
	var releasedAt sql.NullTime
	err = tx.QueryRowContext(ctx,
		`SELECT released_to_account_at, assigned_am_id FROM clients WHERE id = ? FOR UPDATE`, clientID).
		Scan(&releasedAt, &current)
	if errors.Is(err, sql.ErrNoRows) {
		return false, sql.NullString{}, ErrNotFound
	}
	if err != nil {
		return false, sql.NullString{}, err
	}
	return releasedAt.Valid, current, nil
}

// validateAMCandidate enforces that the chosen assignee is an ACTIVE employee
// whose resolved CDPS division is Account (§3 Rule 2 — an AM is Account staff).
// It mirrors the divisi+jabatan → division join used by auth.ResolveActor,
// without importing the auth layer; layered OD/Director roles are irrelevant
// here (they never make someone an AM).
func validateAMCandidate(ctx context.Context, tx *sql.Tx, amID string) error {
	var active int
	var division, level sql.NullString
	err := tx.QueryRowContext(ctx,
		`SELECT e.status_aktif, rm.division, rm.level
		   FROM employees e
		   LEFT JOIN role_mappings rm ON rm.divisi = e.divisi AND rm.jabatan = e.jabatan
		  WHERE e.employee_id = ?`, amID).Scan(&active, &division, &level)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrInvalidAM
	}
	if err != nil {
		return err
	}
	// M6 §3 Rule 1 memisahkan "SPV/Head Account" dari "individual AMs": kandidat
	// AM = STAFF divisi Account. Lead/SPV bukan kandidat (mereka pemberi tugas).
	if active != 1 || !division.Valid || division.String != AccountDivision ||
		!level.Valid || level.String != permission.LevelStaff {
		return ErrInvalidAM
	}
	return nil
}
