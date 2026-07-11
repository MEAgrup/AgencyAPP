package sales_test

// W1-06 integration tests — Qualified Lead Form (M0 §4 rules 1-4, §4.3)
// against a real DB, real Master Service List, real statemachine engine.

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/msl"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/core/testdb"
	"github.com/meagrup/agencyapp/backend/internal/module0_sales"
)

// seedAlphaServices seeds the M0 §4 worked example services into the Master
// Service List (Sales Head/SPV writes, Phase 0 §10) and returns their entry
// ids in example order:
//
//	[0] Pendampingan Establish TikTok  Rp. 9.000.000,00  percent 10
//	[1] Jasa Buka Toko Online Basic    Rp. 6.000.000,00  flat 500000
//	[2] Jasa Live Streaming Basic      Rp. 6.900.000,00  percent 12.5
//	[3] Jasa Iklan Basic               Rp. 1.000.000,00  percent 5
//	[4] Jasa Konten Basic              Rp. 1.000.000,00  percent 5
//	[5] Jasa Komisi Pending            Rp. 2.000.000,00  pending_master_list
func seedAlphaServices(t *testing.T, conn *sql.DB) []int64 {
	t.Helper()
	ctx := context.Background()
	store := msl.NewStore(authz.NewMatrixChecker(), audit.NewMySQL())
	head := spvActor("sales-head-nia")
	effective := time.Now().UTC().Add(-24 * time.Hour)

	fixtures := []msl.CreateInput{
		{Name: "Pendampingan Establish TikTok", StandardPrice: "9000000.00", CommissionRule: `{"type":"percent","value":10}`, EffectiveFrom: effective},
		{Name: "Jasa Buka Toko Online Basic", StandardPrice: "6000000.00", CommissionRule: `{"type":"flat","amount":500000}`, EffectiveFrom: effective},
		{Name: "Jasa Live Streaming Basic", StandardPrice: "6900000.00", CommissionRule: `{"type":"percent","value":12.5}`, EffectiveFrom: effective},
		{Name: "Jasa Iklan Basic", StandardPrice: "1000000.00", CommissionRule: `{"type":"percent","value":5}`, EffectiveFrom: effective},
		{Name: "Jasa Konten Basic", StandardPrice: "1000000.00", CommissionRule: `{"type":"percent","value":5}`, EffectiveFrom: effective},
		{Name: "Jasa Komisi Pending", StandardPrice: "2000000.00", CommissionRule: `{"type":"pending_master_list"}`, EffectiveFrom: effective},
	}
	ids := make([]int64, 0, len(fixtures))
	for _, in := range fixtures {
		e, err := store.CreateEntry(ctx, conn, head, in)
		if err != nil {
			t.Fatalf("seed MSL %q: %v", in.Name, err)
		}
		ids = append(ids, e.ID)
	}
	return ids
}

// contactedAttempt creates an attempt and moves it to `Contacted` — the only
// state a Qualified Lead Form may be submitted from.
func contactedAttempt(t *testing.T, conn *sql.DB, s *sales.Attempts, owner authz.Identity, leadID string) string {
	t.Helper()
	ctx := context.Background()
	id := mustCreate(ctx, t, conn, s, leadID, owner.EmployeeID)
	requireOK(t, s.UpdateStatus(ctx, conn, owner, id, sales.UpdateStatusInput{To: statemachine.ProspectContacted, ActionType: "meeting"}))
	return id
}

func validQualifiedInput(serviceIDs ...int64) sales.QualifiedFormInput {
	return sales.QualifiedFormInput{
		NamaToko:        "Alpha Digital",
		NamaPIC:         "Ibu Sari",
		LinkToko:        "https://shopee.co.id/alphadigital",
		KategoriBisnis:  "Fashion",
		Kota:            "Bandung",
		PlatformList:    []string{"Shopee", "TikTok Shop"},
		GMVSaatIni:      "50000000",
		TargetGMV:       "150000000",
		ServiceEntryIDs: serviceIDs,
	}
}

func countQualifiedForms(t *testing.T, conn *sql.DB, prospectID string) int {
	t.Helper()
	var n int
	if err := conn.QueryRow(`SELECT COUNT(*) FROM qualified_forms WHERE prospect_id = ?`, prospectID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// TestQualifiedForm_AlphaDigitalExample reproduces the M0 §4 worked example:
// 3 services, Estimasi Nilai Transaksi auto-fills Rp. 21.900.000,00
// (read-only), commission auto-computes, data locks, attempt -> Qualified.
func TestQualifiedForm_AlphaDigitalExample(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	id := contactedAttempt(t, conn, s, budi, "LEAD-202607-4001")

	form, err := s.SubmitQualifiedForm(ctx, conn, budi, id, validQualifiedInput(svc[0], svc[1], svc[2]))
	if err != nil {
		t.Fatalf("submit: %v", err)
	}

	// Auto-computed read-only money (house convention #4): Σ standard prices,
	// hand-computed from the §4 example.
	if form.EstimasiNilaiTransaksi != "21900000.00" {
		t.Errorf("estimasi = %q, want 21900000.00", form.EstimasiNilaiTransaksi)
	}
	if got := form.EstimasiIDR(); got != "Rp. 21.900.000,00" {
		t.Errorf("EstimasiIDR = %q, want Rp. 21.900.000,00 (§4 example)", got)
	}
	// Komisi: 10%·9jt (900.000) + flat 500.000 + 12,5%·6,9jt (862.500) = 2.262.500.
	if form.CommissionPending || form.Komisi == nil || *form.Komisi != "2262500.00" {
		t.Errorf("komisi = %v pending=%v, want 2262500.00", form.Komisi, form.CommissionPending)
	}
	if got := form.KomisiIDR(); got != "Rp. 2.262.500,00" {
		t.Errorf("KomisiIDR = %q", got)
	}
	if !form.Locked {
		t.Error("form must be born locked (M0 §4 rule 4)")
	}
	if len(form.Services) != 3 {
		t.Fatalf("services = %d, want 3", len(form.Services))
	}
	for i, sv := range form.Services {
		if sv.VersionID <= 0 || sv.Version != 1 {
			t.Errorf("service %d: version pin missing (%+v)", i, sv)
		}
	}
	// Status moved to Qualified in the same transaction.
	if got := rawStatus(t, conn, id); got != string(statemachine.ProspectQualified) {
		t.Fatalf("status = %q, want Qualified", got)
	}
	// Read side returns the identical persisted snapshot.
	loaded, err := s.GetQualifiedForm(ctx, conn, budi, id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if loaded.EstimasiNilaiTransaksi != form.EstimasiNilaiTransaksi || loaded.Komisi == nil || *loaded.Komisi != *form.Komisi || len(loaded.Services) != 3 {
		t.Errorf("reloaded form differs: %+v", loaded)
	}
}

// TestQualifiedForm_MaxFiveServices — M0 §4 rule 2, byte-exact message, zero
// side effects.
func TestQualifiedForm_MaxFiveServices(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	id := contactedAttempt(t, conn, s, budi, "LEAD-202607-4002")

	_, err := s.SubmitQualifiedForm(ctx, conn, budi, id, validQualifiedInput(svc...)) // 6 services
	if err == nil || err.Error() != "[maksimal pilih 5 jasa saja!]" {
		t.Fatalf("err = %v, want the byte-exact max-5 message", err)
	}
	if got := rawStatus(t, conn, id); got != string(statemachine.ProspectContacted) {
		t.Fatalf("status mutated to %q on blocked submit", got)
	}
	if countQualifiedForms(t, conn, id) != 0 {
		t.Fatal("form row persisted on blocked submit")
	}
}

// TestQualifiedForm_MandatoryFields — missing mandatory data → default BI
// message, nothing persisted, attempt stays Contacted (M0 §4 rule 1).
func TestQualifiedForm_MandatoryFields(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	id := contactedAttempt(t, conn, s, budi, "LEAD-202607-4003")

	mutations := map[string]func(*sales.QualifiedFormInput){
		"nama PIC kosong":      func(in *sales.QualifiedFormInput) { in.NamaPIC = "" },
		"kota kosong":          func(in *sales.QualifiedFormInput) { in.Kota = "" },
		"platform kosong":      func(in *sales.QualifiedFormInput) { in.PlatformList = nil },
		"platform di luar set": func(in *sales.QualifiedFormInput) { in.PlatformList = []string{"Bukalapak"} },
		"GMV bukan angka":      func(in *sales.QualifiedFormInput) { in.GMVSaatIni = "lima puluh juta" },
		"tanpa jasa":           func(in *sales.QualifiedFormInput) { in.ServiceEntryIDs = nil },
		"jasa duplikat":        func(in *sales.QualifiedFormInput) { in.ServiceEntryIDs = []int64{svc[0], svc[0]} },
		"jasa tidak dikenal":   func(in *sales.QualifiedFormInput) { in.ServiceEntryIDs = []int64{999999} },
	}
	for name, mutate := range mutations {
		in := validQualifiedInput(svc[0])
		mutate(&in)
		_, err := s.SubmitQualifiedForm(ctx, conn, budi, id, in)
		if err == nil || err.Error() != "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" {
			t.Errorf("%s: err = %v, want the default BI mandatory message", name, err)
		}
	}
	if got := rawStatus(t, conn, id); got != string(statemachine.ProspectContacted) {
		t.Fatalf("status mutated to %q", got)
	}
	if countQualifiedForms(t, conn, id) != 0 {
		t.Fatal("form row persisted despite failed validation")
	}
}

// TestQualifiedForm_PendingCommission — a pending_master_list service leaves
// the TOTAL commission NULL/pending (never guessed); Estimasi still sums;
// render is Dash (§2.7).
func TestQualifiedForm_PendingCommission(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	id := contactedAttempt(t, conn, s, budi, "LEAD-202607-4004")

	form, err := s.SubmitQualifiedForm(ctx, conn, budi, id, validQualifiedInput(svc[0], svc[5]))
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	if !form.CommissionPending || form.Komisi != nil {
		t.Fatalf("commission = %v pending=%v, want nil/true", form.Komisi, form.CommissionPending)
	}
	if got := form.KomisiIDR(); got != sales.Dash {
		t.Errorf("KomisiIDR = %q, want %q", got, sales.Dash)
	}
	// 9.000.000 + 2.000.000 — the price sum is independent of the pending rule.
	if form.EstimasiNilaiTransaksi != "11000000.00" {
		t.Errorf("estimasi = %q, want 11000000.00", form.EstimasiNilaiTransaksi)
	}
}

// TestQualifiedForm_LockedAfterSubmit — one submit per attempt; every edit
// path fails closed (M0 §4 rule 4).
func TestQualifiedForm_LockedAfterSubmit(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	id := contactedAttempt(t, conn, s, budi, "LEAD-202607-4005")

	if _, err := s.SubmitQualifiedForm(ctx, conn, budi, id, validQualifiedInput(svc[0])); err != nil {
		t.Fatalf("submit: %v", err)
	}
	if _, err := s.SubmitQualifiedForm(ctx, conn, budi, id, validQualifiedInput(svc[1])); !errors.Is(err, sales.ErrFormLocked) {
		t.Fatalf("resubmit err = %v, want ErrFormLocked", err)
	}
	if err := s.UpdateQualifiedForm(ctx, conn, budi, id, validQualifiedInput(svc[1])); !errors.Is(err, sales.ErrFormLocked) {
		t.Fatalf("update err = %v, want ErrFormLocked", err)
	}
}

// TestQualifiedForm_VersionPinning — the money snapshot pins the MSL version
// at submit: a later price change must not move the stored numbers, and the
// stored Estimasi must remain recomputable from the pinned versions (house
// convention #4 recompute-from-log).
func TestQualifiedForm_VersionPinning(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	head := spvActor("sales-head-nia")
	id := contactedAttempt(t, conn, s, budi, "LEAD-202607-4006")

	form, err := s.SubmitQualifiedForm(ctx, conn, budi, id, validQualifiedInput(svc[0], svc[1]))
	if err != nil {
		t.Fatalf("submit: %v", err)
	}

	// Sales Head raises the price of service 0 afterwards.
	store := msl.NewStore(authz.NewMatrixChecker(), audit.NewMySQL())
	newPrice := "12000000.00"
	if _, err := store.UpdateEntry(ctx, conn, head, svc[0], msl.UpdateInput{StandardPrice: &newPrice, EffectiveFrom: time.Now().UTC()}); err != nil {
		t.Fatalf("MSL update: %v", err)
	}

	reloaded, err := s.GetQualifiedForm(ctx, conn, budi, id)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.EstimasiNilaiTransaksi != form.EstimasiNilaiTransaksi {
		t.Fatalf("estimasi moved after MSL change: %q -> %q", form.EstimasiNilaiTransaksi, reloaded.EstimasiNilaiTransaksi)
	}
	// Recompute from the pinned version snapshots and compare with the stored
	// total: Σ pinned standard prices == estimasi, Σ per-service komisi == total.
	var sumPriceCents, sumKomisiCents int64
	for _, sv := range reloaded.Services {
		p, ok := sales.ParseDecimalCents(sv.StandardPrice)
		if !ok {
			t.Fatalf("bad pinned price %q", sv.StandardPrice)
		}
		sumPriceCents += p
		k, pend, err := sales.EvaluateCommissionRule(sv.CommissionRule, p)
		if err != nil || pend {
			t.Fatalf("recompute komisi: %v pending=%v", err, pend)
		}
		sumKomisiCents += k
	}
	if got := sales.CentsToDecimal(sumPriceCents); got != reloaded.EstimasiNilaiTransaksi {
		t.Fatalf("recomputed estimasi %q != stored %q", got, reloaded.EstimasiNilaiTransaksi)
	}
	if reloaded.Komisi == nil || sales.CentsToDecimal(sumKomisiCents) != *reloaded.Komisi {
		t.Fatalf("recomputed komisi %q != stored %v", sales.CentsToDecimal(sumKomisiCents), reloaded.Komisi)
	}
}

// TestQualifiedForm_Permissions — M0 §7.1 on both write and read paths,
// including layered OD (read yes, write no) and cross-division denial.
func TestQualifiedForm_Permissions(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	id := contactedAttempt(t, conn, s, budi, "LEAD-202607-4007")
	in := validQualifiedInput(svc[0])

	for _, tc := range []struct {
		name  string
		actor authz.Identity
	}{
		{"staf sales lain", staffActor("sales-rian")},
		{"OD murni", odActor("od-tuti")},
		{"staf divisi lain", otherDivisionStaff("ads-eka")},
	} {
		if _, err := s.SubmitQualifiedForm(ctx, conn, tc.actor, id, in); !errors.Is(err, authz.ErrDenied) {
			t.Errorf("%s submit: err = %v, want authz denial", tc.name, err)
		}
	}
	if got := rawStatus(t, conn, id); got != string(statemachine.ProspectContacted) {
		t.Fatalf("status mutated to %q by denied submits", got)
	}

	// SPV Sales may submit division-wide.
	if _, err := s.SubmitQualifiedForm(ctx, conn, spvActor("sales-head-nia"), id, in); err != nil {
		t.Fatalf("SPV submit: %v", err)
	}
	// Reads: owner, SPV, OD, Director yes; other staff/divisions no.
	for _, tc := range []struct {
		name  string
		actor authz.Identity
		want  bool
	}{
		{"pemilik", budi, true},
		{"SPV sales", spvActor("sales-head-nia"), true},
		{"OD", odActor("od-tuti"), true},
		{"Direktur", directorActor("dir-agus"), true},
		{"staf sales lain", staffActor("sales-rian"), false},
		{"staf divisi lain", otherDivisionStaff("ads-eka"), false},
	} {
		_, err := s.GetQualifiedForm(ctx, conn, tc.actor, id)
		if tc.want && err != nil {
			t.Errorf("%s read: %v", tc.name, err)
		}
		if !tc.want && !errors.Is(err, authz.ErrDenied) {
			t.Errorf("%s read: err = %v, want denial", tc.name, err)
		}
	}
}

// TestQualifiedForm_WrongState — submitting from any state but Contacted is
// blocked by the engine with the BI message and rolls the form back (zero
// side effects).
func TestQualifiedForm_WrongState(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	id := mustCreate(ctx, t, conn, s, "LEAD-202607-4008", budi.EmployeeID) // still New Lead

	_, err := s.SubmitQualifiedForm(ctx, conn, budi, id, validQualifiedInput(svc[0]))
	if err == nil || err.Error() != "[transisi status tidak diizinkan]" {
		t.Fatalf("err = %v, want the BI blocked-transition message", err)
	}
	if got := rawStatus(t, conn, id); got != string(statemachine.ProspectNewLead) {
		t.Fatalf("status = %q, want New Lead", got)
	}
	if countQualifiedForms(t, conn, id) != 0 {
		t.Fatal("form row survived a rolled-back submit")
	}
}
