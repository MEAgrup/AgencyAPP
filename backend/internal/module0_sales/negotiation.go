package sales

// negotiation.go — W1-07 "Negotiation — non-nego path" + W1-08 "Negotiation —
// full flow + approval" (M0 §5; docs/STATE_MACHINES.md §1 negotiation states;
// docs/backlog/WAVE1 BACKLOG.md).
//
// Entry rule (M0 §5 rule 1): only `Qualified` attempts (form submitted) may
// enter Negotiation; on entry the salesperson selects one of two paths, which
// map 1:1 onto this file's two submit APIs:
//
//   - SubmitNoNegotiation (W1-07): client accepts standard pricing, standard
//     commission, full payment. Any custom term is blocked with
//     ErrCustomTermRequiresNegotiation ("prompted to switch to the
//     Negotiation flow") — the server never lets a non-standard term through
//     this door. Pass → negotiation record with standard terms, status
//     `Negotiation - Auto Approved` (bypasses the Superior), closing enabled.
//
//   - SubmitNegotiation (W1-08): versioned proposal routed to the Superior
//     (`Negotiation - Pending Approval`). The SAME method is the resubmit
//     path from `Negotiation - Revision Required` ("new version") — the
//     engine's transition table decides which edge applies.
//
// Superior approval (W1-08, Sales Head/SPV only — enforced by the engine's
// role-gated edges, PERMISSIONS.md M0):
//
//   - ApproveNegotiation → `Negotiation - Approved`; terms locked (the
//     approved version is immutable and the header pins approved_version).
//   - CounterNegotiation → revised terms + MANDATORY notes → new 'counter'
//     version + `Negotiation - Revision Required`.
//   - RejectNegotiation → MANDATORY notes → `Negotiation - Rejected`; the
//     salesperson may then set the attempt to `Closed-Lost` via UpdateStatus
//     (O11: Closed-Lost only from Rejected). NOTE M0 §5 prose also says a
//     rejected salesperson "may submit a fresh proposal", but SM §1 encodes
//     no `Rejected → Pending Approval` edge — flagged as DECISIONS.md O21;
//     encoding follows the machine (resubmission after Reject is blocked).
//   - AcceptCounterOffer → "system syncs values" → `Negotiation - Approved`
//     with approved_version = the Superior's counter version. WHO may accept
//     is DECISIONS.md O18 (M0 §5 prose says the salesperson; SM §1 encodes
//     the edge lead_spv-only) — this method delegates the role decision
//     entirely to the engine edge, so resolving O18 is a machines.go change
//     with no edit here.
//
// Baseline contract (docs/HANDOFF.md, prepared by W1-06): services already on
// the Qualified Lead Form negotiate from the form's PINNED Master Service
// List version (qualified_form_services); additional services picked from
// the Master Service List resolve via msl.EffectiveAt at submission time.
// Commission is re-evaluated with the SAME EvaluateCommissionRule used by
// the Qualified form, against the PROPOSED price; a proposed commission %
// (M0 §5 rule 2) is evaluated as a {"type":"percent","value":pct} rule. The
// pending_master_list placeholder keeps komisi NULL + pending — never
// guessed (Build Plan R3).
//
// History: negotiation_versions / negotiation_version_services /
// negotiation_decisions are append-only (M0 §7.2, W1-08 AC "version history
// immutable") — no UPDATE/DELETE code path exists and storage-layer triggers
// (migrations 0044–0046) block mutation outright. Only the negotiations
// header row (current/approved pointers) is mutable.

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/msg"
	"github.com/meagrup/agencyapp/backend/internal/core/msl"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// Version kinds (negotiation_versions.kind).
const (
	NegotiationKindStandard = "standard" // W1-07 non-nego path, born approved
	NegotiationKindProposal = "proposal" // salesperson submission (initial or resubmit)
	NegotiationKindCounter  = "counter"  // Superior's Revise/Counter Offer
)

// Decision actions (negotiation_decisions.action).
const (
	NegotiationActionApproved = "approved"
	NegotiationActionCounter  = "counter"
	NegotiationActionRejected = "rejected"
	NegotiationActionAccepted = "accepted"
)

// maxPaymentTermsLength mirrors negotiation_version_services.payment_terms
// VARCHAR(255).
const maxPaymentTermsLength = 255

// ErrCustomTermRequiresNegotiation is the W1-07 block: the non-negotiation
// confirmation screen only accepts standard price / standard commission /
// full payment; any custom term is rejected and the salesperson is prompted
// to switch to the Negotiation flow (M0 §5 non-nego validation step 2). The
// PRD specifies no BI `[...]` string for this prompt, so per the msg-package
// rule this stays a typed sentinel (same treatment as ErrFormLocked); the UI
// copy is an open question for the PRD owner.
var ErrCustomTermRequiresNegotiation = errors.New("sales: custom terms require the negotiation flow")

// ErrNegotiationNotFound is returned when reading/deciding a negotiation for
// an attempt that never entered Negotiation.
var ErrNegotiationNotFound = errors.New("sales: negotiation not found")

// NegotiationServiceInput is one service line of a W1-08 proposal (initial
// submit, resubmit, or Superior counter): "per selected service: proposed
// price / commission / payment terms (as applicable) + optional notes"
// (M0 §5).
type NegotiationServiceInput struct {
	// EntryID is the Master Service List service_entries.id — a service
	// already on the Qualified form or an additional one from the list.
	EntryID int64
	// ProposedPrice is MANDATORY: non-negative decimal literal in IDR
	// ("8500000" / "8500000.00").
	ProposedPrice string
	// ProposedCommissionPct optionally negotiates the commission % (M0 §5
	// rule 2): non-negative decimal literal ("10" / "12.5", max 2 decimals).
	// nil = the service's standard commission rule re-evaluated against the
	// proposed price.
	ProposedCommissionPct *string
	// PaymentTerms optionally proposes non-standard payment terms
	// (installments). nil = full payment (the standard term). Set ⇒ non-blank,
	// ≤255 chars.
	PaymentTerms *string
	// Notes are optional per-service notes. Set ⇒ non-blank.
	Notes *string
}

// NegotiationInput is the W1-08 Negotiation Form payload: ≥1 service, all
// mandatory fields required (M0 §5), else blocked with the default BI
// message and zero side effects.
type NegotiationInput struct {
	Services []NegotiationServiceInput
}

// NoNegotiationServiceInput is one line of the W1-07 Service Selection &
// Confirmation screen: previously selected services (deselect allowed) plus
// additional services from the Master Service List — STANDARD TERMS ONLY.
type NoNegotiationServiceInput struct {
	EntryID int64
	// Price optionally echoes the standard price shown on the confirmation
	// screen; when set it must equal the service's standard price exactly —
	// any other value is a custom term (ErrCustomTermRequiresNegotiation).
	Price *string
	// CommissionPct must be nil: a custom commission is a custom term.
	CommissionPct *string
	// PaymentTerms must be nil: anything besides full payment is a custom
	// term.
	PaymentTerms *string
}

// NoNegotiationInput is the W1-07 confirmation payload (≥1 service).
type NoNegotiationInput struct {
	Services []NoNegotiationServiceInput
}

// NegotiationServiceView is one service line of one negotiation version,
// carrying both the standard baseline and this version's proposed terms —
// exactly what the Superior's Negotiation Detail Page renders ("proposed vs.
// standard values per service, and notes", M0 §5).
type NegotiationServiceView struct {
	EntryID                int64  // MSL service_entries.id
	MSLVersionID           int64  // MSL service_entry_versions.id — pinned baseline version
	MSLVersion             int    // that version's number, for display
	Name                   string // snapshot
	StandardPrice          string // snapshot, decimal literal (baseline)
	StandardCommissionRule string // snapshot, rule JSON (baseline)
	ProposedPrice          string // this version's price, decimal literal
	// CommissionRule is the effective rule Komisi was evaluated with: the
	// standard rule against the proposed price, or a percent rule built from
	// ProposedCommissionPct.
	CommissionRule string
	// Komisi is the evaluated per-service commission (decimal literal), nil
	// with CommissionPending=true when the effective rule is the
	// pending_master_list placeholder (never guessed).
	Komisi            *string
	CommissionPending bool
	PaymentTerms      *string // nil = full payment (standard)
	Notes             *string
}

// KomisiIDR renders the per-service commission as `Rp. X.XXX.XXX,00`, or
// Dash when pending (§2.7).
func (v NegotiationServiceView) KomisiIDR() string {
	if v.Komisi == nil {
		return Dash
	}
	return FormatIDR(*v.Komisi)
}

// NegotiationVersion is one immutable proposal iteration.
type NegotiationVersion struct {
	Version    int
	Kind       string // NegotiationKindStandard | Proposal | Counter
	ProposedBy string
	// TotalValue is the auto-computed Σ of proposed prices (decimal literal)
	// — the "final approved transaction value" W1-09 closing uses when this
	// is the approved version (M0 §6 rule 6).
	TotalValue string
	// TotalKomisi is the auto-computed Σ of per-service komisi, nil with
	// CommissionPending=true while any service's rule is still pending.
	TotalKomisi       *string
	CommissionPending bool
	SubmittedAt       time.Time
	Services          []NegotiationServiceView
}

// TotalValueIDR renders TotalValue as `Rp. X.XXX.XXX,00`.
func (v *NegotiationVersion) TotalValueIDR() string { return FormatIDR(v.TotalValue) }

// TotalKomisiIDR renders TotalKomisi, or Dash while pending (§2.7).
func (v *NegotiationVersion) TotalKomisiIDR() string {
	if v.TotalKomisi == nil {
		return Dash
	}
	return FormatIDR(*v.TotalKomisi)
}

// NegotiationDecision is one immutable Superior/accept decision row.
type NegotiationDecision struct {
	Version   int    // the version this decision responds to
	Action    string // NegotiationActionApproved | Counter | Rejected | Accepted
	Notes     *string
	DecidedBy string
	DecidedAt time.Time
}

// Negotiation is the read-side view of an attempt's negotiation record:
// header pointers + full immutable version/decision history.
type Negotiation struct {
	ProspectID          string
	NegotiationRequired bool // false = W1-07 non-nego path
	CurrentVersion      int
	// ApprovedVersion pins the terms W1-09 closing locks onto; nil until
	// Auto Approve / Approve / accept-counter.
	ApprovedVersion *int
	ApprovedAt      *time.Time
	ApprovedBy      *string
	CreatedAt       time.Time
	CreatedBy       string
	Versions        []NegotiationVersion // ascending by version
	Decisions       []NegotiationDecision
}

// Approved returns the approved version's data, or nil while no version is
// approved. This is the W1-09 closing read contract: final approved
// transaction value = Approved().TotalValue, approved services =
// Approved().Services.
func (n *Negotiation) Approved() *NegotiationVersion {
	if n.ApprovedVersion == nil {
		return nil
	}
	for i := range n.Versions {
		if n.Versions[i].Version == *n.ApprovedVersion {
			return &n.Versions[i]
		}
	}
	return nil
}

// ---- input validation (pure, no DB) ----------------------------------------

// validate enforces M0 §5's "≥1 service and all mandatory fields required"
// for a full-negotiation proposal (submit, resubmit, counter).
func (in NegotiationInput) validate() error {
	if len(in.Services) == 0 {
		return validationErr()
	}
	seen := make(map[int64]bool, len(in.Services))
	for _, sv := range in.Services {
		if sv.EntryID <= 0 || seen[sv.EntryID] {
			return validationErr()
		}
		seen[sv.EntryID] = true
		if _, ok := ParseDecimalCents(sv.ProposedPrice); !ok {
			return validationErr()
		}
		if sv.ProposedCommissionPct != nil {
			if _, ok := ParseDecimalCents(*sv.ProposedCommissionPct); !ok {
				return validationErr()
			}
		}
		if sv.PaymentTerms != nil {
			t := strings.TrimSpace(*sv.PaymentTerms)
			if t == "" || len(t) > maxPaymentTermsLength {
				return validationErr()
			}
		}
		if sv.Notes != nil && strings.TrimSpace(*sv.Notes) == "" {
			return validationErr()
		}
	}
	return nil
}

// validate enforces the W1-07 pure-input half of the non-nego rules: the
// completeness checks fail with the default BI message; a structurally
// custom term (commission override, payment terms) fails with
// ErrCustomTermRequiresNegotiation before any DB work. The price-echo
// equality check needs the standard price and therefore runs later, inside
// the transaction (buildNoNegotiationServices).
func (in NoNegotiationInput) validate() error {
	if len(in.Services) == 0 {
		return validationErr()
	}
	seen := make(map[int64]bool, len(in.Services))
	for _, sv := range in.Services {
		if sv.EntryID <= 0 || seen[sv.EntryID] {
			return validationErr()
		}
		seen[sv.EntryID] = true
		if sv.CommissionPct != nil || sv.PaymentTerms != nil {
			return ErrCustomTermRequiresNegotiation
		}
		if sv.Price != nil {
			if _, ok := ParseDecimalCents(*sv.Price); !ok {
				return validationErr()
			}
		}
	}
	return nil
}

// ---- baseline resolution + version building --------------------------------

// negotiationBaseline is one service's standard-terms snapshot the proposal
// is compared against and evaluated with.
type negotiationBaseline struct {
	mslVersionID       int64
	mslVersion         int
	name               string
	standardPrice      string
	standardPriceCents int64
	commissionRule     string
}

// resolveNegotiationBaseline resolves a service's standard baseline per the
// docs/HANDOFF.md contract: the Qualified form's pinned MSL version when the
// service was already selected there, otherwise the MSL version effective at
// `at` (must exist and be active — an unknown/inactive service is not
// selectable, default BI validation message).
func resolveNegotiationBaseline(ctx context.Context, q db.Queryer, prospectID string, entryID int64, at time.Time) (*negotiationBaseline, error) {
	var b negotiationBaseline
	err := q.QueryRowContext(ctx,
		`SELECT version_id, version, service_name, standard_price, commission_rule
		 FROM qualified_form_services WHERE prospect_id = ? AND entry_id = ?`,
		prospectID, entryID,
	).Scan(&b.mslVersionID, &b.mslVersion, &b.name, &b.standardPrice, &b.commissionRule)
	if err == sql.ErrNoRows {
		v, err := msl.EffectiveAt(ctx, q, entryID, at)
		if err == msl.ErrNotFound {
			return nil, validationErr()
		}
		if err != nil {
			return nil, fmt.Errorf("sales: resolve MSL version for entry %d: %w", entryID, err)
		}
		if !v.Active {
			return nil, validationErr()
		}
		b = negotiationBaseline{mslVersionID: v.ID, mslVersion: v.Version, name: v.Name, standardPrice: v.StandardPrice, commissionRule: v.CommissionRule}
	} else if err != nil {
		return nil, fmt.Errorf("sales: load qualified baseline for entry %d: %w", entryID, err)
	}
	cents, ok := ParseDecimalCents(b.standardPrice)
	if !ok {
		return nil, fmt.Errorf("sales: baseline for entry %d has unparseable standard price %q", entryID, b.standardPrice)
	}
	b.standardPriceCents = cents
	return &b, nil
}

// builtVersion is the computed (not yet persisted) content of one new
// negotiation version.
type builtVersion struct {
	totalValue        string
	totalKomisi       *string
	commissionPending bool
	services          []NegotiationServiceView
}

// buildNegotiationServices resolves baselines and computes the read-only
// money fields for one proposal (house convention #4): per service, komisi =
// EvaluateCommissionRule(effective rule, PROPOSED price) where the effective
// rule is the standard rule or — when the proposal negotiates the commission
// % — {"type":"percent","value":pct}. Pure resolution/compute, no writes.
func buildNegotiationServices(ctx context.Context, q db.Queryer, prospectID string, at time.Time, inputs []NegotiationServiceInput) (*builtVersion, error) {
	var (
		out         builtVersion
		totalCents  int64
		komisiCents int64
	)
	for _, in := range inputs {
		b, err := resolveNegotiationBaseline(ctx, q, prospectID, in.EntryID, at)
		if err != nil {
			return nil, err
		}
		priceCents, _ := ParseDecimalCents(in.ProposedPrice) // validated upstream
		if totalCents > math.MaxInt64-priceCents {
			return nil, fmt.Errorf("sales: negotiation total value overflows for prospect %s", prospectID)
		}
		totalCents += priceCents

		rule := b.commissionRule
		if in.ProposedCommissionPct != nil {
			// The negotiated commission % becomes a percent rule evaluated by
			// the SAME evaluator, so the number stays recomputable and exact.
			rule = fmt.Sprintf(`{"type":"percent","value":%s}`, *in.ProposedCommissionPct)
		}
		amountCents, pend, err := EvaluateCommissionRule(rule, priceCents)
		if err != nil {
			return nil, err
		}

		sv := NegotiationServiceView{
			EntryID:                in.EntryID,
			MSLVersionID:           b.mslVersionID,
			MSLVersion:             b.mslVersion,
			Name:                   b.name,
			StandardPrice:          b.standardPrice,
			StandardCommissionRule: b.commissionRule,
			ProposedPrice:          CentsToDecimal(priceCents),
			CommissionRule:         rule,
			CommissionPending:      pend,
		}
		if pend {
			out.commissionPending = true
		} else {
			c := CentsToDecimal(amountCents)
			sv.Komisi = &c
			if komisiCents > math.MaxInt64-amountCents {
				return nil, fmt.Errorf("sales: negotiation total komisi overflows for prospect %s", prospectID)
			}
			komisiCents += amountCents
		}
		if in.PaymentTerms != nil {
			t := strings.TrimSpace(*in.PaymentTerms)
			sv.PaymentTerms = &t
		}
		if in.Notes != nil {
			n := strings.TrimSpace(*in.Notes)
			sv.Notes = &n
		}
		out.services = append(out.services, sv)
	}
	out.totalValue = CentsToDecimal(totalCents)
	if !out.commissionPending {
		k := CentsToDecimal(komisiCents)
		out.totalKomisi = &k
	}
	return &out, nil
}

// buildNoNegotiationServices converts the W1-07 confirmation input into a
// standard-terms proposal, enforcing the in-DB half of the custom-term gate:
// an echoed price that differs from the service's standard price (compared
// in cents, so "9000000" equals "9000000.00") is a custom term.
func buildNoNegotiationServices(ctx context.Context, q db.Queryer, prospectID string, at time.Time, inputs []NoNegotiationServiceInput) (*builtVersion, error) {
	std := make([]NegotiationServiceInput, 0, len(inputs))
	for _, in := range inputs {
		b, err := resolveNegotiationBaseline(ctx, q, prospectID, in.EntryID, at)
		if err != nil {
			return nil, err
		}
		if in.Price != nil {
			echoCents, _ := ParseDecimalCents(*in.Price) // validated upstream
			if echoCents != b.standardPriceCents {
				return nil, ErrCustomTermRequiresNegotiation
			}
		}
		std = append(std, NegotiationServiceInput{EntryID: in.EntryID, ProposedPrice: b.standardPrice})
	}
	return buildNegotiationServices(ctx, q, prospectID, at, std)
}

// ---- persistence helpers ----------------------------------------------------

func insertNegotiationVersion(ctx context.Context, tx *sql.Tx, prospectID string, v *NegotiationVersion) error {
	var totalKomisi any
	if v.TotalKomisi != nil {
		totalKomisi = *v.TotalKomisi
	}
	res, err := tx.ExecContext(ctx,
		`INSERT INTO negotiation_versions
			(prospect_id, version, kind, proposed_by, total_value, total_komisi, commission_pending, submitted_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		prospectID, v.Version, v.Kind, v.ProposedBy, v.TotalValue, totalKomisi, v.CommissionPending, v.SubmittedAt,
	)
	if err != nil {
		return fmt.Errorf("sales: insert negotiation version %d: %w", v.Version, err)
	}
	versionRowID, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("sales: negotiation version row id: %w", err)
	}
	for i, sv := range v.Services {
		var komisi, terms, notes any
		if sv.Komisi != nil {
			komisi = *sv.Komisi
		}
		if sv.PaymentTerms != nil {
			terms = *sv.PaymentTerms
		}
		if sv.Notes != nil {
			notes = *sv.Notes
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO negotiation_version_services
				(negotiation_version_id, position, entry_id, msl_version_id, msl_version,
				 service_name, standard_price, standard_commission_rule,
				 proposed_price, commission_rule, komisi, commission_pending, payment_terms, notes)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			versionRowID, i+1, sv.EntryID, sv.MSLVersionID, sv.MSLVersion,
			sv.Name, sv.StandardPrice, sv.StandardCommissionRule,
			sv.ProposedPrice, sv.CommissionRule, komisi, sv.CommissionPending, terms, notes,
		); err != nil {
			return fmt.Errorf("sales: insert negotiation version service %d: %w", sv.EntryID, err)
		}
	}
	return nil
}

func insertNegotiationDecision(ctx context.Context, tx *sql.Tx, prospectID string, d NegotiationDecision) error {
	var notes any
	if d.Notes != nil {
		notes = *d.Notes
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO negotiation_decisions (prospect_id, version, action, notes, decided_by, decided_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		prospectID, d.Version, d.Action, notes, d.DecidedBy, d.DecidedAt,
	); err != nil {
		return fmt.Errorf("sales: insert negotiation decision %s: %w", d.Action, err)
	}
	return nil
}

// negotiationHeaderForUpdate locks and returns (current_version) for an
// existing negotiation, or ErrNegotiationNotFound.
func negotiationHeaderForUpdate(ctx context.Context, tx *sql.Tx, prospectID string) (currentVersion int, err error) {
	err = tx.QueryRowContext(ctx,
		`SELECT current_version FROM negotiations WHERE prospect_id = ? FOR UPDATE`, prospectID,
	).Scan(&currentVersion)
	if err == sql.ErrNoRows {
		return 0, ErrNegotiationNotFound
	}
	if err != nil {
		return 0, fmt.Errorf("sales: load negotiation header %s: %w", prospectID, err)
	}
	return currentVersion, nil
}

func (s *Attempts) auditNegotiation(ctx context.Context, tx *sql.Tx, actor authz.Identity, prospectID, action string, payload any, at time.Time) error {
	after, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("sales: marshal negotiation audit payload: %w", err)
	}
	if _, err := s.auditLg.Append(ctx, tx, audit.Entry{
		EntityType: "negotiation",
		EntityID:   prospectID,
		Actor:      actor.EmployeeID,
		Action:     action,
		After:      after,
		At:         at,
	}); err != nil {
		return fmt.Errorf("sales: audit %s: %w", action, err)
	}
	return nil
}

// ---- W1-07: non-negotiation path --------------------------------------------

// SubmitNoNegotiation executes the M0 §5 Non-Negotiation flow for a
// `Qualified` attempt: validates that every selected service uses standard
// price / standard commission / full payment (any custom term →
// ErrCustomTermRequiresNegotiation, zero side effects), then — in ONE
// transaction — creates the negotiation record with standard terms
// (version 1, kind 'standard', approved immediately) and transitions the
// attempt to `Negotiation - Auto Approved` (bypasses the Superior; Proceed
// to Closing enabled).
//
// The service set is the confirmation screen's final selection: previously
// selected Qualified-form services (deselect allowed) and/or additional
// services from the Master Service List, ≥1 (M0 §5 non-nego flow step 1).
//
// Permission (M0 §7.1): Staff owner-only; Head/SPV Sales division-wide;
// Director full; OD denied. An attempt not currently `Qualified` is blocked
// by the engine with the standard BI transition message.
func (s *Attempts) SubmitNoNegotiation(ctx context.Context, conn *sql.DB, actor authz.Identity, prospectID string, in NoNegotiationInput) (*Negotiation, error) {
	if err := in.validate(); err != nil {
		return nil, err
	}
	roles := toStatemachineRoles(actor.Roles)

	var neg *Negotiation
	err := s.engine.InTx(ctx, conn, func(tx *sql.Tx) error {
		att, err := loadAttemptForUpdate(ctx, tx, prospectID)
		if err != nil {
			return err
		}
		if err := s.requireWrite(actor, att.OwnerEmployeeID); err != nil {
			return err
		}

		// The engine enforces from == Qualified (the only source of the
		// Auto Approved edge) before any negotiation row is written; failure
		// rolls everything back.
		if err := s.engine.Transition(ctx, tx, statemachine.TransitionRequest{
			EntityType: statemachine.EntityProspect,
			EntityID:   prospectID,
			To:         statemachine.ProspectNegAutoApproved,
			Actor:      actor.EmployeeID,
			ActorRoles: roles,
		}); err != nil {
			return err
		}

		now := time.Now().UTC()
		built, err := buildNoNegotiationServices(ctx, tx, prospectID, now, in.Services)
		if err != nil {
			return err
		}
		version := NegotiationVersion{
			Version:           1,
			Kind:              NegotiationKindStandard,
			ProposedBy:        actor.EmployeeID,
			TotalValue:        built.totalValue,
			TotalKomisi:       built.totalKomisi,
			CommissionPending: built.commissionPending,
			SubmittedAt:       now,
			Services:          built.services,
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO negotiations
				(prospect_id, negotiation_required, current_version, approved_version, approved_at, approved_by, created_at, created_by)
			 VALUES (?, 0, 1, 1, ?, ?, ?, ?)`,
			prospectID, now, actor.EmployeeID, now, actor.EmployeeID,
		); err != nil {
			return fmt.Errorf("sales: insert negotiation header: %w", err)
		}
		if err := insertNegotiationVersion(ctx, tx, prospectID, &version); err != nil {
			return err
		}
		if err := s.auditNegotiation(ctx, tx, actor, prospectID, "negotiation_auto_approved", version, now); err != nil {
			return err
		}

		neg, err = loadNegotiation(ctx, tx, prospectID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return neg, nil
}

// ---- W1-08: full negotiation flow -------------------------------------------

// SubmitNegotiation submits a full-negotiation proposal (M0 §5 Negotiation
// Required flow): the initial submission of a `Qualified` attempt (version
// 1) or the salesperson's RESUBMIT of a `Negotiation - Revision Required`
// attempt (next version) — both land on `Negotiation - Pending Approval`,
// routed to the Superior (notification event
// m0.negotiation.pending_approval_submitted, O15 catalog). Which edge
// applies is decided by the engine's transition table; any other current
// status (including `Negotiation - Rejected`, see DECISIONS.md O21) is
// blocked with the standard BI message and zero side effects.
//
// Validation (M0 §5): ≥1 service, proposed price mandatory per service,
// commission %/payment terms/notes optional but non-blank when given — fail
// → `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]`.
//
// Permission (M0 §7.1): Staff owner-only; Head/SPV Sales division-wide;
// Director full; OD denied.
func (s *Attempts) SubmitNegotiation(ctx context.Context, conn *sql.DB, actor authz.Identity, prospectID string, in NegotiationInput) (*Negotiation, error) {
	if err := in.validate(); err != nil {
		return nil, err
	}
	roles := toStatemachineRoles(actor.Roles)

	var neg *Negotiation
	err := s.engine.InTx(ctx, conn, func(tx *sql.Tx) error {
		att, err := loadAttemptForUpdate(ctx, tx, prospectID)
		if err != nil {
			return err
		}
		if err := s.requireWrite(actor, att.OwnerEmployeeID); err != nil {
			return err
		}

		next := 1
		current, err := negotiationHeaderForUpdate(ctx, tx, prospectID)
		switch err {
		case nil:
			next = current + 1
		case ErrNegotiationNotFound:
			// First submission: header created below.
		default:
			return err
		}

		if err := s.engine.Transition(ctx, tx, statemachine.TransitionRequest{
			EntityType: statemachine.EntityProspect,
			EntityID:   prospectID,
			To:         statemachine.ProspectNegPendingApprove,
			Actor:      actor.EmployeeID,
			ActorRoles: roles,
			Payload:    map[string]any{"version": next},
		}); err != nil {
			return err
		}

		now := time.Now().UTC()
		built, err := buildNegotiationServices(ctx, tx, prospectID, now, in.Services)
		if err != nil {
			return err
		}
		version := NegotiationVersion{
			Version:           next,
			Kind:              NegotiationKindProposal,
			ProposedBy:        actor.EmployeeID,
			TotalValue:        built.totalValue,
			TotalKomisi:       built.totalKomisi,
			CommissionPending: built.commissionPending,
			SubmittedAt:       now,
			Services:          built.services,
		}
		if next == 1 {
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO negotiations
					(prospect_id, negotiation_required, current_version, created_at, created_by)
				 VALUES (?, 1, 1, ?, ?)`,
				prospectID, now, actor.EmployeeID,
			); err != nil {
				return fmt.Errorf("sales: insert negotiation header: %w", err)
			}
		} else {
			if _, err := tx.ExecContext(ctx,
				`UPDATE negotiations SET current_version = ? WHERE prospect_id = ?`,
				next, prospectID,
			); err != nil {
				return fmt.Errorf("sales: advance negotiation version: %w", err)
			}
		}
		if err := insertNegotiationVersion(ctx, tx, prospectID, &version); err != nil {
			return err
		}
		if err := s.auditNegotiation(ctx, tx, actor, prospectID, "negotiation_version_submitted", version, now); err != nil {
			return err
		}

		neg, err = loadNegotiation(ctx, tx, prospectID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return neg, nil
}

// ApproveNegotiation is the Superior's Approve (M0 §5 approval flow):
// `Negotiation - Pending Approval` → `Negotiation - Approved`; the pending
// version becomes the locked approved version (terms locked — versions are
// immutable and the header pins approved_version); Proceed to Closing
// enabled. Restricted to Sales Head/SPV by the engine's role-gated edge
// (PERMISSIONS.md M0) — a Staff owner or a Director without the lead_spv
// role is blocked with the standard BI message and zero side effects.
// Notification event m0.negotiation.decision (O15 catalog) → salesperson.
func (s *Attempts) ApproveNegotiation(ctx context.Context, conn *sql.DB, actor authz.Identity, prospectID string) (*Negotiation, error) {
	return s.decideApprove(ctx, conn, actor, prospectID, statemachine.ProspectNegPendingApprove, NegotiationActionApproved)
}

// AcceptCounterOffer accepts the Superior's outstanding counter-offer
// (M0 §5: "salesperson either accepts (system syncs values → `Negotiation -
// Approved`) or resubmits"): `Negotiation - Revision Required` →
// `Negotiation - Approved`, with the value sync realised by pinning
// approved_version to the Superior's counter version (its immutable rows ARE
// the synced values).
//
// WHO may accept is open question DECISIONS.md O18: M0 §5 prose says the
// salesperson accepts, but SM §1 encodes the `Revision Required → Approved`
// edge lead_spv-only, and per the decision log the running encoding follows
// the machine. This method delegates the role check entirely to the engine
// edge — resolving O18 is a one-line machines.go change with no edit here.
func (s *Attempts) AcceptCounterOffer(ctx context.Context, conn *sql.DB, actor authz.Identity, prospectID string) (*Negotiation, error) {
	return s.decideApprove(ctx, conn, actor, prospectID, statemachine.ProspectNegRevisionReq, NegotiationActionAccepted)
}

// decideApprove is the shared "current version becomes approved" path behind
// ApproveNegotiation (from Pending Approval) and AcceptCounterOffer (from
// Revision Required). Both edges land on `Negotiation - Approved`, so the
// engine alone cannot tell WHICH intent the caller had — the explicit `from`
// check below keeps the immutable decision history honest (an Approve call
// against a counter-offer, or an Accept call against a pending proposal, is
// blocked exactly like any other illegal transition, with zero side
// effects). Role gating stays with the engine's edges.
func (s *Attempts) decideApprove(ctx context.Context, conn *sql.DB, actor authz.Identity, prospectID string, from statemachine.Status, action string) (*Negotiation, error) {
	roles := toStatemachineRoles(actor.Roles)

	var neg *Negotiation
	err := s.engine.InTx(ctx, conn, func(tx *sql.Tx) error {
		att, err := loadAttemptForUpdate(ctx, tx, prospectID)
		if err != nil {
			return err
		}
		if err := s.requireWrite(actor, att.OwnerEmployeeID); err != nil {
			return err
		}
		if att.Status != from {
			return &statemachine.BlockedError{
				Entity:  statemachine.EntityProspect,
				From:    att.Status,
				To:      statemachine.ProspectNegApproved,
				Message: msg.TransisiTidakDiizinkan,
				Reason:  "not_allowed",
			}
		}
		current, err := negotiationHeaderForUpdate(ctx, tx, prospectID)
		if err != nil {
			return err
		}

		if err := s.engine.Transition(ctx, tx, statemachine.TransitionRequest{
			EntityType: statemachine.EntityProspect,
			EntityID:   prospectID,
			To:         statemachine.ProspectNegApproved,
			Actor:      actor.EmployeeID,
			ActorRoles: roles,
			Payload:    map[string]any{"decision": action, "version": current},
		}); err != nil {
			return err
		}

		now := time.Now().UTC()
		if _, err := tx.ExecContext(ctx,
			`UPDATE negotiations SET approved_version = ?, approved_at = ?, approved_by = ? WHERE prospect_id = ?`,
			current, now, actor.EmployeeID, prospectID,
		); err != nil {
			return fmt.Errorf("sales: pin approved negotiation version: %w", err)
		}
		d := NegotiationDecision{Version: current, Action: action, DecidedBy: actor.EmployeeID, DecidedAt: now}
		if err := insertNegotiationDecision(ctx, tx, prospectID, d); err != nil {
			return err
		}
		if err := s.auditNegotiation(ctx, tx, actor, prospectID, "negotiation_decision", d, now); err != nil {
			return err
		}

		neg, err = loadNegotiation(ctx, tx, prospectID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return neg, nil
}

// CounterNegotiation is the Superior's Revise / Counter Offer (M0 §5
// approval flow): revised terms + MANDATORY notes → a new immutable
// 'counter' version + `Negotiation - Pending Approval` → `Negotiation -
// Revision Required`. The salesperson then either accepts
// (AcceptCounterOffer) or resubmits (SubmitNegotiation, new version).
// Restricted to Sales Head/SPV by the engine's role-gated edge. Blank notes
// or an invalid revised-terms payload fail mandatory-field validation with
// zero side effects.
func (s *Attempts) CounterNegotiation(ctx context.Context, conn *sql.DB, actor authz.Identity, prospectID string, notes string, services []NegotiationServiceInput) (*Negotiation, error) {
	notes = strings.TrimSpace(notes)
	if notes == "" {
		return nil, validationErr()
	}
	in := NegotiationInput{Services: services}
	if err := in.validate(); err != nil {
		return nil, err
	}
	roles := toStatemachineRoles(actor.Roles)

	var neg *Negotiation
	err := s.engine.InTx(ctx, conn, func(tx *sql.Tx) error {
		att, err := loadAttemptForUpdate(ctx, tx, prospectID)
		if err != nil {
			return err
		}
		if err := s.requireWrite(actor, att.OwnerEmployeeID); err != nil {
			return err
		}
		countered, err := negotiationHeaderForUpdate(ctx, tx, prospectID)
		if err != nil {
			return err
		}
		next := countered + 1

		if err := s.engine.Transition(ctx, tx, statemachine.TransitionRequest{
			EntityType: statemachine.EntityProspect,
			EntityID:   prospectID,
			To:         statemachine.ProspectNegRevisionReq,
			Actor:      actor.EmployeeID,
			ActorRoles: roles,
			Payload:    map[string]any{"decision": NegotiationActionCounter, "version": countered},
		}); err != nil {
			return err
		}

		now := time.Now().UTC()
		built, err := buildNegotiationServices(ctx, tx, prospectID, now, in.Services)
		if err != nil {
			return err
		}
		version := NegotiationVersion{
			Version:           next,
			Kind:              NegotiationKindCounter,
			ProposedBy:        actor.EmployeeID,
			TotalValue:        built.totalValue,
			TotalKomisi:       built.totalKomisi,
			CommissionPending: built.commissionPending,
			SubmittedAt:       now,
			Services:          built.services,
		}
		if err := insertNegotiationVersion(ctx, tx, prospectID, &version); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE negotiations SET current_version = ? WHERE prospect_id = ?`,
			next, prospectID,
		); err != nil {
			return fmt.Errorf("sales: advance negotiation version: %w", err)
		}
		d := NegotiationDecision{Version: countered, Action: NegotiationActionCounter, Notes: &notes, DecidedBy: actor.EmployeeID, DecidedAt: now}
		if err := insertNegotiationDecision(ctx, tx, prospectID, d); err != nil {
			return err
		}
		if err := s.auditNegotiation(ctx, tx, actor, prospectID, "negotiation_decision", map[string]any{"decision": d, "counter_version": version}, now); err != nil {
			return err
		}

		neg, err = loadNegotiation(ctx, tx, prospectID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return neg, nil
}

// RejectNegotiation is the Superior's Reject (M0 §5 approval flow):
// MANDATORY notes → `Negotiation - Pending Approval` → `Negotiation -
// Rejected`. The salesperson may then set the attempt to `Closed-Lost`
// through UpdateStatus (O11); resubmitting after Reject is blocked by the
// machine (no outgoing edge to Pending Approval — DECISIONS.md O21).
// Restricted to Sales Head/SPV by the engine's role-gated edge.
func (s *Attempts) RejectNegotiation(ctx context.Context, conn *sql.DB, actor authz.Identity, prospectID string, notes string) (*Negotiation, error) {
	notes = strings.TrimSpace(notes)
	if notes == "" {
		return nil, validationErr()
	}
	roles := toStatemachineRoles(actor.Roles)

	var neg *Negotiation
	err := s.engine.InTx(ctx, conn, func(tx *sql.Tx) error {
		att, err := loadAttemptForUpdate(ctx, tx, prospectID)
		if err != nil {
			return err
		}
		if err := s.requireWrite(actor, att.OwnerEmployeeID); err != nil {
			return err
		}
		current, err := negotiationHeaderForUpdate(ctx, tx, prospectID)
		if err != nil {
			return err
		}

		if err := s.engine.Transition(ctx, tx, statemachine.TransitionRequest{
			EntityType: statemachine.EntityProspect,
			EntityID:   prospectID,
			To:         statemachine.ProspectNegRejected,
			Actor:      actor.EmployeeID,
			ActorRoles: roles,
			Payload:    map[string]any{"decision": NegotiationActionRejected, "version": current},
		}); err != nil {
			return err
		}

		now := time.Now().UTC()
		d := NegotiationDecision{Version: current, Action: NegotiationActionRejected, Notes: &notes, DecidedBy: actor.EmployeeID, DecidedAt: now}
		if err := insertNegotiationDecision(ctx, tx, prospectID, d); err != nil {
			return err
		}
		if err := s.auditNegotiation(ctx, tx, actor, prospectID, "negotiation_decision", d, now); err != nil {
			return err
		}

		neg, err = loadNegotiation(ctx, tx, prospectID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return neg, nil
}

// ---- read API ----------------------------------------------------------------

// GetNegotiation reads an attempt's negotiation record — header pointers plus
// the full immutable version and decision history (the Superior's
// Negotiation Detail Page and W1-09's closing preload both consume this).
//
// Permission (M0 §7.1, same as GetAttempt): Staff owner-only; Head/SPV Sales
// division-wide; OD read-only everywhere; Director full. Returns
// ErrNegotiationNotFound when the attempt exists but never entered
// Negotiation, ErrNotFound when the attempt itself doesn't exist.
func (s *Attempts) GetNegotiation(ctx context.Context, q db.Queryer, actor authz.Identity, prospectID string) (*Negotiation, error) {
	if !actor.Authenticated() {
		return nil, readDenied(actor)
	}
	att, err := loadAttempt(ctx, q, prospectID)
	if err != nil {
		return nil, err
	}
	if err := s.requireRead(actor, att.OwnerEmployeeID); err != nil {
		return nil, err
	}
	return loadNegotiation(ctx, q, prospectID)
}

func loadNegotiation(ctx context.Context, q db.Queryer, prospectID string) (*Negotiation, error) {
	var (
		n          Negotiation
		approvedV  sql.NullInt64
		approvedAt sql.NullTime
		approvedBy sql.NullString
	)
	err := q.QueryRowContext(ctx,
		`SELECT prospect_id, negotiation_required, current_version, approved_version, approved_at, approved_by, created_at, created_by
		 FROM negotiations WHERE prospect_id = ?`, prospectID,
	).Scan(&n.ProspectID, &n.NegotiationRequired, &n.CurrentVersion, &approvedV, &approvedAt, &approvedBy, &n.CreatedAt, &n.CreatedBy)
	if err == sql.ErrNoRows {
		return nil, ErrNegotiationNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("sales: load negotiation %s: %w", prospectID, err)
	}
	if approvedV.Valid {
		v := int(approvedV.Int64)
		n.ApprovedVersion = &v
	}
	if approvedAt.Valid {
		t := approvedAt.Time
		n.ApprovedAt = &t
	}
	if approvedBy.Valid {
		b := approvedBy.String
		n.ApprovedBy = &b
	}

	versionRowIDs := map[int64]int{} // negotiation_versions.id -> index in n.Versions
	rows, err := q.QueryContext(ctx,
		`SELECT id, version, kind, proposed_by, total_value, total_komisi, commission_pending, submitted_at
		 FROM negotiation_versions WHERE prospect_id = ? ORDER BY version`, prospectID)
	if err != nil {
		return nil, fmt.Errorf("sales: load negotiation versions %s: %w", prospectID, err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			rowID  int64
			v      NegotiationVersion
			komisi sql.NullString
		)
		if err := rows.Scan(&rowID, &v.Version, &v.Kind, &v.ProposedBy, &v.TotalValue, &komisi, &v.CommissionPending, &v.SubmittedAt); err != nil {
			return nil, fmt.Errorf("sales: scan negotiation version: %w", err)
		}
		if komisi.Valid {
			k := komisi.String
			v.TotalKomisi = &k
		}
		versionRowIDs[rowID] = len(n.Versions)
		n.Versions = append(n.Versions, v)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	svcRows, err := q.QueryContext(ctx,
		`SELECT nvs.negotiation_version_id, nvs.entry_id, nvs.msl_version_id, nvs.msl_version,
		        nvs.service_name, nvs.standard_price, nvs.standard_commission_rule,
		        nvs.proposed_price, nvs.commission_rule, nvs.komisi, nvs.commission_pending,
		        nvs.payment_terms, nvs.notes
		 FROM negotiation_version_services nvs
		 JOIN negotiation_versions nv ON nv.id = nvs.negotiation_version_id
		 WHERE nv.prospect_id = ?
		 ORDER BY nv.version, nvs.position`, prospectID)
	if err != nil {
		return nil, fmt.Errorf("sales: load negotiation services %s: %w", prospectID, err)
	}
	defer svcRows.Close()
	for svcRows.Next() {
		var (
			versionRowID  int64
			sv            NegotiationServiceView
			komisi, terms sql.NullString
			notes         sql.NullString
		)
		if err := svcRows.Scan(&versionRowID, &sv.EntryID, &sv.MSLVersionID, &sv.MSLVersion,
			&sv.Name, &sv.StandardPrice, &sv.StandardCommissionRule,
			&sv.ProposedPrice, &sv.CommissionRule, &komisi, &sv.CommissionPending,
			&terms, &notes); err != nil {
			return nil, fmt.Errorf("sales: scan negotiation service: %w", err)
		}
		if komisi.Valid {
			k := komisi.String
			sv.Komisi = &k
		}
		if terms.Valid {
			t := terms.String
			sv.PaymentTerms = &t
		}
		if notes.Valid {
			nt := notes.String
			sv.Notes = &nt
		}
		idx, ok := versionRowIDs[versionRowID]
		if !ok {
			return nil, fmt.Errorf("sales: negotiation service row references unknown version row %d", versionRowID)
		}
		n.Versions[idx].Services = append(n.Versions[idx].Services, sv)
	}
	if err := svcRows.Err(); err != nil {
		return nil, err
	}

	decRows, err := q.QueryContext(ctx,
		`SELECT version, action, notes, decided_by, decided_at
		 FROM negotiation_decisions WHERE prospect_id = ? ORDER BY id`, prospectID)
	if err != nil {
		return nil, fmt.Errorf("sales: load negotiation decisions %s: %w", prospectID, err)
	}
	defer decRows.Close()
	for decRows.Next() {
		var (
			d     NegotiationDecision
			notes sql.NullString
		)
		if err := decRows.Scan(&d.Version, &d.Action, &notes, &d.DecidedBy, &d.DecidedAt); err != nil {
			return nil, fmt.Errorf("sales: scan negotiation decision: %w", err)
		}
		if notes.Valid {
			nt := notes.String
			d.Notes = &nt
		}
		n.Decisions = append(n.Decisions, d)
	}
	if err := decRows.Err(); err != nil {
		return nil, err
	}
	return &n, nil
}
