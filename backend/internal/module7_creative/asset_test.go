package module7_creative

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module12_task"
	"github.com/meagrup/agencyapp/backend/internal/module6_account"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

const amID = "EMP-AM"

var ctx = context.Background()

// ---- actor helpers ----

func creativeStaff(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: CreativeDivision, Level: permission.LevelStaff}}
}
func creativeLead(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: CreativeDivision, Level: permission.LevelLead}}
}
func accountStaff(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: AccountDivision, Level: permission.LevelStaff}}
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

// ---- fixtures ----

type kit struct {
	m7  *Service
	m6  *module6_account.Service
	m12 *module12_task.Service
}

func setup(t *testing.T) *kit {
	t.Helper()
	d := testutil.DB(t)
	testutil.Clean(t, d)
	eng := statemachine.New()
	m6 := &module6_account.Service{DB: d, Engine: eng}
	m12 := &module12_task.Service{DB: d, Engine: eng, Account: m6}
	m7 := &Service{DB: d, Engine: eng, Tasks: m12}
	return &kit{m7: m7, m6: m6, m12: m12}
}

// newCreativeBrief creates a released client + owner AM (EMP-AM) + Direct service,
// then mints a Creative Brief in [To Do] with Quantity/Target = qty.
func newCreativeBrief(t *testing.T, k *kit, suffix string, qty int) (briefID, svcID string) {
	t.Helper()
	d := k.m7.DB
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
		 VALUES (?, ?, 'MSV-X', 1, 'TikTok Shop Full Management', '10000000.00', 'rule', '[Awaiting Onboarding]', 0, 'TEST')`,
		svcID, clientID); err != nil {
		t.Fatal(err)
	}
	b, err := k.m6.CreateBrief(ctx, accountStaff(amID), svcID, module6_account.BriefInput{
		Title: "Videos " + suffix, AssignedDivision: CreativeDivision, DeliverableType: "Product Video",
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
	if err := k.m7.DB.QueryRow("SELECT status FROM "+table+" WHERE id = ?", id).Scan(&st); err != nil {
		t.Fatal(err)
	}
	return st
}

func registerStaff(t *testing.T, k *kit, id, div string) {
	t.Helper()
	testutil.InsertEmployee(t, k.m7.DB, id, "Staff "+id, id+"@mea.id", div, div+" Staff", true)
	testutil.InsertRoleMapping(t, k.m7.DB, div, div+" Staff", div, "staff")
}

func registerLead(t *testing.T, k *kit, id, div string) {
	t.Helper()
	testutil.InsertEmployee(t, k.m7.DB, id, "Lead "+id, id+"@mea.id", div, div+" Lead", true)
	testutil.InsertRoleMapping(t, k.m7.DB, div, div+" Lead", div, "lead")
}

func onlyErr(_ statemachine.Result, err error) error { return err }

// ---- CreateAsset: breakdown, inheritance, validation, permissions ----

func TestCreateAsset_InheritanceAndSelfClaim(t *testing.T) {
	k := setup(t)
	b, _ := newCreativeBrief(t, k, "1", 12)
	registerStaff(t, k, "EMP-RIAN", CreativeDivision)
	a, err := k.m7.CreateAsset(ctx, creativeStaff("EMP-RIAN"), b, AssetInput{SequenceNo: 1})
	if err != nil {
		t.Fatalf("CreateAsset: %v", err)
	}
	if a.AssetType != "Product Video" {
		t.Errorf("asset_type = %q, want inherited Product Video", a.AssetType)
	}
	if a.AssignedPIC != "EMP-RIAN" {
		t.Errorf("assigned_pic = %q, want self-claim EMP-RIAN", a.AssignedPIC)
	}
	if a.Status != StatusToDo {
		t.Errorf("status = %q, want [To Do]", a.Status)
	}
}

func TestCreateAsset_Validation(t *testing.T) {
	k := setup(t)
	b, _ := newCreativeBrief(t, k, "1", 3)
	lead := creativeLead("EMP-CL")
	// Sequence mandatory.
	if _, err := k.m7.CreateAsset(ctx, lead, b, AssetInput{SequenceNo: 0}); !errors.Is(err, ErrIncomplete) {
		t.Errorf("seq 0: want ErrIncomplete, got %v", err)
	}
	// Sequence out of range (> Quantity/Target).
	if _, err := k.m7.CreateAsset(ctx, lead, b, AssetInput{SequenceNo: 4}); !errors.Is(err, ErrInvalidSequence) {
		t.Errorf("seq 4/3: want ErrInvalidSequence, got %v", err)
	}
	// Valid.
	if _, err := k.m7.CreateAsset(ctx, lead, b, AssetInput{SequenceNo: 2}); err != nil {
		t.Fatalf("valid create: %v", err)
	}
	// Duplicate sequence.
	if _, err := k.m7.CreateAsset(ctx, lead, b, AssetInput{SequenceNo: 2}); !errors.Is(err, ErrDuplicateSequence) {
		t.Errorf("dup seq: want ErrDuplicateSequence, got %v", err)
	}
}

func TestCreateAsset_Permissions(t *testing.T) {
	k := setup(t)
	b, _ := newCreativeBrief(t, k, "1", 5)
	// AM, OD, other-division staff cannot create.
	for _, a := range []permission.Actor{accountStaff(amID), od("EMP-OD"), creativeStaffOtherDiv()} {
		if _, err := k.m7.CreateAsset(ctx, a, b, AssetInput{SequenceNo: 1}); !errors.Is(err, ErrAssetCreateForbidden) {
			t.Errorf("%+v create: want ErrAssetCreateForbidden, got %v", a.Role, err)
		}
	}
	// Director can.
	if _, err := k.m7.CreateAsset(ctx, director("EMP-DIR"), b, AssetInput{SequenceNo: 1}); err != nil {
		t.Errorf("director create: %v", err)
	}
}

func creativeStaffOtherDiv() permission.Actor {
	return permission.Actor{EmployeeID: "EMP-AD", Role: permission.Role{Division: "Ads", Level: permission.LevelStaff}}
}

func TestCreateAsset_NonCreativeBriefRejected(t *testing.T) {
	k := setup(t)
	// An Ads brief has no Assets.
	clientID, svcID := "CLI-ads", "SVC-ads"
	d := k.m7.DB
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
		Title: "Ads", AssignedDivision: "Ads", DeliverableType: "Campaign",
		QuantityTarget: 1, DueDate: "2026-08-30", Priority: "High",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := k.m7.CreateAsset(ctx, creativeLead("EMP-CL"), b.ID, AssetInput{SequenceNo: 1}); !errors.Is(err, ErrNotCreativeBrief) {
		t.Errorf("Ads brief: want ErrNotCreativeBrief, got %v", err)
	}
}

// ---- Full single-Asset flow + Brief roll-up + Service advance + metrics ----

func TestFullAssetFlow_RollupAndMetrics(t *testing.T) {
	k := setup(t)
	b, svc := newCreativeBrief(t, k, "1", 1)
	staff := creativeStaff("EMP-RIAN")
	lead := creativeLead("EMP-CL")
	am := accountStaff(amID)
	registerStaff(t, k, "EMP-RIAN", CreativeDivision)

	a, err := k.m7.CreateAsset(ctx, staff, b, AssetInput{SequenceNo: 1})
	if err != nil {
		t.Fatal(err)
	}
	// SLA target on the Asset (via the shared M12 engine).
	if err := k.m12.SetAssetSLA(ctx, lead, a.ID, 48); err != nil {
		t.Fatalf("SetAssetSLA: %v", err)
	}
	// Start -> Brief leaves [To Do] via roll-up -> Service [In Execution].
	if _, err := k.m12.StartAsset(ctx, staff, a.ID); err != nil {
		t.Fatalf("StartAsset: %v", err)
	}
	if got := statusOf(t, k, "briefs", b); got != StatusInProgress {
		t.Errorf("brief = %q, want [In Progress] (roll-up)", got)
	}
	if got := statusOf(t, k, "services", svc); got != "[In Execution]" {
		t.Errorf("service = %q, want [In Execution]", got)
	}
	// Submit requires an output link.
	if _, err := k.m12.SubmitAsset(ctx, staff, a.ID, "  "); !errors.Is(err, module12_task.ErrOutputLinkRequired) {
		t.Errorf("blank link: want ErrOutputLinkRequired, got %v", err)
	}
	if _, err := k.m12.SubmitAsset(ctx, staff, a.ID, "https://drive/x"); err != nil {
		t.Fatalf("SubmitAsset: %v", err)
	}
	if got := statusOf(t, k, "briefs", b); got != StatusSubmitted {
		t.Errorf("brief = %q, want [Submitted] (all assets submitted)", got)
	}
	// AM review at Asset granularity.
	if _, err := k.m7.ReviewAsset(ctx, am, a.ID); err != nil {
		t.Fatal(err)
	}
	if got := statusOf(t, k, "briefs", b); got != StatusInReview {
		t.Errorf("brief = %q, want [In Review]", got)
	}
	if _, err := k.m7.ApproveAsset(ctx, am, a.ID); err != nil {
		t.Fatal(err)
	}
	if got := statusOf(t, k, "assets", a.ID); got != StatusApproved {
		t.Errorf("asset = %q, want [Approved]", got)
	}
	if got := statusOf(t, k, "briefs", b); got != StatusApproved {
		t.Errorf("brief = %q, want [Approved] (all assets approved)", got)
	}
	// Metrics via the shared engine.
	m, err := k.m12.AssetMetrics(ctx, lead, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if m.TurnaroundHours == nil || m.SpeedScorePct == nil {
		t.Fatalf("metrics = %+v, want turnaround + speed computed", m)
	}
	if m.SLATargetHours == nil || *m.SLATargetHours != 48 {
		t.Errorf("sla = %v, want 48", m.SLATargetHours)
	}
}

// ---- Multi-Asset roll-up: siblings independent; revision keeps Brief [In Review] ----

func TestMultiAsset_Rollup(t *testing.T) {
	k := setup(t)
	b, _ := newCreativeBrief(t, k, "1", 2)
	staff := creativeStaff("EMP-RIAN")
	am := accountStaff(amID)
	registerStaff(t, k, "EMP-RIAN", CreativeDivision)

	a1, _ := k.m7.CreateAsset(ctx, staff, b, AssetInput{SequenceNo: 1})
	a2, _ := k.m7.CreateAsset(ctx, staff, b, AssetInput{SequenceNo: 2})

	// Both start + submit.
	for _, a := range []Asset{a1, a2} {
		if _, err := k.m12.StartAsset(ctx, staff, a.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := k.m12.SubmitAsset(ctx, staff, a.ID, "link"); err != nil {
			t.Fatal(err)
		}
	}
	if got := statusOf(t, k, "briefs", b); got != StatusSubmitted {
		t.Errorf("brief = %q, want [Submitted] (both submitted)", got)
	}
	// Approve a1; request revision on a2 -> Brief stays [In Review], a1 untouched.
	if _, err := k.m7.ReviewAsset(ctx, am, a1.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m7.ApproveAsset(ctx, am, a1.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m7.ReviewAsset(ctx, am, a2.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m7.RequestAssetRevision(ctx, am, a2.ID, "hook kurang kuat"); err != nil {
		t.Fatal(err)
	}
	if got := statusOf(t, k, "assets", a1.ID); got != StatusApproved {
		t.Errorf("a1 = %q, want [Approved] (sibling untouched)", got)
	}
	if got := statusOf(t, k, "briefs", b); got != StatusInReview {
		t.Errorf("brief = %q, want [In Review] (a2 in revision)", got)
	}
	// Rework a2 -> resubmit -> review -> approve. Brief -> [Approved].
	if _, err := k.m12.ReworkAsset(ctx, staff, a2.ID); err != nil {
		t.Fatal(err)
	}
	if got := statusOf(t, k, "briefs", b); got != StatusInReview {
		t.Errorf("brief after rework = %q, want [In Review] (forward-only)", got)
	}
	if _, err := k.m12.SubmitAsset(ctx, staff, a2.ID, "link2"); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m7.ReviewAsset(ctx, am, a2.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m7.ApproveAsset(ctx, am, a2.ID); err != nil {
		t.Fatal(err)
	}
	if got := statusOf(t, k, "briefs", b); got != StatusApproved {
		t.Errorf("brief = %q, want [Approved] (all assets approved)", got)
	}
	// a2 Revision Count = 1 (derived).
	got, err := k.m7.GetAsset(ctx, director("EMP-DIR"), a2.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.RevisionCount != 1 {
		t.Errorf("a2 revision count = %d, want 1", got.RevisionCount)
	}
}

// ---- Review permissions: only owning AM / Director ----

func TestReviewAsset_Permissions(t *testing.T) {
	k := setup(t)
	b, _ := newCreativeBrief(t, k, "1", 1)
	staff := creativeStaff("EMP-RIAN")
	registerStaff(t, k, "EMP-RIAN", CreativeDivision)
	a, _ := k.m7.CreateAsset(ctx, staff, b, AssetInput{SequenceNo: 1})
	if _, err := k.m12.StartAsset(ctx, staff, a.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m12.SubmitAsset(ctx, staff, a.ID, "link"); err != nil {
		t.Fatal(err)
	}
	// A non-owning AM, Creative staff, and Account lead cannot review Assets.
	for _, act := range []permission.Actor{accountStaff("EMP-OTHER"), staff, accountLead("EMP-ALEAD")} {
		if _, err := k.m7.ReviewAsset(ctx, act, a.ID); !errors.Is(err, ErrReviewForbidden) {
			t.Errorf("%+v review: want ErrReviewForbidden, got %v", act.Role, err)
		}
	}
	// Owning AM can.
	if _, err := k.m7.ReviewAsset(ctx, accountStaff(amID), a.ID); err != nil {
		t.Errorf("owning AM review: %v", err)
	}
}

// ---- §6 Rule 4: an Asset crossing 3 revisions fires EvRevisionCountFlag (per-Asset) ----

func TestAssetRevisionFlag(t *testing.T) {
	k := setup(t)
	k.m7.Catalog = notification.NewCatalog()
	registerLead(t, k, "EMP-CLEAD", CreativeDivision)
	b, _ := newCreativeBrief(t, k, "1", 1)
	staff := creativeStaff("EMP-RIAN")
	am := accountStaff(amID)
	registerStaff(t, k, "EMP-RIAN", CreativeDivision)
	a, _ := k.m7.CreateAsset(ctx, staff, b, AssetInput{SequenceNo: 1})
	if _, err := k.m12.StartAsset(ctx, staff, a.ID); err != nil {
		t.Fatal(err)
	}
	// Three revision rounds.
	for i := 0; i < 3; i++ {
		if _, err := k.m12.SubmitAsset(ctx, staff, a.ID, "link"); err != nil {
			t.Fatal(err)
		}
		if _, err := k.m7.ReviewAsset(ctx, am, a.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := k.m7.RequestAssetRevision(ctx, am, a.ID, "lagi"); err != nil {
			t.Fatal(err)
		}
		if i < 2 {
			if _, err := k.m12.ReworkAsset(ctx, staff, a.ID); err != nil {
				t.Fatal(err)
			}
		}
	}
	// EvRevisionCountFlag delivered to the Creative lead exactly once (3rd crossing).
	var n int
	if err := k.m7.DB.QueryRow(
		`SELECT COUNT(*) FROM notifications WHERE recipient_employee_id=? AND event_type=? AND entity_type='asset'`,
		"EMP-CLEAD", string(notification.EvRevisionCountFlag)).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("asset revision-flag notifications = %d, want 1", n)
	}
	got, _ := k.m7.GetAsset(ctx, director("EMP-DIR"), a.ID)
	if got.RevisionCount != 3 || !got.RevisionFlagged {
		t.Errorf("count/flag = %d/%v, want 3/true", got.RevisionCount, got.RevisionFlagged)
	}
}

// ---- Hours Logged (§5 Rule 2) ----

func TestLogHours(t *testing.T) {
	k := setup(t)
	b, _ := newCreativeBrief(t, k, "1", 1)
	staff := creativeStaff("EMP-RIAN")
	registerStaff(t, k, "EMP-RIAN", CreativeDivision)
	a, _ := k.m7.CreateAsset(ctx, staff, b, AssetInput{SequenceNo: 1})

	// Positive value required.
	if err := k.m7.LogHours(ctx, staff, a.ID, 0); !errors.Is(err, ErrInvalidHours) {
		t.Errorf("zero hours: want ErrInvalidHours, got %v", err)
	}
	// A different (non-PIC) Creative staff cannot log.
	if err := k.m7.LogHours(ctx, creativeStaff("EMP-OTHER"), a.ID, 3); !errors.Is(err, ErrHoursForbidden) {
		t.Errorf("non-PIC hours: want ErrHoursForbidden, got %v", err)
	}
	// The assigned PIC can.
	if err := k.m7.LogHours(ctx, staff, a.ID, 4.5); err != nil {
		t.Fatalf("PIC LogHours: %v", err)
	}
	got, _ := k.m7.GetAsset(ctx, director("EMP-DIR"), a.ID)
	if got.HoursLogged == nil || *got.HoursLogged != 4.5 {
		t.Errorf("hours_logged = %v, want 4.5", got.HoursLogged)
	}
}

// ---- read visibility (§9.1) ----

func TestGetAsset_Visibility(t *testing.T) {
	k := setup(t)
	b, _ := newCreativeBrief(t, k, "1", 1)
	a, _ := k.m7.CreateAsset(ctx, creativeLead("EMP-CL"), b, AssetInput{SequenceNo: 1})
	allow := []permission.Actor{
		accountStaff(amID), accountLead("EMP-ALEAD"), od("EMP-OD"), director("EMP-DIR"),
		creativeStaff("EMP-C"), creativeLead("EMP-CL"),
	}
	for _, act := range allow {
		if _, err := k.m7.GetAsset(ctx, act, a.ID); err != nil {
			t.Errorf("%+v should view: %v", act.Role, err)
		}
	}
	deny := []permission.Actor{accountStaff("EMP-OTHER"), creativeStaffOtherDiv()}
	for _, act := range deny {
		if _, err := k.m7.GetAsset(ctx, act, a.ID); !errors.Is(err, ErrAssetForbidden) {
			t.Errorf("%+v must be denied, got %v", act.Role, err)
		}
	}
}

// ---- recompute-from-log metrics for an Asset (Alpha Digital timeline) + revision speed ----

func TestAssetMetrics_RecomputeFromLog(t *testing.T) {
	k := setup(t)
	b, _ := newCreativeBrief(t, k, "1", 1)
	a, _ := k.m7.CreateAsset(ctx, creativeLead("EMP-CL"), b, AssetInput{SequenceNo: 1})
	// Isolate the recompute path: drive the row + SLAs out-of-band, seed the log.
	if _, err := k.m7.DB.Exec(
		`UPDATE assets SET status='[Approved]', sla_target_hours=48, revision_sla_target_hours=24 WHERE id=?`, a.ID); err != nil {
		t.Fatal(err)
	}
	seed := []struct {
		to string
		at time.Time
	}{
		{StatusInProgress, time.Date(2026, 6, 1, 9, 0, 0, 0, time.UTC)},
		{StatusSubmitted, time.Date(2026, 6, 2, 14, 0, 0, 0, time.UTC)},
		{StatusInReview, time.Date(2026, 6, 2, 14, 0, 0, 0, time.UTC)},
		{StatusRevisionReq, time.Date(2026, 6, 2, 16, 0, 0, 0, time.UTC)},
		{StatusInProgress, time.Date(2026, 6, 2, 17, 0, 0, 0, time.UTC)},
		{StatusSubmitted, time.Date(2026, 6, 3, 10, 0, 0, 0, time.UTC)},
		{StatusInReview, time.Date(2026, 6, 3, 10, 0, 0, 0, time.UTC)},
		{StatusApproved, time.Date(2026, 6, 3, 15, 0, 0, 0, time.UTC)},
	}
	prev := StatusToDo
	for _, e := range seed {
		if _, err := k.m7.DB.Exec(
			`INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, created_at, created_by)
			 VALUES ('asset', ?, 'EMP-RIAN', ?, ?, 'EMP-RIAN')`,
			a.ID, "transition:"+prev+"->"+e.to, e.at); err != nil {
			t.Fatal(err)
		}
		prev = e.to
	}
	m, err := k.m12.AssetMetrics(ctx, director("EMP-DIR"), a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if m.TurnaroundHours == nil || *m.TurnaroundHours != 54 {
		t.Errorf("turnaround = %v, want 54", m.TurnaroundHours)
	}
	if m.SpeedScorePct == nil || *m.SpeedScorePct != 112.5 {
		t.Errorf("speed = %v, want 112.5", m.SpeedScorePct)
	}
	// Revision Turnaround = 18h; revision SLA 24h -> revision_speed_score = 75%.
	if m.RevisionTurnaroundHours == nil || *m.RevisionTurnaroundHours != 18 {
		t.Errorf("revision turnaround = %v, want 18", m.RevisionTurnaroundHours)
	}
	if m.RevisionSpeedScorePct == nil || *m.RevisionSpeedScorePct != 75 {
		t.Errorf("revision_speed_score = %v, want 75", m.RevisionSpeedScorePct)
	}
}

// ---- immutability: Asset audit rows cannot be mutated (house rule 3) ----

func TestAssetHistoryImmutable(t *testing.T) {
	k := setup(t)
	b, _ := newCreativeBrief(t, k, "1", 1)
	a, _ := k.m7.CreateAsset(ctx, creativeLead("EMP-CL"), b, AssetInput{SequenceNo: 1})
	var id int64
	if err := k.m7.DB.QueryRow(
		`SELECT id FROM audit_log WHERE entity_id=? AND action='create'`, a.ID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m7.DB.Exec(`UPDATE audit_log SET action='x' WHERE id=?`, id); err == nil {
		t.Error("expected UPDATE on audit_log to be blocked")
	}
	if _, err := k.m7.DB.Exec(`DELETE FROM audit_log WHERE id=?`, id); err == nil {
		t.Error("expected DELETE on audit_log to be blocked")
	}
}

var _ = onlyErr
