# Runbook — mengaktifkan fungsi HR di CDPS, 2026-09-11

> ## ✅ SUDAH DIEKSEKUSI 2026-09-11 — dan jalannya BUKAN (a)
>
> Ketokan pemilik berubah begitu fakta rosternya terlihat: *"divisi HR belum ada
> usernya saat ini, tim OD adalah bagian dari divisi HR, buat OD jadi HR semua
> dengan status staf."* Jadi yang dipakai bukan menunggu HRIS, melainkan
> memetakan divisi `OD` yang SUDAH ADA ke `HR`:
>
> | divisi (HRIS) | jabatan (HRIS) | division | level |
> |---|---|---|---|
> | `OD` | `SENIOR ORGANIZATION DEVELOPMENT` | `HR` | **`lead`** |
> | `OD` | `JR ORGANIZATION DEVELOPMENT` | `HR` | `staff` |
> | `OD` | `SENIOR DATA ANALYST` | `HR` | `staff` |
>
> Baris pertama dinaikkan ke `lead` pada ketokan susulan pemilik hari yang sama
> (*"naikkan user-nya Arsy"*) — lihat §4.2.
>
> Diverifikasi lewat `employee_claims()`: Arsy Rizmandha
> `division: HR, level: lead`, dua lainnya `HR · staff`, dan `od: true` +
> `director: true` UTUH pada ketiganya. Nol karyawan aktif tersisa tanpa peran.
>
> **🔴 Dua hal yang harus dibaca bersamaan dengan itu — lihat §4.**
>
> Sisa berkas ini (langkah HRIS, jebakan sync penuh, verifikasi) tetap berlaku
> untuk kapan pun MEA benar-benar membuka divisi HR sendiri di HRIS.

Ketokan pemilik 2026-09-11: **jalur (a)** — HRIS menambah divisi HR lalu
di-sync. Berkas ini menuliskan langkahnya persis, plus jebakan yang sudah
diperiksa ke kode dan ke live supaya tidak ditemukan saat eksekusi.

## 0 · Yang sebenarnya kurang

Bukan kodenya. **Lengan HR sudah ada dan sudah diuji**:

- `admin.HR_DIVISION = 'HR'` dan `canManageEmployeeAssignment` = Director
  **atau** Lead divisi `HR` — sengaja sempit, karena divisi+jabatan adalah sisi
  KIRI role mapping: membiarkan lead sembarang menulisnya = eskalasi hak.
- Tesnya sudah menjaga kedua arah, di gerbang maupun di DB:
  *"gates employee mutation to Director + HR-division Lead ONLY"* dan
  *"lets an HR-division Lead mutate, but denies a Sales Lead, OD and staff"*
  (`packages/domain/src/admin.test.ts`).

Yang kurang **satu baris data**: satu jabatan HRIS yang dipetakan ke
`(division 'HR', level 'lead')`. Diperiksa ke `CDPS SG` 2026-09-11: **nol**
jabatan HR di seluruh roster — 44 jabatan berbeda di 9 divisi (`ACCOUNT`,
`ADVERTISER`, `BUSINESS DEVELOPMENT`, `CREATIVE`, `Director`,
`FINANCE AND ACCOUNTING`, `MARKETING`, `OD`, `SALES`), nol yang mengandung
HR / HUMAN / PEOPLE.

Yang paling dekat justru divisi `OD` (`SENIOR ORGANIZATION DEVELOPMENT`,
`JR ORGANIZATION DEVELOPMENT`) — dan ketiganya **sengaja tidak ter-map**:
status OD datang dari `employee_layered_roles`, bukan dari `role_mappings`.
Memetakan mereka ke `HR · lead` adalah keputusan hak akses tersendiri (orang
itu jadi bisa mengubah divisi/jabatan SIAPA PUN), jadi **tidak diputuskan di
sini**.

## 1 · Langkah

### Langkah 1 — di HRIS (di luar CDPS, butuh manusia)

Tambahkan divisi + jabatan HR ke master HRIS sehingga ia ikut keluar di ekspor
karyawan. Contoh pasangan yang lazim: `divisi = HR`, `jabatan = HEAD OF HR`
(untuk lead) dan `HR STAFF` (untuk staf). **Nama persisnya bebas — tapi harus
SAMA PERSIS dengan yang diketik di Langkah 2**, karena pencocokannya string
literal `(divisi, jabatan)`.

CDPS tidak punya jalan masuk ke HRIS: satu-satunya implementasi
`EmployeeSource` hari ini adalah `CsvEmployeeSource`, jadi "sync" dalam praktik
= mengunggah ekspor CSV lewat `/admin/employee-import` (Director-only).

### Langkah 2 — `/admin/role-mappings` (Director)

Buat pemetaannya:

| divisi (HRIS) | jabatan (HRIS) | division (CDPS) | level |
|---|---|---|---|
| `HR` | `HEAD OF HR` | `HR` | `lead` |
| `HR` | `HR STAFF` | `HR` | `staff` *(opsional)* |

Baris `lead` yang membuka Mutasi & Resign. Baris `staff` murni kerapian —
ia tidak memberi hak apa pun di luar yang dimiliki staf divisi mana pun.

### Langkah 3 — `/admin/employee-import` (Director)

Unggah ekspor CSV HRIS yang sudah memuat orang HR-nya.

### Langkah 4 — verifikasi (jangan lewati)

```sql
-- klaim orangnya HARUS berbunyi division HR, level lead
select employee_claims('EMP-XXXX');
-- ⇒ {"od": false, "level": "lead", "director": false, "division": "HR", ...}
```

Lalu di layar: orang itu membuka `/admin/employees`, tombol **Mutasi** dan
**Resign** harus aktif. Kalau klaimnya benar tapi tombolnya mati, yang salah
tokennya — **suruh dia keluar lalu masuk lagi** (lihat §2.3).

## 2 · Jebakan yang sudah diperiksa

### 2.1 Urutan TIDAK menjebak — pemetaan boleh dibuat kapan saja

Ada `trg_sync_claims_mapping` pada `role_mappings` (selain
`trg_sync_claims_employee` pada `employees`), jadi membuat pemetaan
**menyegarkan klaim orang yang sudah ada** — tidak perlu impor ulang hanya
untuk itu. Ini diperiksa langsung ke `pg_trigger` di live, bukan diasumsikan.

### 2.2 🔴 Menambah orang HR secara MANUAL adalah jebakan, dan inilah alasan jalur (a) lebih baik

`/admin/employees` punya tombol tambah manual (`addEmployeeManually`,
Director/Lead-HR). Ia **menolak** jabatan yang belum dipetakan:

> `[divisi/jabatan tidak dikenali, pilih posisi yang sudah dipetakan di Role Mapping]`

Jadi Langkah 2 tetap harus lebih dulu. Tapi masalah sebenarnya di belakangnya:
**setiap CSV adalah sync PENUH** (`CsvEmployeeSource` tidak punya kursor
inkremental). Orang yang ditambahkan manual dan TIDAK ada di ekspor HRIS
berikutnya akan `flagged_for_review` lalu dinonaktifkan — aksesnya hilang
sendiri, tanpa ada yang merasa melakukannya.

**Karena itu: orang HR harus ada di HRIS, bukan hanya di CDPS.** Tambah manual
hanya sah sebagai jembatan beberapa hari sambil menunggu HRIS, dan kalau
dipakai, Langkah 1 tetap wajib menyusul.

### 2.3 Klaim tersegar ≠ token tersegar

`employee_claims()` dan `auth.users.raw_app_meta_data` ikut berubah seketika,
tapi JWT yang SUDAH dipegang orangnya membawa klaim lama sampai ia
refresh/login ulang. Gejalanya: kueri verifikasi §1.4 benar, layarnya masih
menolak. Bukan bug.

### 2.4 Yang TIDAK ikut terbuka

Lead HR mendapat Mutasi + Resign. Ia **tidak** mendapat Role Mapping (tetap
Director-only: `[hanya Director yang dapat mengelola role mapping]`) dan tidak
mendapat akses lintas-divisi ke data klien/uang. Adopsi Sistem pun tetap
divisinya sendiri (ketokan `PR4-SIAPA-BOLEH-LIHAT`, 2026-09-11).

## 3 · Yang saya butuhkan untuk menyelesaikan Langkah 2–4

Dua string: **divisi** dan **jabatan** HR persis seperti yang ditulis HRIS,
plus `employee_id` orangnya. Begitu ada, Langkah 2–4 saya kerjakan dan
verifikasi dalam hitungan menit.

Sampai itu ada, Mutasi & Resign permanen tetap **Director-only** — dan itu
keadaan yang aman, bukan kerusakan.


---

## 4 · 🔴 Dua hal yang eksekusi 2026-09-11 justru menyingkap

### 4.1 Pemetaan ini mengubah NOL hak akses — mereka sudah Director

Ketiga orang OD itu sudah memegang layered role **`director`** sejak
2026-07-30, `created_by = 'C03-OWNER-DECISION'` — keputusan pemilik yang
tercatat, bukan kecelakaan. Klaim mereka sebelum pemetaan:

```
{"od": true, "level": "", "director": true, "division": ""}
```

Karena `canManageEmployeeAssignment` meloloskan Director tanpa syarat, **mereka
sudah bisa Mutasi & Resign sejak dulu**. Artinya "gerbang HR kosong" yang
tercatat sebagai utang di beberapa handoff **tidak pernah benar-benar memblokir
siapa pun** — ia hanya membuat jalur HR-nya tidak terpakai.

Yang berubah oleh pemetaan ini murni **identitas organisasi**: layar yang dulu
menulis peran mereka `—` sekarang menulis `HR · staff`, dan divisi HR akhirnya
punya anggota.

### 4.2 HR `lead` SUDAH ADA — Arsy, dan itu memutus ketergantungan pada Director

Pada pemetaan pertama ketiganya `staff`, dan itu menyisakan satu ketergantungan
diam: `canManageEmployeeAssignment` menuntut **`lead`**, jadi hak Mutasi &
Resign mereka bertumpu SEPENUHNYA pada layered `director` mereka. Kalau layered
itu suatu hari dicabut saat merapikan siapa yang benar-benar Director, orang itu
langsung kehilangan kedua tombol — tanpa galat apa pun, tombolnya hanya mati.

Pemilik menutupnya di hari yang sama: **`OD`/`SENIOR ORGANIZATION DEVELOPMENT`
dinaikkan ke `HR · lead`**, dan pemegangnya satu-satunya adalah **ARSY
RIZMANDHA** (`2501140493`) — diperiksa sebelum menulis, bukan diasumsikan.

Klaimnya sekarang:

```
{"od": true, "level": "lead", "director": true, "division": "HR"}
```

Hak HR-nya kini berdiri di kakinya sendiri: kalau layered `director` dicabut,
Mutasi & Resign TETAP terbuka untuknya lewat lengan HR. Dua orang OD lainnya
tetap `staff` — bagi mereka ketergantungan itu masih berlaku, dan itu memang
konsekuensi yang diinginkan: hanya SATU pemegang fungsi HR.

### ⚠️ 4.3 Pemetaan berkunci JABATAN, bukan orang

`role_mappings` dikunci `(divisi, jabatan)`. Jadi yang dinaikkan sebenarnya
**jabatannya**, bukan Arsy sebagai pribadi: siapa pun yang kelak masuk ke
`OD`/`SENIOR ORGANIZATION DEVELOPMENT` otomatis menjadi `HR · lead` dan bisa
mengubah divisi/jabatan SIAPA PUN — tanpa ada yang perlu menyetujui apa pun.

Itu memang cara kerja modelnya (dan alasan `canManageEmployeeAssignment` ditulis
sesempit itu), bukan cacat. Tapi ia berarti satu hal praktis: **perlakukan
jabatan itu sebagai jabatan berwenang.** Kalau kelak ada orang kedua di jabatan
yang sama dan tidak seharusnya memegang HR, pisahkan jabatannya di HRIS —
jangan andalkan bahwa hari ini pemegangnya cuma satu.
