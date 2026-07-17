package module8_ads

import (
	"context"
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module12_task"
	"github.com/meagrup/agencyapp/backend/internal/module6_account"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

const amID = "EMP-AM"

var ctx = context.Background()

// ---- actor helpers ----

func adsStaff(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: AdsDivision, Level: permission.LevelStaff}}
}
func adsLead(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: AdsDivision, Level: permission.LevelLead}}
}
func accountStaff(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: AccountDivision, Level: permission.LevelStaff}}
}
func accountLead(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: AccountDivision, Level: permission.LevelLead}}
}
func creativeStaff(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: CreativeDivision, Level: permission.LevelStaff}}
}
func director(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Director: true}}
}
func od(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{OD: true}}
}

// ---- fixtures ----

type kit struct {
	m8  *Service
	m6  *module6_account.Service
	m12 *module12_task.Service
}

func setup(t *testing.T) *kit {
	t.Helper()
	d := testutil.DB(t)
	testutil.Clean(t, d)
	eng := statemachine.New()
	m6 := &module6_account.Service{DB: d, Engine: eng}
	m8 := &Service{DB: d, Engine: eng}
	m12 := &module12_task.Service{DB: d, Engine: eng, Account: m6, SubmitGuard: m8}
	return &kit{m8: m8, m6: m6, m12: m12}
}

// newAdsBrief creates a released client (AM = EMP-AM) + Direct service, then an Ads
// Brief in [To Do] via module6_account.CreateBrief.
func newAdsBrief(t *testing.T, k *kit, suffix string) (briefID, svcID, clientID string) {
	t.Helper()
	d := k.m8.DB
	clientID, svcID = "CLI-"+suffix, "SVC-"+suffix
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
		 VALUES (?, ?, 'MSV-X', 1, 'TikTok Ads', '10000000.00', 'rule', '[Awaiting Onboarding]', 0, 'TEST')`,
		svcID, clientID); err != nil {
		t.Fatal(err)
	}
	b, err := k.m6.CreateBrief(ctx, accountStaff(amID), svcID, module6_account.BriefInput{
		Title: "TikTok Ads Campaign " + suffix, AssignedDivision: AdsDivision, DeliverableType: "Ad Campaign",
		QuantityTarget: 1, DueDate: "2026-08-30", Priority: "High",
	})
	if err != nil {
		t.Fatalf("CreateBrief: %v", err)
	}
	return b.ID, svcID, clientID
}

// insertApprovedAsset inserts a Creative Brief under svcID plus an [Approved] Asset
// on it (same Client as the Ads campaign) — the linkable creative, bypassing the
// full M7 flow since these tests exercise M8, not Creative.
func insertApprovedAsset(t *testing.T, k *kit, svcID, assetID string) {
	t.Helper()
	d := k.m8.DB
	briefID := "BRFCRE-" + assetID
	if _, err := d.ExecContext(ctx,
		`INSERT INTO briefs (id, service_id, assigned_division, deliverable_type, quantity_target, title, status, created_by)
		 VALUES (?, ?, 'Creative', 'Product Video', 1, 'Creative brief', '[Approved]', 'TEST')`,
		briefID, svcID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ExecContext(ctx,
		`INSERT INTO assets (id, brief_id, asset_type, sequence_no, status, created_by)
		 VALUES (?, ?, 'Product Video', 1, '[Approved]', 'TEST')`,
		assetID, briefID); err != nil {
		t.Fatal(err)
	}
}

// startAdsBrief drives an Ads Brief [To Do] -> [In Progress] via M12 (an Advertiser
// claims and starts it), so an Ad Campaign can be created under it (§4 Rule 1).
func startAdsBrief(t *testing.T, k *kit, briefID string, adv permission.Actor) {
	t.Helper()
	if _, err := k.m12.StartTask(ctx, adv, briefID); err != nil {
		t.Fatalf("StartTask: %v", err)
	}
}

func validInput() CampaignInput {
	return CampaignInput{
		Platform: "TikTok Shop Ads", Objective: "Conversion", Budget: "8000000",
		StartDate: "2026-06-01", EndDate: "2026-06-30", TargetKPI: "ROAS >= 4x",
	}
}

func campaignStatus(t *testing.T, k *kit, id string) string {
	t.Helper()
	var st string
	if err := k.m8.DB.QueryRow(`SELECT status FROM ad_campaigns WHERE id = ?`, id).Scan(&st); err != nil {
		t.Fatal(err)
	}
	return st
}

func assetAttributed(t *testing.T, k *kit, id string) string {
	t.Helper()
	var v string
	if err := k.m8.DB.QueryRow(`SELECT COALESCE(attributed_gmv,'0.00') FROM assets WHERE id = ?`, id).Scan(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

// ---- CreateCampaign: state, validation, permissions ----

func TestCreateCampaign_Validation(t *testing.T) {
	k := setup(t)
	b, _, _ := newAdsBrief(t, k, "1")
	adv := adsStaff("EMP-KENNY")

	// Brief still [To Do] -> not creatable.
	if _, err := k.m8.CreateCampaign(ctx, adv, b, validInput()); !errors.Is(err, ErrBriefNotInProgress) {
		t.Errorf("todo brief: want ErrBriefNotInProgress, got %v", err)
	}
	startAdsBrief(t, k, b, adv)

	// Missing mandatory field.
	bad := validInput()
	bad.Platform = ""
	if _, err := k.m8.CreateCampaign(ctx, adv, b, bad); !errors.Is(err, ErrIncomplete) {
		t.Errorf("missing platform: want ErrIncomplete, got %v", err)
	}
	// Invalid platform.
	bad = validInput()
	bad.Platform = "Facebook Ads"
	if _, err := k.m8.CreateCampaign(ctx, adv, b, bad); !errors.Is(err, ErrInvalidPlatform) {
		t.Errorf("bad platform: want ErrInvalidPlatform, got %v", err)
	}
	// Bad date order.
	bad = validInput()
	bad.EndDate = "2026-05-01"
	if _, err := k.m8.CreateCampaign(ctx, adv, b, bad); !errors.Is(err, ErrInvalidCampaignDates) {
		t.Errorf("bad dates: want ErrInvalidCampaignDates, got %v", err)
	}
	// Valid -> born [Paused].
	c, err := k.m8.CreateCampaign(ctx, adv, b, validInput())
	if err != nil {
		t.Fatalf("valid create: %v", err)
	}
	if c.Status != StatusPaused {
		t.Errorf("status = %q, want [Paused]", c.Status)
	}
	if c.BudgetDisplay != "Rp. 8.000.000,00" {
		t.Errorf("budget display = %q, want Rp. 8.000.000,00", c.BudgetDisplay)
	}
}

func TestCreateCampaign_Permissions(t *testing.T) {
	k := setup(t)
	b, _, _ := newAdsBrief(t, k, "1")
	adv := adsStaff("EMP-KENNY")
	startAdsBrief(t, k, b, adv)

	// Non-Ads brief is rejected first (create a Creative brief on the same service).
	insertApprovedAsset(t, k, "SVC-1", "AST-Z") // creates a Creative brief BRFCRE-AST-Z
	if _, err := k.m8.CreateCampaign(ctx, adv, "BRFCRE-AST-Z", validInput()); !errors.Is(err, ErrNotAdsBrief) {
		t.Errorf("creative brief: want ErrNotAdsBrief, got %v", err)
	}

	// AM, OD, other-division staff cannot create.
	for _, a := range []permission.Actor{accountStaff(amID), od("EMP-OD"), creativeStaff("EMP-C")} {
		if _, err := k.m8.CreateCampaign(ctx, a, b, validInput()); !errors.Is(err, ErrCampaignManageForbidden) {
			t.Errorf("%+v create: want ErrCampaignManageForbidden, got %v", a.Role, err)
		}
	}
	// Ads lead + Director can.
	if _, err := k.m8.CreateCampaign(ctx, adsLead("EMP-ADLEAD"), b, validInput()); err != nil {
		t.Errorf("ads lead create: %v", err)
	}
	if _, err := k.m8.CreateCampaign(ctx, director("EMP-DIR"), b, validInput()); err != nil {
		t.Errorf("director create: %v", err)
	}
}

// ---- §4 Rule 3: submit gate on the Ads Brief ----

func TestSubmitGate(t *testing.T) {
	k := setup(t)
	b, svc, _ := newAdsBrief(t, k, "1")
	adv := adsStaff("EMP-KENNY")
	startAdsBrief(t, k, b, adv)

	// No campaign at all -> submit blocked with the VERBATIM PRD string.
	if _, err := k.m12.SubmitTask(ctx, adv, b); !errors.Is(err, ErrCampaignIncompleteForSubmit) {
		t.Errorf("no campaign: want ErrCampaignIncompleteForSubmit, got %v", err)
	}
	// Campaign but no linked asset -> still blocked.
	c, err := k.m8.CreateCampaign(ctx, adv, b, validInput())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := k.m12.SubmitTask(ctx, adv, b); !errors.Is(err, ErrCampaignIncompleteForSubmit) {
		t.Errorf("no linked asset: want ErrCampaignIncompleteForSubmit, got %v", err)
	}
	// Link an approved asset -> submit passes.
	insertApprovedAsset(t, k, svc, "AST-1")
	if err := k.m8.LinkAsset(ctx, adv, c.ID, "AST-1"); err != nil {
		t.Fatalf("LinkAsset: %v", err)
	}
	if _, err := k.m12.SubmitTask(ctx, adv, b); err != nil {
		t.Fatalf("SubmitTask after link: %v", err)
	}
}

// ---- linkage validation ----

func TestLinkAsset_Validation(t *testing.T) {
	k := setup(t)
	b, svc, _ := newAdsBrief(t, k, "1")
	adv := adsStaff("EMP-KENNY")
	startAdsBrief(t, k, b, adv)
	c, _ := k.m8.CreateCampaign(ctx, adv, b, validInput())

	// Missing asset.
	if err := k.m8.LinkAsset(ctx, adv, c.ID, "AST-NONE"); !errors.Is(err, ErrAssetNotFound) {
		t.Errorf("missing asset: want ErrAssetNotFound, got %v", err)
	}
	// Not-approved asset (insert one under a different status).
	d := k.m8.DB
	if _, err := d.ExecContext(ctx,
		`INSERT INTO briefs (id, service_id, assigned_division, deliverable_type, quantity_target, title, status, created_by)
		 VALUES ('BRFCRE-NA', ?, 'Creative', 'Product Video', 1, 'x', '[In Progress]', 'TEST')`, svc); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ExecContext(ctx,
		`INSERT INTO assets (id, brief_id, asset_type, sequence_no, status, created_by)
		 VALUES ('AST-NA', 'BRFCRE-NA', 'Product Video', 1, '[In Progress]', 'TEST')`); err != nil {
		t.Fatal(err)
	}
	if err := k.m8.LinkAsset(ctx, adv, c.ID, "AST-NA"); !errors.Is(err, ErrAssetNotApproved) {
		t.Errorf("unapproved: want ErrAssetNotApproved, got %v", err)
	}
	// Asset from a different client.
	b2, svc2, _ := newAdsBrief(t, k, "2")
	_ = b2
	insertApprovedAsset(t, k, svc2, "AST-OTHER")
	if err := k.m8.LinkAsset(ctx, adv, c.ID, "AST-OTHER"); !errors.Is(err, ErrAssetWrongClient) {
		t.Errorf("wrong client: want ErrAssetWrongClient, got %v", err)
	}
	// Valid + duplicate.
	insertApprovedAsset(t, k, svc, "AST-1")
	if err := k.m8.LinkAsset(ctx, adv, c.ID, "AST-1"); err != nil {
		t.Fatalf("valid link: %v", err)
	}
	if err := k.m8.LinkAsset(ctx, adv, c.ID, "AST-1"); !errors.Is(err, ErrAssetAlreadyLinked) {
		t.Errorf("dup link: want ErrAssetAlreadyLinked, got %v", err)
	}
}

// ---- full lifecycle: create -> link -> approve brief -> launch -> pause -> resume -> end ----

func TestLifecycle(t *testing.T) {
	k := setup(t)
	b, svc, _ := newAdsBrief(t, k, "1")
	adv := adsStaff("EMP-KENNY")
	am := accountStaff(amID)
	startAdsBrief(t, k, b, adv)
	c, _ := k.m8.CreateCampaign(ctx, adv, b, validInput())
	insertApprovedAsset(t, k, svc, "AST-1")
	if err := k.m8.LinkAsset(ctx, adv, c.ID, "AST-1"); err != nil {
		t.Fatal(err)
	}

	// Launch before the setup Brief is approved -> blocked.
	if _, err := k.m8.LaunchCampaign(ctx, adv, c.ID); !errors.Is(err, ErrLaunchBriefNotApproved) {
		t.Errorf("launch pre-approval: want ErrLaunchBriefNotApproved, got %v", err)
	}
	// Drive the Brief to [Approved] via the normal path.
	if _, err := k.m12.SubmitTask(ctx, adv, b); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m6.ReviewBrief(ctx, am, b); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m6.ApproveBrief(ctx, am, b); err != nil {
		t.Fatal(err)
	}
	// Launch -> [Active].
	if _, err := k.m8.LaunchCampaign(ctx, adv, c.ID); err != nil {
		t.Fatalf("Launch: %v", err)
	}
	if campaignStatus(t, k, c.ID) != StatusActive {
		t.Errorf("status = %q, want [Active]", campaignStatus(t, k, c.ID))
	}
	// Pause -> Resume -> End.
	if _, err := k.m8.PauseCampaign(ctx, adv, c.ID); err != nil {
		t.Fatal(err)
	}
	if campaignStatus(t, k, c.ID) != StatusPaused {
		t.Errorf("want [Paused] after pause")
	}
	if _, err := k.m8.ResumeCampaign(ctx, adv, c.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m8.EndCampaign(ctx, adv, c.ID); err != nil {
		t.Fatal(err)
	}
	if campaignStatus(t, k, c.ID) != StatusEnded {
		t.Errorf("want [Ended]")
	}
}

func TestLaunch_RequiresLinkedApprovedAsset(t *testing.T) {
	k := setup(t)
	b, _, _ := newAdsBrief(t, k, "1")
	adv := adsStaff("EMP-KENNY")
	am := accountStaff(amID)
	startAdsBrief(t, k, b, adv)
	c, _ := k.m8.CreateCampaign(ctx, adv, b, validInput())
	// Approve the brief WITHOUT any linked asset — need to bypass the submit gate,
	// so drive the brief statuses directly is not possible; instead just test the
	// launch guard: a campaign with no linked asset cannot launch even if we force
	// the brief to [Approved] out-of-band.
	if _, err := k.m8.DB.ExecContext(ctx, `UPDATE briefs SET status='[Approved]' WHERE id=?`, b); err != nil {
		t.Fatal(err)
	}
	_ = am
	if _, err := k.m8.LaunchCampaign(ctx, adv, c.ID); !errors.Is(err, ErrLaunchAssetsNotApproved) {
		t.Errorf("no linked asset: want ErrLaunchAssetsNotApproved, got %v", err)
	}
}

// ---- metrics: worked example (PRD §5) + IDR + div-by-zero ----

func TestMetrics_WorkedExample(t *testing.T) {
	k := setup(t)
	b, svc, _ := newAdsBrief(t, k, "1")
	adv := adsStaff("EMP-KENNY")
	startAdsBrief(t, k, b, adv)
	c, _ := k.m8.CreateCampaign(ctx, adv, b, validInput())
	insertApprovedAsset(t, k, svc, "AST-1")
	if err := k.m8.LinkAsset(ctx, adv, c.ID, "AST-1"); err != nil {
		t.Fatal(err)
	}

	// Fresh campaign: no metrics -> ROAS renders "—" (house rule 7).
	got, err := k.m8.GetCampaign(ctx, adv, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ROASDisplay != "—" || got.ROAS != nil {
		t.Errorf("empty ROAS = %q/%v, want —/nil", got.ROASDisplay, got.ROAS)
	}

	// Week 1: spend 2jt, GMV 9.5jt. Week 2: spend 2jt, GMV 6jt.
	if _, err := k.m8.LogMetricEntry(ctx, adv, c.ID, MetricInput{
		PeriodStart: "2026-06-01", PeriodEnd: "2026-06-07", Spend: "2000000", GMV: "9500000", EntryMethod: "Manual"}); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m8.LogMetricEntry(ctx, adv, c.ID, MetricInput{
		PeriodStart: "2026-06-08", PeriodEnd: "2026-06-14", Spend: "2000000", GMV: "6000000", EntryMethod: "File Export"}); err != nil {
		t.Fatal(err)
	}
	got, err = k.m8.GetCampaign(ctx, adv, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.TotalSpendDisplay != "Rp. 4.000.000,00" {
		t.Errorf("total spend = %q, want Rp. 4.000.000,00", got.TotalSpendDisplay)
	}
	if got.TotalGMVDisplay != "Rp. 15.500.000,00" {
		t.Errorf("total gmv = %q, want Rp. 15.500.000,00", got.TotalGMVDisplay)
	}
	if got.ROAS == nil || *got.ROAS != 3.875 {
		t.Errorf("roas = %v, want 3.875", got.ROAS)
	}
	if got.ROASDisplay != "3.875x" {
		t.Errorf("roas display = %q, want 3.875x", got.ROASDisplay)
	}
	// §8/§M8-OA-5: target ROAS 4x; both periods (4.75, 3.0) — wait wk1 4.75 >= 4,
	// wk2 3.0 < 4 -> trailing streak = 1, not escalated yet.
	if got.EscalationFlagged {
		t.Errorf("escalation flagged too early: streak=%d", got.UnderperformingStreak)
	}
	// A third under-target period -> 2 consecutive -> escalation flag.
	if _, err := k.m8.LogMetricEntry(ctx, adv, c.ID, MetricInput{
		PeriodStart: "2026-06-15", PeriodEnd: "2026-06-21", Spend: "2000000", GMV: "5000000", EntryMethod: "Manual"}); err != nil {
		t.Fatal(err)
	}
	got, _ = k.m8.GetCampaign(ctx, adv, c.ID)
	if !got.EscalationFlagged || got.UnderperformingStreak != 2 {
		t.Errorf("escalation = %v streak=%d, want true/2", got.EscalationFlagged, got.UnderperformingStreak)
	}
}

// ---- attribution: equal split + swap (PRD §7) ----

func TestAttribution_EqualSplitAndSwap(t *testing.T) {
	k := setup(t)
	b, svc, _ := newAdsBrief(t, k, "1")
	adv := adsStaff("EMP-KENNY")
	startAdsBrief(t, k, b, adv)
	c, _ := k.m8.CreateCampaign(ctx, adv, b, validInput())
	insertApprovedAsset(t, k, svc, "AST-A")
	insertApprovedAsset(t, k, svc, "AST-B")

	// Two Assets linked (A/B test) -> GMV 10jt splits 5jt / 5jt.
	if err := k.m8.LinkAsset(ctx, adv, c.ID, "AST-A"); err != nil {
		t.Fatal(err)
	}
	if err := k.m8.LinkAsset(ctx, adv, c.ID, "AST-B"); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m8.LogMetricEntry(ctx, adv, c.ID, MetricInput{
		PeriodStart: "2026-06-01", PeriodEnd: "2026-06-07", Spend: "2000000", GMV: "10000000", EntryMethod: "Manual"}); err != nil {
		t.Fatal(err)
	}
	if a := assetAttributed(t, k, "AST-A"); a != "5000000.00" {
		t.Errorf("AST-A attributed = %q, want 5000000.00", a)
	}
	if b := assetAttributed(t, k, "AST-B"); b != "5000000.00" {
		t.Errorf("AST-B attributed = %q, want 5000000.00", b)
	}

	// Swap B out for a fresh single asset, then more GMV attributes only to the new
	// currently-linked set. First unlink A so only B is linked, then swap B -> C.
	if err := k.m8.UnlinkAsset(ctx, adv, c.ID, "AST-A"); err != nil {
		t.Fatal(err)
	}
	insertApprovedAsset(t, k, svc, "AST-C")
	if _, err := k.m8.LogOptimization(ctx, adv, c.ID, OptimizationInput{
		ChangeType: "Creative Swap", OldAssetID: "AST-B", NewAssetID: "AST-C", Reason: "ROAS turun, ganti hook"}); err != nil {
		t.Fatalf("swap: %v", err)
	}
	// Now only AST-C is linked. Log GMV 6jt -> all to AST-C; A/B keep their 5jt.
	if _, err := k.m8.LogMetricEntry(ctx, adv, c.ID, MetricInput{
		PeriodStart: "2026-06-15", PeriodEnd: "2026-06-21", Spend: "2000000", GMV: "6000000", EntryMethod: "Manual"}); err != nil {
		t.Fatal(err)
	}
	if a := assetAttributed(t, k, "AST-A"); a != "5000000.00" {
		t.Errorf("AST-A after swap = %q, want unchanged 5000000.00", a)
	}
	if b := assetAttributed(t, k, "AST-B"); b != "5000000.00" {
		t.Errorf("AST-B after swap = %q, want unchanged 5000000.00", b)
	}
	if cc := assetAttributed(t, k, "AST-C"); cc != "6000000.00" {
		t.Errorf("AST-C after swap = %q, want 6000000.00", cc)
	}
}

// ---- optimization: >50% budget gate (M8-OA-3) + change-type validation ----

func TestOptimization_BudgetGate(t *testing.T) {
	k := setup(t)
	b, _, _ := newAdsBrief(t, k, "1")
	adv := adsStaff("EMP-KENNY")
	startAdsBrief(t, k, b, adv)
	c, _ := k.m8.CreateCampaign(ctx, adv, b, validInput())

	// Invalid change type.
	if _, err := k.m8.LogOptimization(ctx, adv, c.ID, OptimizationInput{
		ChangeType: "Vibes", BeforeValue: "a", AfterValue: "b", Reason: "r"}); !errors.Is(err, ErrInvalidChangeType) {
		t.Errorf("bad type: want ErrInvalidChangeType, got %v", err)
	}
	// >50% budget by a plain Advertiser -> blocked.
	if _, err := k.m8.LogOptimization(ctx, adv, c.ID, OptimizationInput{
		ChangeType: "Budget", BeforeValue: "1000000", AfterValue: "2000000", Reason: "scale"}); !errors.Is(err, ErrBudgetApprovalRequired) {
		t.Errorf(">50%% advertiser: want ErrBudgetApprovalRequired, got %v", err)
	}
	// >50% budget by the Ads lead (SPV Ads) -> allowed.
	if _, err := k.m8.LogOptimization(ctx, adsLead("EMP-ADLEAD"), c.ID, OptimizationInput{
		ChangeType: "Budget", BeforeValue: "1000000", AfterValue: "2000000", Reason: "scale"}); err != nil {
		t.Errorf(">50%% lead: %v", err)
	}
	// >50% budget by the owning AM -> allowed (sign-off path).
	if _, err := k.m8.LogOptimization(ctx, accountStaff(amID), c.ID, OptimizationInput{
		ChangeType: "Budget", BeforeValue: "1000000", AfterValue: "2000000", Reason: "scale"}); err != nil {
		t.Errorf(">50%% AM: %v", err)
	}
	// <=50% budget by the Advertiser -> allowed.
	if _, err := k.m8.LogOptimization(ctx, adv, c.ID, OptimizationInput{
		ChangeType: "Budget", BeforeValue: "1000000", AfterValue: "1400000", Reason: "tweak"}); err != nil {
		t.Errorf("<50%% advertiser: %v", err)
	}
	// Optimization count reflected on the campaign (§8 Rule 4).
	got, _ := k.m8.GetCampaign(ctx, adv, c.ID)
	if got.OptimizationCount != 3 {
		t.Errorf("optimization count = %d, want 3", got.OptimizationCount)
	}
}

// ---- read visibility (§9.1) ----

func TestGetCampaign_Visibility(t *testing.T) {
	k := setup(t)
	b, _, _ := newAdsBrief(t, k, "1")
	adv := adsStaff("EMP-KENNY")
	startAdsBrief(t, k, b, adv)
	c, _ := k.m8.CreateCampaign(ctx, adv, b, validInput())

	allow := []permission.Actor{
		accountStaff(amID), accountLead("EMP-ALEAD"), od("EMP-OD"), director("EMP-DIR"),
		adsStaff("EMP-KENNY"), adsLead("EMP-ADLEAD"),
	}
	for _, act := range allow {
		if _, err := k.m8.GetCampaign(ctx, act, c.ID); err != nil {
			t.Errorf("%+v should view: %v", act.Role, err)
		}
	}
	deny := []permission.Actor{accountStaff("EMP-OTHER"), creativeStaff("EMP-C")}
	for _, act := range deny {
		if _, err := k.m8.GetCampaign(ctx, act, c.ID); !errors.Is(err, ErrCampaignViewForbidden) {
			t.Errorf("%+v must be denied, got %v", act.Role, err)
		}
	}
}

// ---- immutability: ad_campaign audit rows cannot be mutated (house rule 3) ----

func TestCampaignHistoryImmutable(t *testing.T) {
	k := setup(t)
	b, _, _ := newAdsBrief(t, k, "1")
	adv := adsStaff("EMP-KENNY")
	startAdsBrief(t, k, b, adv)
	c, _ := k.m8.CreateCampaign(ctx, adv, b, validInput())
	var id int64
	if err := k.m8.DB.QueryRow(
		`SELECT id FROM audit_log WHERE entity_id=? AND action='create'`, c.ID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m8.DB.Exec(`UPDATE audit_log SET action='x' WHERE id=?`, id); err == nil {
		t.Error("expected UPDATE on audit_log to be blocked")
	}
	if _, err := k.m8.DB.Exec(`DELETE FROM audit_log WHERE id=?`, id); err == nil {
		t.Error("expected DELETE on audit_log to be blocked")
	}
}
