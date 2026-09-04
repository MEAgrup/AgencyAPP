package importer

// parse_leads.go is the W1-19 LEADS parser (jalur 1): it turns the real
// "Data Cena Sales Performance" `Daily Leads` sheet into []LeadRow for the
// import engine. Filter B (O22 RESOLVED, DECISIONS 2026-07-10):
//
//	import a lead  ⇔  (Qualify == "Qualify" OR Hot truthy OR Warm truthy)
//	                   AND Tanggal >= Since
//
// Rows outside the filter are SKIPPED with per-reason counts (never errors);
// malformed rows (no name AND no phone) and empty-phone rows (dedup impossible)
// are skipped and counted too. Everything that passes becomes a LeadRow; the
// Module 1 dedup engine still has the final say at DryRun/Apply.

import (
	"encoding/csv"
	"io"
	"strings"
	"time"
)

// LeadParseOptions configures the leads parse.
type LeadParseOptions struct {
	// Since is the inclusive lower bound on the lead Tanggal (filter B). The CLI
	// defaults it to 6 months before the run date; a zero value disables the
	// date bound (used by pure tests).
	Since time.Time
	// SalesMap resolves a sheet sales nickname (e.g. "Cena") to an employee_id.
	// A nickname absent from the map leaves SalesPemegang empty (counted in
	// LeadSkipStats.SalesUnresolved) and the lead lands as [Pool] rather than
	// [diproses].
	SalesMap map[string]string
}

// LeadSkipStats is the per-reason tally of rows the parser did NOT emit, plus
// the (non-skip) count of rows whose sales nickname did not resolve.
type LeadSkipStats struct {
	Malformed       int // no name AND no phone
	FilteredOut     int // failed filter B (not Qualify / Hot / Warm)
	BeforeSince     int // dated before Since
	BadDate         int // empty / unparseable Tanggal
	EmptyPhone      int // passed the filter but phone empty (cannot dedup)
	SalesUnresolved int // nickname present but not in SalesMap (row still emitted)
	Emitted         int // rows returned (== len(rows))
}

// leadCols holds the resolved 0-based column indices for the sheet.
type leadCols struct {
	tanggal, nama, phone, sumber, campaign, sales int
	qualify, seller, affiliator, hot, warm, note  int
}

// ParseDailyLeads reads the Daily Leads sheet and returns the leads that pass
// filter B, a per-reason skip tally, and a hard error only for an unreadable
// file / missing header.
func ParseDailyLeads(r io.Reader, opt LeadParseOptions) (rows []LeadRow, skipped LeadSkipStats, err error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1 // ragged rows are normal in exported sheets
	cr.LazyQuotes = true
	records, err := cr.ReadAll()
	if err != nil {
		return nil, skipped, err
	}
	hdrIdx, cols, err := locateLeadHeader(records)
	if err != nil {
		return nil, skipped, err
	}

	for _, rec := range records[hdrIdx+1:] {
		get := func(i int) string {
			if i >= 0 && i < len(rec) {
				return strings.TrimSpace(rec[i])
			}
			return ""
		}

		name := get(cols.nama)
		phone := cleanPhone(get(cols.phone))
		if name == "" && phone == "" {
			skipped.Malformed++
			continue
		}

		qualify := strings.EqualFold(get(cols.qualify), "qualify")
		hot := truthy(get(cols.hot))
		warm := truthy(get(cols.warm))
		if !(qualify || hot || warm) {
			skipped.FilteredOut++
			continue
		}

		d, ok := parseISODate(get(cols.tanggal))
		if !ok {
			skipped.BadDate++
			continue
		}
		if !opt.Since.IsZero() && d.Before(opt.Since) {
			skipped.BeforeSince++
			continue
		}
		if phone == "" {
			skipped.EmptyPhone++
			continue
		}

		salesNick := get(cols.sales)
		salesID := ""
		if salesNick != "" {
			if id, found := opt.SalesMap[salesNick]; found && strings.TrimSpace(id) != "" {
				salesID = strings.TrimSpace(id)
			} else {
				skipped.SalesUnresolved++
			}
		}
		status := "pool"
		if salesID != "" {
			status = "diproses"
		}

		rows = append(rows, LeadRow{
			NamaLead:       name,
			NoTelepon:      phone,
			Sumber:         get(cols.sumber),
			CampaignAsal:   get(cols.campaign),
			SalesPemegang:  salesID,
			StatusTerakhir: status,
			Catatan:        leadNote(get(cols.note), hot, warm, get(cols.seller), get(cols.affiliator)),
		})
	}
	skipped.Emitted = len(rows)
	return rows, skipped, nil
}

// leadNote combines the free-text Note with compact provenance markers so the
// qualification signals survive import (e.g. "sudah follow up; hot prospect;
// seller").
func leadNote(note string, hot, warm bool, seller, affiliator string) string {
	var parts []string
	if note != "" {
		parts = append(parts, note)
	}
	if hot {
		parts = append(parts, "hot prospect")
	}
	if warm {
		parts = append(parts, "warm prospect")
	}
	if truthy(seller) {
		parts = append(parts, "seller")
	}
	if truthy(affiliator) {
		parts = append(parts, "affiliator")
	}
	return strings.Join(parts, "; ")
}

// locateLeadHeader finds the real header row (row 1 of the sheet is decorative)
// by looking for the row carrying both a name and a phone column, then resolves
// every column index by normalized label match.
func locateLeadHeader(records [][]string) (int, leadCols, error) {
	for i, rec := range records {
		cols, ok := mapLeadCols(rec)
		if ok {
			return i, cols, nil
		}
	}
	return 0, leadCols{}, errNoLeadHeader
}

// mapLeadCols resolves the column indices from a candidate header row; ok is
// false unless at least the name + phone columns are present.
func mapLeadCols(rec []string) (leadCols, bool) {
	c := leadCols{
		tanggal: -1, nama: -1, phone: -1, sumber: -1, campaign: -1, sales: -1,
		qualify: -1, seller: -1, affiliator: -1, hot: -1, warm: -1, note: -1,
	}
	for i, cell := range rec {
		k := normKey(cell)
		switch {
		case k == "nama":
			c.nama = i
		case strings.Contains(k, "no handphone") || k == "handphone" || strings.Contains(k, "no hp"):
			c.phone = i
		case strings.HasPrefix(k, "tanggal"):
			if c.tanggal == -1 {
				c.tanggal = i
			}
		case k == "sumber":
			c.sumber = i
		case strings.Contains(k, "detail sumber"):
			c.campaign = i
		case strings.Contains(k, "nama sales"):
			c.sales = i
		case strings.Contains(k, "qualify leads"):
			c.qualify = i
		case strings.HasPrefix(k, "seller"):
			c.seller = i
		case strings.HasPrefix(k, "affiliator"):
			c.affiliator = i
		case strings.Contains(k, "hot") && strings.Contains(k, "prospect"):
			c.hot = i
		case strings.Contains(k, "warm") && strings.Contains(k, "prospect"):
			c.warm = i
		case strings.HasPrefix(k, "note"):
			c.note = i
		}
	}
	if c.nama == -1 || c.phone == -1 {
		return c, false
	}
	return c, true
}
