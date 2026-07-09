// Package module5_finance holds Module 5 (Admin & Finance) domain logic. This
// file is the payment-verification money math (W1-14, W1-15, W1-16):
//
//   - Amount Verified / Amount Outstanding (auto, read-only; CLAUDE.md #4).
//   - Transaction rollup to [Lunas] ONLY when all installments are
//     [Terverifikasi] (STATE_MACHINES.md §5).
//   - Over-verification guard and Termin-schedule sum validation.
//   - The routing gate predicate (first verification releases the client).
//
// The transaction/installment STATUS columns are still written exclusively by
// the state-machine engine; DesiredStatus computes the *target* the persistence
// layer should drive the machine toward, it never mutates status itself.
package module5_finance

import (
	"errors"

	"github.com/meagrup/agencyapp/backend/internal/core/money"
)

// Installment statuses (STATE_MACHINES.md §5, config.go MInstallment).
const (
	InstBelumJatuhTempo = "[Belum Jatuh Tempo]"
	InstJatuhTempo      = "[Jatuh Tempo]"
	InstTerverifikasi   = "[Terverifikasi]"
)

// Transaction payment statuses (STATE_MACHINES.md §4, config.go MTransactionPayment).
const (
	TrxMenungguVerifikasi    = "[Menunggu Verifikasi]"
	TrxTerverifikasiSebagian = "[Terverifikasi - Sebagian]"
	TrxLunas                 = "[Lunas]"
)

// Exact Bahasa Indonesia messages (M5 §3–4, PRD-verbatim).
const (
	TerminMismatchMessage = "[total termin tidak sama dengan nilai transaksi]"
	OverVerifiedMessage   = "[jumlah melebihi total transaksi, periksa kembali]"
)

// Sentinel errors.
var (
	ErrTerminMismatch = errors.New(TerminMismatchMessage)
	ErrOverVerified   = errors.New(OverVerifiedMessage)
	ErrEmptySchedule  = errors.New("[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]")
)

// Installment is one INST- row's money + verification state.
type Installment struct {
	ID     string      `json:"id"`
	Amount money.Money `json:"-"`
	Status string      `json:"status"`
}

// Verified reports whether this installment has been verified.
func (i Installment) Verified() bool { return i.Status == InstTerverifikasi }

// Transaction is the money aggregate of a TRX- and its installments.
//
// Installments carry the Termin / Bayar-di-Belakang schedule. DirectVerified
// carries verified receipts NOT tied to an installment row — the single full
// payment of the Lunas scheme, or the upfront partial of Bayar Sebagian.
type Transaction struct {
	Total          money.Money
	Installments   []Installment
	DirectVerified money.Money
}

// AmountVerified = Σ verified installment amounts + direct verified receipts.
func (t Transaction) AmountVerified() money.Money {
	sum := t.DirectVerified
	for _, i := range t.Installments {
		if i.Verified() {
			sum += i.Amount
		}
	}
	return sum
}

// AmountOutstanding = Total − Amount Verified.
func (t Transaction) AmountOutstanding() money.Money {
	return t.Total - t.AmountVerified()
}

// AllInstallmentsVerified reports whether there is a schedule and every row in
// it is [Terverifikasi]. False when there are no installment rows.
func (t Transaction) AllInstallmentsVerified() bool {
	if len(t.Installments) == 0 {
		return false
	}
	for _, i := range t.Installments {
		if !i.Verified() {
			return false
		}
	}
	return true
}

// DesiredStatus computes the correct payment status from verified money and
// installment completeness. Rollup rule (STATE_MACHINES.md §5): [Lunas] only
// when all installments are [Terverifikasi]; schedule-less schemes reach
// [Lunas] when verified reaches the total.
func (t Transaction) DesiredStatus() string {
	v := t.AmountVerified()
	if v <= 0 {
		return TrxMenungguVerifikasi
	}
	if len(t.Installments) > 0 {
		if t.AllInstallmentsVerified() {
			return TrxLunas
		}
		return TrxTerverifikasiSebagian
	}
	if v >= t.Total {
		return TrxLunas
	}
	return TrxTerverifikasiSebagian
}

// ValidateTerminSchedule enforces that the installment amounts sum EXACTLY to
// the transaction total and each is positive (M5 §4 Rule 3).
func ValidateTerminSchedule(total money.Money, insts []Installment) error {
	if len(insts) == 0 {
		return ErrEmptySchedule
	}
	sum := money.Money(0)
	for _, i := range insts {
		if i.Amount <= 0 {
			return ErrEmptySchedule
		}
		sum += i.Amount
	}
	if sum != total {
		return ErrTerminMismatch
	}
	return nil
}

// CheckVerification guards a single verification event against over-payment
// (M5 §3 Rule 4): a receipt that would push Amount Verified beyond the total is
// blocked. amount must be positive.
func CheckVerification(total, alreadyVerified, amount money.Money) error {
	if amount <= 0 {
		return ErrEmptySchedule
	}
	if alreadyVerified+amount > total {
		return ErrOverVerified
	}
	return nil
}

// ReleasesToAccount reports whether a payment-status transition is the routing
// gate — the FIRST move out of [Menunggu Verifikasi] into a verified state
// releases the client to Account intake (M5 §5, M5-OA-1). The caller still
// guards "fires exactly once" via the persisted released_to_account_at.
func ReleasesToAccount(from, to string) bool {
	return from == TrxMenungguVerifikasi &&
		(to == TrxTerverifikasiSebagian || to == TrxLunas)
}
