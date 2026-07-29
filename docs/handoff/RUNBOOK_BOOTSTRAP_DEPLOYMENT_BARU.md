# RUNBOOK — Bootstrap deployment CDPS baru (dari DB kosong sampai Director bisa login)

> **Kapan runbook ini dipakai:** hanya saat menyiapkan deployment CDPS **baru** —
> environment staging kedua, DB pengganti, atau disaster recovery. Untuk proyek live
> `CDPS SG` yang sudah jalan, semua langkah di sini SUDAH selesai; jangan dijalankan
> ulang tanpa alasan (langkah 3 & 4 idempoten, langkah 2 **menimpa password**).
>
> **Kenapa ada:** deployment baru punya masalah ayam-dan-telur. Impor karyawan,
> role mapping, dan reset password semuanya menuntut pemanggil ber-role **Director**
> — tapi role Director sendiri berasal dari data yang belum ada, dan otentikasi HRIS
> sudah dicabut (`DECISIONS.md` 2026-07-19), jadi tidak ada satu pun kredensial yang
> bisa dipakai login. Tanpa langkah 2, **deployment baru terkunci total**.
>
> Runbook ini menggantikan `backend/cmd/setpass` (Go), yang pensiun bersama
> `backend/` — lihat `DECISIONS.md` 2026-07-29 "Fase 3".

## Prasyarat

| | |
|---|---|
| Migrasi | Semua migrasi `supabase/migrations/**` sudah di-apply (`supabase db push`, **jangan** `psql -f` — itu yang melahirkan drift O38) |
| Akses | Supabase **SQL Editor** proyek tujuan (langkah 1 & 2 butuh privilese service-role) |
| `DATABASE_URL` | Pooler URL proyek tujuan, untuk langkah 3 & 4 |
| Roster karyawan | CSV `employee_id,nama,email,divisi,jabatan,status_aktif[,password]` |

**Urutannya wajib 1 → 2 → 3 → 4.** Setiap langkah memakai hasil langkah sebelumnya:
role mapping tidak bisa memberi role ke karyawan yang belum ada, dan layered role
tidak bisa menunjuk NIK yang belum ada (skrip langkah 4 memblokir ini secara eksplisit).

---

## Langkah 1 — Landing karyawan pertama (Director) langsung ke DB

Impor massal karyawan lewat `POST /admin/employee-import` butuh Director, jadi
karyawan **pertama** harus masuk lewat SQL. Satu baris saja — sisanya lewat langkah 3.

Di SQL Editor, ganti nilainya dengan data Director sebenarnya:

```sql
insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
values ('<NIK_DIRECTOR>', '<NAMA LENGKAP>', '<email@meagency.co.id>',
        '<DIVISI HRIS>', '<JABATAN HRIS>', true, 'BOOTSTRAP')
on conflict (employee_id) do nothing;

-- Layered role Director. `employee_claims()` membaca tabel INILAH untuk
-- menentukan director/od, bukan divisi/jabatan.
insert into employee_layered_roles (employee_id, role, enabled, created_by)
values ('<NIK_DIRECTOR>', 'director', true, 'BOOTSTRAP')
on conflict (employee_id, role) do update set enabled = true;
```

Verifikasi klaimnya sudah benar **sebelum** lanjut — kalau `director` masih `false`,
langkah 3 & 4 akan ditolak dengan pesan BI dan Anda akan mengira skripnya rusak:

```sql
select employee_claims('<NIK_DIRECTOR>');
-- harapkan director: true
```

## Langkah 2 — Setel password sementara Director (inilah pengganti `setpass`)

`admin_set_employee_password(p_employee_id, p_bcrypt_hash, p_actor)` menerima hash
**bcrypt yang sudah jadi** — hash-nya di-generate di aplikasi, bukan di DB (supaya
DB tidak butuh ekstensi crypto dan biaya bcrypt tidak membebani pooler). Jadi
generate dulu, lalu tempel.

Generate hash (cost **10**, sama dengan importer — jangan ubah):

```bash
node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" '<PASSWORD_SEMENTARA>'
```

> `bcryptjs` tersedia setelah `npm ci` di repo. Password minimal 8 karakter.
> **Jangan** menaruh password di riwayat shell bersama pada mesin bersama.

Lalu di SQL Editor:

```sql
select public.admin_set_employee_password('<NIK_DIRECTOR>', '<HASH_BCRYPT>', 'BOOTSTRAP');
-- true  = karyawan ditemukan & password diset
-- false = employee_id tidak ada (langkah 1 belum jalan / NIK salah ketik)
```

Fungsi ini melakukan empat hal sekaligus: upsert `employee_credentials`, menyalakan
`employees.must_change_password`, menulis hash ke `auth.users.encrypted_password`
(otoritas login sebenarnya), dan **menghapus refresh token GoTrue** supaya sesi lama
mati. Karena itu ia juga jalur yang benar untuk memulihkan Director yang terkunci.

Sekarang login di `web-internal` dengan email + password sementara itu. Aplikasi akan
memaksa ganti password pada login pertama (`must_change_password`).

> ⚠️ Password sementara ini setara akses penuh ke seluruh CDPS sampai diganti.
> Sampaikan lewat kanal yang tidak persisten, dan pastikan login pertama segera terjadi.

## Langkah 3 — Impor sisa roster karyawan

Sebagai Director yang sudah login, buka **`/admin/employees`** → panel impor, tempel
CSV. Endpoint-nya `POST /api/v1/admin/employee-import`.

Parser-nya menolak berkas **secara utuh** bila ada `employee_id`/`nama`/`divisi`/
`jabatan` kosong atau `employee_id` duplikat, dan menyebut **setiap** baris yang
bermasalah sekaligus. Itu disengaja: `syncEmployees` meng-upsert berdasarkan
`employee_id`, jadi NIK duplikat berarti "baris terakhir menang" — satu karyawan
diam-diam menimpa divisi karyawan lain. Perbaiki CSV-nya, jangan diakali.

`email` kosong **diizinkan**: karyawan itu hanya belum bisa login (CDPS login pakai
email). Itu kondisi nyata dan biasa, bukan alasan menolak seluruh roster.

> Kalau roster mentah dari HR masih berformat `No | NIK | JOIN DATE | NAMA LENGKAP |
> DEPARTMENT | JABATAN`, reshape dulu ke format kanonik di atas. Tooling Go
> `cmd/hrisconvert` **tidak diport** (DECISIONS 2026-07-29 "Fase 3") — gate kualitas
> datanya sudah pindah ke parser CSV produksi, jadi reshape manual aman: kalau salah,
> langkah ini menolaknya, bukan menerimanya diam-diam.

Verifikasi:

```sql
select count(*) from employees where status_aktif;
```

## Langkah 4 — Seed role mapping HRIS→CDPS + layered role

Role mapping menerjemahkan `divisi/jabatan` HRIS menjadi `division/level` CDPS. Tanpa
ini setiap karyawan tidak ter-map: mereka bisa login tapi tidak melihat apa pun.

Data kanoniknya ada di repo (`supabase/seed/`, 23 mapping riil — provenance di
`supabase/seed/README.md`). **Dry-run dulu**, selalu:

```bash
DATABASE_URL='postgres://...' npm run rolemap:seed -w @cdps/api -- --actor <NIK_DIRECTOR>
DATABASE_URL='postgres://...' npm run rolemap:seed -w @cdps/api -- --actor <NIK_DIRECTOR> --apply
```

Skripnya menulis HANYA lewat `admin.upsertRoleMapping` / `admin.setLayeredRole` —
jalur yang sama dengan UI admin, jadi setiap baris tervalidasi, ter-gate, dan
ter-audit. Idempoten: menjalankan ulang menegaskan state yang sama.

Kalau ada layered role menunjuk NIK yang tidak ada di `employees`, **seluruh run
dibatalkan sebelum satu baris pun ditulis** — biasanya berarti langkah 3 terlewat.
Itu bukan kerewelan: layered role adalah pemberian hak paling kuat di CDPS, dan
tabel permission setengah terisi adalah satu-satunya state yang tidak bisa
dipertanggungjawabkan siapa pun setelahnya.

Verifikasi klaim satu karyawan biasa benar-benar terisi:

```sql
select employee_claims('<NIK_KARYAWAN_BIASA>');
-- harapkan division & level terisi, director/od false
```

## Langkah 5 — Seed Master Service List

Tidak ada Closing yang bisa terjadi selagi `master_services` masih 0 baris (C-04).

```bash
DATABASE_URL='postgres://...' npm run msl:seed -w @cdps/api -- --actor <NIK_SALES_HEAD>
DATABASE_URL='postgres://...' npm run msl:seed -w @cdps/api -- --actor <NIK_SALES_HEAD> --apply
```

`--actor` di sini harus lolos `msl.canEditMasterServices` (Sales Head/SPV Sales atau
Director) — bukan sembarang Director-only seperti langkah 4.

---

## Checklist selesai

- [ ] `employee_claims('<NIK_DIRECTOR>')` → `director: true`
- [ ] Director berhasil login dan sudah **mengganti** password sementaranya
- [ ] `select count(*) from employees where status_aktif` = jumlah roster yang diharapkan
- [ ] `select count(*) from role_mappings` ≥ 23
- [ ] `employee_claims()` satu karyawan biasa → `division`/`level` terisi
- [ ] `select count(*) from master_services` > 0
- [ ] Keempat invariant SQL lolos (`scripts/` — `ident`, `immutability`, `rls`, `auth_claims`)

## Yang TIDAK ditangani runbook ini

Impor **data historis** (lead lama, klien pra-CDPS, ledger dormant) — itu O22, masih
menunggu keputusan pemilik; lihat `DECISIONS.md` 2026-07-29 "Fase 3" dan
`docs/handoff/W1-19_SOURCE_MAPPING.md`. Deployment baru berfungsi penuh tanpa itu;
ia hanya tidak punya riwayat.
