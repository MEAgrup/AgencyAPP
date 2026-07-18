package module0_sales_test

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/admin"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module0_sales"
	"github.com/meagrup/agencyapp/backend/internal/module1_leads"
)

// ---- shared helpers (build on the flow_test.go harness) --------------------

// attemptStatus reads the authoritative prospect_attempt status.
func attemptStatus(t *testing.T, d *sql.DB, attemptID string) string {
	t.Helper()
	var s string
	if err := d.QueryRowContext(context.Background(),
		`SELECT status FROM prospect_attempts WHERE id = ?`, attemptID).Scan(&s); err != nil {
		t.Fatalf("read attempt status: %v", err)
	}
	return s
}

// customLines is one custom (negotiated) proposal line against the fixture MSL.
func customLines(msvc, price string) []module0_sales.ProposalLine {
	return []module0_sales.ProposalLine{
		{MasterServiceID: msvc, ProposedPrice: price, CommissionRule: "10% of standard price"},
	}
}

// contactedAttempt registers a lead and advances it to Contacted (stops short of
// the Qualified Form so double-submit / count cases can drive it directly).
func (f fixture) contactedAttempt(t *testing.T, owner permission.Actor, phone string) string {
	t.Helper()
	ctx := context.Background()
	_, att, _, err := f.leads.Register(ctx, owner, module1_leads.RegisterInput{LeadName: "Co", PhoneNumber: phone, Source: "Referral"})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if err := f.sales.MarkContacted(ctx, owner, att.ID); err != nil {
		t.Fatalf("MarkContacted: %v", err)
	}
	return att.ID
}

// pendingNegotiation drives a fresh attempt to Negotiation - Pending Approval
// via a custom (negotiation-required) proposal.
func (f fixture) pendingNegotiation(t *testing.T, owner permission.Actor, phone string) string {
	t.Helper()
	att := f.qualifiedAttempt(t, owner, phone)
	if err := f.sales.SubmitNegotiation(context.Background(), owner, att, customLines(f.msvc, "6000000"), false); err != nil {
		t.Fatalf("SubmitNegotiation(custom): %v", err)
	}
	return att
}

// revisionRequired drives a fresh attempt to Negotiation - Revision Required.
func (f fixture) revisionRequired(t *testing.T, owner permission.Actor, phone, note string) string {
	t.Helper()
	att := f.pendingNegotiation(t, owner, phone)
	lead := salesActor("SL", permission.LevelLead)
	if err := f.sales.DecideNegotiation(context.Background(), lead, att, module0_sales.DecisionRevise, note); err != nil {
		t.Fatalf("DecideNegotiation(revise): %v", err)
	}
	return att
}

// proposalVersions returns the version_no list (ascending) for an attempt.
func proposalVersions(t *testing.T, d *sql.DB, attemptID string) []int {
	t.Helper()
	rows, err := d.QueryContext(context.Background(),
		`SELECT version_no FROM negotiation_proposals WHERE attempt_id = ? ORDER BY version_no`, attemptID)
	if err != nil {
		t.Fatalf("read versions: %v", err)
	}
	defer rows.Close()
	var out []int
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			t.Fatalf("scan version: %v", err)
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("versions rows: %v", err)
	}
	return out
}

// latestDecisionNote reads the decision_note pinned on the newest proposal
// version of an attempt.
func latestDecisionNote(t *testing.T, d *sql.DB, attemptID string) sql.NullString {
	t.Helper()
	var note sql.NullString
	if err := d.QueryRowContext(context.Background(),
		`SELECT decision_note FROM negotiation_proposals WHERE attempt_id = ?
		  ORDER BY version_no DESC LIMIT 1`, attemptID).Scan(&note); err != nil {
		t.Fatalf("read decision_note: %v", err)
	}
	return note
}

// ---- A1. Revise (counter) → accept ----------------------------------------

// TestNegotiation_ReviseThenAcceptCounter: a superior counter-offer needs a
// mandatory note, moves the attempt to Revision Required with the note pinned on
// the latest proposal version, and the owner accepting the counter lands on
// Approved (M0 §5 line 122; STATE_MACHINES §1).
func TestNegotiation_ReviseThenAcceptCounter(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	owner := salesActor("SS-1", permission.LevelStaff)
	lead := salesActor("SL", permission.LevelLead)
	att := f.pendingNegotiation(t, owner, "0820")

	// Empty note revise is blocked with the mandatory-field gate.
	if err := f.sales.DecideNegotiation(ctx, lead, att, module0_sales.DecisionRevise, ""); !errors.Is(err, module0_sales.ErrIncomplete) {
		t.Fatalf("revise empty note err = %v, want ErrIncomplete", err)
	}
	if got := attemptStatus(t, f.d, att); got != module0_sales.StatusNegPending {
		t.Fatalf("status after blocked revise = %q, want %q", got, module0_sales.StatusNegPending)
	}

	// Valid counter-offer with note.
	note := "turunkan harga jadi 5.500.000"
	if err := f.sales.DecideNegotiation(ctx, lead, att, module0_sales.DecisionRevise, note); err != nil {
		t.Fatalf("revise: %v", err)
	}
	if got := attemptStatus(t, f.d, att); got != module0_sales.StatusNegRevision {
		t.Fatalf("status after revise = %q, want %q", got, module0_sales.StatusNegRevision)
	}
	if dn := latestDecisionNote(t, f.d, att); !dn.Valid || dn.String != note {
		t.Fatalf("decision_note = %v, want %q", dn, note)
	}

	// Owner accepts the counter → Approved.
	if err := f.sales.AcceptCounter(ctx, owner, att); err != nil {
		t.Fatalf("AcceptCounter: %v", err)
	}
	if got := attemptStatus(t, f.d, att); got != module0_sales.StatusNegApproved {
		t.Fatalf("status after AcceptCounter = %q, want %q", got, module0_sales.StatusNegApproved)
	}
}

// ---- A2. AcceptCounter permission / state guards ---------------------------

// TestNegotiation_AcceptCounterGuards: a non-owner staff cannot accept another
// salesperson's counter (owner write gate), and AcceptCounter from a state other
// than Revision Required is blocked by the transition engine.
func TestNegotiation_AcceptCounterGuards(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	owner := salesActor("SS-1", permission.LevelStaff)
	other := salesActor("SS-2", permission.LevelStaff)

	att := f.revisionRequired(t, owner, "0821", "revisi harga")

	// Non-owner staff blocked (verbatim role-denied message), status unchanged.
	err := f.sales.AcceptCounter(ctx, other, att)
	if err == nil {
		t.Fatal("non-owner staff must not AcceptCounter")
	}
	if err.Error() != statemachine.RoleDeniedMessage {
		t.Fatalf("AcceptCounter denial = %q, want %q", err.Error(), statemachine.RoleDeniedMessage)
	}
	if got := attemptStatus(t, f.d, att); got != module0_sales.StatusNegRevision {
		t.Fatalf("status after blocked AcceptCounter = %q, want %q", got, module0_sales.StatusNegRevision)
	}

	// AcceptCounter from a non-Revision state (a plain Qualified attempt) is an
	// invalid transition → engine BlockedError.
	att2 := f.qualifiedAttempt(t, owner, "0822")
	err = f.sales.AcceptCounter(ctx, owner, att2)
	var be *statemachine.BlockedError
	if !errors.As(err, &be) {
		t.Fatalf("AcceptCounter from Qualified err = %v, want *statemachine.BlockedError", err)
	}
	if got := attemptStatus(t, f.d, att2); got != module0_sales.StatusQualified {
		t.Fatalf("status after blocked AcceptCounter = %q, want %q", got, module0_sales.StatusQualified)
	}
}

// ---- A3. Resubmit after Revision Required ----------------------------------

// TestNegotiation_ResubmitAfterRevision: the owner resubmits a fresh proposal
// after a counter-offer → back to Pending Approval with an immutable new version
// (versions stay sequential 1,2,…).
func TestNegotiation_ResubmitAfterRevision(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	owner := salesActor("SS-1", permission.LevelStaff)
	att := f.revisionRequired(t, owner, "0823", "revisi harga")

	if got := proposalVersions(t, f.d, att); len(got) != 1 || got[0] != 1 {
		t.Fatalf("versions before resubmit = %v, want [1]", got)
	}

	if err := f.sales.Resubmit(ctx, owner, att, customLines(f.msvc, "5500000")); err != nil {
		t.Fatalf("Resubmit: %v", err)
	}
	if got := attemptStatus(t, f.d, att); got != module0_sales.StatusNegPending {
		t.Fatalf("status after resubmit = %q, want %q", got, module0_sales.StatusNegPending)
	}
	// Immutable, sequential versions.
	if got := proposalVersions(t, f.d, att); len(got) != 2 || got[0] != 1 || got[1] != 2 {
		t.Fatalf("versions after resubmit = %v, want [1 2]", got)
	}
}

// ---- A4. Reject → resubmit (DECISIONS O16) --------------------------------

// TestNegotiation_RejectThenResubmit: reject needs a mandatory note, a
// non-superior staff cannot reject (engine RoleError), the superior reject pins
// the note and lands on Rejected, and the owner may resubmit a new version out
// of Rejected (DECISIONS O16).
func TestNegotiation_RejectThenResubmit(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	owner := salesActor("SS-1", permission.LevelStaff)
	lead := salesActor("SL", permission.LevelLead)
	att := f.pendingNegotiation(t, owner, "0824")

	// Empty note reject blocked with the mandatory-field gate.
	if err := f.sales.DecideNegotiation(ctx, lead, att, module0_sales.DecisionReject, ""); !errors.Is(err, module0_sales.ErrIncomplete) {
		t.Fatalf("reject empty note err = %v, want ErrIncomplete", err)
	}

	// Non-superior staff cannot reject (requireLead edge → engine RoleError).
	err := f.sales.DecideNegotiation(ctx, owner, att, module0_sales.DecisionReject, "alasan")
	var re *statemachine.RoleError
	if !errors.As(err, &re) {
		t.Fatalf("staff reject err = %v, want *statemachine.RoleError", err)
	}
	if got := attemptStatus(t, f.d, att); got != module0_sales.StatusNegPending {
		t.Fatalf("status after blocked reject = %q, want %q", got, module0_sales.StatusNegPending)
	}

	// Superior reject with mandatory note.
	note := "harga terlalu tinggi"
	if err := f.sales.DecideNegotiation(ctx, lead, att, module0_sales.DecisionReject, note); err != nil {
		t.Fatalf("reject: %v", err)
	}
	if got := attemptStatus(t, f.d, att); got != module0_sales.StatusNegRejected {
		t.Fatalf("status after reject = %q, want %q", got, module0_sales.StatusNegRejected)
	}
	if dn := latestDecisionNote(t, f.d, att); !dn.Valid || dn.String != note {
		t.Fatalf("decision_note = %v, want %q", dn, note)
	}

	// From Rejected the owner may resubmit → Pending Approval, new version.
	if err := f.sales.Resubmit(ctx, owner, att, customLines(f.msvc, "5800000")); err != nil {
		t.Fatalf("Resubmit after reject: %v", err)
	}
	if got := attemptStatus(t, f.d, att); got != module0_sales.StatusNegPending {
		t.Fatalf("status after resubmit = %q, want %q", got, module0_sales.StatusNegPending)
	}
	if got := proposalVersions(t, f.d, att); len(got) != 2 || got[1] != 2 {
		t.Fatalf("versions after resubmit = %v, want [1 2]", got)
	}
}

// ---- A5. Resubmit input / permission guards --------------------------------

// TestNegotiation_ResubmitGuards: an empty resubmit is the mandatory-field gate,
// and a non-owner staff cannot resubmit another's proposal; neither writes a new
// version and neither changes the status.
func TestNegotiation_ResubmitGuards(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	owner := salesActor("SS-1", permission.LevelStaff)
	other := salesActor("SS-2", permission.LevelStaff)
	att := f.revisionRequired(t, owner, "0825", "revisi")

	// Empty lines → ErrIncomplete.
	if err := f.sales.Resubmit(ctx, owner, att, nil); !errors.Is(err, module0_sales.ErrIncomplete) {
		t.Fatalf("empty resubmit err = %v, want ErrIncomplete", err)
	}
	if got := attemptStatus(t, f.d, att); got != module0_sales.StatusNegRevision {
		t.Fatalf("status after empty resubmit = %q, want %q", got, module0_sales.StatusNegRevision)
	}

	// Non-owner staff resubmit blocked (verbatim role-denied message).
	err := f.sales.Resubmit(ctx, other, att, customLines(f.msvc, "5500000"))
	if err == nil {
		t.Fatal("non-owner staff must not resubmit")
	}
	if err.Error() != statemachine.RoleDeniedMessage {
		t.Fatalf("resubmit denial = %q, want %q", err.Error(), statemachine.RoleDeniedMessage)
	}
	if got := attemptStatus(t, f.d, att); got != module0_sales.StatusNegRevision {
		t.Fatalf("status after blocked resubmit = %q, want %q", got, module0_sales.StatusNegRevision)
	}
	// No new version was written by either failed resubmit.
	if got := proposalVersions(t, f.d, att); len(got) != 1 || got[0] != 1 {
		t.Fatalf("versions after failed resubmits = %v, want [1]", got)
	}
}

// ---- B1. Qualified Form service-count bounds (M0 §4.3) ---------------------

// TestQualified_ServiceCountBounds: 0 services → ErrNoServices, 6 → the verbatim
// [maksimal pilih 5 jasa saja!] over-limit message (submission blocked, attempt
// stays Contacted), 5 distinct services → submit succeeds and pins 5 lines.
func TestQualified_ServiceCountBounds(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	lead := salesActor("SL", permission.LevelLead)
	owner := salesActor("SS-1", permission.LevelStaff)

	// Five distinct MSL services (uq_qfs is (attempt_id, master_service_id)).
	ids := []string{f.msvc}
	for i := 0; i < 4; i++ {
		id, err := admin.CreateService(ctx, f.d, lead, admin.ServiceInput{
			Name: "Svc", StandardPrice: "1000000", CommissionRule: "10% of standard price",
			Active: true, EffectiveFrom: "2026-01-01",
		})
		if err != nil {
			t.Fatalf("CreateService[%d]: %v", i, err)
		}
		ids = append(ids, id)
	}

	att := f.contactedAttempt(t, owner, "0830")
	baseForm := func(sels []module0_sales.ServiceSelection) module0_sales.QualifiedForm {
		return module0_sales.QualifiedForm{
			NamaPIC: "P", Toko: "T", Kota: "K", LinkToko: "L", Kategori: "C", Platform: "Shopee",
			GMVBaseline: "1000000", TargetGMV: "2000000", Services: sels,
		}
	}
	sel := func(list []string) []module0_sales.ServiceSelection {
		out := make([]module0_sales.ServiceSelection, 0, len(list))
		for _, id := range list {
			out = append(out, module0_sales.ServiceSelection{MasterServiceID: id})
		}
		return out
	}

	// 0 services → ErrNoServices.
	if err := f.sales.SubmitQualifiedForm(ctx, owner, att, baseForm(nil)); !errors.Is(err, module0_sales.ErrNoServices) {
		t.Fatalf("0-service err = %v, want ErrNoServices", err)
	}

	// 6 services → ErrTooManyServices with the verbatim BI message.
	six := sel([]string{f.msvc, f.msvc, f.msvc, f.msvc, f.msvc, f.msvc})
	err := f.sales.SubmitQualifiedForm(ctx, owner, att, baseForm(six))
	if !errors.Is(err, module0_sales.ErrTooManyServices) {
		t.Fatalf("6-service err = %v, want ErrTooManyServices", err)
	}
	if err.Error() != module0_sales.MaxServicesMessage {
		t.Fatalf("6-service message = %q, want %q", err.Error(), module0_sales.MaxServicesMessage)
	}
	if got := attemptStatus(t, f.d, att); got != module0_sales.StatusContacted {
		t.Fatalf("status after blocked submit = %q, want %q", got, module0_sales.StatusContacted)
	}

	// 5 distinct services → success.
	if err := f.sales.SubmitQualifiedForm(ctx, owner, att, baseForm(sel(ids))); err != nil {
		t.Fatalf("5-service submit: %v", err)
	}
	if got := attemptStatus(t, f.d, att); got != module0_sales.StatusQualified {
		t.Fatalf("status after submit = %q, want %q", got, module0_sales.StatusQualified)
	}
	var n int
	if err := f.d.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM qualified_form_services WHERE attempt_id = ?`, att).Scan(&n); err != nil {
		t.Fatalf("count qfs: %v", err)
	}
	if n != 5 {
		t.Fatalf("qualified_form_services rows = %d, want 5", n)
	}
}

// ---- B2. Qualified Form locks after submit (M0 §4 rule 1) ------------------

// TestQualified_LockedAfterSubmit: a second SubmitQualifiedForm on an already
// Qualified attempt fails and writes no second form / service rows (the client
// data "locks" on submit, M0 §4 example line 98).
func TestQualified_LockedAfterSubmit(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	owner := salesActor("SS-1", permission.LevelStaff)
	att := f.qualifiedAttempt(t, owner, "0831")

	form := module0_sales.QualifiedForm{
		NamaPIC: "P", Toko: "T", Kota: "K", LinkToko: "L", Kategori: "C", Platform: "Shopee",
		GMVBaseline: "1000000", TargetGMV: "2000000",
		Services: []module0_sales.ServiceSelection{{MasterServiceID: f.msvc}},
	}
	if err := f.sales.SubmitQualifiedForm(ctx, owner, att, form); err == nil {
		t.Fatal("second SubmitQualifiedForm on a Qualified attempt must fail")
	}

	// The rollback leaves exactly one form + one service line, status unchanged.
	var forms, svcs int
	if err := f.d.QueryRowContext(ctx, `SELECT COUNT(*) FROM qualified_forms WHERE attempt_id = ?`, att).Scan(&forms); err != nil {
		t.Fatalf("count forms: %v", err)
	}
	if err := f.d.QueryRowContext(ctx, `SELECT COUNT(*) FROM qualified_form_services WHERE attempt_id = ?`, att).Scan(&svcs); err != nil {
		t.Fatalf("count qfs: %v", err)
	}
	if forms != 1 || svcs != 1 {
		t.Fatalf("after blocked re-submit: forms=%d svcs=%d, want 1 and 1", forms, svcs)
	}
	if got := attemptStatus(t, f.d, att); got != module0_sales.StatusQualified {
		t.Fatalf("status after blocked re-submit = %q, want %q", got, module0_sales.StatusQualified)
	}
}

// ---- B3. MSL version pinning (M0 §4 / W1-06) -------------------------------

// TestQualified_VersionPinning: after the Qualified Form pins MSL v1, a later
// admin.UpdateService that publishes a new effective version does NOT change the
// pinned qualified_form_services snapshot, and the no-negotiation proposal takes
// the pinned subtotal + commission rule (not the new catalog price).
func TestQualified_VersionPinning(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	owner := salesActor("SS-1", permission.LevelStaff)
	lead := salesActor("SL", permission.LevelLead)

	// Pins MSL v1: standard_price 5.000.000, rule "10% of standard price".
	att := f.qualifiedAttempt(t, owner, "0832")

	// Admin publishes v2 effective today with a new price + rule.
	newVer, err := admin.UpdateService(ctx, f.d, lead, f.msvc, admin.ServiceInput{
		Name: "Ads", StandardPrice: "9000000", CommissionRule: "15% of standard price",
		Active: true, EffectiveFrom: "2026-07-01",
	})
	if err != nil {
		t.Fatalf("UpdateService: %v", err)
	}
	if newVer != 2 {
		t.Fatalf("new version = %d, want 2", newVer)
	}
	// Sanity: the current effective catalog really did change.
	v, err := admin.EffectiveAt(ctx, f.d, f.msvc, "2026-07-17")
	if err != nil {
		t.Fatalf("EffectiveAt: %v", err)
	}
	if v.VersionNo != 2 || v.StandardPrice != "9000000.00" {
		t.Fatalf("effective catalog = v%d %s, want v2 9000000.00", v.VersionNo, v.StandardPrice)
	}

	// The pinned qualified_form_services snapshot stays on v1.
	var mv int
	var sp, cr string
	if err := f.d.QueryRowContext(ctx,
		`SELECT master_version_no, standard_price, commission_rule
		   FROM qualified_form_services WHERE attempt_id = ?`, att).Scan(&mv, &sp, &cr); err != nil {
		t.Fatalf("read pinned qfs: %v", err)
	}
	if mv != 1 || sp != "5000000.00" || cr != "10% of standard price" {
		t.Fatalf("pinned qfs = v%d %s %q, want v1 5000000.00 \"10%% of standard price\"", mv, sp, cr)
	}

	// The no-negotiation path takes the pinned subtotal + rule, not the new price.
	if err := f.sales.SubmitNegotiation(ctx, owner, att, nil, true); err != nil {
		t.Fatalf("SubmitNegotiation(noNego): %v", err)
	}
	if got := attemptStatus(t, f.d, att); got != module0_sales.StatusNegAutoApprove {
		t.Fatalf("status after no-nego = %q, want %q", got, module0_sales.StatusNegAutoApprove)
	}
	var pp, pcr string
	if err := f.d.QueryRowContext(ctx,
		`SELECT npl.proposed_price, npl.commission_rule
		   FROM negotiation_proposal_lines npl
		   JOIN negotiation_proposals np ON np.id = npl.proposal_id
		  WHERE np.attempt_id = ? ORDER BY npl.id LIMIT 1`, att).Scan(&pp, &pcr); err != nil {
		t.Fatalf("read proposal line: %v", err)
	}
	if pp != "5000000.00" {
		t.Fatalf("no-nego proposed_price = %q, want pinned 5000000.00", pp)
	}
	if pcr != "10% of standard price" {
		t.Fatalf("no-nego commission_rule = %q, want pinned v1 rule", pcr)
	}
}
