package module10_livestream

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module6_account"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

const amID = "EMP-AM"

var ctx = context.Background()

// ---- actor helpers ----

func ownerAM() permission.Actor {
	return permission.Actor{EmployeeID: amID, Role: permission.Role{Division: AccountDivision, Level: permission.LevelStaff}}
}
func otherAM() permission.Actor {
	return permission.Actor{EmployeeID: "EMP-OTHER", Role: permission.Role{Division: AccountDivision, Level: permission.LevelStaff}}
}
func accountLead(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: AccountDivision, Level: permission.LevelLead}}
}
func director(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Director: true}}
}
func od(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{OD: true}}
}
func kolStaff(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: "KOL", Level: permission.LevelStaff}}
}

// od+director layered on one account (§6 / CLAUDE.md house convention 6).
func odDirector(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{OD: true, Director: true}}
}

// ---- fixtures ----

type kit struct {
	m10 *Service
	m6  *module6_account.Service
}

func setup(t *testing.T) *kit {
	t.Helper()
	d := testutil.DB(t)
	testutil.Clean(t, d)
	eng := statemachine.New()
	m6 := &module6_account.Service{DB: d, Engine: eng}
	m10 := &Service{DB: d, Engine: eng}
	return &kit{m10: m10, m6: m6}
}

// newLSBrief creates a released client + owner AM (EMP-AM) + Direct service, then mints
// a Live Stream Brief born OFF-MACHINE [Dispatched to Vendor].
func newLSBrief(t *testing.T, k *kit, suffix string) (briefID, svcID string) {
	t.Helper()
	d := k.m10.DB
	clientID, svcID := "CLI-"+suffix, "SVC-"+suffix
	if _, err := d.ExecContext(ctx,
		`INSERT INTO clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
		  total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
		 VALUES (?, 'PIC', ?, 'Bandung', 'link', 'Fashion', '10000000.00', '20000000.00', '0.00',
		         'EMP-BUDI', 'EMP-BUDI', NOW(), ?, 'TEST')`, clientID, clientID, amID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ExecContext(ctx,
		`INSERT INTO services (id, client_id, master_service_id, master_version_no, name,
		   standard_price, commission_rule, status, requires_strategy_plan, created_by)
		 VALUES (?, ?, 'MSV-X', 1, 'Live Stream Package', '10000000.00', 'rule', '[Awaiting Onboarding]', 0, 'TEST')`,
		svcID, clientID); err != nil {
		t.Fatal(err)
	}
	b, err := k.m6.CreateBrief(ctx, ownerAM(), svcID, module6_account.BriefInput{
		Title: "Live Stream " + suffix, AssignedDivision: LiveStreamDivision, DeliverableType: "Live Stream",
		QuantityTarget: 1, DueDate: "2026-08-30", Priority: "High",
	})
	if err != nil {
		t.Fatalf("CreateBrief: %v", err)
	}
	if b.Status != BriefVendorDispatched {
		t.Fatalf("LS brief born %q, want %q", b.Status, BriefVendorDispatched)
	}
	return b.ID, svcID
}

func statusOf(t *testing.T, k *kit, table, id string) string {
	t.Helper()
	var st string
	if err := k.m10.DB.QueryRow("SELECT status FROM "+table+" WHERE id = ?", id).Scan(&st); err != nil {
		t.Fatal(err)
	}
	return st
}

// stdSession creates a valid Session on a fresh LS brief.
func stdSession(t *testing.T, k *kit, suffix string) (sessionID, briefID string) {
	t.Helper()
	briefID, _ = newLSBrief(t, k, suffix)
	s, err := k.m10.CreateSession(ctx, ownerAM(), briefID, SessionInput{
		Platform: PlatformTikTok, RequestedDatetime: "2026-07-05 19:00:00", TargetDurationHours: "2",
		ProductsTalent: "3 newest SKUs",
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	return s.ID, briefID
}

func goodResults() ResultInput {
	orders := 30
	peak, avg := 2000, 1500
	return ResultInput{
		ActualDatetime: "2026-07-05 19:05:00", ActualDurationHours: "2",
		ViewersPeak: &peak, ViewersAvg: &avg, OrdersGenerated: &orders,
		GMV: "8000000", VendorReportLink: "https://drive/report",
	}
}

func onlyErr(_ statemachine.Result, err error) error { return err }

// ---- CreateSession: validation + permissions ----

func TestCreateSession_Validation(t *testing.T) {
	k := setup(t)
	briefID, _ := newLSBrief(t, k, "V")

	// Missing mandatory request fields.
	if _, err := k.m10.CreateSession(ctx, ownerAM(), briefID, SessionInput{Platform: PlatformTikTok}); !errors.Is(err, ErrIncomplete) {
		t.Errorf("missing datetime/duration: want ErrIncomplete, got %v", err)
	}
	// Invalid platform.
	if _, err := k.m10.CreateSession(ctx, ownerAM(), briefID, SessionInput{
		Platform: "YouTube Live", RequestedDatetime: "2026-07-05 19:00:00", TargetDurationHours: "2"}); !errors.Is(err, ErrInvalidPlatform) {
		t.Errorf("bad platform: want ErrInvalidPlatform, got %v", err)
	}
	// Non-positive duration.
	if _, err := k.m10.CreateSession(ctx, ownerAM(), briefID, SessionInput{
		Platform: PlatformShopee, RequestedDatetime: "2026-07-05 19:00:00", TargetDurationHours: "0"}); !errors.Is(err, ErrInvalidDuration) {
		t.Errorf("zero duration: want ErrInvalidDuration, got %v", err)
	}
	// Bad datetime.
	if _, err := k.m10.CreateSession(ctx, ownerAM(), briefID, SessionInput{
		Platform: PlatformShopee, RequestedDatetime: "not-a-date", TargetDurationHours: "2"}); !errors.Is(err, ErrBadDatetime) {
		t.Errorf("bad datetime: want ErrBadDatetime, got %v", err)
	}
	// Valid.
	s, err := k.m10.CreateSession(ctx, ownerAM(), briefID, SessionInput{
		Platform: PlatformTikTok, RequestedDatetime: "2026-07-05 19:00:00", TargetDurationHours: "2"})
	if err != nil {
		t.Fatalf("valid create: %v", err)
	}
	if s.Status != LssRequested {
		t.Errorf("status = %q, want [Requested]", s.Status)
	}
	if s.DataConfidenceTier != DataConfidenceVendorReported {
		t.Errorf("confidence tier = %q, want Vendor-Reported", s.DataConfidenceTier)
	}
}

func TestCreateSession_NonLiveStreamBrief(t *testing.T) {
	k := setup(t)
	// A KOL-division brief is not an LS brief.
	d := k.m10.DB
	if _, err := d.ExecContext(ctx,
		`INSERT INTO clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
		  total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
		 VALUES ('CLI-K','PIC','T','Bandung','l','Fashion','1.00','1.00','0.00','EMP-B','EMP-B',NOW(),?,'TEST')`, amID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ExecContext(ctx,
		`INSERT INTO services (id, client_id, master_service_id, master_version_no, name, standard_price,
		   commission_rule, status, requires_strategy_plan, created_by)
		 VALUES ('SVC-K','CLI-K','MSV-X',1,'KOL','1.00','r','[Awaiting Onboarding]',0,'TEST')`); err != nil {
		t.Fatal(err)
	}
	b, err := k.m6.CreateBrief(ctx, ownerAM(), "SVC-K", module6_account.BriefInput{
		Title: "KOL", AssignedDivision: "KOL", DeliverableType: "KOL", QuantityTarget: 1, DueDate: "2026-08-30", Priority: "High"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := k.m10.CreateSession(ctx, ownerAM(), b.ID, SessionInput{
		Platform: PlatformTikTok, RequestedDatetime: "2026-07-05 19:00:00", TargetDurationHours: "2"}); !errors.Is(err, ErrNotLiveStreamBrief) {
		t.Errorf("want ErrNotLiveStreamBrief, got %v", err)
	}
	if _, err := k.m10.CreateSession(ctx, ownerAM(), "BRF-GHOST", SessionInput{
		Platform: PlatformTikTok, RequestedDatetime: "2026-07-05 19:00:00", TargetDurationHours: "2"}); !errors.Is(err, ErrBriefNotFound) {
		t.Errorf("want ErrBriefNotFound, got %v", err)
	}
}

func TestCreateSession_WriteGate(t *testing.T) {
	k := setup(t)
	briefID, _ := newLSBrief(t, k, "G")
	in := SessionInput{Platform: PlatformTikTok, RequestedDatetime: "2026-07-05 19:00:00", TargetDurationHours: "2"}

	// Non-owner AM, Account lead, OD, KOL staff cannot create (write = owner AM + Director).
	for _, a := range []permission.Actor{otherAM(), accountLead("EMP-AL"), od("EMP-OD"), kolStaff("EMP-K")} {
		if _, err := k.m10.CreateSession(ctx, a, briefID, in); !errors.Is(err, ErrSessionManageForbidden) {
			t.Errorf("actor %+v: want ErrSessionManageForbidden, got %v", a.Role, err)
		}
	}
	// Director may create.
	if _, err := k.m10.CreateSession(ctx, director("EMP-D"), briefID, in); err != nil {
		t.Errorf("director create: %v", err)
	}
}

func TestCreateSession_VoidedBriefRejected(t *testing.T) {
	k := setup(t)
	briefID, _ := newLSBrief(t, k, "VOID")
	// Simulate the void cascade result (module4 VoidService sets this off-machine).
	if _, err := k.m10.DB.ExecContext(ctx, `UPDATE briefs SET status = ? WHERE id = ?`, BriefVoided, briefID); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m10.CreateSession(ctx, ownerAM(), briefID, SessionInput{
		Platform: PlatformTikTok, RequestedDatetime: "2026-07-05 19:00:00", TargetDurationHours: "2"}); !errors.Is(err, ErrBriefVoided) {
		t.Errorf("void brief: want ErrBriefVoided, got %v", err)
	}
}

// ---- Lifecycle happy path + brief roll-up ----

func TestLifecycle_HappyPath(t *testing.T) {
	k := setup(t)
	sID, briefID := stdSession(t, k, "H")

	if err := onlyErr(k.m10.ConfirmByVendor(ctx, ownerAM(), sID)); err != nil {
		t.Fatalf("confirm: %v", err)
	}
	if got := statusOf(t, k, "live_stream_sessions", sID); got != LssConfirmed {
		t.Fatalf("status = %q, want [Confirmed by Vendor]", got)
	}
	if err := onlyErr(k.m10.LogResults(ctx, ownerAM(), sID, goodResults())); err != nil {
		t.Fatalf("results: %v", err)
	}
	if got := statusOf(t, k, "live_stream_sessions", sID); got != LssCompleted {
		t.Fatalf("status = %q, want [Completed]", got)
	}
	// Brief still open until reconciled.
	if got := statusOf(t, k, "briefs", briefID); got != BriefVendorDispatched {
		t.Fatalf("brief = %q, want still [Dispatched to Vendor]", got)
	}
	if err := onlyErr(k.m10.Reconcile(ctx, ownerAM(), sID)); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if got := statusOf(t, k, "live_stream_sessions", sID); got != LssReconciled {
		t.Fatalf("status = %q, want [Reconciled]", got)
	}
	// The sole Session reconciled → Brief closes to [Approved] off-machine.
	if got := statusOf(t, k, "briefs", briefID); got != BriefApproved {
		t.Fatalf("brief = %q, want [Approved]", got)
	}
	// The Brief close is an audited off-machine action (ls_brief_reconciled).
	entries, err := audit.List(ctx, k.m10.DB, audit.Filter{EntityType: "brief", EntityID: briefID})
	if err != nil {
		t.Fatal(err)
	}
	if !hasAction(entries, "ls_brief_reconciled") {
		t.Errorf("missing ls_brief_reconciled audit row; got %v", actions(entries))
	}
}

func TestLogResults_Gate(t *testing.T) {
	k := setup(t)
	sID, _ := stdSession(t, k, "R")
	if err := onlyErr(k.m10.ConfirmByVendor(ctx, ownerAM(), sID)); err != nil {
		t.Fatal(err)
	}
	orders := 10
	// Missing vendor report link.
	res := goodResults()
	res.VendorReportLink = ""
	if err := onlyErr(k.m10.LogResults(ctx, ownerAM(), sID, res)); !errors.Is(err, ErrVendorReportLinkRequired) {
		t.Errorf("missing link: want ErrVendorReportLinkRequired, got %v", err)
	}
	// Missing a result field (orders nil).
	res = goodResults()
	res.OrdersGenerated = nil
	if err := onlyErr(k.m10.LogResults(ctx, ownerAM(), sID, res)); !errors.Is(err, ErrIncomplete) {
		t.Errorf("missing orders: want ErrIncomplete, got %v", err)
	}
	// Bad GMV.
	res = goodResults()
	res.OrdersGenerated = &orders
	res.GMV = "abc"
	if err := onlyErr(k.m10.LogResults(ctx, ownerAM(), sID, res)); !errors.Is(err, ErrBadAmount) {
		t.Errorf("bad gmv: want ErrBadAmount, got %v", err)
	}
	// Still [Confirmed by Vendor] — no partial completion.
	if got := statusOf(t, k, "live_stream_sessions", sID); got != LssConfirmed {
		t.Errorf("status = %q, want [Confirmed by Vendor] (no partial move)", got)
	}
}

// ---- Invalid transitions blocked with BI message ----

func TestInvalidTransitions(t *testing.T) {
	k := setup(t)
	sID, _ := stdSession(t, k, "I")
	// Reconcile straight from [Requested] is not a legal edge.
	err := onlyErr(k.m10.Reconcile(ctx, ownerAM(), sID))
	var be *statemachine.BlockedError
	if !errors.As(err, &be) || be.Message != statemachine.DefaultBlockMessage {
		t.Errorf("reconcile from [Requested]: want blocked %q, got %v", statemachine.DefaultBlockMessage, err)
	}
	// LogResults from [Requested] (must be confirmed first) is blocked.
	if err := onlyErr(k.m10.LogResults(ctx, ownerAM(), sID, goodResults())); !errors.As(err, &be) {
		t.Errorf("results from [Requested]: want BlockedError, got %v", err)
	}
}

// ---- Discrepancy: notes mandatory, non-blocking, later reconcile ----

func TestFlagDiscrepancy_NotesAndNonBlocking(t *testing.T) {
	k := setup(t)
	sID, briefID := stdSession(t, k, "D")
	if err := onlyErr(k.m10.ConfirmByVendor(ctx, ownerAM(), sID)); err != nil {
		t.Fatal(err)
	}
	if err := onlyErr(k.m10.LogResults(ctx, ownerAM(), sID, goodResults())); err != nil {
		t.Fatal(err)
	}
	// Notes mandatory.
	if err := onlyErr(k.m10.FlagDiscrepancy(ctx, ownerAM(), sID, "  ")); !errors.Is(err, ErrReconNotesRequired) {
		t.Errorf("blank notes: want ErrReconNotesRequired, got %v", err)
	}
	if err := onlyErr(k.m10.FlagDiscrepancy(ctx, ownerAM(), sID, "durasi di bawah target")); err != nil {
		t.Fatalf("flag: %v", err)
	}
	if got := statusOf(t, k, "live_stream_sessions", sID); got != LssDiscrepancy {
		t.Fatalf("status = %q, want [Discrepancy Flagged]", got)
	}
	// Non-blocking: the Brief has NOT closed.
	if got := statusOf(t, k, "briefs", briefID); got != BriefVendorDispatched {
		t.Fatalf("brief closed on discrepancy; want still dispatched, got %q", got)
	}
	// May still reconcile later.
	if err := onlyErr(k.m10.Reconcile(ctx, ownerAM(), sID)); err != nil {
		t.Fatalf("reconcile after flag: %v", err)
	}
	if got := statusOf(t, k, "briefs", briefID); got != BriefApproved {
		t.Fatalf("brief = %q, want [Approved] after flagged session reconciled", got)
	}
}

// ---- Permissions: read + manage per role (incl. layered OD/Director) ----

func TestPermissions_ReadAndManage(t *testing.T) {
	k := setup(t)
	sID, _ := stdSession(t, k, "P")

	// Read gate: owner AM, Account lead, OD, Director, layered OD/Director may read.
	for _, a := range []permission.Actor{ownerAM(), accountLead("EMP-AL"), od("EMP-OD"), director("EMP-D"), odDirector("EMP-ODD")} {
		if _, err := k.m10.GetSession(ctx, a, sID); err != nil {
			t.Errorf("read allowed for %+v: %v", a.Role, err)
		}
	}
	// Read denied: non-owner AM, KOL staff (no vendor role at all).
	for _, a := range []permission.Actor{otherAM(), kolStaff("EMP-K")} {
		if _, err := k.m10.GetSession(ctx, a, sID); !errors.Is(err, ErrSessionViewForbidden) {
			t.Errorf("read should be denied for %+v, got %v", a.Role, err)
		}
	}
	// Manage gate: Account lead may READ but NOT drive lifecycle (write = owner AM + Director).
	if err := onlyErr(k.m10.ConfirmByVendor(ctx, accountLead("EMP-AL"), sID)); !errors.Is(err, ErrSessionManageForbidden) {
		t.Errorf("account lead confirm: want ErrSessionManageForbidden, got %v", err)
	}
	if err := onlyErr(k.m10.ConfirmByVendor(ctx, otherAM(), sID)); !errors.Is(err, ErrSessionManageForbidden) {
		t.Errorf("other AM confirm: want ErrSessionManageForbidden, got %v", err)
	}
	// Owner AM + Director may drive.
	if err := onlyErr(k.m10.ConfirmByVendor(ctx, director("EMP-D"), sID)); err != nil {
		t.Errorf("director confirm: %v", err)
	}
}

// ---- Void interaction: session of a voided brief is frozen ----

func TestVoidedBrief_FreezesSession(t *testing.T) {
	k := setup(t)
	sID, briefID := stdSession(t, k, "F")
	if err := onlyErr(k.m10.ConfirmByVendor(ctx, ownerAM(), sID)); err != nil {
		t.Fatal(err)
	}
	// Void cascade sets the off-machine brief to [Cancelled — Service Voided].
	if _, err := k.m10.DB.ExecContext(ctx, `UPDATE briefs SET status = ? WHERE id = ?`, BriefVoided, briefID); err != nil {
		t.Fatal(err)
	}
	// Further lifecycle on the orphaned session is frozen.
	if err := onlyErr(k.m10.LogResults(ctx, ownerAM(), sID, goodResults())); !errors.Is(err, ErrBriefVoided) {
		t.Errorf("frozen session results: want ErrBriefVoided, got %v", err)
	}
	// Session status is unchanged (immutable, no fake cancel state).
	if got := statusOf(t, k, "live_stream_sessions", sID); got != LssConfirmed {
		t.Errorf("session moved despite void; got %q", got)
	}
}

// ---- Roll-up requires ALL sessions reconciled ----

func TestRollup_AllSessionsRequired(t *testing.T) {
	k := setup(t)
	briefID, _ := newLSBrief(t, k, "M")
	mk := func() string {
		s, err := k.m10.CreateSession(ctx, ownerAM(), briefID, SessionInput{
			Platform: PlatformTikTok, RequestedDatetime: "2026-07-05 19:00:00", TargetDurationHours: "1"})
		if err != nil {
			t.Fatal(err)
		}
		return s.ID
	}
	s1, s2 := mk(), mk()
	reconcile := func(id string) {
		if err := onlyErr(k.m10.ConfirmByVendor(ctx, ownerAM(), id)); err != nil {
			t.Fatal(err)
		}
		if err := onlyErr(k.m10.LogResults(ctx, ownerAM(), id, goodResults())); err != nil {
			t.Fatal(err)
		}
		if err := onlyErr(k.m10.Reconcile(ctx, ownerAM(), id)); err != nil {
			t.Fatal(err)
		}
	}
	reconcile(s1)
	// Only one of two reconciled → Brief stays open.
	if got := statusOf(t, k, "briefs", briefID); got != BriefVendorDispatched {
		t.Fatalf("brief closed early; got %q", got)
	}
	reconcile(s2)
	if got := statusOf(t, k, "briefs", briefID); got != BriefApproved {
		t.Fatalf("brief = %q, want [Approved] once all reconciled", got)
	}
}

// ---- Immutable history + recompute-derived (confidence tier, GMV format, queryable) ----

func TestImmutableHistoryAndDerived(t *testing.T) {
	k := setup(t)
	sID, briefID := stdSession(t, k, "A")
	if err := onlyErr(k.m10.ConfirmByVendor(ctx, ownerAM(), sID)); err != nil {
		t.Fatal(err)
	}
	if err := onlyErr(k.m10.LogResults(ctx, ownerAM(), sID, goodResults())); err != nil {
		t.Fatal(err)
	}
	// Every move appended an immutable transition row (create + 2 transitions).
	entries, err := audit.List(ctx, k.m10.DB, audit.Filter{EntityType: "live_stream_session", EntityID: sID})
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) < 3 {
		t.Errorf("audit entries = %d, want >= 3 (create + confirm + complete)", len(entries))
	}
	// Derived read: GMV rendered in house IDR, tier is the auto badge, GMV queryable.
	sess, err := k.m10.GetSession(ctx, ownerAM(), sID)
	if err != nil {
		t.Fatal(err)
	}
	if sess.GMVDisplay != "Rp. 8.000.000,00" {
		t.Errorf("gmv display = %q, want Rp. 8.000.000,00", sess.GMVDisplay)
	}
	if sess.DataConfidenceTier != DataConfidenceVendorReported {
		t.Errorf("tier = %q", sess.DataConfidenceTier)
	}
	// GMV feed to Client Health (M13) — queryable via the brief→service→client join.
	var clientGMV sql.NullString
	if err := k.m10.DB.QueryRow(
		`SELECT SUM(ls.gmv) FROM live_stream_sessions ls
		   JOIN briefs b ON b.id = ls.brief_id
		  WHERE b.id = ?`, briefID).Scan(&clientGMV); err != nil {
		t.Fatal(err)
	}
	if !clientGMV.Valid || clientGMV.String != "8000000.00" {
		t.Errorf("queryable GMV = %v, want 8000000.00", clientGMV)
	}
}

// ---- Worked example (M10 §3/§4): Alpha Digital LSS upsell, 1h20m vs 2h target ----

func TestWorkedExample_AlphaDigital(t *testing.T) {
	k := setup(t)
	briefID, _ := newLSBrief(t, k, "ALPHA")
	// Sinta (owning AM) creates LSS: TikTok Shop Live, 2h target, 3 newest SKUs.
	s, err := k.m10.CreateSession(ctx, ownerAM(), briefID, SessionInput{
		Platform: PlatformTikTok, RequestedDatetime: "2026-07-05 19:00:00", TargetDurationHours: "2",
		ProductsTalent: "3 newest SKUs",
	})
	if err != nil {
		t.Fatal(err)
	}
	// Vendor confirms the slot the same day.
	if err := onlyErr(k.m10.ConfirmByVendor(ctx, ownerAM(), s.ID)); err != nil {
		t.Fatal(err)
	}
	// Airs 1h20m instead of 2h; viewers 1,200 peak; orders 18; GMV Rp 6.400.000.
	peak := 1200
	orders := 18
	if err := onlyErr(k.m10.LogResults(ctx, ownerAM(), s.ID, ResultInput{
		ActualDatetime: "2026-07-05 19:00:00", ActualDurationHours: "1.333",
		ViewersPeak: &peak, OrdersGenerated: &orders, GMV: "6400000",
		VendorReportLink: "https://drive/alpha-report",
	})); err != nil {
		t.Fatal(err)
	}
	// Flag: "durasi di bawah target, perlu dikonfirmasi ke vendor."
	if err := onlyErr(k.m10.FlagDiscrepancy(ctx, ownerAM(), s.ID,
		"durasi di bawah target, perlu dikonfirmasi ke vendor.")); err != nil {
		t.Fatal(err)
	}
	if got := statusOf(t, k, "live_stream_sessions", s.ID); got != LssDiscrepancy {
		t.Fatalf("status = %q, want [Discrepancy Flagged]", got)
	}
	// After the off-system vendor conversation, Sinta updates to [Reconciled] → Brief closes.
	if err := onlyErr(k.m10.Reconcile(ctx, ownerAM(), s.ID)); err != nil {
		t.Fatal(err)
	}
	got, err := k.m10.GetSession(ctx, ownerAM(), s.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != LssReconciled {
		t.Fatalf("status = %q, want [Reconciled]", got.Status)
	}
	if got.GMVDisplay != "Rp. 6.400.000,00" {
		t.Errorf("gmv display = %q, want Rp. 6.400.000,00", got.GMVDisplay)
	}
	if got.ReconciliationNotes == "" {
		t.Error("reconciliation notes lost")
	}
	if statusOf(t, k, "briefs", briefID) != BriefApproved {
		t.Errorf("brief did not close to [Approved]")
	}
}

// ---- Discrepancy notification (M10-OA-3): SPV Account notified real-time ----

func TestDiscrepancyNotification(t *testing.T) {
	k := setup(t)
	cat := notification.NewCatalog()
	// Wire the engine hook exactly as httpapi.onTransition does for MLiveStreamSession.
	k.m10.Engine.SetHook(func(ev statemachine.Event) error {
		if ev.Machine == statemachine.MLiveStreamSession && ev.To == LssDiscrepancy {
			_, err := cat.Emit(ev.Ctx, ev.Tx, notification.Emission{
				Event: notification.EvSessionDiscrepancyFlagged, EntityType: ev.EntityType, EntityID: ev.EntityID,
				Actor: ev.Actor.EmployeeID, Division: AccountDivision,
			})
			return err
		}
		return nil
	})
	// An active Account lead is the recipient (leadsOfDivision resolver).
	testutil.InsertEmployee(t, k.m10.DB, "EMP-AL", "Head Account", "al@mea.id", "Account", "Head Account", true)
	testutil.InsertRoleMapping(t, k.m10.DB, "Account", "Head Account", "Account", "lead")

	sID, _ := stdSession(t, k, "N")
	if err := onlyErr(k.m10.ConfirmByVendor(ctx, ownerAM(), sID)); err != nil {
		t.Fatal(err)
	}
	if err := onlyErr(k.m10.LogResults(ctx, ownerAM(), sID, goodResults())); err != nil {
		t.Fatal(err)
	}
	if err := onlyErr(k.m10.FlagDiscrepancy(ctx, ownerAM(), sID, "durasi di bawah target")); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := k.m10.DB.QueryRow(
		`SELECT COUNT(*) FROM notifications WHERE recipient_employee_id=? AND event_type=? AND entity_type='live_stream_session'`,
		"EMP-AL", string(notification.EvSessionDiscrepancyFlagged)).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("discrepancy notifications to Account lead = %d, want 1", n)
	}
}

// ---- helpers ----

func hasAction(entries []audit.Entry, action string) bool {
	for _, e := range entries {
		if e.Action == action {
			return true
		}
	}
	return false
}

func actions(entries []audit.Entry) []string {
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		out = append(out, e.Action)
	}
	return out
}
