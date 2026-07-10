package importer

// parse_clients.go is the W1-19 CLIENTS parser (jalur 2), per O23 RESOLVED
// (DECISIONS 2026-07-10):
//
//   - ALL ledger clients are brought into CDPS. Non-active ones land as DORMANT
//     client records (no TRX/SVC/INST — see dormant.go); active candidates go
//     through a human "form pelengkap" before full import.
//   - Scheme mapping ledger→CDPS: Lunas → [Bayar Penuh (Lunas)]; Termin (trailing
//     space trimmed) → [Termin]; DP → [Bayar Sebagian]; Monthly → [Termin];
//     empty / Deposit → undecided (candidate ACTIVE, scheme left blank for Finance).
//   - Active rule: latest(Tgl mulai + Durasi Jasa bulan) >= run date ⇒ active
//     candidate; ALSO active-candidate if ANY line's mapped scheme is non-Lunas
//     (ledger cannot prove the client finished paying). Pure Lunas + expired
//     duration ⇒ dormant directly.
//   - 1 client = 1 TRX gabungan: all running services collapse into one
//     transaction — this shapes the form, whose filled version parses into
//     ClientRow.
//
// This file is PURE (no DB): parse, classify, enrich, emit/read the form. The DB
// landing paths are createClientTx (active, existing) and landDormantTx (dormant).

import (
	"encoding/csv"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/module5_finance"
)

// LedgerService is one db_jasa line (one purchased service on one platform).
type LedgerService struct {
	Platform    string // normalized Jasa (TikTok/Shopee/…)
	DetailJasa  string // service name (Detail Jasa)
	DurasiBulan int
	Nominal     money.Money
	NominalOK   bool
	TglMulai    time.Time
	TglMulaiOK  bool
	SchemeRaw   string
	IDTRX       string
	JasaKe      string
}

// LedgerClient is all db_jasa lines that share one ID (IdNew-JSxx), i.e. one
// client's combined deal history. Contact fields are filled by EnrichContacts.
type LedgerClient struct {
	ID               string
	Toko             string
	NamaPIC          string
	NamaSales        string
	LinkToko         string
	Status           string // ledger Status column (Ya/Tidak)
	TanggalClosing   time.Time
	TanggalClosingOK bool
	Lines            []LedgerService

	// Enrichment (Sheet72), empty if not matched.
	Email   string
	Telepon string

	// ExtraPlatforms carries platform names that arrive without per-line detail
	// (a konfirmasi_aktif=N form row's prefilled "platforms" column); union-ed
	// into distinctPlatforms.
	ExtraPlatforms []string
}

// TotalNominal is Σ of the client's line nominals (the combined-TRX value).
func (c LedgerClient) TotalNominal() money.Money {
	var t money.Money
	for _, l := range c.Lines {
		t += l.Nominal
	}
	return t
}

// distinctPlatforms returns the client's normalized platforms in first-seen
// order (for PlatformRow / dormant provenance).
func (c LedgerClient) distinctPlatforms() []string {
	seen := map[string]bool{}
	var out []string
	add := func(p string) {
		if p == "" || seen[p] {
			return
		}
		seen[p] = true
		out = append(out, p)
	}
	for _, l := range c.Lines {
		add(l.Platform)
	}
	for _, p := range c.ExtraPlatforms {
		add(p)
	}
	return out
}

// hasNonLunas reports whether any line maps to a scheme other than pure Lunas
// (undecided empty/Deposit count as non-Lunas: the ledger cannot prove payment).
func (c LedgerClient) hasNonLunas() bool {
	for _, l := range c.Lines {
		if mapped, decided := mapLedgerScheme(l.SchemeRaw); !decided || mapped != module5_finance.SchemeLunas {
			return true
		}
	}
	return false
}

// latestEnd is the latest (Tgl mulai + Durasi) across lines, and whether any
// line had a parseable start date.
func (c LedgerClient) latestEnd() (time.Time, bool) {
	var latest time.Time
	ok := false
	for _, l := range c.Lines {
		if !l.TglMulaiOK {
			continue
		}
		end := addMonths(l.TglMulai, l.DurasiBulan)
		if !ok || end.After(latest) {
			latest, ok = end, true
		}
	}
	return latest, ok
}

// schemePrefill returns the form's skema_prefill: a single decided CDPS scheme
// if every line agrees, else "" (undecided / mixed — Finance fills skema_final).
func (c LedgerClient) schemePrefill() string {
	decidedSet := map[string]bool{}
	for _, l := range c.Lines {
		mapped, decided := mapLedgerScheme(l.SchemeRaw)
		if !decided {
			return "" // any undecided line ⇒ leave blank
		}
		decidedSet[mapped] = true
	}
	if len(decidedSet) == 1 {
		for s := range decidedSet {
			return s
		}
	}
	return "" // mixed decided schemes ⇒ ambiguous, let Finance choose
}

// mapLedgerScheme maps a raw ledger Status Pembayaran to a CDPS scheme. decided
// is false for values O23 sent to the form (empty, Deposit, or anything else).
func mapLedgerScheme(raw string) (string, bool) {
	s := strings.TrimSpace(raw)
	u := strings.ToUpper(s)
	switch {
	case s == "":
		return "", false
	case u == "LUNAS":
		return module5_finance.SchemeLunas, true
	case strings.HasPrefix(u, "TERMIN"):
		return module5_finance.SchemeTermin, true
	case strings.HasPrefix(u, "DP"):
		return module5_finance.SchemeBayarSebagian, true
	case u == "MONTHLY":
		return module5_finance.SchemeTermin, true
	case u == "DEPOSIT":
		return "", false
	default:
		return "", false
	}
}

// platformCanon canonicalises the ledger's Jasa spellings (TikTok/Tiktok,
// "Shopee ", shopee) to one form; unknown platforms are returned trimmed as-is.
var platformCanon = map[string]string{
	"shopee":      "Shopee",
	"tiktok":      "TikTok",
	"tiktok shop": "TikTok Shop",
	"lazada":      "Lazada",
	"tokopedia":   "Tokopedia",
	"meta":        "Meta",
	"google":      "Google",
	"dokumen":     "Dokumen",
}

func normalizePlatform(raw string) string {
	s := strings.TrimSpace(raw)
	if c, ok := platformCanon[strings.ToLower(s)]; ok {
		return c
	}
	return s
}

// ── ParseDbJasa ──────────────────────────────────────────────────────────────

type dbJasaCols struct {
	tanggalClosing, status, idTrx, id, statusPembayaran, tglMulai int
	namaSales, namaClient, namaToko, linkToko, jasa, detailJasa   int
	durasi, nominal, jasaKe                                       int
}

// ParseDbJasa reads the ledger CSV and returns clients grouped by ID in
// first-seen order, with dates/money parsed and platforms normalized.
func ParseDbJasa(r io.Reader) ([]LedgerClient, error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1
	cr.LazyQuotes = true
	records, err := cr.ReadAll()
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, errNoDbJasaHeader
	}
	cols, ok := mapDbJasaCols(records[0])
	if !ok {
		return nil, errNoDbJasaHeader
	}

	order := []string{}
	byID := map[string]*LedgerClient{}
	for _, rec := range records[1:] {
		get := func(i int) string {
			if i >= 0 && i < len(rec) {
				return strings.TrimSpace(rec[i])
			}
			return ""
		}
		id := get(cols.id)
		if id == "" {
			continue // an ID-less line cannot be grouped into a client
		}
		c, exists := byID[id]
		if !exists {
			c = &LedgerClient{ID: id}
			byID[id] = c
			order = append(order, id)
		}
		// Scalar fields: first non-empty wins.
		setIfEmpty(&c.Toko, get(cols.namaToko))
		setIfEmpty(&c.NamaPIC, get(cols.namaClient))
		setIfEmpty(&c.NamaSales, get(cols.namaSales))
		setIfEmpty(&c.LinkToko, get(cols.linkToko))
		setIfEmpty(&c.Status, get(cols.status))

		if tc, ok := parseIndoDate(get(cols.tanggalClosing)); ok {
			// Combined TRX closing = earliest deal date across the client's lines.
			if !c.TanggalClosingOK || tc.Before(c.TanggalClosing) {
				c.TanggalClosing, c.TanggalClosingOK = tc, true
			}
		}

		line := LedgerService{
			Platform:   normalizePlatform(get(cols.jasa)),
			DetailJasa: get(cols.detailJasa),
			SchemeRaw:  get(cols.statusPembayaran),
			IDTRX:      get(cols.idTrx),
			JasaKe:     get(cols.jasaKe),
		}
		line.DurasiBulan = atoiSafe(get(cols.durasi))
		if line.DurasiBulan < 0 {
			line.DurasiBulan = 0
		}
		if m, ok := parseLedgerMoney(get(cols.nominal)); ok {
			line.Nominal, line.NominalOK = m, true
		}
		if d, ok := parseIndoDate(get(cols.tglMulai)); ok {
			line.TglMulai, line.TglMulaiOK = d, true
		}
		c.Lines = append(c.Lines, line)
	}

	out := make([]LedgerClient, 0, len(order))
	for _, id := range order {
		out = append(out, *byID[id])
	}
	return out, nil
}

func setIfEmpty(dst *string, v string) {
	if *dst == "" && v != "" {
		*dst = v
	}
}

func mapDbJasaCols(hdr []string) (dbJasaCols, bool) {
	c := dbJasaCols{
		tanggalClosing: -1, status: -1, idTrx: -1, id: -1, statusPembayaran: -1, tglMulai: -1,
		namaSales: -1, namaClient: -1, namaToko: -1, linkToko: -1, jasa: -1, detailJasa: -1,
		durasi: -1, nominal: -1, jasaKe: -1,
	}
	for i, cell := range hdr {
		switch normKey(cell) {
		case "tanggal closing":
			c.tanggalClosing = i
		case "status":
			c.status = i
		case "id_trx":
			c.idTrx = i
		case "id":
			c.id = i
		case "status pembayaran":
			c.statusPembayaran = i
		case "tgl mulai":
			c.tglMulai = i
		case "nama sales":
			c.namaSales = i
		case "nama client":
			c.namaClient = i
		case "nama toko":
			c.namaToko = i
		case "link toko":
			c.linkToko = i
		case "jasa":
			c.jasa = i
		case "detail jasa":
			c.detailJasa = i
		case "durasi jasa (bulan)":
			c.durasi = i
		case "nominal jasa":
			c.nominal = i
		case "jasa ke-":
			c.jasaKe = i
		}
	}
	if c.id == -1 || c.statusPembayaran == -1 {
		return c, false
	}
	return c, true
}

// ── ClassifyLedger ─────────────────────────────────────────────────────────

// Classified splits ledger clients into active candidates (→ form pelengkap)
// and dormant records (→ landDormantTx).
type Classified struct {
	ActiveCandidates []LedgerClient
	Dormant          []LedgerClient
}

// ClassifyLedger applies the O23 active rule against runDate.
func ClassifyLedger(clients []LedgerClient, runDate time.Time) Classified {
	var out Classified
	for _, c := range clients {
		active := c.hasNonLunas()
		if !active {
			if end, ok := c.latestEnd(); ok && !end.Before(runDate) {
				active = true
			}
		}
		if active {
			out.ActiveCandidates = append(out.ActiveCandidates, c)
		} else {
			out.Dormant = append(out.Dormant, c)
		}
	}
	return out
}

// ── EnrichContacts ─────────────────────────────────────────────────────────

// Sheet72 fixed positions (no header): STATUS, ID, Tgl Closing, Tgl Prospek,
// Sales, Nama, Jenis Client, Nama Usaha, Email, No Telp, Link Toko, …
const (
	s72ID    = 1
	s72Email = 8
	s72Telp  = 9
	s72Link  = 10
)

// EnrichContacts fills Email / Telepon / (missing) LinkToko on each client by
// matching the Sheet72 ID column. Silent for clients absent from Sheet72; only
// an unreadable CSV is an error. Mutates clients in place.
func EnrichContacts(clients []LedgerClient, sheet72 io.Reader) error {
	cr := csv.NewReader(sheet72)
	cr.FieldsPerRecord = -1
	cr.LazyQuotes = true
	records, err := cr.ReadAll()
	if err != nil {
		return err
	}
	type contact struct{ email, telp, link string }
	byID := map[string]contact{}
	for _, rec := range records {
		get := func(i int) string {
			if i >= 0 && i < len(rec) {
				return strings.TrimSpace(rec[i])
			}
			return ""
		}
		id := get(s72ID)
		if id == "" {
			continue
		}
		cur := byID[id]
		if cur.email == "" {
			cur.email = get(s72Email)
		}
		if cur.telp == "" {
			cur.telp = cleanPhone(get(s72Telp))
		}
		if cur.link == "" {
			cur.link = get(s72Link)
		}
		byID[id] = cur
	}
	for i := range clients {
		if c, ok := byID[clients[i].ID]; ok {
			clients[i].Email = c.email
			clients[i].Telepon = c.telp
			if clients[i].LinkToko == "" {
				clients[i].LinkToko = c.link
			}
		}
	}
	return nil
}

// ── Form pelengkap ─────────────────────────────────────────────────────────

// formHeader is the "form pelengkap" column order: prefilled columns first
// (from the ledger + enrichment), then the columns a human (CRO + Finance)
// fills. See cmd/import usage for the fill-value encodings.
var formHeader = []string{
	// prefilled (do not edit)
	"id_ledger", "toko", "nama_pic", "sales_ledger", "tanggal_closing",
	"layanan", "platforms", "skema_prefill", "email", "telepon", "link_toko", "total_nominal",
	// to fill
	"konfirmasi_aktif", "kota", "kategori", "gmv_baseline_bulanan", "target_gmv",
	"marketing_budget", "sales_pic_nik", "alokasi_sales", "commission_payment_pic_nik",
	"skema_final", "jadwal_termin", "pembayaran_terverifikasi", "link_kontrak",
}

// WriteForm emits the form pelengkap CSV for the active candidates.
func WriteForm(w io.Writer, active []LedgerClient) error {
	cw := csv.NewWriter(w)
	if err := cw.Write(formHeader); err != nil {
		return err
	}
	for _, c := range active {
		closing := ""
		if c.TanggalClosingOK {
			closing = c.TanggalClosing.Format("2006-01-02")
		}
		row := []string{
			c.ID, c.Toko, c.NamaPIC, c.NamaSales, closing,
			encodeLayanan(c.Lines), strings.Join(c.distinctPlatforms(), "|"),
			c.schemePrefill(), c.Email, c.Telepon, c.LinkToko,
			c.TotalNominal().Decimal(),
			// to-fill columns emitted empty
			"", "", "", "", "", "", "", "", "", "", "", "", "",
		}
		if err := cw.Write(row); err != nil {
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}

// encodeLayanan renders the ledger lines as "nama@harga|nama@harga" (harga is
// the DECIMAL storage string). Lines with an unparseable nominal render "@0.00".
func encodeLayanan(lines []LedgerService) string {
	parts := make([]string, 0, len(lines))
	for _, l := range lines {
		parts = append(parts, l.DetailJasa+"@"+l.Nominal.Decimal())
	}
	return strings.Join(parts, "|")
}

// FormIssue is a parse-side problem on one filled form row (operator-facing).
type FormIssue struct {
	Row      int    // 1-based data row number
	IDLedger string // id_ledger, if readable
	Message  string
}

// ParseFilledForm reads the filled form pelengkap. konfirmasi_aktif=Y rows with
// no parse-side problem become ClientRows (deep money/schedule/contract/employee
// validation stays in the engine). konfirmasi_aktif=N rows are returned as
// dormant additions (rebuilt from the prefilled ledger columns). Rows with a
// parse-side problem (bad money/date/allocation-sum, unknown konfirmasi_aktif)
// are returned as issues and NOT emitted.
func ParseFilledForm(r io.Reader) (active []ClientRow, dormant []LedgerClient, issues []FormIssue, err error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1
	cr.LazyQuotes = true
	records, err := cr.ReadAll()
	if err != nil {
		return nil, nil, nil, err
	}
	if len(records) == 0 {
		return nil, nil, nil, errNoFormHeader
	}
	idx, ok := mapFormCols(records[0])
	if !ok {
		return nil, nil, nil, errNoFormHeader
	}

	for i, rec := range records[1:] {
		get := func(name string) string {
			j, ok := idx[name]
			if !ok || j >= len(rec) {
				return ""
			}
			return strings.TrimSpace(rec[j])
		}
		rowNo := i + 1
		idLedger := get("id_ledger")

		switch strings.ToUpper(get("konfirmasi_aktif")) {
		case "Y", "YA":
			row, issue := buildClientRowFromForm(get)
			if issue != "" {
				issues = append(issues, FormIssue{Row: rowNo, IDLedger: idLedger, Message: issue})
				continue
			}
			active = append(active, row)
		case "N", "T", "TIDAK":
			dormant = append(dormant, dormantFromForm(get))
		default:
			issues = append(issues, FormIssue{Row: rowNo, IDLedger: idLedger,
				Message: "konfirmasi_aktif harus Y atau N"})
		}
	}
	return active, dormant, issues, nil
}

// buildClientRowFromForm assembles a ClientRow, returning a non-empty issue on a
// parse-side failure (bad money, bad date, allocation Σ ≠ 100%).
func buildClientRowFromForm(get func(string) string) (ClientRow, string) {
	row := ClientRow{
		Toko:                 get("toko"),
		NamaPIC:              get("nama_pic"),
		Kota:                 get("kota"),
		LinkToko:             get("link_toko"),
		Kategori:             get("kategori"),
		SalesPIC:             get("sales_pic_nik"),
		CommissionPaymentPIC: get("commission_payment_pic_nik"),
		LinkKontrak:          get("link_kontrak"),
	}

	// Scheme: prefer the human's skema_final, fall back to the prefill hint.
	row.SkemaPembayaran = get("skema_final")
	if row.SkemaPembayaran == "" {
		row.SkemaPembayaran = get("skema_prefill")
	}

	// Closing date.
	if s := get("tanggal_closing"); s != "" {
		t, err := time.Parse("2006-01-02", s)
		if err != nil {
			return row, fmt.Sprintf("tanggal_closing tidak valid: %q", s)
		}
		row.TanggalClosing = t
	}

	// Money scalars.
	for _, f := range []struct {
		name string
		dst  *money.Money
	}{
		{"gmv_baseline_bulanan", &row.GMVBaselineBulanan},
		{"target_gmv", &row.TargetGMV},
	} {
		if s := get(f.name); s != "" {
			m, ok := formMoney(s)
			if !ok {
				return row, fmt.Sprintf("%s tidak valid: %q", f.name, s)
			}
			*f.dst = m
		}
	}
	if s := get("marketing_budget"); s != "" {
		m, ok := formMoney(s)
		if !ok {
			return row, fmt.Sprintf("marketing_budget tidak valid: %q", s)
		}
		row.MarketingBudget = &m
	}

	// Total transaction value (prefilled Σ ledger, editable by Finance).
	if s := get("total_nominal"); s != "" {
		m, ok := formMoney(s)
		if !ok {
			return row, fmt.Sprintf("total_nominal tidak valid: %q", s)
		}
		row.NilaiTransaksiTotal = m
	}

	// Services "nama@harga|…".
	svcs, issue := parseLayanan(get("layanan"))
	if issue != "" {
		return row, issue
	}
	row.Layanan = svcs

	// Platforms "Shopee|TikTok" (prefilled from the ledger; store link = the
	// client's link_toko — the ledger has no per-platform link).
	for _, p := range splitPipe(get("platforms")) {
		row.Platforms = append(row.Platforms, PlatformRow{Platform: p, Link: row.LinkToko})
	}

	// Allocation "NIK:persen|NIK:persen" → basis points; parse-side Σ=100% check.
	allocs, issue := parseAllocations(get("alokasi_sales"))
	if issue != "" {
		return row, issue
	}
	row.AlokasiSales = allocs

	// Schedule + verified payments "amount@YYYY-MM-DD|…".
	termins, issue := parseTermins(get("jadwal_termin"))
	if issue != "" {
		return row, issue
	}
	row.JadwalTermin = termins

	pays, issue := parsePayments(get("pembayaran_terverifikasi"))
	if issue != "" {
		return row, issue
	}
	row.PembayaranTerverifikasi = pays

	return row, ""
}

// dormantFromForm rebuilds a LedgerClient (for the dormant path) from a
// konfirmasi_aktif=N form row — the prefilled columns carry enough for the
// dormant provenance summary (deal count via layanan, total, scheme, platforms).
func dormantFromForm(get func(string) string) LedgerClient {
	c := LedgerClient{
		ID:        get("id_ledger"),
		Toko:      get("toko"),
		NamaPIC:   get("nama_pic"),
		NamaSales: get("sales_ledger"),
		LinkToko:  get("link_toko"),
		Email:     get("email"),
		Telepon:   get("telepon"),
	}
	if s := get("tanggal_closing"); s != "" {
		if t, err := time.Parse("2006-01-02", s); err == nil {
			c.TanggalClosing, c.TanggalClosingOK = t, true
		}
	}
	c.ExtraPlatforms = splitPipe(get("platforms"))
	svcs, _ := parseLayanan(get("layanan"))
	scheme := get("skema_final")
	if scheme == "" {
		scheme = get("skema_prefill")
	}
	for _, sv := range svcs {
		c.Lines = append(c.Lines, LedgerService{
			DetailJasa: sv.Nama,
			Nominal:    sv.HargaDeal,
			NominalOK:  sv.HargaDeal > 0,
			SchemeRaw:  scheme,
		})
	}
	return c
}

func mapFormCols(hdr []string) (map[string]int, bool) {
	idx := map[string]int{}
	for i, cell := range hdr {
		idx[normKey(cell)] = i
	}
	if _, ok1 := idx["id_ledger"]; ok1 {
		if _, ok2 := idx["konfirmasi_aktif"]; ok2 {
			return idx, true
		}
	}
	return idx, false
}

// ── fill-value encoders/decoders ─────────────────────────────────────────────

func parseLayanan(s string) ([]ServiceRow, string) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, ""
	}
	var out []ServiceRow
	for _, part := range strings.Split(s, "|") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		at := strings.LastIndex(part, "@")
		if at < 0 {
			return nil, fmt.Sprintf("layanan tidak valid (butuh nama@harga): %q", part)
		}
		nama := strings.TrimSpace(part[:at])
		m, ok := parseLedgerMoney(part[at+1:])
		if nama == "" || !ok {
			return nil, fmt.Sprintf("layanan tidak valid (butuh nama@harga): %q", part)
		}
		out = append(out, ServiceRow{Nama: nama, HargaDeal: m})
	}
	return out, ""
}

func parseAllocations(s string) ([]AllocationRow, string) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, ""
	}
	var out []AllocationRow
	sum := 0
	for _, part := range strings.Split(s, "|") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		colon := strings.LastIndex(part, ":")
		if colon < 0 {
			return nil, fmt.Sprintf("alokasi_sales tidak valid (butuh NIK:persen): %q", part)
		}
		nik := strings.TrimSpace(part[:colon])
		pct, issue := parsePercentBasisPoints(strings.TrimSpace(part[colon+1:]))
		if nik == "" || issue != "" {
			return nil, fmt.Sprintf("alokasi_sales tidak valid (butuh NIK:persen): %q", part)
		}
		out = append(out, AllocationRow{SalespersonID: nik, BasisPoints: pct})
		sum += pct
	}
	if len(out) > 0 && sum != 10000 {
		return nil, fmt.Sprintf("alokasi_sales total %d%%, harus 100%%", sum/100)
	}
	return out, ""
}

// parsePercentBasisPoints reads "50" or "50.5" (percent) into basis points.
func parsePercentBasisPoints(s string) (int, string) {
	if s == "" {
		return 0, "kosong"
	}
	intPart, fracPart := s, ""
	if i := strings.IndexByte(s, '.'); i >= 0 {
		intPart, fracPart = s[:i], s[i+1:]
	}
	if len(fracPart) > 2 {
		return 0, "terlalu banyak desimal"
	}
	whole := atoiSafe(intPart)
	if whole < 0 {
		return 0, "bukan angka"
	}
	frac := 0
	if fracPart != "" {
		frac = atoiSafe((fracPart + "00")[:2])
		if frac < 0 {
			return 0, "bukan angka"
		}
	}
	return whole*100 + frac, ""
}

func parseTermins(s string) ([]TerminRow, string) {
	pairs, issue := parseAmountDatePairs(s, "jadwal_termin")
	if issue != "" {
		return nil, issue
	}
	out := make([]TerminRow, len(pairs))
	for i, p := range pairs {
		out[i] = TerminRow{Amount: p.amount, DueDate: p.date}
	}
	return out, ""
}

func parsePayments(s string) ([]PaymentRow, string) {
	pairs, issue := parseAmountDatePairs(s, "pembayaran_terverifikasi")
	if issue != "" {
		return nil, issue
	}
	out := make([]PaymentRow, len(pairs))
	for i, p := range pairs {
		out[i] = PaymentRow{Amount: p.amount, Tanggal: p.date}
	}
	return out, ""
}

type amountDate struct {
	amount money.Money
	date   time.Time
}

func parseAmountDatePairs(s, field string) ([]amountDate, string) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, ""
	}
	var out []amountDate
	for _, part := range strings.Split(s, "|") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		at := strings.LastIndex(part, "@")
		if at < 0 {
			return nil, fmt.Sprintf("%s tidak valid (butuh amount@YYYY-MM-DD): %q", field, part)
		}
		m, ok := formMoney(part[:at])
		if !ok {
			return nil, fmt.Sprintf("%s tidak valid (amount): %q", field, part)
		}
		d, err := time.Parse("2006-01-02", strings.TrimSpace(part[at+1:]))
		if err != nil {
			return nil, fmt.Sprintf("%s tidak valid (tanggal YYYY-MM-DD): %q", field, part)
		}
		out = append(out, amountDate{amount: m, date: d})
	}
	return out, ""
}

// formMoney reads a money cell on the FILLED form. Two shapes coexist there:
// the canonical decimal the form itself was prefilled with ("10000000.00",
// dot = DECIMAL point — money.Parse's format), and human-typed ledger style
// ("Rp10.000.000", dots = thousands). A bare single-dot-two-decimals string is
// canonical; everything else goes through parseLedgerMoney. Without this split
// a prefilled "10000000.00" would be re-read 100× too large.
func formMoney(s string) (money.Money, bool) {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '.'); i >= 0 && strings.Count(s, ".") == 1 &&
		len(s)-i-1 == 2 && !strings.ContainsAny(s, ",Rr ") {
		m, err := money.Parse(s)
		if err != nil {
			return 0, false
		}
		return m, true
	}
	return parseLedgerMoney(s)
}

// splitPipe splits a "a|b|c" cell into trimmed non-empty parts.
func splitPipe(s string) []string {
	var out []string
	for _, p := range strings.Split(s, "|") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// sortedDistinct is a small helper kept for deterministic provenance output.
func sortedDistinct(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		if s != "" && !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	sort.Strings(out)
	return out
}
