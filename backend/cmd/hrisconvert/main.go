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
//
// It never invents data: emails are only filled in from --emails, and
// employees whose CSV never had an email stay empty (see the run summary,
// which flags that this blocks login — CDPS logs in by email+password).
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
	fs.Usage = func() {
		fmt.Fprintln(stderr, "usage: hrisconvert [-in] <original.csv> [-o out.csv] [--emails nik_email.csv] [--pairs]")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return 2
	}

	// Standard flag parsing stops at the first positional argument, but the
	// documented invocation is `hrisconvert <original.csv> --emails ... -o ...`
	// — so keep parsing past the path. Flags placed after it must be honored,
	// never dropped silently (a dropped --emails would emit 186 login-blocking
	// empty emails with exit code 0).
	var positional string
	for fs.NArg() > 0 {
		if positional != "" {
			fmt.Fprintf(stderr, "hrisconvert: unexpected extra argument %q\n", fs.Arg(0))
			fs.Usage()
			return 2
		}
		positional = fs.Arg(0)
		if err := fs.Parse(fs.Args()[1:]); err != nil {
			return 2
		}
	}

	inPath := *in
	if inPath == "" {
		inPath = positional
	}
	if inPath == "" {
		fmt.Fprintln(stderr, "hrisconvert: missing input CSV path")
		fs.Usage()
		return 2
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

	pairsList := hris.DistinctPairs(res.Rows)

	if *pairs {
		if err := hris.WritePairsCSV(dest, pairsList); err != nil {
			fmt.Fprintf(stderr, "hrisconvert: write pairs csv: %v\n", err)
			return 1
		}
	} else {
		if err := hris.WriteEmployeeCSV(dest, res.Rows, emails); err != nil {
			fmt.Fprintf(stderr, "hrisconvert: write employee csv: %v\n", err)
			return 1
		}
	}

	printSummary(stderr, res, pairsList, emails)
	return 0
}

func printIssueReport(stderr io.Writer, res hris.ConvertResult) {
	fmt.Fprintf(stderr, "hrisconvert: DATA QUALITY GATE FAILED — %d offending row(s), no output emitted\n", len(res.Issues))
	for _, iss := range res.Issues {
		fmt.Fprintf(stderr, "  line %d [%s]: %s — %s\n", iss.Line, iss.Field, iss.Detail, iss.Row.String())
	}
	fmt.Fprintln(stderr, "Fix the source sheet (or exclude/correct the offending rows) and re-run. No row is dropped silently.")
}

func printSummary(stderr io.Writer, res hris.ConvertResult, pairsList []hris.DeptJabatanPair, emails map[string]string) {
	fmt.Fprintf(stderr, "hrisconvert: summary: %d rows in, %d emitted, %d warning(s), %d distinct DEPARTMENT|JABATAN pair(s)\n",
		res.RowsIn, len(res.Rows), len(res.Warnings), len(pairsList))
	for _, w := range res.Warnings {
		fmt.Fprintf(stderr, "  WARNING line %d: %s\n", w.Line, w.Detail)
	}
	empty := hris.CountEmptyEmails(res.Rows, emails)
	if empty > 0 {
		fmt.Fprintf(stderr,
			"  NOTE: %d of %d employees have NO email (not invented — HR has not supplied one, or --emails was not given).\n"+
				"        Consequence: CDPS login is email+password (see internal/httpapi/auth_handlers.go handleLogin); "+
				"an employee with no email cannot log in until HR supplies one via --emails or a follow-up HRIS update.\n",
			empty, len(res.Rows))
	}
}
