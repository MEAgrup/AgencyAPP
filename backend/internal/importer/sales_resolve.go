package importer

// sales_resolve.go implements the W1-19 sales-name resolution fallback
// (DECISIONS.md 2026-07-11 "Sales-map: TIDAK ada sistem nickname"): the real
// source columns (Daily Leads "BANT oleh" / db_jasa "Nama Sales") carry the
// salesperson's FULL NAME, not a nickname — the only exception is "Cena"
// (Sales Head). So resolution now falls back to an automatic full-name lookup
// against `employees`, and --sales-map becomes an EXCEPTION override (highest
// precedence, e.g. the "Cena" row) rather than the primary mechanism.
//
// Precedence per row (spec order, do not reorder):
//  1. sales_map.csv explicit entry (existing behaviour, highest precedence).
//     An entry with an EMPTY employee_id is a DELIBERATE no-PIC marker (e.g. a
//     bot lead source like "Cekat AI") — it short-circuits: the row is NOT
//     counted unresolved and never falls through to the name lookup.
//  2. Fallback: normalized full-name match against `employees.nama`.
//  3. Not found / ambiguous (name shared by >1 employee) -> unresolved. The
//     row still lands with no sales PIC (existing behaviour), but the name is
//     recorded for the distinct-unresolved report so the Sales Head can add an
//     override to sales_map.csv instead of the information being silently
//     dropped.
//
// This file is pure/DB-read-only glue for the CLI layer: it does not touch
// module1_leads (ownership boundary, docs/handoff/WAVE1_PARALLEL_PLAN.md).

import (
	"context"
	"database/sql"
	"sort"
	"strings"
)

// EmployeeNameIndex resolves a normalized full name to an employee_id. A name
// held by more than one employee is ambiguous and must NOT be auto-resolved.
type EmployeeNameIndex struct {
	byName map[string]string // normalized full name -> employee_id (unique names only)
	ambig  map[string]bool   // normalized full name -> true (>1 employee shares it)
}

// normalizeSalesName trims, collapses internal whitespace runs and
// lowercases — so "  Budi   Santoso" / "budi santoso" / "BUDI SANTOSO" all
// match the same employees.nama value. Reuses the same collapsing rule as
// normKey (header matching) for consistency, but is kept as its own named
// function since it normalizes PERSON names, not header labels.
func normalizeSalesName(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(s)), " ")
}

// NewEmployeeNameIndex builds the index from (employee_id, nama) pairs. Pure
// and DB-agnostic so it is fully unit-testable without a database.
func NewEmployeeNameIndex(employees []EmployeeRef) *EmployeeNameIndex {
	idx := &EmployeeNameIndex{byName: map[string]string{}, ambig: map[string]bool{}}
	seen := map[string]bool{}
	for _, e := range employees {
		key := normalizeSalesName(e.Nama)
		if key == "" {
			continue
		}
		if seen[key] {
			idx.ambig[key] = true
			delete(idx.byName, key) // never auto-resolve an ambiguous name
			continue
		}
		seen[key] = true
		idx.byName[key] = e.EmployeeID
	}
	return idx
}

// Resolve looks up a raw sales name (as it appears in the source sheet).
// Returns (employeeID, true) on a unique match; ("", false) when not found or
// ambiguous. Use Ambiguous to tell the two "false" cases apart for reporting.
func (idx *EmployeeNameIndex) Resolve(rawName string) (string, bool) {
	if idx == nil {
		return "", false
	}
	key := normalizeSalesName(rawName)
	if key == "" {
		return "", false
	}
	id, ok := idx.byName[key]
	return id, ok
}

// Ambiguous reports whether rawName matches more than one employee (so it was
// deliberately withheld from Resolve rather than simply absent).
func (idx *EmployeeNameIndex) Ambiguous(rawName string) bool {
	if idx == nil {
		return false
	}
	return idx.ambig[normalizeSalesName(rawName)]
}

// EmployeeRef is the minimal (employee_id, nama) pair needed to build the
// index — kept separate from any richer employee struct so this package does
// not need to depend on one.
type EmployeeRef struct {
	EmployeeID string
	Nama       string
}

// LoadEmployeeNameIndex reads every employee's (employee_id, nama) from the DB
// and builds the resolution index. Includes inactive employees deliberately:
// historical leads may reference a salesperson who has since left, and the
// import is a one-time backfill of past attribution, not a live grant of
// access.
func LoadEmployeeNameIndex(ctx context.Context, db *sql.DB) (*EmployeeNameIndex, error) {
	rows, err := db.QueryContext(ctx, `SELECT employee_id, nama FROM employees`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var refs []EmployeeRef
	for rows.Next() {
		var r EmployeeRef
		if err := rows.Scan(&r.EmployeeID, &r.Nama); err != nil {
			return nil, err
		}
		refs = append(refs, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return NewEmployeeNameIndex(refs), nil
}

// UnresolvedSalesReport is the reporting counterpart to SalesUnresolved: the
// DISTINCT raw names that did not resolve, so the operator can see exactly
// which names need a sales_map.csv override instead of only a count.
type UnresolvedSalesReport struct {
	Name      string // raw name as seen in the source sheet
	Ambiguous bool   // true: matched >1 employee; false: no match at all
	Count     int    // number of rows carrying this name
}

// unresolvedSalesTracker accumulates distinct unresolved names during a parse
// pass, preserving first-seen order for a stable, readable report.
type unresolvedSalesTracker struct {
	order []string
	seen  map[string]*UnresolvedSalesReport
}

func newUnresolvedSalesTracker() *unresolvedSalesTracker {
	return &unresolvedSalesTracker{seen: map[string]*UnresolvedSalesReport{}}
}

func (u *unresolvedSalesTracker) add(rawName string, ambiguous bool) {
	name := strings.TrimSpace(rawName)
	if name == "" {
		return
	}
	if rep, ok := u.seen[name]; ok {
		rep.Count++
		return
	}
	rep := &UnresolvedSalesReport{Name: name, Ambiguous: ambiguous, Count: 1}
	u.seen[name] = rep
	u.order = append(u.order, name)
}

// report returns the distinct unresolved names sorted alphabetically
// (case-insensitive) for stable, deterministic CLI output.
func (u *unresolvedSalesTracker) report() []UnresolvedSalesReport {
	out := make([]UnresolvedSalesReport, 0, len(u.order))
	for _, name := range u.order {
		out = append(out, *u.seen[name])
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out
}
