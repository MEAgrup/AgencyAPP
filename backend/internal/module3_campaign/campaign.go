// Package module3_campaign is Module 3 (Campaign). It introduces the acquisition
// Campaign (CMP-) — MEA's OWN lead-gen / acquisition effort (M3 §1/§2), the first-
// class "thread" that later ties Leads -> Clients -> execution. It is DISTINCT from
// Module 8's Ad Campaign (ADC-), the client-facing paid-media record (M3-OA-1).
//
// Cluster 1 (this package) owns identity + lifecycle + ownership ONLY:
//   - Create: mandatory Name, Channel, Online/Offline (>=1), Start Date; Owner = the
//     creating actor. The CMP- id is minted (ident.Next) ONLY after validation passes
//     (house rule 1); born status 'Draft' at INSERT.
//   - Transition: driven exclusively through the transition engine (STATE_MACHINES §3,
//     machine "campaign") — the ONLY path that writes the status column (house rule 2).
//     Reaching 'Closed' sets end_date = today (WIB) as a data-column effect (§6.3).
//   - Reassign: ownership handover, Marketing lead/head or Director only (M3-OA-6 / §5
//     Rule 3), audited before->after.
//   - Get/List: staff own-only, Marketing lead/head + OD + Director see all (OD read-only).
//
// NOT in this cluster (W3-M3-C2): the leads/clients linkage, Channel->Source auto-set,
// and the read-only rollups (Leads generated, Real leads, Clients won, Total value won).
// Budget/metrics live on the 1:1 Marketing Performance Record (Module 2, M3-OA-5), never
// duplicated here. Module 3 emits NO notification event (the catalog is FROZEN).
package module3_campaign

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
	"github.com/meagrup/agencyapp/backend/internal/core/tz"
)

// MarketingDivision is the CDPS division that owns Campaigns (M3 §5 / §6.1). It matches
// module1_leads.MarketingDivision — the same HRIS MARKETING -> Marketing mapping.
const MarketingDivision = "Marketing"

// Campaign statuses — the campaign machine (STATE_MACHINES §3 / config.go MCampaign).
// The engine stores these labels WITHOUT brackets (initial "Draft", terminal "Archived"),
// so the module mirrors them verbatim.
const (
	StatusDraft    = "Draft"
	StatusActive   = "Active"
	StatusPaused   = "Paused"
	StatusClosed   = "Closed"
	StatusArchived = "Archived"
)

// Sentinel errors surfaced to the HTTP layer. Each carries a Bahasa Indonesia message
// that is VERBATIM from the PRD/house convention or reused from an existing module
// (CLAUDE.md convention 5 — no new BI strings are introduced by this cluster; the
// specific-wording proposals are listed in the ticket report for orchestrator sign-off).
var (
	// ErrIncomplete: a mandatory field is missing — PRD §3 Rule 2 / house default.
	ErrIncomplete = errors.New("[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]")
	// ErrNotFound: the Campaign does not exist (reuses the generic existing string
	// "[data tidak ditemukan]"). Also the fallback for a reassignment target that is
	// not a valid, active Marketing employee (no valid owner found for that id).
	ErrNotFound = errors.New("[data tidak ditemukan]")
	// ErrForbidden: actor may not view/manage/reassign this Campaign (reuses the
	// generic existing access-denial string "[anda tidak memiliki akses ke data ini]").
	ErrForbidden = errors.New("[anda tidak memiliki akses ke data ini]")
)

// Service is the M3 persistence surface. It drives the campaign machine, so it may carry
// an Engine; when nil it falls back to a fresh canonical engine (the config is stateless).
type Service struct {
	DB     *sql.DB
	Engine *statemachine.Engine
	// Catalog is the FROZEN notification catalog. Module 3 emits NOTHING (no cataloged
	// event covers Campaign lifecycle/ownership) — kept nil-guarded for symmetry only.
	Catalog *notification.Catalog
}

func (s *Service) engine() *statemachine.Engine {
	if s.Engine != nil {
		return s.Engine
	}
	return statemachine.New()
}

// CampaignInput carries the caller-supplied §6.3 mandatory fields. Owner and Status are
// NOT here — the owner is the creating actor and the status is born 'Draft'. Channel is
// free-text (M3-OA-2); Online/Offline is the multi-select checklist (at least one true).
type CampaignInput struct {
	Name      string
	Channel   string
	Online    bool
	Offline   bool
	StartDate string // "YYYY-MM-DD"
}

// Create creates a Campaign in 'Draft' (§3 Flow 1-2). Mandatory: Name, Channel,
// Online/Offline (>=1), Start Date (PRD §3 Rule 2). Owner = the creating actor. Only a
// Marketing staff/lead or a Director may create (M3 §6.1); the CMP- id is minted only
// after validation passes (house rule 1), so an incomplete create consumes no sequence.
func (s *Service) Create(ctx context.Context, actor permission.Actor, in CampaignInput) (Campaign, error) {
	if !canCreate(actor) {
		return Campaign{}, ErrForbidden
	}
	// §3 Rule 2 mandatory fields — validated BEFORE any id is minted (house rule 1).
	name := strings.TrimSpace(in.Name)
	channel := strings.TrimSpace(in.Channel)
	startStr := strings.TrimSpace(in.StartDate)
	if name == "" || channel == "" || startStr == "" || !(in.Online || in.Offline) {
		return Campaign{}, ErrIncomplete
	}
	start, err := time.Parse("2006-01-02", startStr)
	if err != nil {
		return Campaign{}, ErrIncomplete
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Campaign{}, err
	}
	defer tx.Rollback()

	id, err := ident.Next(ctx, tx, "CMP", time.Now())
	if err != nil {
		return Campaign{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO campaigns
		   (id, name, channel, is_online, is_offline, start_date, owner_employee_id, status, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, name, channel, boolToInt(in.Online), boolToInt(in.Offline), start.Format("2006-01-02"),
		actor.EmployeeID, StatusDraft, actor.EmployeeID); err != nil {
		return Campaign{}, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "campaign", EntityID: id, Actor: actor.EmployeeID, Action: "create",
		After: map[string]any{
			"status": StatusDraft, "name": name, "channel": channel,
			"is_online": in.Online, "is_offline": in.Offline,
			"start_date": start.Format("2006-01-02"), "owner_employee_id": actor.EmployeeID,
		},
	}); err != nil {
		return Campaign{}, err
	}
	if err := tx.Commit(); err != nil {
		return Campaign{}, err
	}
	return Campaign{
		ID: id, Name: name, Channel: channel, Online: in.Online, Offline: in.Offline,
		StartDate: start.Format("2006-01-02"), Owner: actor.EmployeeID, Status: StatusDraft,
		CreatedBy: actor.EmployeeID, CreatedAt: time.Now(),
	}, nil
}

// Reassign hands a Campaign's ownership to another Marketing Staff (§5 Rule 1/3,
// M3-OA-6). ONLY a Marketing lead/head or a Director may do this — staff (including the
// current owner) cannot reassign. The target must be an active Marketing employee. The
// pointer write and its immutable before->after audit row commit together; history
// (including prior owners) is preserved in the audit log.
func (s *Service) Reassign(ctx context.Context, actor permission.Actor, campaignID, newOwnerID string) (Campaign, error) {
	if !canReassign(actor) {
		return Campaign{}, ErrForbidden
	}
	newOwnerID = strings.TrimSpace(newOwnerID)
	if newOwnerID == "" {
		return Campaign{}, ErrIncomplete
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Campaign{}, err
	}
	defer tx.Rollback()

	row, err := lockCampaign(ctx, tx, campaignID)
	if err != nil {
		return Campaign{}, err
	}
	if err := validateOwnerCandidate(ctx, tx, newOwnerID); err != nil {
		return Campaign{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE campaigns SET owner_employee_id = ? WHERE id = ?`, newOwnerID, campaignID); err != nil {
		return Campaign{}, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "campaign", EntityID: campaignID, Actor: actor.EmployeeID, Action: "owner_reassigned",
		Before: map[string]any{"owner_employee_id": row.owner},
		After:  map[string]any{"owner_employee_id": newOwnerID, "reassigned_by": actor.EmployeeID},
	}); err != nil {
		return Campaign{}, err
	}
	if err := tx.Commit(); err != nil {
		return Campaign{}, err
	}
	return s.Get(ctx, actor, campaignID)
}

// campaignRow is the slim locked projection the gates need.
type campaignRow struct {
	id     string
	owner  string
	status string
}

// lockCampaign row-locks a Campaign and reads owner + status. A missing row is ErrNotFound.
func lockCampaign(ctx context.Context, tx *sql.Tx, id string) (campaignRow, error) {
	var r campaignRow
	err := tx.QueryRowContext(ctx,
		`SELECT id, owner_employee_id, status FROM campaigns WHERE id = ? FOR UPDATE`, id).
		Scan(&r.id, &r.owner, &r.status)
	if errors.Is(err, sql.ErrNoRows) {
		return campaignRow{}, ErrNotFound
	}
	if err != nil {
		return campaignRow{}, err
	}
	return r, nil
}

// canCreate is the §6.1 create gate: Marketing staff/lead, or Director (Director may
// own, per the ticket). OD is read-only; other divisions cannot create.
func canCreate(a permission.Actor) bool {
	if a.Role.Director {
		return true
	}
	return a.Role.Division == MarketingDivision &&
		(a.Role.Level == permission.LevelStaff || a.Role.Level == permission.LevelLead)
}

// canManageCampaign is the §6.1 write gate for lifecycle transitions: the owning
// Marketing staff (own campaigns only), any Marketing lead/head (division-wide), or a
// Director. OD is read-only; other divisions are denied.
func canManageCampaign(a permission.Actor, owner string) bool {
	if a.Role.Director {
		return true
	}
	if a.Role.Division != MarketingDivision {
		return false
	}
	if a.Role.Level == permission.LevelLead {
		return true
	}
	return a.Role.Level == permission.LevelStaff && a.EmployeeID == owner
}

// canReassign is the §5 Rule 3 / M3-OA-6 gate: ONLY a Marketing lead/head or a Director.
// Staff (even the owner) cannot reassign.
func canReassign(a permission.Actor) bool { return a.IsLead(MarketingDivision) }

// canViewCampaign is the §5 Rule 2/3/5 read gate: OD/Director (everywhere), Marketing
// lead/head (division-wide), and the owning Marketing staff (their own campaigns).
func canViewCampaign(a permission.Actor, owner string) bool {
	if a.CanReadDivision(MarketingDivision) { // Marketing lead, OD, Director
		return true
	}
	return a.Role.Division == MarketingDivision && a.EmployeeID == owner
}

// validateOwnerCandidate enforces that a reassignment target is an ACTIVE employee whose
// resolved CDPS division is Marketing (§5 Rule 1 "another Marketing Staff"). It mirrors
// the divisi+jabatan -> division join used by auth.ResolveActor and module6's AM check,
// without importing the auth layer. A candidate that does not resolve is reported as
// not-found (ErrNotFound) — no valid Marketing owner exists for that id.
func validateOwnerCandidate(ctx context.Context, tx *sql.Tx, ownerID string) error {
	var active int
	var division, level sql.NullString
	err := tx.QueryRowContext(ctx,
		`SELECT e.status_aktif, rm.division, rm.level
		   FROM employees e
		   LEFT JOIN role_mappings rm ON rm.divisi = e.divisi AND rm.jabatan = e.jabatan
		  WHERE e.employee_id = ?`, ownerID).Scan(&active, &division, &level)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if active != 1 || !division.Valid || division.String != MarketingDivision ||
		!level.Valid || level.String != permission.LevelStaff {
		return ErrNotFound
	}
	return nil
}

// closedEndDate returns the WIB calendar date to stamp as end_date when a Campaign
// reaches 'Closed' (§6.3 "Set on [Closed]"). Kept as a var so tests can inject a fixed
// clock; production uses time.Now.
var closedEndDate = func() string { return tz.DateString(time.Now()) }

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
