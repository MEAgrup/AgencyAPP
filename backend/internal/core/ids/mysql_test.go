package ids_test

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"sync"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/ids"
	"github.com/meagrup/agencyapp/backend/internal/core/testdb"
)

var jul2026 = time.Date(2026, time.July, 10, 12, 0, 0, 0, time.UTC)

// (b) format exact.
func TestNext_FormatExact(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	gen := ids.NewMySQL()

	got, err := gen.Next(ctx, conn, ids.PrefixProspect, jul2026)
	if err != nil {
		t.Fatalf("Next: %v", err)
	}
	if want := "PRSP-202607-0001"; got != want {
		t.Fatalf("first id = %q, want %q", got, want)
	}
	// Regex sanity check for the general shape.
	re := regexp.MustCompile(`^[A-Z]+-\d{6}-\d{4,}$`)
	if !re.MatchString(got) {
		t.Fatalf("id %q does not match PREFIX-YYYYMM-NNNN", got)
	}

	// Second call increments within the same prefix/month.
	got2, err := gen.Next(ctx, conn, ids.PrefixProspect, jul2026)
	if err != nil {
		t.Fatalf("Next 2: %v", err)
	}
	if want := "PRSP-202607-0002"; got2 != want {
		t.Fatalf("second id = %q, want %q", got2, want)
	}
}

// (e) unknown prefix rejected — and nothing is written.
func TestNext_UnknownPrefixRejected(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	gen := ids.NewMySQL()

	_, err := gen.Next(ctx, conn, "NOPE", jul2026)
	if !errors.Is(err, ids.ErrUnknownPrefix) {
		t.Fatalf("err = %v, want ErrUnknownPrefix", err)
	}

	var n int
	if err := conn.QueryRow("SELECT COUNT(*) FROM id_sequences").Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Fatalf("unknown prefix wrote %d sequence rows, want 0", n)
	}
}

// (d) month rollover starts a new sequence.
func TestNext_MonthRollover(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	gen := ids.NewMySQL()

	// Times chosen so their WIB (UTC+7) period is unambiguous: 12:00Z on
	// Jul 31 is 19:00 WIB (still July); 00:00Z on Aug 1 is 07:00 WIB (August).
	jul, err := gen.Next(ctx, conn, ids.PrefixClient, time.Date(2026, time.July, 31, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("july: %v", err)
	}
	if want := "CLI-202607-0001"; jul != want {
		t.Fatalf("july id = %q, want %q", jul, want)
	}
	aug, err := gen.Next(ctx, conn, ids.PrefixClient, time.Date(2026, time.August, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("august: %v", err)
	}
	if want := "CLI-202608-0001"; aug != want {
		t.Fatalf("august id = %q, want %q (rollover must restart)", aug, want)
	}
}

// TestNext_PeriodZoneWIB pins the docs/DECISIONS.md O10 behavior: the period
// is evaluated in WIB (UTC+7), so an instant late on Jul 31 UTC that has
// already crossed midnight in WIB gets the August period.
func TestNext_PeriodZoneWIB(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	gen := ids.NewMySQL()

	// 2026-07-31T18:30:00Z == 2026-08-01 01:30 WIB → period must be 202608.
	got, err := gen.Next(ctx, conn, ids.PrefixClient, time.Date(2026, time.July, 31, 18, 30, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("Next: %v", err)
	}
	if want := "CLI-202608-0001"; got != want {
		t.Fatalf("WIB-boundary id = %q, want %q", got, want)
	}
}

// (c) a rolled-back transaction does not consume a number.
func TestNext_RollbackDoesNotConsume(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	gen := ids.NewMySQL()

	// Commit the first number.
	first, err := gen.Next(ctx, conn, ids.PrefixTransaction, jul2026)
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	if want := "TRX-202607-0001"; first != want {
		t.Fatalf("first = %q, want %q", first, want)
	}

	// Draw the next number inside a transaction that then rolls back.
	sentinel := errors.New("force rollback")
	var drawn string
	err = db.WithTx(ctx, conn, func(tx *sql.Tx) error {
		drawn, err = gen.Next(ctx, tx, ids.PrefixTransaction, jul2026)
		if err != nil {
			return err
		}
		return sentinel // triggers rollback in WithTx
	})
	if !errors.Is(err, sentinel) {
		t.Fatalf("WithTx err = %v, want sentinel", err)
	}
	if want := "TRX-202607-0002"; drawn != want {
		t.Fatalf("drawn-in-rolled-back-tx = %q, want %q", drawn, want)
	}

	// The rolled-back number must be reused by the next committed call.
	reused, err := gen.Next(ctx, conn, ids.PrefixTransaction, jul2026)
	if err != nil {
		t.Fatalf("reused: %v", err)
	}
	if want := "TRX-202607-0002"; reused != want {
		t.Fatalf("reused = %q, want %q (rolled-back number must be reused)", reused, want)
	}
}

// (a) N parallel goroutines, each with its own transaction, produce no
// duplicates and no gaps.
func TestNext_ParallelNoGapsNoDuplicates(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	gen := ids.NewMySQL()

	const n = 40
	results := make([]string, n)
	var wg sync.WaitGroup
	errs := make(chan error, n)

	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			err := db.WithTx(ctx, conn, func(tx *sql.Tx) error {
				id, err := gen.Next(ctx, tx, ids.PrefixBrief, jul2026)
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
		t.Fatalf("parallel Next: %v", err)
	}

	seen := make(map[string]bool, n)
	for _, id := range results {
		if seen[id] {
			t.Fatalf("duplicate id issued: %q", id)
		}
		seen[id] = true
	}
	// Exactly BRF-202607-0001 .. BRF-202607-0040, contiguous, no gaps.
	for i := 1; i <= n; i++ {
		want := "BRF-202607-" + pad4(i)
		if !seen[want] {
			t.Fatalf("missing id %q — sequence has a gap", want)
		}
	}
}

func pad4(i int) string {
	const digits = "0123456789"
	b := []byte{'0', '0', '0', '0'}
	p := 3
	for i > 0 && p >= 0 {
		b[p] = digits[i%10]
		i /= 10
		p--
	}
	return string(b)
}
