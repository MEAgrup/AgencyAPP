// This file implements the Optimization Log (M8 §6): any change to a LIVE Ad
// Campaign (budget / targeting / creative swap / schedule / other) is recorded as
// an immutable OPT- entry with before/after/reason/actor/timestamp (§9.5). This is
// NOT a Brief revision and never reopens the Brief's Kanban (§6 Rule 1) — the setup
// Brief already closed. Two rules beyond a plain log:
//
//   - §6 Rule 3 / M8-OA-3: a single budget adjustment >50% needs AM/SPV Ads sign-
//     off BEFORE applying. Implemented as an authority gate: only the Ads lead
//     (SPV Ads), the owning AM, or Director may record a >50% Budget change; a plain
//     Advertiser is blocked (must escalate). Below 50% the Advertiser acts freely
//     and the system just logs it.
//   - §6 Rule 3 / §7 Rule 3: a Creative Swap re-points the linkage table (unlink
//     old, link new) in the SAME transaction, so GMV from this point attributes to
//     the new Asset — prior GMV stays with the old one (via the per-entry snapshot).
package module8_ads

import (
	"context"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/ident"
	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// OptimizationInput carries a §9.5 Optimization Log entry. For a Creative Swap,
// OldAssetID / NewAssetID drive the linkage change; Before/After default to those
// IDs when left blank.
type OptimizationInput struct {
	ChangeType  string
	BeforeValue string
	AfterValue  string
	Reason      string
	OldAssetID  string // Creative Swap only
	NewAssetID  string // Creative Swap only
}

// Optimization is one recorded OPT- entry (returned to the caller).
type Optimization struct {
	ID          string    `json:"id"`
	CampaignID  string    `json:"campaign_id"`
	ChangeType  string    `json:"change_type"`
	BeforeValue string    `json:"before_value"`
	AfterValue  string    `json:"after_value"`
	Reason      string    `json:"reason"`
	Actor       string    `json:"actor"`
	CreatedAt   time.Time `json:"created_at"`
}

// LogOptimization records one Optimization entry (§6). Ads staff/lead (the
// Advertiser) or Director; the owning AM may also record one (the §6 sign-off path).
// A >50% Budget change requires AM/SPV-Ads authority (M8-OA-3); a Creative Swap
// atomically re-points the Asset linkage.
func (s *Service) LogOptimization(ctx context.Context, actor permission.Actor, campaignID string, in OptimizationInput) (Optimization, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Optimization{}, err
	}
	defer tx.Rollback()

	r, err := lockCampaign(ctx, tx, campaignID)
	if err != nil {
		return Optimization{}, err
	}
	// Base gate: the Advertiser (Ads staff/lead) or Director applies changes; the
	// owning AM may also record one (their sign-off, §6 Flow 1).
	if !canManageCampaign(actor) && actor.EmployeeID != r.ownerAM {
		return Optimization{}, ErrCampaignManageForbidden
	}

	changeType := strings.TrimSpace(in.ChangeType)
	if changeType == "" {
		return Optimization{}, ErrIncomplete
	}
	if !validChangeTypes[changeType] {
		return Optimization{}, ErrInvalidChangeType
	}

	before := strings.TrimSpace(in.BeforeValue)
	after := strings.TrimSpace(in.AfterValue)

	// Creative Swap: validate + re-point linkage before recording the entry.
	if changeType == "Creative Swap" {
		if strings.TrimSpace(in.OldAssetID) == "" || strings.TrimSpace(in.NewAssetID) == "" {
			return Optimization{}, ErrIncomplete
		}
		if before == "" {
			before = strings.TrimSpace(in.OldAssetID)
		}
		if after == "" {
			after = strings.TrimSpace(in.NewAssetID)
		}
	}
	if before == "" || after == "" || strings.TrimSpace(in.Reason) == "" {
		return Optimization{}, ErrIncomplete
	}

	// §6 Rule 3 / M8-OA-3: a single Budget adjustment >50% needs sign-off authority.
	if changeType == "Budget" {
		over, err := budgetChangeOver50(before, after)
		if err != nil {
			return Optimization{}, err
		}
		if over && !hasBudgetSignOff(actor, r.ownerAM) {
			return Optimization{}, ErrBudgetApprovalRequired
		}
	}

	if changeType == "Creative Swap" {
		if err := s.unlinkAssetTx(ctx, tx, actor, r, strings.TrimSpace(in.OldAssetID)); err != nil {
			return Optimization{}, err
		}
		if err := s.linkAssetTx(ctx, tx, actor, r, strings.TrimSpace(in.NewAssetID)); err != nil {
			return Optimization{}, err
		}
	}

	id, err := ident.Next(ctx, tx, "OPT", time.Now())
	if err != nil {
		return Optimization{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO optimization_logs
		   (id, campaign_id, change_type, before_value, after_value, reason, actor, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, campaignID, changeType, before, after, strings.TrimSpace(in.Reason), actor.EmployeeID, actor.EmployeeID); err != nil {
		return Optimization{}, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "ad_campaign", EntityID: campaignID, Actor: actor.EmployeeID, Action: "optimization_logged",
		After: map[string]any{"optimization_id": id, "change_type": changeType, "before": before, "after": after},
	}); err != nil {
		return Optimization{}, err
	}
	if err := tx.Commit(); err != nil {
		return Optimization{}, err
	}
	return Optimization{
		ID: id, CampaignID: campaignID, ChangeType: changeType, BeforeValue: before, AfterValue: after,
		Reason: strings.TrimSpace(in.Reason), Actor: actor.EmployeeID, CreatedAt: time.Now(),
	}, nil
}

// hasBudgetSignOff reports whether the actor may apply a >50% budget change
// (M8-OA-3): the Ads lead (SPV Ads), the owning AM, or Director.
func hasBudgetSignOff(a permission.Actor, ownerAM string) bool {
	if a.Role.Director {
		return true
	}
	if a.EmployeeID == ownerAM {
		return true
	}
	return a.Role.Division == AdsDivision && a.Role.Level == permission.LevelLead
}

// budgetChangeOver50 parses the before/after budget as money and reports whether
// the change magnitude exceeds 50% of the before value. A non-positive or
// unparseable before value is treated as >50% (a from-zero or unverifiable change
// needs sign-off) rather than silently allowed.
func budgetChangeOver50(before, after string) (bool, error) {
	b, err := money.Parse(before)
	if err != nil {
		return true, nil // unparseable "before" -> cannot verify below threshold -> gate
	}
	a, err := money.Parse(after)
	if err != nil {
		return false, ErrBadAmount
	}
	if b <= 0 {
		return true, nil
	}
	diff := int64(a) - int64(b)
	if diff < 0 {
		diff = -diff
	}
	// |after-before| / before > 0.5  <=>  2*|diff| > before
	return 2*diff > int64(b), nil
}
