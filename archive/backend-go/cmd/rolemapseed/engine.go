package main

// Execute is the DB-touching half of rolemapseed: given already-parsed rows
// it (1) validates every row (format-level, via RoleMappingRow.ToRoleMapping /
// LayeredRoleRow.Validate) and every layered-role employee_id against the
// `employees` table, aborting before touching the DB if anything fails, then
// (2) either prints the plan (dry-run) or executes it through
// admin.UpsertRoleMapping / admin.SetLayeredRole (apply — both are
// idempotent upserts that write their own audit rows, per internal/admin).
//
// There is no separate "create vs update" distinction to report (unlike
// mslseed's MSL versions): UpsertRoleMapping/SetLayeredRole are plain
// upserts, so every valid row is simply "mapped"/"layered" whether it is the
// first run or the tenth.

import (
	"context"
	"database/sql"
	"fmt"
	"io"

	"github.com/meagrup/agencyapp/backend/internal/admin"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// Report tallies the outcome of one Execute run (dry-run or apply).
type Report struct {
	RoleMappings int
	LayeredRoles int
	Errors       int
}

// Execute validates roleRows and layeredRows against d, and — iff apply —
// writes through admin.UpsertRoleMapping / admin.SetLayeredRole. Progress and
// the final plan are written to out. A non-nil error means: a row-validation
// failure (checked first, nothing touched), an unknown layered-role
// employee_id (checked next, still nothing touched), a DB error, or at least
// one write failure during apply.
func Execute(ctx context.Context, d *sql.DB, actor permission.Actor, roleRows []RoleMappingRow, layeredRows []LayeredRoleRow, apply bool, out io.Writer) (Report, error) {
	var rep Report

	// Phase 1 — validate every row before touching the DB at all.
	type roleItem struct {
		row RoleMappingRow
		m   admin.RoleMapping
	}
	roleItems := make([]roleItem, 0, len(roleRows))
	badRows := 0
	for _, row := range roleRows {
		m, err := row.ToRoleMapping()
		if err != nil {
			badRows++
			fmt.Fprintf(out, "ERROR %v\n", err)
			continue
		}
		roleItems = append(roleItems, roleItem{row: row, m: m})
	}

	type layeredItem struct {
		row        LayeredRoleRow
		employeeID string
		role       string
	}
	layeredItems := make([]layeredItem, 0, len(layeredRows))
	for _, row := range layeredRows {
		employeeID, role, err := row.Validate()
		if err != nil {
			badRows++
			fmt.Fprintf(out, "ERROR %v\n", err)
			continue
		}
		layeredItems = append(layeredItems, layeredItem{row: row, employeeID: employeeID, role: role})
	}

	if badRows > 0 {
		rep.Errors = badRows
		return rep, fmt.Errorf("validasi CSV gagal: %d baris tidak valid — dibatalkan sebelum menyentuh DB", badRows)
	}

	// Phase 1b — every layered-role employee_id must already exist in
	// `employees` (read-only check; still no writes yet).
	missing := 0
	for _, it := range layeredItems {
		var exists int
		if err := d.QueryRowContext(ctx, `SELECT 1 FROM employees WHERE employee_id = ?`, it.employeeID).Scan(&exists); err != nil {
			if err == sql.ErrNoRows {
				missing++
				fmt.Fprintf(out, "ERROR layered_roles_riil.csv baris %d (%s): employee_id tidak ditemukan di tabel employees — sync employees dulu (lihat employees_cdps.csv)\n",
					it.row.Line, it.employeeID)
				continue
			}
			return rep, fmt.Errorf("baris %d (%s): cek employees: %w", it.row.Line, it.employeeID, err)
		}
	}
	if missing > 0 {
		rep.Errors = missing
		return rep, fmt.Errorf("validasi layered role gagal: %d employee_id tidak ada di tabel employees — dibatalkan sebelum menyentuh DB", missing)
	}

	// Phase 2 — report the plan, and (iff apply) execute it.
	mode := "dry-run"
	if apply {
		mode = "apply"
	}

	for _, it := range roleItems {
		if !apply {
			rep.RoleMappings++
			fmt.Fprintf(out, "[DRY-RUN] akan upsert role_mapping baris %d: %s / %s -> division=%s level=%s\n",
				it.row.Line, it.m.Divisi, it.m.Jabatan, it.m.Division, it.m.Level)
			continue
		}
		if _, err := admin.UpsertRoleMapping(ctx, d, actor, it.m); err != nil {
			rep.Errors++
			fmt.Fprintf(out, "ERROR baris %d (%s/%s) upsert role_mapping: %v\n", it.row.Line, it.m.Divisi, it.m.Jabatan, err)
			continue
		}
		rep.RoleMappings++
		fmt.Fprintf(out, "role_mapping   baris %d: %s / %s -> division=%s level=%s\n",
			it.row.Line, it.m.Divisi, it.m.Jabatan, it.m.Division, it.m.Level)
	}

	for _, it := range layeredItems {
		if !apply {
			rep.LayeredRoles++
			fmt.Fprintf(out, "[DRY-RUN] akan set layered_role baris %d: employee_id=%s role=%s enabled=true\n",
				it.row.Line, it.employeeID, it.role)
			continue
		}
		if err := admin.SetLayeredRole(ctx, d, actor, it.employeeID, it.role, true); err != nil {
			rep.Errors++
			fmt.Fprintf(out, "ERROR baris %d (%s) set layered_role: %v\n", it.row.Line, it.employeeID, err)
			continue
		}
		rep.LayeredRoles++
		fmt.Fprintf(out, "layered_role   baris %d: employee_id=%s role=%s enabled=true\n", it.row.Line, it.employeeID, it.role)
	}

	fmt.Fprintf(out, "\nringkasan (%s): role_mappings=%d layered_roles=%d error=%d\n",
		mode, rep.RoleMappings, rep.LayeredRoles, rep.Errors)

	if rep.Errors > 0 {
		return rep, fmt.Errorf("%d error saat %s", rep.Errors, mode)
	}
	return rep, nil
}
