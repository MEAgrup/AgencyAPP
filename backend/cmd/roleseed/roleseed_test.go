package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/admin"
	"github.com/meagrup/agencyapp/backend/internal/hris"
)

// TestLoadMappingsRealCSV locks the canonical decision artifact: 38 pairs,
// zero issues, and the decided cross-division rows (DECISIONS 2026-07-17).
func TestLoadMappingsRealCSV(t *testing.T) {
	f, err := os.Open(filepath.Join("..", "..", "seed", "role_mappings_riil.csv"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	ms, issues, err := LoadMappings(f)
	if err != nil {
		t.Fatal(err)
	}
	if len(issues) != 0 {
		t.Fatalf("issues: %+v", issues)
	}
	if len(ms) != 38 {
		t.Fatalf("got %d mappings, want 38", len(ms))
	}
	find := func(divisi, jabatan string) admin.RoleMapping {
		for _, m := range ms {
			if m.Divisi == divisi && m.Jabatan == jabatan {
				return m
			}
		}
		t.Fatalf("pair %s|%s not found", divisi, jabatan)
		return admin.RoleMapping{}
	}
	if m := find("ACCOUNT", "ADVERTISER"); m.Division != "Ads" || m.Level != "staff" {
		t.Fatalf("ACCOUNT|ADVERTISER = %s/%s, want Ads/staff", m.Division, m.Level)
	}
	if m := find("ACCOUNT", "KOL SPECIALIST"); m.Division != "KOL" {
		t.Fatalf("ACCOUNT|KOL SPECIALIST = %s, want KOL", m.Division)
	}
	if m := find("SALES", "CUSTOMER RELATION OFFICER"); m.Division != "Sales" {
		t.Fatalf("SALES|CUSTOMER RELATION OFFICER = %s, want Sales (O28a: semua sales)", m.Division)
	}
	if m := find("SALES", "HEAD OF SALES JASA"); m.Level != "lead" {
		t.Fatalf("HEAD OF SALES JASA level = %s, want lead", m.Level)
	}
	// The comma-in-jabatan row must survive CSV quoting intact.
	if m := find("FINANCE AND ACCOUNTING", "SENIOR FINANCE, ACCOUNTING & TAX"); m.Division != "Finance" {
		t.Fatalf("quoted jabatan row = %s, want Finance", m.Division)
	}
	// No mapped division outside the wired six.
	for _, m := range ms {
		if !validDivisions[m.Division] {
			t.Fatalf("row %s|%s has invalid division %q", m.Divisi, m.Jabatan, m.Division)
		}
	}
}

func TestLoadMappingsIssues(t *testing.T) {
	in := "divisi,jabatan,division,level\n" +
		"SALES,SALES JASA,Sales,staff\n" +
		"SALES,SALES JASA,Sales,lead\n" + // duplicate pair
		"ACCOUNT,ADMIN,Akun,staff\n" + // unknown division
		"ACCOUNT,CRO,Account,manager\n" + // unknown level
		"ACCOUNT,,Account,staff\n" // empty field
	_, issues, err := LoadMappings(strings.NewReader(in))
	if err != nil {
		t.Fatal(err)
	}
	if len(issues) != 4 {
		t.Fatalf("got %d issues, want 4: %+v", len(issues), issues)
	}
	wantSub := []string{"duplikat", "division \"Akun\"", "level \"manager\"", "field kosong"}
	for i, sub := range wantSub {
		if !strings.Contains(issues[i].Detail, sub) {
			t.Fatalf("issue %d = %q, want substring %q", i, issues[i].Detail, sub)
		}
	}
}

func TestLoadMappingsBadHeader(t *testing.T) {
	if _, _, err := LoadMappings(strings.NewReader("a,b,c,d\nSALES,X,Sales,staff\n")); err == nil {
		t.Fatal("want header error, got nil")
	}
	if _, _, err := LoadMappings(strings.NewReader("")); err == nil {
		t.Fatal("want empty-file error, got nil")
	}
}

func TestPlanMappings(t *testing.T) {
	existing := []admin.RoleMapping{
		{Divisi: "SALES", Jabatan: "SALES JASA", Division: "Sales", Level: "staff"},
		{Divisi: "Sales", Jabatan: "Head Of Sales Jasa", Division: "Sales", Level: "staff"}, // differs by case + level
	}
	desired := []admin.RoleMapping{
		{Divisi: "SALES", Jabatan: "SALES JASA", Division: "Sales", Level: "staff"},
		{Divisi: "SALES", Jabatan: "HEAD OF SALES JASA", Division: "Sales", Level: "lead"},
		{Divisi: "ACCOUNT", Jabatan: "ADVERTISER", Division: "Ads", Level: "staff"},
	}
	plan := PlanMappings(existing, desired)
	got := []string{plan[0].Action, plan[1].Action, plan[2].Action}
	want := []string{"SAMA", "UPDATE", "CREATE"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("plan[%d] = %s, want %s (full: %+v)", i, got[i], want[i], plan)
		}
	}
	if !strings.Contains(plan[1].Note, "Sales/staff") {
		t.Fatalf("UPDATE note = %q, want old value Sales/staff", plan[1].Note)
	}
}

func TestSplitNIKList(t *testing.T) {
	got := SplitNIKList(" 2501140493, 2607060683 ,,")
	if len(got) != 2 || got[0] != "2501140493" || got[1] != "2607060683" {
		t.Fatalf("got %v", got)
	}
	if SplitNIKList("") != nil {
		t.Fatal("empty list should be nil")
	}
}

func TestFilteredSource(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "emp.csv")
	csv := "employee_id,nama,email,divisi,jabatan,status_aktif\n" +
		"1111111111,A,a@x.com,SALES,SALES JASA,true\n" +
		"2222222222,B,b@x.com,CREATIVE - EKSTERNAL,GRAPHIC DESIGNER,true\n" +
		"3333333333,C,c@x.com,ACCOUNT,ADVERTISER,true\n"
	if err := os.WriteFile(path, []byte(csv), 0o644); err != nil {
		t.Fatal(err)
	}
	src := &FilteredSource{Src: hris.NewCSVSource(path), Exclude: map[string]bool{"2222222222": true, "9999999999": true}}
	emps, err := src.Fetch(context.Background(), time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	if len(emps) != 2 || emps[0].EmployeeID != "1111111111" || emps[1].EmployeeID != "3333333333" {
		t.Fatalf("got %+v", emps)
	}
	if seen := src.ExcludedSeen(); len(seen) != 1 || seen[0] != "2222222222" {
		t.Fatalf("ExcludedSeen = %v", seen)
	}
	if miss := src.ExcludedNotSeen(); len(miss) != 1 || miss[0] != "9999999999" {
		t.Fatalf("ExcludedNotSeen = %v (typo guard must surface unmatched NIK)", miss)
	}
}
