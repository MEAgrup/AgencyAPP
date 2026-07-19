# Handoff — FE M0 Sales + M1 Leads workspace (+ read API backend)

> Sesi 2026-07-19 (lanjutan `HANDOFF_SESSION_20260719_FRONTEND_W2W3.md` §Langkah berikutnya
> butir 3). Pola kerja sama: Fable = orchestrator + QC + revisi; eksekutor Opus (backend
> read API, halaman /sales), Sonnet (lib FE, halaman /leads), Haiku (/leads/[id]).

## Lokasi & branch

- **Branch:** `claude/fe-m0-m1-sales-leads-jazm79` (base `main` @ `ace2902`). Sudah di-push.
- Commit kunci: `6e6ad3d` lib FE → `cafc6ea`/`027ebe3` backend read + rute → `0e85345` /leads
  → `ed73421` /sales → `86c8519`/`51c6e1c` revisi QC Fable.

## Yang dibangun

### Backend (gap yang ditemukan recon: M0/M1 hanya punya endpoint POST — tidak ada read API
sama sekali, padahal M1 §9.4 mewajibkannya; juga tidak ada endpoint Closed-Lost)

Semua di `routes_leads_sales.go` + `leads_sales_read_handlers.go` + `module0_sales/reads.go`
+ `module1_leads/reads.go`:

- `GET /api/v1/attempts[?status=]` — list scoped (Sales staff=own; Sales lead/OD/Director=semua).
- `GET /api/v1/attempts/{id}` — detail: attempt+lead+qualified_form(+lines pinned)+proposals
  (versi ASC, decision_note)+nq_reasons+allowed_transitions (engine).
- `GET /api/v1/leads/pool` — record_status `[Pool]`, `stale` (>24 jam, M1-OA-7),
  `open_attempt_count`, `my_open_attempt`. Sales/OD/Director.
- `GET /api/v1/leads[?status=&q=]` — Marketing staff = created_by sendiri ATAU origin campaign
  miliknya (`campaigns.owner_employee_id`); Marketing lead/Sales lead/OD/Director = semua;
  Sales staff 403.
- `GET /api/v1/leads/{id}` — lead + kontes attempts; Sales pemegang attempt ikut boleh baca.
- `POST /api/v1/attempts/{id}/lost` — Closed-Lost via engine (edge M0 §5: dari Rejected/
  Approved/Auto Approved; selainnya diblok pesan BI default).

Tests: `leads_sales_read_handlers_test.go` (5 test besar — permission per role incl. OD
layered write-denied, filter, stale/kontes, 404/403/409 verbatim, no-mutation-on-denied).

### Frontend `web-internal`

- `lib/sales.ts` (extend) + `lib/leads.ts` (baru) — types & fungsi 1:1 kontrak; konstanta
  verbatim NQ_REASONS/PAYMENT_SCHEMES/ATTEMPT_STATUSES/SOURCES.
- `/sales` — workspace: list attempt (chips status, kolom owner utk lead/OD/Director),
  form Registrasi Lead (M0 §3, notice co-pursuit ditampilkan verbatim).
- `/sales/[id]` — lifecycle penuh: Contacted → Qualified Form (§4.3, platform checklist,
  picker MSL maks 5, preview `quote-preview` read-only) / Not Qualified (taksonomi M1-OA-8,
  Lainnya wajib teks) → Negosiasi (no-nego vs editor lines; keputusan superior Approve/
  Revise/Reject note-wajib; Terima Counter / Resubmit) → Closing Form (§6: primary terkunci,
  alokasi % → basis point Σ=100 live, PIC bila >1, skema bayar 4 verbatim, installment
  Termin/Bayar di Belakang) → Closed-Lost. Riwayat proposal + audit immutable di bawah.
- `/leads` — tab per role: Pool (claim kompetitif, badge STALE, "N sales mengerjakan"),
  Database (cari q + filter status), Import (pintu Marketing: single = bulk 1 baris — BUKAN
  `POST /leads` yang menciptakan attempt milik pengirim; bulk paste CSV, summary verbatim,
  daftar penolakan + unduh CSV).
- `/leads/[id]` — info lead, kontes attempts, histori audit.
- Sidebar: seksi **Akuisisi** (Sales Workspace, Leads) sebelum Delivery.

## Verifikasi

- `go vet ./...`, `go build ./...` ✅; **`go test -p 1 ./...` FULL SUITE hijau** (MySQL 8 lokal,
  DB `cdps_test`) — termasuk semua wave lama, tanpa regresi.
- `npm run lint` 0 error, `npm run build` sukses (33 rute).
- QC Fable per modul: endpoint/field vs backend (baca dari kode Go), pesan BI verbatim
  hanya dari server/konstanta, computed read-only, gating role + OD layered read-only,
  divisi kanonik kapital, IDR `formatIDR`/'—', kelas CSS valid, Next 16 `use(params)`.

## Catatan environment test (penting utk sesi berikutnya)

MySQL 8 Ubuntu: `log_bin` aktif default → `CREATE TRIGGER` oleh user non-SUPER gagal
(error 1419) → migrasi setengah jadi → kegagalan test menyesatkan (403/404 acak + audit
tidak immutable). Solusi: `SET GLOBAL log_bin_trust_function_creators=1` lalu DROP/CREATE
ulang `cdps_test` sebelum test. Sudah diterapkan di container ini.

## Utang / belum dikerjakan

- Smoke test manual FE↔BE hidup utk M0/M1 (pola runbook `FE_UAT_RUNBOOK.md`) — belum.
- `platform` Qualified Form disimpan satu string join ", " (kolom tunggal backend);
  per-platform sub-data M4-OA-2 tetap terbuka sebagai utang backend lama.
- Kategori Bisnis = input teks (PRD bilang multiple choice tanpa enumerasi — tidak
  mengarang opsi; layak dicatat di DECISIONS bila mau enum).
- Utang lama lintas modul tetap: `DIVISIONS` lowercase legacy Wave 1 di form role-mappings.
- Sisa FE: M2/M3 (marketing/campaign), M15 portal (terakhir, tunggu spec security).

## Langkah berikutnya

1. Review manusia + merge PR branch ini (buat PR bila diminta).
2. Smoke test manual M0/M1 (boot UAT = README import_samples §UAT + mock HRIS).
3. FE M2/M3 menyusul pola yang sama.
