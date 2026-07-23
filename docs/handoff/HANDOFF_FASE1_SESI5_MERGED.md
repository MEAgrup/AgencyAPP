# HANDOFF — Fase 1 SELESAI (kode) & di-merge ke `main` (2026-07-23, sesi 5)

> Standalone. Baca bersama `docs/DECISIONS.md` (entri 2026-07-22 & 2026-07-23),
> `docs/handoff/HANDOFF_FASE1_SESI4.md` (§8 detail langkah 3–4),
> `docs/SUPABASE_MIGRATION_TECH_APPENDIX.md`.
> Project Supabase target: **CDPS SG** = `egddxfcnrtecheiykhlf` (ap-southeast-1).

---

## ⭐ MULAI DI SINI

**`main` (`e394efd`) kini memuat Fase 0 (lengkap) + Fase 1 langkah 1–4.** Semua PR
lama sudah dibereskan (lihat §4). Kode Fase 1 **SELESAI di sisi kode & terverifikasi
lokal**; yang tersisa = **1 gate CI-infra** (§2) + **3 gate manusia** (§3).

**Apa yang ada di `main` sekarang (stack Supabase/TS):**
- `supabase/migrations/` — 28 (Fase 0) + statemachine + `rls_baseline` + `supabase_auth`. Apply bersih → **53 tabel**.
- `packages/core` (`@cdps/core`) — engines murni (money/tz/permission/bi/ident/statemachine/audit/notification) + **`permission.actorFromClaims`** (JWT→Actor, impl izin ke-3).
- `packages/db` (`@cdps/db`) — client postgres.js (pooler, prepare:false) + `withTransaction` + executors (ident/sm/notify/audit).
- `packages/domain` (`@cdps/domain`, **BARU**) — `employees` (importer CSV, Fase 1 langkah 3) + `demo` (vertikal referensi 4 executor, langkah 4).
- `apps/api` — route handlers tipis: `demo-tasks` (list/create/get/transition/block-request/approve) + `admin/employee-import` (Director-only) + `lib/{auth,http,db}`.

**Verifikasi cepat (lokal, butuh Postgres 16/17 + `DATABASE_URL`):**
```
cd packages/core   && npm ci && npm run typecheck && npm test    # 106
cd packages/db     && npm ci && npm test                         # 9  (incl. integration bila DATABASE_URL diset)
cd packages/domain && npm ci && npm run typecheck && npm test     # 30 (8 unit + 22 integration)
cd apps/api        && npm ci && npm run typecheck && npm test      # 29 (JWT verify + error-map)
# DB end-to-end: apply semua supabase/migrations/*.sql ke PG kosong, seed ×2,
#   lalu jalankan supabase/tests/{ident,immutability,rls,auth_claims}_checks.sql
```
Cara start PG lokal cepat (root env): `initdb` sbg user `postgres`, `pg_ctl start -o '-p 5470'`,
`createdb cdps`, apply migrasi, set `DATABASE_URL=postgres://postgres@127.0.0.1:5470/cdps`.

---

## 2. ⚠ GATE CI-INFRA (perlu dicek manusia — bukan kegagalan kode)

Saat sesi ini, **GitHub-hosted runner untuk org bermasalah**: sejak ~08:00 UTC semua
job CI **instant-fail** (`runner_id=0`, ~2 dtk, tanpa log) — POLA kehabisan
kapasitas/kuota runner, **bukan** workflow invalid (job `db-and-migrations`/`backend`
sempat **antri** = file valid) dan **bukan** kegagalan kode. Run terakhir yang dapat
runner riil (#319, 07:45) hijau kecuali 1 kegagalan **nyata** (`api` typecheck TS2307)
yang **sudah diperbaiki** commit `e3963b2` (job `api` install dulu deps `packages/db`
+ `packages/domain` supaya bare-import `postgres`/`bcryptjs` di sumber ter-resolve) —
diverifikasi lokal (reproduksi TS2307 → hilang setelah fix).

**TODO manusia:** cek **billing/kuota GitHub Actions** org MEAgrup (Settings → Billing →
Actions) atau tunggu reset/incident selesai, lalu **re-run CI di `main`** (`ci.yml`)
untuk konfirmasi hijau end-to-end. `main` di-merge atas dasar verifikasi lokal karena
runner tak tersedia; fix `api` belum pernah dikonfirmasi hijau DI CI.

---

## 3. ⚠ GATE MANUSIA Fase 1 (DECISIONS O36 — tak bisa dieksekusi agent)

1. **Aktifkan Access Token Hook** di Dashboard CDPS SG → `Authentication > Hooks` →
   pilih `custom_access_token_hook`. **KRITIS:** tanpa ini JWT tak berisi `app_metadata`
   → SEMUA policy RLS default-deny.
2. **Import kredensial riil.** Muat karyawan (CSV) → `employees` + `employee_credentials`
   lalu `select import_employee_credentials();` (service-role). **Jalur siap pakai:**
   `POST /api/v1/admin/employee-import { csv, full }` (Director) — lihat §5 soal data.
   Verifikasi versi GoTrue project sebelum import massal.
3. **Smoke-test login semua role di staging** (staff/lead/OD/Director): login → decode JWT
   → `app_metadata` benar → baris terlihat sesuai RLS.

---

## 4. Kebersihan PR (semua ditutup sesi ini)

- **#33** (MERGED → `main`): Fase 1 langkah 1–4. Branch `claude/fase1-sesi4-handoff-1x8v1i`.
- **#32** ditutup — superseded oleh #33 (isinya = subset #33).
- **#27, #28** ditutup — dokumen usang/superseded (assessment pra-keputusan; handoff Wave 1 Go).
- **#21** ditutup — smoke test modul **Go** (stack di-freeze). Branch dipertahankan sbg rujukan
  cakupan test saat porting modul ke `@cdps/domain`.
- **#25** ditutup — roster V2 (65 karyawan) + role mapping untuk auth Go. **⚠ Datanya berharga:**
  `backend/testdata/import_samples/employees_cdps.csv` + `backend/seed/role_mappings_riil.csv`
  = kandidat input importer baru untuk **gate manusia #2**. Buka kembali branch-nya saat import.
- **#22** ditutup — fix `web-internal` next.config (rewrite backend Go/Railway); nilai ulang
  saat deploy `web-internal` di Vercel.

Tidak ada PR terbuka tersisa.

---

## 5. Langkah kode berikutnya (urut, build order lama)

1. **Modul domain riil Wave 1 — M0 (Sales) / M1 (Leads), money path.** Ikuti pola
   `packages/domain/src/demo.ts` (validasi + BI `[...]` SEBELUM `ident_next`; status HANYA
   lewat `sm_transition`; ident+sm+notify+audit satu `withTransaction`) + handler tipis
   `apps/api` (resolve Actor via `requireActor`, tulis service-role). Jangan taruh logic di handler.
   Rujukan Go: `backend/internal/module0_sales`, `module1_leads`; state machine `prospect_attempt`/
   `lead_record` sudah di-seed.
2. **Importer produksi:** sambungkan data #25 (roster riil) → `employees.importEmployees()` /
   endpoint import, untuk gate manusia #2.
3. **(Opsional, §6 SESI4)** pindahkan `jwt_owns_*` ke schema privat (hapus 3 WARN advisor);
   Vercel project untuk `apps/api`; seed remote dev.

---

## 6. Peringatan penting (tetap berlaku)

- **Predikat izin 3 implementasi** — `permission.ts` (TS/UX), policy RLS (SQL),
  `employee_claims`/hook + `actorFromClaims` (SQL/TS). Turun dari `PERMISSIONS.md`/`actor.go`
  yang SAMA — **tak boleh divergen**. Dijaga `rls_checks.sql` + `auth_claims_checks.sql` +
  unit test `permission.test.ts`.
- **`apps/api` resolve `@cdps/*` ke SOURCE** (belum ada workspace root). Konsekuensi: CI job
  `api` HARUS `npm ci` dulu di `packages/db` + `packages/domain` (bare-import postgres/bcryptjs).
  Bila kelak dibuat npm workspace root, sederhanakan ini + job `core/db/domain` yang `cd`-per-paket.
- **`apps/api` belum ada `next build` di CI** — hanya typecheck + lib-test. Logic ter-gate di
  `@cdps/domain`/`@cdps/core`. Tambah job `next build` bila wiring workspace sudah stabil.
- Migrasi yang menyentuh `auth.*` WAJIB SQL dinamis + guard `to_regclass` (CI plain-PG hijau).
- Katalog notifikasi FROZEN 15 event; string BI `[...]` persis; transisi HANYA `sm_transition`;
  audit append-only; ID hanya pasca-validasi. Setiap deviasi → entri `docs/DECISIONS.md`.
