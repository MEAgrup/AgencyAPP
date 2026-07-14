package httpapi_test

import (
	"testing"
)

// TestCreativeAssetEndpoints exercises the Module 7 (Creative) Asset HTTP surface
// (/api/v1/briefs/{id}/assets, /api/v1/assets/...) plus the Module 12 execution
// edges an Asset plugs into, with per-role permission checks (incl. layered OD/
// Director), valid + invalid transitions with exact BI messages, the AM review
// loop, block queue and Hours Logged.
func TestCreativeAssetEndpoints(t *testing.T) {
	srv, done := setupTC(t)
	defer done()
	seedTCBrief(t, "CLI-CR", "SVC-CR", "BRF-CR", "Creative", 1)

	budi := login(t, srv, "budi@mea.co.id")   // Sales staff (foreign)
	cakra := login(t, srv, "cakra@mea.co.id") // Creative staff (PIC)
	cindy := login(t, srv, "cindy@mea.co.id") // Creative staff (non-PIC)
	clara := login(t, srv, "clara@mea.co.id") // Creative lead
	cdir := login(t, srv, "cdir@mea.co.id")   // Creative staff + LAYERED director
	amel := login(t, srv, "amel@mea.co.id")   // owning AM
	alia := login(t, srv, "alia@mea.co.id")   // Account lead (not owner)
	odi := login(t, srv, "odi@mea.co.id")     // OD (read-only)
	yohan := login(t, srv, "yohan@mea.co.id") // Director

	briefAssets := srv.URL + "/api/v1/briefs/BRF-CR/assets"

	// --- CreateAsset (§4): AM/OD/foreign denied; Creative staff self-claims.
	if code, body := do(t, budi, "POST", briefAssets, map[string]any{"sequence_no": 1}); code != 403 || body["message"] != "[anda tidak memiliki akses untuk membuat aset pada brief ini]" {
		t.Fatalf("sales create asset: %d %v", code, body)
	}
	if code, _ := do(t, amel, "POST", briefAssets, map[string]any{"sequence_no": 1}); code != 403 {
		t.Fatalf("AM create asset: want 403")
	}
	if code, _ := do(t, odi, "POST", briefAssets, map[string]any{"sequence_no": 1}); code != 403 {
		t.Fatalf("OD create asset: want 403")
	}
	// Sequence out of range (> quantity_target 1) -> 422.
	if code, body := do(t, cakra, "POST", briefAssets, map[string]any{"sequence_no": 5}); code != 422 || body["message"] != "[nomor urut aset harus antara 1 dan jumlah target brief]" {
		t.Fatalf("bad sequence: %d %v", code, body)
	}
	code, body := do(t, cakra, "POST", briefAssets, map[string]any{"sequence_no": 1})
	if code != 200 {
		t.Fatalf("create asset: %d %v", code, body)
	}
	assetID := body["id"].(string)
	if body["assigned_pic"] != "EMP-CAKRA" {
		t.Fatalf("self-claim PIC = %v, want EMP-CAKRA", body["assigned_pic"])
	}
	// Duplicate sequence -> 422.
	if code, body := do(t, cakra, "POST", briefAssets, map[string]any{"sequence_no": 1}); code != 422 || body["message"] != "[nomor urut aset sudah digunakan pada brief ini]" {
		t.Fatalf("dup sequence: %d %v", code, body)
	}

	asset := srv.URL + "/api/v1/assets/" + assetID

	// --- Reads (§9.1): PIC + owning AM + OD see it; a foreign division does not.
	if code, _ := do(t, cakra, "GET", asset, nil); code != 200 {
		t.Fatalf("PIC GET asset: want 200")
	}
	if code, _ := do(t, amel, "GET", asset, nil); code != 200 {
		t.Fatalf("AM GET asset: want 200")
	}
	if code, _ := do(t, odi, "GET", briefAssets, nil); code != 200 {
		t.Fatalf("OD list assets: want 200")
	}
	if code, body := do(t, budi, "GET", asset, nil); code != 403 || body["message"] != "[anda tidak memiliki akses ke aset ini]" {
		t.Fatalf("foreign GET asset: %d %v", code, body)
	}

	// --- Execution edges (claim model, PIC=EMP-CAKRA): non-PIC staff denied.
	if code, body := do(t, cindy, "POST", asset+"/start", nil); code != 403 || body["message"] != "[anda tidak memiliki akses untuk mengerjakan task ini]" {
		t.Fatalf("non-PIC start: %d %v", code, body)
	}
	if code, _ := do(t, cakra, "POST", asset+"/start", nil); code != 200 {
		t.Fatalf("PIC start asset: want 200")
	}
	// Roll-up: first asset started -> Brief [In Progress].
	if st := briefStatusTC(t, "BRF-CR"); st != "[In Progress]" {
		t.Fatalf("brief roll-up after start = %s want [In Progress]", st)
	}
	// Submit without an output link -> 422 (verbatim PRD string).
	if code, body := do(t, cakra, "POST", asset+"/submit", map[string]any{"output_link": ""}); code != 422 || body["message"] != "[link output wajib diisi sebelum submit]" {
		t.Fatalf("submit no link: %d %v", code, body)
	}
	if code, _ := do(t, cakra, "POST", asset+"/submit", map[string]any{"output_link": "https://drive/a"}); code != 200 {
		t.Fatalf("PIC submit asset: want 200")
	}

	// --- AM review loop (§4 Flow 3 / §6): only owning AM (or Director) reviews.
	if code, body := do(t, cakra, "POST", asset+"/review", nil); code != 403 || body["message"] != "[hanya Account Manager pemilik klien yang dapat mereview aset ini]" {
		t.Fatalf("creative review: %d %v", code, body)
	}
	if code, _ := do(t, alia, "POST", asset+"/review", nil); code != 403 {
		t.Fatalf("account lead (non-owner) review: want 403")
	}
	if code, _ := do(t, amel, "POST", asset+"/review", nil); code != 200 {
		t.Fatalf("owning AM review: want 200")
	}
	// Revision needs feedback.
	if code, body := do(t, amel, "POST", asset+"/request-revision", map[string]any{"feedback": ""}); code != 422 || body["message"] != "[feedback revisi wajib diisi]" {
		t.Fatalf("empty revision feedback: %d %v", code, body)
	}
	if code, _ := do(t, amel, "POST", asset+"/request-revision", map[string]any{"feedback": "warna off-brand"}); code != 200 {
		t.Fatalf("AM request revision: want 200")
	}
	// PIC reworks, resubmits; AM reviews and approves -> Asset & Brief [Approved].
	if code, _ := do(t, cakra, "POST", asset+"/rework", nil); code != 200 {
		t.Fatalf("PIC rework: want 200")
	}
	if code, _ := do(t, cakra, "POST", asset+"/submit", map[string]any{"output_link": "https://drive/a2"}); code != 200 {
		t.Fatalf("PIC resubmit: want 200")
	}
	if code, _ := do(t, amel, "POST", asset+"/review", nil); code != 200 {
		t.Fatalf("AM re-review: want 200")
	}
	if code, _ := do(t, yohan, "POST", asset+"/approve", nil); code != 200 {
		t.Fatalf("director approve asset: want 200")
	}
	if st := briefStatusTC(t, "BRF-CR"); st != "[Approved]" {
		t.Fatalf("brief roll-up after approve = %s want [Approved]", st)
	}

	// --- Assign PIC / SLA / block / hours on a fresh brief+asset (BRF-CR2).
	seedTCBrief(t, "CLI-CR2", "SVC-CR2", "BRF-CR2", "Creative", 1)
	// Lead creates the asset unassigned (leaves PIC blank).
	code, body = do(t, clara, "POST", srv.URL+"/api/v1/briefs/BRF-CR2/assets", map[string]any{"sequence_no": 1})
	if code != 200 {
		t.Fatalf("lead create asset2: %d %v", code, body)
	}
	a2ID := body["id"].(string)
	a2 := srv.URL + "/api/v1/assets/" + a2ID

	// AssignAssetPIC (§9.3): staff denied; invalid PIC 422; lead + layered-director OK.
	if code, body := do(t, cindy, "POST", a2+"/assign-pic", map[string]any{"pic_id": "EMP-CAKRA"}); code != 403 || body["message"] != "[anda tidak memiliki akses untuk menugaskan PIC atau menetapkan SLA task ini]" {
		t.Fatalf("staff assign-pic: %d %v", code, body)
	}
	// AssignAssetPIC is a Module 12 method, so it returns M12's ErrInvalidPIC.
	if code, body := do(t, clara, "POST", a2+"/assign-pic", map[string]any{"pic_id": "EMP-BUDI"}); code != 422 || body["message"] != "[PIC tidak valid: harus staff divisi tujuan yang aktif]" {
		t.Fatalf("invalid pic: %d %v", code, body)
	}
	// Layered one-account-two-roles: a Creative STAFF who is also Director may assign.
	if code, _ := do(t, cdir, "POST", a2+"/assign-pic", map[string]any{"pic_id": "EMP-CAKRA"}); code != 200 {
		t.Fatalf("layered creative-staff+director assign-pic: want 200")
	}
	// SLA + Revision SLA (lead).
	if code, body := do(t, clara, "POST", a2+"/sla", map[string]any{"hours": 0}); code != 422 || body["message"] != "[target SLA harus lebih dari 0 jam]" {
		t.Fatalf("zero asset sla: %d %v", code, body)
	}
	if code, _ := do(t, clara, "POST", a2+"/sla", map[string]any{"hours": 48}); code != 200 {
		t.Fatalf("lead set asset sla: want 200")
	}
	if code, _ := do(t, clara, "POST", a2+"/revision-sla", map[string]any{"hours": 24}); code != 200 {
		t.Fatalf("lead set asset revision sla: want 200")
	}

	// Asset block queue (§5.3a).
	if code, _ := do(t, cakra, "POST", a2+"/start", nil); code != 200 {
		t.Fatalf("start asset2: want 200")
	}
	code, body = do(t, cakra, "POST", a2+"/block-request", map[string]any{"reason": "aset referensi belum ada"})
	if code != 200 {
		t.Fatalf("asset block-request: %d %v", code, body)
	}
	a2req := body["id"].(string)
	if code, _ := do(t, cindy, "POST", a2+"/block-requests/"+a2req+"/approve", nil); code != 403 {
		t.Fatalf("staff approve asset block: want 403")
	}
	if code, _ := do(t, clara, "POST", a2+"/block-requests/"+a2req+"/approve", nil); code != 200 {
		t.Fatalf("lead approve asset block: want 200")
	}
	if code, _ := do(t, clara, "POST", a2+"/resume", nil); code != 200 {
		t.Fatalf("lead resume asset: want 200")
	}

	// Hours Logged (§5 Rule 2): non-PIC staff denied; PIC + lead allowed; 0 -> 422.
	if code, body := do(t, cindy, "POST", a2+"/hours", map[string]any{"hours": 5}); code != 403 || body["message"] != "[anda tidak memiliki akses untuk mencatat Hours Logged aset ini]" {
		t.Fatalf("non-PIC hours: %d %v", code, body)
	}
	if code, body := do(t, cakra, "POST", a2+"/hours", map[string]any{"hours": 0}); code != 422 || body["message"] != "[jumlah Hours Logged harus lebih dari 0]" {
		t.Fatalf("zero hours: %d %v", code, body)
	}
	if code, _ := do(t, cakra, "POST", a2+"/hours", map[string]any{"hours": 5}); code != 200 {
		t.Fatalf("PIC log hours: want 200")
	}
	if code, _ := do(t, clara, "POST", a2+"/hours", map[string]any{"hours": 6}); code != 200 {
		t.Fatalf("lead log hours: want 200")
	}

	// Asset metrics read gate.
	if code, _ := do(t, cakra, "GET", a2+"/metrics", nil); code != 200 {
		t.Fatalf("PIC asset metrics: want 200")
	}
	if code, _ := do(t, odi, "GET", a2+"/metrics", nil); code != 200 {
		t.Fatalf("OD asset metrics: want 200")
	}
	if code, body := do(t, budi, "GET", a2+"/metrics", nil); code != 403 || body["message"] != "[anda tidak memiliki akses ke task ini]" {
		t.Fatalf("foreign asset metrics: %d %v", code, body)
	}
}
