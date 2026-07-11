package sales_test

// W1-07/08 integration tests — Negotiation (M0 §5) against a real DB, real
// Master Service List, real statemachine engine: non-nego path (Auto
// Approved + custom-term gate), full versioned flow (submit / approve /
// counter / accept / resubmit / reject), money re-evaluation, permission
// matrix, append-only history, and notification recipients per the O15
// catalog.

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/events"
	"github.com/meagrup/agencyapp/backend/internal/core/ids"
	"github.com/meagrup/agencyapp/backend/internal/core/msg"
	"github.com/meagrup/agencyapp/backend/internal/core/notify"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/core/testdb"
	"github.com/meagrup/agencyapp/backend/internal/module0_sales"
)

// qualifiedProspect drives an attempt to `Qualified` with the Alpha Digital
// worked-example form (services svc[0..2] pinned as the negotiation
// baseline) and returns its id.
func qualifiedProspect(t *testing.T, conn *sql.DB, s *sales.Attempts, owner authz.Identity, leadID string, svc []int64) string {
	t.Helper()
	ctx := context.Background()
	id := contactedAttempt(t, conn, s, owner, leadID)
	if _, err := s.SubmitQualifiedForm(ctx, conn, owner, id, validQualifiedInput(svc[0], svc[1], svc[2])); err != nil {
		t.Fatalf("submit qualified form: %v", err)
	}
	return id
}

func strp(s string) *string { return &s }

func countNegotiationRows(t *testing.T, conn *sql.DB, prospectID string) (headers, versions, services, decisions int) {
	t.Helper()
	queries := []struct {
		dst *int
		sql string
	}{
		{&headers, `SELECT COUNT(*) FROM negotiations WHERE prospect_id = ?`},
		{&versions, `SELECT COUNT(*) FROM negotiation_versions WHERE prospect_id = ?`},
		{&services, `SELECT COUNT(*) FROM negotiation_version_services nvs JOIN negotiation_versions nv ON nv.id = nvs.negotiation_version_id WHERE nv.prospect_id = ?`},
		{&decisions, `SELECT COUNT(*) FROM negotiation_decisions WHERE prospect_id = ?`},
	}
	for _, q := range queries {
		if err := conn.QueryRow(q.sql, prospectID).Scan(q.dst); err != nil {
			t.Fatalf("count negotiation rows: %v", err)
		}
	}
	return
}

// ---- W1-07 · non-negotiation path -------------------------------------------

// TestNoNegotiation_AutoApproved reproduces the worked example on the
// non-nego door: standard terms for the 3 Alpha Digital services →
// `Negotiation - Auto Approved`, version 1 approved immediately, totals
// identical to the Qualified form's auto-computed money.
func TestNoNegotiation_AutoApproved(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	id := qualifiedProspect(t, conn, s, budi, "LEAD-202607-5001", svc)

	neg, err := s.SubmitNoNegotiation(ctx, conn, budi, id, sales.NoNegotiationInput{
		Services: []sales.NoNegotiationServiceInput{
			{EntryID: svc[0], Price: strp("9000000")}, // echo without decimals still equals the standard
			{EntryID: svc[1]},
			{EntryID: svc[2]},
		},
	})
	if err != nil {
		t.Fatalf("SubmitNoNegotiation: %v", err)
	}

	if got := rawStatus(t, conn, id); got != string(statemachine.ProspectNegAutoApproved) {
		t.Errorf("status = %q, want Negotiation - Auto Approved", got)
	}
	if neg.NegotiationRequired {
		t.Error("NegotiationRequired = true on the non-nego path")
	}
	if neg.ApprovedVersion == nil || *neg.ApprovedVersion != 1 || neg.CurrentVersion != 1 {
		t.Fatalf("version pointers = %+v, want approved=current=1", neg)
	}
	appr := neg.Approved()
	if appr == nil || appr.Kind != sales.NegotiationKindStandard {
		t.Fatalf("approved version = %+v, want kind 'standard'", appr)
	}
	// Standard terms: Σ standard prices / commissions — same numbers as the
	// Qualified form (M0 §4 example): Rp. 21.900.000,00 / Rp. 2.262.500,00.
	if appr.TotalValue != "21900000.00" || appr.TotalValueIDR() != "Rp. 21.900.000,00" {
		t.Errorf("total value = %q (%q)", appr.TotalValue, appr.TotalValueIDR())
	}
	if appr.CommissionPending || appr.TotalKomisi == nil || *appr.TotalKomisi != "2262500.00" {
		t.Errorf("total komisi = %v pending=%v, want 2262500.00", appr.TotalKomisi, appr.CommissionPending)
	}
	for _, sv := range appr.Services {
		if sv.ProposedPrice != sv.StandardPrice {
			t.Errorf("service %d proposed %q != standard %q on the non-nego path", sv.EntryID, sv.ProposedPrice, sv.StandardPrice)
		}
		if sv.PaymentTerms != nil {
			t.Errorf("service %d has payment terms on the non-nego path", sv.EntryID)
		}
	}
}

// TestNoNegotiation_DeselectAndAdditional exercises the confirmation
// screen's two levers (M0 §5 non-nego flow step 1): deselecting previously
// selected services and adding a new one from the Master Service List (which
// resolves via EffectiveAt, not the Qualified form pin).
func TestNoNegotiation_DeselectAndAdditional(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	id := qualifiedProspect(t, conn, s, budi, "LEAD-202607-5002", svc)

	neg, err := s.SubmitNoNegotiation(ctx, conn, budi, id, sales.NoNegotiationInput{
		Services: []sales.NoNegotiationServiceInput{
			{EntryID: svc[0]}, // kept from the form
			{EntryID: svc[3]}, // additional: Jasa Iklan Basic, 1jt, 5%
		},
	})
	if err != nil {
		t.Fatalf("SubmitNoNegotiation: %v", err)
	}
	appr := neg.Approved()
	if appr.TotalValue != "10000000.00" {
		t.Errorf("total value = %q, want 10000000.00 (9jt + 1jt)", appr.TotalValue)
	}
	// 10%·9jt + 5%·1jt = 900.000 + 50.000
	if appr.TotalKomisi == nil || *appr.TotalKomisi != "950000.00" {
		t.Errorf("total komisi = %v, want 950000.00", appr.TotalKomisi)
	}
	if len(appr.Services) != 2 {
		t.Fatalf("services = %d, want 2", len(appr.Services))
	}
}

// TestNoNegotiation_CustomTermForcesSwitch is the W1-07 AC: any custom term
// on the non-nego door is blocked (prompted to switch to the Negotiation
// flow) with zero side effects.
func TestNoNegotiation_CustomTermForcesSwitch(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	id := qualifiedProspect(t, conn, s, budi, "LEAD-202607-5003", svc)

	cases := []struct {
		name string
		in   sales.NoNegotiationInput
	}{
		{"custom price", sales.NoNegotiationInput{Services: []sales.NoNegotiationServiceInput{{EntryID: svc[0], Price: strp("8500000")}}}},
		{"custom commission", sales.NoNegotiationInput{Services: []sales.NoNegotiationServiceInput{{EntryID: svc[0], CommissionPct: strp("5")}}}},
		{"custom payment terms", sales.NoNegotiationInput{Services: []sales.NoNegotiationServiceInput{{EntryID: svc[0], PaymentTerms: strp("Termin 3x")}}}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := s.SubmitNoNegotiation(ctx, conn, budi, id, c.in)
			if !errors.Is(err, sales.ErrCustomTermRequiresNegotiation) {
				t.Fatalf("err = %v, want ErrCustomTermRequiresNegotiation", err)
			}
		})
	}

	// Zero side effects: still Qualified, no negotiation rows at all.
	if got := rawStatus(t, conn, id); got != string(statemachine.ProspectQualified) {
		t.Errorf("status mutated to %q", got)
	}
	if h, v, sv, d := countNegotiationRows(t, conn, id); h+v+sv+d != 0 {
		t.Errorf("blocked custom term left rows behind: %d/%d/%d/%d", h, v, sv, d)
	}
}

// TestNoNegotiation_OnlyFromQualified: the engine blocks the Auto Approved
// edge from any state but `Qualified`, with the standard BI message and no
// negotiation rows.
func TestNoNegotiation_OnlyFromQualified(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	id := contactedAttempt(t, conn, s, budi, "LEAD-202607-5004") // Contacted, not Qualified

	_, err := s.SubmitNoNegotiation(ctx, conn, budi, id, sales.NoNegotiationInput{
		Services: []sales.NoNegotiationServiceInput{{EntryID: svc[0]}},
	})
	var be *statemachine.BlockedError
	if !errors.As(err, &be) || be.Message != msg.TransisiTidakDiizinkan {
		t.Fatalf("err = %v, want BlockedError with %q", err, msg.TransisiTidakDiizinkan)
	}
	if h, v, sv, d := countNegotiationRows(t, conn, id); h+v+sv+d != 0 {
		t.Errorf("blocked transition left rows: %d/%d/%d/%d", h, v, sv, d)
	}
}

// ---- W1-08 · full flow: submit → approve -------------------------------------

// TestNegotiation_SubmitAndApprove drives the happy path: salesperson
// proposes a discounted price, the Superior approves, terms lock.
func TestNegotiation_SubmitAndApprove(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	nia := spvActor("sales-head-nia")
	id := qualifiedProspect(t, conn, s, budi, "LEAD-202607-5101", svc)

	neg, err := s.SubmitNegotiation(ctx, conn, budi, id, sales.NegotiationInput{
		Services: []sales.NegotiationServiceInput{
			// Discounted price: commission re-evaluated with the SAME standard
			// rule (10%) against the PROPOSED price → 800.000.
			{EntryID: svc[0], ProposedPrice: "8000000", Notes: strp("diskon paket TikTok")},
			// Standard price but negotiated payment terms.
			{EntryID: svc[1], ProposedPrice: "6000000", PaymentTerms: strp("Termin 2x (50/50)")},
		},
	})
	if err != nil {
		t.Fatalf("SubmitNegotiation: %v", err)
	}
	if got := rawStatus(t, conn, id); got != string(statemachine.ProspectNegPendingApprove) {
		t.Fatalf("status = %q, want Pending Approval", got)
	}
	if !neg.NegotiationRequired || neg.CurrentVersion != 1 || neg.ApprovedVersion != nil {
		t.Fatalf("header = %+v, want required, current=1, unapproved", neg)
	}
	v1 := neg.Versions[0]
	if v1.Kind != sales.NegotiationKindProposal || v1.ProposedBy != "sales-budi" {
		t.Fatalf("v1 = %+v", v1)
	}
	if v1.TotalValue != "14000000.00" {
		t.Errorf("total value = %q, want 14000000.00", v1.TotalValue)
	}
	// 10%·8jt + flat 500rb = 800.000 + 500.000.
	if v1.TotalKomisi == nil || *v1.TotalKomisi != "1300000.00" {
		t.Errorf("total komisi = %v, want 1300000.00", v1.TotalKomisi)
	}
	// Proposed vs standard, per service (the Superior's detail page data).
	if sv := v1.Services[0]; sv.StandardPrice != "9000000.00" || sv.ProposedPrice != "8000000.00" || *sv.Komisi != "800000.00" {
		t.Errorf("service[0] = %+v", sv)
	}
	if sv := v1.Services[1]; sv.PaymentTerms == nil || *sv.PaymentTerms != "Termin 2x (50/50)" {
		t.Errorf("service[1] payment terms = %v", v1.Services[1].PaymentTerms)
	}

	// Superior approves → Approved, version 1 pinned.
	neg, err = s.ApproveNegotiation(ctx, conn, nia, id)
	if err != nil {
		t.Fatalf("ApproveNegotiation: %v", err)
	}
	if got := rawStatus(t, conn, id); got != string(statemachine.ProspectNegApproved) {
		t.Errorf("status = %q, want Approved", got)
	}
	if neg.ApprovedVersion == nil || *neg.ApprovedVersion != 1 || neg.ApprovedBy == nil || *neg.ApprovedBy != "sales-head-nia" {
		t.Errorf("approval pointers = %+v", neg)
	}
	if len(neg.Decisions) != 1 || neg.Decisions[0].Action != sales.NegotiationActionApproved || neg.Decisions[0].Version != 1 {
		t.Errorf("decisions = %+v", neg.Decisions)
	}
	// W1-09 closing contract: the approved version carries the final value.
	if appr := neg.Approved(); appr == nil || appr.TotalValue != "14000000.00" {
		t.Errorf("Approved() = %+v", neg.Approved())
	}
}

// TestNegotiation_CommissionPctOverride: a negotiated commission % (M0 §5
// rule 2) is evaluated as a percent rule against the proposed price with the
// same exact math, and overrides even a pending standard rule.
func TestNegotiation_CommissionPctOverride(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	id := qualifiedProspect(t, conn, s, budi, "LEAD-202607-5102", svc)

	neg, err := s.SubmitNegotiation(ctx, conn, budi, id, sales.NegotiationInput{
		Services: []sales.NegotiationServiceInput{
			// Flat-rule service, overridden to 12.5% of the proposed 6jt = 750.000.
			{EntryID: svc[1], ProposedPrice: "6000000", ProposedCommissionPct: strp("12.5")},
			// Pending-rule service (additional, not on the form): the override
			// makes it computable — the Superior approves the explicit %.
			{EntryID: svc[5], ProposedPrice: "2000000", ProposedCommissionPct: strp("10")},
		},
	})
	if err != nil {
		t.Fatalf("SubmitNegotiation: %v", err)
	}
	v := neg.Versions[0]
	if v.CommissionPending {
		t.Fatal("override left version pending")
	}
	if *v.Services[0].Komisi != "750000.00" || *v.Services[1].Komisi != "200000.00" {
		t.Errorf("komisi = %v / %v", v.Services[0].Komisi, v.Services[1].Komisi)
	}
	if v.TotalKomisi == nil || *v.TotalKomisi != "950000.00" {
		t.Errorf("total komisi = %v", v.TotalKomisi)
	}
}

// TestNegotiation_PendingRuleStaysPending: without an override, the seed
// placeholder rule keeps komisi NULL + pending — never guessed (Build Plan
// R3) — and renders Dash.
func TestNegotiation_PendingRuleStaysPending(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	id := qualifiedProspect(t, conn, s, budi, "LEAD-202607-5103", svc)

	neg, err := s.SubmitNegotiation(ctx, conn, budi, id, sales.NegotiationInput{
		Services: []sales.NegotiationServiceInput{
			{EntryID: svc[0], ProposedPrice: "9000000"},
			{EntryID: svc[5], ProposedPrice: "1800000"}, // pending_master_list
		},
	})
	if err != nil {
		t.Fatalf("SubmitNegotiation: %v", err)
	}
	v := neg.Versions[0]
	if !v.CommissionPending || v.TotalKomisi != nil {
		t.Fatalf("want pending total, got %+v", v)
	}
	if v.TotalKomisiIDR() != "—" {
		t.Errorf("TotalKomisiIDR = %q, want —", v.TotalKomisiIDR())
	}
	if sv := v.Services[1]; !sv.CommissionPending || sv.Komisi != nil || sv.KomisiIDR() != "—" {
		t.Errorf("pending service = %+v", sv)
	}
}

// TestNegotiation_MandatoryFieldValidation: M0 §5 "≥1 service and all
// mandatory fields required" → the default BI message, zero side effects.
func TestNegotiation_MandatoryFieldValidation(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	id := qualifiedProspect(t, conn, s, budi, "LEAD-202607-5104", svc)

	cases := []struct {
		name string
		in   sales.NegotiationInput
	}{
		{"no services", sales.NegotiationInput{}},
		{"missing proposed price", sales.NegotiationInput{Services: []sales.NegotiationServiceInput{{EntryID: svc[0]}}}},
		{"malformed price", sales.NegotiationInput{Services: []sales.NegotiationServiceInput{{EntryID: svc[0], ProposedPrice: "8.000.000"}}}},
		{"negative-ish price", sales.NegotiationInput{Services: []sales.NegotiationServiceInput{{EntryID: svc[0], ProposedPrice: "-1"}}}},
		{"blank payment terms", sales.NegotiationInput{Services: []sales.NegotiationServiceInput{{EntryID: svc[0], ProposedPrice: "1000", PaymentTerms: strp("  ")}}}},
		{"blank notes", sales.NegotiationInput{Services: []sales.NegotiationServiceInput{{EntryID: svc[0], ProposedPrice: "1000", Notes: strp("")}}}},
		{"malformed pct", sales.NegotiationInput{Services: []sales.NegotiationServiceInput{{EntryID: svc[0], ProposedPrice: "1000", ProposedCommissionPct: strp("10%")}}}},
		{"duplicate service", sales.NegotiationInput{Services: []sales.NegotiationServiceInput{{EntryID: svc[0], ProposedPrice: "1000"}, {EntryID: svc[0], ProposedPrice: "2000"}}}},
		{"oversized payment terms", sales.NegotiationInput{Services: []sales.NegotiationServiceInput{{EntryID: svc[0], ProposedPrice: "1000", PaymentTerms: strp(strings.Repeat("x", 256))}}}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := s.SubmitNegotiation(ctx, conn, budi, id, c.in)
			var ve *sales.ValidationError
			if !errors.As(err, &ve) || ve.Message != msg.DataTidakLengkap {
				t.Fatalf("err = %v, want %q", err, msg.DataTidakLengkap)
			}
		})
	}
	if got := rawStatus(t, conn, id); got != string(statemachine.ProspectQualified) {
		t.Errorf("status mutated to %q", got)
	}
	if h, v, sv, d := countNegotiationRows(t, conn, id); h+v+sv+d != 0 {
		t.Errorf("failed validation left rows: %d/%d/%d/%d", h, v, sv, d)
	}
}

// TestNegotiation_UnknownServiceBlocked: a service id that is neither on the
// form nor effective/active in the Master Service List is not selectable.
func TestNegotiation_UnknownServiceBlocked(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	id := qualifiedProspect(t, conn, s, budi, "LEAD-202607-5105", svc)

	_, err := s.SubmitNegotiation(ctx, conn, budi, id, sales.NegotiationInput{
		Services: []sales.NegotiationServiceInput{{EntryID: 999999, ProposedPrice: "1000000"}},
	})
	var ve *sales.ValidationError
	if !errors.As(err, &ve) || ve.Message != msg.DataTidakLengkap {
		t.Fatalf("err = %v, want default BI validation message", err)
	}
	if got := rawStatus(t, conn, id); got != string(statemachine.ProspectQualified) {
		t.Errorf("status mutated to %q", got)
	}
}

// ---- W1-08 · counter → accept / resubmit, reject ------------------------------

// TestNegotiation_CounterThenAccept: Superior counters (mandatory notes, new
// immutable version), acceptance syncs values by pinning the counter version.
// Per DECISIONS.md O18 the accept edge is currently lead_spv-only (the
// machine's encoding); the salesperson-owner is role-blocked — asserted here
// so resolving O18 flips exactly one expectation.
func TestNegotiation_CounterThenAccept(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	nia := spvActor("sales-head-nia")
	id := qualifiedProspect(t, conn, s, budi, "LEAD-202607-5201", svc)

	if _, err := s.SubmitNegotiation(ctx, conn, budi, id, sales.NegotiationInput{
		Services: []sales.NegotiationServiceInput{{EntryID: svc[0], ProposedPrice: "7000000"}},
	}); err != nil {
		t.Fatalf("submit: %v", err)
	}

	// Counter without notes → mandatory-field validation, nothing changes.
	if _, err := s.CounterNegotiation(ctx, conn, nia, id, "  ", []sales.NegotiationServiceInput{
		{EntryID: svc[0], ProposedPrice: "8500000"},
	}); err == nil || err.Error() != msg.DataTidakLengkap {
		t.Fatalf("counter without notes: err = %v", err)
	}
	if got := rawStatus(t, conn, id); got != string(statemachine.ProspectNegPendingApprove) {
		t.Fatalf("status = %q after blocked counter", got)
	}

	neg, err := s.CounterNegotiation(ctx, conn, nia, id, "Harga minimal 8,5jt untuk paket ini", []sales.NegotiationServiceInput{
		{EntryID: svc[0], ProposedPrice: "8500000"},
	})
	if err != nil {
		t.Fatalf("CounterNegotiation: %v", err)
	}
	if got := rawStatus(t, conn, id); got != string(statemachine.ProspectNegRevisionReq) {
		t.Errorf("status = %q, want Revision Required", got)
	}
	if neg.CurrentVersion != 2 || neg.Versions[1].Kind != sales.NegotiationKindCounter || neg.Versions[1].ProposedBy != "sales-head-nia" {
		t.Fatalf("counter version = %+v", neg.Versions)
	}
	// 10%·8,5jt re-evaluated on the counter price.
	if *neg.Versions[1].TotalKomisi != "850000.00" {
		t.Errorf("counter komisi = %v", neg.Versions[1].TotalKomisi)
	}
	if d := neg.Decisions[0]; d.Action != sales.NegotiationActionCounter || d.Version != 1 || d.Notes == nil || *d.Notes != "Harga minimal 8,5jt untuk paket ini" {
		t.Errorf("counter decision = %+v", d)
	}

	// O18 running encoding: the staff owner may NOT take the accept edge.
	_, err = s.AcceptCounterOffer(ctx, conn, budi, id)
	var be *statemachine.BlockedError
	if !errors.As(err, &be) || be.Message != msg.TransisiTidakDiizinkan {
		t.Fatalf("staff accept: err = %v, want role-blocked (DECISIONS.md O18)", err)
	}

	neg, err = s.AcceptCounterOffer(ctx, conn, nia, id)
	if err != nil {
		t.Fatalf("AcceptCounterOffer: %v", err)
	}
	if got := rawStatus(t, conn, id); got != string(statemachine.ProspectNegApproved) {
		t.Errorf("status = %q, want Approved", got)
	}
	// "System syncs values": the approved version IS the counter version.
	if neg.ApprovedVersion == nil || *neg.ApprovedVersion != 2 {
		t.Fatalf("approved version = %v, want 2", neg.ApprovedVersion)
	}
	if appr := neg.Approved(); appr.TotalValue != "8500000.00" {
		t.Errorf("approved value = %q, want the counter's 8500000.00", appr.TotalValue)
	}
	if last := neg.Decisions[len(neg.Decisions)-1]; last.Action != sales.NegotiationActionAccepted || last.Version != 2 {
		t.Errorf("accept decision = %+v", last)
	}
}

// TestNegotiation_DecisionIntentGuard: Approve and Accept both land on
// `Negotiation - Approved`, so the module checks the source state explicitly
// — accepting a PENDING proposal or approving a COUNTER-offer is blocked
// with the standard BI message, keeping the decision history labels honest.
func TestNegotiation_DecisionIntentGuard(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	nia := spvActor("sales-head-nia")
	id := qualifiedProspect(t, conn, s, budi, "LEAD-202607-5204", svc)

	if _, err := s.SubmitNegotiation(ctx, conn, budi, id, sales.NegotiationInput{
		Services: []sales.NegotiationServiceInput{{EntryID: svc[0], ProposedPrice: "7000000"}},
	}); err != nil {
		t.Fatalf("submit: %v", err)
	}

	var be *statemachine.BlockedError
	if _, err := s.AcceptCounterOffer(ctx, conn, nia, id); !errors.As(err, &be) || be.Message != msg.TransisiTidakDiizinkan {
		t.Fatalf("accept while Pending Approval: err = %v, want blocked", err)
	}

	if _, err := s.CounterNegotiation(ctx, conn, nia, id, "counter", []sales.NegotiationServiceInput{
		{EntryID: svc[0], ProposedPrice: "8000000"},
	}); err != nil {
		t.Fatalf("counter: %v", err)
	}
	if _, err := s.ApproveNegotiation(ctx, conn, nia, id); !errors.As(err, &be) || be.Message != msg.TransisiTidakDiizinkan {
		t.Fatalf("approve while Revision Required: err = %v, want blocked", err)
	}

	// The intended action still works, with the honest label.
	neg, err := s.AcceptCounterOffer(ctx, conn, nia, id)
	if err != nil {
		t.Fatalf("accept: %v", err)
	}
	if last := neg.Decisions[len(neg.Decisions)-1]; last.Action != sales.NegotiationActionAccepted {
		t.Errorf("decision action = %q", last.Action)
	}
}

// TestNegotiation_CounterThenResubmit: instead of accepting, the salesperson
// resubmits — a NEW proposal version back to Pending Approval (M0 §5).
func TestNegotiation_CounterThenResubmit(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	nia := spvActor("sales-head-nia")
	id := qualifiedProspect(t, conn, s, budi, "LEAD-202607-5202", svc)

	if _, err := s.SubmitNegotiation(ctx, conn, budi, id, sales.NegotiationInput{
		Services: []sales.NegotiationServiceInput{{EntryID: svc[0], ProposedPrice: "7000000"}},
	}); err != nil {
		t.Fatalf("submit v1: %v", err)
	}
	if _, err := s.CounterNegotiation(ctx, conn, nia, id, "naikkan sedikit", []sales.NegotiationServiceInput{
		{EntryID: svc[0], ProposedPrice: "8500000"},
	}); err != nil {
		t.Fatalf("counter v2: %v", err)
	}

	neg, err := s.SubmitNegotiation(ctx, conn, budi, id, sales.NegotiationInput{
		Services: []sales.NegotiationServiceInput{{EntryID: svc[0], ProposedPrice: "8000000", Notes: strp("meeting ulang dengan klien")}},
	})
	if err != nil {
		t.Fatalf("resubmit v3: %v", err)
	}
	if got := rawStatus(t, conn, id); got != string(statemachine.ProspectNegPendingApprove) {
		t.Errorf("status = %q, want Pending Approval", got)
	}
	if neg.CurrentVersion != 3 || len(neg.Versions) != 3 || neg.Versions[2].Kind != sales.NegotiationKindProposal {
		t.Fatalf("versions = %+v", neg.Versions)
	}
	if neg.ApprovedVersion != nil {
		t.Errorf("approved version = %v before any approval", neg.ApprovedVersion)
	}
	// History intact: v1 proposal, v2 counter, v3 proposal, all immutable.
	if neg.Versions[0].TotalValue != "7000000.00" || neg.Versions[1].TotalValue != "8500000.00" || neg.Versions[2].TotalValue != "8000000.00" {
		t.Errorf("version history values = %q/%q/%q", neg.Versions[0].TotalValue, neg.Versions[1].TotalValue, neg.Versions[2].TotalValue)
	}
}

// TestNegotiation_RejectPath: Reject requires notes, lands on `Negotiation -
// Rejected`; the salesperson may set `Closed-Lost` (O11) but may NOT
// resubmit (no machine edge — DECISIONS.md O21).
func TestNegotiation_RejectPath(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	nia := spvActor("sales-head-nia")
	id := qualifiedProspect(t, conn, s, budi, "LEAD-202607-5203", svc)

	if _, err := s.SubmitNegotiation(ctx, conn, budi, id, sales.NegotiationInput{
		Services: []sales.NegotiationServiceInput{{EntryID: svc[0], ProposedPrice: "5000000"}},
	}); err != nil {
		t.Fatalf("submit: %v", err)
	}

	// Notes mandatory.
	if _, err := s.RejectNegotiation(ctx, conn, nia, id, ""); err == nil || err.Error() != msg.DataTidakLengkap {
		t.Fatalf("reject without notes: %v", err)
	}

	neg, err := s.RejectNegotiation(ctx, conn, nia, id, "Diskon terlalu dalam, margin negatif")
	if err != nil {
		t.Fatalf("RejectNegotiation: %v", err)
	}
	if got := rawStatus(t, conn, id); got != string(statemachine.ProspectNegRejected) {
		t.Errorf("status = %q, want Rejected", got)
	}
	if neg.ApprovedVersion != nil {
		t.Errorf("rejected negotiation has approved version %v", neg.ApprovedVersion)
	}
	if d := neg.Decisions[len(neg.Decisions)-1]; d.Action != sales.NegotiationActionRejected || d.Notes == nil {
		t.Errorf("reject decision = %+v", d)
	}

	// O21: resubmission after Reject is blocked by the machine.
	_, err = s.SubmitNegotiation(ctx, conn, budi, id, sales.NegotiationInput{
		Services: []sales.NegotiationServiceInput{{EntryID: svc[0], ProposedPrice: "9000000"}},
	})
	var be *statemachine.BlockedError
	if !errors.As(err, &be) {
		t.Fatalf("resubmit after reject: err = %v, want blocked (O21)", err)
	}

	// O11: Closed-Lost from Rejected via the generic status API.
	if err := s.UpdateStatus(ctx, conn, budi, id, sales.UpdateStatusInput{To: statemachine.ProspectClosedLost}); err != nil {
		t.Fatalf("Closed-Lost after reject: %v", err)
	}
}

// ---- permissions (M0 §7.1 / PERMISSIONS.md; DoD role suite) -------------------

// TestNegotiation_Permissions covers the DoD permission matrix on both submit
// doors and the read API, including the layered Staff+OD account.
func TestNegotiation_Permissions(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	id := qualifiedProspect(t, conn, s, budi, "LEAD-202607-5301", svc)

	nego := sales.NegotiationInput{Services: []sales.NegotiationServiceInput{{EntryID: svc[0], ProposedPrice: "8000000"}}}

	// Deny: another Staff (same division), cross-division staff, OD (read-only).
	for _, actor := range []authz.Identity{staffActor("sales-andi"), otherDivisionStaff("ads-tia"), odActor("od-rani")} {
		if _, err := s.SubmitNegotiation(ctx, conn, actor, id, nego); !errors.Is(err, authz.ErrDenied) {
			t.Errorf("%s submit: err = %v, want denied", actor.EmployeeID, err)
		}
		if _, err := s.SubmitNoNegotiation(ctx, conn, actor, id, sales.NoNegotiationInput{Services: []sales.NoNegotiationServiceInput{{EntryID: svc[0]}}}); !errors.Is(err, authz.ErrDenied) {
			t.Errorf("%s no-nego submit: err = %v, want denied", actor.EmployeeID, err)
		}
	}

	// Layered Staff+OD on the OWN attempt: write comes from the Staff scope.
	layered := authz.Identity{EmployeeID: "sales-budi", Divisi: sales.DivisiSales, Roles: []authz.Role{authz.RoleStaff, authz.RoleOD}}
	if _, err := s.SubmitNegotiation(ctx, conn, layered, id, nego); err != nil {
		t.Fatalf("layered staff+OD submit own attempt: %v", err)
	}

	// Approval: Staff owner blocked (role-gated edge), OD blocked (no write),
	// Director blocked by the edge's lead_spv-only gate (PERMISSIONS.md M0:
	// approval = Sales Head/SPV), SPV allowed.
	if _, err := s.ApproveNegotiation(ctx, conn, budi, id); err == nil {
		t.Error("staff owner approved own negotiation")
	}
	if _, err := s.ApproveNegotiation(ctx, conn, odActor("od-rani"), id); !errors.Is(err, authz.ErrDenied) {
		t.Errorf("OD approve: err = %v, want denied", err)
	}
	var be *statemachine.BlockedError
	if _, err := s.ApproveNegotiation(ctx, conn, directorActor("dir-mea"), id); !errors.As(err, &be) {
		t.Errorf("director approve: err = %v, want role-blocked edge", err)
	}
	if _, err := s.ApproveNegotiation(ctx, conn, spvActor("sales-head-nia"), id); err != nil {
		t.Fatalf("SPV approve: %v", err)
	}

	// Reads: owner, SPV (division), OD (read-only), Director allowed; other
	// staff and cross-division staff denied.
	for _, actor := range []authz.Identity{budi, spvActor("sales-head-nia"), odActor("od-rani"), directorActor("dir-mea")} {
		if _, err := s.GetNegotiation(ctx, conn, actor, id); err != nil {
			t.Errorf("%s read: %v", actor.EmployeeID, err)
		}
	}
	for _, actor := range []authz.Identity{staffActor("sales-andi"), otherDivisionStaff("ads-tia")} {
		if _, err := s.GetNegotiation(ctx, conn, actor, id); !errors.Is(err, authz.ErrDenied) {
			t.Errorf("%s read: err = %v, want denied", actor.EmployeeID, err)
		}
	}
}

// ---- immutability (DoD; W1-08 AC "version history immutable") -----------------

// TestNegotiation_HistoryImmutable proves the storage layer itself blocks
// UPDATE/DELETE on the three history tables (triggers, migrations 0044-0046).
func TestNegotiation_HistoryImmutable(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	nia := spvActor("sales-head-nia")
	id := qualifiedProspect(t, conn, s, budi, "LEAD-202607-5401", svc)

	if _, err := s.SubmitNegotiation(ctx, conn, budi, id, sales.NegotiationInput{
		Services: []sales.NegotiationServiceInput{{EntryID: svc[0], ProposedPrice: "8000000"}},
	}); err != nil {
		t.Fatalf("submit: %v", err)
	}
	if _, err := s.RejectNegotiation(ctx, conn, nia, id, "bukti immutability"); err != nil {
		t.Fatalf("reject: %v", err)
	}

	stmts := []string{
		`UPDATE negotiation_versions SET total_value = '1.00' WHERE prospect_id = '` + id + `'`,
		`DELETE FROM negotiation_versions WHERE prospect_id = '` + id + `'`,
		`UPDATE negotiation_version_services SET proposed_price = '1.00'`,
		`DELETE FROM negotiation_version_services`,
		`UPDATE negotiation_decisions SET notes = 'diubah' WHERE prospect_id = '` + id + `'`,
		`DELETE FROM negotiation_decisions WHERE prospect_id = '` + id + `'`,
	}
	for _, stmt := range stmts {
		if _, err := conn.Exec(stmt); err == nil {
			t.Errorf("%s: succeeded, want trigger SIGNAL", stmt)
		}
	}
}

// ---- recompute-from-log (DoD: derived fields) ---------------------------------

// TestNegotiation_RecomputeFromStoredVersions re-derives every stored komisi
// and both totals from the immutable per-service rows (pinned rule +
// proposed price) and asserts byte-equality — the house convention #4
// recompute guarantee, across a multi-version history.
func TestNegotiation_RecomputeFromStoredVersions(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	nia := spvActor("sales-head-nia")
	id := qualifiedProspect(t, conn, s, budi, "LEAD-202607-5501", svc)

	if _, err := s.SubmitNegotiation(ctx, conn, budi, id, sales.NegotiationInput{
		Services: []sales.NegotiationServiceInput{
			{EntryID: svc[0], ProposedPrice: "8000000"},
			{EntryID: svc[2], ProposedPrice: "6500000", ProposedCommissionPct: strp("11")},
		},
	}); err != nil {
		t.Fatalf("submit: %v", err)
	}
	if _, err := s.CounterNegotiation(ctx, conn, nia, id, "counter", []sales.NegotiationServiceInput{
		{EntryID: svc[0], ProposedPrice: "8750000"},
		{EntryID: svc[2], ProposedPrice: "6900000"},
	}); err != nil {
		t.Fatalf("counter: %v", err)
	}

	neg, err := s.GetNegotiation(ctx, conn, spvActor("sales-head-nia"), id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	for _, v := range neg.Versions {
		var totalCents, komisiCents int64
		pending := false
		for _, sv := range v.Services {
			priceCents, ok := sales.ParseDecimalCents(sv.ProposedPrice)
			if !ok {
				t.Fatalf("stored proposed price %q unparseable", sv.ProposedPrice)
			}
			totalCents += priceCents
			amount, pend, err := sales.EvaluateCommissionRule(sv.CommissionRule, priceCents)
			if err != nil {
				t.Fatalf("re-evaluate stored rule: %v", err)
			}
			if pend {
				pending = true
				if sv.Komisi != nil {
					t.Errorf("v%d service %d: stored komisi %q for a pending rule", v.Version, sv.EntryID, *sv.Komisi)
				}
				continue
			}
			if sv.Komisi == nil || *sv.Komisi != sales.CentsToDecimal(amount) {
				t.Errorf("v%d service %d: stored komisi %v != recomputed %s", v.Version, sv.EntryID, sv.Komisi, sales.CentsToDecimal(amount))
			}
			komisiCents += amount
		}
		if v.TotalValue != sales.CentsToDecimal(totalCents) {
			t.Errorf("v%d: stored total %q != recomputed %s", v.Version, v.TotalValue, sales.CentsToDecimal(totalCents))
		}
		if pending != v.CommissionPending {
			t.Errorf("v%d: pending flag %v != recomputed %v", v.Version, v.CommissionPending, pending)
		}
		if !pending && (v.TotalKomisi == nil || *v.TotalKomisi != sales.CentsToDecimal(komisiCents)) {
			t.Errorf("v%d: stored total komisi %v != recomputed %s", v.Version, v.TotalKomisi, sales.CentsToDecimal(komisiCents))
		}
	}
}

// ---- notifications (O15 catalog wiring) ---------------------------------------

// seedNotificationRoster seeds the employees + role_mappings rows the
// resolvers query: owner sales-budi (Staff) and superior sales-head-nia
// (lead_spv) in the Sales division, plus an INACTIVE second SPV who must not
// be notified.
func seedNotificationRoster(t *testing.T, conn *sql.DB) {
	t.Helper()
	now := time.Now().UTC()
	rows := []struct {
		id, nama, jabatan string
		aktif             int
	}{
		{"sales-budi", "Budi", "Sales Executive", 1},
		{"sales-head-nia", "Nia", "Sales Head", 1},
		{"sales-head-lama", "Mantan Head", "Sales Head", 0},
	}
	for _, r := range rows {
		if _, err := conn.Exec(
			`INSERT INTO employees (employee_id, nama, email, divisi, jabatan, status_aktif, hris_updated_at, created_at, updated_at)
			 VALUES (?, ?, ?, 'Sales', ?, ?, ?, ?, ?)`,
			r.id, r.nama, r.id+"@meagency.co.id", r.jabatan, r.aktif, now, now, now,
		); err != nil {
			t.Fatalf("seed employee %s: %v", r.id, err)
		}
	}
	for _, m := range []struct{ jabatan, role string }{
		{"Sales Executive", "staff"},
		{"Sales Head", "lead_spv"},
	} {
		if _, err := conn.Exec(
			`INSERT INTO role_mappings (divisi, jabatan, role, created_by) VALUES ('Sales', ?, ?, 'seed')`,
			m.jabatan, m.role,
		); err != nil {
			t.Fatalf("seed mapping %s: %v", m.jabatan, err)
		}
	}
}

// TestNegotiation_Notifications drives submit → counter through a real bus +
// notify.Center and asserts the catalog recipients: pending-approval goes to
// the ACTIVE Sales Head/SPV of the salesperson's division, the decision goes
// to the salesperson.
func TestNegotiation_Notifications(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	svc := seedAlphaServices(t, conn)
	seedNotificationRoster(t, conn)

	bus := events.NewInMemoryBus()
	s := sales.NewAttempts(authz.NewMatrixChecker(), audit.NewMySQL(), ids.NewMySQL(), bus)
	center := notify.NewCenter(notify.DefaultCatalog(), notify.WithResolveErrorHook(func(e events.Event, err error) {
		t.Errorf("notify resolve error for %s: %v", e.Name, err)
	}))
	if err := sales.WireNegotiationNotifications(center); err != nil {
		t.Fatalf("WireNegotiationNotifications: %v", err)
	}
	center.Subscribe(bus, conn)

	budi := staffActor("sales-budi")
	nia := spvActor("sales-head-nia")
	id := qualifiedProspect(t, conn, s, budi, "LEAD-202607-5601", svc)

	if _, err := s.SubmitNegotiation(ctx, conn, budi, id, sales.NegotiationInput{
		Services: []sales.NegotiationServiceInput{{EntryID: svc[0], ProposedPrice: "8000000"}},
	}); err != nil {
		t.Fatalf("submit: %v", err)
	}

	// Superior notified, byte-exact catalog title; inactive SPV excluded.
	inbox, err := center.Inbox(ctx, conn, "sales-head-nia", false, 10, 0)
	if err != nil {
		t.Fatalf("inbox: %v", err)
	}
	if len(inbox) != 1 || inbox[0].EventName != "m0.negotiation.pending_approval_submitted" || inbox[0].Title != "Negosiasi menunggu persetujuan" {
		t.Fatalf("superior inbox = %+v", inbox)
	}
	if old, err := center.Inbox(ctx, conn, "sales-head-lama", false, 10, 0); err != nil || len(old) != 0 {
		t.Fatalf("inactive SPV inbox = %+v (%v)", old, err)
	}

	// Decision → salesperson.
	if _, err := s.CounterNegotiation(ctx, conn, nia, id, "counter", []sales.NegotiationServiceInput{
		{EntryID: svc[0], ProposedPrice: "8500000"},
	}); err != nil {
		t.Fatalf("counter: %v", err)
	}
	inbox, err = center.Inbox(ctx, conn, "sales-budi", false, 10, 0)
	if err != nil {
		t.Fatalf("owner inbox: %v", err)
	}
	if len(inbox) != 1 || inbox[0].EventName != "m0.negotiation.decision" || inbox[0].Title != "Keputusan negosiasi" {
		t.Fatalf("owner inbox = %+v", inbox)
	}
}

// TestNegotiation_AuditTrail: every mutation appends immutable audit rows —
// the version submit, each decision, and the engine's own transitions.
func TestNegotiation_AuditTrail(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	nia := spvActor("sales-head-nia")
	id := qualifiedProspect(t, conn, s, budi, "LEAD-202607-5701", svc)

	if _, err := s.SubmitNegotiation(ctx, conn, budi, id, sales.NegotiationInput{
		Services: []sales.NegotiationServiceInput{{EntryID: svc[0], ProposedPrice: "8000000"}},
	}); err != nil {
		t.Fatalf("submit: %v", err)
	}
	if _, err := s.ApproveNegotiation(ctx, conn, nia, id); err != nil {
		t.Fatalf("approve: %v", err)
	}

	var n int
	if err := conn.QueryRow(
		`SELECT COUNT(*) FROM audit_log WHERE entity_type = 'negotiation' AND entity_id = ?`, id,
	).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 2 { // negotiation_version_submitted + negotiation_decision
		t.Errorf("negotiation audit rows = %d, want 2", n)
	}
	// Engine transition rows for the two negotiation edges exist too.
	if err := conn.QueryRow(
		`SELECT COUNT(*) FROM audit_log WHERE entity_type = 'prospect' AND entity_id = ? AND action = 'transition'`, id,
	).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n < 4 { // Pending Validation→New Lead, →Contacted, →Qualified, →Pending Approval, →Approved
		t.Errorf("prospect transition audit rows = %d, want >= 4", n)
	}
}
