package sales_test

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"sync"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/core/testdb"
	"github.com/meagrup/agencyapp/backend/internal/module0_sales"
)

var prospectIDPattern = regexp.MustCompile(`^PRSP-\d{6}-\d{4,}$`)

func TestCreateAttempt_Success(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()

	id, err := s.CreateAttempt(ctx, conn, "LEAD-202607-0001", "sales-budi", jul2026)
	if err != nil {
		t.Fatalf("CreateAttempt: %v", err)
	}
	if !prospectIDPattern.MatchString(id) {
		t.Fatalf("id %q does not match PRSP-YYYYMM-NNNN", id)
	}

	// Lands on New Lead (M0 §3 rule 4), not the transient Pending Validation.
	att, err := s.GetAttempt(ctx, conn, staffActor("sales-budi"), id)
	if err != nil {
		t.Fatalf("GetAttempt: %v", err)
	}
	if att.Status != statemachine.ProspectNewLead {
		t.Fatalf("status = %q, want New Lead", att.Status)
	}
	if att.OwnerEmployeeID != "sales-budi" || att.LeadID != "LEAD-202607-0001" {
		t.Fatalf("unexpected attempt: %+v", att)
	}

	// Two immutable audit rows: the "create" row and the engine's own
	// Pending Validation -> New Lead transition row.
	if n := countAuditRows(t, conn, id); n != 2 {
		t.Fatalf("audit rows = %d, want 2 (create + transition)", n)
	}
}

func TestCreateAttempt_MandatoryValidation(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()

	cases := []struct {
		name            string
		leadID, ownerID string
	}{
		{"empty lead id", "", "sales-budi"},
		{"empty owner id", "LEAD-202607-0002", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			id, err := s.CreateAttempt(ctx, conn, c.leadID, c.ownerID, jul2026)
			var ve *sales.ValidationError
			if !errors.As(err, &ve) {
				t.Fatalf("expected *ValidationError, got %v", err)
			}
			if ve.Message != "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" {
				t.Errorf("message = %q", ve.Message)
			}
			if id != "" {
				t.Errorf("expected no id on validation failure, got %q", id)
			}
		})
	}

	// No row, no sequence number consumed by any of the failed attempts.
	var n int
	if err := conn.QueryRow(`SELECT COUNT(*) FROM prospect_attempts`).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Fatalf("prospect_attempts rows = %d, want 0 (no id ever generated on failed validation)", n)
	}
}

// A rolled-back caller transaction must leave no orphan attempt row and no
// orphan/gapped PRSP id -- the next successful CreateAttempt reuses the same
// sequence number (per internal/core/ids's documented rollback behaviour).
func TestCreateAttempt_RollbackLeavesNoOrphan(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()

	boom := errors.New("boom: caller aborts after CreateAttempt")
	var drawnID string
	err := db.WithTx(ctx, conn, func(tx *sql.Tx) error {
		id, err := s.CreateAttempt(ctx, tx, "LEAD-202607-0003", "sales-budi", jul2026)
		if err != nil {
			return err
		}
		drawnID = id
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("WithTx err = %v, want boom", err)
	}
	if drawnID == "" {
		t.Fatal("expected an id to have been drawn before rollback")
	}

	// The row must not exist post-rollback.
	var n int
	if err := conn.QueryRow(`SELECT COUNT(*) FROM prospect_attempts WHERE prospect_id = ?`, drawnID).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Fatalf("rolled-back attempt row still present: %s", drawnID)
	}
	// No audit rows survived either.
	if n := countAuditRows(t, conn, drawnID); n != 0 {
		t.Fatalf("audit rows for rolled-back attempt = %d, want 0", n)
	}

	// The next successful create reuses the same id -- no gap left behind.
	reusedID, err := s.CreateAttempt(ctx, conn, "LEAD-202607-0003", "sales-budi", jul2026)
	if err != nil {
		t.Fatalf("CreateAttempt after rollback: %v", err)
	}
	if reusedID != drawnID {
		t.Fatalf("reused id = %q, want %q (rolled-back number must be reused, no gap)", reusedID, drawnID)
	}
}

// N parallel goroutines, each in its own caller-owned transaction, must
// produce distinct PRSP ids with no duplicates and no gaps -- CreateAttempt
// must be safe to call concurrently from many salespeople/claims at once.
func TestCreateAttempt_ParallelSafe(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()

	const n = 25
	results := make([]string, n)
	var wg sync.WaitGroup
	errs := make(chan error, n)

	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			err := db.WithTx(ctx, conn, func(tx *sql.Tx) error {
				id, err := s.CreateAttempt(ctx, tx, "LEAD-202607-PARALLEL", "sales-parallel", jul2026)
				if err != nil {
					return err
				}
				results[i] = id
				return nil
			})
			if err != nil {
				errs <- err
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("parallel CreateAttempt: %v", err)
	}

	seen := make(map[string]bool, n)
	for _, id := range results {
		if id == "" {
			t.Fatal("empty id returned")
		}
		if seen[id] {
			t.Fatalf("duplicate id issued: %q", id)
		}
		seen[id] = true
		if !prospectIDPattern.MatchString(id) {
			t.Fatalf("malformed id: %q", id)
		}
	}
	if len(seen) != n {
		t.Fatalf("expected %d distinct ids, got %d", n, len(seen))
	}

	// Every attempt actually landed on New Lead -- no partial/failed writes.
	var newLeadCount int
	if err := conn.QueryRow(
		`SELECT COUNT(*) FROM prospect_attempts WHERE lead_id = 'LEAD-202607-PARALLEL' AND status = ?`,
		string(statemachine.ProspectNewLead),
	).Scan(&newLeadCount); err != nil {
		t.Fatalf("count: %v", err)
	}
	if newLeadCount != n {
		t.Fatalf("New Lead rows = %d, want %d", newLeadCount, n)
	}
}

// CreateAttempt has no actor/authz parameter by design (module1_leads runs
// its own permission + dedup gate before ever calling it); this test just
// pins that CreateAttempt's returned owner is whatever the caller passes,
// unconditionally -- so read/update permission afterwards is enforced purely
// through GetAttempt/UpdateStatus's own authz.Identity checks.
func TestCreateAttempt_OwnerIsWhateverCallerPasses(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()

	id := mustCreate(ctx, t, conn, s, "LEAD-202607-0004", "sales-andi")

	// A different staff member cannot read it (own-data-only).
	if _, err := s.GetAttempt(ctx, conn, staffActor("sales-budi"), id); !errors.Is(err, authz.ErrDenied) {
		t.Fatalf("expected authz.ErrDenied for non-owner staff, got %v", err)
	}
	// The owner can.
	if _, err := s.GetAttempt(ctx, conn, staffActor("sales-andi"), id); err != nil {
		t.Fatalf("owner GetAttempt: %v", err)
	}
}
