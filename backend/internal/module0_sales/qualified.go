package module0_sales

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/admin"
	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
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
type ServiceSelection struct {
	MasterServiceID string `json:"master_service_id"`
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
	// snapshot is what gets persisted, so it stays recomputable forever.
	today := time.Now().UTC().Format("2006-01-02")
	type pinned struct {
		id, name, price, rule string
		versionNo             int
	}
	pins := make([]pinned, 0, len(form.Services))
	for _, sel := range form.Services {
		if strings.TrimSpace(sel.MasterServiceID) == "" {
			return ErrIncomplete
		}
		v, err := admin.EffectiveAt(ctx, s.DB, sel.MasterServiceID, today)
		if err != nil {
			return fmt.Errorf("resolve master service %s: %w", sel.MasterServiceID, err)
		}
		// Validate the commission rule parses (never persist a bad rule).
		if _, err := ParseCommissionRule(v.CommissionRule); err != nil {
			return err
		}
		pins = append(pins, pinned{v.ID, v.Name, v.StandardPrice, v.CommissionRule, v.VersionNo})
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
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO qualified_form_services
			   (attempt_id, master_service_id, master_version_no, name, standard_price, commission_rule, created_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			attemptID, p.id, p.versionNo, p.name, p.price, p.rule, actor.EmployeeID); err != nil {
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
