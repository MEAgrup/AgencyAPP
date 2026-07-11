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
	// SalesMap is the sales_map.csv EXCEPTION override (DECISIONS 2026-07-11):
	// an explicit "raw sheet name -> employee_id" entry. Highest precedence —
	// checked BEFORE the automatic full-name fallback. An entry mapping to an
	// EMPTY employee_id is a deliberate no-PIC marker (e.g. a bot source like
	// "Cekat AI"): it short-circuits resolution for that name (no PIC, NOT
	// counted as unresolved, never falls through to NameIndex).
	SalesMap map[string]string
	// NameIndex is the automatic fallback: normalized full-name -> employee_id,
	// built from the live `employees` table (LoadEmployeeNameIndex). Used only
	// for names absent from SalesMap. A nil index disables the fallback (pure
	// unit tests that only exercise SalesMap).
	NameIndex *EmployeeNameIndex
}

// LeadSkipStats is the per-reason tally of rows the parser did NOT emit, plus
// the (non-skip) count of rows whose sales name did not resolve.
type LeadSkipStats struct {
	Malformed       int // no name AND no phone
	FilteredOut     int // failed filter B (not Qualify / Hot / Warm)
	BeforeSince     int // dated before Since
	BadDate         int // empty / unparseable Tanggal
	EmptyPhone      int // passed the filter but phone empty (cannot dedup)
	SalesUnresolved int // name present but not resolved by SalesMap nor NameIndex (row still emitted)
	Emitted         int // rows returned (== len(rows))

	// Unresolved lists the DISTINCT raw sales names that did not resolve (with
	// per-name row counts and an ambiguous flag), so the operator sees exactly
	// which names to add to sales_map.csv instead of only a bare counter.
	Unresolved []UnresolvedSalesReport
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
	unresolved := newUnresolvedSalesTracker()

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

		salesName := get(cols.sales)
		salesID := ""
		if salesName != "" {
			if id, found, shortCircuit := resolveSalesName(salesName, opt); shortCircuit {
				salesID = id // explicit map entry: resolved (id != "") or deliberate no-PIC (id == "")
			} else if found {
				salesID = id
			} else {
				skipped.SalesUnresolved++
				unresolved.add(salesName, opt.NameIndex.Ambiguous(salesName))
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
	skipped.Unresolved = unresolved.report()
	return rows, skipped, nil
}

// resolveSalesName runs the precedence order for one row's raw sales name
// (DECISIONS 2026-07-11): explicit sales_map.csv entry first (including its
// empty-employee_id short-circuit for a deliberate no-PIC source), then the
// automatic full-name fallback against NameIndex.
//
// Return shape: id is the resolved employee_id (possibly "" for a deliberate
// no-PIC map entry); shortCircuit is true iff an explicit SalesMap entry
// matched (caller must NOT fall through to the unresolved counter/report in
// that case, even when id == ""); found is true iff the NameIndex fallback
// produced a unique match (only consulted when shortCircuit is false).
func resolveSalesName(rawName string, opt LeadParseOptions) (id string, found bool, shortCircuit bool) {
	if mapped, ok := opt.SalesMap[rawName]; ok {
		return strings.TrimSpace(mapped), false, true
	}
	if opt.NameIndex != nil {
		if resolvedID, ok := opt.NameIndex.Resolve(rawName); ok {
			return resolvedID, true, false
		}
	}
	return "", false, false
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
