# Handoff — Sesi MSL v2 Kalkulator (2026-07-16)

> Konteks lengkap untuk sesi build berikutnya. Baca ini + `HANDOFF_JALUR_B_SESSION2.md`
> (masih berlaku untuk bagian import data manusia) sebelum mulai.

> **Update 2026-07-16 (sesi lanjutan):** PR #7 merged; O19/O20/O25a resolved; M1 v2 dedup kolaboratif terimplementasi; smoke UAT fixture lolos (`W1-20_UAT_PREP_2026-07-16.md`). Sisa blocking manusia: O24 (komisi 32 layanan), O25b/c, O21 (NIK→email), file import W1-19.

## Status saat handoff

**Branch:** `claude/fable-orchestrator-setup-uh30eo` — 6 commit, CI hijau semua, **PR #7 (draft)** menunggu review: https://github.com/MEAgrup/AgencyAPP/pull/7

**Pola kerja sesi ini:** Fable = orchestrator/QC/revisi; eksekutor subagent = opus (backend), sonnet (data/CLI/frontend), haiku (docs). Pola ini bisa dipakai lagi.

## Apa yang selesai (MSL v2 = model kalkulator, end-to-end)

Sumber MSL aktif ditetapkan: Google Sheet **"Kalkulator Service Jasa"** tab "Kalkulator 1"
(https://docs.google.com/spreadsheets/d/1vUbJDcbuqmqrcEMoTTbiYbGil0zTp8Of_jH6070m644 — akses via Google Drive connector). Ini meng-unblock poin **C. Seed MSL** dari handoff Jalur B.

1. **Keputusan** (`DECISIONS.md` 3 baris 2026-07-16): MSL v2 model kalkulator; basis komisi persentase = subtotal baris; komisi seed interim `0% of standard price` eksplisit. Open baru: **O24** (komisi riil dari Sales Head — blocking UAT komisi) & **O25** (anomali sheet).
2. **Seed kanonik:** `backend/seed/msl_kalkulator.csv` — 32 layanan (8 kategori), mode harga & PPN dipetakan dari formula sheet; deskripsi verbatim tab "Note". Worksheet validasi Sales Head: `docs/handoff/MSL_KALKULATOR_VALIDASI.md` (berisi 7+ anomali & cara mengisi komisi).
3. **Backend** (migrasi **0014**): kolom kalkulator di `master_service_versions` (category/unit/min_qty/pricing_mode/apply_ppn/frequency/price_note/description) + pin lengkap di `qualified_form_services` (quantity/input_amount/subtotal + parameter; backfill subtotal=standard_price). Pricing engine `internal/module0_sales/pricing.go`: `flat` | `min_floor` | `batch_ceiling` | `passthrough`, PPN 11% round half-up, semua via `core/money` (`money.Mul` guard overflow). Estimasi Nilai = Σ subtotal; komisi % dihitung dari subtotal. Endpoint baru `POST /api/v1/sales/quote-preview`. Jalur no-nego negosiasi membaca `subtotal`.
4. **CLI `mslseed`** (`backend/cmd/mslseed`): dry-run default, `--apply`, `--actor <NIK>` (wajib lolos `admin.CanEditMasterServices`), idempoten by nama layanan (rerun = skip; field berubah = versi baru). Validasi semua baris sebelum menyentuh DB.
5. **Frontend `web-internal`:** halaman **/sales/kalkulator** ("Kalkulator Penawaran" di sidebar) — grup kategori urutan sheet, input qty/nominal (passthrough), debounce ke quote-preview, subtotal/total HANYA dari string IDR server. Admin `/master-services` menampilkan & mengedit field kalkulator.
6. `.claude/settings.json` — allowlist permission perintah rutin (git/go/npm) supaya outage classifier auto-mode tidak memblokir kerja rutin (disetujui Yohan).

**Test:** backend 25 paket hijau (`go test -p 1 ./...`, MariaDB); vektor test = angka formula sheet; recompute-from-pin; migrasi 0014 reversible; fixtures Alpha Digital tetap lolos. Frontend build+lint hijau.

## Menunggu manusia (urutan go-live MSL)

1. **Sales Head** isi `commission_rule` riil per 32 layanan + konfirmasi anomali (worksheet `MSL_KALKULATOR_VALIDASI.md`). Anomali terpenting: **Nano KOL batas minimal — ✅ FIXED ke 1** (O25a resolved 2026-07-16), basis "komisi 5%" Store Management (O25b open), enforcement budget min GMV Max Rp8,5jt (O25c open).
2. Tim dev update CSV / input via admin, lalu:
   ```bash
   go run ./cmd/mslseed --actor <NIK_SALES_HEAD_ATAU_DIRECTOR>          # dry-run, periksa rencana
   go run ./cmd/mslseed --actor <NIK> --apply
   ```
3. Item lama masih terbuka: **O21** (NIK→email untuk login — blocking login riil), **O20** ✅ (UTC vs WIB — RESOLVED ke Asia/Jakarta WIB 2026-07-16, sumber tunggal `core/tz`), file-file import data manusia (lihat `LANGKAH_MANUSIA_GO_LIVE.md`).

## Pekerjaan sesi berikutnya (urutan saran)

1. ✅ **Review & merge PR #7** (SELESAI — PR #7 termerge ke main 2026-07-16).
2. Begitu data manusia masuk → jalankan **import W1-19** (urutan lengkap di `HANDOFF_JALUR_B_SESSION2.md` §A) + **sync HRIS** (§B).
3. **W1-20 UAT** end-to-end (runbook: `W1-20_UAT_RUNBOOK.md`) — sekarang bisa memakai kalkulator untuk Estimasi Nilai di Qualified Form.
4. ✅ **Redesign M1 dedup jadi kolaboratif** (SELESAI 2026-07-16 — dedup kolaboratif terimplementasi per DECISIONS 2026-07-16, STATE_MACHINES.md §2 direvisi, runbook langkah 3 diupdate) + **O19 RESOLVED** (LEFT JOIN memastikan attempt unsynced-owner tidak hilang).
5. Setelah exit criteria Wave 1 lolos UAT → **Wave 2** (M6, **M12 early**, M7, M8, M9, M10) sesuai Build Plan §4.

### Ide lanjutan MSL (belum diputuskan — jangan kerjakan tanpa keputusan)
- Qualified Form UI di frontend belum ada (backend sudah); halaman kalkulator baru preview lepas. Saat membangun UI M0, pakai pola quote-preview yang sama.
- Enforcement batas operasional passthrough (GMV Max min 8,5jt) — tunggu keputusan O25.
- Cap 5 layanan per Qualified Form (M0 §4.3) terasa sempit untuk deal kalkulator multi-item — kalau mau diubah HARUS lewat keputusan PRD (Nerissa), bukan diputuskan dev.

## Peta file kunci (baru sesi ini)

- `backend/migrations/0014_msl_calculator.{up,down}.sql`
- `backend/internal/module0_sales/pricing.go` (+`pricing_test.go`) — engine 4 mode
- `backend/internal/module0_sales/commission.go` — komisi basis subtotal, `LineFromView`
- `backend/internal/module0_sales/qualified.go` — `resolveLines`, `PreviewQuote`, pin lengkap
- `backend/internal/admin/master_service.go` — 8 field baru + validasi mode
- `backend/internal/httpapi/sales_handlers.go` — `handleQuotePreview` (`/api/v1/sales/quote-preview`)
- `backend/cmd/mslseed/` — CLI seed (main/csv/validate/engine/paths + test)
- `backend/seed/msl_kalkulator.csv` — 32 layanan kanonik
- `backend/internal/core/money/money.go` — `money.Mul`
- `web-internal/src/app/(shell)/sales/kalkulator/page.tsx` + `src/lib/sales.ts`
- `docs/handoff/MSL_KALKULATOR_VALIDASI.md` — worksheet Sales Head + cara seed

## Environment notes (container baru)

- MariaDB TIDAK terpasang di container segar: `apt-get update && apt-get install -y mariadb-server`, `service mariadb start`, lalu buat DB `cdps` + `cdps_test` + user `cdps`/`cdps_dev` (DSN default Makefile). `apt-get update` WAJIB dulu (indeks basi → 404).
- Test DB-backed wajib `go test -p 1 ./...` — paralel flaky karena kontensi TRUNCATE di shared `cdps_test` (pre-existing, bukan bug produk).
- Google Drive connector bisa membaca sheet kalkulator langsung (`read_file_content` / export xlsx via `download_file_content`).
- DB dev container sesi ini sudah berisi 32 layanan hasil smoke-run `mslseed --apply` — ephemeral, tidak relevan untuk produksi.
- `web-internal/AGENTS.md` mengklaim Next.js hasil modifikasi dengan docs di `node_modules/next/dist/docs/` — direktori itu tidak ada di paket ter-install; perlakukan klaim itu sebagai tidak berlaku (build normal `next@16.x` jalan).
