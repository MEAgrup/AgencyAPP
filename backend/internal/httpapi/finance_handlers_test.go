package httpapi_test

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/auth"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/httpapi"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

// financeAuth maps fixture emails (password "rahasia123") to employee ids for the
// Module 5 endpoint tests. Includes Finance roles the M4 fixture lacks.
type financeAuth struct{}

func (financeAuth) Verify(_ context.Context, email, password string) (string, error) {
	if password != "rahasia123" {
		return "", auth.ErrInvalidCredentials
	}
	m := map[string]string{
		"fin@mea.co.id":     "EMP-FIN",     // Finance staff
		"finhead@mea.co.id": "EMP-FINHEAD", // Finance lead
		"budi@mea.co.id":    "EMP-BUDI",    // Sales staff (owns the client)
		"andi@mea.co.id":    "EMP-ANDI",    // Sales staff (non-owner)
		"dewi@mea.co.id":    "EMP-DEWI",    // Sales lead
		"amel@mea.co.id":    "EMP-AMEL",    // Account staff
		"cakra@mea.co.id":   "EMP-CAKRA",   // Creative staff (no access)
		"odi@mea.co.id":     "EMP-ODI",     // OD (layered)
		"yohan@mea.co.id":   "EMP-YOHAN",   // Director (layered)
	}
	if id, ok := m[email]; ok {
		return id, nil
	}
	return "", auth.ErrInvalidCredentials
}

func setupFin(t *testing.T) (*httptest.Server, func()) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	testutil.InsertRoleMapping(t, d, "Finance", "Finance Staff", "Finance", "staff")
	testutil.InsertRoleMapping(t, d, "Finance", "Finance Head", "Finance", "lead")
	testutil.InsertRoleMapping(t, d, "Sales", "Sales Executive", "Sales", "staff")
	testutil.InsertRoleMapping(t, d, "Sales", "Sales Head", "Sales", "lead")
	testutil.InsertRoleMapping(t, d, "Account", "Account Manager", "Account", "staff")
	testutil.InsertRoleMapping(t, d, "Creative", "Creative Designer", "Creative", "staff")
	testutil.InsertEmployee(t, d, "EMP-FIN", "Fina", "fin@mea.co.id", "Finance", "Finance Staff", true)
	testutil.InsertEmployee(t, d, "EMP-FINHEAD", "Firman", "finhead@mea.co.id", "Finance", "Finance Head", true)
	testutil.InsertEmployee(t, d, "EMP-BUDI", "Budi", "budi@mea.co.id", "Sales", "Sales Executive", true)
	testutil.InsertEmployee(t, d, "EMP-ANDI", "Andi", "andi@mea.co.id", "Sales", "Sales Executive", true)
	testutil.InsertEmployee(t, d, "EMP-DEWI", "Dewi", "dewi@mea.co.id", "Sales", "Sales Head", true)
	testutil.InsertEmployee(t, d, "EMP-AMEL", "Amel", "amel@mea.co.id", "Account", "Account Manager", true)
	testutil.InsertEmployee(t, d, "EMP-CAKRA", "Cakra", "cakra@mea.co.id", "Creative", "Creative Designer", true)
	testutil.InsertEmployee(t, d, "EMP-ODI", "Odi", "odi@mea.co.id", "Management", "OD", true)
	testutil.InsertEmployee(t, d, "EMP-YOHAN", "Yohan", "yohan@mea.co.id", "Management", "Director", true)
	testutil.InsertLayeredRole(t, d, "EMP-ODI", "od")
	testutil.InsertLayeredRole(t, d, "EMP-YOHAN", "director")

	app := httpapi.New(d, statemachine.New(), notification.NewCatalog(), financeAuth{}, nil)
	srv := httptest.NewServer(app.Router())
	return srv, srv.Close
}

// seedFinTrx inserts a client + transaction. released stamps both released_at.
func seedFinTrx(t *testing.T, clientID, trxID, scheme, total string, released bool) {
	t.Helper()
	d := testutil.DB(t)
	rel := "NULL"
	if released {
		rel = "NOW()"
	}
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
		  total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, created_by)
		 VALUES (?, 'PIC', ?, 'Kota', 'link', 'Fashion', '0.00', '0.00', '0.00', 'EMP-BUDI', 'EMP-BUDI', `+rel+`, 'TEST')`,
		clientID, clientID); err != nil {
		t.Fatal(err)
	}
	status := "[Menunggu Verifikasi]"
	if released {
		status = "[Terverifikasi - Sebagian]"
	}
	if _, err := d.ExecContext(context.Background(),
		`INSERT INTO transactions (id, client_id, payment_intent_scheme, total_agreed_value, payment_status, released_to_account_at, created_by)
		 VALUES (?, ?, ?, ?, ?, `+rel+`, 'TEST')`,
		trxID, clientID, scheme, total, status); err != nil {
		t.Fatal(err)
	}
}

func TestFinanceQueue_Permission(t *testing.T) {
	srv, done := setupFin(t)
	defer done()
	seedFinTrx(t, "CLI-Q", "TRX-Q", "[Bayar Sebagian]", "30000000.00", false)

	for _, tc := range []struct {
		email string
		want  int
	}{
		{"fin@mea.co.id", 200}, {"odi@mea.co.id", 200}, {"yohan@mea.co.id", 200},
		{"budi@mea.co.id", 403}, {"amel@mea.co.id", 403},
	} {
		c := login(t, srv, tc.email)
		if code, _ := do(t, c, "GET", srv.URL+"/api/v1/finance/queue", nil); code != tc.want {
			t.Errorf("%s queue = %d, want %d", tc.email, code, tc.want)
		}
	}
	// The awaiting-verification transaction appears for Finance.
	fin := login(t, srv, "fin@mea.co.id")
	_, body := do(t, fin, "GET", srv.URL+"/api/v1/finance/queue", nil)
	if data, _ := body["data"].([]any); len(data) != 1 {
		t.Fatalf("queue len = %d, want 1", len(body["data"].([]any)))
	}
}

func TestGetTransaction_Visibility(t *testing.T) {
	srv, done := setupFin(t)
	defer done()
	seedFinTrx(t, "CLI-PRE", "TRX-PRE", "[Bayar Sebagian]", "30000000.00", false) // pre-release
	seedFinTrx(t, "CLI-REL", "TRX-REL", "[Bayar Sebagian]", "30000000.00", true)  // released

	// Pre-release: owner Sales + Finance + Director see it; Account + non-owner 404.
	for _, tc := range []struct {
		email string
		want  int
	}{
		{"budi@mea.co.id", 200}, {"fin@mea.co.id", 200}, {"yohan@mea.co.id", 200},
		{"andi@mea.co.id", 404}, {"amel@mea.co.id", 404},
		{"cakra@mea.co.id", 403}, // execution division: no M5 access at all
	} {
		c := login(t, srv, tc.email)
		if code, _ := do(t, c, "GET", srv.URL+"/api/v1/transactions/TRX-PRE", nil); code != tc.want {
			t.Errorf("%s GET pre-release = %d, want %d", tc.email, code, tc.want)
		}
	}
	// Released: Account can now read it; money renders house-style.
	amel := login(t, srv, "amel@mea.co.id")
	code, body := do(t, amel, "GET", srv.URL+"/api/v1/transactions/TRX-REL", nil)
	if code != 200 {
		t.Fatalf("account GET released = %d, want 200", code)
	}
	trx := body["transaction"].(map[string]any)
	if trx["total_agreed_value"] != "Rp. 30.000.000,00" {
		t.Errorf("total render = %v", trx["total_agreed_value"])
	}
}

func TestVerify_PermissionAndHappyPath(t *testing.T) {
	srv, done := setupFin(t)
	defer done()
	seedFinTrx(t, "CLI-VP", "TRX-VP", "[Bayar Sebagian]", "30000000.00", false)

	verify := func(email, amount string) (int, map[string]any) {
		c := login(t, srv, email)
		return do(t, c, "POST", srv.URL+"/api/v1/transactions/TRX-VP/verify",
			map[string]any{"amount": amount, "received_date": "2026-06-03"})
	}

	// Non-finance denied (Sales owner, Account, OD).
	for _, email := range []string{"budi@mea.co.id", "amel@mea.co.id", "odi@mea.co.id"} {
		if code, body := verify(email, "1000000.00"); code != 403 || body["message"] != statemachine.RoleDeniedMessage {
			t.Errorf("%s verify = %d %v, want 403 + role-denied", email, code, body)
		}
	}
	// Finance staff verifies -> partial, outstanding recomputed.
	code, body := verify("fin@mea.co.id", "10000000.00")
	if code != 200 {
		t.Fatalf("finance verify = %d %v", code, body)
	}
	trx := body["transaction"].(map[string]any)
	if trx["payment_status"] != "[Terverifikasi - Sebagian]" {
		t.Errorf("status = %v", trx["payment_status"])
	}
	if trx["amount_outstanding"] != "Rp. 20.000.000,00" {
		t.Errorf("outstanding = %v", trx["amount_outstanding"])
	}

	// Over-verification on a fresh transaction -> exact message.
	seedFinTrx(t, "CLI-OV", "TRX-OV", "[Bayar Sebagian]", "30000000.00", false)
	fin := login(t, srv, "fin@mea.co.id")
	code, body = do(t, fin, "POST", srv.URL+"/api/v1/transactions/TRX-OV/verify",
		map[string]any{"amount": "40000000.00", "received_date": "2026-06-03"})
	if code != 422 || body["message"] != "[jumlah melebihi total transaksi, periksa kembali]" {
		t.Fatalf("over-verify = %d %v", code, body)
	}
}

func TestContractGate_HTTP(t *testing.T) {
	srv, done := setupFin(t)
	defer done()
	seedFinTrx(t, "CLI-LN", "TRX-LN", "[Bayar Penuh (Lunas)]", "20000000.00", false)
	fin := login(t, srv, "fin@mea.co.id")

	// Lunas verification without a contract is blocked with the exact message.
	code, body := do(t, fin, "POST", srv.URL+"/api/v1/transactions/TRX-LN/verify",
		map[string]any{"amount": "20000000.00", "received_date": "2026-06-03"})
	if code != 422 || body["message"] != "[kontrak belum diupload, lengkapi sebelum verifikasi penuh]" {
		t.Fatalf("lunas w/o contract = %d %v", code, body)
	}
	// Sales non-owner cannot attach; Finance can.
	andi := login(t, srv, "andi@mea.co.id")
	if code, _ := do(t, andi, "POST", srv.URL+"/api/v1/transactions/TRX-LN/contract", map[string]any{"contract_attachment": "x"}); code != 403 {
		t.Errorf("non-owner attach = %d, want 403", code)
	}
	if code, _ := do(t, fin, "POST", srv.URL+"/api/v1/transactions/TRX-LN/contract", map[string]any{"contract_attachment": "https://drive/c"}); code != 200 {
		t.Fatalf("finance attach failed")
	}
	// Now the full verification reaches [Lunas].
	code, body = do(t, fin, "POST", srv.URL+"/api/v1/transactions/TRX-LN/verify",
		map[string]any{"amount": "20000000.00", "received_date": "2026-06-03"})
	if code != 200 {
		t.Fatalf("verify after contract = %d %v", code, body)
	}
	if body["transaction"].(map[string]any)["payment_status"] != "[Lunas]" {
		t.Errorf("status = %v, want [Lunas]", body["transaction"].(map[string]any)["payment_status"])
	}
}

func TestSchedule_HTTP(t *testing.T) {
	srv, done := setupFin(t)
	defer done()
	seedFinTrx(t, "CLI-SC", "TRX-SC", "[Termin]", "45000000.00", false)

	items := map[string]any{"items": []map[string]any{
		{"amount": "15000000.00", "due_date": "2026-06-03"},
		{"amount": "15000000.00", "due_date": "2026-06-17"},
		{"amount": "15000000.00", "due_date": "2026-07-01"},
	}}

	// Account staff cannot create a schedule.
	amel := login(t, srv, "amel@mea.co.id")
	if code, _ := do(t, amel, "POST", srv.URL+"/api/v1/transactions/TRX-SC/schedule", items); code != 403 {
		t.Errorf("account schedule = 403 expected")
	}
	// Owner Sales creates it.
	budi := login(t, srv, "budi@mea.co.id")
	code, body := do(t, budi, "POST", srv.URL+"/api/v1/transactions/TRX-SC/schedule", items)
	if code != 200 {
		t.Fatalf("sales owner schedule = %d %v", code, body)
	}
	if insts, _ := body["installments"].([]any); len(insts) != 3 {
		t.Fatalf("created %v installments, want 3", body["installments"])
	}
	// Double schedule -> 409.
	if code, _ := do(t, budi, "POST", srv.URL+"/api/v1/transactions/TRX-SC/schedule", items); code != 409 {
		t.Errorf("double schedule = %d, want 409", code)
	}

	// Σ termin != total -> exact 422 message.
	seedFinTrx(t, "CLI-MM", "TRX-MM", "[Termin]", "45000000.00", false)
	bad := map[string]any{"items": []map[string]any{
		{"amount": "15000000.00", "due_date": "2026-06-03"},
		{"amount": "25000000.00", "due_date": "2026-06-17"},
	}}
	code, body = do(t, budi, "POST", srv.URL+"/api/v1/transactions/TRX-MM/schedule", bad)
	if code != 422 || body["message"] != "[total termin tidak sama dengan nilai transaksi]" {
		t.Fatalf("mismatch schedule = %d %v", code, body)
	}
}

func TestScheme_HTTP(t *testing.T) {
	srv, done := setupFin(t)
	defer done()
	seedFinTrx(t, "CLI-CH", "TRX-CH", "[Bayar Penuh (Lunas)]", "20000000.00", false)

	// Finance staff cannot change scheme.
	fin := login(t, srv, "fin@mea.co.id")
	if code, _ := do(t, fin, "POST", srv.URL+"/api/v1/transactions/TRX-CH/scheme",
		map[string]any{"payment_intent_scheme": "[Termin]", "reason": "cicil"}); code != 403 {
		t.Errorf("finance staff scheme = 403 expected")
	}
	// Finance lead: missing reason -> 422.
	finhead := login(t, srv, "finhead@mea.co.id")
	if code, body := do(t, finhead, "POST", srv.URL+"/api/v1/transactions/TRX-CH/scheme",
		map[string]any{"payment_intent_scheme": "[Termin]"}); code != 422 || body["message"] != "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" {
		t.Errorf("no-reason scheme = %d %v", code, body)
	}
	// Finance lead with reason -> 200.
	if code, _ := do(t, finhead, "POST", srv.URL+"/api/v1/transactions/TRX-CH/scheme",
		map[string]any{"payment_intent_scheme": "[Termin]", "reason": "klien minta cicil"}); code != 200 {
		t.Errorf("finance lead scheme = 200 expected")
	}
}
