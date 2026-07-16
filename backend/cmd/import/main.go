// Command import is the W1-19 one-time go-live migration CLI (Director-only).
// It is the thin file-level adapter above internal/importer: parse the real
// spreadsheet exports, then drive the engine's DryRun/Apply paths.
//
// Alur pemakaian (O22/O23 RESOLVED, docs/DECISIONS.md 2026-07-10):
//
//	import leads-dryrun  --actor <NIK> --file daily_leads.csv [--since YYYY-MM-DD] [--sales-map map.csv]
//	import leads-apply   ... (argumen sama)
//	import gen-form      --db-jasa db_jasa.csv [--contacts sheet72.csv] [--run-date YYYY-MM-DD] --out form.csv
//	import clients-dryrun --actor <NIK> --form form_terisi.csv
//	import clients-apply  ... (baris konfirmasi_aktif=N ikut di-land sebagai dormant)
//	import dormant-dryrun --actor <NIK> --db-jasa db_jasa.csv [--run-date YYYY-MM-DD]
//	import dormant-apply  ... (klien Lunas+kedaluwarsa hasil ClassifyLedger)
//
// Format kolom isian form: alokasi_sales "NIK:50|NIK:50" (Σ=100), jadwal_termin
// & pembayaran_terverifikasi "amount@YYYY-MM-DD|..." , konfirmasi_aktif Y/N.
// --sales-map: CSV dua kolom "nickname,employee_id" (nama panggilan sheet → NIK).
//
// DB: env CDPS_DSN (skema harus sudah termigrasi; jalankan `migrate up` dulu).
// Dry-run memegang lock id_sequences selama batch — jalankan saat maintenance
// window (lihat internal/importer/run.go).
package main

import (
	"context"
	"encoding/csv"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/auth"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/core/tz"
	"github.com/meagrup/agencyapp/backend/internal/db"
	"github.com/meagrup/agencyapp/backend/internal/importer"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	cmd, args := os.Args[1], os.Args[2:]

	fs := flag.NewFlagSet(cmd, flag.ExitOnError)
	actorID := fs.String("actor", "", "employee_id pelaksana (wajib Director)")
	file := fs.String("file", "", "CSV Daily Leads (leads-*)")
	since := fs.String("since", "", "batas bawah tanggal lead YYYY-MM-DD (default: 6 bulan sebelum hari ini)")
	salesMap := fs.String("sales-map", "", "CSV nickname,employee_id untuk resolusi Nama Sales")
	dbJasa := fs.String("db-jasa", "", "CSV ledger db_jasa (gen-form / dormant-*)")
	contacts := fs.String("contacts", "", "CSV Sheet72 untuk pengayaan kontak (gen-form)")
	runDate := fs.String("run-date", "", "tanggal acuan klasifikasi aktif/dormant YYYY-MM-DD (default: hari ini)")
	form := fs.String("form", "", "CSV form pelengkap terisi (clients-*)")
	out := fs.String("out", "", "path output form (gen-form)")
	if err := fs.Parse(args); err != nil {
		os.Exit(2)
	}

	ctx := context.Background()

	switch cmd {
	case "gen-form":
		// Murni file→file, tanpa DB/actor.
		clients := mustParseLedger(*dbJasa)
		if *contacts != "" {
			f := mustOpen(*contacts)
			if err := importer.EnrichContacts(clients, f); err != nil {
				log.Fatalf("contacts: %v", err)
			}
			f.Close()
		}
		cl := importer.ClassifyLedger(clients, parseRunDate(*runDate))
		if *out == "" {
			log.Fatal("gen-form butuh --out")
		}
		o, err := os.Create(*out)
		if err != nil {
			log.Fatalf("buat %s: %v", *out, err)
		}
		if err := importer.WriteForm(o, cl.ActiveCandidates); err != nil {
			log.Fatalf("tulis form: %v", err)
		}
		o.Close()
		fmt.Printf("gen-form: %d kandidat aktif → %s ; %d klien dormant (land via dormant-apply)\n",
			len(cl.ActiveCandidates), *out, len(cl.Dormant))
		return

	case "leads-dryrun", "leads-apply", "clients-dryrun", "clients-apply", "dormant-dryrun", "dormant-apply":
		// lanjut di bawah (butuh DB + actor)
	default:
		usage()
		os.Exit(2)
	}

	d, err := db.Open(db.DSN())
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer d.Close()
	if *actorID == "" {
		log.Fatal("butuh --actor <employee_id> (Director)")
	}
	actor, err := auth.ResolveActor(ctx, d, *actorID)
	if err != nil {
		log.Fatalf("resolve actor %s: %v", *actorID, err)
	}
	svc := &importer.Service{DB: d, Engine: statemachine.New()}

	switch cmd {
	case "leads-dryrun", "leads-apply":
		f := mustOpen(*file)
		defer f.Close()
		opt := importer.LeadParseOptions{Since: leadSince(*since), SalesMap: loadSalesMap(*salesMap)}
		rows, stats, err := importer.ParseDailyLeads(f, opt)
		if err != nil {
			log.Fatalf("parse: %v", err)
		}
		fmt.Printf("parser: %d lead lolos filter B (sejak %s); skip: %d di luar filter, %d sebelum batas, %d tanggal rusak, %d tanpa HP, %d malformed; %d nickname sales tak ter-resolusi\n",
			stats.Emitted, opt.Since.Format("2006-01-02"), stats.FilteredOut, stats.BeforeSince, stats.BadDate, stats.EmptyPhone, stats.Malformed, stats.SalesUnresolved)
		var rep importer.Report
		if cmd == "leads-apply" {
			rep, err = svc.Apply(ctx, actor, rows, nil)
		} else {
			rep, err = svc.DryRun(ctx, actor, rows, nil)
		}
		must(err)
		printReport(rep)

	case "clients-dryrun", "clients-apply":
		f := mustOpen(*form)
		defer f.Close()
		active, dormant, issues, err := importer.ParseFilledForm(f)
		if err != nil {
			log.Fatalf("parse form: %v", err)
		}
		for _, is := range issues {
			fmt.Printf("form baris %d (%s): %s\n", is.Row, is.IDLedger, is.Message)
		}
		fmt.Printf("form: %d aktif, %d dormant (konfirmasi N), %d baris bermasalah\n", len(active), len(dormant), len(issues))
		if cmd == "clients-apply" {
			rep, err := svc.Apply(ctx, actor, nil, active)
			must(err)
			fmt.Println("— klien aktif —")
			printReport(rep)
			if len(dormant) > 0 {
				drep, err := svc.ApplyDormant(ctx, actor, dormant)
				must(err)
				fmt.Println("— dormant (dari form) —")
				printReport(drep)
			}
		} else {
			rep, err := svc.DryRun(ctx, actor, nil, active)
			must(err)
			fmt.Println("— klien aktif —")
			printReport(rep)
			if len(dormant) > 0 {
				drep, err := svc.DryRunDormant(ctx, actor, dormant)
				must(err)
				fmt.Println("— dormant (dari form) —")
				printReport(drep)
			}
		}

	case "dormant-dryrun", "dormant-apply":
		cl := importer.ClassifyLedger(mustParseLedger(*dbJasa), parseRunDate(*runDate))
		fmt.Printf("klasifikasi: %d kandidat aktif (via gen-form/clients-*), %d dormant\n",
			len(cl.ActiveCandidates), len(cl.Dormant))
		var rep importer.Report
		if cmd == "dormant-apply" {
			rep, err = svc.ApplyDormant(ctx, actor, cl.Dormant)
		} else {
			rep, err = svc.DryRunDormant(ctx, actor, cl.Dormant)
		}
		must(err)
		printReport(rep)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `usage: import <leads-dryrun|leads-apply|gen-form|clients-dryrun|clients-apply|dormant-dryrun|dormant-apply> [flags]
Jalankan tanpa argumen tiap subcommand untuk daftar flag. Lihat komentar paket untuk alur lengkap.`)
}

func must(err error) {
	if err != nil {
		log.Fatal(err)
	}
}

func mustOpen(path string) *os.File {
	if path == "" {
		log.Fatal("path file wajib diisi (lihat usage)")
	}
	f, err := os.Open(path)
	if err != nil {
		log.Fatalf("buka %s: %v", path, err)
	}
	return f
}

func mustParseLedger(path string) []importer.LedgerClient {
	f := mustOpen(path)
	defer f.Close()
	clients, err := importer.ParseDbJasa(f)
	if err != nil {
		log.Fatalf("parse db-jasa: %v", err)
	}
	return clients
}

func parseRunDate(s string) time.Time {
	if s == "" {
		return tz.BusinessDate(time.Now()) // "hari ini" in WIB (DECISIONS O20)
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		log.Fatalf("--run-date tidak valid: %v", err)
	}
	return t
}

// leadSince resolves --since; default = 6 bulan sebelum hari ini (O22 filter B).
func leadSince(s string) time.Time {
	if s == "" {
		return tz.BusinessDate(time.Now()).AddDate(0, -6, 0) // 6-bulan window in WIB (DECISIONS O20)
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		log.Fatalf("--since tidak valid: %v", err)
	}
	return t
}

func loadSalesMap(path string) map[string]string {
	if path == "" {
		return nil
	}
	f := mustOpen(path)
	defer f.Close()
	cr := csv.NewReader(f)
	cr.FieldsPerRecord = -1
	recs, err := cr.ReadAll()
	if err != nil {
		log.Fatalf("sales-map: %v", err)
	}
	m := map[string]string{}
	for _, r := range recs {
		if len(r) >= 2 && strings.TrimSpace(r[0]) != "" && !strings.EqualFold(strings.TrimSpace(r[0]), "nickname") {
			m[strings.TrimSpace(r[0])] = strings.TrimSpace(r[1])
		}
	}
	return m
}

// printReport prints the reconciliation counts plus every non-clean row (BI
// messages verbatim) — the operator's sign-off view.
func printReport(rep importer.Report) {
	fmt.Printf("total %d | valid %d | duplikat %d | error %d | applied %d | gagal %d\n",
		rep.Total, rep.Valid, rep.Duplikat, rep.Error, rep.Applied, rep.Failed)
	for _, r := range rep.Rows {
		switch r.Status {
		case importer.RowValid, importer.RowApplied:
			if len(r.IssuedIDs) > 0 {
				fmt.Printf("  #%d %s: %s %s\n", r.Index, r.Entity, r.Status, strings.Join(r.IssuedIDs, " "))
			}
		default:
			fmt.Printf("  #%d %s: %s — %s %s\n", r.Index, r.Entity, r.Status, r.Message, r.Detail)
		}
	}
}
