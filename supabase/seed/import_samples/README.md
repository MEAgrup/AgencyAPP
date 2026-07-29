# Drop-zone: export spreadsheet untuk Jalur B (W1-19 / HRIS / MSL)

Environment build remote tidak bisa membuka `docs.google.com` (network policy), jadi
cara tercepat membuka blocker: **export tiap sheet ke CSV (satu file per tab) atau XLSX,
commit ke folder ini**, lalu minta sesi Claude Code melanjutkan — parser W1-19, adapter
HRIS, dan kompilasi MSL langsung dikerjakan dari file di sini.

Link sumber + konteks lengkap: `docs/handoff/WAVE1_EXTERNAL_REQUESTS.md` §"Jawaban diterima (2026-07-10)".

## Penamaan file yang diharapkan (per tab)

| Sumber | File |
|---|---|
| Data karyawan HRIS (format asli) | `hris_karyawan.csv` (atau `hris_karyawan.xlsx`) |
| Dashboard team account | `msl_team_account__<nama-tab>.csv` |
| Database client | `msl_database_client__<nama-tab>.csv` |
| Dashboard sales — tab dashboard iklan | `w119_dashboard_sales__iklan.csv` |
| Dashboard sales — tab dashboard organik | `w119_dashboard_sales__organik.csv` |
| Daily lead (quality lead) | `w119_daily_lead.csv` |
| Prospek dan closing | `w119_prospek_closing.csv` |
| Rekapan harian sales (seller/affiliate/ga respon/bad respon) | `w119_rekapan_harian.csv` |

Catatan:
- Export **apa adanya** — header asli, data kotor/tidak lengkap justru dibutuhkan
  (dry-run report W1-19 dirancang dari realita, lihat Permintaan #3).
- Kalau satu spreadsheet punya banyak tab dan ragu tab mana yang relevan, export semua tab.
- Data ini berisi PII (nama, telepon) — folder ini untuk kebutuhan migrasi go-live;
  jangan dipakai sebagai fixture test permanen tanpa anonimisasi.

## UAT login gate (mock HRIS berisi data riil) — 2026-07-17

File tambahan untuk UAT W1-20/Wave 2 (keputusan: mock HRIS + roster riil = gate login UAT;
lihat DECISIONS 2026-07-17):

| File | Isi |
|---|---|
| `employees_uat.csv` | = `employees_cdps.csv` (33 riil) + **2 fixture Director** (`UATDIR0001/0002` — O26; ganti baris riil Yohan & Nerissa begitu NIK+email masuk) + **2 fixture Finance** (`UATFIN0001/0002` — O33) + **5 fixture Wave 2** (`UATKOL0001/0002`, `UATCRE0001`, `UATADS0001`, `UATLSS0001` — O34) + **1 fixture Wave 3** (`UATMKT0001` Marketing lead — preseden O34, roster HR tanpa lead Marketing/BD) = **43 baris** |
| `layered_roles_uat.csv` | = `seed/layered_roles_riil.csv` + `UATDIR0001,director` + `UATDIR0002,director` |
| `role_mappings_uat.csv` | = `seed/role_mappings_riil.csv` (23) + mapping fixture Finance O33 (2) + mapping fixture Wave 2 O34 (5) + mapping fixture Wave 3 (1: `BUSINESS DEVELOPMENT,HEAD OF BUSINESS DEVELOPMENT → Marketing,lead`) = **31 mapping** — pakai via `--role-csv` |

Urutan boot UAT (semua dari `backend/`):
1. `go run ./cmd/migrate up`
2. `CDPS_SEED_CSV=testdata/import_samples/employees_uat.csv MOCKHRIS_ADDR=:8081 go run ./cmd/mockhris`
3. `CDPS_SEED_CSV=testdata/import_samples/employees_uat.csv HRIS_BASE_URL=http://127.0.0.1:8081 go run ./cmd/cdps` (auto-migrate + auto-sync 43)
4. `go run ./cmd/rolemapseed --role-csv testdata/import_samples/role_mappings_uat.csv --layered-csv testdata/import_samples/layered_roles_uat.csv` (dry-run) → `--apply`
5. `go run ./cmd/mslseed --actor 2101180004` (dry-run) → `--apply` (aktor = Head of Sales riil)

Kredensial UAT: semua karyawan login dengan email riil + password bersama `rahasia123`
(default parser bila kolom ke-7 `password` tidak ada). Password per-orang bisa diberikan
TANPA perubahan kode dengan menambah kolom ke-7 di `employees_uat.csv`. UAT-only —
produksi memakai endpoint HRIS asli (CDPS tidak menyimpan password).
Case email TERUJI dua arah (uppercase tersimpan ↔ input lowercase, dan sebaliknya).
