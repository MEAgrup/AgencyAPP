// This file implements Creative-Asset linkage (M8 §4 Rule 2): before launch the
// Advertiser links which approved Creative Asset(s) (AST-, M7) are used as the ad
// creative, filtered to the campaign's Client/Service. A campaign may link
// multiple Assets (A/B testing two videos, §4 Rule 2). The linkage carries a
// PERIOD (linked_at / unlinked_at) so a mid-campaign Creative Swap (§6 Rule 3 / §7
// Rule 3) is representable and attribution can follow it: a swapped-out Asset keeps
// the GMV it already accrued, the new Asset gets GMV from the swap onward — which
// falls out naturally from the per-metric-entry linked-Asset snapshot (metrics.go).
package module8_ads

import (
	"context"
	"database/sql"
	"errors"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// LinkAsset links an approved Creative Asset to an Ad Campaign (§4 Rule 2). Ads
// staff/lead or Director. The Asset must exist, belong to the SAME Client as the
// campaign (the §4 Rule 2 filter), be [Approved] (§4 Rule 2 / §12), and not already
// be currently linked.
func (s *Service) LinkAsset(ctx context.Context, actor permission.Actor, campaignID, assetID string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	r, err := lockCampaign(ctx, tx, campaignID)
	if err != nil {
		return err
	}
	if !canManageCampaign(actor) {
		return ErrCampaignManageForbidden
	}
	if err := s.linkAssetTx(ctx, tx, actor, r, assetID); err != nil {
		return err
	}
	return tx.Commit()
}

// linkAssetTx performs the validated link inside an existing transaction (shared by
// LinkAsset and the Creative-Swap optimization).
func (s *Service) linkAssetTx(ctx context.Context, tx *sql.Tx, actor permission.Actor, r campaignRow, assetID string) error {
	assetClient, assetStatus, err := assetClientAndStatus(ctx, tx, assetID)
	if err != nil {
		return err
	}
	if assetClient != r.clientID {
		return ErrAssetWrongClient
	}
	if assetStatus != assetStatusApproved {
		return ErrAssetNotApproved
	}
	var n int
	if err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM ad_campaign_assets WHERE campaign_id = ? AND asset_id = ? AND unlinked_at IS NULL`,
		r.id, assetID).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return ErrAssetAlreadyLinked
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO ad_campaign_assets (campaign_id, asset_id, created_by) VALUES (?, ?, ?)`,
		r.id, assetID, actor.EmployeeID); err != nil {
		return err
	}
	return audit.Write(ctx, tx, audit.Record{
		EntityType: "ad_campaign", EntityID: r.id, Actor: actor.EmployeeID, Action: "asset_linked",
		After: map[string]any{"asset_id": assetID},
	})
}

// UnlinkAsset removes a currently-linked Asset from an Ad Campaign (sets
// unlinked_at — the linkage row is never deleted, house rule 3). Ads staff/lead or
// Director. From this point the Asset no longer appears in new Metric-Entry
// snapshots, so it accrues no further Attributed GMV (§7 Rule 3).
func (s *Service) UnlinkAsset(ctx context.Context, actor permission.Actor, campaignID, assetID string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	r, err := lockCampaign(ctx, tx, campaignID)
	if err != nil {
		return err
	}
	if !canManageCampaign(actor) {
		return ErrCampaignManageForbidden
	}
	if err := s.unlinkAssetTx(ctx, tx, actor, r, assetID); err != nil {
		return err
	}
	return tx.Commit()
}

// unlinkAssetTx performs the validated unlink inside an existing transaction.
func (s *Service) unlinkAssetTx(ctx context.Context, tx *sql.Tx, actor permission.Actor, r campaignRow, assetID string) error {
	res, err := tx.ExecContext(ctx,
		`UPDATE ad_campaign_assets SET unlinked_at = NOW()
		  WHERE campaign_id = ? AND asset_id = ? AND unlinked_at IS NULL`,
		r.id, assetID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrAssetNotLinked
	}
	return audit.Write(ctx, tx, audit.Record{
		EntityType: "ad_campaign", EntityID: r.id, Actor: actor.EmployeeID, Action: "asset_unlinked",
		After: map[string]any{"asset_id": assetID},
	})
}

// assetClientAndStatus returns the Client an Asset belongs to (via Brief -> Service
// -> Client) and its current status. A missing Asset is ErrAssetNotFound.
func assetClientAndStatus(ctx context.Context, tx *sql.Tx, assetID string) (clientID, status string, err error) {
	err = tx.QueryRowContext(ctx,
		`SELECT sv.client_id, a.status
		   FROM assets a
		   JOIN briefs b ON b.id = a.brief_id
		   JOIN services sv ON sv.id = b.service_id
		  WHERE a.id = ?`, assetID).Scan(&clientID, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", ErrAssetNotFound
	}
	if err != nil {
		return "", "", err
	}
	return clientID, status, nil
}

// currentlyLinkedAssets returns the Asset IDs currently linked to a campaign
// (unlinked_at IS NULL), ordered for determinism.
func currentlyLinkedAssets(ctx context.Context, q interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}, campaignID string) ([]string, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT asset_id FROM ad_campaign_assets
		  WHERE campaign_id = ? AND unlinked_at IS NULL ORDER BY asset_id`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
