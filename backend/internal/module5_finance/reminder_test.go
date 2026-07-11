package module5_finance

// W1-17 tests: the reminder dashboard + dual-audience scan (M5 §6). DB-backed,
// following the fixture pattern in finance_db_test.go (newSvc, seedClient,
// seedTrx, the shared actor fixtures, day()).

import (
	"context"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

// seedClientWithCommissionPIC inserts a client whose Commission & Payment PIC
// may differ from the Primary Sales PIC (M4 §5 Rule 5 / OD-3) — collection
// reminders target the Commission & Payment PIC, not necessarily the PIC.
func seedClientWithCommissionPIC(t *testing.T, s *Service, clientID, salesPIC, commissionPIC string) {
	t.Helper()
	if _, err := s.DB.ExecContext(context.Background(),
		`INSERT INTO clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
		  total_sales, sales_pic_id, commission_payment_pic_id, created_by)
		 VALUES (?, 'PIC', ?, 'Kota', 'link', 'Fashion', '0.00', '0.00', '0.00', ?, ?, 'TEST')`,
		clientID, clientID, salesPIC, commissionPIC); err != nil {
		t.Fatal(err)
	}
}

// seedFinanceLead registers a Finance lead employee so leadsOfDivision (the
// notification catalog resolver) has someone to notify.
func seedFinanceLead(t *testing.T, s *Service, id string) {
	t.Helper()
	testutil.InsertRoleMapping(t, s.DB, "Finance", "Finance Head", "Finance", "lead")
	testutil.InsertEmployee(t, s.DB, id, "Finance Head", id+"@mea.co.id", "Finance", "Finance Head", true)
}

func insertInstallment(t *testing.T, s *Service, id, trxID string, no int, amount string, dueDate time.Time) {
	t.Helper()
	if _, err := s.DB.ExecContext(context.Background(),
		`INSERT INTO installments (id, transaction_id, installment_no, amount, due_date, status, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, 'TEST')`,
		id, trxID, no, amount, dueDate.Format("2006-01-02"), InstBelumJatuhTempo); err != nil {
		t.Fatal(err)
	}
}

func notifRecipients(t *testing.T, s *Service, entityType, entityID string, event notification.EventType) []string {
	t.Helper()
	rows, err := s.DB.QueryContext(context.Background(),
		`SELECT recipient_employee_id FROM notifications WHERE entity_type = ? AND entity_id = ? AND event_type = ?`,
		entityType, entityID, string(event))
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var r string
		if err := rows.Scan(&r); err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	return out
}

func installmentStatus(t *testing.T, s *Service, instID string) (status string, jatuhTempo bool) {
	t.Helper()
	var jt int
	if err := s.DB.QueryRowContext(context.Background(),
		`SELECT status, jatuh_tempo FROM installments WHERE id = ?`, instID).Scan(&status, &jt); err != nil {
		t.Fatal(err)
	}
	return status, jt != 0
}

// ── Worked example: M5 §6 — INST due 17 Jun, now = 20 Jun -> 3 days overdue ──
func TestScanReminders_OverdueWorkedExample(t *testing.T) {
	s := newSvc(t)
	cat := notification.NewCatalog()
	seedFinanceLead(t, s, "EMP-FINHEAD")
	seedClientWithCommissionPIC(t, s, "CLI-ALPHA", "EMP-BUDI", "EMP-BUDI")
	seedTrx(t, s, "TRX-ALPHA", "CLI-ALPHA", SchemeTermin, "15000000.00", "")
	insertInstallment(t, s, "INST-2", "TRX-ALPHA", 2, "15000000.00", day(2026, 6, 17))

	res, err := s.ScanReminders(context.Background(), cat, day(2026, 6, 20))
	if err != nil {
		t.Fatalf("ScanReminders: %v", err)
	}
	if res.OverdueFlagged != 1 {
		t.Errorf("OverdueFlagged = %d, want 1", res.OverdueFlagged)
	}

	status, jatuhTempo := installmentStatus(t, s, "INST-2")
	if status != InstJatuhTempo || !jatuhTempo {
		t.Fatalf("status=%q jatuh_tempo=%v, want [Jatuh Tempo]/true", status, jatuhTempo)
	}

	// Dual audience: Commission & Payment PIC (EMP-BUDI, explicit) AND Finance
	// lead (EMP-FINHEAD, division resolver) both notified (OD-3).
	recips := notifRecipients(t, s, "installment", "INST-2", notification.EvInstallmentDue)
	wantSet := map[string]bool{"EMP-BUDI": false, "EMP-FINHEAD": false}
	for _, r := range recips {
		if _, ok := wantSet[r]; ok {
			wantSet[r] = true
		}
	}
	for who, got := range wantSet {
		if !got {
			t.Errorf("expected %s among notified recipients, got %v", who, recips)
		}
	}

	// Dashboard label PERSIS the PRD example string.
	dash, err := s.Dashboard(context.Background(), cat, financeStaff, day(2026, 6, 20))
	if err != nil {
		t.Fatalf("Dashboard: %v", err)
	}
	var row *ReminderRow
	for i := range dash.Reminders {
		if dash.Reminders[i].InstallmentID == "INST-2" {
			row = &dash.Reminders[i]
		}
	}
	if row == nil {
		t.Fatalf("INST-2 missing from dashboard reminders: %+v", dash.Reminders)
	}
	if row.Label != "[jatuh tempo 3 hari, segera tindak lanjuti]" {
		t.Errorf("label = %q, want exact PRD string", row.Label)
	}
	if row.DaysOverdue != 3 {
		t.Errorf("days_overdue = %d, want 3", row.DaysOverdue)
	}

	// Fire-once: scanning again (later) must not re-notify or re-transition.
	if _, err := s.ScanReminders(context.Background(), cat, day(2026, 6, 25)); err != nil {
		t.Fatalf("second scan: %v", err)
	}
	if got := len(notifRecipients(t, s, "installment", "INST-2", notification.EvInstallmentDue)); got != len(recips) {
		t.Errorf("second scan changed recipient count: %d -> %d (fire-once violated)", len(recips), got)
	}
}

// ── H-3 upcoming reminder, fire-once ──────────────────────────────────────
func TestScanReminders_H3FiresOnce(t *testing.T) {
	s := newSvc(t)
	cat := notification.NewCatalog()
	seedFinanceLead(t, s, "EMP-FINHEAD")
	seedClientWithCommissionPIC(t, s, "CLI-H3", "EMP-BUDI", "EMP-BUDI")
	seedTrx(t, s, "TRX-H3", "CLI-H3", SchemeTermin, "15000000.00", "")
	insertInstallment(t, s, "INST-H3", "TRX-H3", 1, "15000000.00", day(2026, 6, 13))

	res, err := s.ScanReminders(context.Background(), cat, day(2026, 6, 10))
	if err != nil {
		t.Fatalf("ScanReminders: %v", err)
	}
	if res.H3RemindersSent != 1 {
		t.Errorf("H3RemindersSent = %d, want 1", res.H3RemindersSent)
	}
	// No status transition for H-3.
	status, jatuhTempo := installmentStatus(t, s, "INST-H3")
	if status != InstBelumJatuhTempo || jatuhTempo {
		t.Errorf("H-3 must not transition status: status=%q jatuh_tempo=%v", status, jatuhTempo)
	}
	recips := notifRecipients(t, s, "installment", "INST-H3", notification.EvInstallmentDue)
	if len(recips) == 0 {
		t.Fatal("expected H-3 notification recipients")
	}

	// Second scan (same day) does not double-fire.
	res2, err := s.ScanReminders(context.Background(), cat, day(2026, 6, 10))
	if err != nil {
		t.Fatalf("second scan: %v", err)
	}
	if res2.H3RemindersSent != 0 {
		t.Errorf("second scan H3RemindersSent = %d, want 0 (fire-once)", res2.H3RemindersSent)
	}
	if got := len(notifRecipients(t, s, "installment", "INST-H3", notification.EvInstallmentDue)); got != len(recips) {
		t.Errorf("H-3 fire-once violated: %d -> %d", len(recips), got)
	}
}

// ── Verification clears the reminder (M5 §2 flag auto-clear) ─────────────
func TestScanReminders_VerificationClearsRow(t *testing.T) {
	s := newSvc(t)
	cat := notification.NewCatalog()
	seedFinanceLead(t, s, "EMP-FINHEAD")
	seedClientWithCommissionPIC(t, s, "CLI-CLR", "EMP-BUDI", "EMP-BUDI")
	// Contract pre-attached: this single installment's verification reaches
	// [Lunas] (M5 §7 Rule 2 contract gate) — not the concern of this test.
	seedTrx(t, s, "TRX-CLR", "CLI-CLR", SchemeTermin, "15000000.00", "https://drive/clr")
	insertInstallment(t, s, "INST-CLR", "TRX-CLR", 1, "15000000.00", day(2026, 6, 17))

	if _, err := s.ScanReminders(context.Background(), cat, day(2026, 6, 20)); err != nil {
		t.Fatalf("scan: %v", err)
	}
	status, jatuhTempo := installmentStatus(t, s, "INST-CLR")
	if status != InstJatuhTempo || !jatuhTempo {
		t.Fatalf("precondition: expected [Jatuh Tempo]/flag set, got %q/%v", status, jatuhTempo)
	}

	if _, err := s.Verify(context.Background(), financeStaff, "TRX-CLR", VerifyRequest{
		InstallmentID: "INST-CLR", Amount: rpm(t, "15000000.00"), ReceivedDate: day(2026, 6, 20),
	}); err != nil {
		t.Fatalf("Verify: %v", err)
	}
	status, jatuhTempo = installmentStatus(t, s, "INST-CLR")
	if status != InstTerverifikasi || jatuhTempo {
		t.Fatalf("after verify: status=%q jatuh_tempo=%v, want [Terverifikasi]/false", status, jatuhTempo)
	}

	dash, err := s.Dashboard(context.Background(), cat, financeStaff, day(2026, 6, 21))
	if err != nil {
		t.Fatalf("Dashboard: %v", err)
	}
	for _, r := range dash.Reminders {
		if r.InstallmentID == "INST-CLR" {
			t.Fatalf("verified installment must disappear from the reminder dashboard")
		}
	}
}

// ── Bayar Sebagian: no reminder row, but appears in outstanding_no_due_date ─
func TestScanReminders_BayarSebagianOutstandingAwarenessOnly(t *testing.T) {
	s := newSvc(t)
	cat := notification.NewCatalog()
	seedClientWithCommissionPIC(t, s, "CLI-BS", "EMP-BUDI", "EMP-BUDI")
	seedTrx(t, s, "TRX-BS", "CLI-BS", SchemeBayarSebagian, "30000000.00", "")

	if _, err := s.Verify(context.Background(), financeStaff, "TRX-BS", VerifyRequest{
		Amount: rpm(t, "10000000.00"), ReceivedDate: day(2026, 6, 3),
	}); err != nil {
		t.Fatalf("Verify: %v", err)
	}

	dash, err := s.Dashboard(context.Background(), cat, financeStaff, day(2026, 6, 10))
	if err != nil {
		t.Fatalf("Dashboard: %v", err)
	}
	for _, r := range dash.Reminders {
		if r.TransactionID == "TRX-BS" {
			t.Fatalf("Bayar Sebagian remainder must NOT appear in the reminders list")
		}
	}
	var found *OutstandingRow
	for i := range dash.OutstandingNoDueDate {
		if dash.OutstandingNoDueDate[i].TransactionID == "TRX-BS" {
			found = &dash.OutstandingNoDueDate[i]
		}
	}
	if found == nil {
		t.Fatalf("Bayar Sebagian remainder should appear in outstanding_no_due_date: %+v", dash.OutstandingNoDueDate)
	}
	if found.AmountOutstanding.Format() != "Rp. 20.000.000,00" {
		t.Errorf("outstanding = %q, want Rp. 20.000.000,00", found.AmountOutstanding.Format())
	}
}

// ── Contract 7-day soft expectation (W1-18, tested alongside the scan) ────
func TestScanReminders_ContractOverdue(t *testing.T) {
	s := newSvc(t)
	cat := notification.NewCatalog()
	seedFinanceLead(t, s, "EMP-FINHEAD")
	seedClientWithCommissionPIC(t, s, "CLI-CONTRACT", "EMP-BUDI", "EMP-BUDI")
	seedTrx(t, s, "TRX-CONTRACT", "CLI-CONTRACT", SchemeBayarSebagian, "30000000.00", "")
	released := day(2026, 6, 1)
	if _, err := s.DB.ExecContext(context.Background(),
		`UPDATE transactions SET released_to_account_at = ? WHERE id = 'TRX-CONTRACT'`, released); err != nil {
		t.Fatal(err)
	}

	// 8 days later (>7) with no contract -> flags once.
	now := day(2026, 6, 9)
	res, err := s.ScanReminders(context.Background(), cat, now)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if res.ContractFlagsRaised != 1 {
		t.Errorf("ContractFlagsRaised = %d, want 1", res.ContractFlagsRaised)
	}
	recips := notifRecipients(t, s, "transaction", "TRX-CONTRACT", notification.EvContractNotReceived)
	if len(recips) == 0 {
		t.Fatal("expected contract-overdue notification to Finance lead")
	}
	// Non-blocking: routing/status untouched.
	var status string
	if err := s.DB.QueryRowContext(context.Background(),
		`SELECT payment_status FROM transactions WHERE id = 'TRX-CONTRACT'`).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != TrxMenungguVerifikasi {
		t.Errorf("contract flag must not touch payment_status, got %q", status)
	}

	// Fire-once: scanning again must not re-notify.
	if _, err := s.ScanReminders(context.Background(), cat, day(2026, 6, 15)); err != nil {
		t.Fatalf("second scan: %v", err)
	}
	if got := len(notifRecipients(t, s, "transaction", "TRX-CONTRACT", notification.EvContractNotReceived)); got != len(recips) {
		t.Errorf("contract-overdue fire-once violated: %d -> %d", len(recips), got)
	}

	// A transaction released <7 days ago never flags.
	seedClientWithCommissionPIC(t, s, "CLI-FRESH", "EMP-BUDI", "EMP-BUDI")
	seedTrx(t, s, "TRX-FRESH", "CLI-FRESH", SchemeBayarSebagian, "10000000.00", "")
	if _, err := s.DB.ExecContext(context.Background(),
		`UPDATE transactions SET released_to_account_at = ? WHERE id = 'TRX-FRESH'`, day(2026, 6, 5)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ScanReminders(context.Background(), cat, day(2026, 6, 9)); err != nil {
		t.Fatalf("scan fresh: %v", err)
	}
	if got := len(notifRecipients(t, s, "transaction", "TRX-FRESH", notification.EvContractNotReceived)); got != 0 {
		t.Errorf("transaction released <7 days ago must not flag, got %d recipients", got)
	}

	// A transaction WITH a contract never flags, even if released long ago.
	seedClientWithCommissionPIC(t, s, "CLI-HASC", "EMP-BUDI", "EMP-BUDI")
	seedTrx(t, s, "TRX-HASC", "CLI-HASC", SchemeBayarSebagian, "10000000.00", "https://drive/contract")
	if _, err := s.DB.ExecContext(context.Background(),
		`UPDATE transactions SET released_to_account_at = ? WHERE id = 'TRX-HASC'`, day(2026, 5, 1)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ScanReminders(context.Background(), cat, day(2026, 6, 9)); err != nil {
		t.Fatalf("scan has-contract: %v", err)
	}
	if got := len(notifRecipients(t, s, "transaction", "TRX-HASC", notification.EvContractNotReceived)); got != 0 {
		t.Errorf("transaction with a contract must not flag, got %d recipients", got)
	}
}

// ── Dashboard visibility per role (M5 §6) ─────────────────────────────────
func TestDashboard_Visibility(t *testing.T) {
	s := newSvc(t)
	cat := notification.NewCatalog()
	seedClientWithCommissionPIC(t, s, "CLI-VIS-OWN", "EMP-BUDI", "EMP-BUDI")
	seedTrx(t, s, "TRX-VIS-OWN", "CLI-VIS-OWN", SchemeTermin, "15000000.00", "")
	insertInstallment(t, s, "INST-VIS-OWN", "TRX-VIS-OWN", 1, "15000000.00", day(2026, 6, 17))

	seedClientWithCommissionPIC(t, s, "CLI-VIS-OTHER", "EMP-ANDI", "EMP-ANDI")
	seedTrx(t, s, "TRX-VIS-OTHER", "CLI-VIS-OTHER", SchemeTermin, "15000000.00", "")
	insertInstallment(t, s, "INST-VIS-OTHER", "TRX-VIS-OTHER", 1, "15000000.00", day(2026, 6, 17))

	now := day(2026, 6, 20)

	// Finance/OD/Director: all rows.
	for _, actor := range []permission.Actor{financeStaff, odActor, director} {
		dash, err := s.Dashboard(context.Background(), cat, actor, now)
		if err != nil {
			t.Fatalf("actor %s Dashboard: %v", actor.EmployeeID, err)
		}
		if len(dash.Reminders) != 2 {
			t.Errorf("actor %s reminders = %d, want 2", actor.EmployeeID, len(dash.Reminders))
		}
	}
	// Sales lead: all rows.
	dash, err := s.Dashboard(context.Background(), cat, salesLead, now)
	if err != nil {
		t.Fatalf("sales lead Dashboard: %v", err)
	}
	if len(dash.Reminders) != 2 {
		t.Errorf("sales lead reminders = %d, want 2", len(dash.Reminders))
	}
	// Sales staff (owner): only own client's row.
	dash, err = s.Dashboard(context.Background(), cat, salesOwner, now)
	if err != nil {
		t.Fatalf("sales owner Dashboard: %v", err)
	}
	if len(dash.Reminders) != 1 || dash.Reminders[0].InstallmentID != "INST-VIS-OWN" {
		t.Errorf("sales owner reminders = %+v, want only INST-VIS-OWN", dash.Reminders)
	}
	// Account: 403, not an audience of M5 §6.
	if _, err := s.Dashboard(context.Background(), cat, accountStaff, now); err != ErrForbidden {
		t.Errorf("account Dashboard err = %v, want ErrForbidden", err)
	}
}

// ── Scan endpoint authority ────────────────────────────────────────────────
func TestRunScan_Authority(t *testing.T) {
	s := newSvc(t)
	cat := notification.NewCatalog()

	if _, err := s.RunScan(context.Background(), cat, salesOwner, day(2026, 6, 20)); err != ErrForbidden {
		t.Errorf("sales RunScan err = %v, want ErrForbidden", err)
	}
	if _, err := s.RunScan(context.Background(), cat, accountStaff, day(2026, 6, 20)); err != ErrForbidden {
		t.Errorf("account RunScan err = %v, want ErrForbidden", err)
	}
	if _, err := s.RunScan(context.Background(), cat, odActor, day(2026, 6, 20)); err != ErrForbidden {
		t.Errorf("OD RunScan err = %v, want ErrForbidden", err)
	}
	if _, err := s.RunScan(context.Background(), cat, financeStaff, day(2026, 6, 20)); err != nil {
		t.Errorf("finance RunScan err = %v, want nil", err)
	}
	if _, err := s.RunScan(context.Background(), cat, director, day(2026, 6, 20)); err != nil {
		t.Errorf("director RunScan err = %v, want nil", err)
	}
}
