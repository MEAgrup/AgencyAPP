package module4_client

// W1-13 tests: the Payment-Intent handoff (M4 §5). DB-backed, following the
// fixture pattern in client_test.go / lock_test.go.

import (
	"context"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/module5_finance"
)

// seedClientWithTrx inserts a client with its linked Transaction (as M0
// closing would produce it against the 0002 schema) at [Menunggu Verifikasi].
func seedClientWithTrx(t *testing.T, s *Service, clientID, trxID, salesPIC string) {
	t.Helper()
	ctx := context.Background()
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
		  total_sales, sales_pic_id, commission_payment_pic_id, transaction_id, created_by)
		 VALUES (?, 'PIC', ?, 'Kota', 'link', 'Fashion', '10000000.00', '20000000.00', '0.00', ?, ?, ?, 'TEST')`,
		clientID, clientID, salesPIC, salesPIC, trxID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO transactions (id, client_id, payment_intent_scheme, total_agreed_value, payment_status, created_by)
		 VALUES (?, ?, ?, '20000000.00', ?, 'TEST')`,
		trxID, clientID, module5_finance.SchemeLunas, module5_finance.TrxMenungguVerifikasi); err != nil {
		t.Fatal(err)
	}
}

func countIntentAudit(t *testing.T, s *Service, entityType, entityID, action string) int {
	t.Helper()
	var n int
	if err := s.DB.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM audit_log WHERE entity_type = ? AND entity_id = ? AND action = ?`,
		entityType, entityID, action).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestSetPaymentIntent_FourValidOptions(t *testing.T) {
	s := newService(t)
	budi := salesStaff("EMP-BUDI")

	for i, intent := range []string{IntentLunas, IntentBayarSebagian, IntentTermin, IntentBayarDiBelakang} {
		clientID := clientIDFor(i)
		trxID := trxIDFor(i)
		seedClientWithTrx(t, s, clientID, trxID, "EMP-BUDI")

		if err := s.SetPaymentIntent(context.Background(), budi, clientID, intent); err != nil {
			t.Fatalf("SetPaymentIntent(%q): %v", intent, err)
		}

		var storedClient, storedTrx string
		if err := s.DB.QueryRowContext(context.Background(),
			`SELECT payment_intent FROM clients WHERE id = ?`, clientID).Scan(&storedClient); err != nil {
			t.Fatal(err)
		}
		if err := s.DB.QueryRowContext(context.Background(),
			`SELECT payment_intent_scheme FROM transactions WHERE id = ?`, trxID).Scan(&storedTrx); err != nil {
			t.Fatal(err)
		}
		if storedClient != intent {
			t.Errorf("client payment_intent = %q, want %q", storedClient, intent)
		}
		if storedTrx != intent {
			t.Errorf("transaction payment_intent_scheme = %q, want %q", storedTrx, intent)
		}
		if got := countIntentAudit(t, s, "client", clientID, "payment_intent:set"); got != 1 {
			t.Errorf("client audit rows = %d, want 1", got)
		}
		if got := countIntentAudit(t, s, "transaction", trxID, "payment_intent_scheme:set"); got != 1 {
			t.Errorf("transaction audit rows = %d, want 1", got)
		}
	}
}

func clientIDFor(i int) string { return "CLI-INTENT-" + itoaTest(i) }
func trxIDFor(i int) string    { return "TRX-INTENT-" + itoaTest(i) }
func itoaTest(i int) string {
	digits := "0123456789"
	if i == 0 {
		return "0"
	}
	out := ""
	for i > 0 {
		out = string(digits[i%10]) + out
		i /= 10
	}
	return out
}

func TestSetPaymentIntent_InvalidOptionRejected(t *testing.T) {
	s := newService(t)
	seedClientWithTrx(t, s, "CLI-BAD", "TRX-BAD", "EMP-BUDI")

	err := s.SetPaymentIntent(context.Background(), salesStaff("EMP-BUDI"), "CLI-BAD", "[Bayar Sebulan Sekali]")
	if err != ErrInvalidField {
		t.Fatalf("invalid option err = %v, want ErrInvalidField", err)
	}
}

func TestSetPaymentIntent_AuthorityMatrix(t *testing.T) {
	s := newService(t)
	seedClientWithTrx(t, s, "CLI-AUTH", "TRX-AUTH", "EMP-BUDI")

	denied := []permission.Actor{
		salesStaff("EMP-ANDI"),   // other salesperson
		salesLead("EMP-DEWI"),    // sales lead, not this client's PIC
		accountStaff("EMP-AMEL"), // Account
		odActor("EMP-ODI"),       // OD (read-only)
		{EmployeeID: "EMP-FIN", Role: permission.Role{Division: "Finance", Level: permission.LevelStaff}},
	}
	for _, actor := range denied {
		if err := s.SetPaymentIntent(context.Background(), actor, "CLI-AUTH", IntentTermin); err != ErrIntentForbidden {
			t.Errorf("actor %+v err = %v, want ErrIntentForbidden", actor.Role, err)
		}
	}

	// An allocation member (not Primary) is also denied.
	if _, err := s.DB.ExecContext(context.Background(),
		`INSERT INTO client_sales_allocations (client_id, salesperson_id, basis_points, created_by) VALUES ('CLI-AUTH', 'EMP-CITRA', 5000, 'TEST')`); err != nil {
		t.Fatal(err)
	}
	if err := s.SetPaymentIntent(context.Background(), salesStaff("EMP-CITRA"), "CLI-AUTH", IntentTermin); err != ErrIntentForbidden {
		t.Errorf("allocation-member (non-primary) err = %v, want ErrIntentForbidden", err)
	}

	// The owning Primary Sales PIC succeeds.
	if err := s.SetPaymentIntent(context.Background(), salesStaff("EMP-BUDI"), "CLI-AUTH", IntentTermin); err != nil {
		t.Errorf("owning sales PIC err = %v, want nil", err)
	}
}

func TestSetPaymentIntent_DirectorAllowed(t *testing.T) {
	s := newService(t)
	seedClientWithTrx(t, s, "CLI-DIR", "TRX-DIR", "EMP-BUDI")

	if err := s.SetPaymentIntent(context.Background(), directorActor("EMP-YOHAN"), "CLI-DIR", IntentBayarSebagian); err != nil {
		t.Fatalf("director SetPaymentIntent: %v", err)
	}
}

func TestSetPaymentIntent_LockedAfterVerification(t *testing.T) {
	s := newService(t)
	seedClientWithTrx(t, s, "CLI-LOCK", "TRX-LOCK", "EMP-BUDI")

	// Simulate Finance having already recorded a verification event.
	if _, err := s.DB.ExecContext(context.Background(),
		`INSERT INTO payment_verifications (transaction_id, amount, received_date, verified_by, created_by)
		 VALUES ('TRX-LOCK', '5000000.00', '2026-06-01', 'EMP-FIN', 'TEST')`); err != nil {
		t.Fatal(err)
	}

	err := s.SetPaymentIntent(context.Background(), salesStaff("EMP-BUDI"), "CLI-LOCK", IntentTermin)
	if err != ErrIntentLocked {
		t.Fatalf("after verification err = %v, want ErrIntentLocked (use Finance ChangeScheme)", err)
	}

	// Also locked once the transaction itself has moved off [Menunggu Verifikasi],
	// even with zero verification rows (defensive: scheme already authoritative).
	seedClientWithTrx(t, s, "CLI-LOCK2", "TRX-LOCK2", "EMP-BUDI")
	if _, err := s.DB.ExecContext(context.Background(),
		`UPDATE transactions SET payment_status = ? WHERE id = 'TRX-LOCK2'`, module5_finance.TrxLunas); err != nil {
		t.Fatal(err)
	}
	if err := s.SetPaymentIntent(context.Background(), salesStaff("EMP-BUDI"), "CLI-LOCK2", IntentTermin); err != ErrIntentLocked {
		t.Fatalf("status moved on err = %v, want ErrIntentLocked", err)
	}
}

func TestSetPaymentIntent_DoesNotReleaseToAccount(t *testing.T) {
	s := newService(t)
	seedClientWithTrx(t, s, "CLI-PRE", "TRX-PRE", "EMP-BUDI")

	if err := s.SetPaymentIntent(context.Background(), salesStaff("EMP-BUDI"), "CLI-PRE", IntentTermin); err != nil {
		t.Fatalf("SetPaymentIntent: %v", err)
	}

	// Pre-verification: still invisible to Account (M5 §5 Rule 2 / W1-13 AC).
	if canSee(t, s, accountStaff("EMP-AM"), "CLI-PRE") {
		t.Errorf("Account must NOT see the client after intent alone, before Finance verification")
	}
	var released *string
	if err := s.DB.QueryRowContext(context.Background(),
		`SELECT released_to_account_at FROM clients WHERE id = 'CLI-PRE'`).Scan(&released); err != nil {
		t.Fatal(err)
	}
	if released != nil {
		t.Errorf("released_to_account_at should stay NULL, got %v", *released)
	}

	// Audit read path sanity.
	if _, err := audit.List(context.Background(), s.DB, audit.Filter{EntityType: "client", EntityID: "CLI-PRE"}); err != nil {
		t.Fatalf("audit.List: %v", err)
	}
}
