// campaign_link.go — Module 3 (Campaign) linkage for the M1 intake doors
// (W3-M3-C2). It closes the scoped deferral recorded in bulk.go's header: when a
// lead is registered/imported UNDER a Campaign, this file supplies the three
// linkage effects the deferral held back:
//
//  1. Import gate (O13, override of the old block-only default): a Campaign in
//     Draft/Paused is AUTO-ACTIVATED (+audit) so the import proceeds — teams often
//     forget to switch a Campaign on and a lead must never be lost. A Campaign the
//     engine cannot legally move to Active (Closed/Archived — no such edge in the
//     campaign machine) BLOCKS the intake with the verbatim STATE_MACHINES §2 /
//     M3 §3 Rule 5 message. A missing Campaign is rejected as not-found.
//
//  2. Source auto-set from Channel (M3 §2, closes M1-OA-3): a campaign-scoped
//     intake derives Lead.Source from the Campaign's Channel. Campaign-derived
//     Source WINS over any Source the row carried (M3 §2 "Channel drives the
//     Source auto-set on every lead imported under it" — see report/DECISIONS).
//
//  3. Origin / Last-Touch (M1 §5, §9.3):
//     - a NEW lead born under a Campaign gets origin_campaign_id = that Campaign
//     (IMMUTABLE — set once, never rewritten) AND last_touch_campaign_id = it
//     (set at INSERT in leads.go / bulk.go, not here).
//     - a campaign-scoped intake that TOUCHES an existing lead updates ONLY
//     last_touch_campaign_id (never origin), the non-destructive "most recent
//     Campaign to touch this lead" field. Triggers: a reopen, a co-pursuit join,
//     or a block-as-Pool-duplicate (M1 §5's named case) under a Campaign
//     different from the one already on file.
package module1_leads

import (
	"context"
	"database/sql"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// Campaign statuses — mirrored verbatim from module3_campaign / STATE_MACHINES §3
// (the engine stores these labels WITHOUT brackets). Kept as local constants
// following the established precedent (module0_sales mirrors the M5 scheme strings
// with a "verbatim and identical" note) so module1 needs no cross-module import.
const (
	campaignStatusDraft    = "Draft"
	campaignStatusActive   = "Active"
	campaignStatusPaused   = "Paused"
	campaignStatusClosed   = "Closed"
	campaignStatusArchived = "Archived"
)

// BI messages for the campaign gate.
const (
	// MsgCampaignNotActive is VERBATIM from STATE_MACHINES §2 ("Import gate") /
	// M3 §3 Rule 5 — the import gate rejection when the Campaign cannot accept
	// leads (Closed/Archived: no legal edge to Active).
	MsgCampaignNotActive = "[campaign belum/tidak aktif, lead tidak bisa diimport]"
	// MsgCampaignNotFound reuses the generic existing not-found string (same
	// wording module3_campaign.ErrNotFound and the leads HTTP layer already use);
	// no new BI string is introduced.
	MsgCampaignNotFound = "[data tidak ditemukan]"
)

// channelToSource maps a known Campaign Channel to an M1 Source-list value
// (M1 §4 Rule 3 list). M3-OA-2 keeps the taxonomy free-text and INCREMENTAL —
// mappings are added as new Channels come up, not fixed upfront — so this table
// carries only the PRD-confirmed entry and anything unmapped falls back to the
// Channel string as-is (leads.source is a free VARCHAR with no enum, so the
// fallback is always storable).
//
// PRD-confirmed: "TikTok Ads" -> "Leads - Iklan" (M3 §3/§8 worked examples:
// "the 46 imported leads auto-get Source = Leads - Iklan from the TikTok-Ads
// channel").
var channelToSource = map[string]string{
	"TikTok Ads": "Leads - Iklan",
}

// deriveSource returns the M1 Source for a campaign Channel (M3 §2 / M1-OA-3):
// the mapped value when known, else the Channel string verbatim (free-text
// fallback, M3-OA-2).
func deriveSource(channel string) string {
	if s, ok := channelToSource[channel]; ok {
		return s
	}
	return channel
}

// resolveCampaignForIntake enforces the import gate (O13) for a campaign-scoped
// intake and returns the Channel-derived Source. It row-locks the Campaign so a
// concurrent intake cannot race the auto-activation:
//   - Active                -> proceed.
//   - Draft / Paused        -> O13 auto-activate to Active via the engine (the
//     edge is legal + not requireLead) + a distinct `campaign_auto_activated`
//     audit row (actor = the importer). Then proceed.
//   - Closed / Archived     -> BLOCK: the campaign machine has NO edge to Active,
//     so the intake is rejected with MsgCampaignNotActive.
//   - missing               -> reject with MsgCampaignNotFound.
//
// It returns an *ErrBlocked (carrying the verbatim BI message) for the gate
// rejections; a plain error signals an infrastructure failure.
func (s *Service) resolveCampaignForIntake(ctx context.Context, tx *sql.Tx, campaignID string, actor permission.Actor) (string, error) {
	var channel, status string
	err := tx.QueryRowContext(ctx,
		`SELECT channel, status FROM campaigns WHERE id = ? FOR UPDATE`, campaignID).
		Scan(&channel, &status)
	if err == sql.ErrNoRows {
		return "", &ErrBlocked{Message: MsgCampaignNotFound}
	}
	if err != nil {
		return "", err
	}

	switch status {
	case campaignStatusActive:
		// ready — nothing to do.
	case campaignStatusDraft, campaignStatusPaused:
		// O13: auto-activate through the engine (only path that writes status; it
		// appends its own transition audit row too).
		if _, err := s.Engine.Transition(ctx, tx, statemachine.Request{
			Machine:    statemachine.MCampaign,
			EntityType: "campaign",
			Table:      "campaigns",
			EntityID:   campaignID,
			To:         campaignStatusActive,
			Actor:      actor,
		}); err != nil {
			return "", err
		}
		if err := audit.Write(ctx, tx, audit.Record{
			EntityType: "campaign", EntityID: campaignID, Actor: actor.EmployeeID,
			Action: "campaign_auto_activated",
			Before: map[string]any{"status": status},
			After:  map[string]any{"status": campaignStatusActive, "trigger": "lead_intake"},
		}); err != nil {
			return "", err
		}
	default: // Closed / Archived — no legal edge to Active.
		return "", &ErrBlocked{Message: MsgCampaignNotActive}
	}
	return deriveSource(channel), nil
}

// updateLastTouch writes campaignID into an EXISTING lead's last_touch_campaign_id
// (M1 §5 / §9.3) when it differs from the value on file, and audits the change.
// It NEVER touches origin_campaign_id (the immutable first-touch record). A no-op
// when campaignID is empty or already the current last-touch (idempotent — a
// re-touch by the same Campaign appends no redundant audit row).
func (s *Service) updateLastTouch(ctx context.Context, tx *sql.Tx, leadID, campaignID string, actor permission.Actor) error {
	if campaignID == "" {
		return nil
	}
	var cur sql.NullString
	if err := tx.QueryRowContext(ctx,
		`SELECT last_touch_campaign_id FROM leads WHERE id = ?`, leadID).Scan(&cur); err != nil {
		return err
	}
	if cur.Valid && cur.String == campaignID {
		return nil
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE leads SET last_touch_campaign_id = ? WHERE id = ?`, campaignID, leadID); err != nil {
		return err
	}
	var before any
	if cur.Valid {
		before = cur.String
	}
	return audit.Write(ctx, tx, audit.Record{
		EntityType: "lead", EntityID: leadID, Actor: actor.EmployeeID,
		Action: "last_touch_updated",
		Before: map[string]any{"last_touch_campaign_id": before},
		After:  map[string]any{"last_touch_campaign_id": campaignID},
	})
}

// campaignArg maps an optional campaign id to a nullable SQL argument.
func campaignArg(campaignID string) any {
	if campaignID == "" {
		return nil
	}
	return campaignID
}
