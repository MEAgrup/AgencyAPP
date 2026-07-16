package main

// Execute is the DB-touching half of mslseed: given already-parsed rows and a
// permission-checked actor, it (1) validates every row (format-level, via
// Row.ToServiceInput) and aborts before touching the DB if any row fails, (2)
// builds an idempotent create/new-version/skip plan by matching each row's
// name against the Master Service List version effective at that row's
// effective_from (admin.ListEffectiveAt), and (3) either prints the plan
// (dry-run) or executes it through the admin package (apply — CreateService /
// UpdateService only, so every write is audited + versioned by admin itself).
//
// Idempotency key = service NAME at the row's effective_from. "Identical"
// means every seeded field (including effective_from) matches the existing
// effective version; any difference is a new version, never a mutation.

import (
	"context"
	"database/sql"
	"fmt"
	"io"

	"github.com/meagrup/agencyapp/backend/internal/admin"
	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// Report tallies the outcome of one Execute run (dry-run or apply).
type Report struct {
	Created    int
	NewVersion int
	Skipped    int
	Errors     int
}

// Execute validates rows, builds the plan against d, and — iff apply — writes
// through admin.CreateService/UpdateService. Progress and the final plan are
// written to out. A non-nil error means: permission denied, a DB error, a
// row-validation failure (checked first, nothing touched), or at least one
// write failure during apply.
func Execute(ctx context.Context, d *sql.DB, actor permission.Actor, rows []Row, apply bool, out io.Writer) (Report, error) {
	var rep Report

	if !admin.CanEditMasterServices(actor) {
		return rep, admin.ErrMasterServiceDenied
	}

	// Phase 1 — validate every row before touching the DB at all.
	type item struct {
		row   Row
		input admin.ServiceInput
	}
	items := make([]item, 0, len(rows))
	badRows := 0
	for _, row := range rows {
		in, err := row.ToServiceInput()
		if err != nil {
			badRows++
			fmt.Fprintf(out, "ERROR %v\n", err)
			continue
		}
		items = append(items, item{row: row, input: in})
	}
	if badRows > 0 {
		rep.Errors = badRows
		return rep, fmt.Errorf("validasi CSV gagal: %d dari %d baris tidak valid — dibatalkan sebelum menyentuh DB", badRows, len(rows))
	}

	// Phase 2 — idempotency plan (read-only). Cache ListEffectiveAt per
	// distinct effective_from date since most seed runs share one date.
	cache := map[string]map[string]admin.ServiceView{}
	effectiveByName := func(date string) (map[string]admin.ServiceView, error) {
		if m, ok := cache[date]; ok {
			return m, nil
		}
		views, err := admin.ListEffectiveAt(ctx, d, date)
		if err != nil {
			return nil, err
		}
		m := make(map[string]admin.ServiceView, len(views))
		for _, v := range views {
			m[v.Name] = v
		}
		cache[date] = m
		return m, nil
	}

	const (
		actionCreate = "create"
		actionUpdate = "update"
		actionSkip   = "skip"
	)
	type planned struct {
		item
		action   string
		existing admin.ServiceView
	}
	plan := make([]planned, 0, len(items))
	for _, it := range items {
		byName, err := effectiveByName(it.input.EffectiveFrom)
		if err != nil {
			return rep, fmt.Errorf("baris %d (%s): lookup MSL efektif @ %s: %w", it.row.Line, it.row.ServiceKey, it.input.EffectiveFrom, err)
		}
		existing, ok := byName[it.input.Name]
		if !ok {
			plan = append(plan, planned{item: it, action: actionCreate})
			continue
		}
		same, err := sameService(existing, it.input)
		if err != nil {
			return rep, fmt.Errorf("baris %d (%s): bandingkan versi existing: %w", it.row.Line, it.row.ServiceKey, err)
		}
		if same {
			plan = append(plan, planned{item: it, action: actionSkip, existing: existing})
		} else {
			plan = append(plan, planned{item: it, action: actionUpdate, existing: existing})
		}
	}

	// Phase 3 — report the plan, and (iff apply) execute it.
	for _, p := range plan {
		switch p.action {
		case actionCreate:
			if !apply {
				rep.Created++
				fmt.Fprintf(out, "[DRY-RUN] akan dibuat  baris %d (%s): %s\n", p.row.Line, p.row.ServiceKey, p.input.Name)
				continue
			}
			id, err := admin.CreateService(ctx, d, actor, p.input)
			if err != nil {
				rep.Errors++
				fmt.Fprintf(out, "ERROR baris %d (%s) create: %v\n", p.row.Line, p.row.ServiceKey, err)
				continue
			}
			rep.Created++
			fmt.Fprintf(out, "dibuat        baris %d (%s): %s -> %s v1\n", p.row.Line, p.row.ServiceKey, p.input.Name, id)

		case actionUpdate:
			if !apply {
				rep.NewVersion++
				fmt.Fprintf(out, "[DRY-RUN] versi baru  baris %d (%s): %s (%s v%d -> v%d)\n",
					p.row.Line, p.row.ServiceKey, p.input.Name, p.existing.ID, p.existing.VersionNo, p.existing.VersionNo+1)
				continue
			}
			ver, err := admin.UpdateService(ctx, d, actor, p.existing.ID, p.input)
			if err != nil {
				rep.Errors++
				fmt.Fprintf(out, "ERROR baris %d (%s) update: %v\n", p.row.Line, p.row.ServiceKey, err)
				continue
			}
			rep.NewVersion++
			fmt.Fprintf(out, "versi baru    baris %d (%s): %s -> %s v%d\n", p.row.Line, p.row.ServiceKey, p.input.Name, p.existing.ID, ver)

		case actionSkip:
			rep.Skipped++
			fmt.Fprintf(out, "sama, dilewati baris %d (%s): %s\n", p.row.Line, p.row.ServiceKey, p.input.Name)
		}
	}

	mode := "dry-run"
	if apply {
		mode = "apply"
	}
	fmt.Fprintf(out, "\nringkasan (%s): dibuat=%d versi_baru=%d dilewati=%d error=%d\n",
		mode, rep.Created, rep.NewVersion, rep.Skipped, rep.Errors)

	if rep.Errors > 0 {
		return rep, fmt.Errorf("%d error saat %s", rep.Errors, mode)
	}
	return rep, nil
}

// sameService reports whether every seeded field of an existing effective
// version matches a candidate input exactly — the idempotency "no-op" check.
// Money fields compare by parsed value (DB round-trips "6000000" as
// "6000000.00"), everything else by exact (trimmed) string/bool equality.
func sameService(existing admin.ServiceView, want admin.ServiceInput) (bool, error) {
	wantPrice := want.StandardPrice
	if wantPrice == "" {
		wantPrice = "0"
	}
	wp, err := money.Parse(wantPrice)
	if err != nil {
		return false, fmt.Errorf("standard_price baru %q: %w", want.StandardPrice, err)
	}
	ep, err := money.Parse(existing.StandardPrice)
	if err != nil {
		return false, fmt.Errorf("standard_price existing %q: %w", existing.StandardPrice, err)
	}
	if wp != ep {
		return false, nil
	}
	if !sameOptionalQty(existing.MinQty, want.MinQty) {
		return false, nil
	}
	return existing.Name == want.Name &&
		existing.CommissionRule == want.CommissionRule &&
		existing.Category == want.Category &&
		existing.Unit == want.Unit &&
		existing.PricingMode == want.PricingMode &&
		existing.ApplyPPN == want.ApplyPPN &&
		existing.Frequency == want.Frequency &&
		existing.PriceNote == want.PriceNote &&
		existing.Description == want.Description &&
		existing.Active == want.Active &&
		existing.EffectiveFrom == want.EffectiveFrom, nil
}

// sameOptionalQty compares an optional DECIMAL(15,2)-ish quantity field
// (empty string = not set) by parsed value when both are set.
func sameOptionalQty(a, b string) bool {
	if a == "" || b == "" {
		return a == b
	}
	ma, errA := money.Parse(a)
	mb, errB := money.Parse(b)
	if errA != nil || errB != nil {
		return a == b
	}
	return ma == mb
}
