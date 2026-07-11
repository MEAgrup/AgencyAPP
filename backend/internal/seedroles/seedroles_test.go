package seedroles_test

// Pure unit tests for internal/seedroles (policy parsing, level heuristic,
// plan building). No DB. All fixtures are synthetic (no real employee
// names/NIKs — PII).

import (
	"errors"
	"strings"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/hris"
	"github.com/meagrup/agencyapp/backend/internal/seedroles"
)

const validPolicyCSV = `department,policy,division
SALES,map,Sales
ACCOUNT,map,Account
CREATIVE,map,Creative
ADVERTISER,map,Ads
AFFILIATE,map,KOL
GROWTH & BUSINESS CONSULTATION,map,Account
FINANCE AND ACCOUNTING,map,Finance
MCN,exclude,
CREATIVE - EKSTERNAL,exclude,
BUSINESS DEVELOPMENT,no-access,
IT,no-access,
HRGA,no-access,
SKILSKUL,no-access,
TIKTOK GO,no-access,
DATA & BUSINESS INTELLIGENCE,no-access,
OD,no-access,
`

func TestParsePolicyCSV_ValidFile(t *testing.T) {
	policy, err := seedroles.ParsePolicyCSV(strings.NewReader(validPolicyCSV))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(policy) != 16 {
		t.Fatalf("len(policy)=%d want 16", len(policy))
	}
	p, ok := policy["SALES"]
	if !ok || p.Policy != seedroles.PolicyMap || p.Division != "Sales" {
		t.Fatalf("SALES policy unexpected: %+v ok=%v", p, ok)
	}
	// Case-insensitive, trimmed lookup.
	p2, ok := policy[hris.NormalizeDept(" mcn ")]
	if !ok || p2.Policy != seedroles.PolicyExclude {
		t.Fatalf("MCN lookup via normalized key failed: %+v ok=%v", p2, ok)
	}
	p3, ok := policy[hris.NormalizeDept("Growth & Business Consultation")]
	if !ok || p3.Division != "Account" {
		t.Fatalf("GROWTH & BUSINESS CONSULTATION policy unexpected: %+v ok=%v", p3, ok)
	}
}

func TestParsePolicyCSV_MapWithoutDivisionErrors(t *testing.T) {
	in := "department,policy,division\nSALES,map,\n"
	if _, err := seedroles.ParsePolicyCSV(strings.NewReader(in)); err == nil {
		t.Fatal("expected error for policy=map with empty division")
	}
}

func TestParsePolicyCSV_ExcludeWithDivisionErrors(t *testing.T) {
	in := "department,policy,division\nMCN,exclude,Sales\n"
	if _, err := seedroles.ParsePolicyCSV(strings.NewReader(in)); err == nil {
		t.Fatal("expected error for policy=exclude with a division set")
	}
}

func TestParsePolicyCSV_UnknownPolicyErrors(t *testing.T) {
	in := "department,policy,division\nSALES,maybe,Sales\n"
	if _, err := seedroles.ParsePolicyCSV(strings.NewReader(in)); err == nil {
		t.Fatal("expected error for unknown policy value")
	}
}

func TestParsePolicyCSV_DuplicateDepartmentErrors(t *testing.T) {
	in := "department,policy,division\nSALES,map,Sales\nSales,map,Sales\n"
	if _, err := seedroles.ParsePolicyCSV(strings.NewReader(in)); err == nil {
		t.Fatal("expected error for duplicate (case-insensitive) department entry")
	}
}

func TestLevel_HeuristicKeywords(t *testing.T) {
	// Exact keyword list per docs/handoff/HRIS_ROLE_MAPPING_DRAFT.md §2: JABATAN
	// containing (case-insensitive) HEAD OF / SPV / SUPERVISOR / LEADER / LEAD
	// => lead, else staff. This is a deliberately crude heuristic — the same
	// doc calls out "Sales Head" (no "OF") as exactly the kind of edge case it
	// will miss and that needs manual review, not a code fix (see §6).
	cases := map[string]string{
		"Sales Executive":     "staff",
		"Sales Head":          "staff", // known heuristic miss, per draft §2/§6 — not "HEAD OF"
		"Account Manager":     "staff",
		"Account SPV":         "lead",
		"Creative Supervisor": "lead",
		"Team Leader":         "lead",
		"Lead Designer":       "lead",
		"HEAD OF SALES":       "lead",
		"head of sales":       "lead", // case-insensitive
		"Staff Biasa":         "staff",
	}
	for jabatan, want := range cases {
		if got := seedroles.Level(jabatan); got != want {
			t.Errorf("Level(%q)=%q want %q", jabatan, got, want)
		}
	}
}

func TestBuildPlan_MapsGroupsAndCounts(t *testing.T) {
	policy, err := seedroles.ParsePolicyCSV(strings.NewReader(validPolicyCSV))
	if err != nil {
		t.Fatal(err)
	}
	employees := []hris.Employee{
		{EmployeeID: "1", Divisi: "SALES", Jabatan: "Sales Executive"},
		{EmployeeID: "2", Divisi: "SALES", Jabatan: "Sales Executive"},
		{EmployeeID: "3", Divisi: "SALES", Jabatan: "Sales Team Leader"},
		{EmployeeID: "4", Divisi: "ADVERTISER", Jabatan: "Ads Specialist"},
		{EmployeeID: "5", Divisi: "AFFILIATE", Jabatan: "KOL Staff"},
		{EmployeeID: "6", Divisi: "GROWTH & BUSINESS CONSULTATION", Jabatan: "Consultant"},
		{EmployeeID: "7", Divisi: "IT", Jabatan: "IT Support"},
		{EmployeeID: "8", Divisi: "HRGA", Jabatan: "HR Staff"},
	}
	plan, err := seedroles.BuildPlan(employees, policy)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(plan.Mappings) != 5 {
		t.Fatalf("len(plan.Mappings)=%d want 5: %+v", len(plan.Mappings), plan.Mappings)
	}
	// Sorted by Divisi then Jabatan: ADVERTISER, AFFILIATE, GROWTH..., SALES(x2 distinct jabatan)
	first := plan.Mappings[0]
	if first.Divisi != "ADVERTISER" || first.Division != "Ads" || first.Level != "staff" {
		t.Errorf("Mappings[0]=%+v unexpected", first)
	}
	var salesExec, salesLead seedroles.PlannedMapping
	for _, m := range plan.Mappings {
		if m.Divisi == "SALES" && m.Jabatan == "Sales Executive" {
			salesExec = m
		}
		if m.Divisi == "SALES" && m.Jabatan == "Sales Team Leader" {
			salesLead = m
		}
	}
	if salesExec.Count != 2 || salesExec.Level != "staff" || salesExec.Division != "Sales" {
		t.Errorf("Sales Executive mapping unexpected: %+v", salesExec)
	}
	if salesLead.Count != 1 || salesLead.Level != "lead" || salesLead.Division != "Sales" {
		t.Errorf("Sales Team Leader mapping unexpected: %+v", salesLead)
	}

	if len(plan.NoAccessGroups) != 2 {
		t.Fatalf("len(plan.NoAccessGroups)=%d want 2: %+v", len(plan.NoAccessGroups), plan.NoAccessGroups)
	}
	if plan.NoAccessGroups[0].Department != "HRGA" || plan.NoAccessGroups[1].Department != "IT" {
		t.Errorf("NoAccessGroups unexpected order/content: %+v", plan.NoAccessGroups)
	}
	if len(plan.ExcludedFound) != 0 {
		t.Errorf("expected no excluded-found warnings, got: %+v", plan.ExcludedFound)
	}
}

func TestBuildPlan_UnknownDepartmentIsHardError(t *testing.T) {
	policy, err := seedroles.ParsePolicyCSV(strings.NewReader(validPolicyCSV))
	if err != nil {
		t.Fatal(err)
	}
	employees := []hris.Employee{
		{EmployeeID: "1", Divisi: "MYSTERY DEPT", Jabatan: "Something"},
	}
	_, err = seedroles.BuildPlan(employees, policy)
	if err == nil {
		t.Fatal("expected UnknownDepartmentError for a department absent from the policy file")
	}
	var uderr *seedroles.UnknownDepartmentError
	if !errors.As(err, &uderr) {
		t.Fatalf("expected *UnknownDepartmentError, got %T: %v", err, err)
	}
	if len(uderr.Departments) != 1 || uderr.Departments[0] != "MYSTERY DEPT" {
		t.Fatalf("unexpected departments: %+v", uderr.Departments)
	}
}

func TestBuildPlan_ExcludePolicyStillPresentIsWarnedNotDropped(t *testing.T) {
	policy, err := seedroles.ParsePolicyCSV(strings.NewReader(validPolicyCSV))
	if err != nil {
		t.Fatal(err)
	}
	employees := []hris.Employee{
		{EmployeeID: "1", Divisi: "MCN", Jabatan: "Staff MCN"},
		{EmployeeID: "2", Divisi: "SALES", Jabatan: "Sales Executive"},
	}
	plan, err := seedroles.BuildPlan(employees, policy)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(plan.ExcludedFound) != 1 || plan.ExcludedFound[0].Department != "MCN" || plan.ExcludedFound[0].Count != 1 {
		t.Fatalf("expected MCN warned once, got: %+v", plan.ExcludedFound)
	}
	// MCN must NOT produce a role_mappings entry.
	for _, m := range plan.Mappings {
		if m.Divisi == "MCN" {
			t.Fatalf("MCN must not produce a role_mappings entry, got: %+v", m)
		}
	}
}

func TestParseLayeredCSV(t *testing.T) {
	in := "employee_id,role\nEMP-0001,od\nEMP-0002,director\n"
	got, err := seedroles.ParseLayeredCSV(strings.NewReader(in))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("len(got)=%d want 2", len(got))
	}
	if got[0].EmployeeID != "EMP-0001" || got[0].Role != "od" {
		t.Errorf("got[0]=%+v unexpected", got[0])
	}
	if got[1].EmployeeID != "EMP-0002" || got[1].Role != "director" {
		t.Errorf("got[1]=%+v unexpected", got[1])
	}
}

func TestParseLayeredCSV_InvalidRoleErrors(t *testing.T) {
	in := "employee_id,role\nEMP-0001,manager\n"
	if _, err := seedroles.ParseLayeredCSV(strings.NewReader(in)); err == nil {
		t.Fatal("expected error for invalid role")
	}
}
