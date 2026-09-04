// Package module2_marketing is Module 2 (Marketing). It owns the Marketing Performance
// Record — one per acquisition Campaign (CMP-), 1:1 with the Campaign entity (Module 3,
// M2 §2 / M3-OA-5). The Campaign holds identity + lifecycle + ownership + the
// Online/Offline checklist; THIS record holds the one Marketing input that is not on the
// Campaign — the budget — and exposes the read-only Auto-Metrics Engine (metrics.go).
//
// Everything Marketing is measured on is DERIVED on read (house rule #4), never stored:
//   - Lead-by-Dashboard   = COUNT leads with Origin Campaign = this campaign (M2 §4 r1).
//   - Lead-Real-by-Sales  = COUNT of those leads with >=1 attempt that reached Qualified.
//   - Lead-Quality Rate   = Real / Dashboard.
//   - Attributed Sales    = Σ won-deal value for leads whose LAST-TOUCH campaign = this
//     one (M2-OA-2 — deliberately last-touch, NOT the Origin used by M3's rollup), inside
//     the 3-month post-Close window (M3-OA-4).
//   - CPL / CPRL / ROAS   = Budget/Dashboard, Budget/Real, Attributed/Budget.
//   - Collected-ROAS      = verified-received / Budget (M2-OA-5, Module 5 Amount Verified).
//   - Junk breakdown      = Not-Qualified reason counts (Module 1) for this campaign's leads.
//
// Division-by-zero renders "—" (house rule #7). Module 2 emits NO notification event (the
// catalog is FROZEN, 15 events; M2 has none).
package module2_marketing

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/module3_campaign"
)

// Sentinel errors surfaced to the HTTP layer. Each carries a Bahasa Indonesia message
// that is VERBATIM from the PRD/house convention or reused from an existing module
// (CLAUDE.md convention 5). The one exception — ErrDuplicate — has no fitting existing
// string; its message is flagged as a NEW proposal in the cluster report (following the
// established "[<thing> untuk <entity> ini sudah ada]" pattern already in the codebase,
// e.g. "[permintaan pembayaran untuk booking ini sudah ada]", "[Strategy & Plan untuk
// layanan ini sudah ada]") for orchestrator sign-off.
var (
	// ErrIncomplete: a mandatory field is missing/invalid — PRD §3 Rule 4 / house default.
	// Budget missing, unparseable, or <= 0 all map here (M2 §3 Rule 3).
	ErrIncomplete = errors.New("[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]")
	// ErrNotFound: the Campaign / performance record does not exist (reuses the generic
	// existing string, matching module3_campaign.ErrNotFound).
	ErrNotFound = errors.New("[data tidak ditemukan]")
	// ErrForbidden: actor may not manage/view this record (reuses the generic existing
	// access-denial string, matching module3_campaign.ErrForbidden).
	ErrForbidden = errors.New("[anda tidak memiliki akses ke data ini]")
	// ErrDuplicate: a performance record already exists for this campaign (1:1, M3-OA-5).
	// PROPOSED NEW STRING — see report; no existing string fits without misnaming the entity.
	ErrDuplicate = errors.New("[performance record untuk campaign ini sudah ada]")
)

// Service is the M2 persistence surface. It reuses the Module 3 Campaign service for the
// Campaign existence + §5 visibility gate (staff own / lead+OD+Director all) and for the
// 1:1 read of Online/Offline — never duplicating that logic or those columns.
type Service struct {
	DB *sql.DB
	// Campaign is the Module 3 service used for the Campaign read/visibility gate. When
	// nil it is built on demand from DB (the M3 service is stateless apart from DB/Engine).
	Campaign *module3_campaign.Service
}

func (s *Service) campaign() *module3_campaign.Service {
	if s.Campaign != nil {
		return s.Campaign
	}
	return &module3_campaign.Service{DB: s.DB}
}

// Record is the Marketing Performance Record's stored projection (M2 §6.3 inputs only).
// Online/Offline are read from the 1:1 Campaign, not stored here.
type Record struct {
	CampaignID string `json:"campaign_id"`
	// Budget is the canonical DECIMAL string; BudgetIDR is the house display value.
	Budget    string `json:"budget"`
	BudgetIDR string `json:"budget_idr"`
	Online    bool   `json:"online"`
	Offline   bool   `json:"offline"`
	CreatedBy string `json:"created_by"`
}

// CreateRecord creates the 1:1 performance record for a Campaign (M2 §3). Gate: only the
// campaign OWNER (Marketing staff who owns it, or a Marketing lead who owns it) or a
// Director may create — a Marketing lead who does NOT own the campaign is read-only over
// staff records (M2 §5 Rule 3, "monitor, not edit"), and OD is read-only everywhere.
// Budget is mandatory and must parse to a positive IDR amount (M2 §3 Rule 3); an incomplete
// or non-positive budget is rejected with the house default BEFORE any row is written. A
// second record for the same campaign is rejected (1:1, M3-OA-5). The create is audited.
func (s *Service) CreateRecord(ctx context.Context, actor permission.Actor, campaignID, budget string) (Record, error) {
	// Campaign must exist and be visible to the actor (§5 gate, reused from M3 Get). This
	// propagates ErrNotFound (missing) / ErrForbidden (not visible) unchanged.
	c, err := s.campaign().Get(ctx, actor, campaignID)
	if err != nil {
		return Record{}, mapCampaignErr(err)
	}
	// Manage gate: owner or Director only (M2 §3 Rule 5 / §5 Rule 3).
	if !canManageRecord(actor, c.Owner) {
		return Record{}, ErrForbidden
	}
	// Budget mandatory, positive (M2 §3 Rule 3). money.Parse rejects blanks/garbage.
	amt, err := money.Parse(strings.TrimSpace(budget))
	if err != nil || amt <= 0 {
		return Record{}, ErrIncomplete
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Record{}, err
	}
	defer tx.Rollback()

	// 1:1 guard: reject a second record for the same campaign. The PK makes the INSERT
	// fail on duplicate; we probe first so the caller gets ErrDuplicate rather than a raw
	// driver error, and the audit row is only written on a real create.
	var exists int
	if err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM marketing_performance_records WHERE campaign_id = ?`, campaignID).
		Scan(&exists); err != nil {
		return Record{}, err
	}
	if exists > 0 {
		return Record{}, ErrDuplicate
	}

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO marketing_performance_records (campaign_id, budget, created_by)
		 VALUES (?, ?, ?)`,
		campaignID, amt.Decimal(), actor.EmployeeID); err != nil {
		return Record{}, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "marketing_performance_record", EntityID: campaignID, Actor: actor.EmployeeID,
		Action: "create", After: map[string]any{"budget": amt.Decimal()},
	}); err != nil {
		return Record{}, err
	}
	if err := tx.Commit(); err != nil {
		return Record{}, err
	}
	return Record{
		CampaignID: campaignID, Budget: amt.Decimal(), BudgetIDR: amt.Format(),
		Online: c.Online, Offline: c.Offline, CreatedBy: actor.EmployeeID,
	}, nil
}

// UpdateBudget edits the record's budget — an ordinary owner-gated field edit (M2 §3
// input), audited before->after (NOT a status). Same manage gate as CreateRecord. The new
// budget must parse to a positive IDR amount. The auto-metric fields are never editable
// (M2 §3 Rule 6) — only this one input.
func (s *Service) UpdateBudget(ctx context.Context, actor permission.Actor, campaignID, budget string) (Record, error) {
	c, err := s.campaign().Get(ctx, actor, campaignID)
	if err != nil {
		return Record{}, mapCampaignErr(err)
	}
	if !canManageRecord(actor, c.Owner) {
		return Record{}, ErrForbidden
	}
	amt, err := money.Parse(strings.TrimSpace(budget))
	if err != nil || amt <= 0 {
		return Record{}, ErrIncomplete
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Record{}, err
	}
	defer tx.Rollback()

	var before string
	err = tx.QueryRowContext(ctx,
		`SELECT budget FROM marketing_performance_records WHERE campaign_id = ? FOR UPDATE`, campaignID).
		Scan(&before)
	if errors.Is(err, sql.ErrNoRows) {
		return Record{}, ErrNotFound
	}
	if err != nil {
		return Record{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE marketing_performance_records SET budget = ? WHERE campaign_id = ?`,
		amt.Decimal(), campaignID); err != nil {
		return Record{}, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "marketing_performance_record", EntityID: campaignID, Actor: actor.EmployeeID,
		Action: "budget_edited",
		Before: map[string]any{"budget": before},
		After:  map[string]any{"budget": amt.Decimal()},
	}); err != nil {
		return Record{}, err
	}
	if err := tx.Commit(); err != nil {
		return Record{}, err
	}
	return Record{
		CampaignID: campaignID, Budget: amt.Decimal(), BudgetIDR: amt.Format(),
		Online: c.Online, Offline: c.Offline, CreatedBy: actor.EmployeeID,
	}, nil
}

// GetRecord returns the stored record (budget + the 1:1 Online/Offline) if the actor may
// view the campaign (§5 read gate). Missing campaign -> ErrNotFound; missing record ->
// ErrNotFound; not visible -> ErrForbidden.
func (s *Service) GetRecord(ctx context.Context, actor permission.Actor, campaignID string) (Record, error) {
	c, err := s.campaign().Get(ctx, actor, campaignID)
	if err != nil {
		return Record{}, mapCampaignErr(err)
	}
	rec, err := s.loadRecord(ctx, campaignID)
	if err != nil {
		return Record{}, err
	}
	rec.Online, rec.Offline = c.Online, c.Offline
	return rec, nil
}

// loadRecord reads the stored budget row (no visibility check — callers gate first).
func (s *Service) loadRecord(ctx context.Context, campaignID string) (Record, error) {
	var dec, createdBy string
	err := s.DB.QueryRowContext(ctx,
		`SELECT budget, created_by FROM marketing_performance_records WHERE campaign_id = ?`, campaignID).
		Scan(&dec, &createdBy)
	if errors.Is(err, sql.ErrNoRows) {
		return Record{}, ErrNotFound
	}
	if err != nil {
		return Record{}, err
	}
	amt, err := money.Parse(dec)
	if err != nil {
		return Record{}, err
	}
	return Record{CampaignID: campaignID, Budget: amt.Decimal(), BudgetIDR: amt.Format(), CreatedBy: createdBy}, nil
}

// canManageRecord is the M2 write gate (create/edit budget). The performance record is
// owned by the Campaign owner (M2 §3 Rule 5): the owning Marketing employee (staff OR a
// lead who owns that campaign) may edit; any OTHER Marketing lead is read-only over the
// record (M2 §5 Rule 3, "monitor, not edit"); OD is read-only; a Director has full access.
// This is the M3 canManageCampaign pattern MINUS the "any lead division-wide" write branch,
// because M2 §5 Rule 3 explicitly makes the lead dashboard read-only over staff records
// (PRD wins — see cluster report).
func canManageRecord(a permission.Actor, campaignOwner string) bool {
	if a.Role.Director {
		return true
	}
	if a.Role.Division != module3_campaign.MarketingDivision {
		return false
	}
	return a.EmployeeID == campaignOwner
}

// mapCampaignErr translates the M3 Campaign sentinels into the M2 sentinels so callers see
// a single error set with identical BI messages (the strings are byte-identical).
func mapCampaignErr(err error) error {
	switch {
	case errors.Is(err, module3_campaign.ErrNotFound):
		return ErrNotFound
	case errors.Is(err, module3_campaign.ErrForbidden):
		return ErrForbidden
	case errors.Is(err, module3_campaign.ErrIncomplete):
		return ErrIncomplete
	default:
		return err
	}
}
