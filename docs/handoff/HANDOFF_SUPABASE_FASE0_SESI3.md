# HANDOFF — Migrasi Supabase, Fase 0 SESI 3 (2026-07-22)

> Lanjutan dari `HANDOFF_SUPABASE_FASE0.md` (skema TUNTAS, 28 migrasi applied).
> Baca bersama `docs/SUPABASE_MIGRATION_PLAN.md`, `docs/SUPABASE_MIGRATION_TECH_APPENDIX.md`
> (§B port core engines), dan `docs/DECISIONS.md` 2026-07-22.
> Branch kerja: `claude/supabase-fase0-sesi3-continue-xko1b4`.

## 1. Konteks: di mana kita berada di rencana

Fase 0 punya 6 langkah (handoff sebelumnya §5). Status:

1. ✅ Apply 28 migrasi + smoke test + advisors — SELESAI (sesi lalu).
2. ✅ **Port SEMUA core engine ke TypeScript** — SELESAI SESI INI: money, tz, permission, bi,
   ident, statemachine, audit, notification (`packages/core`, 98 test) + `packages/db`
   (klien postgres.js + executor konkret, 4 unit test + 5 integration skip-guarded). Bagian
   atomik (ident_next, sm_transition, notify_emit) ada di migrasi `…_statemachine.sql`.
3. 🔄 Setup CI (GitHub Actions) — SESI INI tambah 2 job di `.github/workflows/ci.yml`:
   `core-engines` (vitest+typecheck `packages/core`) & `db-and-migrations` (apply SEMUA
   migrasi ke PG17 service + verify seed 14/15 + integration `packages/db`). Sisa: pgTAP
   khusus bila diinginkan.
4. ⬜ Seed fixture Alpha Digital → `supabase/seed.sql`.
5. ⬜ Fase 1: Supabase Auth (import bcrypt), importer CSV karyawan, MSL admin, RLS baseline.
6. ⬜ Vercel project untuk `apps/api`.

PR sesi ini: **#31** (`claude/supabase-fase0-sesi3-continue-xko1b4` → `main`).

> ✅ **Migrasi `20260102000002_statemachine.sql` SUDAH DI-APPLY ke remote `CDPS SG`
> (`egddxfcnrtecheiykhlf`) — 2026-07-23, version `20260723055732`.** `list_migrations` = 29 entri.
> Smoke remote (dalam `BEGIN…ROLLBACK`, tanpa residu): seed 14 machine/94 edge/20 terminal/15
> event; `sm_transition` valid/blocked/not_found/auto_computed benar; `notify_emit` dedup+exclude
> actor benar; `ident_next` WIB `TST-202607-0001`. **Advisors:** 4 tabel baru dapat ERROR
> `rls_disabled_in_public` (EXPECTED Fase 0, RLS di Fase 1); fungsi baru `sm_transition`/
> `notify_emit`/`mark_notification_read` **tidak** menambah warning `function_search_path_mutable`
> (SET search_path bekerja). Juga tervalidasi lokal end-to-end + di-gate CI (`db-and-migrations`).

## 2. Yang dikerjakan SESI INI (branch di atas)

Port **SEMUA 8 core engine** ke stack baru (1:1 dari Go + test vitest). `packages/core`:
**98 test hijau, tsc bersih**; `packages/db`: 4 unit + 5 integration skip-guarded, tsc bersih.
Bagian atomik/concurrency (alokasi ID, transisi, emit) ada di fungsi SQL; TS = wrapper + murni.

- `packages/core/src/money.ts` (+ `money.test.ts`, 40 test) — port `money.go`.
  Minor units sebagai **`bigint`** (bukan `number`) — mem-port sifat "tidak pernah float"
  dari `int64` Go. `parse`/`decimal`/`format` (`Rp. X.XXX.XXX,00`) + `percentOf`/`mul`
  round-half-up eksak + guard overflow int64 (throw `BadAmountError`, bukan wrap).
- `packages/core/src/tz.ts` (+ `tz.test.ts`, 6 test) — port `tz.go`.
  WIB fixed-offset (`WIB_OFFSET_HOURS = 7`, satu sumber offset — WAJIB match SQL
  `wib_date`/`wib_period` yang pakai `+ interval '7 hours'`). `date`/`dateString`/
  `period`/`daysBetween`, semua via shift `+7h` lalu baca UTC parts (tak bergantung tzdata).
- `packages/core/src/permission.ts` (+ `permission.test.ts`, 7 test) — port `permission.go`.
  Predikat murni `isLead`/`canWrite`/`canManageAdmin`/`canReadDivision`/`canReadAll`,
  termasuk kasus layered OD/Director (pure-OD read-only; Staff+OD menulis dari scope staff).
- `packages/core/src/bi.ts` (+ `bi.test.ts`, 13 test) — konstanta BI **core-level** saja:
  `INCOMPLETE_DATA` (default CLAUDE.md #5), `TRANSITION_NOT_ALLOWED` (port
  `statemachine.DefaultBlockMessage`), `TRANSITION_ROLE_DENIED` (port `RoleDeniedMessage`),
  + helper invariant `[...]` (`isBracketed`/`bracket`). **PENTING:** Go TIDAK punya katalog BI
  terpusat — 285 string inline per-modul; string spesifik-modul ikut port modulnya, JANGAN
  ditumpuk di sini.
- `packages/core/src/ident.ts` (+ `ident.test.ts`, 13 test) — registry `PREFIXES` (23 prefix riil
  dari `ident.Next` Go, cross-check DATA_MODEL.md §1) + helper murni `format`/`parse`/`isValid` +
  wrapper `nextId(exec, prefix, at)` yang panggil fungsi SQL `ident_next` (alokasi gap-free/
  rollback-safe TETAP di Postgres, TIDAK direimplementasi di TS). `periodOf` re-export tz WIB.
  `TST`/`DEMO` sengaja TIDAK diregistrasi (scaffolding test Go saja).
- `packages/core/src/statemachine.ts` (+ test, 5 test) — wrapper `transition(exec, req)` atas
  fungsi SQL `sm_transition`. Derive dua boolean role dari `permission.Actor` PERSIS spt Go
  (requireLead lolos untuk Director ATAU siapa pun level lead; cek divisi-spesifik ada di layer
  modul). Return terstruktur `{ok,code,message}` (bukan exception) → handler map ke HTTP.
- `packages/core/src/audit.ts` (+ test, 6 test) — `write(exec, record)` append-only dengan guard
  `NoActorError` (port `ErrNoActor`); immutability ditegakkan trigger `forbid_mutation`. Helper
  `hasSecretKey` = alat uji/lint aturan "password/hash tak pernah masuk payload" (§B.3).
- `packages/core/src/notification.ts` (+ test, 8 test) — 15 event FROZEN (`EVENTS`/`CATALOG`,
  nilai string persis Go) + wrapper `emit(exec, emission)` atas fungsi SQL `notify_emit`.
- **`supabase/migrations/20260102000002_statemachine.sql`** — tabel `sm_machines`/`sm_edges`/
  `sm_terminal_states` + seed **14 machine** (transkripsi 1:1 `config.go`) + fungsi `sm_transition`;
  tabel `notif_events` + seed **15 event** + fungsi `notify_emit` + `mark_notification_read`.
  Fungsi diberi `SET search_path = public` (menjawab advisor `function_search_path_mutable`).
- **`packages/db`** — klien postgres.js (`createClient` pooler 6543 `prepare:false`,
  `withTransaction`) + executor konkret (`identExecutor`/`smExecutor`/`auditExecutor`/
  `notifyExecutor`, atau `executors(sql)`). `executors.test.ts` (fake sql, 4 test) +
  `integration.test.ts` (5 test, **skip kecuali `DATABASE_URL` di-set**, jalan dalam tx yang
  di-rollback). `@cdps/core` di-resolve via alias vitest + tsconfig `paths` (tanpa root workspace).
- `packages/core/src/index.ts` — barrel `export * as money/tz/permission/bi/ident/statemachine/audit/notification`.
- Tooling: `packages/core/package.json` tambah vitest + script `test`/`test:watch`/`typecheck`;
  `tsconfig.json` target dinaikkan `ES2017` → `ES2020` (butuh literal `bigint`).
  `package-lock.json` di-commit (reproducible); `node_modules` diignore.
- `.gitignore` root: tambah section Node/TS (`node_modules/`, `apps/*/node_modules/`,
  `packages/*/node_modules/`, `dist/`, `*.tsbuildinfo`, `coverage/`) — lockfile tetap tracked.
- **TIDAK menyentuh** `backend/`, `web-internal/`, `web-client-portal/` (freeze dihormati).
  **TIDAK membuat** root workspace `package.json` (keputusan sesi lalu — jangan sentuh
  `web-internal` tanpa keputusan). `packages/core` di-`npm install` mandiri.

## 3. Keputusan implementasi penting (baca sebelum ubah)

Detail lengkap di `docs/DECISIONS.md` 2026-07-22 (entri "Fase 0 — port core engines statemachine
& notification"). Ringkas:

- **`sm_transition` return `jsonb` `{ok,code,message}`, BUKAN exception** (§B.2). Kode:
  `no_actor|unknown_machine|auto_computed|not_found|blocked|role_denied`. Wrapper TS memetakan.
- **Not-found via `v_from IS NULL`, BUKAN `IF NOT FOUND`** — `EXECUTE...INTO` tidak set `FOUND`;
  valid karena kolom status entity selalu `NOT NULL`.
- **`notify_emit`: `leadsOfDivision` == `explicitOrLeads`** (set recipient identik setelah dedup).
- **Emisi notifikasi TIDAK di dalam `sm_transition`** — Go memetakan event→transisi di wiring,
  bukan properti machine; jadi handler panggil `notify_emit` di transaksi yang sama (paritas Go).
- **Offset WIB satu sumber** — `WIB_OFFSET_HOURS=7` (TS) HARUS identik `+ interval '7 hours'` (SQL).
- **`money.ts` core = aritmetika (bigint)**; `web-internal/money.ts` hanya display. Dedup butuh
  root workspace → tunda sampai ada keputusan.

## 4. Cara verifikasi cepat di sesi baru

```
cd packages/core && npm install && npm test && npm run typecheck   # 98 pass, tsc 0
cd packages/db   && npm install && npm test && npm run typecheck   # 4 pass + 5 skip, tsc 0
# integrasi penuh (butuh DB termigrasi): DATABASE_URL=postgres://... npm test  (di packages/db)
```

## 5. Langkah berikutnya (urutan disarankan)

0. **Apply migrasi `…_statemachine.sql` ke project Supabase remote** saat pemilik siap
   (`supabase db push` / MCP `apply_migration` project `egddxfcnrtecheiykhlf`), lalu
   `get_advisors`. Migrasi sudah tervalidasi lokal + di-gate CI (lihat §1) — apply remote
   tinggal eksekusi.
1. **Seed fixture Alpha Digital** → `supabase/seed.sql` (paritas `backend/seed` + `internal/seed`).
2. **CI lanjutan** (opsional): tambah pgTAP (immutability, ident gap-free, sm_transition matrix)
   di atas job `db-and-migrations` yang sudah ada.
3. **Fase 1**: Supabase Auth (import bcrypt per OQ-3), importer CSV karyawan (OQ-4), MSL admin,
   RLS baseline (§D) — aktifkan RLS SEMUA tabel + custom claims `app_metadata` (predikat
   `permission.ts` di-mirror di RLS, §B.4).
4. **Vercel** project `apps/api` (env dari `.env.example`; wiring route handler pakai
   `@cdps/db` `withTransaction` + `executors` → ident/sm/notify/audit satu transaksi).
5. Optional hardening: retrofit `SET search_path` ke 5 fungsi lama (`set_updated_at`,
   `forbid_mutation`, `wib_date`, `wib_period`, `ident_next`) — advisor WARN, non-blocking.

## 6. Peringatan penting (tetap berlaku)

- House rules CLAUDE.md penuh: string BI `[...]` persis, katalog notifikasi FROZEN 15 event,
  transisi hanya lewat engine, audit append-only, derived recomputable.
- Offset WIB **satu sumber** — `WIB_OFFSET_HOURS = 7` (TS) HARUS identik `+ interval '7 hours'` (SQL).
  Mismatch = kelas bug reminder H-3/jatuh-tempo (alasan O20 jadi keputusan formal).
- Predikat permission diimplementasikan DUA KALI (TS untuk UX/validasi, RLS/SQL untuk enforcement) —
  keduanya turun dari `PERMISSIONS.md` yang sama, tidak boleh divergen (test kontrak §G).
- `money.ts` di `packages/core` adalah engine aritmetika (bigint, eksak). `web-internal/src/lib/money.ts`
  hanya display (`formatIDR`/`formatRatio`, pakai `number`) — output `format()` DIBUAT match persis.
  Dedup keduanya jadi package shared butuh root workspace → tunda sampai ada keputusan.
- Semua deviasi baru → entri `docs/DECISIONS.md`.

## 7. Catatan: handoff SESI3 yang "hilang"

Prompt sesi ini menyebut handoff `HANDOFF_SUPABASE_FASE0_SESI3.md` commit `8a389b9` sudah dibuat &
ter-push, tapi commit/file itu **tidak ditemukan** di repo (branch/commit tak ada). Kemungkinan
push gagal atau branch hilang. Dokumen INI adalah handoff SESI3 yang sebenarnya, dibuat ulang dari
kondisi aktual repo + `HANDOFF_SUPABASE_FASE0.md`. Tidak ada pekerjaan sesi-lalu yang hilang selain
handoff itu sendiri (kode/migrasi utuh, terverifikasi).
