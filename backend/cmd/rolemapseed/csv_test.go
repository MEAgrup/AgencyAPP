package main

// Pure CSV parse/validation tests — no DB, no network.

import (
	"os"
	"strings"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/admin"
)

func TestParseRoleMappingCSV_RealSeedFile(t *testing.T) {
	// The real seed file must always parse cleanly: 43 rows, no error, and every
	// row must validate (the real file is the contract — go-live roster V2,
	// docs/handoff/GOLIVE_ROSTER_V2_IMPORT.md: 43 mapping rows, superseding the
	// 23-row batch-1 of DECISIONS.md 2026-07-17).
	f, err := os.Open(FindRoleMappingsCSV())
	if err != nil {
		t.Fatalf("open real seed csv: %v", err)
	}
	defer f.Close()
	rows, err := ParseRoleMappingCSV(f)
	if err != nil {
		t.Fatalf("parse real seed csv: %v", err)
	}
	if len(rows) != 43 {
		t.Fatalf("got %d rows, want 43", len(rows))
	}
	for _, r := range rows {
		if _, err := r.ToRoleMapping(); err != nil {
			t.Errorf("row %d (%s/%s) failed validation: %v", r.Line, r.Divisi, r.Jabatan, err)
		}
	}
}

func TestParseRoleMappingCSV_NoLeadForCreativeAdsMarketing(t *testing.T) {
	// DECISIONS.md 2026-07-17 note: this batch has no lead-level mapping for
	// Creative/Ads/Marketing (no SPV yet for those divisions) — reported, not
	// fixed. Lock that expectation.
	f, err := os.Open(FindRoleMappingsCSV())
	if err != nil {
		t.Fatalf("open real seed csv: %v", err)
	}
	defer f.Close()
	rows, err := ParseRoleMappingCSV(f)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	leadDivisions := map[string]bool{}
	for _, r := range rows {
		m, err := r.ToRoleMapping()
		if err != nil {
			t.Fatalf("row %d: %v", r.Line, err)
		}
		if m.Level == "lead" {
			leadDivisions[m.Division] = true
		}
	}
	if !leadDivisions["Sales"] || !leadDivisions["Account"] {
		t.Fatalf("expected lead rows for Sales and Account, got %v", leadDivisions)
	}
	for _, div := range []string{"Creative", "Ads", "Marketing"} {
		if leadDivisions[div] {
			t.Fatalf("division %s unexpectedly has a lead mapping in this batch", div)
		}
	}
}

func TestParseLayeredRoleCSV_RealSeedFile(t *testing.T) {
	f, err := os.Open(FindLayeredRolesCSV())
	if err != nil {
		t.Fatalf("open real seed csv: %v", err)
	}
	defer f.Close()
	rows, err := ParseLayeredRoleCSV(f)
	if err != nil {
		t.Fatalf("parse real seed csv: %v", err)
	}
	// Go-live roster V2 (docs/handoff/GOLIVE_ROSTER_V2_IMPORT.md): 6 layered
	// roles — od for OKFA (HRGA) + 3 OD-dept staff, director for Yohan & Nerissa
	// (resolving Open O26). Every row must validate.
	if len(rows) != 6 {
		t.Fatalf("got %d rows, want 6 (4 od + 2 director)", len(rows))
	}
	got := map[string]string{}
	for _, r := range rows {
		employeeID, role, err := r.Validate()
		if err != nil {
			t.Fatalf("row %d failed validation: %v", r.Line, err)
		}
		got[employeeID] = role
	}
	want := map[string]string{
		"2409230432": "od",       // OKFA (HRGA SUPERVISOR HR)
		"2501140493": "od",       // ARSY (OD)
		"2507250557": "od",       // GHIFARI (OD)
		"2607060683": "od",       // WULAN (OD)
		"200000001":  "director", // Yohan
		"200000002":  "director", // Nerissa
	}
	for id, role := range want {
		if got[id] != role {
			t.Fatalf("employee %s: got role=%q, want %q", id, got[id], role)
		}
	}
}

func TestParseRoleMappingCSV_WrongColumnCount(t *testing.T) {
	bad := "SALES,SALES,Sales\n" // 3 not 4
	if _, err := ParseRoleMappingCSV(strings.NewReader(bad)); err == nil {
		t.Fatal("expected error on short row")
	}
}

func TestParseLayeredRoleCSV_WrongColumnCount(t *testing.T) {
	bad := "2409230432,od,extra\n" // 3 not 2
	if _, err := ParseLayeredRoleCSV(strings.NewReader(bad)); err == nil {
		t.Fatal("expected error on long row")
	}
}

func roleRow(overrides map[string]string) RoleMappingRow {
	r := RoleMappingRow{Line: 1, Divisi: "SALES", Jabatan: "SALES", Division: "Sales", Level: "staff"}
	for k, v := range overrides {
		switch k {
		case "Divisi":
			r.Divisi = v
		case "Jabatan":
			r.Jabatan = v
		case "Division":
			r.Division = v
		case "Level":
			r.Level = v
		}
	}
	return r
}

func TestToRoleMapping_Valid(t *testing.T) {
	m, err := roleRow(nil).ToRoleMapping()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := admin.RoleMapping{Divisi: "SALES", Jabatan: "SALES", Division: "Sales", Level: "staff"}
	if m != want {
		t.Fatalf("got %+v want %+v", m, want)
	}
}

func TestToRoleMapping_DivisiRequired(t *testing.T) {
	if _, err := roleRow(map[string]string{"Divisi": "  "}).ToRoleMapping(); err == nil {
		t.Fatal("expected error")
	}
}

func TestToRoleMapping_JabatanRequired(t *testing.T) {
	if _, err := roleRow(map[string]string{"Jabatan": ""}).ToRoleMapping(); err == nil {
		t.Fatal("expected error")
	}
}

func TestToRoleMapping_DivisionRequired(t *testing.T) {
	if _, err := roleRow(map[string]string{"Division": ""}).ToRoleMapping(); err == nil {
		t.Fatal("expected error")
	}
}

func TestToRoleMapping_LevelMustBeStaffOrLead(t *testing.T) {
	for _, bad := range []string{"", "STAFF", "manager", "0"} {
		if _, err := roleRow(map[string]string{"Level": bad}).ToRoleMapping(); err == nil {
			t.Fatalf("level=%q: expected error", bad)
		}
	}
	if _, err := roleRow(map[string]string{"Level": "lead"}).ToRoleMapping(); err != nil {
		t.Fatalf("level=lead: unexpected error: %v", err)
	}
}

func layeredRow(overrides map[string]string) LayeredRoleRow {
	r := LayeredRoleRow{Line: 1, EmployeeID: "2409230432", Role: "od"}
	for k, v := range overrides {
		switch k {
		case "EmployeeID":
			r.EmployeeID = v
		case "Role":
			r.Role = v
		}
	}
	return r
}

func TestLayeredRoleRow_Valid(t *testing.T) {
	employeeID, role, err := layeredRow(nil).Validate()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if employeeID != "2409230432" || role != "od" {
		t.Fatalf("got %q/%q", employeeID, role)
	}
}

func TestLayeredRoleRow_EmployeeIDRequired(t *testing.T) {
	if _, _, err := layeredRow(map[string]string{"EmployeeID": "  "}).Validate(); err == nil {
		t.Fatal("expected error")
	}
}

func TestLayeredRoleRow_RoleMustBeODOrDirector(t *testing.T) {
	for _, bad := range []string{"", "OD", "admin", "staff"} {
		if _, _, err := layeredRow(map[string]string{"Role": bad}).Validate(); err == nil {
			t.Fatalf("role=%q: expected error", bad)
		}
	}
	if _, _, err := layeredRow(map[string]string{"Role": "director"}).Validate(); err != nil {
		t.Fatalf("role=director: unexpected error: %v", err)
	}
}
