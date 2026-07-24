# CDPS — Go-Live Runbook (Supabase provisioning + auth)

> Langkah-langkah untuk menghidupkan CDPS di project Supabase. **Semua langkah
> di bawah dijalankan dari sisi Anda** (browser / mesin dengan akses ke project
> Supabase), bukan dari sesi Claude Code: environment Claude Code diblokir egress
> policy untuk semua host `supabase.com` / `supabase.co` (403 CONNECT), jadi tidak
> bisa menyentuh project Anda. Peran Claude Code = menyiapkan & memvalidasi
> semua SQL secara lokal (di Postgres bermigrasi), yang sudah dilakukan.

## Kredensial yang dibutuhkan (dan yang TIDAK)

Kode membaca **3 env var** — **tidak ada `SERVICE_ROLE_KEY`, dan `SUPABASE_JWT_SECRET`
tidak lagi wajib** (lihat catatan JWT di bawah):

| Env | Sumber di Supabase | Dipakai oleh |
|-----|--------------------|--------------|
| `DATABASE_URL` | Settings → Database → **Connection string** (Transaction pooler, port 6543) | apps/api (akses DB langsung) |
| `NEXT_PUBLIC_SUPABASE_URL` | Settings → API → Project URL | apps/api (BFF login + JWKS), web-internal |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings → API → `anon` public key | apps/api (BFF login) |
| `SUPABASE_JWT_SECRET` *(opsional)* | Settings → API → JWT Keys → **Legacy JWT Secret** | apps/api — HANYA jika project masih memakai signing key HS256 lama |

### Catatan JWT — signing key asymmetric (ES256)
Project baru (CDPS SG dibuat 2026-07-22) menandatangani access token dengan
**asymmetric signing key (ES256)** — `kid`-nya berupa UUID (mis. `57812f50-…`),
bukan legacy shared secret. `apps/api` memverifikasi token via **JWKS**
(`${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/.well-known/jwks.json`, `lib/jwks.ts`), jadi
**tidak butuh `SUPABASE_JWT_SECRET`**. Kode tetap menerima HS256 (backward-compat):
jika suatu saat project di-roll ke Legacy HS256, set `SUPABASE_JWT_SECRET` dan token
HS256 pun tervalidasi tanpa perubahan kode. ⚠️ Deploy `apps/api` **harus punya egress
ke `*.supabase.co`** agar bisa mengambil JWKS.

- "service-role" di kode = **Postgres role** koneksi `DATABASE_URL` (untuk tulis via
  RPC SECURITY DEFINER), **bukan** service_role API key.
- Menjalankan migrasi + provisioning + `import_employee_credentials()` cukup lewat
  **SQL editor** Supabase (jalan sebagai `postgres`). service_role key tidak perlu;
  jangan menempelkannya ke mana pun (bypass RLS penuh atas PII karyawan).

---

## Langkah 1 — Terapkan migrasi ke project

**Preferensi: Supabase CLI** (menjaga migration history):
```bash
supabase link --project-ref <ref>
supabase db push
```

**Alternatif (tanpa CLI): paste-once.** Hasilkan bundle lalu tempel di SQL editor:
```bash
scripts/build_bootstrap_sql.sh            # -> ./cdps_bootstrap.sql (semua migrasi berurutan)
```
Tempel `cdps_bootstrap.sql` ke SQL editor, Run.

**Verifikasi (SQL editor):**
```sql
select
  (select count(*) from sm_machines)  as machines,   -- harus 14
  (select count(*) from notif_events) as events,      -- harus 15
  (select count(*) from information_schema.tables
     where table_schema='public' and table_type='BASE TABLE') as tables,  -- harus 53
  (select count(*) from pg_proc where proname='custom_access_token_hook') as hook_fn; -- harus 1
```

---

## Langkah 2 — Aktifkan Custom Access Token hook

GoTrue harus memanggil `public.custom_access_token_hook` agar JWT berisi klaim CDPS
(`employee_id`, `division`, `level`, `od`, `director`). Tanpa ini, user bisa login
tapi `requireActor` tak mendapat peran.

Dashboard → **Authentication → Hooks** → tipe **"Customize Access Token (JWT)
Claims"** → **Postgres** → schema `public`, function `custom_access_token_hook` →
Enable. (Migrasi sudah `GRANT EXECUTE … TO supabase_auth_admin` — tak perlu grant
tambahan.) Jika fungsi tak muncul di picker, migrasi (Langkah 1) belum jalan.

---

## Langkah 3 — Provisioning akun karyawan

Jalankan `provision_employees.sql` (dihasilkan dari Data Karyawan V2, 58 akun) di
SQL editor. Isinya (idempoten / upsert):
`employees` → `role_mappings` → `employee_layered_roles` (OD/Director) →
`employee_credentials` → lalu **baris terakhir** `SELECT public.import_employee_credentials();`
yang membuat `auth.users` + identity + link + app_metadata.

**Verifikasi:**
```sql
-- klaim contoh (harus: KOL staff / OD od=true / Director director=true)
select employee_id, public.employee_claims(employee_id)
from employees where employee_id in ('2602190630','2501140493','200000001');
-- akun GoTrue terbentuk & ter-link (harus 58 setelah import)
select count(*) from employees where auth_user_id is not null;
```

Regenerasi `provision_employees.sql` (bila data karyawan berubah): dari sumber CSV,
via skrip generator sesi ini (`scratchpad/generate_sql.mjs`) atau minta Claude Code.

### Catatan provisioning
- **Password awal seragam** `MeaCdps2026!`, `must_change_password=true` (wajib ganti
  saat login pertama).
- **7 karyawan di-skip** (di luar 6 divisi CDPS): HRGA ×1, Business Development ×5,
  Data & BI ×1. Tambah nanti bila modul terkait siap.
- **`employee_id` = NIK** HRIS. `divisi`/`jabatan` disimpan mentah; peran diturunkan
  dari `role_mappings`.
- Jabatan lintas-departemen: ACCOUNT + *KOL Specialist/Intern KOL* → **KOL**;
  ACCOUNT + *Advertiser* → **Ads**.
- ⚠️ Versi GoTrue (`DECISIONS.md` O36): kolom `auth.users`/`auth.identities` bisa
  beda antar versi. Jika `import_employee_credentials()` error soal kolom, kirim
  pesannya untuk disesuaikan.

---

## Langkah 4 — Set environment variables

Set 4 var pada Langkah "Kredensial" di deploy **apps/api** dan **web-internal**.

## Langkah 5 — Smoke-login per peran

Login minimal: Sales staff, Sales lead (Head of Sales Jasa), Account lead (Head of
Account), KOL, Finance, OD, Director. Pastikan tiap peran melihat scope yang benar
(Staff = data sendiri; Lead = se-divisi; OD = read-only semua; Director = penuh).

> ⚠️ O37 (baca `docs/O37_RLS_DECISION_BRIEF.md`): read route saat ini via service-role
> (RLS ter-bypass) → over-permissive. UAT internal terkendali boleh; jangan buka ke
> full multi-role / portal eksternal sebelum O37 diputus.

---

## Status validasi (dari Claude Code, lokal)

Dijalankan pada Postgres 16 bermigrasi:
- 31 migrasi apply bersih (fresh DB), sebagai bundle maupun berurutan — 14 machines,
  15 events, 53 tables.
- `provision_employees.sql` apply bersih di atas bundle fresh: 58 employees, 38
  role_mappings, 5 layered, 58 credentials.
- `employee_claims()` menghasilkan app_metadata peran yang benar untuk tiap tipe.
- Gate SQL invariant (ident / immutability / rls / auth_claims) + suite `@cdps/db`
  (9) & `@cdps/domain` (182) hijau.

`import_employee_credentials()` TIDAK dapat diuji lokal (butuh schema `auth` GoTrue);
diverifikasi di project Supabase nyata pada Langkah 3.
