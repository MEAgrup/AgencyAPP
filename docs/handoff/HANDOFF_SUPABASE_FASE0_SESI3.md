# HANDOFF — Migrasi Supabase, Fase 0 SESI 3 (2026-07-22)

> Lanjutan dari `HANDOFF_SUPABASE_FASE0.md` (skema TUNTAS, 28 migrasi applied).
> Baca bersama `docs/SUPABASE_MIGRATION_PLAN.md`, `docs/SUPABASE_MIGRATION_TECH_APPENDIX.md`
> (§B port core engines), dan `docs/DECISIONS.md` 2026-07-22.
> Branch kerja: `claude/supabase-fase0-sesi3-continue-xko1b4`.

## 1. Konteks: di mana kita berada di rencana

Fase 0 punya 6 langkah (handoff sebelumnya §5). Status:

1. ✅ Apply 28 migrasi + smoke test + advisors — SELESAI (sesi lalu).
2. 🔄 **Port core engines ke TypeScript** — SESI INI: **5 dari ~8 engine murni selesai**
   (money, tz, permission, bi, ident). Sisa engine bergantung DB/SQL (statemachine, audit,
   notification) — lihat §3.
3. ⬜ Setup CI (GitHub Actions): supabase start + migrasi + pgTAP + vitest.
4. ⬜ Seed fixture Alpha Digital → `supabase/seed.sql`.
5. ⬜ Fase 1: Supabase Auth (import bcrypt), importer CSV karyawan, MSL admin, RLS baseline.
6. ⬜ Vercel project untuk `apps/api`.

PR sesi ini: **#31** (`claude/supabase-fase0-sesi3-continue-xko1b4` → `main`).

## 2. Yang dikerjakan SESI INI (branch di atas)

Port **semua** core engine **murni** (tanpa DB, tanpa concurrency hazard) ke `packages/core` —
5 engine: money, tz, permission, bi, ident — masing-masing 1:1 dari Go + test vitest yang
mirror `*_test.go` Go. **79 test hijau, `tsc --noEmit` bersih.**

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
- `packages/core/src/index.ts` — barrel `export * as money/tz/permission/bi/ident`.
- Tooling: `packages/core/package.json` tambah vitest + script `test`/`test:watch`/`typecheck`;
  `tsconfig.json` target dinaikkan `ES2017` → `ES2020` (butuh literal `bigint`).
  `package-lock.json` di-commit (reproducible); `node_modules` diignore.
- `.gitignore` root: tambah section Node/TS (`node_modules/`, `apps/*/node_modules/`,
  `packages/*/node_modules/`, `dist/`, `*.tsbuildinfo`, `coverage/`) — lockfile tetap tracked.
- **TIDAK menyentuh** `backend/`, `web-internal/`, `web-client-portal/` (freeze dihormati).
  **TIDAK membuat** root workspace `package.json` (keputusan sesi lalu — jangan sentuh
  `web-internal` tanpa keputusan). `packages/core` di-`npm install` mandiri.

## 3. Engine yang sudah vs belum

Appendix §B membagi engine jadi dua: **murni komputasi** (→ library TS, mudah unit-test) vs
**butuh atomik/transaksi DB** (→ fungsi/trigger Postgres). Sesi ini menyelesaikan **semua yang
murni** (money, tz, permission, bi, ident — 79 test). Sisa 3 engine bergantung pada sisi SQL +
wrapper TS yang butuh koneksi DB untuk dites end-to-end — digarap bareng CI/DB integrasi:

- ✅ **ident** — fungsi `ident_next` SUDAH di migrasi `20260102000001_ident_next.sql`; wrapper TS
  `nextId` + registry + format helper SUDAH di `ident.ts`. Sisa (nanti): implementasi konkret
  `IdentExecutor` di `packages/db` (postgres.js, panggil di dalam transaksi entity — BUKAN
  supabase-js REST) + test integrasi.
- ⬜ **statemachine** — appendix §B.2 sarankan tabel `sm_machines`/`sm_edges` + satu fungsi
  `sm_transition` (return `jsonb` terstruktur, bukan exception). **Belum ada di migrasi** — perlu
  migrasi baru (seed dari `docs/STATE_MACHINES.md` + `backend/internal/core/statemachine/config.go`,
  14 machine). Role-gating (`requireLead`) dievaluasi DI DALAM fungsi SQL. `bi.TRANSITION_NOT_ALLOWED`
  = default `block_message`; `bi.TRANSITION_ROLE_DENIED` = pesan role-gate.
- ⬜ **audit** — trigger `forbid_mutation` SUDAH di migrasi foundation. Sisa: helper insert TS tipis
  (`Write()`) + test unit yang menegaskan `password_hash` tak pernah masuk payload before/after.
- ⬜ **notification** — 15 event FROZEN (verifikasi di `backend/internal/core/notification/notification.go`);
  resolver recipient jadi fungsi SQL dipanggil dari `sm_transition` (satu transaksi).

## 4. Cara verifikasi cepat di sesi baru

```
cd packages/core && npm install && npm test && npm run typecheck
```
Harus: **79 test pass** (money 40, tz 6, permission 7, bi 13, ident 13), tsc exit 0.

## 5. Langkah berikutnya (urutan disarankan)

1. **Migrasi `sm_machines`/`sm_edges` + fungsi `sm_transition`** (port `config.go` 14 machine)
   + pgTAP test transisi valid/invalid + `require_lead`. Lalu wrapper TS di `statemachine.ts`
   (pakai konstanta `bi.*`). Ini blocker terbesar berikutnya.
2. **`packages/db`**: implementasi klien postgres.js (pooler 6543, `prepare:false`) +
   `IdentExecutor` konkret + generate types. Lalu test integrasi `nextId` (gap-free, rollback-safe,
   WIB bucket) terhadap DB dev/lokal.
3. **audit `Write()` helper** + test "no password in payload".
4. **notification** resolver SQL + katalog 15 event TS.
5. **CI** (§G appendix): job vitest `packages/core` + job `supabase start` + apply migrasi + pgTAP.

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
