// Package module8_ads is Module 8 (Ads). It introduces the Ad Campaign (ADC-),
// the CLIENT's ongoing paid-media record (M8 §2) — distinct from Module 3's own
// lead-gen Campaign (CMP-). The clean line this module draws:
//
//   - The setup Brief (a Brief-as-task on the §7 machine, driven by M12/M6) closes
//     once Ads proves the campaign was launched correctly per the brief. That is
//     the ONE-TIME setup phase; its Speed KPI is computed by Module 12 (§8 Rule 1).
//   - The Ad Campaign (ADC-) keeps LIVING after the Brief closes: periodic Metric
//     Entries (MTR-, §5), an Optimization Log (OPT-, §6), and attribution feedback
//     that writes Attributed GMV back onto the specific Creative Asset that drove
//     it (§7), closing the loop opened in M7 §8.
//
// Division of responsibility:
//   - This package owns the ADC entity + its child rows and their rules.
//   - The setup Brief's lifecycle/metrics stay in M6 (review) + M12 (execution +
//     Speed KPI). M8 only adds a submit GUARD (M8 §4 Rule 3) into M12 so an Ads
//     Brief cannot be submitted before its Ad Campaign is complete.
//
// House rules honoured here (CLAUDE.md #3/#4/#7):
//   - the ADC-/MTR-/OPT- ids are minted (ident.Next) ONLY after mandatory-field
//     validation passes (house rule 1);
//   - the ADC birth status [Paused] is set at INSERT (a creation, not a
//     transition); every later status move goes through the transition engine
//     (STATE_MACHINES §14), never a raw UPDATE (house rule 2);
//   - Total Spend / Total GMV / ROAS and each Asset's Attributed GMV are DERIVED
//     from the immutable Metric-Entry rows + the per-entry linked-Asset snapshot,
//     never stored as mutable running columns (house rules 3/4). Division-by-zero
//     in ROAS renders "—", money renders "Rp. X.XXX.XXX,00" (house rule 7).
package module8_ads

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/ident"
	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// CDPS divisions this module reasons about.
const (
	// AdsDivision is the division that owns Ad Campaigns (DECISIONS 2026-07-12:
	// HRIS ADVERTISER -> divisi Ads). Both Marketplace and Social Advertisers map
	// here; the Marketplace/Social distinction lives on the ADC Platform field,
	// not the CDPS division model.
	AdsDivision = "Ads"
	// AccountDivision is the client-owning division; its lead (SPV/Head Account)
	// reads cross-division and every AM owns their assigned clients.
	AccountDivision = "Account"
	// CreativeDivision owns the Assets an Ad Campaign links (read-only from Ads).
	CreativeDivision = "Creative"
)

// Ad Campaign statuses — the ad_campaign machine (STATE_MACHINES §14). Exactly
// three (§9.3); born [Paused] (held, no real spend until launched).
const (
	StatusPaused = "[Paused]"
	StatusActive = "[Active]"
	StatusEnded  = "[Ended]"
)

// Statuses referenced on foreign entities (the Launch dependency, §4 / §12).
const (
	briefStatusInProgress = "[In Progress]"
	briefStatusApproved   = "[Approved]"
	assetStatusApproved   = "[Approved]"
)

// Platform enum (§9.3).
var validPlatforms = map[string]bool{
	"Shopee Ads":      true,
	"TikTok Shop Ads": true,
	"Social Ads":      true,
}

// Entry-method enum (§9.4).
var validEntryMethods = map[string]bool{
	"Manual":      true,
	"File Export": true,
}

// Change-type enum (§9.5).
var validChangeTypes = map[string]bool{
	"Budget":        true,
	"Targeting":     true,
	"Creative Swap": true,
	"Schedule":      true,
	"Other":         true,
}

// Sentinel errors carrying the exact Bahasa Indonesia message (house rule 5). One
// string is quoted VERBATIM from the PRD (ErrCampaignIncompleteForSubmit, §4 Rule
// 3); the rest are NEW (W1-09 precedent) and are listed in DECISIONS.md / the
// ticket report for orchestrator sign-off.
var (
	// ErrIncomplete: a mandatory field is missing (house-convention default).
	ErrIncomplete = errors.New("[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]")
	// ErrBriefNotFound: the parent Brief does not exist (reuses the M6/M7 string).
	ErrBriefNotFound = errors.New("[brief tidak ditemukan]")
	// ErrCampaignNotFound: the referenced Ad Campaign does not exist.
	ErrCampaignNotFound = errors.New("[kampanye iklan tidak ditemukan]")
	// ErrCampaignViewForbidden: actor may not read this Ad Campaign (§9.1 read gate).
	ErrCampaignViewForbidden = errors.New("[anda tidak memiliki akses ke kampanye iklan ini]")
	// ErrCampaignManageForbidden: actor may not create/edit this Ad Campaign, log
	// metrics or apply optimizations (Ads staff/lead or Director only, §9.1).
	ErrCampaignManageForbidden = errors.New("[anda tidak memiliki akses untuk mengelola kampanye iklan ini]")
	// ErrNotAdsBrief: the parent Brief is not an Ads Brief, so it has no Ad Campaign.
	ErrNotAdsBrief = errors.New("[brief ini bukan brief divisi Ads]")
	// ErrBriefNotInProgress: an Ad Campaign is created only while the parent Brief
	// is [In Progress] (§4 Rule 1).
	ErrBriefNotInProgress = errors.New("[kampanye iklan hanya dapat dibuat saat brief berstatus In Progress]")
	// ErrInvalidPlatform: Platform is not one of the §9.3 choices.
	ErrInvalidPlatform = errors.New("[platform tidak valid]")
	// ErrInvalidCampaignDates: End Date precedes Start Date (§9.3).
	ErrInvalidCampaignDates = errors.New("[tanggal mulai dan selesai kampanye tidak valid]")
	// ErrAssetNotFound: a Creative Asset to link does not exist.
	ErrAssetNotFound = errors.New("[aset kreatif tidak ditemukan]")
	// ErrAssetNotApproved: a linked Creative Asset must be [Approved] first (§4 Rule 2).
	ErrAssetNotApproved = errors.New("[aset kreatif harus disetujui sebelum ditautkan]")
	// ErrAssetWrongClient: the Asset belongs to a different Client/Service (§4 Rule 2 filter).
	ErrAssetWrongClient = errors.New("[aset kreatif bukan milik klien layanan ini]")
	// ErrAssetAlreadyLinked: the Asset is already currently linked to this campaign.
	ErrAssetAlreadyLinked = errors.New("[aset kreatif sudah ditautkan ke kampanye ini]")
	// ErrAssetNotLinked: the Asset is not currently linked to this campaign.
	ErrAssetNotLinked = errors.New("[aset kreatif tidak tertaut ke kampanye ini]")
	// ErrCampaignIncompleteForSubmit: VERBATIM PRD §4 Rule 3 — the setup Brief
	// cannot be submitted until its Ad Campaign(s) exist with platform/budget/
	// creative-asset filled.
	ErrCampaignIncompleteForSubmit = errors.New("[campaign belum lengkap, lengkapi platform/budget/aset kreatif sebelum submit]")
	// ErrLaunchBriefNotApproved: cannot launch until the setup Brief is [Approved]
	// (§4 Flow 2).
	ErrLaunchBriefNotApproved = errors.New("[kampanye belum dapat diluncurkan, brief setup belum disetujui]")
	// ErrLaunchAssetsNotApproved: cannot launch until every currently-linked Asset
	// is [Approved], and at least one Asset is linked (§4 Rule 2 / §12 hardcoded).
	ErrLaunchAssetsNotApproved = errors.New("[kampanye belum dapat diluncurkan, aset kreatif tertaut harus disetujui]")
	// ErrInvalidEntryMethod: Entry Method is not Manual / File Export (§9.4).
	ErrInvalidEntryMethod = errors.New("[metode input tidak valid]")
	// ErrNegativeAmount: Spend / GMV must not be negative (§5).
	ErrNegativeAmount = errors.New("[nilai spend dan GMV tidak boleh negatif]")
	// ErrInvalidPeriod: a Metric Entry's period end precedes its start (§9.4).
	ErrInvalidPeriod = errors.New("[periode metrik tidak valid]")
	// ErrInvalidChangeType: Change Type is not one of the §9.5 choices.
	ErrInvalidChangeType = errors.New("[jenis perubahan tidak valid]")
	// ErrBudgetApprovalRequired: a single budget adjustment >50% needs AM/SPV Ads
	// sign-off before applying (§6 Rule 3 / M8-OA-3) — a plain Advertiser is blocked.
	ErrBudgetApprovalRequired = errors.New("[penyesuaian budget lebih dari 50% memerlukan persetujuan AM/SPV Ads]")
	// ErrBadAmount: a money field could not be parsed.
	ErrBadAmount = errors.New("[nilai uang tidak valid]")
)

// Service is the M8 persistence surface.
type Service struct {
	DB     *sql.DB
	Engine *statemachine.Engine
	// Catalog is the FROZEN notification catalog (Phase 0 v2 §9). Module 8 Cluster 1
	// emits NOTHING: no cataloged event covers Ad Campaign lifecycle, metric entry,
	// optimization, or the M8-OA-5 ROAS-underperformance escalation — adding one
	// unilaterally is forbidden (W1-16 precedent). Kept for symmetry / future wiring.
	Catalog *notification.Catalog
}

func (s *Service) engine() *statemachine.Engine {
	if s.Engine != nil {
		return s.Engine
	}
	return statemachine.New()
}

// CampaignInput carries the caller-supplied §9.3 fields. Client ID and Status are
// NOT here — the client is inherited via Brief -> Service, and the status is born
// [Paused].
type CampaignInput struct {
	Platform  string
	Objective string
	Budget    string // decimal string, e.g. "8000000" or "8000000.00"
	StartDate string // "YYYY-MM-DD"
	EndDate   string // "YYYY-MM-DD"
	TargetKPI string // ROAS/GMV target or Spend cap (§9.3)
}

// CreateCampaign creates an Ad Campaign under an Ads Brief (§4 Rule 1). Creatable
// while the parent Brief is [In Progress], by the Ads division's staff/lead (the
// assigned Advertiser or the Ads Team Leader) or Director. Born [Paused] (held, no
// real spend until launched). One Brief can spawn multiple campaigns (§2).
func (s *Service) CreateCampaign(ctx context.Context, actor permission.Actor, briefID string, in CampaignInput) (Campaign, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Campaign{}, err
	}
	defer tx.Rollback()

	var division, status, clientID string
	err = tx.QueryRowContext(ctx,
		`SELECT b.assigned_division, b.status, sv.client_id
		   FROM briefs b
		   JOIN services sv ON sv.id = b.service_id
		  WHERE b.id = ? FOR UPDATE`, briefID).Scan(&division, &status, &clientID)
	if errors.Is(err, sql.ErrNoRows) {
		return Campaign{}, ErrBriefNotFound
	}
	if err != nil {
		return Campaign{}, err
	}
	if division != AdsDivision {
		return Campaign{}, ErrNotAdsBrief
	}
	if status != briefStatusInProgress {
		return Campaign{}, ErrBriefNotInProgress
	}
	if !canManageCampaign(actor) {
		return Campaign{}, ErrCampaignManageForbidden
	}

	// §9.3 mandatory fields.
	platform := strings.TrimSpace(in.Platform)
	objective := strings.TrimSpace(in.Objective)
	targetKPI := strings.TrimSpace(in.TargetKPI)
	if platform == "" || objective == "" || targetKPI == "" ||
		strings.TrimSpace(in.Budget) == "" || strings.TrimSpace(in.StartDate) == "" || strings.TrimSpace(in.EndDate) == "" {
		return Campaign{}, ErrIncomplete
	}
	if !validPlatforms[platform] {
		return Campaign{}, ErrInvalidPlatform
	}
	budget, err := money.Parse(in.Budget)
	if err != nil || budget <= 0 {
		return Campaign{}, ErrIncomplete
	}
	start, end, err := parseDateRange(in.StartDate, in.EndDate)
	if err != nil {
		return Campaign{}, ErrInvalidCampaignDates
	}

	id, err := ident.Next(ctx, tx, "ADC", time.Now())
	if err != nil {
		return Campaign{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO ad_campaigns
		   (id, brief_id, client_id, platform, objective, budget, start_date, end_date, target_kpi, status, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, briefID, clientID, platform, objective, budget.Decimal(), start, end, targetKPI, StatusPaused, actor.EmployeeID); err != nil {
		return Campaign{}, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "ad_campaign", EntityID: id, Actor: actor.EmployeeID, Action: "create",
		After: map[string]any{"status": StatusPaused, "brief_id": briefID, "client_id": clientID, "platform": platform, "budget": budget.Decimal()},
	}); err != nil {
		return Campaign{}, err
	}
	if err := tx.Commit(); err != nil {
		return Campaign{}, err
	}
	return Campaign{
		ID: id, BriefID: briefID, ClientID: clientID, Platform: platform, Objective: objective,
		Budget: float64(budget) / 100, BudgetDisplay: budget.Format(), StartDate: start, EndDate: end,
		TargetKPI: targetKPI, Status: StatusPaused, CreatedBy: actor.EmployeeID, CreatedAt: time.Now(),
	}, nil
}

// canManageCampaign is the §9.1 write gate for the Ad Campaign and its metrics/
// optimizations: the Ads division's staff (Advertiser) or lead (Ads Team Leader),
// or Director. The AM reviews the setup Brief (M6) and reads live performance, but
// does not create campaigns or log metrics; OD is read-only.
func canManageCampaign(a permission.Actor) bool {
	if a.Role.Director {
		return true
	}
	return a.Role.Division == AdsDivision &&
		(a.Role.Level == permission.LevelStaff || a.Role.Level == permission.LevelLead)
}

// canViewCampaign is the §9.1 read predicate: OD/Director (everywhere); Account
// lead / SPV (division-wide); the owning AM (their clients); and the Ads division's
// staff/lead (their campaigns). Creative's read-only view of linked/attributed
// Assets is served on the Creative side (M7 §8), not on the full ADC record.
func canViewCampaign(a permission.Actor, ownerAM string) bool {
	if a.CanReadAll() { // OD / Director
		return true
	}
	if a.CanReadDivision(AccountDivision) { // Account lead / SPV
		return true
	}
	if a.EmployeeID == ownerAM { // owning AM
		return true
	}
	return a.Role.Division == AdsDivision &&
		(a.Role.Level == permission.LevelStaff || a.Role.Level == permission.LevelLead)
}

// campaignRow is the slim locked projection the gates need.
type campaignRow struct {
	id        string
	briefID   string
	clientID  string
	status    string
	targetKPI string
	ownerAM   string
}

// lockCampaign row-locks an Ad Campaign and joins up to the owning AM for the read/
// write predicates. A missing row is ErrCampaignNotFound.
func lockCampaign(ctx context.Context, tx *sql.Tx, id string) (campaignRow, error) {
	var r campaignRow
	var owner sql.NullString
	err := tx.QueryRowContext(ctx,
		`SELECT c.id, c.brief_id, c.client_id, c.status, c.target_kpi, cl.assigned_am_id
		   FROM ad_campaigns c
		   JOIN clients cl ON cl.id = c.client_id
		  WHERE c.id = ? FOR UPDATE`, id).
		Scan(&r.id, &r.briefID, &r.clientID, &r.status, &r.targetKPI, &owner)
	if errors.Is(err, sql.ErrNoRows) {
		return campaignRow{}, ErrCampaignNotFound
	}
	if err != nil {
		return campaignRow{}, err
	}
	r.ownerAM = owner.String
	return r, nil
}

// parseDateRange validates two "YYYY-MM-DD" dates and that end >= start, returning
// them normalised as strings for the DATE columns.
func parseDateRange(startStr, endStr string) (string, string, error) {
	start, err := time.Parse("2006-01-02", strings.TrimSpace(startStr))
	if err != nil {
		return "", "", err
	}
	end, err := time.Parse("2006-01-02", strings.TrimSpace(endStr))
	if err != nil {
		return "", "", err
	}
	if end.Before(start) {
		return "", "", errors.New("end before start")
	}
	return start.Format("2006-01-02"), end.Format("2006-01-02"), nil
}

// ValidateBriefSubmit is the module12_task.BriefSubmitGuard implementation (§4 Rule
// 3): an Ads Brief cannot be submitted until at least one Ad Campaign exists for it
// WITH a currently-linked Creative Asset (platform/budget are NOT-NULL columns, so
// a campaign row already guarantees them). It runs inside the M12 submit
// transaction; a non-Ads division is a no-op. Blocks with the VERBATIM PRD string.
func (s *Service) ValidateBriefSubmit(ctx context.Context, tx *sql.Tx, briefID, division string) error {
	if division != AdsDivision {
		return nil
	}
	var n int
	if err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*)
		   FROM ad_campaigns c
		   JOIN ad_campaign_assets a ON a.campaign_id = c.id AND a.unlinked_at IS NULL
		  WHERE c.brief_id = ?`, briefID).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		return ErrCampaignIncompleteForSubmit
	}
	return nil
}
