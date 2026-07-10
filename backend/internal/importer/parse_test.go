package importer

// parse_test.go covers the W1-19 spreadsheet parsers (pure, no DB) and the
// dormant landing path (DB-backed). Fixtures are SYNTHETIC mirrors of the real
// source shapes ("Data Cena Sales Performance" Daily Leads, db_anthy db_jasa,
// Sheet72) — no real names/phones (PII).

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// ── ParseDailyLeads (filter B, O22) ──────────────────────────────────────────

// dailyLeadsFixture mirrors the real sheet: decorative row 1, real header row 2
// (with embedded newlines in the Qualify/Hot/Warm labels), float-artifact
// phones, True/False booleans.
const dailyLeadsFixture = `,,wajib disi,,,,,Problem,Budget,Authority,Timeline,,,,,,,,,,
Count Qualify [otomatis],Nama Sales [otomatis],Tanggal *klik 2x utk input tgl,Nama,No Handphone,Sumber,Detail Sumber Iklan,Q1,Q2,Q3,Q4,"Qualify
Leads
(automatic)","Budget
Marketing
(nominal)",Seller?,Affiliator?,No Respon,Bad Respon,"Hot
Prospect","Warm
Prospect","Cold
Prospect",Note
1,Andi,2026-02-01 00:00:00,budi qualified,6281111111101.0,Iklan - Meta,Jasa A - 01,True,True,True,True,Qualify,,False,False,False,False,False,False,False,catatan qualified
0,Andi,2026-03-05 00:00:00,citra hot,6281111111102.0,IG Kantor,,True,False,False,False,Not Qualify,,True,False,False,False,True,False,False,
0,Tono,2026-04-10 00:00:00,dewi warm,081111111103,YT Kantor,,False,False,False,False,Not Qualify,,False,True,False,False,False,True,False,
0,Andi,2026-04-11 00:00:00,eka buangan,6281111111104.0,Iklan - Meta,Jasa A - 01,False,False,False,False,Not Qualify,,False,False,True,False,False,False,True,
0,Andi,2025-06-01 00:00:00,fajar lama,6281111111105.0,Iklan - Meta,,True,True,True,True,Qualify,,False,False,False,False,False,False,False,
0,Andi,,gina tanpa tanggal,6281111111106.0,Iklan - Meta,,True,True,True,True,Qualify,,False,False,False,False,False,False,False,
0,Andi,2026-04-12 00:00:00,hani tanpa hp,,Iklan - Meta,,True,True,True,True,Qualify,,False,False,False,False,False,False,False,
,,,,,,,,,,,,,,,,,,,,
`

func TestParseDailyLeadsFilterB(t *testing.T) {
	rows, stats, err := ParseDailyLeads(strings.NewReader(dailyLeadsFixture), LeadParseOptions{
		Since:    day(2026, 1, 10),
		SalesMap: map[string]string{"Andi": "EMP-ANDI"},
	})
	if err != nil {
		t.Fatalf("ParseDailyLeads: %v", err)
	}
	if len(rows) != 3 {
		t.Fatalf("want 3 emitted rows (qualify, hot, warm), got %d: %+v", len(rows), rows)
	}

	// Row 1: Qualify, sales resolved -> diproses; float phone artifact stripped.
	if rows[0].NamaLead != "budi qualified" || rows[0].NoTelepon != "6281111111101" {
		t.Fatalf("row0 name/phone: %+v", rows[0])
	}
	if rows[0].SalesPemegang != "EMP-ANDI" || rows[0].StatusTerakhir != "diproses" {
		t.Fatalf("row0 sales/status: %+v", rows[0])
	}
	if rows[0].Sumber != "Iklan - Meta" || rows[0].CampaignAsal != "Jasa A - 01" {
		t.Fatalf("row0 sumber/campaign: %+v", rows[0])
	}
	if rows[0].Catatan != "catatan qualified" {
		t.Fatalf("row0 catatan: %q", rows[0].Catatan)
	}

	// Row 2: Not Qualify but Hot ⇒ imported; marker recorded in catatan.
	if rows[1].NamaLead != "citra hot" || !strings.Contains(rows[1].Catatan, "hot prospect") {
		t.Fatalf("row1: %+v", rows[1])
	}
	if !strings.Contains(rows[1].Catatan, "seller") {
		t.Fatalf("row1 seller marker missing: %q", rows[1].Catatan)
	}

	// Row 3: Warm via unmapped sales nickname ⇒ pool + SalesUnresolved counted;
	// leading-zero phone passed through for the M1 normalizer.
	if rows[2].SalesPemegang != "" || rows[2].StatusTerakhir != "pool" {
		t.Fatalf("row2 sales/status: %+v", rows[2])
	}
	if rows[2].NoTelepon != "081111111103" {
		t.Fatalf("row2 phone: %q", rows[2].NoTelepon)
	}

	want := LeadSkipStats{
		Malformed:       1, // fully blank row
		FilteredOut:     1, // eka buangan (bad respon, cold)
		BeforeSince:     1, // fajar lama (2025)
		BadDate:         1, // gina tanpa tanggal
		EmptyPhone:      1, // hani tanpa hp
		SalesUnresolved: 1, // Tono not in map
		Emitted:         3,
	}
	if stats != want {
		t.Fatalf("stats:\n got %+v\nwant %+v", stats, want)
	}
}

// ── ParseDbJasa + ClassifyLedger (O23) ───────────────────────────────────────

const dbJasaFixture = `Tanggal Closing,Status,ID_TRX,ID,Status Pembayaran,Tgl mulai,Remark,Tag,Nama Sales,Nama Client,Jenis Client,Nama Toko,Link Toko,Jasa,Detail Jasa,Durasi Jasa (bulan),Nominal Jasa,Jasa Ke-
6-Mei-2025,Ya,Jasa 1 - IdNew-1 - Shopee,IdNew-1,Lunas,7 Maret 2025,,,Sinta,pemilik satu,Baru,Toko Satu ,,Shopee ,Jasa Iklan A,1,Rp2.950.000,Jasa 1
5-Mei-2026,Ya,Jasa 1 - IdNew-2 - Shopee,IdNew-2,Termin ,17 April 2026,,,Sinta,pemilik dua,Baru,Toko Dua,shopee.co.id/dua,Shopee,Jasa Iklan B,6,Rp9.000.000,Jasa 1
5-Mei-2026,Ya,Jasa 2 - IdNew-2 - Tiktok,IdNew-2,Termin ,17 April 2026,,,Sinta,pemilik dua,Baru,Toko Dua,,Tiktok ,Optimasi C,6,Rp1.000.000,Jasa 2
1-Feb-2025,Tidak,Jasa 1 - IdNew-3 - Shopee,IdNew-3,DP,1 Februari 2025,,,Rudi,pemilik tiga,Baru,Toko Tiga,,Shopee,Jasa Iklan A,1,Rp5.000.000,Jasa 1
3-Mar-2025,Ya,Jasa 1 - IdNew-4 - Shopee,IdNew-4,,3 Maret 2025,,,Rudi,pemilik empat,Baru,Toko Empat,,Shopee,Jasa Iklan A,1,Rp1.500.000,Jasa 1
`

func TestParseDbJasaGroupsAndClassifies(t *testing.T) {
	clients, err := ParseDbJasa(strings.NewReader(dbJasaFixture))
	if err != nil {
		t.Fatalf("ParseDbJasa: %v", err)
	}
	if len(clients) != 4 {
		t.Fatalf("want 4 grouped clients, got %d", len(clients))
	}
	byID := map[string]LedgerClient{}
	for _, c := range clients {
		byID[c.ID] = c
	}

	// Grouping: IdNew-2 has two lines, Σ nominal, trimmed toko, platform casing
	// normalized and distinct.
	c2 := byID["IdNew-2"]
	if len(c2.Lines) != 2 {
		t.Fatalf("IdNew-2 lines: %d", len(c2.Lines))
	}
	if got := c2.TotalNominal().Decimal(); got != "10000000.00" {
		t.Fatalf("IdNew-2 total: %s", got)
	}
	plats := c2.distinctPlatforms()
	if len(plats) != 2 || plats[0] != "Shopee" || plats[1] != "TikTok" {
		t.Fatalf("IdNew-2 platforms: %v", plats)
	}
	if byID["IdNew-1"].Toko != "Toko Satu" {
		t.Fatalf("toko not trimmed: %q", byID["IdNew-1"].Toko)
	}

	// Scheme prefill mapping: Lunas ⇒ decided; "Termin " (trailing space) ⇒
	// [Termin]; DP ⇒ [Bayar Sebagian]; empty ⇒ undecided (blank prefill).
	if got := byID["IdNew-1"].schemePrefill(); got != "[Bayar Penuh (Lunas)]" {
		t.Fatalf("IdNew-1 prefill: %q", got)
	}
	if got := c2.schemePrefill(); got != "[Termin]" {
		t.Fatalf("IdNew-2 prefill: %q", got)
	}
	if got := byID["IdNew-3"].schemePrefill(); got != "[Bayar Sebagian]" {
		t.Fatalf("IdNew-3 prefill: %q", got)
	}
	if got := byID["IdNew-4"].schemePrefill(); got != "" {
		t.Fatalf("IdNew-4 prefill (empty scheme must stay undecided): %q", got)
	}

	// Classification at run date 2026-07-10:
	//   IdNew-1: Lunas + ended 2025-04 ⇒ dormant.
	//   IdNew-2: running until 2026-10 ⇒ active.
	//   IdNew-3: DP, expired ⇒ active candidate (ledger can't prove paid off).
	//   IdNew-4: empty scheme ⇒ active candidate (tertunggak per O23).
	cl := ClassifyLedger(clients, day(2026, 7, 10))
	if len(cl.ActiveCandidates) != 3 || len(cl.Dormant) != 1 {
		t.Fatalf("classify: %d active, %d dormant", len(cl.ActiveCandidates), len(cl.Dormant))
	}
	if cl.Dormant[0].ID != "IdNew-1" {
		t.Fatalf("dormant: %q", cl.Dormant[0].ID)
	}
}

func TestEnrichContacts(t *testing.T) {
	clients, err := ParseDbJasa(strings.NewReader(dbJasaFixture))
	if err != nil {
		t.Fatalf("ParseDbJasa: %v", err)
	}
	// Sheet72 shape: headerless; STATUS, ID, TglClosing, TglProspek, Sales,
	// Nama, Jenis, Usaha, Email, Telp, Link.
	sheet72 := `CLOSING,IdNew-2,2026-05-05 00:00:00,2026-04-17 10:00:00.000000,Sinta,pemilik dua,Baru,Toko Dua,dua@example.com,6281111111202,https://shopee.co.id/dua
PROSPECT,IdNew-99,,,Sinta,orang lain,,,x@example.com,628999,,
`
	if err := EnrichContacts(clients, strings.NewReader(sheet72)); err != nil {
		t.Fatalf("EnrichContacts: %v", err)
	}
	var c2 LedgerClient
	for _, c := range clients {
		if c.ID == "IdNew-2" {
			c2 = c
		}
	}
	if c2.Email != "dua@example.com" || c2.Telepon != "6281111111202" {
		t.Fatalf("enrichment: %+v", c2)
	}
}

// ── Form pelengkap roundtrip ─────────────────────────────────────────────────

func TestFormRoundtrip(t *testing.T) {
	clients, err := ParseDbJasa(strings.NewReader(dbJasaFixture))
	if err != nil {
		t.Fatalf("ParseDbJasa: %v", err)
	}
	cl := ClassifyLedger(clients, day(2026, 7, 10))

	var buf bytes.Buffer
	if err := WriteForm(&buf, cl.ActiveCandidates); err != nil {
		t.Fatalf("WriteForm: %v", err)
	}
	form := buf.String()
	if !strings.Contains(form, "id_ledger") || !strings.Contains(form, "konfirmasi_aktif") {
		t.Fatalf("form header missing: %s", form)
	}
	if !strings.Contains(form, "Jasa Iklan B@9000000.00|Optimasi C@1000000.00") {
		t.Fatalf("layanan encoding missing: %s", form)
	}
	if !strings.Contains(form, "Shopee|TikTok") {
		t.Fatalf("platforms prefill missing: %s", form)
	}

	// Simulate Finance/CRO filling the IdNew-2 row (Y) and IdNew-3 row (N),
	// leaving IdNew-4 undecided (unknown konfirmasi value ⇒ issue).
	lines := strings.Split(strings.TrimSpace(form), "\n")
	var filled []string
	filled = append(filled, lines[0])
	for _, ln := range lines[1:] {
		switch {
		case strings.HasPrefix(ln, "IdNew-2,"):
			ln = strings.Replace(ln, ",,,,,,,,,,,,,", // 13 empty to-fill cols
				",Y,Bandung,Fashion,Rp10.000.000,Rp15.000.000,,EMP-BUDI,EMP-BUDI:100,EMP-BUDI,,"+
					"5000000@2026-05-17|5000000@2026-06-17,5000000@2026-05-17,https://kontrak/x", 1)
		case strings.HasPrefix(ln, "IdNew-3,"):
			ln = strings.Replace(ln, ",,,,,,,,,,,,,", ",N,,,,,,,,,,,,", 1)
		}
		filled = append(filled, ln)
	}

	active, dormant, issues, err := ParseFilledForm(strings.NewReader(strings.Join(filled, "\n")))
	if err != nil {
		t.Fatalf("ParseFilledForm: %v", err)
	}
	if len(active) != 1 || len(dormant) != 1 || len(issues) != 1 {
		t.Fatalf("active=%d dormant=%d issues=%d (%+v)", len(active), len(dormant), len(issues), issues)
	}

	a := active[0]
	if a.Toko != "Toko Dua" || a.Kota != "Bandung" || a.SalesPIC != "EMP-BUDI" {
		t.Fatalf("active row: %+v", a)
	}
	if a.SkemaPembayaran != "[Termin]" { // prefill kept when skema_final empty
		t.Fatalf("scheme: %q", a.SkemaPembayaran)
	}
	if len(a.AlokasiSales) != 1 || a.AlokasiSales[0].BasisPoints != 10000 {
		t.Fatalf("alokasi: %+v", a.AlokasiSales)
	}
	if len(a.JadwalTermin) != 2 || a.JadwalTermin[0].DueDate != day(2026, 5, 17) {
		t.Fatalf("jadwal: %+v", a.JadwalTermin)
	}
	if len(a.PembayaranTerverifikasi) != 1 || a.PembayaranTerverifikasi[0].Amount.Decimal() != "5000000.00" {
		t.Fatalf("pembayaran: %+v", a.PembayaranTerverifikasi)
	}
	if len(a.Platforms) != 2 || a.Platforms[0].Platform != "Shopee" {
		t.Fatalf("platforms: %+v", a.Platforms)
	}
	if a.NilaiTransaksiTotal.Decimal() != "10000000.00" {
		t.Fatalf("total: %s", a.NilaiTransaksiTotal.Decimal())
	}

	d := dormant[0]
	if d.ID != "IdNew-3" || d.Toko != "Toko Tiga" {
		t.Fatalf("dormant from form: %+v", d)
	}
	if plats := d.distinctPlatforms(); len(plats) != 1 || plats[0] != "Shopee" {
		t.Fatalf("dormant platforms lost: %v", plats)
	}
}

// ── Dormant landing path (DB) ────────────────────────────────────────────────

func dormantFixture() LedgerClient {
	return LedgerClient{
		ID: "IdNew-1", Toko: "Toko Satu", NamaPIC: "pemilik satu", NamaSales: "Sinta",
		Lines: []LedgerService{
			{Platform: "Shopee", DetailJasa: "Jasa Iklan A", Nominal: 295000000, NominalOK: true, SchemeRaw: "Lunas"},
			{Platform: "TikTok", DetailJasa: "Optimasi C", Nominal: 100000000, NominalOK: true, SchemeRaw: "Lunas"},
		},
	}
}

func TestDryRunDormantZeroMutation(t *testing.T) {
	s := newSvc(t)
	rep, err := s.DryRunDormant(context.Background(), director, []LedgerClient{dormantFixture(), {}})
	if err != nil {
		t.Fatalf("DryRunDormant: %v", err)
	}
	if rep.Valid != 1 || rep.Error != 1 {
		t.Fatalf("report: %+v", rep)
	}
	for _, table := range []string{"clients", "client_platforms", "audit_log"} {
		if n := countRows(t, s, table); n != 0 {
			t.Fatalf("%s mutated by dry run: %d rows", table, n)
		}
	}
}

func TestApplyDormantLandsArchiveRecord(t *testing.T) {
	s := newSvc(t)
	rep, err := s.ApplyDormant(context.Background(), director, []LedgerClient{dormantFixture()})
	if err != nil {
		t.Fatalf("ApplyDormant: %v", err)
	}
	if rep.Applied != 1 || len(rep.Rows[0].IssuedIDs) != 1 {
		t.Fatalf("report: %+v", rep)
	}
	cliID := rep.Rows[0].IssuedIDs[0]

	var dormantAt, releasedAt, trxID any
	if err := s.DB.QueryRow(
		`SELECT dormant_at, released_to_account_at, transaction_id FROM clients WHERE id = ?`, cliID).
		Scan(&dormantAt, &releasedAt, &trxID); err != nil {
		t.Fatalf("load client: %v", err)
	}
	if dormantAt == nil {
		t.Fatal("dormant_at not stamped")
	}
	if releasedAt != nil || trxID != nil {
		t.Fatalf("dormant client must have no release/TRX: released=%v trx=%v", releasedAt, trxID)
	}
	if n := countRows(t, s, "transactions") + countRows(t, s, "services") + countRows(t, s, "installments"); n != 0 {
		t.Fatalf("dormant path created money-path rows: %d", n)
	}
	if n := countRows(t, s, "client_platforms"); n != 2 {
		t.Fatalf("platforms: %d", n)
	}
	if n := countAudit(t, s, "client", "import:client_dormant"); n != 1 {
		t.Fatalf("provenance audit rows: %d", n)
	}
}

func TestDormantDirectorOnly(t *testing.T) {
	s := newSvc(t)
	staff := directorless(t)
	if _, err := s.ApplyDormant(context.Background(), staff, []LedgerClient{dormantFixture()}); err == nil {
		t.Fatal("non-director ApplyDormant must be denied")
	}
	if _, err := s.DryRunDormant(context.Background(), staff, []LedgerClient{dormantFixture()}); err == nil {
		t.Fatal("non-director DryRunDormant must be denied")
	}
}

// directorless builds a plain staff actor from the shared director fixture.
func directorless(t *testing.T) permission.Actor {
	t.Helper()
	a := director
	a.Role.Director = false
	a.Role.Division = "Sales"
	return a
}
