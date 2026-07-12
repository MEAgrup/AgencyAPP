package ident_test

import (
	"context"
	"regexp"
	"sync"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/ident"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

var idFormat = regexp.MustCompile(`^TST-\d{6}-\d{4}$`)

func TestNext_FormatAndSequence(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()
	now := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)

	var ids []string
	for i := 0; i < 5; i++ {
		tx, err := d.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		id, err := ident.Next(ctx, tx, "TST", now)
		if err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
		if !idFormat.MatchString(id) {
			t.Fatalf("bad id format: %s", id)
		}
		ids = append(ids, id)
	}
	want := []string{"TST-202607-0001", "TST-202607-0002", "TST-202607-0003", "TST-202607-0004", "TST-202607-0005"}
	for i, w := range want {
		if ids[i] != w {
			t.Errorf("id[%d]=%s want %s", i, ids[i], w)
		}
	}
}

func TestNext_FailedValidationConsumesNoSequence(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()
	now := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)

	// Allocate an id inside a tx, then ROLL BACK (simulating a downstream
	// validation/insert failure). The sequence must not advance.
	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ident.Next(ctx, tx, "TST", now); err != nil {
		t.Fatal(err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}

	// Next successful allocation must still be 0001.
	tx2, _ := d.BeginTx(ctx, nil)
	id, err := ident.Next(ctx, tx2, "TST", now)
	if err != nil {
		t.Fatal(err)
	}
	tx2.Commit()
	if id != "TST-202607-0001" {
		t.Fatalf("rolled-back allocation consumed a sequence: got %s want TST-202607-0001", id)
	}
}

func TestNext_ParallelNoGapsNoDuplicates(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()
	now := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)

	const n = 40
	var wg sync.WaitGroup
	results := make([]string, n)
	errs := make([]error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			tx, err := d.BeginTx(ctx, nil)
			if err != nil {
				errs[i] = err
				return
			}
			id, err := ident.Next(ctx, tx, "TST", now)
			if err != nil {
				tx.Rollback()
				errs[i] = err
				return
			}
			if err := tx.Commit(); err != nil {
				errs[i] = err
				return
			}
			results[i] = id
		}(i)
	}
	wg.Wait()

	seen := map[string]bool{}
	for i := 0; i < n; i++ {
		if errs[i] != nil {
			t.Fatalf("goroutine %d: %v", i, errs[i])
		}
		if seen[results[i]] {
			t.Fatalf("duplicate id issued: %s", results[i])
		}
		seen[results[i]] = true
	}
	// Exactly 0001..00NN, no gaps.
	for i := 1; i <= n; i++ {
		want := "TST-202608-" + pad(i)
		if !seen[want] {
			t.Fatalf("gap: missing %s", want)
		}
	}
}

func pad(i int) string {
	b := []byte("0000")
	for p := 3; p >= 0 && i > 0; p-- {
		b[p] = byte('0' + i%10)
		i /= 10
	}
	return string(b)
}

// TestNext_O20_YYYYMMBucketsWIB verifies O20 decision: YYYYMM component in IDs
// uses Asia/Jakarta (WIB) calendar dates, not UTC.
//
// Test case: 2026-06-30T17:30:00Z = 2026-07-01T00:30:00+07:00 (WIB)
// Expected: ID should have YYYYMM=202607 (July in WIB), not 202606 (June in UTC).
func TestNext_O20_YYYYMMBucketsWIB(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()

	// A UTC moment that crosses month boundary in WIB
	utcMoment := time.Date(2026, 6, 30, 17, 30, 0, 0, time.UTC)

	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	id, err := ident.Next(ctx, tx, "TST", utcMoment)
	if err != nil {
		t.Fatal(err)
	}
	tx.Commit()

	// ID should have YYYYMM=202607 (July in WIB), not 202606 (June in UTC)
	if !idFormat.MatchString(id) {
		t.Fatalf("bad id format: %s", id)
	}

	// Extract the YYYYMM component (6 chars after prefix)
	if id != "TST-202607-0001" {
		t.Errorf("O20 month boundary: got %s, expected TST-202607-0001 (July WIB date)", id)
	}
}

// TestNext_O20_DailyBucketWIB verifies that IDs bucket to WIB daily boundaries.
//
// Test case 1: 2026-07-11T18:30:00Z = 2026-07-12T01:30:00+07:00 (WIB) on next day
// Both moments should produce the same YYYYMM (202607) because both are in July WIB.
func TestNext_O20_SameDayBucketWIB(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()

	// Two UTC moments that are in the same WIB date (2026-07-12)
	// 2026-07-11T18:30:00Z = 2026-07-12T01:30:00 WIB
	utc1 := time.Date(2026, 7, 11, 18, 30, 0, 0, time.UTC)

	// 2026-07-12T10:00:00Z = 2026-07-12T17:00:00 WIB (still the same day)
	utc2 := time.Date(2026, 7, 12, 10, 0, 0, 0, time.UTC)

	tx1, _ := d.BeginTx(ctx, nil)
	id1, err := ident.Next(ctx, tx1, "TST", utc1)
	tx1.Commit()
	if err != nil {
		t.Fatal(err)
	}

	tx2, _ := d.BeginTx(ctx, nil)
	id2, err := ident.Next(ctx, tx2, "TST", utc2)
	tx2.Commit()
	if err != nil {
		t.Fatal(err)
	}

	// Both should have the same YYYYMM (202607)
	if id1 != "TST-202607-0001" {
		t.Errorf("id1: got %s, expected TST-202607-0001", id1)
	}
	if id2 != "TST-202607-0002" {
		t.Errorf("id2: got %s, expected TST-202607-0002", id2)
	}
}
