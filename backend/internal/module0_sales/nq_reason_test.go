package sales

// W1-04 -- Not-Qualified reason taxonomy enforcement (M1 §8 / §9.3, M1-OA-8).
//
// This file is an INTERNAL test package file (package sales, unlike the
// sibling sales_test files) so it can pin the unexported validator directly;
// the integration tests below still drive only the public API surface.

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/events"
	"github.com/meagrup/agencyapp/backend/internal/core/ids"
	"github.com/meagrup/agencyapp/backend/internal/core/msg"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/core/testdb"
)

// TestNotQualifiedReasons_ClosedListByteExact pins the M1-OA-8 list, in PRD
// order, byte-for-byte. Any drift in a label is a convention #5 violation.
func TestNotQualifiedReasons_ClosedListByteExact(t *testing.T) {
	want := []string{
		"[Bukan seller]",
		"[Tidak ada budget]",
		"[Kontak salah/tidak valid]",
		"[Tidak ada respon]",
		"[Sudah jadi klien]",
		"[Spam/duplikat]",
		"[Lainnya ...]",
	}
	if len(NotQualifiedReasons) != len(want) {
		t.Fatalf("NotQualifiedReasons has %d entries, want %d", len(NotQualifiedReasons), len(want))
	}
	for i, w := range want {
		if NotQualifiedReasons[i] != w {
			t.Errorf("NotQualifiedReasons[%d] = %q, want %q", i, NotQualifiedReasons[i], w)
		}
	}
}

// TestNotQualifiedReasonValue exercises the (reason, detail) validator table.
func TestNotQualifiedReasonValue(t *testing.T) {
	cases := []struct {
		name       string
		reason     string
		detail     string
		wantStored string
		wantOK     bool
	}{
		// The six closed reasons, no detail.
		{"bukan seller", "[Bukan seller]", "", "[Bukan seller]", true},
		{"tidak ada budget", "[Tidak ada budget]", "", "[Tidak ada budget]", true},
		{"kontak salah", "[Kontak salah/tidak valid]", "", "[Kontak salah/tidak valid]", true},
		{"tidak ada respon", "[Tidak ada respon]", "", "[Tidak ada respon]", true},
		{"sudah jadi klien", "[Sudah jadi klien]", "", "[Sudah jadi klien]", true},
		{"spam duplikat", "[Spam/duplikat]", "", "[Spam/duplikat]", true},

		// Lainnya fallback: detail mandatory, stored combined.
		{"lainnya with detail", "[Lainnya ...]", "sudah pakai agency lain", "[Lainnya ...] sudah pakai agency lain", true},
		{"lainnya detail trimmed", "[Lainnya ...]", "  ganti nomor  ", "[Lainnya ...] ganti nomor", true},
		{"lainnya without detail", "[Lainnya ...]", "", "", false},
		{"lainnya blank detail", "[Lainnya ...]", "   ", "", false},

		// Closed reasons must NOT carry free text.
		{"closed reason with stray detail", "[Bukan seller]", "extra", "", false},

		// Off-list / malformed / case-drift reasons.
		{"empty reason", "", "", "", false},
		{"empty reason with detail", "", "some detail", "", false},
		{"unbracketed", "Bukan seller", "", "", false},
		{"lowercase drift", "[bukan seller]", "", "", false},
		{"invented reason", "[Tidak tertarik]", "", "", false},
		{"missing closing bracket", "[Bukan seller", "", "", false},
		{"pre-combined lainnya string", "[Lainnya ...] sudah digabung", "", "", false},
		{"whitespace reason", "   ", "", "", false},

		// Column-capacity guard (VARCHAR(255)).
		{"lainnya detail too long", "[Lainnya ...]", strings.Repeat("x", 250), "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			stored, ok := notQualifiedReasonValue(c.reason, c.detail)
			if ok != c.wantOK {
				t.Fatalf("notQualifiedReasonValue(%q, %q) ok = %v, want %v", c.reason, c.detail, ok, c.wantOK)
			}
			if stored != c.wantStored {
				t.Errorf("stored = %q, want %q", stored, c.wantStored)
			}
		})
	}
}

// ---- integration: UpdateStatus enforcement over a real DB -------------------

func newNQTestAttempts() *Attempts {
	return NewAttempts(authz.NewMatrixChecker(), audit.NewMySQL(), ids.NewMySQL(), events.NewInMemoryBus())
}

func nqStaff(employeeID string) authz.Identity {
	return authz.Identity{EmployeeID: employeeID, Divisi: DivisiSales, Roles: []authz.Role{authz.RoleStaff}}
}

// nqSeedContacted creates a fresh attempt and drives it to Contacted through
// the public API, returning its PRSP id.
func nqSeedContacted(ctx context.Context, t *testing.T, conn *sql.DB, s *Attempts, actor authz.Identity, leadID string) string {
	t.Helper()
	id, err := s.CreateAttempt(ctx, conn, leadID, actor.EmployeeID, time.Date(2026, time.July, 10, 4, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("CreateAttempt: %v", err)
	}
	if err := s.UpdateStatus(ctx, conn, actor, id, UpdateStatusInput{To: statemachine.ProspectContacted, ActionType: "call"}); err != nil {
		t.Fatalf("-> Contacted: %v", err)
	}
	return id
}

func nqRawRow(t *testing.T, conn *sql.DB, prospectID string) (status string, reason sql.NullString) {
	t.Helper()
	if err := conn.QueryRow(
		`SELECT status, not_qualified_reason FROM prospect_attempts WHERE prospect_id = ?`, prospectID,
	).Scan(&status, &reason); err != nil {
		t.Fatalf("raw row: %v", err)
	}
	return status, reason
}

func nqCountAudit(t *testing.T, conn *sql.DB, prospectID string) int {
	t.Helper()
	var n int
	if err := conn.QueryRow(
		`SELECT COUNT(*) FROM audit_log WHERE entity_type = 'prospect' AND entity_id = ?`, prospectID,
	).Scan(&n); err != nil {
		t.Fatalf("count audit: %v", err)
	}
	return n
}

// TestUpdateStatus_NotQualified_ReasonMandatory pins the W1-04 core rule: the
// Contacted -> Not Qualified transition is REJECTED with the exact BI
// mandatory-field message and ZERO side effects when the reason is missing,
// off-list, or a detail-less `[Lainnya ...]`.
func TestUpdateStatus_NotQualified_ReasonMandatory(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newNQTestAttempts()
	actor := nqStaff("sales-nq-1")
	id := nqSeedContacted(ctx, t, conn, s, actor, "LEAD-202607-4001")

	cases := []UpdateStatusInput{
		{To: statemachine.ProspectNotQualified},                                                                             // missing
		{To: statemachine.ProspectNotQualified, NotQualifiedReason: "[Tidak tertarik]"},                                     // off-list
		{To: statemachine.ProspectNotQualified, NotQualifiedReason: "bukan seller"},                                         // unbracketed drift
		{To: statemachine.ProspectNotQualified, NotQualifiedReason: NQReasonLainnya},                                        // fallback w/o detail
		{To: statemachine.ProspectNotQualified, NotQualifiedReason: NQReasonLainnya, NotQualifiedReasonDetail: " "},         // blank detail
		{To: statemachine.ProspectNotQualified, NotQualifiedReason: NQReasonBukanSeller, NotQualifiedReasonDetail: "stray"}, // closed + stray text
	}

	before := nqCountAudit(t, conn, id)
	for i, in := range cases {
		t.Run(fmt.Sprintf("case_%d_reason=%q_detail=%q", i, in.NotQualifiedReason, in.NotQualifiedReasonDetail), func(t *testing.T) {
			err := s.UpdateStatus(ctx, conn, actor, id, in)
			var ve *ValidationError
			if !errors.As(err, &ve) {
				t.Fatalf("expected *ValidationError, got %v (%T)", err, err)
			}
			if ve.Message != msg.DataTidakLengkap {
				t.Errorf("message = %q, want %q", ve.Message, msg.DataTidakLengkap)
			}
			status, reason := nqRawRow(t, conn, id)
			if status != string(statemachine.ProspectContacted) {
				t.Errorf("status mutated to %q on rejected validation", status)
			}
			if reason.Valid {
				t.Errorf("not_qualified_reason written (%q) on rejected validation", reason.String)
			}
		})
	}
	if after := nqCountAudit(t, conn, id); after != before {
		t.Errorf("audit rows changed %d -> %d on rejected validations (must be zero side effects)", before, after)
	}
}

// TestUpdateStatus_NotQualified_ValidReasons drives the success path for a
// closed reason and for the `[Lainnya ...]` fallback, asserting the stored
// column value and the dedicated audit row.
func TestUpdateStatus_NotQualified_ValidReasons(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newNQTestAttempts()
	actor := nqStaff("sales-nq-2")

	// Closed reason, stored verbatim.
	idA := nqSeedContacted(ctx, t, conn, s, actor, "LEAD-202607-4002")
	if err := s.UpdateStatus(ctx, conn, actor, idA, UpdateStatusInput{
		To: statemachine.ProspectNotQualified, NotQualifiedReason: NQReasonTidakAdaRespon,
	}); err != nil {
		t.Fatalf("valid closed reason rejected: %v", err)
	}
	status, reason := nqRawRow(t, conn, idA)
	if status != string(statemachine.ProspectNotQualified) {
		t.Errorf("status = %q, want Not Qualified", status)
	}
	if !reason.Valid || reason.String != NQReasonTidakAdaRespon {
		t.Errorf("stored reason = %+v, want %q", reason, NQReasonTidakAdaRespon)
	}

	// Fallback reason, stored combined "[Lainnya ...] <detail>".
	idB := nqSeedContacted(ctx, t, conn, s, actor, "LEAD-202607-4003")
	if err := s.UpdateStatus(ctx, conn, actor, idB, UpdateStatusInput{
		To:                       statemachine.ProspectNotQualified,
		NotQualifiedReason:       NQReasonLainnya,
		NotQualifiedReasonDetail: "sudah tutup usaha",
	}); err != nil {
		t.Fatalf("valid [Lainnya ...] reason rejected: %v", err)
	}
	_, reasonB := nqRawRow(t, conn, idB)
	if !reasonB.Valid || reasonB.String != "[Lainnya ...] sudah tutup usaha" {
		t.Errorf("stored reason = %+v, want %q", reasonB, "[Lainnya ...] sudah tutup usaha")
	}

	// The reason write carries its own immutable audit entry.
	var n int
	if err := conn.QueryRow(
		`SELECT COUNT(*) FROM audit_log WHERE entity_type = 'prospect' AND entity_id = ? AND action = 'not_qualified_reason_recorded'`, idA,
	).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("not_qualified_reason_recorded audit rows = %d, want 1", n)
	}
}

// TestUpdateStatus_ReasonForbiddenOnOtherTargets pins the counterpart rule: a
// NotQualifiedReason (or detail) supplied on any target other than Not
// Qualified fails validation with zero side effects.
func TestUpdateStatus_ReasonForbiddenOnOtherTargets(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newNQTestAttempts()
	actor := nqStaff("sales-nq-3")

	id, err := s.CreateAttempt(ctx, conn, "LEAD-202607-4004", actor.EmployeeID, time.Date(2026, time.July, 10, 4, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("CreateAttempt: %v", err)
	}

	cases := []UpdateStatusInput{
		{To: statemachine.ProspectContacted, ActionType: "call", NotQualifiedReason: NQReasonBukanSeller},
		{To: statemachine.ProspectContacted, ActionType: "call", NotQualifiedReasonDetail: "free text"},
	}
	for i, in := range cases {
		t.Run(fmt.Sprintf("case_%d", i), func(t *testing.T) {
			err := s.UpdateStatus(ctx, conn, actor, id, in)
			var ve *ValidationError
			if !errors.As(err, &ve) {
				t.Fatalf("expected *ValidationError, got %v (%T)", err, err)
			}
			status, reason := nqRawRow(t, conn, id)
			if status != string(statemachine.ProspectNewLead) {
				t.Errorf("status mutated to %q", status)
			}
			if reason.Valid {
				t.Errorf("not_qualified_reason written (%q)", reason.String)
			}
		})
	}
}

// TestUpdateStatus_NotQualified_WrongFromState_ZeroSideEffects proves the
// taxonomy passing does NOT bypass the engine: a valid reason on an attempt
// whose from-state has no edge to Not Qualified (New Lead) is still blocked
// by the engine, and the reason column stays untouched.
func TestUpdateStatus_NotQualified_WrongFromState_ZeroSideEffects(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newNQTestAttempts()
	actor := nqStaff("sales-nq-4")

	id, err := s.CreateAttempt(ctx, conn, "LEAD-202607-4005", actor.EmployeeID, time.Date(2026, time.July, 10, 4, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("CreateAttempt: %v", err)
	}
	before := nqCountAudit(t, conn, id)

	err = s.UpdateStatus(ctx, conn, actor, id, UpdateStatusInput{
		To: statemachine.ProspectNotQualified, NotQualifiedReason: NQReasonSpamDuplikat,
	})
	if err == nil {
		t.Fatal("expected engine block for New Lead -> Not Qualified (no such edge)")
	}
	status, reason := nqRawRow(t, conn, id)
	if status != string(statemachine.ProspectNewLead) {
		t.Errorf("status mutated to %q", status)
	}
	if reason.Valid {
		t.Errorf("not_qualified_reason written (%q) despite blocked transition", reason.String)
	}
	if after := nqCountAudit(t, conn, id); after != before {
		t.Errorf("audit rows changed %d -> %d on blocked transition", before, after)
	}
}
