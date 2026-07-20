# Go-live roster V2 — import karyawan + auth produksi

Sesi 2026-07-20. Konteks: laporan "login `yohan@mea.co.id` / `rahasia123` gagal
dengan `[email atau password salah]`" + permintaan memasukkan roster karyawan
(Data Karyawan V2, 65 baris) ke database supaya CDPS bisa dibuka di production
(`https://agencyapp-frontend-production.up.railway.app`).

## 1. Akar masalah login (penting — dibaca dulu)

`yohan@mea.co.id` **bukan** email produksi Yohan. Itu email **fixture dev**
(`backend/testdata/employees.csv`, dipakai mock-HRIS untuk testing). Email riil
Yohan pada roster V2 adalah **`Yohanagustian@meagency.co.id`** (domain
`@meagency.co.id`, bukan `@mea.co.id`; local-part `Yohanagustian`, bukan
`yohan`). Jadi kombinasi yang dicoba salah pada nama **dan** domain.

Selain itu, penyebab utama: **tabel `employees` di produksi kemungkinan besar
masih kosong.** Sejak redesain auth (DECISIONS 2026-07-19) auth 100% lokal CDPS;
HRIS tinggal sumber data karyawan. Image Railway (`backend/Dockerfile`) hanya
mengemas binary + migrations — TIDAK ada `testdata/employees.csv` maupun
`HRIS_BASE_URL` yang valid — sehingga `initial sync` saat boot bersifat
best-effort dan tidak mengisi baris apa pun. Tanpa baris `employees`, **setiap**
email menghasilkan `[email atau password salah]` (lihat
`internal/auth/local.go` `VerifyLocal`: email tak ditemukan → error generik yang
sama, anti-enumerasi). Untuk konfirmasi, dari akses DB produksi:

```sql
SELECT COUNT(*) FROM employees;
SELECT employee_id, email FROM employees WHERE email LIKE '%ohan%';
```

Bila count = 0 → itu konfirmasi. Login baru mungkin setelah langkah §4 dijalankan.

## 2. Status Railway (dari sesi ini)

Sesi ini **tidak bisa menjangkau Railway** — egress policy menolak
`agencyapp-frontend-production.up.railway.app` (403 CONNECT), sama seperti
`docs.google.com`. Jadi pengecekan deployment live dan penulisan ke DB produksi
**harus dilakukan pihak yang punya akses Railway** (lihat `docs/DEPLOY_RAILWAY.md`).
Yang bisa dipastikan dari repo: config deploy sudah benar (PR #18 merged); yang
belum = pengisian data + bootstrap kredensial (langkah §4).

## 3. Artefak yang disiapkan di branch ini

Digenerate dari roster V2 (65 karyawan) memakai konvensi importer repo:

| File | Isi |
|---|---|
| `backend/testdata/import_samples/employees_cdps.csv` | 65 karyawan (`employee_id`=NIK, nama, email di-trim, `divisi`/`jabatan` = DEPARTMENT/JABATAN mentah HRIS, `status_aktif=true`). Sudah lolos `hris.ParseEmployeeCSV` (65 baris, semua field terisi, ID unik, email tak ada yang duplikat/kosong). |
| `backend/testdata/import_samples/nik_email.csv` | Peta `nik,email` (65). |
| `backend/seed/role_mappings_riil.csv` | 43 mapping `(divisi,jabatan) → (division,level)` — dibaca `cmd/rolemapseed`. |
| `backend/seed/layered_roles_riil.csv` | 6 layered role: `director` untuk Yohan (`200000001`) & Nerissa (`200000002`); `od` untuk OKFA (`2409230432`, HRGA), ARSY (`2501140493`), GHIFARI (`2507250557`), WULAN (`2607060683`). |

Prinsip mapping = **least-privilege**: bila ragu → `staff` / tanpa mapping,
tidak pernah `lead`/`od`/`director` (permission house rule #6). Semua asumsi
di §5 wajib dikonfirmasi product owner sebelum `--apply` ke produksi.

## 4. Runbook import produksi

Jalankan dari **checkout repo** (bukan dari container Railway — CLI & file seed
tidak ada di image) dengan `CDPS_DSN` = URL MySQL publik Railway. Urutan wajib
(employees dulu; seed layered memvalidasi `employee_id` ada di `employees`).

```bash
cd backend
PROD="mysql://user:pass@host:port/dbname"   # dari Railway MySQL (MYSQL_URL/DATABASE_URL)

# 1) Skema
CDPS_DSN="$PROD" go run ./cmd/migrate up

# 2) Karyawan — full sync 65 baris dari roster (upsert; boot cdps = mekanisme sync resmi)
CDPS_DSN="$PROD" CDPS_SEED_CSV="testdata/import_samples/employees_cdps.csv" \
  go run ./cmd/cdps
#   tunggu log: "initial sync: synced=65 deactivated=0 flagged=0" → hentikan (Ctrl-C)

# 3) Role mapping + layered role — WAJIB dry-run dulu, review, baru apply
CDPS_DSN="$PROD" go run ./cmd/rolemapseed            # dry-run
CDPS_DSN="$PROD" go run ./cmd/rolemapseed --apply    # tulis 43 mapping + 6 layered

# 4) Bootstrap password Director pertama (Yohan) — chicken-and-egg break
CDPS_DSN="$PROD" go run ./cmd/setpass 200000001 "<password-temporer-min-8-char>"
```

Setelah itu Yohan login di `/login`:
- **Email:** `Yohanagustian@meagency.co.id`
- **Password:** `<password-temporer>` → sistem memaksa ganti password saat login
  pertama (`must_change_password=1`), lalu akses penuh (Director).

Selanjutnya Yohan (atau Nerissa, bootstrap `setpass 200000002 ...`) men-set
password karyawan lain lewat panel admin kredensial
(`POST /api/v1/auth/admin/set-password`) atau `setpass` per NIK.

## 5. Keputusan yang perlu konfirmasi product owner (sebelum §4 langkah 3 apply)

Roster V2 menambah 26 pasangan DEPARTMENT/JABATAN baru di luar batch-1
(DECISIONS 2026-07-17). Yang tegas mengikuti preseden sudah dipetakan; yang
di bawah ini **asumsi least-privilege** dan menentukan HAK AKSES:

1. **KOL di bawah dept ACCOUNT** — `KOL SPECIALIST` (×2) & `INTERN KOL` (×2)
   dipetakan → **KOL / staff** (fungsi KOL punya modul sendiri). Bila mereka
   sebenarnya kerja Account murni, ganti ke `Account`.
2. **ADVERTISER di bawah dept ACCOUNT** — `ADVERTISER` (×2) & `ADVERTISER INTERN`
   → **Ads / staff**. Bila harus Account, ganti.
3. **CREATIVE / `LEADER VIDEOGRAPHER`** → **Creative / staff** (konservatif;
   BUKAN `lead`) karena model sub-tim Creative masih Open **O35**. Bila ini
   memang lead sub-tim dengan akses divisi-wide, naikkan ke `lead`.
4. **FINANCE AND ACCOUNTING** — dept ini baru (batch-1 pakai `FINANCE`).
   `FINANCE AND ACCOUNTING`, `ACCOUNTING INTERN`, dan
   `SENIOR FINANCE, ACCOUNTING & TAX` → **Finance / staff** (tak ada
   HEAD OF FINANCE di roster → tak ada `lead` Finance). Konfirmasi apakah
   `SENIOR FINANCE, ACCOUNTING & TAX` seharusnya lead.
5. **DATA & BUSINESS INTELLIGENCE / `DATA ANALYST INTERN`** (`2602190629`) →
   **tanpa mapping & tanpa layered** = bisa login, hanya lihat data sendiri.
   Bukan divisi CDPS. Konfirmasi apakah perlu layered `od` atau akses lain.
6. **OD & HRGA** → layered **`od`** (read-only everywhere + OKR): 3 orang dept OD
   + OKFA (HRGA SUPERVISOR HR, meneruskan preseden batch-1). Konfirmasi.
7. **Director** → Yohan & Nerissa layered **`director`**, tanpa mapping divisi.
   Ini sekaligus **menutup Open O26** (NIK+email Director) dengan data riil dari
   roster V2. Konfirmasi email final (lihat catatan data §6).

## 6. Catatan kualitas data roster (sumber)

- **Baris ENDANG PUJI ASTUTI (`2510020578`)**: JABATAN `SENIOR FINANCE,
  ACCOUNTING & TAX` mengandung koma tanpa quote di CSV sumber → menggeser kolom.
  Sudah dinormalkan jadi satu jabatan `SENIOR FINANCE, ACCOUNTING & TAX`.
  Konfirmasi ini benar satu jabatan (bukan dua kolom terpisah).
- **Email Nerissa** (`Nerissa.arv@meagency.co.id`) punya trailing space di
  sumber — sudah di-trim.
- Semua 65 karyawan punya email (tak ada yang kosong) → semua bisa di-provision.
- Roster V2 memutakhirkan snapshot lama (mis. SYIFA `2412090425` pindah dari
  ACCOUNT ke FINANCE AND ACCOUNTING, email berubah). V2 dianggap otoritatif.
