package main

// CSV parsing for the two role-mapping-riil seed files (backend/seed/):
// role_mappings_riil.csv (divisi,jabatan,division,level — 23 real HRIS rows,
// DECISIONS.md 2026-07-17 batch-1) and layered_roles_riil.csv (employee_id,role).
// Neither file carries a header row (decision: header/comments not required —
// the companion doc is authoritative), so every line is a data row. Pure
// file-level parsing only: no DB, no field-value validation (that is
// RoleMappingRow.Validate / LayeredRoleRow.Validate in validate.go).

import (
	"encoding/csv"
	"fmt"
	"io"
)

// RoleMappingRow is one raw row from role_mappings_riil.csv plus its 1-based
// line number (no header, so line 1 is the first data row) for error
// reporting.
type RoleMappingRow struct {
	Line     int
	Divisi   string
	Jabatan  string
	Division string
	Level    string
}

// LayeredRoleRow is one raw row from layered_roles_riil.csv plus its 1-based
// line number.
type LayeredRoleRow struct {
	Line       int
	EmployeeID string
	Role       string
}

// ParseRoleMappingCSV reads role_mappings_riil.csv: 4 columns per row
// (divisi,jabatan,division,level), no header.
func ParseRoleMappingCSV(r io.Reader) ([]RoleMappingRow, error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1
	cr.TrimLeadingSpace = true

	var rows []RoleMappingRow
	line := 0
	for {
		rec, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("baca baris setelah line %d: %w", line, err)
		}
		line++
		if len(rec) != 4 {
			return nil, fmt.Errorf("baris %d: %d kolom, ingin 4 (divisi,jabatan,division,level)", line, len(rec))
		}
		rows = append(rows, RoleMappingRow{
			Line: line, Divisi: rec[0], Jabatan: rec[1], Division: rec[2], Level: rec[3],
		})
	}
	return rows, nil
}

// ParseLayeredRoleCSV reads layered_roles_riil.csv: 2 columns per row
// (employee_id,role), no header.
func ParseLayeredRoleCSV(r io.Reader) ([]LayeredRoleRow, error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1
	cr.TrimLeadingSpace = true

	var rows []LayeredRoleRow
	line := 0
	for {
		rec, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("baca baris setelah line %d: %w", line, err)
		}
		line++
		if len(rec) != 2 {
			return nil, fmt.Errorf("baris %d: %d kolom, ingin 2 (employee_id,role)", line, len(rec))
		}
		rows = append(rows, LayeredRoleRow{Line: line, EmployeeID: rec[0], Role: rec[1]})
	}
	return rows, nil
}
