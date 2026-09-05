package module7_creative

import (
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/module12_task"
)

// ---- Asset [Blocked] flow via the generalized M12 engine (M7 §4 Rule 2 / M12
// §5.3a): a staff/AM SUBMITS a block request but cannot self-set [Blocked]; only
// the Creative lead/Director actions it, and an Asset entering/leaving [Blocked]
// recomputes the parent Brief's roll-up (M7 §2). ----

func TestAssetBlockFlow(t *testing.T) {
	k := setup(t)
	k.m12.Catalog = notification.NewCatalog()
	registerLead(t, k, "EMP-CLEAD", CreativeDivision)
	b, svc := newCreativeBrief(t, k, "1", 1)
	staff := creativeStaff("EMP-RIAN")
	lead := creativeLead("EMP-CLEAD")
	registerStaff(t, k, "EMP-RIAN", CreativeDivision)

	a, err := k.m7.CreateAsset(ctx, staff, b, AssetInput{SequenceNo: 1})
	if err != nil {
		t.Fatal(err)
	}
	// Start -> [In Progress]; roll-up advances Brief + Service.
	if _, err := k.m12.StartAsset(ctx, staff, a.ID); err != nil {
		t.Fatalf("StartAsset: %v", err)
	}
	if got := statusOf(t, k, "services", svc); got != "[In Execution]" {
		t.Errorf("service = %q, want [In Execution]", got)
	}

	// Staff cannot self-approve a block (only lead/Director action it).
	if err := k.m12.ApproveAssetBlockRequest(ctx, staff, a.ID, "X"); !errors.Is(err, module12_task.ErrBlockDecideForbidden) {
		t.Errorf("staff approve: want ErrBlockDecideForbidden, got %v", err)
	}
	// Reason is mandatory.
	if _, err := k.m12.SubmitAssetBlockRequest(ctx, staff, a.ID, "  "); !errors.Is(err, module12_task.ErrBlockReasonRequired) {
		t.Errorf("empty reason: want ErrBlockReasonRequired, got %v", err)
	}
	req, err := k.m12.SubmitAssetBlockRequest(ctx, staff, a.ID, "menunggu footage klien")
	if err != nil {
		t.Fatalf("SubmitAssetBlockRequest: %v", err)
	}
	// A pending request alone does not change the Asset status (clock not paused).
	if got := statusOf(t, k, "assets", a.ID); got != StatusInProgress {
		t.Errorf("asset after request = %q, want still [In Progress]", got)
	}
	assertAssetNotif(t, k, "EMP-CLEAD", notification.EvBlockRequestSubmitted, 1)

	// Lead approves -> Asset [Blocked]; requester notified; Brief stays [In Progress]
	// (a blocked Asset is still "working", roll-up does not regress).
	if err := k.m12.ApproveAssetBlockRequest(ctx, lead, a.ID, req.ID); err != nil {
		t.Fatalf("ApproveAssetBlockRequest: %v", err)
	}
	if got := statusOf(t, k, "assets", a.ID); got != StatusBlocked {
		t.Errorf("asset = %q, want [Blocked]", got)
	}
	if got := statusOf(t, k, "briefs", b); got != StatusInProgress {
		t.Errorf("brief = %q, want [In Progress] (blocked asset still working)", got)
	}
	assertAssetNotif(t, k, "EMP-RIAN", notification.EvBlockRequestDecided, 1)

	// Re-approving a resolved request fails.
	if err := k.m12.ApproveAssetBlockRequest(ctx, lead, a.ID, req.ID); !errors.Is(err, module12_task.ErrBlockRequestClosed) {
		t.Errorf("re-approve: want ErrBlockRequestClosed, got %v", err)
	}

	// Lead resumes -> [In Progress]; roll-up unchanged.
	if _, err := k.m12.ResumeAsset(ctx, lead, a.ID); err != nil {
		t.Fatalf("ResumeAsset: %v", err)
	}
	if got := statusOf(t, k, "assets", a.ID); got != StatusInProgress {
		t.Errorf("asset = %q, want [In Progress] after resume", got)
	}

	// Staff cannot resume (SPV/Lead-only edge). Drive back to [Blocked] first.
	req2, err := k.m12.SubmitAssetBlockRequest(ctx, staff, a.ID, "lagi")
	if err != nil {
		t.Fatal(err)
	}
	if err := k.m12.ApproveAssetBlockRequest(ctx, lead, a.ID, req2.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m12.ResumeAsset(ctx, staff, a.ID); !errors.Is(err, module12_task.ErrBlockDecideForbidden) {
		t.Errorf("staff resume: want ErrBlockDecideForbidden, got %v", err)
	}
}

// TestRejectAssetBlockRequest: a rejected request never touches the Asset status.
func TestRejectAssetBlockRequest(t *testing.T) {
	k := setup(t)
	b, _ := newCreativeBrief(t, k, "1", 1)
	staff := creativeStaff("EMP-RIAN")
	lead := creativeLead("EMP-CL")
	registerStaff(t, k, "EMP-RIAN", CreativeDivision)
	a, _ := k.m7.CreateAsset(ctx, staff, b, AssetInput{SequenceNo: 1})
	if _, err := k.m12.StartAsset(ctx, staff, a.ID); err != nil {
		t.Fatal(err)
	}
	req, err := k.m12.SubmitAssetBlockRequest(ctx, staff, a.ID, "coba")
	if err != nil {
		t.Fatal(err)
	}
	if err := k.m12.RejectAssetBlockRequest(ctx, lead, a.ID, req.ID); err != nil {
		t.Fatalf("RejectAssetBlockRequest: %v", err)
	}
	if got := statusOf(t, k, "assets", a.ID); got != StatusInProgress {
		t.Errorf("asset = %q, want [In Progress] (reject does not block)", got)
	}
}

// ---- AssignAssetPIC: Team Leader reassign within the sub-team (M7 §3 Rule 3 /
// §9.3) via the generalized M12 engine. Same gate as briefs: division Lead/SPV or
// Director; the PIC must be an active Creative staff member. ----

func TestAssignAssetPIC(t *testing.T) {
	k := setup(t)
	b, _ := newCreativeBrief(t, k, "1", 1)
	lead := creativeLead("EMP-CL")
	// Lead creates the Asset unassigned (auto-assign / Team-Leader-assign path).
	a, err := k.m7.CreateAsset(ctx, lead, b, AssetInput{SequenceNo: 1})
	if err != nil {
		t.Fatal(err)
	}
	if a.AssignedPIC != "" {
		t.Fatalf("lead-created asset PIC = %q, want unassigned", a.AssignedPIC)
	}
	registerStaff(t, k, "EMP-RIAN", CreativeDivision)
	registerStaff(t, k, "EMP-ADS", "Ads")

	// Non-lead staff cannot assign.
	if err := k.m12.AssignAssetPIC(ctx, creativeStaff("EMP-X"), a.ID, "EMP-RIAN"); !errors.Is(err, module12_task.ErrAssignForbidden) {
		t.Errorf("staff assign: want ErrAssignForbidden, got %v", err)
	}
	// Cross-division PIC is rejected.
	if err := k.m12.AssignAssetPIC(ctx, lead, a.ID, "EMP-ADS"); !errors.Is(err, module12_task.ErrInvalidPIC) {
		t.Errorf("cross-division PIC: want ErrInvalidPIC, got %v", err)
	}
	// Lead assigns a valid Creative staff.
	if err := k.m12.AssignAssetPIC(ctx, lead, a.ID, "EMP-RIAN"); err != nil {
		t.Fatalf("AssignAssetPIC: %v", err)
	}
	got, _ := k.m7.GetAsset(ctx, director("EMP-DIR"), a.ID)
	if got.AssignedPIC != "EMP-RIAN" {
		t.Errorf("assigned_pic = %q, want EMP-RIAN", got.AssignedPIC)
	}
}

// ---- SetAssetSLA / SetAssetRevisionSLA: the two SEPARATE Task/revision SLA
// targets (M7-OA-3) written through the real M12 methods, surfaced by AssetMetrics
// (recompute-from-log) as SLA + Revision SLA. Lead/SPV/Director write gate. ----

func TestSetAssetSLAs(t *testing.T) {
	k := setup(t)
	b, _ := newCreativeBrief(t, k, "1", 1)
	lead := creativeLead("EMP-CL")
	a, _ := k.m7.CreateAsset(ctx, lead, b, AssetInput{SequenceNo: 1})

	// Non-positive SLA rejected.
	if err := k.m12.SetAssetSLA(ctx, lead, a.ID, 0); !errors.Is(err, module12_task.ErrInvalidSLA) {
		t.Errorf("zero SLA: want ErrInvalidSLA, got %v", err)
	}
	// Non-lead cannot set the SLA.
	if err := k.m12.SetAssetSLA(ctx, creativeStaff("EMP-RIAN"), a.ID, 48); !errors.Is(err, module12_task.ErrAssignForbidden) {
		t.Errorf("staff SetAssetSLA: want ErrAssignForbidden, got %v", err)
	}
	if err := k.m12.SetAssetSLA(ctx, lead, a.ID, 48); err != nil {
		t.Fatalf("SetAssetSLA: %v", err)
	}
	if err := k.m12.SetAssetRevisionSLA(ctx, lead, a.ID, 24); err != nil {
		t.Fatalf("SetAssetRevisionSLA: %v", err)
	}
	m, err := k.m12.AssetMetrics(ctx, director("EMP-DIR"), a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if m.SLATargetHours == nil || *m.SLATargetHours != 48 {
		t.Errorf("sla = %v, want 48", m.SLATargetHours)
	}
	if m.RevisionSLATargetHours == nil || *m.RevisionSLATargetHours != 24 {
		t.Errorf("revision sla = %v, want 24", m.RevisionSLATargetHours)
	}
}

// assertAssetNotif asserts the count of a given event delivered to a recipient for
// an Asset entity (mirrors the M12 test's assertNotif, scoped to entity_type=asset).
func assertAssetNotif(t *testing.T, k *kit, recipient string, ev notification.EventType, want int) {
	t.Helper()
	var n int
	if err := k.m7.DB.QueryRow(
		`SELECT COUNT(*) FROM notifications WHERE recipient_employee_id=? AND event_type=? AND entity_type='asset'`,
		recipient, string(ev)).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != want {
		t.Errorf("notif %s to %s = %d, want %d", ev, recipient, n, want)
	}
}
