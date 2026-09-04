package httpapi_test

import (
	"context"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

// setBriefStatusTC raw-sets a Brief's status (test scaffolding only — bypasses the
// engine to reach a state the M8 Launch guard reads, without driving the full flow).
func setBriefStatusTC(t *testing.T, briefID, status string) {
	t.Helper()
	if _, err := testutil.DB(t).ExecContext(context.Background(),
		`UPDATE briefs SET status = ? WHERE id = ?`, status, briefID); err != nil {
		t.Fatal(err)
	}
}

// seedApprovedAssetTC inserts a [Approved] Creative Brief + [Approved] Asset under svcID
// (same Client as an Ads campaign) — the linkable creative, bypassing the full M7 flow.
func seedApprovedAssetTC(t *testing.T, svcID, assetID string) {
	t.Helper()
	d := testutil.DB(t)
	briefID := "BRFCRE-" + assetID
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO briefs (id, service_id, assigned_division, deliverable_type, quantity_target, due_date, priority, title, status, created_by)
		 VALUES (?, ?, 'Creative', 'Product Video', 1, '2026-08-30', 'High', 'Creative brief', '[Approved]', 'TEST')`,
		briefID, svcID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO assets (id, brief_id, asset_type, sequence_no, status, created_by)
		 VALUES (?, ?, 'Product Video', 1, '[Approved]', 'TEST')`,
		assetID, briefID); err != nil {
		t.Fatal(err)
	}
}

// TestAdsCampaignEndpoints exercises the Module 8 (Ads) Ad Campaign HTTP surface
// (/api/v1/briefs/{id}/campaigns, /api/v1/campaigns/...): per-role permission checks
// (incl. layered OD/Director), the two-sided Launch guard (brief [Approved] + all linked
// Assets [Approved]), and the append-only Metric-Entry / Optimization-Log child rows.
func TestAdsCampaignEndpoints(t *testing.T) {
	srv, done := setupTC(t)
	defer done()
	seedTCBrief(t, "CLI-AD", "SVC-AD", "BRF-AD", "Ads", 1)

	budi := login(t, srv, "budi@mea.co.id")   // Sales staff (foreign)
	cakra := login(t, srv, "cakra@mea.co.id") // Creative staff (foreign)
	adi := login(t, srv, "adi@mea.co.id")     // Ads staff (Advertiser)
	adil := login(t, srv, "adil@mea.co.id")   // Ads lead
	amel := login(t, srv, "amel@mea.co.id")   // owning AM
	alia := login(t, srv, "alia@mea.co.id")   // Account lead (division-wide read)
	odi := login(t, srv, "odi@mea.co.id")     // OD (read-only)
	yohan := login(t, srv, "yohan@mea.co.id") // Director

	// Move the Ads Brief [To Do] -> [In Progress] so a campaign can be created (§4 Rule 1).
	if code, _ := do(t, adi, "POST", srv.URL+"/api/v1/tasks/BRF-AD/start", nil); code != 200 {
		t.Fatalf("start BRF-AD: want 200")
	}

	briefCampaigns := srv.URL + "/api/v1/briefs/BRF-AD/campaigns"
	valid := map[string]any{
		"platform": "TikTok Shop Ads", "objective": "Conversion", "budget": "8000000",
		"start_date": "2026-06-01", "end_date": "2026-06-30", "target_kpi": "ROAS >= 4x",
	}

	// --- CreateCampaign (§9.1 manage gate): foreign/AM/OD denied; Ads staff creates.
	if code, body := do(t, budi, "POST", briefCampaigns, valid); code != 403 || body["message"] != "[anda tidak memiliki akses untuk mengelola kampanye iklan ini]" {
		t.Fatalf("sales create campaign: %d %v", code, body)
	}
	if code, _ := do(t, amel, "POST", briefCampaigns, valid); code != 403 {
		t.Fatalf("AM create campaign: want 403")
	}
	if code, _ := do(t, odi, "POST", briefCampaigns, valid); code != 403 {
		t.Fatalf("OD create campaign: want 403")
	}
	// Invalid platform -> 422.
	if code, body := do(t, adi, "POST", briefCampaigns, map[string]any{
		"platform": "Google Ads", "objective": "x", "budget": "1000000",
		"start_date": "2026-06-01", "end_date": "2026-06-30", "target_kpi": "ROAS 4",
	}); code != 422 || body["message"] != "[platform tidak valid]" {
		t.Fatalf("bad platform: %d %v", code, body)
	}
	code, body := do(t, adi, "POST", briefCampaigns, valid)
	if code != 200 {
		t.Fatalf("create campaign: %d %v", code, body)
	}
	adc := body["id"].(string)
	if body["status"] != "[Paused]" {
		t.Fatalf("campaign born status = %v, want [Paused]", body["status"])
	}
	campaign := srv.URL + "/api/v1/campaigns/" + adc

	// --- GetCampaign (§9.1 read gate): Ads/owner-AM/Account-lead/OD see it; foreign no.
	if code, _ := do(t, adi, "GET", campaign, nil); code != 200 {
		t.Fatalf("Ads GET campaign: want 200")
	}
	if code, _ := do(t, amel, "GET", campaign, nil); code != 200 {
		t.Fatalf("owner AM GET campaign: want 200")
	}
	if code, _ := do(t, alia, "GET", campaign, nil); code != 200 {
		t.Fatalf("account lead GET campaign: want 200")
	}
	if code, _ := do(t, odi, "GET", campaign, nil); code != 200 {
		t.Fatalf("OD GET campaign: want 200")
	}
	if code, body := do(t, cakra, "GET", campaign, nil); code != 403 || body["message"] != "[anda tidak memiliki akses ke kampanye iklan ini]" {
		t.Fatalf("foreign GET campaign: %d %v", code, body)
	}
	if code, body := do(t, adi, "GET", srv.URL+"/api/v1/campaigns/ADC-NONE", nil); code != 404 || body["message"] != "[kampanye iklan tidak ditemukan]" {
		t.Fatalf("missing campaign: %d %v", code, body)
	}

	// --- Launch guard, side 1: setup Brief not [Approved] yet -> 422.
	if code, body := do(t, adi, "POST", campaign+"/launch", nil); code != 422 || body["message"] != "[kampanye belum dapat diluncurkan, brief setup belum disetujui]" {
		t.Fatalf("launch before brief approved: %d %v", code, body)
	}
	setBriefStatusTC(t, "BRF-AD", "[Approved]")
	// --- Launch guard, side 2: brief [Approved] but no linked approved Asset -> 422.
	if code, body := do(t, adi, "POST", campaign+"/launch", nil); code != 422 || body["message"] != "[kampanye belum dapat diluncurkan, aset kreatif tertaut harus disetujui]" {
		t.Fatalf("launch before assets approved: %d %v", code, body)
	}

	// --- LinkAsset (§4 Rule 2): foreign denied; Ads staff links the approved Asset.
	seedApprovedAssetTC(t, "SVC-AD", "AST-AD")
	if code, _ := do(t, budi, "POST", campaign+"/assets", map[string]any{"asset_id": "AST-AD"}); code != 403 {
		t.Fatalf("foreign link asset: want 403")
	}
	if code, body := do(t, adi, "POST", campaign+"/assets", map[string]any{"asset_id": "AST-AD"}); code != 200 {
		t.Fatalf("link asset: %d %v", code, body)
	}

	// --- Launch now passes both gates -> [Active].
	if code, body := do(t, adi, "POST", campaign+"/launch", nil); code != 200 {
		t.Fatalf("launch: %d %v", code, body)
	}
	if _, body := do(t, adi, "GET", campaign, nil); body["status"] != "[Active]" {
		t.Fatalf("status after launch = %v, want [Active]", body["status"])
	}

	// --- Metric Entries (§5): append-only. POST manage-gated; GET list view-gated.
	metrics := campaign + "/metrics"
	if code, body := do(t, adi, "POST", metrics, map[string]any{
		"period_start": "2026-06-01", "period_end": "2026-06-07", "spend": "1000000", "gmv": "4000000", "entry_method": "Manual",
	}); code != 200 {
		t.Fatalf("log metric: %d %v", code, body)
	}
	if code, body := do(t, adi, "POST", metrics, map[string]any{
		"period_start": "2026-06-01", "period_end": "2026-06-07", "spend": "1", "gmv": "1", "entry_method": "Telepathy",
	}); code != 422 || body["message"] != "[metode input tidak valid]" {
		t.Fatalf("bad entry method: %d %v", code, body)
	}
	if code, _ := do(t, budi, "POST", metrics, map[string]any{
		"period_start": "2026-06-01", "period_end": "2026-06-07", "spend": "1", "gmv": "1", "entry_method": "Manual",
	}); code != 403 {
		t.Fatalf("foreign log metric: want 403")
	}
	// GET list: Ads + owner AM see it; foreign denied.
	if code, body := do(t, adi, "GET", metrics, nil); code != 200 || len(body["data"].([]any)) != 1 {
		t.Fatalf("metric list (Ads): %d %v", code, body)
	}
	if code, _ := do(t, amel, "GET", metrics, nil); code != 200 {
		t.Fatalf("metric list (owner AM): want 200")
	}
	if code, body := do(t, cakra, "GET", metrics, nil); code != 403 || body["message"] != "[anda tidak memiliki akses ke kampanye iklan ini]" {
		t.Fatalf("foreign metric list: %d %v", code, body)
	}

	// --- Optimization Log (§6): append-only. Ads staff + owning AM (sign-off path) POST.
	opt := campaign + "/optimizations"
	if code, body := do(t, adi, "POST", opt, map[string]any{
		"change_type": "Targeting", "before_value": "broad", "after_value": "lookalike", "reason": "improve ROAS",
	}); code != 200 {
		t.Fatalf("log optimization (Ads): %d %v", code, body)
	}
	if code, _ := do(t, amel, "POST", opt, map[string]any{
		"change_type": "Schedule", "before_value": "day", "after_value": "night", "reason": "peak hours",
	}); code != 200 {
		t.Fatalf("log optimization (owner AM sign-off): want 200")
	}
	if code, _ := do(t, budi, "POST", opt, map[string]any{
		"change_type": "Targeting", "before_value": "a", "after_value": "b", "reason": "x",
	}); code != 403 {
		t.Fatalf("foreign log optimization: want 403")
	}
	// A >50% budget change by a plain Advertiser needs AM/SPV sign-off (M8-OA-3) -> 403.
	if code, body := do(t, adi, "POST", opt, map[string]any{
		"change_type": "Budget", "before_value": "1000000", "after_value": "5000000", "reason": "scale",
	}); code != 403 || body["message"] != "[penyesuaian budget lebih dari 50% memerlukan persetujuan AM/SPV Ads]" {
		t.Fatalf("advertiser >50%% budget: %d %v", code, body)
	}
	if code, body := do(t, adi, "GET", opt, nil); code != 200 || len(body["data"].([]any)) != 2 {
		t.Fatalf("optimization list: %d %v", code, body)
	}

	// --- Remaining lifecycle (§9.3): Pause/Resume/End. Foreign denied; Director allowed.
	if code, _ := do(t, budi, "POST", campaign+"/pause", nil); code != 403 {
		t.Fatalf("foreign pause: want 403")
	}
	if code, _ := do(t, adi, "POST", campaign+"/pause", nil); code != 200 {
		t.Fatalf("pause: want 200")
	}
	if code, _ := do(t, adil, "POST", campaign+"/resume", nil); code != 200 {
		t.Fatalf("lead resume: want 200")
	}
	if code, _ := do(t, yohan, "POST", campaign+"/end", nil); code != 200 {
		t.Fatalf("director end: want 200")
	}
	if _, body := do(t, adi, "GET", campaign, nil); body["status"] != "[Ended]" {
		t.Fatalf("status after end = %v, want [Ended]", body["status"])
	}
	// Invalid transition: End is terminal, Pause from [Ended] is blocked.
	if code, body := do(t, adi, "POST", campaign+"/pause", nil); code != 422 || body["message"] != "[transisi status tidak diizinkan]" {
		t.Fatalf("pause from ended: %d %v", code, body)
	}
	// COO decision 2026-07-20: a Metric Entry against an [Ended] campaign is blocked
	// server-side -> 422 with the authorised BI string.
	if code, body := do(t, adi, "POST", metrics, map[string]any{
		"period_start": "2026-06-08", "period_end": "2026-06-14", "spend": "1000000", "gmv": "4000000", "entry_method": "Manual",
	}); code != 422 || body["message"] != "[ad campaign sudah berakhir, metric entry tidak bisa dicatat]" {
		t.Fatalf("metric entry on ended: %d %v", code, body)
	}
}
