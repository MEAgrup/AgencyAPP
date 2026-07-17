# Handoff — Sesi 2026-07-17 (M1 dedup v2 + O19–O21/O24 + role mapping riil + WIB)

> Konteks lengkap untuk sesi build berikutnya. Dokumen sebelumnya yang masih relevan:
> `HANDOFF_MSL_KALKULATOR.md` (poin 2–3 & 5 masih berlaku), `HANDOFF_JALUR_B_SESSION2.md`
> (§A urutan import W1-19), `W1-20_UAT_RUNBOOK.md`, `LANGKAH_MANUSIA_GO_LIVE.md`.

## Status saat handoff

**Branch:** `claude/build-process-continuation-rcuch7` — **PR #8 (draft)**:
https://github.com/MEAgrup/AgencyAPP/pull/8 — 9 commit, CI hijau, full test `go test -p 1 ./...` hijau.

**Pola kerja sesi ini (berhasil, pakai lagi):** Fable = orchestrator/QC/revisi; eksekutor
subagent = opus (backend berat: dedup v2, WIB), sonnet (data/CLI: pipeline HRIS, importer,
rolemapseed), haiku (docs/DECISIONS). QC orchestrator menangkap & merevisi beberapa
kesalahan faktual eksekutor docs — selalu QC hasil haiku terhadap sumber.

## Apa yang selesai sesi ini

1. **M1 dedup v2 kolaboratif** (DECISIONS 2026-07-10 → implementasi 2026-07-17):
   single-reg atas lead ber-attempt terbuka milik sales lain = **JOIN** (attempt baru,
   audit `dedup_join`, notifikasi event katalog ke-14 `m1.lead.co_pursuit`, notice
   `[lead juga sedang dikerjakan sales lain]`); milik sendiri = block
   `[anda sudah memiliki prospek aktif untuk lead ini]`; pintu import tak berubah.
   `Register` kini return notice (4 nilai); handler menyertakan `"notice"` bila non-kosong.
2. **O19 RESOLVED**: `MatchByPhone` + `IsTerminalAttemptStatus` diekspor; LEFT JOIN
   (attempt karyawan belum sinkron tetap terhitung); mirror importer dihapus;
   `Decide(channel, match, actor)` param aktor wajib.
3. **O21 RESOLVED**: roster 39 karyawan + email dari HR → drop-zone
   `backend/testdata/import_samples/` (`hris_karyawan.csv`, `nik_email.csv`,
   `employees_from_hris.csv`, `hris_department_jabatan_pairs.csv`). **NIK KTP sengaja
   tidak dibawa ke repo.** Smoke sync 39/39 OK.
4. **O24 RESOLVED** (Yohan): komisi riil salesperson TIDAK dibuat — `commission_rule
   = 0% of standard price` berlaku; komisi Rp0 SAH di UAT. Worksheet MSL tinggal
   validasi `usulan_standard_price` (kolom komisi diabaikan).
5. **Role mapping riil batch-1** (jawaban Yohan): 23 mapping di
   `backend/seed/role_mappings_riil.csv` (ADVERTISER→Ads, BISDEV→Marketing[divisi baru
   sebagai data, modul M2 Wave 3], SALES/ACCOUNT/CREATIVE langsung); CREATIVE - EKSTERNAL
   & SKILSKUL **keluar** (tanpa akses, tak di-sync); HRGA/OKFA (2409230432) = layered
   **OD** (`backend/seed/layered_roles_riil.csv`). CLI **`cmd/rolemapseed`** (pola
   mslseed: dry-run default, `--apply`, aktor SYSTEM bootstrap). Sumber sync go-live =
   **`employees_cdps.csv` (33 baris)** — bukan file 39.
6. **O20 RESOLVED — WIB**: paket `internal/core/tz` (FixedZone +7); bucketing kalender
   (prefix bulan ID `ident`, reminder today/H-3/hari-overdue M5, "MSL effective today")
   pindah WIB; timestamp absolut tetap. Klasifikasi lengkap semua titik waktu ada di
   laporan sesi (lihat commit `feat(core): O20`).

## Menunggu manusia

| Apa | Siapa | Blocking apa |
|---|---|---|
| **O26**: baris karyawan (NIK + email) **Yohan & Nerissa** — keduanya tidak ada di roster 39 | HR/Yohan | layered Director riil di produksi (dev/UAT bisa pakai fixture) |
| File import W1-19: `w119_daily_lead.csv` dkk. + `form_pelengkap` terisi + `db_jasa.csv` (penamaan: `backend/testdata/import_samples/README.md`) | CRO/Finance/Sales | import klien & leads riil (§A HANDOFF_JALUR_B_SESSION2) |
| O25 (anomali kalkulator: Nano KOL min 10, "komisi 5%" Store Mgmt, enforcement GMV Max 8,5jt) | Sales Head/COO | tidak blocking |
| O18 (linkage MSL layanan legacy import) | Yohan + Sales Head | W1-19 real run |
| Endpoint HRIS staging (`GET /employees`, `POST /auth/verify`) | tim HRIS | login riil non-mock |
| Witness demo staging S0-12 (head dev + Nerissa) | manusia | go/no-go operasional |

## Pekerjaan sesi berikutnya (urutan saran)

1. **Review & merge PR #8** (sesi ini memantau: subscription + check-in terjadwal aktif).
2. **W1-20 UAT end-to-end** (`W1-20_UAT_RUNBOOK.md`) — blocker teknisnya sudah bersih:
   login pakai data riil via mock HRIS (email tersedia), komisi = Rp0 (sah per O24),
   role mapping ter-seed, tanggal WIB. Urutan siapkan lingkungan: migrate up → boot
   `cmd/cdps` dengan `CDPS_SEED_CSV=testdata/import_samples/employees_cdps.csv` →
   `go run ./cmd/rolemapseed --apply` → `go run ./cmd/mslseed --apply` (32 layanan,
   komisi 0%). Catatan: karyawan riil BELUM punya password — cek mekanisme auth mock
   (`internal/auth`) untuk UAT login.
3. Begitu file W1-19 masuk drop-zone → **import** sesuai §A `HANDOFF_JALUR_B_SESSION2.md`
   (dry-run dulu; catatan maintenance window lock `id_sequences` tetap berlaku).
4. Begitu O26 masuk → tambah baris `director` di `layered_roles_riil.csv` + rerun
   `rolemapseed --apply` (idempoten).
5. Setelah exit criteria Wave 1 lolos → **Wave 2** (M6, **M12 early**, M7–M10).

### Jangan dikerjakan tanpa keputusan
- Qualified Form UI frontend (backend siap; pakai pola quote-preview /sales/kalkulator).
- Enforcement batas passthrough GMV Max (tunggu O25).
- Cap 5 layanan/Qualified Form (perubahan = keputusan PRD Nerissa).
- Email case-sensitivity login: 4 email full-uppercase + 5 kapital-sebagian di roster —
  MySQL collation default case-insensitive sehingga kemungkinan aman, tapi BELUM diuji;
  uji saat UAT login (vektor: `SAFFIRAMARWAH@GMAIL.COM` vs input lowercase).

## Peta file kunci (baru sesi ini)

- `backend/internal/module1_leads/dedup.go` — tabel keputusan v2 (`OutcomeJoin`, `OpenAttempt`)
- `backend/internal/module1_leads/leads.go` — `Register` 4-return + notice, `MatchByPhone`,
  `IsTerminalAttemptStatus`, `Service.Catalog`
- `backend/internal/core/notification/notification.go` — event ke-14 `EvLeadCoPursuit`
- `backend/internal/core/tz/tz.go` — WIB helpers (`Date`/`DateString`/`Period`/`DaysBetween`)
- `backend/cmd/rolemapseed/` — CLI seed role mapping + layered roles
- `backend/seed/role_mappings_riil.csv`, `backend/seed/layered_roles_riil.csv`
- `backend/testdata/import_samples/employees_cdps.csv` (33; sumber sync go-live),
  `employees_from_hris.csv` (39; arsip provenance), `hris_karyawan.csv`, `nik_email.csv`,
  `hris_department_jabatan_pairs.csv`
- `docs/DECISIONS.md` — 8 entri baru 2026-07-17 (dedup v2, O19, O21, O24, role mapping
  batch-1, O20/WIB) + Open **O26**

## Environment notes (container baru)

- MariaDB TIDAK terpasang di container segar: `apt-get update && apt-get install -y
  mariadb-server`, `service mariadb start`, buat DB `cdps` + `cdps_test` + user
  `cdps`/`cdps_dev`. `apt-get update` WAJIB dulu.
- Test DB-backed WAJIB `go test -p 1 ./...` (kontensi TRUNCATE `cdps_test`); jangan
  jalankan dua agent test bersamaan.
- DB dev container sesi ini sudah berisi hasil smoke: 39 employees (33 aktif-sync,
  6 flagged absent), 23 role_mappings, 1 layered OD, 32 layanan MSL — ephemeral.
- ID ber-period UTC yang sudah tercetak di DB dev = ephemeral, tidak dimigrasi (O20).
