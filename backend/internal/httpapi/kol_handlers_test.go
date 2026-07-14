package httpapi_test

import (
	"testing"
)

// TestKOLBookingEndpoints exercises the Module 9 (KOL) Creator Booking HTTP surface
// (/api/v1/briefs/{id}/bookings, /api/v1/bookings/..., /api/v1/payment-requests/...):
// per-role permission checks (incl. layered OD/Director), the native lifecycle incl.
// QC done by KOL itself, the claim model (pre-/post-Coordinator), the Creator Payment
// Request (KOL request side / Finance executing side), and the Creator List.
func TestKOLBookingEndpoints(t *testing.T) {
	srv, done := setupTC(t)
	defer done()
	seedTCBrief(t, "CLI-KO", "SVC-KO", "BRF-KO", "KOL", 1)

	budi := login(t, srv, "budi@mea.co.id")   // Sales staff (foreign)
	koko := login(t, srv, "koko@mea.co.id")   // KOL staff -> self-claim Coordinator
	kiki := login(t, srv, "kiki@mea.co.id")   // KOL staff (non-Coordinator)
	kev := login(t, srv, "kev@mea.co.id")     // KOL lead (Team Leader)
	fina := login(t, srv, "fina@mea.co.id")   // Finance staff
	amel := login(t, srv, "amel@mea.co.id")   // owning AM
	odi := login(t, srv, "odi@mea.co.id")     // OD (read-only)
	yohan := login(t, srv, "yohan@mea.co.id") // Director

	briefBookings := srv.URL + "/api/v1/briefs/BRF-KO/bookings"
	valid := map[string]any{
		"creator_name": "Nadia", "platform": "TikTok", "source_pool": "MCN MEA Roster", "agreed_rate": "1500000",
	}

	// --- CreateBooking (§4): foreign/AM/OD denied; KOL staff self-claims as Coordinator.
	if code, body := do(t, budi, "POST", briefBookings, valid); code != 403 || body["message"] != "[anda tidak memiliki akses untuk mengerjakan booking ini]" {
		t.Fatalf("sales create booking: %d %v", code, body)
	}
	if code, _ := do(t, amel, "POST", briefBookings, valid); code != 403 {
		t.Fatalf("AM create booking: want 403")
	}
	// Invalid source pool -> 422.
	if code, body := do(t, koko, "POST", briefBookings, map[string]any{
		"creator_name": "X", "platform": "TikTok", "source_pool": "Random", "agreed_rate": "1000000",
	}); code != 422 || body["message"] != "[source pool tidak valid]" {
		t.Fatalf("bad source pool: %d %v", code, body)
	}
	code, body := do(t, koko, "POST", briefBookings, valid)
	if code != 200 {
		t.Fatalf("create booking: %d %v", code, body)
	}
	bkg := body["id"].(string)
	if body["assigned_coordinator"] != "EMP-KOKO" {
		t.Fatalf("self-claim coordinator = %v, want EMP-KOKO", body["assigned_coordinator"])
	}
	booking := srv.URL + "/api/v1/bookings/" + bkg

	// --- Reads (§10.1): Coordinator + owning AM + OD see it; foreign no.
	if code, _ := do(t, koko, "GET", booking, nil); code != 200 {
		t.Fatalf("coordinator GET booking: want 200")
	}
	if code, _ := do(t, amel, "GET", booking, nil); code != 200 {
		t.Fatalf("owner AM GET booking: want 200")
	}
	if code, _ := do(t, odi, "GET", briefBookings, nil); code != 200 {
		t.Fatalf("OD list bookings: want 200")
	}
	if code, body := do(t, budi, "GET", booking, nil); code != 403 || body["message"] != "[anda tidak memiliki akses ke booking ini]" {
		t.Fatalf("foreign GET booking: %d %v", code, body)
	}

	// --- Post-Coordinator lock: another KOL staff (not the Coordinator) cannot drive.
	if code, body := do(t, kiki, "POST", booking+"/book", nil); code != 403 || body["message"] != "[anda tidak memiliki akses untuk mengerjakan booking ini]" {
		t.Fatalf("non-coordinator book: %d %v", code, body)
	}
	// Coordinator drives the native chain: Book -> StartContent -> SubmitContent.
	if code, _ := do(t, koko, "POST", booking+"/book", nil); code != 200 {
		t.Fatalf("coordinator book: want 200")
	}
	// First Booking left [Sourcing] -> Brief rolled up to [In Progress].
	if st := briefStatusTC(t, "BRF-KO"); st != "[In Progress]" {
		t.Fatalf("brief roll-up after book = %s want [In Progress]", st)
	}
	if code, _ := do(t, koko, "POST", booking+"/start-content", nil); code != 200 {
		t.Fatalf("start-content: want 200")
	}
	// SubmitContent requires a content link.
	if code, body := do(t, koko, "POST", booking+"/submit-content", map[string]any{"content_link": ""}); code != 422 || body["message"] != "[link konten wajib diisi sebelum submit]" {
		t.Fatalf("submit no link: %d %v", code, body)
	}
	if code, _ := do(t, koko, "POST", booking+"/submit-content", map[string]any{"content_link": "https://tt/1"}); code != 200 {
		t.Fatalf("submit-content: want 200")
	}

	// --- QC by KOL itself (§5): send to QC, then FailQC (feedback) then Resubmit.
	if code, _ := do(t, koko, "POST", booking+"/send-qc", nil); code != 200 {
		t.Fatalf("send-qc: want 200")
	}
	if code, body := do(t, koko, "POST", booking+"/fail-qc", map[string]any{"qc_notes": ""}); code != 422 || body["message"] != "[catatan QC wajib diisi]" {
		t.Fatalf("fail-qc no notes: %d %v", code, body)
	}
	if code, _ := do(t, koko, "POST", booking+"/fail-qc", map[string]any{"qc_notes": "audio buruk"}); code != 200 {
		t.Fatalf("fail-qc: want 200")
	}
	if code, _ := do(t, koko, "POST", booking+"/resubmit", map[string]any{"content_link": "https://tt/2"}); code != 200 {
		t.Fatalf("resubmit: want 200")
	}
	// Send to QC again; the revision cap (1) is reached -> FailQC blocked, must Escalate.
	if code, _ := do(t, koko, "POST", booking+"/send-qc", nil); code != 200 {
		t.Fatalf("send-qc 2: want 200")
	}
	if code, body := do(t, koko, "POST", booking+"/fail-qc", map[string]any{"qc_notes": "masih buruk"}); code != 422 || body["message"] != "[batas revisi kreator tercapai, silakan eskalasi booking]" {
		t.Fatalf("fail-qc past cap: %d %v", code, body)
	}
	// Escalate is a lead-level action: Coordinator staff denied; KOL lead allowed.
	if code, body := do(t, koko, "POST", booking+"/escalate", map[string]any{"qc_notes": "unresponsive"}); code != 403 || body["message"] != "[anda tidak memiliki akses untuk mengeskalasi booking ini]" {
		t.Fatalf("coordinator escalate: %d %v", code, body)
	}
	if code, _ := do(t, kev, "POST", booking+"/escalate", map[string]any{"qc_notes": "unresponsive"}); code != 200 {
		t.Fatalf("lead escalate: want 200")
	}
	// ContinueFromEscalation (owning AM proxy): re-enter QC flow, then pass QC.
	if code, _ := do(t, amel, "POST", booking+"/continue", map[string]any{"content_link": "https://tt/3"}); code != 200 {
		t.Fatalf("AM continue-from-escalation: want 200")
	}
	if code, _ := do(t, koko, "POST", booking+"/send-qc", nil); code != 200 {
		t.Fatalf("send-qc 3: want 200")
	}
	if code, _ := do(t, koko, "POST", booking+"/pass-qc", nil); code != 200 {
		t.Fatalf("pass-qc: want 200")
	}

	// --- Booking metrics read gate.
	if code, _ := do(t, koko, "GET", booking+"/metrics", nil); code != 200 {
		t.Fatalf("coordinator booking metrics: want 200")
	}
	if code, _ := do(t, budi, "GET", booking+"/metrics", nil); code != 403 {
		t.Fatalf("foreign booking metrics: want 403")
	}

	// --- Attributed GMV write-back (§10.3 / M9-OA-4): Coordinator/Director record;
	// foreign denied; negative rejected; the stored value reads back on GET booking.
	gmv := booking + "/attributed-gmv"
	if code, body := do(t, budi, "POST", gmv, map[string]any{"attributed_gmv": "5000000"}); code != 403 || body["message"] != "[anda tidak memiliki akses untuk mengerjakan booking ini]" {
		t.Fatalf("foreign record GMV: %d %v", code, body)
	}
	if code, body := do(t, koko, "POST", gmv, map[string]any{"attributed_gmv": "-1"}); code != 422 || body["message"] != "[nilai uang tidak valid]" {
		t.Fatalf("negative GMV: %d %v", code, body)
	}
	if code, body := do(t, koko, "POST", gmv, map[string]any{"attributed_gmv": "5000000"}); code != 200 || body["attributed_gmv_display"] != "Rp. 5.000.000,00" {
		t.Fatalf("coordinator record GMV: %d %v", code, body)
	}
	// Director may overwrite (latest reading wins).
	if code, _ := do(t, yohan, "POST", gmv, map[string]any{"attributed_gmv": "7500000"}); code != 200 {
		t.Fatalf("director overwrite GMV: want 200")
	}
	if code, body := do(t, koko, "GET", booking, nil); code != 200 || body["attributed_gmv"].(float64) != 7500000 {
		t.Fatalf("GET booking GMV read-back: %d %v", code, body)
	}

	// --- Creator Payment Request (§8): request side = Coordinator; Finance executes.
	// Amount must equal the Agreed Rate; details mandatory.
	if code, body := do(t, koko, "POST", booking+"/payment-request", map[string]any{"amount": "999", "payment_details": "BCA 123"}); code != 422 || body["message"] != "[jumlah pembayaran harus sama dengan Agreed Rate booking]" {
		t.Fatalf("amount mismatch: %d %v", code, body)
	}
	code, body = do(t, koko, "POST", booking+"/payment-request", map[string]any{"amount": "1500000", "payment_details": "BCA 123"})
	if code != 200 {
		t.Fatalf("create payment request: %d %v", code, body)
	}
	cpr := body["id"].(string)
	pr := srv.URL + "/api/v1/payment-requests/" + cpr
	// Finance-side edges: a non-Finance KOL staff cannot receive; Finance can.
	if code, body := do(t, koko, "POST", pr+"/receive", nil); code != 403 || body["message"] != "[anda tidak memiliki akses untuk memproses permintaan pembayaran ini]" {
		t.Fatalf("coordinator receive: %d %v", code, body)
	}
	if code, _ := do(t, fina, "POST", pr+"/receive", nil); code != 200 {
		t.Fatalf("finance receive: want 200")
	}
	// Reject requires a reason; then Finance may pay a fresh request instead.
	if code, body := do(t, fina, "POST", pr+"/reject", map[string]any{"reason": ""}); code != 422 || body["message"] != "[alasan penolakan wajib diisi]" {
		t.Fatalf("reject no reason: %d %v", code, body)
	}
	if code, _ := do(t, fina, "POST", pr+"/pay", nil); code != 200 {
		t.Fatalf("finance pay: want 200")
	}
	// GetPaymentRequest: owning AM (booking read gate) + Finance may read.
	if code, _ := do(t, amel, "GET", pr, nil); code != 200 {
		t.Fatalf("AM GET payment request: want 200")
	}

	// --- Creator List (§6): generate (Coordinator/AM/Director) + read; link mandatory.
	creatorList := srv.URL + "/api/v1/briefs/BRF-KO/creator-list"
	if code, body := do(t, koko, "POST", creatorList, map[string]any{"link": ""}); code != 422 || body["message"] != "[link Creator List wajib diisi]" {
		t.Fatalf("creator list no link: %d %v", code, body)
	}
	if code, _ := do(t, budi, "POST", creatorList, map[string]any{"link": "https://drive/x"}); code != 403 {
		t.Fatalf("foreign generate creator list: want 403")
	}
	code, body = do(t, koko, "POST", creatorList, map[string]any{"link": "https://drive/x"})
	if code != 200 {
		t.Fatalf("generate creator list: %d %v", code, body)
	}
	// The passed Booking is eligible + included in the compiled snapshot.
	if len(body["included_bookings"].([]any)) != 1 {
		t.Fatalf("creator list included = %v, want 1", body["included_bookings"])
	}
	if code, _ := do(t, yohan, "GET", creatorList, nil); code != 200 {
		t.Fatalf("director GET creator list: want 200")
	}
}
