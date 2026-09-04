// This file implements the Ad Campaign lifecycle (STATE_MACHINES §14 / M8 §2):
// [Paused] <-> [Active] -> [Ended]. Every move goes through the transition engine
// (house rule 2). The [Paused]->[Active] Launch/Resume edge carries a CODE guard
// the engine cannot express — the parent Brief must be [Approved] and every
// currently-linked Creative Asset must be [Approved] (the built-in implicit
// dependency, §12 hardcoded; §4 Flow 2 "real spend begins" on approval). Pause /
// resume / end need no approval gate (routine optimization is visibility-only, §6
// Rule 3), so the code gate is simply canManageCampaign (Ads staff/lead/Director).
package module8_ads

import (
	"context"
	"database/sql"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// LaunchCampaign drives an Ad Campaign [Paused] -> [Active], beginning real spend
// (§4 Flow 2). Gated: the setup Brief must be [Approved] and at least one linked
// Creative Asset must exist and all currently-linked Assets be [Approved] (§12).
func (s *Service) LaunchCampaign(ctx context.Context, actor permission.Actor, campaignID string) (statemachine.Result, error) {
	return s.activate(ctx, actor, campaignID)
}

// ResumeCampaign drives a paused campaign back to [Active] (§6 Rule 1 pause/resume).
// Same edge and guard as Launch — the Brief/Assets are already [Approved] by then.
func (s *Service) ResumeCampaign(ctx context.Context, actor permission.Actor, campaignID string) (statemachine.Result, error) {
	return s.activate(ctx, actor, campaignID)
}

func (s *Service) activate(ctx context.Context, actor permission.Actor, campaignID string) (statemachine.Result, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return statemachine.Result{}, err
	}
	defer tx.Rollback()

	r, err := lockCampaign(ctx, tx, campaignID)
	if err != nil {
		return statemachine.Result{}, err
	}
	if !canManageCampaign(actor) {
		return statemachine.Result{}, ErrCampaignManageForbidden
	}
	// §4 Flow 2 / §12: the setup Brief must be [Approved].
	var briefStatus string
	if err := tx.QueryRowContext(ctx, `SELECT status FROM briefs WHERE id = ?`, r.briefID).Scan(&briefStatus); err != nil {
		return statemachine.Result{}, err
	}
	if briefStatus != briefStatusApproved {
		return statemachine.Result{}, ErrLaunchBriefNotApproved
	}
	// §4 Rule 2 / §12: at least one linked Asset, and every currently-linked Asset
	// must be [Approved].
	ok, err := allLinkedAssetsApproved(ctx, tx, r.id)
	if err != nil {
		return statemachine.Result{}, err
	}
	if !ok {
		return statemachine.Result{}, ErrLaunchAssetsNotApproved
	}
	res, err := s.engine().Transition(ctx, tx, statemachine.Request{
		Machine: statemachine.MAdCampaign, EntityType: "ad_campaign", Table: "ad_campaigns",
		EntityID: campaignID, To: StatusActive, Actor: actor,
	})
	if err != nil {
		return statemachine.Result{}, err
	}
	if err := tx.Commit(); err != nil {
		return statemachine.Result{}, err
	}
	return res, nil
}

// PauseCampaign drives [Active] -> [Paused] (held, e.g. while the setup Brief is in
// revision, or a routine pause optimization). Ads staff/lead or Director.
func (s *Service) PauseCampaign(ctx context.Context, actor permission.Actor, campaignID string) (statemachine.Result, error) {
	return s.driveLifecycle(ctx, actor, campaignID, StatusPaused)
}

// EndCampaign drives a campaign to [Ended] (end date reached, budget exhausted, or
// manually stopped, §2). Allowed from [Active] or [Paused]; terminal. Ads staff/
// lead or Director.
func (s *Service) EndCampaign(ctx context.Context, actor permission.Actor, campaignID string) (statemachine.Result, error) {
	return s.driveLifecycle(ctx, actor, campaignID, StatusEnded)
}

// driveLifecycle is the shared gated engine driver for the ungated Ad Campaign
// edges (Pause / End). A wrong source state is rejected by the engine.
func (s *Service) driveLifecycle(ctx context.Context, actor permission.Actor, campaignID, to string) (statemachine.Result, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return statemachine.Result{}, err
	}
	defer tx.Rollback()

	if _, err := lockCampaign(ctx, tx, campaignID); err != nil {
		return statemachine.Result{}, err
	}
	if !canManageCampaign(actor) {
		return statemachine.Result{}, ErrCampaignManageForbidden
	}
	res, err := s.engine().Transition(ctx, tx, statemachine.Request{
		Machine: statemachine.MAdCampaign, EntityType: "ad_campaign", Table: "ad_campaigns",
		EntityID: campaignID, To: to, Actor: actor,
	})
	if err != nil {
		return statemachine.Result{}, err
	}
	if err := tx.Commit(); err != nil {
		return statemachine.Result{}, err
	}
	return res, nil
}

// allLinkedAssetsApproved reports whether a campaign has at least one currently-
// linked Asset AND every currently-linked Asset is [Approved] (§4 Rule 2 / §12).
func allLinkedAssetsApproved(ctx context.Context, tx *sql.Tx, campaignID string) (bool, error) {
	var total, approved int
	err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*),
		        COALESCE(SUM(CASE WHEN a.status = ? THEN 1 ELSE 0 END), 0)
		   FROM ad_campaign_assets aca
		   JOIN assets a ON a.id = aca.asset_id
		  WHERE aca.campaign_id = ? AND aca.unlinked_at IS NULL`,
		assetStatusApproved, campaignID).Scan(&total, &approved)
	if err != nil {
		return false, err
	}
	return total > 0 && total == approved, nil
}
