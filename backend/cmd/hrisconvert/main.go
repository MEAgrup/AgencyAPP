// Command hrisconvert converts the raw HRIS spreadsheet export (columns
// `No | NIK | JOIN DATE | NAMA LENGKAP | DEPARTMENT | JABATAN`, as handed
// over by HR) into the EmployeeSource fallback CSV format consumed by
// hris.CSVSource (backend/testdata/employees.csv shape):
// `employee_id,nama,email,divisi,jabatan,status_aktif`.
//
// Usage:
//
//	hrisconvert [-in] <original.csv> [-o out.csv] [--emails nik_email.csv]
//	hrisconvert [-in] <original.csv> --pairs [-o pairs.csv]
//	hrisconvert [-in] <original.csv> [-o out.csv] --exclude-dept "MCN,CREATIVE - EKSTERNAL"
//
// It never invents data: emails are only filled in from --emails, and
// employees whose CSV never had an email stay empty (see the run summary,
// which flags that this blocks login — CDPS logs in by email+password).
//
// --exclude-dept holds back rows whose DEPARTMENT matches (comma-separated,
// trim + case-insensitive exact match) from the emitted EmployeeSource CSV —
// e.g. MCN (a sister-company division out of CDPS scope entirely) or
// CREATIVE - EKSTERNAL (freelance/vendor with no CDPS account), per the
// validated policy in docs/handoff/HRIS_ROLE_MAPPING_DRAFT.md §0. Per house
// convention this is never a silent drop: every excluded row is counted and
// listed in the run summary on stderr. --pairs is unaffected by
// --exclude-dept — it still reports every DEPARTMENT/JABATAN pair seen, since
// it is a discovery aid for building exclude/policy lists in the first place.
//
// The data-quality gate does not silently drop rows: a duplicate NIK, or an
// empty NIK/NAMA LENGKAP/DEPARTMENT/JABATAN on a real data row, is fatal —
// the tool prints every offending row and exits nonzero without emitting
// output. An odd NIK length (the sheet has one 9-digit NIK) is a warning
// only; the row is still emitted.
package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"sort"

	"github.com/meagrup/agencyapp/backend/internal/hris"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("hrisconvert", flag.ContinueOnError)
	fs.SetOutput(stderr)
	in := fs.String("in", "", "path to the original HRIS export CSV (or pass it as the first positional argument)")
	out := fs.String("o", "", "output file path (default: stdout)")
	emailsPath := fs.String("emails", "", "optional 2-column CSV `nik,email` to merge in (never fabricated — see source.go)")
	pairs := fs.Bool("pairs", false, "emit the distinct DEPARTMENT,JABATAN pairs (sorted, with counts) instead of the employee CSV")
	excludeDept := fs.String("exclude-dept", "", "comma-separated DEPARTMENT names to exclude entirely (trim + case-insensitive exact match), e.g. \"MCN,CREATIVE - EKSTERNAL\" — excluded rows are counted and reported on stderr, never silently dropped")
	fs.Usage = func() {
		fmt.Fprintln(stderr, "usage: hrisconvert [-in] <original.csv> [-o out.csv] [--emails nik_email.csv] [--pairs] [--exclude-dept \"MCN,CREATIVE - EKSTERNAL\"]")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return 2
	}

	inPath := *in
	if inPath == "" {
		if fs.NArg() > 0 {
			inPath = fs.Arg(0)
		} else {
			fmt.Fprintln(stderr, "hrisconvert: missing input CSV path")
			fs.Usage()
			return 2
		}
	}

	f, err := os.Open(inPath)
	if err != nil {
		fmt.Fprintf(stderr, "hrisconvert: open %s: %v\n", inPath, err)
		return 1
	}
	defer f.Close()

	res, err := hris.ParseOriginalCSV(f)
	if err != nil {
		fmt.Fprintf(stderr, "hrisconvert: %v\n", err)
		return 1
	}

	var emails map[string]string
	if *emailsPath != "" {
		ef, err := os.Open(*emailsPath)
		if err != nil {
			fmt.Fprintf(stderr, "hrisconvert: open --emails %s: %v\n", *emailsPath, err)
			return 1
		}
		emails, err = hris.ParseNIKEmailMap(ef)
		ef.Close()
		if err != nil {
			fmt.Fprintf(stderr, "hrisconvert: %v\n", err)
			return 1
		}
	}

	if len(res.Issues) > 0 {
		printIssueReport(stderr, res)
		return 1
	}

	dest := stdout
	if *out != "" {
		of, err := os.Create(*out)
		if err != nil {
			fmt.Fprintf(stderr, "hrisconvert: create %s: %v\n", *out, err)
			return 1
		}
		defer of.Close()
		dest = of
	}

	excludeDepts := hris.SplitExcludeDepts(*excludeDept)
	emitRows, excluded := hris.PartitionExcluded(res.Rows, excludeDepts)

	// --pairs reports on ALL accepted rows (including excluded departments) —
	// it is a data-discovery aid for building the exclude/policy lists in the
	// first place, so it must show the full picture, not a pre-filtered one.
	pairsList := hris.DistinctPairs(res.Rows)

	if *pairs {
		if err := hris.WritePairsCSV(dest, pairsList); err != nil {
			fmt.Fprintf(stderr, "hrisconvert: write pairs csv: %v\n", err)
			return 1
		}
	} else {
		if err := hris.WriteEmployeeCSV(dest, emitRows, emails); err != nil {
			fmt.Fprintf(stderr, "hrisconvert: write employee csv: %v\n", err)
			return 1
		}
	}

	printSummary(stderr, res, emitRows, excluded, pairsList, emails)
	return 0
}

func printIssueReport(stderr io.Writer, res hris.ConvertResult) {
	fmt.Fprintf(stderr, "hrisconvert: DATA QUALITY GATE FAILED — %d offending row(s), no output emitted\n", len(res.Issues))
	for _, iss := range res.Issues {
		fmt.Fprintf(stderr, "  line %d [%s]: %s — %s\n", iss.Line, iss.Field, iss.Detail, iss.Row.String())
	}
	fmt.Fprintln(stderr, "Fix the source sheet (or exclude/correct the offending rows) and re-run. No row is dropped silently.")
}

func printSummary(stderr io.Writer, res hris.ConvertResult, emitRows []hris.OriginalRow, excluded []hris.ExcludedRow, pairsList []hris.DeptJabatanPair, emails map[string]string) {
	fmt.Fprintf(stderr, "hrisconvert: summary: %d rows in, %d emitted, %d excluded by --exclude-dept, %d warning(s), %d distinct DEPARTMENT|JABATAN pair(s)\n",
		res.RowsIn, len(emitRows), len(excluded), len(res.Warnings), len(pairsList))
	for _, w := range res.Warnings {
		fmt.Fprintf(stderr, "  WARNING line %d: %s\n", w.Line, w.Detail)
	}
	if len(excluded) > 0 {
		byDept := map[string]int{}
		for _, ex := range excluded {
			byDept[ex.Row.Department]++
		}
		fmt.Fprintf(stderr, "  EXCLUDED (not emitted, per --exclude-dept — never a silent drop):\n")
		for _, ex := range excluded {
			fmt.Fprintf(stderr, "    line %d: %s\n", ex.Row.Line, ex.Row.String())
		}
		depts := make([]string, 0, len(byDept))
		for dept := range byDept {
			depts = append(depts, dept)
		}
		sort.Strings(depts)
		for _, dept := range depts {
			fmt.Fprintf(stderr, "    %d row(s) excluded for DEPARTMENT=%q\n", byDept[dept], dept)
		}
	}
	empty := hris.CountEmptyEmails(emitRows, emails)
	if empty > 0 {
		fmt.Fprintf(stderr,
			"  NOTE: %d of %d employees have NO email (not invented — HR has not supplied one, or --emails was not given).\n"+
				"        Consequence: CDPS login is email+password (see internal/httpapi/auth_handlers.go handleLogin); "+
				"an employee with no email cannot log in until HR supplies one via --emails or a follow-up HRIS update.\n",
			empty, len(emitRows))
	}
}
