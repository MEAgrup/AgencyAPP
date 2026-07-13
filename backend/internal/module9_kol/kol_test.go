package module9_kol

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module6_account"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

const amID = "EMP-AM"

var ctx = context.Background()

// ---- actor helpers ----

func kolStaff(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: KOLDivision, Level: permission.LevelStaff}}
}
func kolLead(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: KOLDivision, Level: permission.LevelLead}}
}
func accountStaff(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: AccountDivision, Level: permission.LevelStaff}}
}
func accountLead(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: AccountDivision, Level: permission.LevelLead}}
}
func financeStaff(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: FinanceDivision, Level: permission.LevelStaff}}
}
func director(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Director: true}}
}
func od(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{OD: true}}
}
func otherDivStaff() permission.Actor {
	return permission.Actor{EmployeeID: "EMP-AD", Role: permission.Role{Division: "Ads", Level: permission.LevelStaff}}
}

// ---- fixtures ----

type kit struct {
	m9 *Service
	m6 *module6_account.Service
}

func setup(t *testing.T) *kit {
	t.Helper()
	d := testutil.DB(t)
	testutil.Clean(t, d)
	eng := statemachine.New()
	m6 := &module6_account.Service{DB: d, Engine: eng}
	m9 := &Service{DB: d, Engine: eng, Account: m6}
	return &kit{m9: m9, m6: m6}
}

// newKOLBrief creates a released client + owner AM (EMP-AM) + Direct service, then
// mints a KOL Brief in [To Do] with Quantity/Target = qty.
func newKOLBrief(t *testing.T, k *kit, suffix string, qty int) (briefID, svcID string) {
	t.Helper()
	d := k.m9.DB
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
		 VALUES (?, ?, 'MSV-X', 1, 'KOL Booking', '10000000.00', 'rule', '[Awaiting Onboarding]', 0, 'TEST')`,
		svcID, clientID); err != nil {
		t.Fatal(err)
	}
	b, err := k.m6.CreateBrief(ctx, accountStaff(amID), svcID, module6_account.BriefInput{
		Title: "Book KOLs " + suffix, AssignedDivision: KOLDivision, DeliverableType: "KOL Content",
		QuantityTarget: qty, DueDate: "2026-08-30", Priority: "High",
	})
	if err != nil {
		t.Fatalf("CreateBrief: %v", err)
	}
	return b.ID, svcID
}

func statusOf(t *testing.T, k *kit, table, id string) string {
	t.Helper()
	var st string
	if err := k.m9.DB.QueryRow("SELECT status FROM "+table+" WHERE id = ?", id).Scan(&st); err != nil {
		t.Fatal(err)
	}
	return st
}

func registerKOLStaff(t *testing.T, k *kit, id string) {
	t.Helper()
	testutil.InsertEmployee(t, k.m9.DB, id, "Staff "+id, id+"@mea.id", "KOL", "KOL Staff", true)
	testutil.InsertRoleMapping(t, k.m9.DB, "KOL", "KOL Staff", "KOL", "staff")
}

func registerKOLLead(t *testing.T, k *kit, id string) {
	t.Helper()
	testutil.InsertEmployee(t, k.m9.DB, id, "Lead "+id, id+"@mea.id", "KOL", "KOL Lead", true)
	testutil.InsertRoleMapping(t, k.m9.DB, "KOL", "KOL Lead", "KOL", "lead")
}

// stdBooking creates a booking on a fresh qty=1 KOL brief, self-claimed by a
// registered KOL staff member.
func stdBooking(t *testing.T, k *kit, suffix, staffID string) (bookingID, briefID, svcID string) {
	t.Helper()
	briefID, svcID = newKOLBrief(t, k, suffix, 1)
	registerKOLStaff(t, k, staffID)
	b, err := k.m9.CreateBooking(ctx, kolStaff(staffID), briefID, BookingInput{
		CreatorName: "TikTok Micro Creator", Platform: "TikTok",
		SourcePool: SourcePoolAdHoc, AgreedRate: "1500000",
	})
	if err != nil {
		t.Fatalf("CreateBooking: %v", err)
	}
	return b.ID, briefID, svcID
}

func onlyErr(_ statemachine.Result, err error) error { return err }

// ---- CreateBooking: validation, inheritance, permissions ----

func TestCreateBooking_Validation(t *testing.T) {
	k := setup(t)
	b, _ := newKOLBrief(t, k, "1", 3)
	lead := kolLead("EMP-KL")
	// Mandatory fields missing.
	if _, err := k.m9.CreateBooking(ctx, lead, b, BookingInput{Platform: "TikTok", SourcePool: SourcePoolMCN, AgreedRate: "1000000"}); !errors.Is(err, ErrIncomplete) {
		t.Errorf("missing name: want ErrIncomplete, got %v", err)
	}
	// Invalid source pool.
	if _, err := k.m9.CreateBooking(ctx, lead, b, BookingInput{CreatorName: "X", Platform: "TikTok", SourcePool: "Nope", AgreedRate: "1000000"}); !errors.Is(err, ErrInvalidSourcePool) {
		t.Errorf("bad pool: want ErrInvalidSourcePool, got %v", err)
	}
	// Zero rate.
	if _, err := k.m9.CreateBooking(ctx, lead, b, BookingInput{CreatorName: "X", Platform: "TikTok", SourcePool: SourcePoolMCN, AgreedRate: "0"}); !errors.Is(err, ErrIncomplete) {
		t.Errorf("zero rate: want ErrIncomplete, got %v", err)
	}
	// Valid (lead creates unassigned).
	bk, err := k.m9.CreateBooking(ctx, lead, b, BookingInput{CreatorName: "Andi", Platform: "TikTok", SourcePool: SourcePoolMCN, AgreedRate: "1500000"})
	if err != nil {
		t.Fatalf("valid create: %v", err)
	}
	if bk.Status != BkgSourcing {
		t.Errorf("status = %q, want [Sourcing]", bk.Status)
	}
	if bk.AgreedRateDisplay != "Rp. 1.500.000,00" {
		t.Errorf("rate display = %q", bk.AgreedRateDisplay)
	}
}

func TestCreateBooking_NonKOLBriefRejected(t *testing.T) {
	k := setup(t)
	d := k.m9.DB
	clientID, svcID := "CLI-ads", "SVC-ads"
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
		 VALUES (?, ?, 'MSV-X', 1, 'Ads', '10000000.00', 'rule', '[Awaiting Onboarding]', 0, 'TEST')`,
		svcID, clientID); err != nil {
		t.Fatal(err)
	}
	b, err := k.m6.CreateBrief(ctx, accountStaff(amID), svcID, module6_account.BriefInput{
		Title: "Ads", AssignedDivision: "Ads", DeliverableType: "Campaign", QuantityTarget: 1, DueDate: "2026-08-30", Priority: "High",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := k.m9.CreateBooking(ctx, kolLead("EMP-KL"), b.ID, BookingInput{CreatorName: "X", Platform: "TikTok", SourcePool: SourcePoolMCN, AgreedRate: "1000000"}); !errors.Is(err, ErrNotKOLBrief) {
		t.Errorf("Ads brief: want ErrNotKOLBrief, got %v", err)
	}
}

func TestCreateBooking_Permissions(t *testing.T) {
	k := setup(t)
	b, _ := newKOLBrief(t, k, "1", 5)
	in := BookingInput{CreatorName: "X", Platform: "TikTok", SourcePool: SourcePoolMCN, AgreedRate: "1000000"}
	for _, a := range []permission.Actor{accountStaff(amID), od("EMP-OD"), otherDivStaff()} {
		if _, err := k.m9.CreateBooking(ctx, a, b, in); !errors.Is(err, ErrExecForbidden) {
			t.Errorf("%+v create: want ErrExecForbidden, got %v", a.Role, err)
		}
	}
	if _, err := k.m9.CreateBooking(ctx, director("EMP-DIR"), b, in); err != nil {
		t.Errorf("director create: %v", err)
	}
}

// ---- Full worked example (Alpha Digital, §4/§5/§8): lifecycle + rollup + CPR ----

func TestFullBookingFlow_RollupPaymentCreatorList(t *testing.T) {
	k := setup(t)
	bkID, briefID, svcID := stdBooking(t, k, "1", "EMP-PUTRI")
	staff := kolStaff("EMP-PUTRI")

	// Sourcing -> Booked: Brief leaves [To Do] -> [In Progress]; Service -> [In Execution].
	if _, err := k.m9.Book(ctx, staff, bkID); err != nil {
		t.Fatalf("Book: %v", err)
	}
	if got := statusOf(t, k, "briefs", briefID); got != briefInProgress {
		t.Errorf("brief = %q, want [In Progress] (rollup)", got)
	}
	if got := statusOf(t, k, "services", svcID); got != serviceInExecution {
		t.Errorf("service = %q, want [In Execution]", got)
	}
	// Content -> submit (link mandatory) -> Brief [Submitted].
	if _, err := k.m9.StartContent(ctx, staff, bkID); err != nil {
		t.Fatal(err)
	}
	if err := onlyErr(k.m9.SubmitContent(ctx, staff, bkID, "  ")); !errors.Is(err, ErrContentLinkRequired) {
		t.Errorf("blank link: want ErrContentLinkRequired, got %v", err)
	}
	if _, err := k.m9.SubmitContent(ctx, staff, bkID, "https://tiktok/x"); err != nil {
		t.Fatalf("SubmitContent: %v", err)
	}
	if got := statusOf(t, k, "briefs", briefID); got != briefSubmitted {
		t.Errorf("brief = %q, want [Submitted]", got)
	}
	// QC review -> fail (1 revision) -> resubmit -> QC review -> pass.
	if _, err := k.m9.SendToQCReview(ctx, staff, bkID); err != nil {
		t.Fatal(err)
	}
	if got := statusOf(t, k, "briefs", briefID); got != briefInReview {
		t.Errorf("brief = %q, want [In Review]", got)
	}
	if err := onlyErr(k.m9.FailQC(ctx, staff, bkID, "")); !errors.Is(err, ErrQCNotesRequired) {
		t.Errorf("fail w/o notes: want ErrQCNotesRequired, got %v", err)
	}
	if _, err := k.m9.FailQC(ctx, staff, bkID, "missing product-link sticker"); err != nil {
		t.Fatalf("FailQC: %v", err)
	}
	if _, err := k.m9.Resubmit(ctx, staff, bkID, "https://tiktok/x2"); err != nil {
		t.Fatalf("Resubmit: %v", err)
	}
	if _, err := k.m9.SendToQCReview(ctx, staff, bkID); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m9.PassQC(ctx, staff, bkID); err != nil {
		t.Fatalf("PassQC: %v", err)
	}
	if got := statusOf(t, k, "creator_bookings", bkID); got != BkgQCPassed {
		t.Errorf("booking = %q, want [QC Passed]", got)
	}
	if got := statusOf(t, k, "briefs", briefID); got != briefApproved {
		t.Errorf("brief = %q, want [Approved] (rollup)", got)
	}
	// Revision Count = 1 (derived).
	got, err := k.m9.GetBooking(ctx, director("EMP-DIR"), bkID)
	if err != nil {
		t.Fatal(err)
	}
	if got.RevisionCount != 1 {
		t.Errorf("revision count = %d, want 1", got.RevisionCount)
	}

	// ---- Creator Payment Request (§8): amount must equal Agreed Rate ----
	if _, err := k.m9.CreatePaymentRequest(ctx, staff, bkID, "9999999", "BCA 123"); !errors.Is(err, ErrPaymentAmountMismatch) {
		t.Errorf("mismatch amount: want ErrPaymentAmountMismatch, got %v", err)
	}
	if _, err := k.m9.CreatePaymentRequest(ctx, staff, bkID, "1500000", ""); !errors.Is(err, ErrPaymentDetailsRequired) {
		t.Errorf("no details: want ErrPaymentDetailsRequired, got %v", err)
	}
	cpr, err := k.m9.CreatePaymentRequest(ctx, staff, bkID, "1500000", "BCA 123456")
	if err != nil {
		t.Fatalf("CreatePaymentRequest: %v", err)
	}
	// Finance-side lifecycle.
	fin := financeStaff("EMP-FIN")
	if err := onlyErr(k.m9.ReceiveByFinance(ctx, staff, cpr.ID)); !errors.Is(err, ErrFinanceForbidden) {
		t.Errorf("KOL receive: want ErrFinanceForbidden, got %v", err)
	}
	if _, err := k.m9.ReceiveByFinance(ctx, fin, cpr.ID); err != nil {
		t.Fatalf("ReceiveByFinance: %v", err)
	}
	if _, err := k.m9.MarkPaid(ctx, fin, cpr.ID); err != nil {
		t.Fatalf("MarkPaid: %v", err)
	}
	// Booking payment status reflects [Paid] (derived).
	got, _ = k.m9.GetBooking(ctx, director("EMP-DIR"), bkID)
	if got.PaymentStatus != CprPaid {
		t.Errorf("payment reflection = %q, want [Paid]", got.PaymentStatus)
	}

	// ---- Creator List (§6): the passed booking is the sole eligible entry ----
	cl, err := k.m9.GenerateCreatorList(ctx, staff, briefID, "https://drive/creatorlist")
	if err != nil {
		t.Fatalf("GenerateCreatorList: %v", err)
	}
	if len(cl.IncludedBookings) != 1 || cl.IncludedBookings[0] != bkID {
		t.Errorf("creator list included = %v, want [%s]", cl.IncludedBookings, bkID)
	}
}

// ---- Revision cap (M9-OA-2 = 1): 2nd fail blocked, escalation allowed ----

func TestRevisionCap(t *testing.T) {
	k := setup(t)
	bkID, _, _ := stdBooking(t, k, "1", "EMP-PUTRI")
	staff := kolStaff("EMP-PUTRI")
	lead := kolLead("EMP-KL")
	registerKOLLead(t, k, "EMP-KL")

	// Reach QC review, fail once (allowed).
	drive(t, k, staff, bkID, "Book", "StartContent")
	if _, err := k.m9.SubmitContent(ctx, staff, bkID, "link"); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m9.SendToQCReview(ctx, staff, bkID); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m9.FailQC(ctx, staff, bkID, "fix 1"); err != nil {
		t.Fatal(err)
	}
	// Resubmit, back to QC review, second fail is capped.
	if _, err := k.m9.Resubmit(ctx, staff, bkID, "link2"); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m9.SendToQCReview(ctx, staff, bkID); err != nil {
		t.Fatal(err)
	}
	if err := onlyErr(k.m9.FailQC(ctx, staff, bkID, "fix 2")); !errors.Is(err, ErrRevisionCapReached) {
		t.Errorf("2nd fail: want ErrRevisionCapReached, got %v", err)
	}
	// Escalation is the only move left (KOL lead).
	if err := onlyErr(k.m9.Escalate(ctx, staff, bkID, "unresponsive")); !errors.Is(err, ErrEscalateForbidden) {
		t.Errorf("staff escalate: want ErrEscalateForbidden, got %v", err)
	}
	if _, err := k.m9.Escalate(ctx, lead, bkID, "creator unresponsive after cap"); err != nil {
		t.Fatalf("Escalate: %v", err)
	}
	if got := statusOf(t, k, "creator_bookings", bkID); got != BkgEscalated {
		t.Errorf("booking = %q, want [Escalated ...]", got)
	}
}

// ---- Escalation resolution: drop (KOL lead / Account lead / Director) + reason ----

func TestEscalateAndDrop(t *testing.T) {
	k := setup(t)
	bkID, _, _ := stdBooking(t, k, "1", "EMP-PUTRI")
	staff := kolStaff("EMP-PUTRI")
	lead := kolLead("EMP-KL")
	registerKOLLead(t, k, "EMP-KL")
	drive(t, k, staff, bkID, "Book", "StartContent")
	if _, err := k.m9.SubmitContent(ctx, staff, bkID, "link"); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m9.SendToQCReview(ctx, staff, bkID); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m9.Escalate(ctx, lead, bkID, "gone dark"); err != nil {
		t.Fatal(err)
	}
	// Drop reason mandatory; KOL staff cannot drop.
	if err := onlyErr(k.m9.Drop(ctx, staff, bkID, "x")); !errors.Is(err, ErrDropForbidden) {
		t.Errorf("staff drop: want ErrDropForbidden, got %v", err)
	}
	if err := onlyErr(k.m9.Drop(ctx, lead, bkID, "")); !errors.Is(err, ErrDropReasonRequired) {
		t.Errorf("no reason: want ErrDropReasonRequired, got %v", err)
	}
	// Account lead (M9-OA-6 tie-breaker) may drop.
	if _, err := k.m9.Drop(ctx, accountLead("EMP-ALEAD"), bkID, "re-source new creator"); err != nil {
		t.Fatalf("Drop by Account lead: %v", err)
	}
	if got := statusOf(t, k, "creator_bookings", bkID); got != BkgDropped {
		t.Errorf("booking = %q, want [Dropped]", got)
	}
}

// ---- Invalid transition is blocked with the BI message; nothing changes ----

func TestInvalidTransitionBlocked(t *testing.T) {
	k := setup(t)
	bkID, _, _ := stdBooking(t, k, "1", "EMP-PUTRI")
	staff := kolStaff("EMP-PUTRI")
	// Cannot submit content straight from [Sourcing].
	var be *statemachine.BlockedError
	if err := onlyErr(k.m9.SubmitContent(ctx, staff, bkID, "link")); !errors.As(err, &be) {
		t.Errorf("submit from sourcing: want BlockedError, got %v", err)
	}
	if got := statusOf(t, k, "creator_bookings", bkID); got != BkgSourcing {
		t.Errorf("status changed to %q after blocked transition", got)
	}
}

// ---- Execution gate: claim model (pre/post coordinator assignment) ----

func TestExecutionGate_ClaimModel(t *testing.T) {
	k := setup(t)
	briefID, _ := newKOLBrief(t, k, "1", 1)
	registerKOLStaff(t, k, "EMP-A")
	registerKOLStaff(t, k, "EMP-B")
	// Lead creates an UNASSIGNED booking.
	bk, err := k.m9.CreateBooking(ctx, kolLead("EMP-KL"), briefID, BookingInput{
		CreatorName: "X", Platform: "TikTok", SourcePool: SourcePoolMCN, AgreedRate: "1000000",
	})
	if err != nil {
		t.Fatal(err)
	}
	// Unassigned: any KOL staff may drive.
	if _, err := k.m9.Book(ctx, kolStaff("EMP-A"), bk.ID); err != nil {
		t.Fatalf("unassigned Book by EMP-A: %v", err)
	}
	// Assign to EMP-A; now EMP-B (a different staff) cannot drive.
	registerKOLLead(t, k, "EMP-KL")
	if err := k.m9.AssignCoordinator(ctx, kolLead("EMP-KL"), bk.ID, "EMP-A", ""); err != nil {
		t.Fatalf("AssignCoordinator: %v", err)
	}
	if err := onlyErr(k.m9.StartContent(ctx, kolStaff("EMP-B"), bk.ID)); !errors.Is(err, ErrExecForbidden) {
		t.Errorf("EMP-B post-assign: want ErrExecForbidden, got %v", err)
	}
	if _, err := k.m9.StartContent(ctx, kolStaff("EMP-A"), bk.ID); err != nil {
		t.Errorf("assigned coordinator drive: %v", err)
	}
}

// ---- Reassignment requires a reason (§3 Rule 3) ----

func TestReassignReason(t *testing.T) {
	k := setup(t)
	bkID, _, _ := stdBooking(t, k, "1", "EMP-PUTRI") // self-assigned to EMP-PUTRI
	registerKOLStaff(t, k, "EMP-DEWI")
	registerKOLLead(t, k, "EMP-KL")
	lead := kolLead("EMP-KL")
	// Reassign to a different coordinator without a reason.
	if err := k.m9.AssignCoordinator(ctx, lead, bkID, "EMP-DEWI", ""); !errors.Is(err, ErrReassignReasonRequired) {
		t.Errorf("reassign w/o reason: want ErrReassignReasonRequired, got %v", err)
	}
	if err := k.m9.AssignCoordinator(ctx, lead, bkID, "EMP-DEWI", "relationship not working out"); err != nil {
		t.Fatalf("reassign: %v", err)
	}
	// A non-lead cannot assign.
	if err := k.m9.AssignCoordinator(ctx, kolStaff("EMP-PUTRI"), bkID, "EMP-DEWI", "x"); !errors.Is(err, ErrAssignForbidden) {
		t.Errorf("staff assign: want ErrAssignForbidden, got %v", err)
	}
}

// ---- CPR guards: only after QC Passed; Finance reject reason ----

func TestCPR_Guards(t *testing.T) {
	k := setup(t)
	bkID, _, _ := stdBooking(t, k, "1", "EMP-PUTRI")
	staff := kolStaff("EMP-PUTRI")
	// Not yet passed.
	if _, err := k.m9.CreatePaymentRequest(ctx, staff, bkID, "1500000", "BCA 1"); !errors.Is(err, ErrPaymentBookingNotPassed) {
		t.Errorf("pre-pass CPR: want ErrPaymentBookingNotPassed, got %v", err)
	}
	// Drive to QC Passed.
	drive(t, k, staff, bkID, "Book", "StartContent")
	if _, err := k.m9.SubmitContent(ctx, staff, bkID, "link"); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m9.SendToQCReview(ctx, staff, bkID); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m9.PassQC(ctx, staff, bkID); err != nil {
		t.Fatal(err)
	}
	cpr, err := k.m9.CreatePaymentRequest(ctx, staff, bkID, "1500000", "BCA 1")
	if err != nil {
		t.Fatal(err)
	}
	// A second active request is blocked.
	if _, err := k.m9.CreatePaymentRequest(ctx, staff, bkID, "1500000", "BCA 1"); !errors.Is(err, ErrPaymentAlreadyRequested) {
		t.Errorf("second CPR: want ErrPaymentAlreadyRequested, got %v", err)
	}
	fin := financeStaff("EMP-FIN")
	if _, err := k.m9.ReceiveByFinance(ctx, fin, cpr.ID); err != nil {
		t.Fatal(err)
	}
	// Reject requires a reason.
	if err := onlyErr(k.m9.Reject(ctx, fin, cpr.ID, "")); !errors.Is(err, ErrRejectionReasonRequired) {
		t.Errorf("reject w/o reason: want ErrRejectionReasonRequired, got %v", err)
	}
	if _, err := k.m9.Reject(ctx, fin, cpr.ID, "rekening tidak cocok"); err != nil {
		t.Fatalf("Reject: %v", err)
	}
	// After rejection a fresh request is allowed again.
	if _, err := k.m9.CreatePaymentRequest(ctx, staff, bkID, "1500000", "BCA 2"); err != nil {
		t.Errorf("re-request after reject: %v", err)
	}
}

// ---- Read visibility (§10.1) ----

func TestGetBooking_Visibility(t *testing.T) {
	k := setup(t)
	bkID, _, _ := stdBooking(t, k, "1", "EMP-PUTRI")
	allow := []permission.Actor{
		accountStaff(amID), accountLead("EMP-ALEAD"), od("EMP-OD"), director("EMP-DIR"),
		kolStaff("EMP-K"), kolLead("EMP-KL"),
	}
	for _, act := range allow {
		if _, err := k.m9.GetBooking(ctx, act, bkID); err != nil {
			t.Errorf("%+v should view: %v", act.Role, err)
		}
	}
	deny := []permission.Actor{accountStaff("EMP-OTHER"), otherDivStaff()}
	for _, act := range deny {
		if _, err := k.m9.GetBooking(ctx, act, bkID); !errors.Is(err, ErrBookingViewForbidden) {
			t.Errorf("%+v must be denied, got %v", act.Role, err)
		}
	}
}

// ---- recompute-from-log metrics (§7 sub-turnarounds + §11 overall speed score) ----

func TestBookingMetrics_RecomputeFromLog(t *testing.T) {
	k := setup(t)
	bkID, _, _ := stdBooking(t, k, "1", "EMP-PUTRI")
	// Isolate the recompute path: set status + SLA + created_at out-of-band, seed log.
	created := time.Date(2026, 6, 1, 9, 0, 0, 0, time.UTC)
	if _, err := k.m9.DB.Exec(
		`UPDATE creator_bookings SET status='[QC Passed]', sla_target_hours=104, created_at=? WHERE id=?`,
		created, bkID); err != nil {
		t.Fatal(err)
	}
	seed := []struct {
		from, to string
		at       time.Time
	}{
		{BkgSourcing, BkgBooked, time.Date(2026, 6, 1, 15, 0, 0, 0, time.UTC)},             // sourcing 6h
		{BkgBooked, BkgContentInProg, time.Date(2026, 6, 1, 16, 0, 0, 0, time.UTC)},        //
		{BkgContentInProg, BkgContentSubmit, time.Date(2026, 6, 4, 15, 0, 0, 0, time.UTC)}, // delivery 72h
		{BkgContentSubmit, BkgQCReview, time.Date(2026, 6, 4, 15, 0, 0, 0, time.UTC)},
		{BkgQCReview, BkgQCFailed, time.Date(2026, 6, 4, 17, 0, 0, 0, time.UTC)}, // revision 1
		{BkgQCFailed, BkgContentSubmit, time.Date(2026, 6, 5, 15, 0, 0, 0, time.UTC)},
		{BkgContentSubmit, BkgQCReview, time.Date(2026, 6, 5, 15, 0, 0, 0, time.UTC)},
		{BkgQCReview, BkgQCPassed, time.Date(2026, 6, 5, 17, 0, 0, 0, time.UTC)}, // overall 104h
	}
	for _, e := range seed {
		if _, err := k.m9.DB.Exec(
			`INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, created_at, created_by)
			 VALUES ('creator_booking', ?, 'EMP-PUTRI', ?, ?, 'EMP-PUTRI')`,
			bkID, "transition:"+e.from+"->"+e.to, e.at); err != nil {
			t.Fatal(err)
		}
	}
	m, err := k.m9.BookingMetrics(ctx, director("EMP-DIR"), bkID)
	if err != nil {
		t.Fatal(err)
	}
	if m.SourcingTurnaroundHours == nil || *m.SourcingTurnaroundHours != 6 {
		t.Errorf("sourcing turnaround = %v, want 6", m.SourcingTurnaroundHours)
	}
	if m.DeliveryTurnaroundHours == nil || *m.DeliveryTurnaroundHours != 72 {
		t.Errorf("delivery turnaround = %v, want 72", m.DeliveryTurnaroundHours)
	}
	if m.OverallTurnaroundHours == nil || *m.OverallTurnaroundHours != 104 {
		t.Errorf("overall turnaround = %v, want 104", m.OverallTurnaroundHours)
	}
	if m.SpeedScorePct == nil || *m.SpeedScorePct != 100 {
		t.Errorf("speed score = %v, want 100", m.SpeedScorePct)
	}
	if m.RevisionCount != 1 {
		t.Errorf("revision count = %d, want 1", m.RevisionCount)
	}
	if m.ExcludedFromSpeedScore {
		t.Error("passed booking must NOT be excluded from speed score")
	}
}

func TestBookingMetrics_DroppedExcluded(t *testing.T) {
	k := setup(t)
	bkID, _, _ := stdBooking(t, k, "1", "EMP-PUTRI")
	if _, err := k.m9.DB.Exec(`UPDATE creator_bookings SET status='[Dropped]', sla_target_hours=48 WHERE id=?`, bkID); err != nil {
		t.Fatal(err)
	}
	m, err := k.m9.BookingMetrics(ctx, director("EMP-DIR"), bkID)
	if err != nil {
		t.Fatal(err)
	}
	if !m.ExcludedFromSpeedScore || m.SpeedScorePct != nil {
		t.Errorf("dropped booking: want excluded + nil speed, got excluded=%v speed=%v", m.ExcludedFromSpeedScore, m.SpeedScorePct)
	}
}

// ---- immutability: Booking audit rows cannot be mutated (house rule 3) ----

func TestBookingHistoryImmutable(t *testing.T) {
	k := setup(t)
	bkID, _, _ := stdBooking(t, k, "1", "EMP-PUTRI")
	var id int64
	if err := k.m9.DB.QueryRow(
		`SELECT id FROM audit_log WHERE entity_id=? AND action='create'`, bkID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m9.DB.Exec(`UPDATE audit_log SET action='x' WHERE id=?`, id); err == nil {
		t.Error("expected UPDATE on audit_log to be blocked")
	}
	if _, err := k.m9.DB.Exec(`DELETE FROM audit_log WHERE id=?`, id); err == nil {
		t.Error("expected DELETE on audit_log to be blocked")
	}
}

// ---- QC Failed / Escalated fires EvKOLQCFailedOrEscalated (already cataloged) ----

func TestQCFailedEscalatedNotification(t *testing.T) {
	k := setup(t)
	cat := notification.NewCatalog()
	// Wire the engine hook exactly as httpapi.onTransition does for MCreatorBooking.
	k.m9.Engine.SetHook(func(ev statemachine.Event) error {
		if ev.Machine == statemachine.MCreatorBooking &&
			(ev.To == BkgQCFailed || ev.To == BkgEscalated) {
			_, err := cat.Emit(ev.Ctx, ev.Tx, notification.Emission{
				Event: notification.EvKOLQCFailedOrEscalated, EntityType: ev.EntityType, EntityID: ev.EntityID,
				Actor: ev.Actor.EmployeeID, Division: KOLDivision,
			})
			return err
		}
		return nil
	})
	registerKOLLead(t, k, "EMP-KL")
	bkID, _, _ := stdBooking(t, k, "1", "EMP-PUTRI")
	staff := kolStaff("EMP-PUTRI")
	drive(t, k, staff, bkID, "Book", "StartContent")
	if _, err := k.m9.SubmitContent(ctx, staff, bkID, "link"); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m9.SendToQCReview(ctx, staff, bkID); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m9.FailQC(ctx, staff, bkID, "revisi"); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := k.m9.DB.QueryRow(
		`SELECT COUNT(*) FROM notifications WHERE recipient_employee_id=? AND event_type=? AND entity_type='creator_booking'`,
		"EMP-KL", string(notification.EvKOLQCFailedOrEscalated)).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("QC-failed notifications to KOL lead = %d, want 1", n)
	}
}

// drive runs a sequence of no-arg lifecycle steps by name (test helper).
func drive(t *testing.T, k *kit, actor permission.Actor, bkID string, steps ...string) {
	t.Helper()
	for _, s := range steps {
		var err error
		switch s {
		case "Book":
			_, err = k.m9.Book(ctx, actor, bkID)
		case "StartContent":
			_, err = k.m9.StartContent(ctx, actor, bkID)
		case "SendToQCReview":
			_, err = k.m9.SendToQCReview(ctx, actor, bkID)
		case "PassQC":
			_, err = k.m9.PassQC(ctx, actor, bkID)
		default:
			t.Fatalf("unknown step %q", s)
		}
		if err != nil {
			t.Fatalf("step %s: %v", s, err)
		}
	}
}
