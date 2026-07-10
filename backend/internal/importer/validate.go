package importer

// validate.go holds the PURE per-row validation used identically by DryRun (to
// classify a row) and by Apply (to fail a row BEFORE any DB write, so a bad row
// never lands). Every message is sourced from an existing engine constant — no
// new BI strings are minted here.

import (
	"errors"
	"strings"

	"github.com/meagrup/agencyapp/backend/internal/module0_sales"
	"github.com/meagrup/agencyapp/backend/internal/module1_leads"
	"github.com/meagrup/agencyapp/backend/internal/module5_finance"
)

// errLeadIncomplete uses the M1 IMPORT-channel wording (baris tidak diimport),
// distinct from the single-registration default (DECISIONS O11).
var errLeadIncomplete = errors.New(module1_leads.MsgRowIncomplete)

// errClientIncomplete uses the house default incomplete message.
var errClientIncomplete = errors.New(module0_sales.IncompleteMessage)

// validScheme reports whether s is exactly one of the four M4 §5 payment schemes.
func validScheme(s string) bool {
	switch s {
	case module5_finance.SchemeLunas, module5_finance.SchemeBayarSebagian,
		module5_finance.SchemeTermin, module5_finance.SchemeBayarDiBelakang:
		return true
	}
	return false
}

// mapLeadStatus maps a spreadsheet status_terakhir to a lead_record status.
// Empty defaults to [Pool]. Returns ok=false for an unrecognised value.
func mapLeadStatus(s string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "pool":
		return module1_leads.StatusPool, true // "[Pool]"
	case "diproses", "active":
		return module1_leads.StatusActive, true // "active"
	case "not-qualified", "not qualified":
		return module1_leads.StatusNotQualified, true // "[Not Qualified]"
	case "rejected":
		return module1_leads.StatusRejected, true // "[Rejected]"
	}
	return "", false
}

// validateLeadRow checks the mandatory lead fields (mirrors module1_leads
// RegisterInput.valid: name, phone, source) plus a recognisable status.
func validateLeadRow(row LeadRow) error {
	if strings.TrimSpace(row.NamaLead) == "" ||
		strings.TrimSpace(row.NoTelepon) == "" ||
		strings.TrimSpace(row.Sumber) == "" {
		return errLeadIncomplete
	}
	if _, ok := mapLeadStatus(row.StatusTerakhir); !ok {
		return errLeadIncomplete
	}
	// A phone that normalises to nothing cannot be deduped.
	if module1_leads.NormalizePhone(row.NoTelepon) == "" {
		return errLeadIncomplete
	}
	return nil
}

// validateClientRow runs every client-side rule with its own BI message:
//   - mandatory scalar fields + a valid scheme + at least one priced service,
//   - Sales Allocation Σ=100% (module0_sales.ClosingParties.Validate),
//   - the installment schedule Σ = total (module5_finance.ValidateTerminSchedule),
//   - the verified-payment plan (validatePayments), incl. the [Lunas] contract gate.
//
// It writes nothing; it is the atomicity guarantee for Apply (a row that fails
// here is rejected before a single INSERT).
func validateClientRow(row ClientRow) error {
	if strings.TrimSpace(row.Toko) == "" ||
		strings.TrimSpace(row.NamaPIC) == "" ||
		strings.TrimSpace(row.Kota) == "" ||
		strings.TrimSpace(row.LinkToko) == "" ||
		strings.TrimSpace(row.Kategori) == "" ||
		strings.TrimSpace(row.SalesPIC) == "" {
		return errClientIncomplete
	}
	if row.TanggalClosing.IsZero() {
		return errClientIncomplete
	}
	if row.NilaiTransaksiTotal <= 0 {
		return errClientIncomplete
	}
	if !validScheme(row.SkemaPembayaran) {
		return errClientIncomplete
	}
	if len(row.Layanan) == 0 {
		return errClientIncomplete
	}
	for _, svc := range row.Layanan {
		if strings.TrimSpace(svc.Nama) == "" || svc.HargaDeal <= 0 {
			return errClientIncomplete
		}
	}

	// Sales Allocation Σ=100% (+ max 5, primary member, PIC member) — reuse M0.
	if err := row.closingParties().Validate(); err != nil {
		return err // AllocationTotalMessage / TooManySalespeopleMessage / IncompleteMessage
	}

	// Installment schedule (only Termin / Bayar di Belakang carry one).
	if err := validateSchedule(row); err != nil {
		return err
	}

	// Already-verified payments + [Lunas] contract gate.
	return validatePayments(row)
}

// validateSchedule enforces the schedule shape per scheme (M5 §4), reusing the
// frozen sum validation.
func validateSchedule(row ClientRow) error {
	switch row.SkemaPembayaran {
	case module5_finance.SchemeTermin:
		if len(row.JadwalTermin) == 0 {
			return errClientIncomplete
		}
		insts := make([]module5_finance.Installment, len(row.JadwalTermin))
		for i, t := range row.JadwalTermin {
			if t.DueDate.IsZero() {
				return errClientIncomplete
			}
			insts[i] = module5_finance.Installment{Amount: t.Amount}
		}
		// Σ termin must EXACTLY equal the transaction total.
		if err := module5_finance.ValidateTerminSchedule(row.NilaiTransaksiTotal, insts); err != nil {
			return err // ErrTerminMismatch / ErrEmptySchedule
		}
	case module5_finance.SchemeBayarDiBelakang:
		// Exactly one installment equal to the total (M5 §4 Rule 4).
		if len(row.JadwalTermin) != 1 || row.JadwalTermin[0].DueDate.IsZero() {
			return errClientIncomplete
		}
		if row.JadwalTermin[0].Amount != row.NilaiTransaksiTotal {
			return module5_finance.ErrTerminMismatch
		}
	default:
		// Lunas / Bayar Sebagian have no installment schedule; ignore JadwalTermin.
	}
	return nil
}

// validatePayments pre-checks the already-verified payments so the post-commit
// replay through module5_finance.Verify is guaranteed to succeed:
//   - each payment positive + dated,
//   - Σ verified ≤ total (over-verification guard),
//   - Termin/Bayar-di-Belakang: each verified payment matches an installment
//     amount in order and in full (per-installment partials unsupported, M5 §7),
//   - the [Lunas] contract gate: a plan that fully settles the transaction needs
//     a contract link (M5 §7 Rule 2) — the exact PRD-verbatim message.
func validatePayments(row ClientRow) error {
	total := row.NilaiTransaksiTotal
	var sum int64
	for _, p := range row.PembayaranTerverifikasi {
		if p.Amount <= 0 || p.Tanggal.IsZero() {
			return errClientIncomplete
		}
		sum += int64(p.Amount)
	}
	if sum > int64(total) {
		return module5_finance.ErrOverVerified
	}

	reachesLunas := false
	switch row.SkemaPembayaran {
	case module5_finance.SchemeTermin:
		if len(row.PembayaranTerverifikasi) > len(row.JadwalTermin) {
			return module5_finance.ErrOverVerified
		}
		for i, p := range row.PembayaranTerverifikasi {
			if p.Amount != row.JadwalTermin[i].Amount {
				return module5_finance.ErrInstallmentAmount
			}
		}
		reachesLunas = len(row.PembayaranTerverifikasi) == len(row.JadwalTermin) &&
			len(row.JadwalTermin) > 0
	case module5_finance.SchemeBayarDiBelakang:
		if len(row.PembayaranTerverifikasi) > 1 {
			return module5_finance.ErrOverVerified
		}
		if len(row.PembayaranTerverifikasi) == 1 &&
			row.PembayaranTerverifikasi[0].Amount != total {
			return module5_finance.ErrInstallmentAmount
		}
		reachesLunas = len(row.PembayaranTerverifikasi) == 1
	default: // Lunas / Bayar Sebagian — direct verifications
		reachesLunas = sum == int64(total)
	}

	if reachesLunas && strings.TrimSpace(row.LinkKontrak) == "" {
		return module5_finance.ErrContractRequired // MsgContractRequired (PRD-verbatim)
	}
	return nil
}
