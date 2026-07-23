# HANDOFF — Fase 1 SESI 4 (2026-07-23) · RLS baseline + Supabase Auth

> Lanjutan dari `HANDOFF_SUPABASE_FASE0_SESI3.md` (Fase 0 tuntas).
> Baca bersama `docs/SUPABASE_MIGRATION_TECH_APPENDIX.md` §C (auth) + §D (RLS),
> `PERMISSIONS.md`, `docs/DECISIONS.md` (2 entri 2026-07-23).
> Branch: `claude/fase-1-rls-auth-tog477` · PR **#32** (draft, → `main`).
> Project Supabase target: **CDPS SG** = `egddxfcnrtecheiykhlf` (region ap-southeast-1).

---

## ⭐ MULAI DI SINI (sesi berikutnya)

**Status Fase 1:** langkah 1 (RLS), langkah 2 (Auth), **langkah 3 (importer CSV, OQ-4)**
dan **langkah 4 (`apps/api` route handlers)** **SELESAI di sisi kode**. RLS & Auth sudah
di-apply ke remote CDPS SG. Yang tersisa sebelum Fase 1 bisa ditandai "selesai" =
**3 gate manusia** (di bawah, §5). Detail langkah 3–4 di **§8** (bawah).

**Verifikasi cepat (lokal, butuh Postgres 17/16 + `DATABASE_URL`):**
```
cd packages/core && npm ci && npm test && npm run typecheck   # 106 pass
cd packages/db   && npm ci && npm test                        # 4 unit (+5 integration bila DATABASE_URL diset)
cd packages/domain && npm ci && npm run typecheck && npm test # 8 unit (+22 integration bila DATABASE_URL diset) = 30
cd apps/api      && npm ci && npm run typecheck && npm test    # 29 (JWT verify + error-map; tanpa DB/Next-build)
# DB end-to-end (apply semua migrasi ke PG kosong lalu jalankan invariant checks):
#   for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -f "$f"; done
#   psql -f supabase/seed.sql   (×2 utk idempotensi)
#   psql -v ON_ERROR_STOP=1 -f supabase/tests/ident_checks.sql
#   psql -v ON_ERROR_STOP=1 -f supabase/tests/immutability_checks.sql
#   psql -v ON_ERROR_STOP=1 -f supabase/tests/rls_checks.sql
#   psql -v ON_ERROR_STOP=1 -f supabase/tests/auth_claims_checks.sql
```
(CI `.github/workflows/ci.yml`: job `db-and-migrations` menjalankan semua ini +
table-count 53 + `packages/db` + **`packages/domain`**; job baru **`api`** typecheck+lib-test.)

**Lanjut kode (berikutnya):** modul domain riil mengikuti build order (M0/M1 money path) —
pola sudah dicontohkan `packages/domain/src/demo.ts` (vertikal referensi 4 executor) +
handler tipis `apps/api`. Importer karyawan siap dipakai gate manusia #2 (§5).

---

## 1. Yang dikerjakan SESI INI (per file)

### Migrasi baru
- **`supabase/migrations/20260102000003_rls_baseline.sql`** — RLS baseline.
  - Helper `jwt_employee_id/division/is_lead/is_od/is_director/can_read_all` (baca
    `auth.jwt()->'app_metadata'`); helper parent-owner `jwt_owns_client/transaction/lead`
    (SECURITY DEFINER).
  - `ENABLE ROW LEVEL SECURITY` di **53 tabel**; **44 policy SELECT** (`TO authenticated`)
    mirror `permission.ts`. Pola: `canReadAll OR owner(created_by/PIC) OR (lead ∧ divisi) OR parent-owner`.
  - 9 tabel internal (`sessions`, `id_sequences`, `employee_credentials`, `role_mappings`,
    `employee_layered_roles`, `sm_machines`, `sm_edges`, `sm_terminal_states`, `notif_events`)
    = RLS default-deny (tanpa policy) + `REVOKE ALL` dari anon/authenticated.
  - `anon` dicabut TOTAL; `authenticated` hanya `SELECT`. `REVOKE UPDATE,DELETE` di
    `audit_log`/`notifications`/`client_health_snapshots`/`performance_snapshots`.
  - House-engine `ident_next`/`sm_transition`/`notify_emit` → `SECURITY DEFINER` +
    `SET search_path`; **EXECUTE dicabut dari anon/authenticated** (hanya `service_role`).
  - Retrofit `SET search_path` ke 4 fungsi fondasi lama (`set_updated_at`/`forbid_mutation`/
    `wib_date`/`wib_period`).
  - **Shim portabilitas** (§0): buat role `anon/authenticated/service_role` + `auth.jwt()`
    bila absen → migrasi valid & teruji di plain PG (CI); no-op di Supabase.
- **`supabase/migrations/20260102000004_supabase_auth.sql`** — integrasi Supabase Auth.
  - Kolom `employees.auth_user_id uuid` (FK→`auth.users`, guarded) + `must_change_password`.
  - `employee_claims(employee_id)→jsonb` — resolver `app_metadata` **mirror
    `backend/internal/auth/actor.go` ResolveActor** (division/level dari `role_mappings`;
    od/director dari `employee_layered_roles`; absennya mapping = string kosong).
  - `custom_access_token_hook(event jsonb)→jsonb` — **Access Token Hook GoTrue**; suntik
    klaim ke `claims.app_metadata`. EXECUTE hanya `supabase_auth_admin`.
  - `sync_employee_claims(employee_id)` + 3 trigger (`employees` UPDATE status/divisi/jabatan,
    `employee_layered_roles`, `role_mappings`).
  - `import_employee_credentials()` — bcrypt hash existing → `auth.users` + `auth.identities`
    (provider `email`), idempoten, service-role only (**OQ-3 import langsung**).
  - `set_employee_banned(employee_id, banned)` — deaktivasi ⇒ ban GoTrue.
  - **Portabilitas:** semua akses `auth.*` via SQL dinamis (`EXECUTE`) + guard
    `to_regclass('auth.users')` → no-op runtime di plain PG.

### Test invariant baru (gate CI, `supabase/tests/`)
- **`rls_checks.sql`** — `SET ROLE authenticated` + injeksi klaim JWT; buktikan matriks
  visibilitas owner/divisi/OD/Director + default-deny + internal-lock.
- **`auth_claims_checks.sql`** — paritas `employee_claims`/hook vs ResolveActor
  (staff/lead/Finance/pure-Director + preservasi `provider` + unknown→no-inject).
- `supabase/tests/README.md` diperbarui (tabel + cara jalan lokal).

### CI (`.github/workflows/ci.yml`)
- Job `db-and-migrations` kini menjalankan: apply semua migrasi → verify seed counts →
  seed ×2 idempoten → **table-count 53** → `ident`/`immutability`/`rls`/`auth_claims`
  checks → `packages/db` test.
- **`.github/workflows/ci-supabase.yml` DIHAPUS** (duplikat & stale — asersi "49 tabel"
  pecah setelah statemachine menambah 4 tabel → 53).

### Dokumentasi
- `docs/DECISIONS.md` — 2 entri 2026-07-23 (RLS baseline langkah 1; Supabase Auth langkah 2)
  dengan seluruh keputusan teknis konkret + residual advisor yang diterima.
- `docs/handoff/HANDOFF_SUPABASE_FASE0_SESI3.md` — blok "MULAI DI SINI" diperbarui.
- Dokumen INI (`HANDOFF_FASE1_SESI4.md`).

---

## 2. Keadaan remote CDPS SG (`egddxfcnrtecheiykhlf`) SEKARANG

- Migrasi ter-apply: 28 (Fase 0) + `statemachine` + **`rls_baseline`** +
  **`rls_harden_execute_surface`** (delta §9 RLS) + **`supabase_auth`** + revoke trigger-func.
  (Catatan: nomor versi remote di `supabase_migrations.schema_migrations` beda dgn nama file
  repo — pola sama seperti statemachine; **file repo = sumber kebenaran untuk apply fresh/CI**.)
- **Advisor security** (via `get_advisors`): **CRITICAL `rls_disabled` HILANG**. Sisa:
  - `rls_enabled_no_policy` (INFO ×9) — 9 tabel internal default-deny (DISENGAJA).
  - `authenticated_security_definer_function_executable` (WARN ×3) — `jwt_owns_client/
    transaction/lead`; **benign** (hanya balikan boolean kepemilikan milik pemanggil sendiri).
    Follow-up opsional: pindah ke schema privat tak ter-expose PostgREST.
- **Data:** remote **BELUM di-seed** (0 karyawan). Seed dev opsional (via `supabase db reset`
  atau apply `supabase/seed.sql`) — keputusan pemilik.
- **Hook GoTrue BELUM diaktifkan** (lihat §5 gate #1).

---

## 3. Verifikasi yang sudah dilakukan (bukti)

- Fresh apply semua migrasi ke Postgres kosong + seed ×2 idempoten → 53 tabel;
  `ident_checks` / `immutability_checks` / `rls_checks` / `auth_claims_checks` **PASS**.
- RLS fungsional (SET ROLE authenticated + klaim): owner-only, lead-divisi, OD/Director
  read-all, empty-claims default-deny, internal `sessions` permission-denied — semua sesuai.
- Bypass ditutup: `authenticated` TIDAK bisa `select ident_next(...)` (permission denied);
  koneksi owner/executor tetap bisa.
- `packages/db` 9 test (4 unit + 5 integration) hijau terhadap DB termigrasi (RLS aktif,
  engine-func SECURITY DEFINER) — tak ada regresi.
- **End-to-end Auth di remote** (transaksi di-rollback, nol residu): insert karyawan+credential
  dummy → `import_employee_credentials()` → terbukti membuat baris `auth.users` (email,
  encrypted_password, aud) + `auth.identities` (provider email) yang **cocok versi GoTrue
  project**; `custom_access_token_hook` menyuntik `app_metadata` klaim benar (division=Sales,
  level=staff, dst) + mempertahankan `provider`.

---

## 4. Cara kerja Auth (untuk yang melanjutkan)

1. **Provisioning**: `import_employee_credentials()` (service-role) buat `auth.users` +
   `auth.identities` per baris `employee_credentials` (karyawan aktif, belum ter-link), set
   `employees.auth_user_id`, salin `must_change_password`, tulis `app_metadata` awal.
2. **Login** (GoTrue) → saat menerbitkan JWT, GoTrue memanggil **`custom_access_token_hook`**
   (harus diaktifkan, §5) yang me-resolve `employee_claims(employee_id)` FRESH dari tabel dan
   menyuntik ke `claims.app_metadata`.
3. **RLS** (`auth.jwt()->'app_metadata'`) memfilter baris per predikat `permission.ts`.
4. **Perubahan role** (`role_mappings`/`employee_layered_roles`/`status`) → trigger
   `sync_employee_claims` update `raw_app_meta_data`; hook tetap resolve fresh di token berikут.
5. **Deaktivasi** → `set_employee_banned(id, true)` (atau admin API GoTrue ban) → tak bisa login.
6. **`must_change_password`** = kolom `employees`; di-cek middleware/route handler pasca-login
   (gate blocking), BUKAN di klaim otorisasi.

---

## 5. ⚠ GATE MANUSIA — wajib sebelum Fase 1 ditandai "selesai" (DECISIONS O36)

Ketiganya **tidak bisa dieksekusi agent** (butuh Dashboard/staging/data riil):

1. **Aktifkan Access Token Hook.** Dashboard project CDPS SG → `Authentication > Hooks (Beta)`
   → pilih fungsi Postgres `custom_access_token_hook`. (Atau `config.toml`
   `[auth.hook.custom_access_token] enabled = true; uri = "pg-functions://postgres/public/custom_access_token_hook"`.)
   **KRITIS:** tanpa ini JWT tak berisi `app_metadata` → SEMUA policy RLS default-deny →
   aplikasi seolah "tak bisa baca apa-apa". Aktifkan PERTAMA.
2. **Import kredensial riil.** Muat data karyawan (CSV, OQ-4) ke `public.employees` +
   `public.employee_credentials`, lalu `select public.import_employee_credentials();`
   (service-role). Verifikasi versi GoTrue project sebelum import massal.
3. **Smoke-test login semua role di staging** (staff/lead/OD/Director): login → decode JWT →
   pastikan `app_metadata` benar → cek baris yang terlihat sesuai RLS.

---

## 6. Langkah berikutnya (kode, urut)

3. **Importer CSV karyawan** (OQ-4) — replay via jalur domain (bukan raw INSERT), di belakang
   interface `EmployeeSource` (port pola Go `HrisApiSource`/`CsvImportSource`). Menghasilkan
   baris `employees`+`employee_credentials`, lalu panggil `import_employee_credentials()`.
4. **`apps/api` route handlers** — pakai `@cdps/db` `withTransaction` + `executors(tx)` agar
   ident/sm_transition/notify/audit satu transaksi; validasi field wajib + pesan BI `[...]` di
   handler SEBELUM panggil fungsi SQL. Koneksi tulis pakai service-role/privileged (RLS =
   jaring pengaman baca; tulis lewat RPC SECURITY DEFINER).
5. **(Opsional)** pindahkan `jwt_owns_*` ke schema privat (hapus 3 WARN sisa); Vercel project
   untuk `apps/api`; seed remote dev.

---

## 7. Peringatan penting (tetap berlaku)

- **Predikat izin ada 3 implementasi kini** — `permission.ts` (TS/UX), policy RLS (SQL),
  `employee_claims`/hook (SQL, sumber klaim). Ketiganya turun dari `PERMISSIONS.md`/`actor.go`
  yang SAMA — **tak boleh divergen**. Dijaga `rls_checks.sql` + `auth_claims_checks.sql`.
- Offset WIB satu sumber (`WIB_OFFSET_HOURS=7` == `+ interval '7 hours'`).
- Katalog notifikasi FROZEN 15 event; string BI `[...]` persis; transisi HANYA lewat
  `sm_transition`; audit append-only.
- Migrasi baru yang menyentuh `auth.*` WAJIB pakai SQL dinamis + guard `to_regclass` supaya CI
  plain-PG tetap hijau.
- Setiap deviasi → entri `docs/DECISIONS.md`.
- **Update 2026-07-23 (sesi 4):** predikat izin implementasi ke-3 kini dites eksplisit —
  `actorFromClaims` di `@cdps/core` (unit test) menutup jalur JWT→Actor di request path.

---

## 8. Langkah 3 & 4 — SELESAI (sesi Fase 1 SESI 4, lanjutan)

> Semua kode di `packages/domain` (baru) + `apps/api`. Diverifikasi lokal terhadap PG16 fresh
> (semua migrasi ter-apply) + integration nyata: core 106, db 9, **domain 30**, **api 29** hijau.
> Entri `docs/DECISIONS.md` 2026-07-23 (langkah 3 & 4) mencatat semua keputusan teknis.

### Arsitektur layer
`@cdps/core` (engines) → `@cdps/db` (client + executors) → **`@cdps/domain` (services, BARU)** →
`apps/api` (route handlers tipis). Mirror pemisahan Go `internal/core` → `internal/{hris,demo}` →
`internal/httpapi`. Handler = shell: resolve Actor dari JWT → validasi → panggil service.

### Langkah 3 — importer karyawan (`packages/domain/src/employees.ts`, OQ-4)
- `EmployeeSource` (port) + `CsvEmployeeSource` (parser CSV RFC4180-mini, fs-free — caller baca file).
- `syncEmployees(tx, emps, actor, {full})` — upsert `employees` idempoten; deaktivasi/reaktivasi →
  `set_employee_banned()` (ban/un-ban GoTrue, no-op PG polos); full-sync → flag absen; diaudit.
- `provisionCredentials(tx, emps, actor)` — bcrypt cost 10; `must_change_password=true`;
  **`on conflict do nothing`** (tak menimpa kredensial existing → re-import aman); hanya karyawan aktif.
- `linkAuthUsers(tx)` — `import_employee_credentials()` **di-guard `to_regclass('auth.users')`**
  (no-op balikan 0 di CI/PG polos; jalan di Supabase, service-role).
- `importEmployees(sql, source, actor, {full})` — orkestrasi sync→provision→link, **satu transaksi**.
- Test: `employees.test.ts` (7 unit parser + 12 integration).

### Langkah 4 — route handlers (`apps/api`) + service demo (`packages/domain/src/demo.ts`)
- `demo.ts` = port `internal/demo` (vertikal referensi 4 executor: ident+sm+notify+audit satu tx):
  `create`/`list`/`get`/`transition`/`submitBlockRequest`/`approveBlockRequest`. Gate wajib +
  BI `[...]` SEBELUM `ident_next` (ID hanya lahir pasca-validasi); status HANYA lewat `sm_transition`.
- Handler: `POST/GET /api/v1/demo-tasks`, `GET .../{id}`, `POST .../{id}/transition`,
  `POST /api/v1/admin/employee-import` (Director-only, memakai importer langkah 3).
- `apps/api/src/lib/`:
  - `auth.ts` — verifikasi **JWT HS256 sendiri** (`node:crypto`, tanpa dep baru): tolak `alg≠HS256`
    (anti algorithm-confusion/`none`), `timingSafeEqual`, cek `exp`/`nbf`; `requireActor(req)` →
    `permission.actorFromClaims(app_metadata)` (**ditambah ke `@cdps/core`** = impl izin ke-3, dites).
  - `http.ts` — map error→status (Incomplete→400 BI, NotFound→404, Forbidden→403, transition
    role_denied→403 / blocked→409); `handle()` wrapper.
  - `db.ts` — client `@cdps/db` singleton (service-role/privileged; RLS jaring baca, tulis via RPC).
- Wiring: `next.config.ts` `transpilePackages` + dep `file:` `@cdps/*`; handler pakai Web
  `Request`/`Response` global (tak import `next`) → `tsc` + unit-test lib jalan tanpa Next.
- Test: `demo.test.ts` (2 unit gate + 9 integration), `lib/auth.test.ts` (14), `lib/http.test.ts` (15).

### CI
- `db-and-migrations`: +step `@cdps/domain` (typecheck+test, `DATABASE_URL` sama, setelah `@cdps/db`).
- Job baru **`api`**: `npm ci && typecheck && test` (lib unit — tanpa DB, tanpa Next-build).

### Catatan untuk yang melanjutkan
- Importer siap untuk **gate manusia §5 #2** (import data riil): panggil endpoint
  `POST /api/v1/admin/employee-import { csv, full }` (Director) ATAU `employees.importEmployees()`
  langsung; `import_employee_credentials()` hanya efektif di Supabase (verifikasi versi GoTrue dulu).
- Modul domain riil berikutnya (M0/M1) ikut pola `demo.ts` + handler tipis; jangan taruh logic di handler.
- `apps/api` belum ada `next build` di CI (hindari kerapuhan resolusi cross-package saat build) —
  hanya typecheck + lib-test. Bila nanti perlu, tambah job `next build` setelah wiring workspace stabil.
