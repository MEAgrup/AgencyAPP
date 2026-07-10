package httpapi_test

// HTTP-level tests for the Stage 3 endpoints (W1-13 payment-intent handoff,
// W1-17 reminder dashboard/scan, W1-18 [Bermasalah] flag + resolve). Reuses
// the Module 5 fixture (setupFin / seedFinTrx) from finance_handlers_test.go —
// same package, same server wiring, same fixture employees.

import (
	"context"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

// seedIntentClient inserts a client + linked Transaction at [Menunggu
// Verifikasi] with no verifications yet — the payment-intent-handoff-eligible
// state (W1-13).
func seedIntentClient(t *testing.T, clientID, trxID, salesPIC string) {
	t.Helper()
	d := testutil.DB(t)
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
		  total_sales, sales_pic_id, commission_payment_pic_id, transaction_id, created_by)
		 VALUES (?, 'PIC', ?, 'Kota', 'link', 'Fashion', '10000000.00', '20000000.00', '0.00', ?, ?, ?, 'TEST')`,
		clientID, clientID, salesPIC, salesPIC, trxID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO transactions (id, client_id, payment_intent_scheme, total_agreed_value, payment_status, created_by)
		 VALUES (?, ?, '[Bayar Penuh (Lunas)]', '20000000.00', '[Menunggu Verifikasi]', 'TEST')`,
		trxID, clientID); err != nil {
		t.Fatal(err)
	}
}

func TestSetPaymentIntent_HTTP(t *testing.T) {
	srv, done := setupFin(t)
	defer done()
	d := testutil.DB(t)
	seedIntentClient(t, "CLI-PI", "TRX-PI", "EMP-BUDI")

	// Non-owner sales denied.
	andi := login(t, srv, "andi@mea.co.id")
	if code, body := do(t, andi, "POST", srv.URL+"/api/v1/clients/CLI-PI/payment-intent",
		map[string]any{"payment_intent": "[Termin]"}); code != 403 {
		t.Fatalf("non-owner sales = %d %v, want 403", code, body)
	}
	// Sales lead (not the PIC) denied.
	dewi := login(t, srv, "dewi@mea.co.id")
	if code, _ := do(t, dewi, "POST", srv.URL+"/api/v1/clients/CLI-PI/payment-intent",
		map[string]any{"payment_intent": "[Termin]"}); code != 403 {
		t.Errorf("sales lead (non-PIC) = %d, want 403", code)
	}
	// Finance/Account denied.
	fin := login(t, srv, "fin@mea.co.id")
	if code, _ := do(t, fin, "POST", srv.URL+"/api/v1/clients/CLI-PI/payment-intent",
		map[string]any{"payment_intent": "[Termin]"}); code != 403 {
		t.Errorf("finance = %d, want 403", code)
	}
	amel := login(t, srv, "amel@mea.co.id")
	if code, _ := do(t, amel, "POST", srv.URL+"/api/v1/clients/CLI-PI/payment-intent",
		map[string]any{"payment_intent": "[Termin]"}); code != 403 {
		t.Errorf("account = %d, want 403", code)
	}

	// Invalid option -> 422 exact message.
	budi := login(t, srv, "budi@mea.co.id")
	code, body := do(t, budi, "POST", srv.URL+"/api/v1/clients/CLI-PI/payment-intent",
		map[string]any{"payment_intent": "[Bayar Nanti Saja]"})
	if code != 422 || body["message"] != "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" {
		t.Fatalf("invalid option = %d %v", code, body)
	}

	// Owning Sales PIC succeeds.
	code, body = do(t, budi, "POST", srv.URL+"/api/v1/clients/CLI-PI/payment-intent",
		map[string]any{"payment_intent": "[Termin]"})
	if code != 200 {
		t.Fatalf("owner intent = %d %v", code, body)
	}
	client := body["client"].(map[string]any)
	if client["payment_intent"] != "[Termin]" {
		t.Errorf("payment_intent = %v, want [Termin]", client["payment_intent"])
	}

	// The transaction still sits in Finance's queue (handoff, not verification).
	code, body = do(t, fin, "GET", srv.URL+"/api/v1/finance/queue", nil)
	if code != 200 {
		t.Fatalf("finance queue = %d", code)
	}
	found := false
	for _, raw := range body["data"].([]any) {
		if raw.(map[string]any)["id"] == "TRX-PI" {
			found = true
		}
	}
	if !found {
		t.Errorf("TRX-PI should be in the finance queue after intent handoff")
	}

	// Account still cannot see the client (pre-verification, M5 §5 Rule 2).
	if code, _ := do(t, amel, "GET", srv.URL+"/api/v1/clients/CLI-PI", nil); code != 404 {
		t.Errorf("account GET pre-release client = %d, want 404", code)
	}

	// Once Finance has recorded a verification, the scheme belongs to Finance —
	// insert the verification event directly (equivalent to Finance having used
	// POST .../verify) rather than re-driving the whole verify flow here.
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO payment_verifications (transaction_id, amount, received_date, verified_by, created_by)
		 VALUES ('TRX-PI', '5000000.00', '2026-06-03', 'EMP-FIN', 'TEST')`); err != nil {
		t.Fatal(err)
	}
	code, body = do(t, budi, "POST", srv.URL+"/api/v1/clients/CLI-PI/payment-intent",
		map[string]any{"payment_intent": "[Bayar Sebagian]"})
	if code != 409 || body["message"] != "[transaksi sudah diverifikasi, perubahan skema pembayaran selanjutnya melalui Finance]" {
		t.Fatalf("post-verification intent change = %d %v, want 409 locked message", code, body)
	}
}

// TestLayeredSalesStaffPlusOD_PaymentIntentStaysStaffScoped (FIX6, DoD layered-
// role coverage): Budi is an ordinary Sales staff account, ALSO layered OD.
// The intent handoff is a staff-scoped write (the client's Primary Sales
// PIC) — the OD layer (read-only) grants no extra write authority here, but
// it also does not take the existing staff-scope write away: Budi, still the
// owning Sales PIC, may set the intent exactly as before.
func TestLayeredSalesStaffPlusOD_PaymentIntentStaysStaffScoped(t *testing.T) {
	srv, done := setupFin(t)
	defer done()
	d := testutil.DB(t)
	testutil.InsertLayeredRole(t, d, "EMP-BUDI", "od")
	seedIntentClient(t, "CLI-LSOD", "TRX-LSOD", "EMP-BUDI")

	budi := login(t, srv, "budi@mea.co.id")
	code, body := do(t, budi, "POST", srv.URL+"/api/v1/clients/CLI-LSOD/payment-intent",
		map[string]any{"payment_intent": "[Termin]"})
	if code != 200 {
		t.Fatalf("layered staff+OD intent on own client = %d %v, want 200 (staff-scope write preserved)", code, body)
	}
}

func TestReminderDashboardAndScan_HTTP(t *testing.T) {
	srv, done := setupFin(t)
	defer done()

	seedFinTrx(t, "CLI-RD", "TRX-RD", "[Termin]", "15000000.00", true)
	d := testutil.DB(t)
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO installments (id, transaction_id, installment_no, amount, due_date, status, created_by)
		 VALUES ('INST-RD', 'TRX-RD', 1, '15000000.00', '2026-06-17', '[Belum Jatuh Tempo]', 'TEST')`); err != nil {
		t.Fatal(err)
	}

	// Account is not an audience of M5 §6 -> 403.
	amel := login(t, srv, "amel@mea.co.id")
	if code, _ := do(t, amel, "GET", srv.URL+"/api/v1/finance/reminders", nil); code != 403 {
		t.Errorf("account reminders = %d, want 403", code)
	}
	// Finance sees the dashboard.
	fin := login(t, srv, "fin@mea.co.id")
	code, body := do(t, fin, "GET", srv.URL+"/api/v1/finance/reminders", nil)
	if code != 200 {
		t.Fatalf("finance reminders = %d %v", code, body)
	}
	if _, ok := body["reminders"]; !ok {
		t.Errorf("response missing reminders key: %v", body)
	}
	if _, ok := body["outstanding_no_due_date"]; !ok {
		t.Errorf("response missing outstanding_no_due_date key: %v", body)
	}

	// Scan endpoint: Sales denied, Finance allowed.
	budi := login(t, srv, "budi@mea.co.id")
	if code, _ := do(t, budi, "POST", srv.URL+"/api/v1/finance/reminders/scan", nil); code != 403 {
		t.Errorf("sales scan = %d, want 403", code)
	}
	code, body = do(t, fin, "POST", srv.URL+"/api/v1/finance/reminders/scan", nil)
	if code != 200 {
		t.Fatalf("finance scan = %d %v", code, body)
	}
}

func TestBermasalah_HTTP(t *testing.T) {
	srv, done := setupFin(t)
	defer done()
	seedFinTrx(t, "CLI-BMH", "TRX-BMH", "[Bayar Penuh (Lunas)]", "20000000.00", true)

	budi := login(t, srv, "budi@mea.co.id")
	fin := login(t, srv, "fin@mea.co.id")

	// Sales cannot flag.
	if code, _ := do(t, budi, "POST", srv.URL+"/api/v1/transactions/TRX-BMH/bermasalah",
		map[string]any{"reason": "komplain"}); code != 403 {
		t.Errorf("sales flag = %d, want 403", code)
	}
	// Missing reason -> 422.
	if code, body := do(t, fin, "POST", srv.URL+"/api/v1/transactions/TRX-BMH/bermasalah",
		map[string]any{}); code != 422 || body["message"] != "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" {
		t.Errorf("no-reason flag = %d %v", code, body)
	}
	// Finance flags successfully.
	if code, body := do(t, fin, "POST", srv.URL+"/api/v1/transactions/TRX-BMH/bermasalah",
		map[string]any{"reason": "pembayaran direversal"}); code != 200 {
		t.Fatalf("finance flag = %d %v", code, body)
	}

	// GET status: visibility follows TRX visibility; Sales owner can see it.
	code, body := do(t, budi, "GET", srv.URL+"/api/v1/transactions/TRX-BMH/bermasalah", nil)
	if code != 200 {
		t.Fatalf("get bermasalah status = %d %v", code, body)
	}
	if body["flagged"] != true {
		t.Errorf("flagged = %v, want true", body["flagged"])
	}

	// Staff cannot vote.
	if code, _ := do(t, fin, "POST", srv.URL+"/api/v1/transactions/TRX-BMH/bermasalah/resolve",
		map[string]any{"decision": "setuju"}); code != 403 {
		t.Errorf("finance staff vote = %d, want 403", code)
	}

	finhead := login(t, srv, "finhead@mea.co.id")
	if code, body := do(t, finhead, "POST", srv.URL+"/api/v1/transactions/TRX-BMH/bermasalah/resolve",
		map[string]any{"decision": "setuju", "note": "sudah dicek"}); code != 200 {
		t.Fatalf("finance lead vote = %d %v", code, body)
	}
	// Still flagged: only one SPV voted.
	code, body = do(t, fin, "GET", srv.URL+"/api/v1/transactions/TRX-BMH/bermasalah", nil)
	if body["flagged"] != true {
		t.Errorf("flagged after one SPV vote = %v, want true", body["flagged"])
	}

	// Account has no SPV/lead role in this fixture, so use Director to finish
	// the resolution path via the Director override instead.
	yohan := login(t, srv, "yohan@mea.co.id")
	if code, body := do(t, yohan, "POST", srv.URL+"/api/v1/transactions/TRX-BMH/bermasalah/resolve",
		map[string]any{"decision": "setuju", "note": "final"}); code != 200 {
		t.Fatalf("director vote = %d %v", code, body)
	}
	code, body = do(t, fin, "GET", srv.URL+"/api/v1/transactions/TRX-BMH/bermasalah", nil)
	if body["flagged"] != false {
		t.Errorf("flagged after director resolves = %v, want false", body["flagged"])
	}
}
