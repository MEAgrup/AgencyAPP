package module0_sales

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/admin"
	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/tz"
)

// NQ taxonomy (M1-OA-8): seven closed reasons; "[Lainnya ...]" requires free
// text, stored as `[Lainnya ...] <teks>` in the same column. Verbatim BI.
const (
	NQBukanSeller  = "[Bukan seller]"
	NQKontakSalah  = "[Kontak salah/tidak valid]"
	NQSpamDuplikat = "[Spam/duplikat]"
	NQSudahKlien   = "[Sudah jadi klien]"
	NQTidakBudget  = "[Tidak ada budget]"
	NQTidakRespon  = "[Tidak ada respon]"
	NQLainnya      = "[Lainnya ...]"
)

var nqClosedReasons = map[string]bool{
	NQBukanSeller: true, NQKontakSalah: true, NQSpamDuplikat: true,
	NQSudahKlien: true, NQTidakBudget: true, NQTidakRespon: true, NQLainnya: true,
}

// ServiceSelection is one service chosen on the Qualified Form (by master id).
// Quantity feeds the MSL v2 calculator (omitted / 0 defaults to 1); Amount is
// the passthrough rupiah value entered by sales (passthrough mode only).
type ServiceSelection struct {
	MasterServiceID string `json:"master_service_id"`
	Quantity        int64  `json:"quantity"`
	Amount          string `json:"amount"`
}

// LineFromView resolves an MSL v2 effective version plus the sales-entered
// quantity / passthrough amount into a ServiceLine (name, unit price, commission
// rule and calculator params pinned from the version). Passthrough requires a
// parseable amount > 0; non-passthrough ignores the amount.
func LineFromView(v admin.ServiceView, quantity int64, amount string) (ServiceLine, error) {
	price, err := money.Parse(v.StandardPrice)
	if err != nil {
		return ServiceLine{}, err
	}
	rule, err := ParseCommissionRule(v.CommissionRule)
	if err != nil {
		return ServiceLine{}, err
	}
	mode := v.PricingMode
	if mode == "" {
		mode = PricingFlat
	}
	line := ServiceLine{
		ServiceID: v.ID, VersionNo: v.VersionNo, Name: v.Name, StandardPrice: price,
		Unit: v.Unit, Mode: mode, Quantity: quantity, ApplyPPN: v.ApplyPPN, Rule: rule,
	}
	switch mode {
	case PricingMinFloor, PricingBatchCeiling:
		mq, ok := parseWholeQty(v.MinQty)
		if !ok {
			return ServiceLine{}, ErrIncomplete
		}
		line.MinQty = mq
	case PricingPassthrough:
		amt, err := money.Parse(amount)
		if err != nil || amt <= 0 {
			return ServiceLine{}, ErrIncomplete
		}
		line.InputAmount = amt
	}
	return line, nil
}

// resolveLines resolves each selection against the MSL version effective today.
func (s *Service) resolveLines(ctx context.Context, selections []ServiceSelection) ([]ServiceLine, error) {
	today := tz.BusinessDate(time.Now()).Format("2006-01-02") // WIB effective date (DECISIONS O20)
	lines := make([]ServiceLine, 0, len(selections))
	for _, sel := range selections {
		if strings.TrimSpace(sel.MasterServiceID) == "" {
			return nil, ErrIncomplete
		}
		v, err := admin.EffectiveAt(ctx, s.DB, sel.MasterServiceID, today)
		if err != nil {
			return nil, fmt.Errorf("resolve master service %s: %w", sel.MasterServiceID, err)
		}
		line, err := LineFromView(v, sel.Quantity, sel.Amount)
		if err != nil {
			return nil, err
		}
		lines = append(lines, line)
	}
	return lines, nil
}

// PreviewQuote computes a read-only quote (Estimasi Nilai + komisi) for a set of
// selections against the MSL version effective today, without persisting. The
// 1..MaxServices cap is enforced by BuildQuote with the verbatim BI message.
func (s *Service) PreviewQuote(ctx context.Context, selections []ServiceSelection) (Quote, error) {
	lines, err := s.resolveLines(ctx, selections)
	if err != nil {
		return Quote{}, err
	}
	return BuildQuote(lines)
}

// QualifiedForm captures the client draft (M0 §4) plus selected services. The
// commission is NEVER user-typed: it is pinned from the Master Service List
// version effective at submit date (W1-06).
type QualifiedForm struct {
	NamaPIC         string             `json:"nama_pic"`
	Toko            string             `json:"toko"`
	Kota            string             `json:"kota"`
	LinkToko        string             `json:"link_toko"`
	Kategori        string             `json:"kategori"`
	Platform        string             `json:"platform"`
	StoreLink       string             `json:"store_link"`
	GMVBaseline     string             `json:"gmv_baseline"`
	TargetGMV       string             `json:"target_gmv"`
	MarketingBudget string             `json:"marketing_budget"`
	Services        []ServiceSelection `json:"services"`
}

func (f QualifiedForm) valid() bool {
	return f.NamaPIC != "" && f.Toko != "" && f.Kota != "" && f.LinkToko != "" &&
		f.Kategori != "" && f.Platform != "" && f.GMVBaseline != "" && f.TargetGMV != ""
}

// MarkContacted advances a New Lead attempt to Contacted (M0 §4 — a real
// action was logged). Owner (or Sales Lead/Director) only.
func (s *Service) MarkContacted(ctx context.Context, actor permission.Actor, attemptID string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	a, err := loadAttempt(ctx, tx, attemptID, true)
	if err != nil {
		return err
	}
	if !canWriteAttempt(actor, a.ownerID) {
		return &blockedError{msgDenied}
	}
	if err := s.transition(ctx, tx, attemptID, StatusContacted, actor); err != nil {
		return err
	}
	return tx.Commit()
}

// SubmitQualifiedForm submits the Qualified Lead Form (M0 §4). It resolves each
// selected service against the MSL version effective now (pinning name, price
// and commission_rule), enforces the 1..5 service cap, persists the form + its
// service lines, and transitions the attempt Contacted → Qualified — all in the
// submit transaction so the status never advances before a successful submit.
func (s *Service) SubmitQualifiedForm(ctx context.Context, actor permission.Actor, attemptID string, form QualifiedForm) error {
	if !form.valid() {
		return ErrIncomplete
	}
	if len(form.Services) == 0 {
		return ErrNoServices
	}
	if len(form.Services) > MaxServices {
		return ErrTooManyServices
	}

	// Resolve MSL versions (reads) before the write transaction; the pinned
	// snapshot (params + computed subtotal) is what gets persisted, so each line
	// stays recomputable forever.
	lines, err := s.resolveLines(ctx, form.Services)
	if err != nil {
		return err
	}
	type pinned struct {
		line     ServiceLine
		subtotal money.Money
	}
	pins := make([]pinned, 0, len(lines))
	for _, l := range lines {
		subtotal, err := l.Subtotal()
		if err != nil {
			return err
		}
		pins = append(pins, pinned{l, subtotal})
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	a, err := loadAttempt(ctx, tx, attemptID, true)
	if err != nil {
		return err
	}
	if !canWriteAttempt(actor, a.ownerID) {
		return &blockedError{msgDenied}
	}

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO qualified_forms
		   (attempt_id, lead_id, nama_pic, toko, kota, link_toko, kategori,
		    gmv_baseline, target_gmv, marketing_budget, platform, store_link, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		attemptID, a.leadID, form.NamaPIC, form.Toko, form.Kota, form.LinkToko, form.Kategori,
		form.GMVBaseline, form.TargetGMV, nullDecimal(form.MarketingBudget), form.Platform,
		nullString(form.StoreLink), actor.EmployeeID); err != nil {
		return err
	}
	for _, p := range pins {
		l := p.line
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO qualified_form_services
			   (attempt_id, master_service_id, master_version_no, name, standard_price, commission_rule,
			    quantity, input_amount, unit, min_qty, pricing_mode, apply_ppn, subtotal, created_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			attemptID, l.ServiceID, l.VersionNo, l.Name, l.StandardPrice.Decimal(), l.Rule.String(),
			l.params().Quantity, inputAmountValue(l), nullString(l.Unit), minQtyValue(l.MinQty),
			l.Mode, tinyBool(l.ApplyPPN), p.subtotal.Decimal(), actor.EmployeeID); err != nil {
			return err
		}
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "prospect_attempt", EntityID: attemptID, Actor: actor.EmployeeID,
		Action: "qualified_form_submit",
		After:  map[string]any{"toko": form.Toko, "services": len(pins)},
	}); err != nil {
		return err
	}
	if err := s.transition(ctx, tx, attemptID, StatusQualified, actor); err != nil {
		return err
	}
	return tx.Commit()
}

// SetNotQualified closes a Contacted attempt as Not Qualified with a mandatory
// reason from the closed NQ taxonomy (M1-OA-8). "[Lainnya ...]" requires free
// text, persisted as `[Lainnya ...] <teks>`.
func (s *Service) SetNotQualified(ctx context.Context, actor permission.Actor, attemptID string, reasons []string, lainnyaText string) error {
	if len(reasons) == 0 {
		return ErrIncomplete
	}
	stored := make([]string, 0, len(reasons))
	for _, r := range reasons {
		if !nqClosedReasons[r] {
			return ErrIncomplete
		}
		if r == NQLainnya {
			if strings.TrimSpace(lainnyaText) == "" {
				return ErrIncomplete
			}
			stored = append(stored, NQLainnya+" "+strings.TrimSpace(lainnyaText))
			continue
		}
		stored = append(stored, r)
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	a, err := loadAttempt(ctx, tx, attemptID, true)
	if err != nil {
		return err
	}
	if !canWriteAttempt(actor, a.ownerID) {
		return &blockedError{msgDenied}
	}
	for _, r := range stored {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO prospect_attempt_nq_reasons (attempt_id, reason, created_by) VALUES (?, ?, ?)`,
			attemptID, r, actor.EmployeeID); err != nil {
			return err
		}
	}
	if err := s.transition(ctx, tx, attemptID, StatusNotQualified, actor); err != nil {
		return err
	}
	return tx.Commit()
}

func nullString(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func nullDecimal(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

// inputAmountValue stores the passthrough amount, NULL for other modes.
func inputAmountValue(l ServiceLine) any {
	if l.Mode == PricingPassthrough {
		return l.InputAmount.Decimal()
	}
	return nil
}

// minQtyValue stores a positive min_qty, NULL when the mode has no floor/batch.
func minQtyValue(minQty int64) any {
	if minQty <= 0 {
		return nil
	}
	return fmt.Sprintf("%d", minQty)
}

func tinyBool(b bool) int {
	if b {
		return 1
	}
	return 0
}
