# UAT — Resign permanen (PR #340 / PR-1 dari 5), 2026-09-10

> **Status: DIJALANKAN, LOLOS.** Migrasi sudah di live `CDPS SG` lebih dulu (O65),
> PR #340 sudah di-merge sesudahnya (`714da1a`). Berkas ini adalah buktinya, plus
> **tiga temuan pre-existing** yang sengaja TIDAK diperbaiki di PR itu.

## 0. Kenapa berkas ini ada

Daftar "⚠️ Sebelum merge" di PR #340 punya tiga butir. Dua di antaranya bisa
dituntaskan oleh sesi (migrasi live + UAT peramban), satu adalah aksi pemilik.
Berkas ini menuntaskan yang kedua dan mencatat hasilnya, supaya klaim "UAT lolos"
bisa diperiksa ulang alih-alih dipercaya.

## 1. Migrasi live — dibuktikan lewat kueri, bukan lewat `success: true`

Diterapkan ke `CDPS SG` sebagai `resign_permanen`.

| | sebelum | sesudah |
|---|---|---|
| tabel · prefix · mesin · event | 155 · 43 · 34 · 73 | **155 · 43 · 34 · 73** (tidak bergerak) |
| ledger migrasi | 219 | **220** (tepat +1) |
| `resigned_at` / `resigned_by` | tidak ada | ada, keduanya `NULL`-able |
| `private.employee_roster()` | tidak ada | ada, `SECURITY DEFINER`, `search_path=public, pg_temp` |
| `employees_select` | 3 lengan | **4 lengan**, ketiga lengan baseline utuh |
| advisors `security` | 28 / 1 / 8 / 3 / 1 | **28 / 1 / 8 / 3 / 1** — nol temuan baru |

Dua hal yang dilakukan SEBELUM `DROP POLICY employees_select` dijalankan, dan
keduanya wajib diulang oleh siapa pun yang menerapkan migrasi ber-`DROP POLICY`:

1. **Definisi policy live dibaca lebih dulu** (`pg_get_expr(polqual, polrelid)`)
   dan dicocokkan dengan baseline yang diasumsikan migrasi. Kalau live sudah
   punya lengan yang tidak ada di repo, `DROP`+`CREATE` akan **menghapusnya
   tanpa galat**. Live cocok persis, jadi tidak ada yang hilang.
2. **Ledger dan gate diambil sebagai angka SEBELUM**, supaya "+1" dan "tidak
   bergerak" bisa dibuktikan, bukan diasumsikan.

`GRANT` pada `employee_roster()`: `authenticated`, `service_role` (+ `postgres`
sebagai owner). Nol `anon`, nol `public`.

Nol baris data ditulis: `select count(*) from employees where resigned_at is not null` = **0**.

### 1.1 Kedua CHECK diuji MENGGIGIT di live

Di dalam `DO $$ … $$` yang selalu berakhir `RAISE EXCEPTION`, sehingga seluruh
transaksi di-rollback. Verdict-nya dibaca dari pesan galatnya sendiri — itu
sengaja: sebuah uji tulis ke produksi yang bisa gagal me-rollback adalah uji
yang tidak boleh dijalankan.

| percobaan | hasil |
|---|---|
| `resigned_at` saja | ditolak `ck_employees_resign_lengkap` |
| `resigned_at` + `resigned_by` + `status_aktif=true` | ditolak `ck_employees_resign_nonaktif` |
| keduanya + `status_aktif=false` | diterima |

### 1.2 Jebakan #2 dibuktikan pada DATA LIVE, bukan pada fixture

Live memegang 67 karyawan, 60 di antaranya ber-posisi terpetakan. Sesudah
resign yang sah (lalu di-rollback):

```
employee_roster()      60 → 60     (orangnya TETAP ada)
employee_assignable()  55 → 54     (picker penugasan membuangnya)
```

Itu asimetri yang jadi seluruh alasan dua fungsi ini dipisah, dan angkanya
datang dari roster MEA yang sungguhan. Catatan yang berguna untuk sesi
berikutnya: **live sudah punya 5 karyawan non-aktif ber-posisi terpetakan**
(60 − 55) — artinya kalau `loadRoster` dibiarkan memakai `employee_assignable()`,
lima orang itu sudah hilang dari Kinerja Sales hari ini, bukan nanti.

## 2. UAT peramban — empat aktor

Harness: `scripts/dev-jwt.mjs` + `scripts/browser-tour.mjs`, DB lokal hasil
`scripts/db-rebuild.sh --yes`.

**Seed tidak punya aktor OD murni.** `employee_layered_roles` hanya berisi tiga
baris `director`; nol `od`. Satu aktor OD dibuat **hanya di DB lokal**
(`EMP-0010`: hapus `director`, sisipkan `od`) — nol perubahan pada
`supabase/seed.sql`, jadi ia hilang pada `db-rebuild` berikutnya dan harus
dibuat ulang. Kalau UAT peran OD akan sering diulang, seed-nya perlu satu baris
`od` sungguhan; itu keputusan tersendiri karena ia menggerakkan gate seed.

| aktor | klaim | menu ADMIN | halaman | tombol Resign | `POST .../resign` | `GET .../handover` |
|---|---|---|---|---|---|---|
| Lead HR (EMP-0011) | `level=lead division=HR` | tampil | 200, **11 dari 11** lintas divisi | tampil | 200 | 200 |
| OD (EMP-0010) | `od=true director=false` | tampil | 200, 11 baris | **tidak tampil** | **403** | **403** |
| Director (EMP-0008) | `director=true` | tampil | 200 | tampil | 200 | 200 |
| Lead divisi lain (EMP-0006) | `level=lead division=Sales` | **tidak tampil** | direktori menolak BI | — | **403** | **403** |

Pesan penolakan tulis: `[hanya Director atau Lead HR yang dapat mencabut akses karyawan]`.
Pesan penolakan baca di layar: `[anda tidak memiliki akses ke data ini]`.

Layarnya: `screenshots/uat-resign-01-lead-hr.png`,
`uat-resign-02-od-tanpa-tombol.png`, `uat-resign-03-lead-divisi-lain.png`.

### 2.1 Alur resign dijalankan sungguhan (sebagai Lead HR)

| langkah | hasil |
|---|---|
| alasan kosong | **400** `[alasan resign wajib diisi]` |
| resign #1 | **200**, `status_aktif=false`, `resigned_by=EMP-0011` |
| baris audit | `resign`, aktor `EMP-0011`, before `resigned_at: null` → after ber-`alasan` + `penugasan_tertinggal: 0` |
| resign #2 | **409** `[karyawan ini sudah dicabut aksesnya]` — DITOLAK, bukan di-idempoten-kan |
| tabel sesudahnya | baris berbadge `Resign`, kolom Aksi `—` |

### 2.2 Jebakan #1 diuji UJUNG-KE-UJUNG, bukan hanya lewat unit test

Seorang **Sales** (EMP-0001) di-resign, lalu `POST /admin/employee-import`
dijalankan dengan CSV yang masih menyebut dia `status_aktif=true`:

```
{"sync":{"synced":1,"deactivated":0,"reactivated":0,"flagged":0,"skippedResigned":1}}
status_aktif = false      resigned_at ada      resigned_by = EMP-0011
audit: hris_sync:skipped_resigned
sessions hidup: 0
```

Ban-nya **dipasang ulang**, tidak sekadar dibiarkan: cabang `resigned` di
`syncEmployees` memanggil `set_employee_banned(id, true)`. Jadi impor tidak cuma
gagal mengaktifkan — ia menegaskan pencabutannya.

### 2.3 Jebakan #2 diuji di layar

`GET /sales/performance` sebelum dan sesudah EMP-0001 di-resign: **2 baris → 2
baris**, dan baris EMP-0001 **identik field-per-field**. Kalau `loadRoster` masih
memakai `employee_assignable()`, baris itu hilang seluruhnya.

### 2.4 Batas password yang sengaja tidak dilebarkan — juga diuji

| percobaan | hasil |
|---|---|
| Lead HR setel password EMP-0006 (divisi Sales) | **403** `[anda tidak memiliki akses untuk mengatur password karyawan ini]` |
| Director setel password EMP-0006 | 200 |
| OD setel password | **403** |
| OD `POST /admin/employee-import` | **403** |

## 3. Tiga temuan PRE-EXISTING (bukan regresi PR #340)

Ketiganya ditemukan saat UAT dan **sengaja tidak diperbaiki di PR itu** —
memperbaikinya berarti melebarkan PR yang sudah siap merge. Ketiganya diverifikasi
ada juga di `63e8ca8` (sebelum PR-1) atau di kode yang PR-1 tidak sentuh.

### `OBS-OD-PANEL-TULIS` — halaman Karyawan menyodorkan panel TULIS ke pembaca read-only

OD **dan** Lead divisi lain sama-sama melihat panel **"Impor karyawan"** (dengan
tombol `Impor CSV`) dan **"Reset password"**. Server menolak keduanya dengan
benar (`403`), jadi ini **cacat tampilan, bukan lubang hak akses**.

Kenapa ia tetap layak diperbaiki: menawarkan tombol yang PASTI gagal kepada
peran yang invariannya "tidak pernah menulis" adalah cara mengajari orang bahwa
403 itu normal. Penyebabnya sempit dan jelas — `canMutate`
(`web-internal/src/app/(shell)/admin/employees/page.tsx`) hanya menjaga tabel
direktori dan tombol "+ Tambah Karyawan"; kedua panel di atasnya tidak pernah
dibungkus penjaga apa pun. Gating-nya **identik di `63e8ca8`**.

Perbaikan yang benar bukan satu `canMutate` untuk keduanya: **impor karyawan
Director-only** (routenya menuntut Director), sementara **reset password sah
untuk Lead atas divisinya sendiri** (`adminMayManage`) — jadi dua penjaga
berbeda, bukan satu.

### `OBS-IMPORT-PESAN-INGGRIS` — pesan penolakan berbahasa Inggris

`POST /admin/employee-import` menjawab `{"error":"forbidden: Director role required"}`.
Melanggar rumah aturan #5 (pesan validasi Bahasa Indonesia di dalam `[...]`).
Konsekuensi yang bukan kosmetik: pesan tanpa `[...]` tidak tertangkap oleh pola
yang dipakai layar untuk merender pita penolakan, jadi orangnya melihat teks
Inggris mentah.

### `OBS-PASSWORD-RESIGN` — password bisa diset untuk orang yang sudah resign

Director menyetel password sementara untuk karyawan ber-`resigned_at` ⇒ **200**.

**Bukan lubang keamanan**, dan itu sudah diperiksa sampai ke fungsinya:
`admin_set_employee_password` menyentuh `employee_credentials` dan
`auth.users.encrypted_password` saja — ia **tidak pernah menyentuh
`banned_until`** — jadi ban yang dipasang `resignEmployee` bertahan dan
`passwordGrant` tetap menolak orangnya. Yang salah adalah ia menulis baris audit
`password_set_admin` yang mengklaim sesuatu yang tidak berguna, dan menyodorkan
orang yang sudah keluar di dropdown "pilih karyawan". Perbaikan termurahnya:
`auth.setPassword` menolak target ber-`resigned_at` dengan pesan BI.

## 4. Yang masih menggantung (bukan kode) 🟠

**Nol baris `role_mappings` nyata yang menunjuk divisi `HR`.** Fixture punya
`EMP-0011` supaya gerbangnya teruji di kedua cabang, tapi di produksi nol orang
memegang peran ini — jadi mutasi & resign praktis **Director-only** sampai
Director membuat pemetaan riilnya lewat `/admin/role-mappings`.
`supabase/seed/role_mappings_riil.csv` sengaja tidak disentuh: isinya pemetaan
sungguhan, dan pasangan HRIS `divisi,jabatan` HR yang asli tidak diketahui dari
repo.

## 5. Cara mengulang UAT ini

```bash
pg_ctlcluster 16 main start
psql -c "ALTER USER postgres WITH PASSWORD 'postgres';"   # sebagai postgres
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" bash scripts/db-rebuild.sh --yes

# apps/api butuh .env.local ber-SUPABASE_JWT_SECRET yang SAMA dengan dev-jwt.mjs
(cd apps/api && npx next dev -p 3001) &
(cd web-internal && npx next dev -p 3000) &

# aktor OD harus dibuat manual — seed tidak punya
psql "$DATABASE_URL" -c "delete from employee_layered_roles where employee_id='EMP-0010' and role='director';
                         insert into employee_layered_roles (employee_id, role) values ('EMP-0010','od');"

for e in EMP-0011 EMP-0010 EMP-0008 EMP-0006; do
  SUPABASE_JWT_SECRET=<sama dgn .env.local> node scripts/dev-jwt.mjs --employee $e > tok-$e.txt
  node scripts/browser-tour.mjs --token "$(cat tok-$e.txt)" --pages pages.json --out tour-$e
done
```

Jebakan lingkungan yang sudah ditemukan, supaya tidak dicari lagi:

- **`npm ci` dibutuhkan di root DAN di `web-internal`** — yang kedua bukan anggota workspace.
- **Postgres ada tapi mati**, dan `pg_ctlcluster` bisa mengeluh "stale pid file"
  sesudah container idle — jalankan ulang, ia menghapusnya sendiri.
- **`/api/v1/sales/kinerja` TIDAK ADA.** Halaman `/sales/kinerja` dilayani
  `GET /api/v1/sales/performance`. Menebak dari URL halaman memberi 404 yang
  terlihat seperti bug.
- **`auth/login` tidak bisa diuji lokal** — ia lewat `passwordGrant` ke GoTrue,
  yang tidak ada di sandbox. Yang bisa diuji lokal adalah gerbang sebelum dan
  sesudahnya (`set-password`, ban, `sessions`).
- Body `POST /auth/admin/set-password` adalah `{employee_id, temp_password}` —
  bukan `password`.
