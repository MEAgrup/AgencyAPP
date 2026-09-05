package module12_task

import (
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
)

func ptr(f float64) *float64 { return &f }

func approx(got *float64, want float64) bool {
	if got == nil {
		return false
	}
	d := *got - want
	return d < 1e-6 && d > -1e-6
}

// TestComputeMetrics_AlphaDigital is the PRD §4 worked example, byte-for-byte:
// AST-202606-0045, SLA 48h, one revision → Turnaround 54h, Revision Turnaround
// 18h, Speed Score 112.5%, Revision Count 1.
func TestComputeMetrics_AlphaDigital(t *testing.T) {
	d1 := time.Date(2026, 6, 1, 9, 0, 0, 0, time.UTC)  // Day 1 09:00
	d2 := time.Date(2026, 6, 2, 14, 0, 0, 0, time.UTC) // Day 2 14:00
	evs := []transition{
		{StatusInProgress, d1},
		{StatusSubmitted, d2},
		{StatusInReview, d2},
		{StatusRevisionReq, time.Date(2026, 6, 2, 16, 0, 0, 0, time.UTC)}, // Day 2 16:00
		{StatusInProgress, time.Date(2026, 6, 2, 17, 0, 0, 0, time.UTC)},
		{StatusSubmitted, time.Date(2026, 6, 3, 10, 0, 0, 0, time.UTC)}, // Day 3 10:00
		{StatusInReview, time.Date(2026, 6, 3, 10, 0, 0, 0, time.UTC)},
		{StatusApproved, time.Date(2026, 6, 3, 15, 0, 0, 0, time.UTC)}, // Day 3 15:00
	}
	m := computeMetrics(evs, ptr(48))

	if !approx(m.TurnaroundHours, 54) {
		t.Errorf("turnaround = %v, want 54", m.TurnaroundHours)
	}
	if !approx(m.RevisionTurnaroundHours, 18) {
		t.Errorf("revision turnaround = %v, want 18", m.RevisionTurnaroundHours)
	}
	if !approx(m.SpeedScorePct, 112.5) || m.SpeedScoreDisplay != "112.50%" {
		t.Errorf("speed = %v / %q, want 112.5 / 112.50%%", m.SpeedScorePct, m.SpeedScoreDisplay)
	}
	if m.RevisionCount != 1 || m.RevisionFlagged {
		t.Errorf("revision count/flag = %d/%v, want 1/false", m.RevisionCount, m.RevisionFlagged)
	}
}

// TestComputeMetrics_BlockedExcluded: Rule 7 / §5.4 — a [Blocked] interval is
// subtracted from Turnaround (multiple blocks summed).
func TestComputeMetrics_BlockedExcluded(t *testing.T) {
	t0 := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	at := func(h int) time.Time { return t0.Add(time.Duration(h) * time.Hour) }
	evs := []transition{
		{StatusInProgress, at(0)},
		{StatusBlocked, at(2)},
		{StatusInProgress, at(5)}, // blocked 3h
		{StatusSubmitted, at(6)},
		{StatusBlocked, at(6)}, // not a real path, but ensure blocks outside window ignored below
	}
	// Trim to a clean approved run: 0..10, one 3h block.
	evs = []transition{
		{StatusInProgress, at(0)},
		{StatusBlocked, at(2)},
		{StatusInProgress, at(5)},
		{StatusSubmitted, at(6)},
		{StatusInReview, at(6)},
		{StatusApproved, at(10)},
	}
	m := computeMetrics(evs, ptr(10))
	if !approx(m.TurnaroundHours, 7) { // 10 total - 3 blocked
		t.Errorf("turnaround = %v, want 7", m.TurnaroundHours)
	}
	if !approx(m.SpeedScorePct, 70) {
		t.Errorf("speed = %v, want 70", m.SpeedScorePct)
	}
}

// TestComputeMetrics_MissingSLA: §5.3 — no SLA Target ⇒ Speed Score N/A, never
// backfilled. Turnaround is still computed.
func TestComputeMetrics_MissingSLA(t *testing.T) {
	t0 := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	evs := []transition{
		{StatusInProgress, t0},
		{StatusSubmitted, t0.Add(4 * time.Hour)},
		{StatusInReview, t0.Add(4 * time.Hour)},
		{StatusApproved, t0.Add(6 * time.Hour)},
	}
	m := computeMetrics(evs, nil)
	if !approx(m.TurnaroundHours, 6) {
		t.Errorf("turnaround = %v, want 6", m.TurnaroundHours)
	}
	if m.SpeedScorePct != nil || m.SpeedScoreDisplay != "N/A" {
		t.Errorf("speed = %v / %q, want nil / N/A", m.SpeedScorePct, m.SpeedScoreDisplay)
	}
}

// TestComputeMetrics_ZeroSLA: house convention 7 — division-by-zero renders "—".
func TestComputeMetrics_ZeroSLA(t *testing.T) {
	t0 := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	evs := []transition{
		{StatusInProgress, t0},
		{StatusApproved, t0.Add(6 * time.Hour)},
	}
	m := computeMetrics(evs, ptr(0))
	if m.SpeedScorePct != nil || m.SpeedScoreDisplay != "—" {
		t.Errorf("speed = %v / %q, want nil / —", m.SpeedScorePct, m.SpeedScoreDisplay)
	}
}

// TestComputeMetrics_NotApproved: before [Approved], Turnaround and Speed are N/A.
func TestComputeMetrics_NotApproved(t *testing.T) {
	t0 := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	evs := []transition{
		{StatusInProgress, t0},
		{StatusSubmitted, t0.Add(3 * time.Hour)},
		{StatusInReview, t0.Add(3 * time.Hour)},
	}
	m := computeMetrics(evs, ptr(24))
	if m.TurnaroundHours != nil || m.SpeedScorePct != nil || m.SpeedScoreDisplay != "N/A" {
		t.Errorf("unapproved metrics = %+v, want turnaround/speed N/A", m)
	}
	if m.ApprovedPeriodWIB != "" {
		t.Errorf("ApprovedPeriodWIB = %q, want empty", m.ApprovedPeriodWIB)
	}
}

// TestComputeMetrics_RevisionFlag: Rule 15 — ≥3 revisions raises the Quality flag.
func TestComputeMetrics_RevisionFlag(t *testing.T) {
	t0 := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	evs := []transition{
		{StatusInProgress, t0},
		{StatusRevisionReq, t0.Add(1 * time.Hour)},
		{StatusRevisionReq, t0.Add(2 * time.Hour)},
		{StatusRevisionReq, t0.Add(3 * time.Hour)},
	}
	m := computeMetrics(evs, nil)
	if m.RevisionCount != 3 || !m.RevisionFlagged {
		t.Errorf("count/flag = %d/%v, want 3/true", m.RevisionCount, m.RevisionFlagged)
	}
}

// TestComputeMetrics_ApprovedPeriodWIB: O20 — the closed-period bucket is WIB, so a
// UTC approval late on the last of a month buckets into the next month.
func TestComputeMetrics_ApprovedPeriodWIB(t *testing.T) {
	// 2026-07-31T17:30:00Z = 2026-08-01T00:30:00 WIB.
	start := time.Date(2026, 7, 31, 10, 0, 0, 0, time.UTC)
	end := time.Date(2026, 7, 31, 17, 30, 0, 0, time.UTC)
	evs := []transition{{StatusInProgress, start}, {StatusApproved, end}}
	m := computeMetrics(evs, ptr(10))
	if m.ApprovedPeriodWIB != "2026-08" {
		t.Errorf("ApprovedPeriodWIB = %q, want 2026-08 (WIB bucket)", m.ApprovedPeriodWIB)
	}
	if !approx(m.TurnaroundHours, 7.5) {
		t.Errorf("turnaround = %v, want 7.5", m.TurnaroundHours)
	}
}

// TestParseTransitions: audit rows (newest-first) become an ascending transition
// list; non-transition rows (field edits) are ignored.
func TestParseTransitions(t *testing.T) {
	t0 := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	// audit.List returns DESC by id — simulate newest-first.
	entries := []audit.Entry{
		{Action: "transition:[In Progress]->[Submitted]", CreatedAt: t0.Add(2 * time.Hour)},
		{Action: "sla_target_set", CreatedAt: t0.Add(90 * time.Minute)},
		{Action: "transition:[To Do]->[In Progress]", CreatedAt: t0.Add(1 * time.Hour)},
		{Action: "create", CreatedAt: t0},
	}
	got := parseTransitions(entries)
	want := []transition{
		{StatusInProgress, t0.Add(1 * time.Hour)},
		{StatusSubmitted, t0.Add(2 * time.Hour)},
	}
	if len(got) != len(want) {
		t.Fatalf("parsed %d transitions, want %d: %+v", len(got), len(want), got)
	}
	for i := range want {
		if got[i].to != want[i].to || !got[i].at.Equal(want[i].at) {
			t.Errorf("transition[%d] = %+v, want %+v", i, got[i], want[i])
		}
	}
}
