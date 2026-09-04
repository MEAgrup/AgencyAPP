package httpapi_test

import (
	"context"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

// seedLSBrief inserts a released client (owned by AM EMP-AMEL), a [Briefed] service, and
// one Live Stream Brief born off-machine [Dispatched to Vendor] (M6 §6 Rule 2).
func seedLSBrief(t *testing.T, clientID, svcID, briefID string) {
	t.Helper()
	d := testutil.DB(t)
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
		  total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
		 VALUES (?, 'PIC', ?, 'Kota', 'link', 'Fashion', '0.00', '0.00', '0.00', 'EMP-BUDI', 'EMP-BUDI', NOW(), 'EMP-AMEL', 'TEST')`,
		clientID, clientID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO services (id, client_id, master_service_id, master_version_no, name, standard_price, commission_rule, status, created_by)
		 VALUES (?, ?, 'MSV-01', 1, 'Live Stream', '5000000.00', '10% of standard price', '[Briefed]', 'TEST')`,
		svcID, clientID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO briefs (id, service_id, assigned_division, deliverable_type, quantity_target, due_date, priority, title, status, created_by)
		 VALUES (?, ?, 'Live Stream', 'Live Session', 1, '2026-08-30', 'High', 'LS', '[Dispatched to Vendor]', 'TEST')`,
		briefID, svcID); err != nil {
		t.Fatal(err)
	}
}

// TestLiveStreamSessionEndpoints exercises the Module 10 (Live Stream) HTTP surface
// (/api/v1/briefs/{id}/sessions, /api/v1/sessions/..., /api/v1/briefs/{id}/reopen):
// per-role permission checks (owning-AM-only write incl. layered OD/Director), the
// vendor-tracker lifecycle with its mandatory gates, and the O27-b Brief reopen
// (403/422/200 + a new Session creatable after reopen).
func TestLiveStreamSessionEndpoints(t *testing.T) {
	srv, done := setupTC(t)
	defer done()
	seedLSBrief(t, "CLI-LS", "SVC-LS", "BRF-LS")

	budi := login(t, srv, "budi@mea.co.id")   // Sales staff (foreign)
	amel := login(t, srv, "amel@mea.co.id")   // owning AM
	anin := login(t, srv, "anin@mea.co.id")   // second AM (NON-owner)
	alia := login(t, srv, "alia@mea.co.id")   // Account lead (read-only division-wide)
	odi := login(t, srv, "odi@mea.co.id")     // OD (read-only)
	yohan := login(t, srv, "yohan@mea.co.id") // Director

	briefSessions := srv.URL + "/api/v1/briefs/BRF-LS/sessions"
	reopen := srv.URL + "/api/v1/briefs/BRF-LS/reopen"
	valid := map[string]any{
		"platform": "TikTok Shop Live", "requested_datetime": "2026-06-15 19:00:00", "target_duration_hours": "2",
	}

	// --- CreateSession (§6.1 write gate = owning AM or Director): others denied.
	if code, body := do(t, budi, "POST", briefSessions, valid); code != 403 || body["message"] != "[anda tidak memiliki akses untuk mengelola sesi live stream ini]" {
		t.Fatalf("foreign create session: %d %v", code, body)
	}
	if code, _ := do(t, anin, "POST", briefSessions, valid); code != 403 {
		t.Fatalf("non-owner AM create session: want 403")
	}
	if code, _ := do(t, alia, "POST", briefSessions, valid); code != 403 {
		t.Fatalf("account lead create session: want 403")
	}
	if code, _ := do(t, odi, "POST", briefSessions, valid); code != 403 {
		t.Fatalf("OD create session: want 403")
	}
	// Invalid platform -> 422.
	if code, body := do(t, amel, "POST", briefSessions, map[string]any{
		"platform": "YouTube Live", "requested_datetime": "2026-06-15 19:00:00", "target_duration_hours": "2",
	}); code != 422 || body["message"] != "[platform tidak valid]" {
		t.Fatalf("bad platform: %d %v", code, body)
	}
	code, body := do(t, amel, "POST", briefSessions, valid)
	if code != 200 {
		t.Fatalf("create session: %d %v", code, body)
	}
	lss := body["id"].(string)
	session := srv.URL + "/api/v1/sessions/" + lss

	// --- Reads (§6.1): owning AM + Account lead (division-wide) + OD see it; foreign no.
	if code, _ := do(t, amel, "GET", session, nil); code != 200 {
		t.Fatalf("owner AM GET session: want 200")
	}
	if code, _ := do(t, alia, "GET", session, nil); code != 200 {
		t.Fatalf("account lead GET session: want 200")
	}
	if code, _ := do(t, odi, "GET", briefSessions, nil); code != 200 {
		t.Fatalf("OD list sessions: want 200")
	}
	if code, body := do(t, budi, "GET", session, nil); code != 403 || body["message"] != "[anda tidak memiliki akses ke sesi ini]" {
		t.Fatalf("foreign GET session: %d %v", code, body)
	}

	// --- Lifecycle (§4): Confirm -> Results (gated) -> Reconcile (straight match).
	if code, _ := do(t, amel, "POST", session+"/confirm", nil); code != 200 {
		t.Fatalf("confirm: want 200")
	}
	// Results: Vendor Report Link is mandatory before [Completed].
	if code, body := do(t, amel, "POST", session+"/results", map[string]any{
		"actual_datetime": "2026-06-15 20:00:00", "actual_duration_hours": "2", "orders_generated": 10, "gmv": "5000000",
	}); code != 422 || body["message"] != "[link laporan vendor wajib diisi sebelum sesi selesai]" {
		t.Fatalf("results no vendor link: %d %v", code, body)
	}
	if code, _ := do(t, amel, "POST", session+"/results", map[string]any{
		"actual_datetime": "2026-06-15 20:00:00", "actual_duration_hours": "2", "orders_generated": 10,
		"gmv": "5000000", "vendor_report_link": "https://vendor/r1",
	}); code != 200 {
		t.Fatalf("results: want 200")
	}
	if code, _ := do(t, amel, "POST", session+"/reconcile", nil); code != 200 {
		t.Fatalf("reconcile: want 200")
	}
	// All Sessions reconciled -> Brief closed to [Approved].
	if st := briefStatusTC(t, "BRF-LS"); st != "[Approved]" {
		t.Fatalf("brief after reconcile = %s want [Approved]", st)
	}

	// --- O27-b Reopen: non-owner/foreign denied (403); owning AM reopens (200).
	if code, body := do(t, anin, "POST", reopen, nil); code != 403 || body["message"] != "[anda tidak memiliki akses untuk membuka kembali brief ini]" {
		t.Fatalf("non-owner AM reopen: %d %v", code, body)
	}
	if code, _ := do(t, alia, "POST", reopen, nil); code != 403 {
		t.Fatalf("account lead reopen: want 403")
	}
	if code, _ := do(t, odi, "POST", reopen, nil); code != 403 {
		t.Fatalf("OD reopen: want 403")
	}
	if code, body := do(t, amel, "POST", reopen, nil); code != 200 || body["status"] != "[Dispatched to Vendor]" {
		t.Fatalf("owner AM reopen: %d %v", code, body)
	}
	if st := briefStatusTC(t, "BRF-LS"); st != "[Dispatched to Vendor]" {
		t.Fatalf("brief after reopen = %s want [Dispatched to Vendor]", st)
	}
	// --- Reopen again is blocked: only [Approved] is reopenable -> 422.
	if code, body := do(t, amel, "POST", reopen, nil); code != 422 || body["message"] != "[brief tidak dapat dibuka kembali pada status ini]" {
		t.Fatalf("reopen when not approved: %d %v", code, body)
	}

	// --- A new Session is creatable after reopen; drive it via the discrepancy path.
	code, body = do(t, amel, "POST", briefSessions, valid)
	if code != 200 {
		t.Fatalf("create session after reopen: %d %v", code, body)
	}
	lss2 := body["id"].(string)
	s2 := srv.URL + "/api/v1/sessions/" + lss2
	if code, _ := do(t, amel, "POST", s2+"/confirm", nil); code != 200 {
		t.Fatalf("confirm s2: want 200")
	}
	if code, _ := do(t, amel, "POST", s2+"/results", map[string]any{
		"actual_datetime": "2026-06-22 20:00:00", "actual_duration_hours": "1", "orders_generated": 3,
		"gmv": "1000000", "vendor_report_link": "https://vendor/r2",
	}); code != 200 {
		t.Fatalf("results s2: want 200")
	}
	// FlagDiscrepancy requires notes; non-blocking (may still reconcile after).
	if code, body := do(t, amel, "POST", s2+"/flag-discrepancy", map[string]any{"notes": ""}); code != 422 || body["message"] != "[catatan rekonsiliasi wajib diisi]" {
		t.Fatalf("flag no notes: %d %v", code, body)
	}
	if code, _ := do(t, amel, "POST", s2+"/flag-discrepancy", map[string]any{"notes": "GMV lebih rendah dari target"}); code != 200 {
		t.Fatalf("flag-discrepancy: want 200")
	}
	if code, _ := do(t, yohan, "POST", s2+"/reconcile", nil); code != 200 {
		t.Fatalf("director reconcile s2: want 200")
	}
	// Both Sessions reconciled again -> Brief re-closed to [Approved].
	if st := briefStatusTC(t, "BRF-LS"); st != "[Approved]" {
		t.Fatalf("brief after second reconcile = %s want [Approved]", st)
	}
}
