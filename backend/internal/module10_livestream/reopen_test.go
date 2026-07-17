package module10_livestream

import (
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/module6_account"
)

// TestReopenBrief_HappyPath verifies the happy path: brief LS [Approved] (all sessions
// reconciled) → AM owner ReopenBrief succeeds → status [Dispatched to Vendor], audit
// row exists → CreateSession new session SUCCEEDS → run new session to [Reconciled] →
// brief menutup lagi ke [Approved] with second ls_brief_reconciled audit entry.
func TestReopenBrief_HappyPath(t *testing.T) {
	k := setup(t)

	// Create an LS brief with one reconciled session.
	sessionID, briefID := stdSession(t, k, "REOPEN-HAPPY")

	// Confirm vendor, log results, and reconcile (brief closes to [Approved]).
	if err := onlyErr(k.m10.ConfirmByVendor(ctx, ownerAM(), sessionID)); err != nil {
		t.Fatalf("ConfirmByVendor: %v", err)
	}
	if err := onlyErr(k.m10.LogResults(ctx, ownerAM(), sessionID, goodResults())); err != nil {
		t.Fatalf("LogResults: %v", err)
	}
	if err := onlyErr(k.m10.Reconcile(ctx, ownerAM(), sessionID)); err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	if st := statusOf(t, k, "briefs", briefID); st != BriefApproved {
		t.Errorf("brief status after reconcile = %q, want [Approved]", st)
	}

	// Reopen the brief by owning AM.
	if err := k.m10.ReopenBrief(ctx, ownerAM(), briefID); err != nil {
		t.Fatalf("ReopenBrief: %v", err)
	}
	if st := statusOf(t, k, "briefs", briefID); st != BriefVendorDispatched {
		t.Errorf("brief status after reopen = %q, want [Dispatched to Vendor]", st)
	}

	// Verify audit entry exists for ls_brief_reopened.
	var auditAction string
	if err := k.m10.DB.QueryRow(
		`SELECT action FROM audit_log WHERE entity_type = ? AND entity_id = ? AND action = ?
		 ORDER BY created_at DESC LIMIT 1`, "brief", briefID, "ls_brief_reopened").Scan(&auditAction); err != nil {
		t.Fatalf("audit entry ls_brief_reopened not found: %v", err)
	}

	// Create a new session on the reopened brief (should succeed).
	newSess, err := k.m10.CreateSession(ctx, ownerAM(), briefID, SessionInput{
		Platform: PlatformShopee, RequestedDatetime: "2026-07-12 19:00:00", TargetDurationHours: "1.5",
		ProductsTalent: "SKUs old + new",
	})
	if err != nil {
		t.Fatalf("CreateSession on reopened brief: %v", err)
	}
	if newSess.Status != LssRequested {
		t.Errorf("new session status = %q, want [Requested]", newSess.Status)
	}

	// Confirm the new session and log results.
	if err := onlyErr(k.m10.ConfirmByVendor(ctx, ownerAM(), newSess.ID)); err != nil {
		t.Fatalf("ConfirmByVendor for new session: %v", err)
	}
	newResults := ResultInput{
		ActualDatetime: "2026-07-12 19:05:00", ActualDurationHours: "1.5",
		ViewersPeak: intPtr(1500), ViewersAvg: intPtr(1200), OrdersGenerated: intPtr(20),
		GMV: "5000000", VendorReportLink: "https://drive/report2",
	}
	if err := onlyErr(k.m10.LogResults(ctx, ownerAM(), newSess.ID, newResults)); err != nil {
		t.Fatalf("LogResults for new session: %v", err)
	}
	if err := onlyErr(k.m10.Reconcile(ctx, ownerAM(), newSess.ID)); err != nil {
		t.Fatalf("Reconcile for new session: %v", err)
	}

	// Verify brief closes to [Approved] again (rollup triggered by second session reconcile).
	if st := statusOf(t, k, "briefs", briefID); st != BriefApproved {
		t.Errorf("brief status after second reconcile = %q, want [Approved]", st)
	}

	// Verify second ls_brief_reconciled audit entry exists.
	var count int
	if err := k.m10.DB.QueryRow(
		`SELECT COUNT(*) FROM audit_log WHERE entity_type = ? AND entity_id = ? AND action = ?`,
		"brief", briefID, "ls_brief_reconciled").Scan(&count); err != nil {
		t.Fatalf("count ls_brief_reconciled audit entries: %v", err)
	}
	if count < 1 {
		t.Errorf("ls_brief_reconciled audit entries = %d, want >= 1", count)
	}
}

// TestReopenBrief_StatusGuard_NotApproved verifies that a brief not in [Approved]
// status cannot be reopened.
func TestReopenBrief_StatusGuard_NotApproved(t *testing.T) {
	k := setup(t)

	// Create an LS brief (born [Dispatched to Vendor]).
	briefID, _ := newLSBrief(t, k, "REOPEN-STATUS")

	// Try to reopen a brief still [Dispatched to Vendor].
	if err := k.m10.ReopenBrief(ctx, ownerAM(), briefID); !errors.Is(err, ErrBriefNotReopenable) {
		t.Errorf("reopen dispatched brief: want ErrBriefNotReopenable, got %v", err)
	}
}

// TestReopenBrief_VoidedBrief verifies that a voided Brief cannot be reopened.
func TestReopenBrief_VoidedBrief(t *testing.T) {
	k := setup(t)

	// Create an LS brief and reconcile it to [Approved].
	sessionID, briefID := stdSession(t, k, "REOPEN-VOID")
	if err := onlyErr(k.m10.ConfirmByVendor(ctx, ownerAM(), sessionID)); err != nil {
		t.Fatalf("ConfirmByVendor: %v", err)
	}
	if err := onlyErr(k.m10.LogResults(ctx, ownerAM(), sessionID, goodResults())); err != nil {
		t.Fatalf("LogResults: %v", err)
	}
	if err := onlyErr(k.m10.Reconcile(ctx, ownerAM(), sessionID)); err != nil {
		t.Fatalf("Reconcile: %v", err)
	}

	// Simulate void cascade (module4 VoidService sets this off-machine).
	if _, err := k.m10.DB.ExecContext(ctx, `UPDATE briefs SET status = ? WHERE id = ?`, BriefVoided, briefID); err != nil {
		t.Fatal(err)
	}

	// Verify brief is now voided.
	if st := statusOf(t, k, "briefs", briefID); st != BriefVoided {
		t.Errorf("voided brief status = %q, want [Cancelled — Service Voided]", st)
	}

	// Try to reopen a voided brief.
	if err := k.m10.ReopenBrief(ctx, ownerAM(), briefID); !errors.Is(err, ErrBriefVoided) {
		t.Errorf("reopen voided brief: want ErrBriefVoided, got %v", err)
	}
}

// TestReopenBrief_NonLiveStreamBrief verifies that only Live Stream division briefs
// can be reopened.
func TestReopenBrief_NonLiveStreamBrief(t *testing.T) {
	k := setup(t)

	// Create a KOL-division brief.
	d := k.m10.DB
	clientID, svcID := "CLI-REOPEN-NON-LS", "SVC-REOPEN-NON-LS"
	if _, err := d.ExecContext(ctx,
		`INSERT INTO clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
		  total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
		 VALUES (?, 'PIC', ?, 'Bandung', 'l', 'Fashion', '1.00', '1.00', '0.00', 'EMP-B', 'EMP-B', NOW(), ?, 'TEST')`,
		clientID, clientID, amID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ExecContext(ctx,
		`INSERT INTO services (id, client_id, master_service_id, master_version_no, name, standard_price,
		   commission_rule, status, requires_strategy_plan, created_by)
		 VALUES (?, ?, 'MSV-X', 1, 'KOL', '1.00', 'r', '[Awaiting Onboarding]', 0, 'TEST')`,
		svcID, clientID); err != nil {
		t.Fatal(err)
	}
	b, err := k.m6.CreateBrief(ctx, ownerAM(), svcID, module6_account.BriefInput{
		Title: "KOL Brief", AssignedDivision: "KOL", DeliverableType: "KOL",
		QuantityTarget: 1, DueDate: "2026-08-30", Priority: "High",
	})
	if err != nil {
		t.Fatal(err)
	}

	// Try to reopen a non-LS brief (this will fail in two ways: division + status).
	if err := k.m10.ReopenBrief(ctx, ownerAM(), b.ID); !errors.Is(err, ErrNotLiveStreamBrief) {
		t.Errorf("reopen non-LS brief: want ErrNotLiveStreamBrief, got %v", err)
	}
}

// TestReopenBrief_BriefNotFound verifies that reopening a non-existent brief fails.
func TestReopenBrief_BriefNotFound(t *testing.T) {
	k := setup(t)

	if err := k.m10.ReopenBrief(ctx, ownerAM(), "BRF-NONEXISTENT"); !errors.Is(err, ErrBriefNotFound) {
		t.Errorf("reopen non-existent brief: want ErrBriefNotFound, got %v", err)
	}
}

// TestReopenBrief_PermissionTable_OwnerAM tests that owning AM can reopen.
func TestReopenBrief_PermissionTable_OwnerAM(t *testing.T) {
	k := setup(t)
	sessionID, briefID := stdSession(t, k, "PERM-OWN")
	if err := onlyErr(k.m10.ConfirmByVendor(ctx, ownerAM(), sessionID)); err != nil {
		t.Fatalf("ConfirmByVendor: %v", err)
	}
	if err := onlyErr(k.m10.LogResults(ctx, ownerAM(), sessionID, goodResults())); err != nil {
		t.Fatalf("LogResults: %v", err)
	}
	if err := onlyErr(k.m10.Reconcile(ctx, ownerAM(), sessionID)); err != nil {
		t.Fatalf("Reconcile: %v", err)
	}

	if err := k.m10.ReopenBrief(ctx, ownerAM(), briefID); err != nil {
		t.Errorf("owning AM reopen should pass, got error: %v", err)
	}
	if st := statusOf(t, k, "briefs", briefID); st != BriefVendorDispatched {
		t.Errorf("brief status = %q, want [Dispatched to Vendor]", st)
	}
}

// TestReopenBrief_PermissionTable_Director tests that Director can reopen.
func TestReopenBrief_PermissionTable_Director(t *testing.T) {
	k := setup(t)
	sessionID, briefID := stdSession(t, k, "PERM-DIR")
	if err := onlyErr(k.m10.ConfirmByVendor(ctx, ownerAM(), sessionID)); err != nil {
		t.Fatalf("ConfirmByVendor: %v", err)
	}
	if err := onlyErr(k.m10.LogResults(ctx, ownerAM(), sessionID, goodResults())); err != nil {
		t.Fatalf("LogResults: %v", err)
	}
	if err := onlyErr(k.m10.Reconcile(ctx, ownerAM(), sessionID)); err != nil {
		t.Fatalf("Reconcile: %v", err)
	}

	if err := k.m10.ReopenBrief(ctx, director("EMP-DIR"), briefID); err != nil {
		t.Errorf("Director reopen should pass, got error: %v", err)
	}
	if st := statusOf(t, k, "briefs", briefID); st != BriefVendorDispatched {
		t.Errorf("brief status = %q, want [Dispatched to Vendor]", st)
	}
}

// TestReopenBrief_PermissionTable_OtherAM tests that other AM cannot reopen.
func TestReopenBrief_PermissionTable_OtherAM(t *testing.T) {
	k := setup(t)
	sessionID, briefID := stdSession(t, k, "PERM-OTH")
	if err := onlyErr(k.m10.ConfirmByVendor(ctx, ownerAM(), sessionID)); err != nil {
		t.Fatalf("ConfirmByVendor: %v", err)
	}
	if err := onlyErr(k.m10.LogResults(ctx, ownerAM(), sessionID, goodResults())); err != nil {
		t.Fatalf("LogResults: %v", err)
	}
	if err := onlyErr(k.m10.Reconcile(ctx, ownerAM(), sessionID)); err != nil {
		t.Fatalf("Reconcile: %v", err)
	}

	if err := k.m10.ReopenBrief(ctx, otherAM(), briefID); !errors.Is(err, ErrBriefReopenForbidden) {
		t.Errorf("other AM reopen should fail with ErrBriefReopenForbidden, got: %v", err)
	}
	if st := statusOf(t, k, "briefs", briefID); st != BriefApproved {
		t.Errorf("brief status = %q, want [Approved] (unchanged)", st)
	}
}

// TestReopenBrief_PermissionTable_AccountLead tests that Account Lead cannot reopen.
func TestReopenBrief_PermissionTable_AccountLead(t *testing.T) {
	k := setup(t)
	sessionID, briefID := stdSession(t, k, "PERM-LEAD")
	if err := onlyErr(k.m10.ConfirmByVendor(ctx, ownerAM(), sessionID)); err != nil {
		t.Fatalf("ConfirmByVendor: %v", err)
	}
	if err := onlyErr(k.m10.LogResults(ctx, ownerAM(), sessionID, goodResults())); err != nil {
		t.Fatalf("LogResults: %v", err)
	}
	if err := onlyErr(k.m10.Reconcile(ctx, ownerAM(), sessionID)); err != nil {
		t.Fatalf("Reconcile: %v", err)
	}

	if err := k.m10.ReopenBrief(ctx, accountLead("EMP-LEAD"), briefID); !errors.Is(err, ErrBriefReopenForbidden) {
		t.Errorf("Account Lead reopen should fail with ErrBriefReopenForbidden, got: %v", err)
	}
	if st := statusOf(t, k, "briefs", briefID); st != BriefApproved {
		t.Errorf("brief status = %q, want [Approved] (unchanged)", st)
	}
}

// TestReopenBrief_PermissionTable_ODAndForeignStaff: OD (read-all, NOT Director) and a
// foreign-division staff cannot reopen; the layered OD+Director account CAN (the
// Director layer wins, house rule 6).
func TestReopenBrief_PermissionTable_ODAndForeignStaff(t *testing.T) {
	k := setup(t)
	sessionID, briefID := stdSession(t, k, "PERM-ODF")
	if err := onlyErr(k.m10.ConfirmByVendor(ctx, ownerAM(), sessionID)); err != nil {
		t.Fatalf("ConfirmByVendor: %v", err)
	}
	if err := onlyErr(k.m10.LogResults(ctx, ownerAM(), sessionID, goodResults())); err != nil {
		t.Fatalf("LogResults: %v", err)
	}
	if err := onlyErr(k.m10.Reconcile(ctx, ownerAM(), sessionID)); err != nil {
		t.Fatalf("Reconcile: %v", err)
	}

	for _, a := range []permission.Actor{od("EMP-OD"), kolStaff("EMP-K")} {
		if err := k.m10.ReopenBrief(ctx, a, briefID); !errors.Is(err, ErrBriefReopenForbidden) {
			t.Errorf("%s reopen should fail with ErrBriefReopenForbidden, got: %v", a.EmployeeID, err)
		}
	}
	if st := statusOf(t, k, "briefs", briefID); st != BriefApproved {
		t.Errorf("brief status = %q, want [Approved] (unchanged)", st)
	}
	// Layered one-account-two-roles: OD+Director may reopen via the Director layer.
	if err := k.m10.ReopenBrief(ctx, odDirector("EMP-ODD"), briefID); err != nil {
		t.Errorf("layered OD+Director reopen should pass, got: %v", err)
	}
	if st := statusOf(t, k, "briefs", briefID); st != BriefVendorDispatched {
		t.Errorf("brief status = %q, want [Dispatched to Vendor]", st)
	}
}

// ---- test helpers ----

func intPtr(v int) *int {
	return &v
}
