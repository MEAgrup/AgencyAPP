package importer

// sales_resolve_test.go covers the W1-19 sales-name resolution fallback
// (DECISIONS.md 2026-07-11): normalization, precedence (explicit sales_map.csv
// wins; empty-employee_id short-circuits; ambiguous names never auto-resolve;
// case/space-insensitive matching), and the distinct-unresolved report. Pure,
// no DB (LoadEmployeeNameIndex itself is exercised indirectly via NewEmployeeNameIndex).

import (
	"testing"
)

// ── normalizeSalesName ───────────────────────────────────────────────────────

func TestNormalizeSalesName(t *testing.T) {
	cases := map[string]string{
		"Budi Santoso":     "budi santoso",
		"  Budi   Santoso": "budi santoso",
		"BUDI SANTOSO":     "budi santoso",
		"budi\tsantoso":    "budi santoso",
		"":                 "",
		"   ":              "",
	}
	for in, want := range cases {
		if got := normalizeSalesName(in); got != want {
			t.Errorf("normalizeSalesName(%q) = %q, want %q", in, got, want)
		}
	}
}

// ── EmployeeNameIndex: unique match, case/space-insensitive, ambiguous ──────

func TestEmployeeNameIndexResolve(t *testing.T) {
	idx := NewEmployeeNameIndex([]EmployeeRef{
		{EmployeeID: "EMP-001", Nama: "Budi Santoso"},
		{EmployeeID: "EMP-002", Nama: "Dewi Lestari"},
	})

	if id, ok := idx.Resolve("Budi Santoso"); !ok || id != "EMP-001" {
		t.Fatalf("exact match: id=%q ok=%v", id, ok)
	}
	if id, ok := idx.Resolve("  budi   SANTOSO "); !ok || id != "EMP-001" {
		t.Fatalf("case/space-insensitive match: id=%q ok=%v", id, ok)
	}
	if _, ok := idx.Resolve("Tono Wijaya"); ok {
		t.Fatal("unknown name must not resolve")
	}
	if idx.Ambiguous("Budi Santoso") {
		t.Fatal("unique name must not be flagged ambiguous")
	}
}

func TestEmployeeNameIndexAmbiguousNameNeverResolves(t *testing.T) {
	idx := NewEmployeeNameIndex([]EmployeeRef{
		{EmployeeID: "EMP-001", Nama: "Budi Santoso"},
		{EmployeeID: "EMP-777", Nama: "budi   santoso"}, // same normalized name, different casing/spacing
		{EmployeeID: "EMP-002", Nama: "Dewi Lestari"},
	})

	if _, ok := idx.Resolve("Budi Santoso"); ok {
		t.Fatal("ambiguous name (>1 employee) must not auto-resolve")
	}
	if !idx.Ambiguous("Budi Santoso") {
		t.Fatal("Ambiguous must report true for a name shared by >1 employee")
	}
	if !idx.Ambiguous("  BUDI SANTOSO  ") {
		t.Fatal("Ambiguous lookup must itself be case/space-insensitive")
	}
	// Unaffected third name still resolves normally.
	if id, ok := idx.Resolve("Dewi Lestari"); !ok || id != "EMP-002" {
		t.Fatalf("unrelated unique name must still resolve: id=%q ok=%v", id, ok)
	}
}

func TestEmployeeNameIndexEmptyNameIgnored(t *testing.T) {
	idx := NewEmployeeNameIndex([]EmployeeRef{{EmployeeID: "EMP-001", Nama: "   "}})
	if _, ok := idx.Resolve(""); ok {
		t.Fatal("empty name must never resolve")
	}
}

func TestEmployeeNameIndexNilSafe(t *testing.T) {
	var idx *EmployeeNameIndex
	if _, ok := idx.Resolve("anything"); ok {
		t.Fatal("nil index Resolve must be false, not panic")
	}
	if idx.Ambiguous("anything") {
		t.Fatal("nil index Ambiguous must be false, not panic")
	}
}

// ── resolveSalesName precedence ─────────────────────────────────────────────

func TestResolveSalesNamePrecedence(t *testing.T) {
	idx := NewEmployeeNameIndex([]EmployeeRef{
		{EmployeeID: "EMP-CENA", Nama: "Cena Wijaya"}, // full legal name also present in employees
		{EmployeeID: "EMP-ANDI", Nama: "Andi Saputra"},
	})

	t.Run("explicit sales_map wins over fallback", func(t *testing.T) {
		opt := LeadParseOptions{
			SalesMap:  map[string]string{"Cena": "EMP-SALESHEAD"}, // override: nickname "Cena" -> a DIFFERENT NIK
			NameIndex: idx,
		}
		id, found, shortCircuit := resolveSalesName("Cena", opt)
		if !shortCircuit || id != "EMP-SALESHEAD" {
			t.Fatalf("explicit map must win: id=%q found=%v shortCircuit=%v", id, found, shortCircuit)
		}
	})

	t.Run("empty employee_id short-circuits (deliberate no-PIC)", func(t *testing.T) {
		opt := LeadParseOptions{
			SalesMap:  map[string]string{"Cekat AI": ""},
			NameIndex: idx,
		}
		id, found, shortCircuit := resolveSalesName("Cekat AI", opt)
		if !shortCircuit {
			t.Fatal("empty-NIK sales_map entry must short-circuit")
		}
		if id != "" || found {
			t.Fatalf("deliberate no-PIC must yield empty id and found=false: id=%q found=%v", id, found)
		}
	})

	t.Run("fallback to full-name index when absent from map", func(t *testing.T) {
		opt := LeadParseOptions{SalesMap: map[string]string{}, NameIndex: idx}
		id, found, shortCircuit := resolveSalesName("andi saputra", opt) // case-insensitive
		if shortCircuit {
			t.Fatal("must not short-circuit: name is not in SalesMap")
		}
		if !found || id != "EMP-ANDI" {
			t.Fatalf("fallback must resolve via NameIndex: id=%q found=%v", id, found)
		}
	})

	t.Run("not found and not ambiguous -> unresolved", func(t *testing.T) {
		opt := LeadParseOptions{SalesMap: map[string]string{}, NameIndex: idx}
		_, found, shortCircuit := resolveSalesName("Tono Tidak Dikenal", opt)
		if shortCircuit || found {
			t.Fatalf("unknown name must be unresolved: found=%v shortCircuit=%v", found, shortCircuit)
		}
	})

	t.Run("ambiguous name is not resolved by fallback", func(t *testing.T) {
		ambigIdx := NewEmployeeNameIndex([]EmployeeRef{
			{EmployeeID: "EMP-A", Nama: "Sinta Dewi"},
			{EmployeeID: "EMP-B", Nama: "Sinta Dewi"},
		})
		opt := LeadParseOptions{SalesMap: map[string]string{}, NameIndex: ambigIdx}
		_, found, shortCircuit := resolveSalesName("Sinta Dewi", opt)
		if shortCircuit || found {
			t.Fatalf("ambiguous name must not resolve: found=%v shortCircuit=%v", found, shortCircuit)
		}
		if !ambigIdx.Ambiguous("Sinta Dewi") {
			t.Fatal("expected Ambiguous=true for reporting")
		}
	})

	t.Run("nil NameIndex disables fallback without panic", func(t *testing.T) {
		opt := LeadParseOptions{SalesMap: map[string]string{}}
		_, found, shortCircuit := resolveSalesName("Andi Saputra", opt)
		if shortCircuit || found {
			t.Fatalf("nil NameIndex must behave as no fallback: found=%v shortCircuit=%v", found, shortCircuit)
		}
	})
}

// ── unresolvedSalesTracker: distinct names, counts, stable sort ────────────

func TestUnresolvedSalesTrackerDistinctAndSorted(t *testing.T) {
	tr := newUnresolvedSalesTracker()
	tr.add("Zaki Rahman", false)
	tr.add("Sinta Dewi", true)
	tr.add("Zaki Rahman", false) // repeat -> count, not a new entry
	tr.add("", false)           // blank must be ignored
	tr.add("aditya", false)

	got := tr.report()
	if len(got) != 3 {
		t.Fatalf("want 3 distinct names, got %d: %+v", len(got), got)
	}
	// Alphabetical (case-insensitive): aditya, Sinta Dewi, Zaki Rahman.
	if got[0].Name != "aditya" || got[1].Name != "Sinta Dewi" || got[2].Name != "Zaki Rahman" {
		t.Fatalf("sort order: %+v", got)
	}
	var zaki UnresolvedSalesReport
	for _, u := range got {
		if u.Name == "Zaki Rahman" {
			zaki = u
		}
	}
	if zaki.Count != 2 {
		t.Fatalf("Zaki Rahman count: %d", zaki.Count)
	}
	var sinta UnresolvedSalesReport
	for _, u := range got {
		if u.Name == "Sinta Dewi" {
			sinta = u
		}
	}
	if !sinta.Ambiguous {
		t.Fatal("Sinta Dewi must carry Ambiguous=true")
	}
}

func TestUnresolvedSalesTrackerEmpty(t *testing.T) {
	tr := newUnresolvedSalesTracker()
	if got := tr.report(); len(got) != 0 {
		t.Fatalf("empty tracker must report zero rows, got %+v", got)
	}
}

// Sanity: normalizeSalesName is exactly the whitespace/case rule used by
// header matching (normKey) minus the newline handling — verifies no drift
// between the two independent normalizers' whitespace-collapsing behaviour.
func TestNormalizeSalesNameCollapsesLikeNormKeyForPlainText(t *testing.T) {
	in := "  Ari   Kusuma  "
	if got, want := normalizeSalesName(in), normKey(in); got != want {
		t.Fatalf("normalizeSalesName(%q)=%q vs normKey(%q)=%q diverge on plain text", in, got, in, want)
	}
}
