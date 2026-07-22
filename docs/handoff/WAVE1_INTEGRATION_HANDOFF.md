# Handoff — CDPS Wave 1 Integration (A↔B merge)

> Ringkasan sesi integrator Wave 1. Wave 1 money path sudah **merged ke `main`** dan
> pengembangan berikutnya (Wave 2) sudah berjalan di atasnya. Dokumen ini merekam
> apa yang mendarat di integrasi Wave 1 + konvensi agar sesi berikutnya cepat lanjut.

## Status
- **Wave 1 money path: MERGED ke `main`** via PR **#6** (merge commit awal `2a75125`).
- Semua PR Wave 1 lama ditutup: **#1/#2/#5** (disupersede), **#3/#4** (WIP lineage lama).
- `main` sudah maju melewati titik merge Wave 1 — Wave 2 sedang berjalan (mis. M6
  Account Service: service lahir `[Awaiting Onboarding]` + `requires_strategy_plan`;
  MSL v2 calculator: `PricingMode`/quantity/passthrough; paket `core/tz` untuk
  bucketing tanggal WIB = resolusi O20; fix registrasi M1 snake_case). **Selalu
  `git fetch origin main` dan baca kode terbaru sebelum bekerja** — snapshot di bawah
  bisa sudah berubah.

## Yang mendarat di integrasi Wave 1 (fondasi B kanonik + domain A di-port)
- **Fondasi B kanonik**: core engines (`ident`, `notification`, `permission`,
  `statemachine`, `audit`, `money`), skema **`0002_wave1_money_path` (kontrak beku)**,
  httpapi, importer W1-19, admin MSL (`admin.EffectiveAt` = lookup version-at-date).
- **M1 leads** (`internal/module1_leads`): `Register`/dedup (B), `ClaimFromPool`,
  `ResolveWin` (win-resolution → `[Closed - Kalah Kompetisi]`, satu pemenang, idempoten).
- **M0 sales** (`internal/module0_sales`): `MarkContacted`, `SubmitQualifiedForm`
  (komisi di-pin dari MSL), `SetNotQualified` (NQ 7-reason + `[Lainnya ...]`),
  negosiasi berversi + approval superior-only + `AcceptCounter`/`Resubmit`, `Close`
  (lahirkan atomik ke tabel 0002 + panggil `WinResolverFunc`).
  `commission.go`/`allocation.go` **frozen**.
- **M4 client** + **M5 finance** (fondasi B): verifikasi → routing gate
  (`released_to_account_at`) → visibility + lock matrix.
- **Migrasi baru integrasi**: `0006_qualified_forms` (qualified_forms +
  qualified_form_services). Win-resolution memakai `leads.winning_attempt_id` (sudah di 0002).
- **State machine (`config.go`)**: A#O18 accept-counter = salesperson; A#O21=B#O16
  resubmit; `[Closed - Kalah Kompetisi]` terminal + edge auto.
- **Wiring**: `httpapi/leads_handlers.go` + `sales_handlers.go` + route di
  `routes_leads_sales.go`; `WinResolverFunc` di-bind ke M1 `ResolveWin` via `salesSvc()`.

## Verifikasi (saat merge Wave 1)
- `go test ./... -p 1` hijau; `go vet` bersih; migrasi up→down→up bersih; CI (#6) hijau.
- **Cross-flow E2E**: `backend/internal/integration/crossflow_test.go` —
  registrasi → qualified (komisi MSL) → nego approval → pool contest → closing
  (baris 0002 + win-resolution) → verifikasi → routing gate → lock matrix.
- Unit test per modul: `module0_sales/flow_test.go`, `module1_leads/winresolve_test.go`.

## Setup dev di container baru (container ephemeral — wajib tiap sesi)
- MySQL tak terpasang default: `apt-get install -y --fix-missing mariadb-server`,
  init `mariadb-install-db --user=mysql --datadir=/var/lib/mysql`, start `mysqld_safe`,
  buat DB `cdps`/`cdps_test` + user `cdps`/`cdps_dev`, `SET GLOBAL log_bin_trust_function_creators=1`.
- Env: `export CDPS_TEST_DSN="cdps:cdps_dev@tcp(127.0.0.1:3306)/cdps_test?parseTime=true&multiStatements=true"`
  (+ `CDPS_DSN` ke `/cdps`).
- CI (`.github/workflows/ci.yml`) pakai MySQL 8.0, user `root`/`root`.

## Utang/Deferred dari integrasi (di `docs/DECISIONS.md`, blok "Wave 1 Integration")
- Port byte-faithful sisa test stream A; handler bulk single-reg M1; pin MSL untuk
  layanan yang baru ditambah pada tahap negosiasi (jalur inti pakai layanan Qualified Form).

## Item manusia sebelum go-live (Open questions B-stream)
- **O21**: daftar email karyawan (NIK→email) untuk login riil. **O18**: mapping
  layanan legacy→MSL (W1-19 real run). **W1-20 UAT**: satu deal end-to-end di staging.
  (**O20** UTC vs WIB sudah di-resolve ke WIB via `core/tz` di main.)

## Urutan build berikutnya (per CLAUDE.md)
Wave 2: **M6 → M12 (early) → M7 → M8 → M9 → M10** (M6 sudah dimulai di main).

## Aturan rumah (jangan dilanggar)
PRD = spec; ambiguitas PRD-vs-kode = STOP + flag di `docs/DECISIONS.md`. Skema beku —
ubah hanya via migrasi baru. Status hanya via transition engine. ID via `ident.Next`
setelah validasi. Audit append-only. String BI verbatim dalam `[...]`. IDR
`Rp. X.XXX.XXX,00`. DoD: validasi BI, permission per role (incl. layered OD/Director),
immutability, recompute-from-log, seed fixture tetap lolos.
