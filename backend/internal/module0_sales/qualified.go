package sales

// qualified.go — W1-06 "Qualified Lead Form" (M0 §4.3 / §7; M4 §2-3 inherits
// these fields locked; docs/backlog/WAVE1 BACKLOG.md W1-06).
//
// Submit is the ONLY way a form row comes into existence: M0 §4 rule 1 —
// selecting `Qualified` opens the form and the status does not change until
// the form is successfully submitted; exiting without submit persists
// NOTHING and the attempt stays `Contacted`. Accordingly there is no draft
// state: a qualified_forms row is born at submit and born locked (rule 4),
// and every failed validation returns before any write with the byte-exact
// BI message.
//
// Atomicity note (single Engine.InTx transaction): W1-05's QualifyFromForm
// is the package's designated Contacted→Qualified path, but its signature
// (*sql.DB) opens its own transaction, so calling it after committing the
// form would leave a window where the form exists (with immutable audit
// rows) while the attempt is still `Contacted` — violating "no partial
// status change". SubmitQualifiedForm therefore executes the exact same
// edge — same requireWrite permission check, same
// statemachine.TransitionRequest{To: Qualified} against the same engine —
// INSIDE the one transaction that persists the form. This is not a second
// business path to `Qualified` (the form-gate is preserved: the transition
// only ever happens after full form validation and persistence); it is
// QualifyFromForm's edge executed transactionally. Flagged for
// docs/DECISIONS.md (see the W1-06 ticket report).

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/msl"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// MsgMaksimalLimaJasa is the byte-exact M0 §4 rule 2 message: more than 5
// services selected blocks the submission.
const MsgMaksimalLimaJasa = "[maksimal pilih 5 jasa saja!]"

// MaxQualifiedServices is the M0 §4 rule 2 cap on "Jasa Ditawarkan".
const MaxQualifiedServices = 5

// QualifiedPlatforms is the closed §4.3 "Platform List" checklist, byte-exact
// (per-platform sub-data downstream, M4-OA-2). Exported so the frontend/API
// layer can render the same closed set it will be validated against.
var QualifiedPlatforms = []string{"Shopee", "TikTok Shop", "Tokopedia", "Lazada", "Others"}

var qualifiedPlatformSet = func() map[string]bool {
	m := make(map[string]bool, len(QualifiedPlatforms))
	for _, p := range QualifiedPlatforms {
		m[p] = true
	}
	return m
}()

// ErrFormLocked is returned for any edit/resubmit of a Qualified Lead Form
// after submit (M0 §4 rule 4: data locks at submit; M4 §4 rule 1: Sales
// cannot modify identity data after the Qualified submit). The PRD specifies
// no BI message for this denial, so per the msg-package rule ("add new BI
// strings only with a PRD reference") this stays a typed sentinel; the UI
// copy is an open question for the PRD owner.
var ErrFormLocked = errors.New("sales: qualified form is locked after submit")

// ErrQualifiedFormNotFound is returned when reading/editing a form for an
// attempt that has not (successfully) submitted one.
var ErrQualifiedFormNotFound = errors.New("sales: qualified form not found")

// QualifiedFormInput is the salesperson-typed portion of the M0 §4.3 form.
// Estimasi Nilai Transaksi and Perhitungan Komisi are deliberately absent:
// they are system-computed and read-only (house convention #4) — there is no
// way to submit them.
type QualifiedFormInput struct {
	NamaToko       string   // mandatory
	NamaPIC        string   // mandatory — Nama (PIC klien), M4 §3
	LinkToko       string   // mandatory
	KategoriBisnis string   // mandatory (multiple choice; PRD publishes no closed list — stored verbatim)
	Kota           string   // mandatory
	PlatformList   []string // mandatory, >=1 of QualifiedPlatforms (checkbox set: no duplicates)
	// GMVSaatIni / TargetGMV / MarketingBudget are non-negative decimal
	// literals in IDR ("50000000.00"); MarketingBudget is optional (nil).
	GMVSaatIni      string
	TargetGMV       string
	MarketingBudget *string
	// ServiceEntryIDs are Master Service List service_entries.id values
	// ("Jasa Ditawarkan"), 1..MaxQualifiedServices, no duplicates (checkbox
	// set). Prices/commissions are resolved server-side from the MSL version
	// effective at the submit date — never taken from the client.
	ServiceEntryIDs []int64
}

// QualifiedServiceView is one selected service with the Master Service List
// version the money math locked onto (audit/recompute basis) and its
// snapshot values.
type QualifiedServiceView struct {
	EntryID        int64  // MSL service_entries.id
	VersionID      int64  // MSL service_entry_versions.id — the locked version
	Version        int    // that version's number, for display
	Name           string // snapshot
	StandardPrice  string // snapshot, decimal literal
	CommissionRule string // snapshot, rule JSON
	// Komisi is the evaluated per-service commission (decimal literal), nil
	// with CommissionPending=true when the rule is the pending_master_list
	// placeholder (never guessed — docs/HANDOFF.md, Build Plan R3).
	Komisi            *string
	CommissionPending bool
}

// KomisiIDR renders the per-service commission as `Rp. X.XXX.XXX,00`, or
// Dash when pending (§2.7).
func (v QualifiedServiceView) KomisiIDR() string {
	if v.Komisi == nil {
		return Dash
	}
	return FormatIDR(*v.Komisi)
}

// QualifiedForm is the read-side view of a submitted Qualified Lead Form —
// the locked client data M4's Client Record inherits at closing and the
// service/price baseline W1-07/08 negotiation starts from.
type QualifiedForm struct {
	ProspectID      string
	NamaToko        string
	NamaPIC         string
	LinkToko        string
	KategoriBisnis  string
	Kota            string
	PlatformList    []string
	GMVSaatIni      string  // decimal literal, IDR/bln
	TargetGMV       string  // decimal literal, IDR/bln
	MarketingBudget *string // decimal literal, nil when not provided

	// EstimasiNilaiTransaksi is the auto-computed, read-only Σ of the
	// selected services' standard prices at the MSL version effective on the
	// submit date (M0 §4 rule 3).
	EstimasiNilaiTransaksi string
	// Komisi is the auto-computed, read-only total Perhitungan Komisi
	// (decimal literal). nil with CommissionPending=true when >=1 selected
	// service still carries the pending_master_list placeholder — the total
	// cannot be summed until the Sales Head's validated list lands.
	Komisi            *string
	CommissionPending bool

	Locked      bool // always true in v1 (born locked at submit)
	SubmittedAt time.Time
	SubmittedBy string
	Services    []QualifiedServiceView
}

// EstimasiIDR renders Estimasi Nilai Transaksi as `Rp. X.XXX.XXX,00`.
func (f *QualifiedForm) EstimasiIDR() string { return FormatIDR(f.EstimasiNilaiTransaksi) }

// KomisiIDR renders total Perhitungan Komisi, or Dash while pending (§2.7).
func (f *QualifiedForm) KomisiIDR() string {
	if f.Komisi == nil {
		return Dash
	}
	return FormatIDR(*f.Komisi)
}

// validate runs the pure (no-DB) mandatory-field validation for M0 §4.3.
// Order: completeness/format first (default BI message), then the max-5
// rule with its own byte-exact message.
func (in QualifiedFormInput) validate() error {
	if in.NamaToko == "" || in.NamaPIC == "" || in.LinkToko == "" || in.KategoriBisnis == "" || in.Kota == "" {
		return validationErr()
	}
	if len(in.PlatformList) == 0 {
		return validationErr()
	}
	seenPlatform := make(map[string]bool, len(in.PlatformList))
	for _, p := range in.PlatformList {
		if !qualifiedPlatformSet[p] || seenPlatform[p] {
			return validationErr()
		}
		seenPlatform[p] = true
	}
	if _, ok := ParseDecimalCents(in.GMVSaatIni); !ok {
		return validationErr()
	}
	if _, ok := ParseDecimalCents(in.TargetGMV); !ok {
		return validationErr()
	}
	if in.MarketingBudget != nil {
		if _, ok := ParseDecimalCents(*in.MarketingBudget); !ok {
			return validationErr()
		}
	}
	if len(in.ServiceEntryIDs) == 0 {
		return validationErr()
	}
	if len(in.ServiceEntryIDs) > MaxQualifiedServices {
		return &ValidationError{Message: MsgMaksimalLimaJasa}
	}
	seenEntry := make(map[int64]bool, len(in.ServiceEntryIDs))
	for _, id := range in.ServiceEntryIDs {
		if id <= 0 || seenEntry[id] {
			return validationErr()
		}
		seenEntry[id] = true
	}
	return nil
}

// SubmitQualifiedForm validates and persists the Qualified Lead Form for a
// `Contacted` attempt and — in the SAME transaction — moves the attempt to
// `Qualified` through the state machine (see the package-top atomicity
// note). On any failure nothing is persisted, no audit row survives, and
// the attempt stays `Contacted` (M0 §4 rule 1).
//
// Rules enforced:
//   - Permission: package pattern (M0 §7.1) — Staff may submit only their
//     own attempt; Head/SPV Sales division-wide; Director full; OD denied
//     (read-only, even layered).
//   - Mandatory fields (§4.3) → `[data tidak lengkap, silahkan lengkapi
//     semua pertanyaan wajib!]`; >5 services → `[maksimal pilih 5 jasa
//     saja!]` (rule 2). Both with zero side effects.
//   - Estimasi Nilai Transaksi = Σ standard prices of the selected services
//     at the Master Service List version effective on the submit date
//     (msl.EffectiveAt); the exact version is referenced per service so the
//     number is permanently recomputable (house convention #4). An unknown,
//     not-yet-effective, or inactive service is not selectable → default BI
//     validation message.
//   - Perhitungan Komisi = Σ EvaluateCommissionRule per service; any
//     pending_master_list placeholder leaves the total NULL and flags
//     commission_pending — never guessed (docs/HANDOFF.md, Build Plan R3).
//   - On success the client data is locked (rule 4) and the attempt is
//     `Qualified`; both the form snapshot and the transition are audited
//     immutably.
//   - Resubmission (a form already exists) → ErrFormLocked.
//   - An attempt not currently `Contacted` is blocked by the engine itself
//     with the standard BI transition message, rolling back the form.
func (s *Attempts) SubmitQualifiedForm(ctx context.Context, conn *sql.DB, actor authz.Identity, prospectID string, in QualifiedFormInput) (*QualifiedForm, error) {
	if err := in.validate(); err != nil {
		return nil, err
	}
	roles := toStatemachineRoles(actor.Roles)

	var form *QualifiedForm
	err := s.engine.InTx(ctx, conn, func(tx *sql.Tx) error {
		att, err := loadAttemptForUpdate(ctx, tx, prospectID)
		if err != nil {
			return err
		}
		if err := s.requireWrite(actor, att.OwnerEmployeeID); err != nil {
			return err
		}

		var locked bool
		err = tx.QueryRowContext(ctx, `SELECT locked FROM qualified_forms WHERE prospect_id = ?`, prospectID).Scan(&locked)
		if err == nil {
			return ErrFormLocked // one submit per attempt; data locked at first submit
		}
		if err != sql.ErrNoRows {
			return fmt.Errorf("sales: check existing qualified form: %w", err)
		}

		now := time.Now().UTC()
		f, err := buildQualifiedForm(ctx, tx, prospectID, actor.EmployeeID, now, in)
		if err != nil {
			return err
		}
		if err := insertQualifiedForm(ctx, tx, f); err != nil {
			return err
		}

		after, err := json.Marshal(f)
		if err != nil {
			return fmt.Errorf("sales: marshal qualified form audit payload: %w", err)
		}
		if _, err := s.auditLg.Append(ctx, tx, audit.Entry{
			EntityType: "qualified_form",
			EntityID:   prospectID,
			Actor:      actor.EmployeeID,
			Action:     "qualified_form_submitted",
			After:      after,
			At:         now,
		}); err != nil {
			return fmt.Errorf("sales: audit qualified form submit: %w", err)
		}

		// QualifyFromForm's edge, executed inside this same transaction (see
		// the package-top atomicity note): same permission check above, same
		// TransitionRequest, same engine. The engine enforces that the
		// from-state really is `Contacted` and appends the immutable
		// transition audit row; any failure rolls back the form as well.
		if err := s.engine.Transition(ctx, tx, statemachine.TransitionRequest{
			EntityType: statemachine.EntityProspect,
			EntityID:   prospectID,
			To:         statemachine.ProspectQualified,
			Actor:      actor.EmployeeID,
			ActorRoles: roles,
		}); err != nil {
			return err
		}

		form = f
		return nil
	})
	if err != nil {
		return nil, err
	}
	return form, nil
}

// buildQualifiedForm resolves the Master Service List version effective at
// `now` for every selected service and computes the two read-only fields.
// Pure resolution/compute — no writes.
func buildQualifiedForm(ctx context.Context, q db.Queryer, prospectID, submittedBy string, now time.Time, in QualifiedFormInput) (*QualifiedForm, error) {
	gmvCents, _ := ParseDecimalCents(in.GMVSaatIni)   // validated in validate()
	targetCents, _ := ParseDecimalCents(in.TargetGMV) // validated in validate()
	f := &QualifiedForm{
		ProspectID:     prospectID,
		NamaToko:       in.NamaToko,
		NamaPIC:        in.NamaPIC,
		LinkToko:       in.LinkToko,
		KategoriBisnis: in.KategoriBisnis,
		Kota:           in.Kota,
		PlatformList:   append([]string(nil), in.PlatformList...),
		GMVSaatIni:     CentsToDecimal(gmvCents),
		TargetGMV:      CentsToDecimal(targetCents),
		Locked:         true,
		SubmittedAt:    now,
		SubmittedBy:    submittedBy,
	}
	if in.MarketingBudget != nil {
		mbCents, _ := ParseDecimalCents(*in.MarketingBudget) // validated in validate()
		mb := CentsToDecimal(mbCents)
		f.MarketingBudget = &mb
	}

	var (
		estimasiCents int64
		komisiCents   int64
		pending       bool
	)
	for _, entryID := range in.ServiceEntryIDs {
		v, err := msl.EffectiveAt(ctx, q, entryID, now)
		if err == msl.ErrNotFound {
			// Unknown service, or no version effective yet at the submit
			// date: not selectable from the list → invalid submission.
			return nil, validationErr()
		}
		if err != nil {
			return nil, fmt.Errorf("sales: resolve MSL version for entry %d: %w", entryID, err)
		}
		if !v.Active {
			// Inactive services are not offered on the form (Phase 0 §10
			// active flag) → invalid submission.
			return nil, validationErr()
		}
		priceCents, ok := ParseDecimalCents(v.StandardPrice)
		if !ok {
			return nil, fmt.Errorf("sales: MSL entry %d version %d has unparseable standard price %q", entryID, v.Version, v.StandardPrice)
		}
		if estimasiCents > math.MaxInt64-priceCents {
			return nil, fmt.Errorf("sales: estimasi nilai transaksi overflows for prospect %s", prospectID)
		}
		estimasiCents += priceCents

		amountCents, pend, err := EvaluateCommissionRule(v.CommissionRule, priceCents)
		if err != nil {
			return nil, err
		}
		sv := QualifiedServiceView{
			EntryID:           v.EntryID,
			VersionID:         v.ID,
			Version:           v.Version,
			Name:              v.Name,
			StandardPrice:     v.StandardPrice,
			CommissionRule:    v.CommissionRule,
			CommissionPending: pend,
		}
		if pend {
			pending = true
		} else {
			c := CentsToDecimal(amountCents)
			sv.Komisi = &c
			komisiCents += amountCents
		}
		f.Services = append(f.Services, sv)
	}

	f.EstimasiNilaiTransaksi = CentsToDecimal(estimasiCents)
	f.CommissionPending = pending
	if !pending {
		k := CentsToDecimal(komisiCents)
		f.Komisi = &k
	}
	return f, nil
}

func insertQualifiedForm(ctx context.Context, tx *sql.Tx, f *QualifiedForm) error {
	platforms, err := json.Marshal(f.PlatformList)
	if err != nil {
		return fmt.Errorf("sales: marshal platform list: %w", err)
	}
	var marketingBudget, komisi any
	if f.MarketingBudget != nil {
		marketingBudget = *f.MarketingBudget
	}
	if f.Komisi != nil {
		komisi = *f.Komisi
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO qualified_forms
			(prospect_id, nama_toko, nama_pic, link_toko, kategori_bisnis, kota, platform_list,
			 gmv_saat_ini, target_gmv, marketing_budget,
			 estimasi_nilai_transaksi, perhitungan_komisi, commission_pending, locked,
			 submitted_at, submitted_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
		f.ProspectID, f.NamaToko, f.NamaPIC, f.LinkToko, f.KategoriBisnis, f.Kota, string(platforms),
		f.GMVSaatIni, f.TargetGMV, marketingBudget,
		f.EstimasiNilaiTransaksi, komisi, f.CommissionPending,
		f.SubmittedAt, f.SubmittedBy,
	); err != nil {
		return fmt.Errorf("sales: insert qualified form: %w", err)
	}

	for i, sv := range f.Services {
		var svcKomisi any
		if sv.Komisi != nil {
			svcKomisi = *sv.Komisi
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO qualified_form_services
				(prospect_id, position, entry_id, version_id, version,
				 service_name, standard_price, commission_rule, komisi, commission_pending)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			f.ProspectID, i+1, sv.EntryID, sv.VersionID, sv.Version,
			sv.Name, sv.StandardPrice, sv.CommissionRule, svcKomisi, sv.CommissionPending,
		); err != nil {
			return fmt.Errorf("sales: insert qualified form service %d: %w", sv.EntryID, err)
		}
	}
	return nil
}

// GetQualifiedForm reads the submitted Qualified Lead Form for an attempt —
// the read API W1-07/08 (negotiation: previously selected services +
// standard prices/commissions) and W1-09/10 (closing / Client Record:
// locked client data) consume.
//
// Permission (M0 §7.1, same as GetAttempt): Staff owner-only; Head/SPV Sales
// division-wide; OD read-only everywhere; Director full. Returns
// ErrQualifiedFormNotFound when the attempt exists but never submitted a
// form, ErrNotFound when the attempt itself doesn't exist.
func (s *Attempts) GetQualifiedForm(ctx context.Context, q db.Queryer, actor authz.Identity, prospectID string) (*QualifiedForm, error) {
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
	return loadQualifiedForm(ctx, q, prospectID)
}

// UpdateQualifiedForm is the (only) edit API for the Qualified Lead Form,
// and in v1 it ALWAYS denies with ErrFormLocked once the form exists: a
// qualified_forms row is born locked at submit (M0 §4 rule 4), and Sales can
// never edit it again — M4 §4's post-close correction path (Account Lead /
// OD, logged) is ticket W1-11's scope and will key on the stored `locked`
// flag, not bypass this API. The input parameter is the future payload
// shape; it is deliberately not applied anywhere today.
//
// Permission runs first (package pattern), so a non-owner Staff/OD caller
// gets the authz denial rather than learning whether a form exists.
func (s *Attempts) UpdateQualifiedForm(ctx context.Context, conn *sql.DB, actor authz.Identity, prospectID string, _ QualifiedFormInput) error {
	if !actor.Authenticated() {
		return readDenied(actor)
	}
	return db.WithTx(ctx, conn, func(tx *sql.Tx) error {
		att, err := loadAttemptForUpdate(ctx, tx, prospectID)
		if err != nil {
			return err
		}
		if err := s.requireWrite(actor, att.OwnerEmployeeID); err != nil {
			return err
		}
		var locked bool
		err = tx.QueryRowContext(ctx, `SELECT locked FROM qualified_forms WHERE prospect_id = ?`, prospectID).Scan(&locked)
		if err == sql.ErrNoRows {
			return ErrQualifiedFormNotFound
		}
		if err != nil {
			return fmt.Errorf("sales: load qualified form lock: %w", err)
		}
		// Locked or not, v1 has no edit path: rows are always born locked,
		// and even a hypothetically unlocked row has no editable-field spec
		// until W1-11 (M4 lock matrix). Fail closed.
		return ErrFormLocked
	})
}

// loadAttemptForUpdate is loadAttempt with a row lock, serializing
// concurrent submits/edits/status changes on the same attempt within a
// transaction.
func loadAttemptForUpdate(ctx context.Context, tx *sql.Tx, prospectID string) (*Attempt, error) {
	row := tx.QueryRowContext(ctx, `SELECT `+selectAttemptCols+` FROM prospect_attempts WHERE prospect_id = ? FOR UPDATE`, prospectID)
	a, err := scanAttempt(row)
	if err == ErrNotFound {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("sales: load attempt %s for update: %w", prospectID, err)
	}
	return a, nil
}

func loadQualifiedForm(ctx context.Context, q db.Queryer, prospectID string) (*QualifiedForm, error) {
	var (
		f            QualifiedForm
		platformsRaw string
		budget       sql.NullString
		komisi       sql.NullString
	)
	err := q.QueryRowContext(ctx,
		`SELECT prospect_id, nama_toko, nama_pic, link_toko, kategori_bisnis, kota, platform_list,
		        gmv_saat_ini, target_gmv, marketing_budget,
		        estimasi_nilai_transaksi, perhitungan_komisi, commission_pending, locked,
		        submitted_at, submitted_by
		 FROM qualified_forms WHERE prospect_id = ?`, prospectID,
	).Scan(&f.ProspectID, &f.NamaToko, &f.NamaPIC, &f.LinkToko, &f.KategoriBisnis, &f.Kota, &platformsRaw,
		&f.GMVSaatIni, &f.TargetGMV, &budget,
		&f.EstimasiNilaiTransaksi, &komisi, &f.CommissionPending, &f.Locked,
		&f.SubmittedAt, &f.SubmittedBy)
	if err == sql.ErrNoRows {
		return nil, ErrQualifiedFormNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("sales: load qualified form %s: %w", prospectID, err)
	}
	if err := json.Unmarshal([]byte(platformsRaw), &f.PlatformList); err != nil {
		return nil, fmt.Errorf("sales: decode platform list for %s: %w", prospectID, err)
	}
	if budget.Valid {
		v := budget.String
		f.MarketingBudget = &v
	}
	if komisi.Valid {
		v := komisi.String
		f.Komisi = &v
	}

	rows, err := q.QueryContext(ctx,
		`SELECT entry_id, version_id, version, service_name, standard_price, commission_rule, komisi, commission_pending
		 FROM qualified_form_services WHERE prospect_id = ? ORDER BY position`, prospectID)
	if err != nil {
		return nil, fmt.Errorf("sales: load qualified form services %s: %w", prospectID, err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			sv        QualifiedServiceView
			svcKomisi sql.NullString
		)
		if err := rows.Scan(&sv.EntryID, &sv.VersionID, &sv.Version, &sv.Name, &sv.StandardPrice, &sv.CommissionRule, &svcKomisi, &sv.CommissionPending); err != nil {
			return nil, fmt.Errorf("sales: scan qualified form service: %w", err)
		}
		if svcKomisi.Valid {
			v := svcKomisi.String
			sv.Komisi = &v
		}
		f.Services = append(f.Services, sv)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &f, nil
}
