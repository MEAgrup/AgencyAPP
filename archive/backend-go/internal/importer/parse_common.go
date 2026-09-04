package importer

// parse_common.go holds the raw-spreadsheet parsing primitives shared by the
// leads and clients parsers (W1-19). These are the "thin adapter" layer above
// the typed LeadRow/ClientRow contracts: they turn the real, messy source
// shapes (float-artifact phones, Indonesian dates, "Rp2.950.000" money, CSV
// header quirks) into the clean typed values the import engine already accepts.
//
// No bracketed BI strings are minted here: parse failures are operator-facing
// tool output (plain Indonesian / neutral), and every business-rule message is
// still produced by the engine downstream.

import (
	"errors"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/money"
)

// Parser-level errors (operator-facing tool output, not engine BI strings): a
// file whose expected header row cannot be found is unrecoverable.
var (
	errNoLeadHeader   = errors.New("daily-leads: header row (Nama + No Handphone) tidak ditemukan")
	errNoDbJasaHeader = errors.New("db-jasa: header row (ID + Status Pembayaran) tidak ditemukan")
	errNoFormHeader   = errors.New("form: header row (id_ledger + konfirmasi_aktif) tidak ditemukan")
)

// indoMonths maps Indonesian month names (full + the abbreviations that appear
// in the ledger: Jan Feb Mar/Maret Apr Mei Jun/Juni Jul/Juli Agu/Agustus Sep
// Okt Nov Des) to a month number. Keys are lowercased.
var indoMonths = map[string]time.Month{
	"jan": time.January, "januari": time.January,
	"feb": time.February, "februari": time.February,
	"mar": time.March, "maret": time.March,
	"apr": time.April, "april": time.April,
	"mei": time.May,
	"jun": time.June, "juni": time.June,
	"jul": time.July, "juli": time.July,
	"agu": time.August, "agt": time.August, "agus": time.August, "agustus": time.August,
	"sep": time.September, "sept": time.September, "september": time.September,
	"okt": time.October, "oktober": time.October,
	"nov": time.November, "november": time.November,
	"des": time.December, "desember": time.December,
}

// parseIndoDate parses ledger dates in the two real shapes: "6-Mei-2025"
// (day-abbrev-year, dash separated) and "17 April 2025" / "7 Maret 2025"
// (day full-month year, space separated). Returns ok=false for anything it
// cannot confidently read (empty, wrong token count, unknown month).
func parseIndoDate(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, false
	}
	s = strings.ReplaceAll(s, "-", " ")
	fields := strings.Fields(s)
	if len(fields) != 3 {
		return time.Time{}, false
	}
	day := atoiSafe(fields[0])
	mon, ok := indoMonths[strings.ToLower(fields[1])]
	year := atoiSafe(fields[2])
	if day < 1 || day > 31 || !ok || year < 1900 {
		return time.Time{}, false
	}
	return time.Date(year, mon, day, 0, 0, 0, 0, time.UTC), true
}

// parseISODate parses the leads-sheet timestamps ("2026-02-01 00:00:00"): only
// the leading YYYY-MM-DD is significant.
func parseISODate(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	if len(s) < 10 {
		return time.Time{}, false
	}
	t, err := time.Parse("2006-01-02", s[:10])
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

func atoiSafe(s string) int {
	n := 0
	for _, r := range strings.TrimSpace(s) {
		if r < '0' || r > '9' {
			return -1
		}
		n = n*10 + int(r-'0')
	}
	if s == "" {
		return -1
	}
	return n
}

// addMonths adds n calendar months to t, clamping the day to the last day of
// the target month (so 31 Jan + 1 month = 28/29 Feb, never a rollover).
func addMonths(t time.Time, n int) time.Time {
	y, m, d := t.Date()
	target := time.Date(y, m, 1, 0, 0, 0, 0, t.Location()).AddDate(0, n, 0)
	last := time.Date(target.Year(), target.Month()+1, 0, 0, 0, 0, 0, t.Location()).Day()
	if d > last {
		d = last
	}
	return time.Date(target.Year(), target.Month(), d, 0, 0, 0, 0, t.Location())
}

// parseLedgerMoney reads the ledger's "Rp2.950.000" (also "Rp 2.950.000",
// "2950000", "2.950.000,00") into Money. Dots are thousands separators; a comma
// (if present) is the decimal separator. Empty / unparseable returns ok=false.
func parseLedgerMoney(s string) (money.Money, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, false
	}
	// Strip currency prefix and spaces.
	s = strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(s, "Rp"), "rp"))
	s = strings.ReplaceAll(s, " ", "")
	if s == "" {
		return 0, false
	}
	intPart, fracPart := s, ""
	if i := strings.IndexByte(s, ','); i >= 0 {
		intPart, fracPart = s[:i], s[i+1:]
	}
	intPart = strings.ReplaceAll(intPart, ".", "") // dots = thousands
	dec := intPart
	if fracPart != "" {
		dec = intPart + "." + fracPart
	}
	m, err := money.Parse(dec)
	if err != nil {
		return 0, false
	}
	return m, true
}

// cleanPhone strips the float artifact ("6285793671691.0" -> "6285793671691")
// that spreadsheet exports leave on numeric-typed phone cells. The M1
// normalizer (module1_leads.NormalizePhone) then handles the 62 / leading-0
// canonicalisation downstream — this only removes the trailing ".0"/".00" that
// would otherwise be read as extra trailing digits.
func cleanPhone(raw string) string {
	s := strings.TrimSpace(raw)
	for _, suf := range []string{".00", ".0"} {
		if strings.HasSuffix(s, suf) {
			s = strings.TrimSuffix(s, suf)
			break
		}
	}
	return s
}

// normKey lowercases, turns newlines into spaces and collapses runs of
// whitespace — used to match spreadsheet header cells whose real labels contain
// embedded newlines ("Qualify\nLeads\n(automatic)").
func normKey(s string) string {
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", " ")
	return strings.Join(strings.Fields(strings.ToLower(s)), " ")
}

// truthy reads the ledger/leads boolean cells ("True"/"False", also 1/ya/yes).
func truthy(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "true", "1", "yes", "ya":
		return true
	}
	return false
}
