# Handoff — Sesi 2026-07-16 (M1 v2 kolaboratif + WIB + koreksi Nano KOL)

> Konteks untuk sesi build berikutnya. Baca ini + `HANDOFF_MSL_KALKULATOR.md` (sudah
> di-update sesi ini) + `HANDOFF_JALUR_B_SESSION2.md` (masih berlaku untuk import data
> manusia) + `W1-20_UAT_PREP_2026-07-16.md` (hasil smoke).

## Status saat handoff

**Branch:** `claude/fable-orchestrator-setup-3t5o1g` — 7 commit di atas `main` (271c812),
sudah di-push, **belum ada PR** (menunggu instruksi Yohan). Working tree bersih.
Kalau branch ini nanti termerge: sesi lanjutan WAJIB restart branch dari `origin/main`
(aturan yang sama seperti sesi sebelumnya), jangan menumpuk di atas history termerge.

**Pola kerja sesi ini (bisa dipakai lagi):** Fable = orchestrator/QC/revisi; eksekutor
subagent paralel di git worktree terisolasi + DB test terpisah per agent
(`cdps_test_m1`, `cdps_test_wib`): opus ×2 (backend), sonnet (data/seed), haiku (docs).
⚠️ Catatan QC: laporan haiku untuk dokumen UAT berisi payload/endpoint fabrikasi dan
DITOLAK — ditulis ulang orchestrator dari transkrip asli. Pakai haiku hanya untuk edit
docs mekanis yang seluruh isinya sudah disediakan di prompt, dan selalu QC hasilnya.

## Yang selesai sesi ini (semua di DECISIONS.md entri 2026-07-16)

1. **O25a RESOLVED** — Nano KOL `min_qty` 10→1 (typo sheet, keputusan Yohan via interview).
   `backend/seed/msl_kalkulator.csv` + `MSL_KALKULATOR_VALIDASI.md` §2/§3 direvisi.
   Terverifikasi live: qty=1 → `Rp. 5.550.000,00` (bukan Rp. 55.500.000,00).
2. **O20 RESOLVED** — bucketing tanggal bisnis UTC → **Asia/Jakarta**, serentak.
   Sumber kebenaran tunggal baru: `backend/internal/core/tz` (`Location`/`BusinessDate`/
   `Period`, embed `time/tzdata`). Terpengaruh: prefix bulan ID (satu titik di
   `core/ident.Next`), reminder overdue/H-3/dashboard, tanggal efektif harga MSL,
   default `--run-date`/`--since` importer. Kontrak-7-hari SENGAJA tetap elapsed-duration.
   Tanpa migrasi data.
3. **M1 v2 — dedup registrasi Sales KOLABORATIF** (eksekusi keputusan Nerissa 2026-07-10):
   - `Decide` bercabang per channel + outcome baru `OutcomeJoin`: single-reg atas lead
     yang sedang dikerjakan sales lain / `[Pool]` / in-process → lampirkan `PRSP-`
     registrant ke lead existing, audit `dedup_join`, notifikasi event katalog ke-14
     `m1.lead.also_pursued` ke owner attempt aktif LAIN. Block tersisa hanya
     `[Closed-Success]`. Import Marketing TIDAK berubah (tetap eksklusif).
   - String BI baru (tercatat DECISIONS): informasional `[lead juga sedang dikerjakan
     sales lain (nama)]` (201 join) dan `[anda sudah memproses lead ini]` (409 guard
     same-sales — temuan QC, sebelumnya jatuh ke 500).
   - `Register` return `(Lead, Attempt, *JoinNotice, error)`; respons join:
     `{joined:true, message, notified_owners}`.
   - `STATE_MACHINES.md` §2 + runbook UAT langkah 3 direvisi.
4. **O19 RESOLVED** — `matchByPhone` `JOIN`→`LEFT JOIN employees` (attempt milik karyawan
   belum tersinkron HRIS tidak hilang dari dedup; nama fallback ke `owner_employee_id`);
   mirror importer W1-19 byte-identik. Konsekuensi channel import: attempt unsynced-owner
   kini terdeteksi in-process (dulu diam-diam reopen).
5. **Persiapan UAT W1-20** — smoke HTTP API riil semua lolos (login, register, join,
   409 guard, notifikasi, quote-preview; prefix ID `202607` = bulan WIB). Detail +
   tabel langkah yang masih butuh manusia: `W1-20_UAT_PREP_2026-07-16.md`.
6. **Verifikasi:** `go vet` bersih; full suite DB-backed `go test -p 1 -count=1 ./...`
   **21 paket ok** (baseline main: 20; +`core/tz`).

## Keputusan interview Yohan 2026-07-16 (tercatat di DECISIONS)

- Nano KOL min_qty = 1 ✅ (di atas).
- Timezone = Asia/Jakarta ✅ (di atas).
- O24: komisi TETAP 0% interim (belum ada angka dari Sales Head).
- Scope yang DIPILIH: M1 dedup kolaboratif + persiapan UAT. Yang TIDAK dipilih
  (jangan dikerjakan tanpa keputusan baru): Qualified Form UI M0 di web-internal,
  enforcement GMV Max Rp8,5jt (O25c).

## Menunggu manusia (blocking, urutan prioritas)

1. **O24** — Sales Head isi `commission_rule` riil 32 layanan (worksheet
   `MSL_KALKULATOR_VALIDASI.md`) → `mslseed` dry-run → apply. Blocking UAT komisi.
2. **O25b** (basis "komisi 5%" Store Management) + **O25c** (enforce GMV Max?) —
   Sales Head/COO.
3. **O21** — daftar NIK→email dari HR (blocking login riil).
4. **File import W1-19** — sales_map.csv, form_pelengkap.csv (239 klien), nik_email.csv,
   jawaban role mapping (`LANGKAH_MANUSIA_GO_LIVE.md`). Begitu masuk: import W1-19
   (`HANDOFF_JALUR_B_SESSION2.md` §A) + sync HRIS (§B).
5. **O18** — linkage MSL layanan legacy import (Yohan + Sales Head).

## Pekerjaan sesi berikutnya (urutan saran)

1. Kalau Yohan minta: buat PR branch ini ke `main`, review, merge.
2. Data manusia masuk → import W1-19 + sync HRIS → **UAT W1-20 manusia**
   (runbook sudah selaras M1 v2).
3. Ide yang menunggu keputusan (JANGAN dikerjakan tanpa keputusan): Qualified Form UI
   M0 (pakai pola quote-preview), enforcement GMV Max (O25c), cap 5 layanan per
   Qualified Form (keputusan PRD Nerissa), import channel ikut kolaboratif (dicatat
   sebagai ambiguitas di DECISIONS entri M1 v2).
4. Setelah exit criteria Wave 1 lolos UAT → Wave 2 (M6, M12 early, M7–M10).

## Environment notes (container baru)

- MariaDB TIDAK terpasang di container segar: `apt-get update && apt-get install -y
  mariadb-server`, `service mariadb start`, buat DB `cdps` + `cdps_test` + user
  `cdps`/`cdps_dev` (DSN default Makefile). `apt-get update` WAJIB dulu.
- Test DB-backed wajib `go test -p 1 ./...` (kontensi TRUNCATE di `cdps_test`).
  Untuk eksekutor paralel: beri tiap agent DB test sendiri via `CDPS_TEST_DSN`.
- Smoke server lokal: `cmd/mockhris` (:8081, password fixture `rahasia123`) +
  `cmd/cdps` (:8080). `RegisterInput` tanpa tag JSON → payload pakai nama field Go
  (`LeadName`/`PhoneNumber`/`Source`); sesi via cookie `cdps_session`.
- DB dev container sesi ini berisi hasil smoke (32 layanan MSL ter-apply, 1 lead +
  2 attempt + 1 notifikasi) — ephemeral, tidak relevan untuk produksi.
