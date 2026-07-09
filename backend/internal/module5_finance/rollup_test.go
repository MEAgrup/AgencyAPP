package module5_finance

import (
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/money"
)

func rp(t *testing.T, s string) money.Money {
	t.Helper()
	m, err := money.Parse(s)
	if err != nil {
		t.Fatalf("money.Parse(%q): %v", s, err)
	}
	return m
}

// TestAlphaDigitalTermin — M5 worked example: TRX 45.000.000, 3×15.000.000.
func TestAlphaDigitalTermin(t *testing.T) {
	total := rp(t, "45000000.00")
	amt := rp(t, "15000000.00")
	inst := func(id, status string) Installment { return Installment{ID: id, Amount: amt, Status: status} }

	// Schedule sums to total.
	sched := []Installment{inst("INST-1", InstBelumJatuhTempo), inst("INST-2", InstBelumJatuhTempo), inst("INST-3", InstBelumJatuhTempo)}
	if err := ValidateTerminSchedule(total, sched); err != nil {
		t.Fatalf("valid schedule rejected: %v", err)
	}

	// Nothing verified yet.
	trx := Transaction{Total: total, Installments: sched}
	if got := trx.DesiredStatus(); got != TrxMenungguVerifikasi {
		t.Errorf("initial status = %q, want %q", got, TrxMenungguVerifikasi)
	}
	if trx.AmountOutstanding() != total {
		t.Errorf("outstanding = %s, want %s", trx.AmountOutstanding().Format(), total.Format())
	}

	// Verify installment 1 -> partial, gate fires.
	trx.Installments[0].Status = InstTerverifikasi
	if got := trx.DesiredStatus(); got != TrxTerverifikasiSebagian {
		t.Errorf("after INST-1 status = %q, want %q", got, TrxTerverifikasiSebagian)
	}
	if trx.AmountVerified().Format() != "Rp. 15.000.000,00" {
		t.Errorf("verified = %q, want Rp. 15.000.000,00", trx.AmountVerified().Format())
	}
	if trx.AmountOutstanding().Format() != "Rp. 30.000.000,00" {
		t.Errorf("outstanding = %q, want Rp. 30.000.000,00", trx.AmountOutstanding().Format())
	}
	if !ReleasesToAccount(TrxMenungguVerifikasi, trx.DesiredStatus()) {
		t.Error("first partial verification should release client to Account")
	}

	// Verify installment 2 -> still partial (rollup rule: NOT all verified).
	trx.Installments[1].Status = InstTerverifikasi
	if got := trx.DesiredStatus(); got != TrxTerverifikasiSebagian {
		t.Errorf("after INST-2 status = %q, want %q (only 2/3 verified)", got, TrxTerverifikasiSebagian)
	}

	// Verify installment 3 -> Lunas.
	trx.Installments[2].Status = InstTerverifikasi
	if got := trx.DesiredStatus(); got != TrxLunas {
		t.Errorf("after all verified status = %q, want %q", got, TrxLunas)
	}
	if trx.AmountOutstanding() != 0 {
		t.Errorf("outstanding = %s, want Rp. 0,00", trx.AmountOutstanding().Format())
	}
	// A later verification (2nd/3rd) must NOT re-fire the gate.
	if ReleasesToAccount(TrxTerverifikasiSebagian, TrxLunas) {
		t.Error("gate must not fire on a non-first transition")
	}
}

// TestUnicornBayarSebagian — TRX 30.000.000, 10.000.000 upfront, open remainder.
func TestUnicornBayarSebagian(t *testing.T) {
	trx := Transaction{Total: rp(t, "30000000.00"), DirectVerified: rp(t, "10000000.00")}
	if got := trx.DesiredStatus(); got != TrxTerverifikasiSebagian {
		t.Errorf("status = %q, want %q", got, TrxTerverifikasiSebagian)
	}
	if trx.AmountVerified().Format() != "Rp. 10.000.000,00" {
		t.Errorf("verified = %q", trx.AmountVerified().Format())
	}
	if trx.AmountOutstanding().Format() != "Rp. 20.000.000,00" {
		t.Errorf("outstanding = %q, want Rp. 20.000.000,00", trx.AmountOutstanding().Format())
	}
	// No installment schedule -> never auto-Lunas until a top-up closes it.
	if trx.AllInstallmentsVerified() {
		t.Error("no installments -> AllInstallmentsVerified must be false")
	}
	if !ReleasesToAccount(TrxMenungguVerifikasi, trx.DesiredStatus()) {
		t.Error("partial payment should release to Account")
	}
}

// TestSiniStoreLunas — TRX 20.000.000 paid in full in one shot.
func TestSiniStoreLunas(t *testing.T) {
	trx := Transaction{Total: rp(t, "20000000.00"), DirectVerified: rp(t, "20000000.00")}
	if got := trx.DesiredStatus(); got != TrxLunas {
		t.Errorf("status = %q, want %q", got, TrxLunas)
	}
	if trx.AmountOutstanding() != 0 {
		t.Errorf("outstanding = %s, want Rp. 0,00", trx.AmountOutstanding().Format())
	}
	if !ReleasesToAccount(TrxMenungguVerifikasi, TrxLunas) {
		t.Error("full payment should release to Account")
	}
}

func TestValidateTerminSchedule(t *testing.T) {
	total := rp(t, "45000000.00")
	good := []Installment{{Amount: rp(t, "15000000.00")}, {Amount: rp(t, "15000000.00")}, {Amount: rp(t, "15000000.00")}}
	if err := ValidateTerminSchedule(total, good); err != nil {
		t.Errorf("good schedule rejected: %v", err)
	}
	short := []Installment{{Amount: rp(t, "15000000.00")}, {Amount: rp(t, "15000000.00")}}
	if err := ValidateTerminSchedule(total, short); !errors.Is(err, ErrTerminMismatch) {
		t.Errorf("short schedule err = %v, want ErrTerminMismatch", err)
	}
	over := []Installment{{Amount: rp(t, "30000000.00")}, {Amount: rp(t, "20000000.00")}}
	if err := ValidateTerminSchedule(total, over); !errors.Is(err, ErrTerminMismatch) {
		t.Errorf("over schedule err = %v, want ErrTerminMismatch", err)
	}
	if err := ValidateTerminSchedule(total, nil); !errors.Is(err, ErrEmptySchedule) {
		t.Errorf("empty schedule err = %v, want ErrEmptySchedule", err)
	}
	bad := []Installment{{Amount: rp(t, "45000000.00")}, {Amount: 0}}
	if err := ValidateTerminSchedule(total, bad); !errors.Is(err, ErrEmptySchedule) {
		t.Errorf("non-positive amount err = %v, want ErrEmptySchedule", err)
	}
}

func TestCheckVerification(t *testing.T) {
	total := rp(t, "45000000.00")
	// Within total: OK.
	if err := CheckVerification(total, rp(t, "15000000.00"), rp(t, "15000000.00")); err != nil {
		t.Errorf("within total rejected: %v", err)
	}
	// Exactly total: OK.
	if err := CheckVerification(total, rp(t, "30000000.00"), rp(t, "15000000.00")); err != nil {
		t.Errorf("exact total rejected: %v", err)
	}
	// Over total: blocked.
	if err := CheckVerification(total, rp(t, "40000000.00"), rp(t, "15000000.00")); !errors.Is(err, ErrOverVerified) {
		t.Errorf("over-verify err = %v, want ErrOverVerified", err)
	}
	if err := CheckVerification(total, 0, 0); !errors.Is(err, ErrEmptySchedule) {
		t.Errorf("zero amount err = %v, want ErrEmptySchedule", err)
	}
}

func TestRoutingGate(t *testing.T) {
	cases := []struct {
		from, to string
		want     bool
	}{
		{TrxMenungguVerifikasi, TrxTerverifikasiSebagian, true},
		{TrxMenungguVerifikasi, TrxLunas, true},
		{TrxTerverifikasiSebagian, TrxLunas, false},
		{TrxMenungguVerifikasi, TrxMenungguVerifikasi, false},
		{TrxLunas, TrxLunas, false},
	}
	for _, c := range cases {
		if got := ReleasesToAccount(c.from, c.to); got != c.want {
			t.Errorf("ReleasesToAccount(%q,%q) = %v, want %v", c.from, c.to, got, c.want)
		}
	}
}
