# HANDOFF — Migrasi Supabase/Vercel, Fase 0 SESI 2 (2026-07-22)

> Lanjutan dari `HANDOFF_SUPABASE_FASE0.md` (sesi 1). Baca bersama
> `docs/SUPABASE_MIGRATION_PLAN.md` (plan induk) dan
> `docs/SUPABASE_MIGRATION_TECH_APPENDIX.md` §B (port core engines).
> Branch kerja: `claude/supabase-fase0-sesi2-handoff-fpz613`.

## 1. Fokus sesi ini — langkah §5.2: port core engines ke TypeScript

Sesi 1 menuntaskan §5.1 (28 migrasi ter-apply + smoke test + advisors). Sesi ini
mengerjakan **§5.2: port core engines Go → TypeScript** di `packages/core`,
mengikuti prinsip pemetaan Lampiran §B: **komputasi/format/validasi murni → TS**;
**apa pun yang harus atomik dengan satu baris/transaksi → fungsi/trigger Postgres**
(sudah ada di `supabase/migrations/`, TIDAK diimplementasi ulang di TS).

## 2. Yang SUDAH dikerjakan (branch ini)

`packages/core/` sekarang berisi engine ter-port + test vitest (mirror `*_test.go`):

| File | Isi (murni TS) | Bagian atomik (SQL, di tempat lain) |
| --- | --- | --- |
| `src/money.ts` | `Money=bigint` minor-unit, `parse`/`decimal`/`format` (`Rp. X.XXX.XXX,00`), `percentOf`/`mul` round-half-up + guard overflow int64 | — |
| `src/tz.ts` | WIB `+07:00` fixed (no DST), `date`/`dateString`/`period`/`daysBetween`; `WIB_OFFSET_HOURS=7` satu sumber | `wib_date`/`wib_period` (migrasi) |
| `src/permission.ts` | predikat role (`isLead`,`canWrite`,`canReadDivision`,`canReadAll`,`canManageAdmin`) | RLS re-evaluasi predikat sama dari klaim JWT (§D) |
| `src/bi-messages.ts` | **satu sumber** string BI `[...]` core (block, role-denied, mandatory, alokasi 100%) | — |
| `src/statemachine/` | `config.ts` (14 machine 1:1 dari `config.go`), `machine.ts` (`Machine`/`Engine`/`evaluate`) — keputusan allow/block/role terstruktur (bukan exception) | `sm_transition` (lock+UPDATE+audit+emit) — Fase 1 |
| `src/notification/catalog.ts` | katalog **15 event FROZEN** + `selectRecipients` (dedup + exclude actor) | resolver `leadsOfDivision` + INSERT di dalam `sm_transition` — Fase 1 |
| `src/ident.ts` | `formatId`/`parseId` `PREFIX-YYYYMM-NNNN` + `period` WIB | `ident_next()` (migrasi, sudah ada) |
| `src/audit.ts` | `buildEntry` (payload jsonb) + `NoActorError` + guard no-secret (password/token) | trigger `forbid_mutation()` + `REVOKE` — Fase 1 (§D) |
| `src/index.ts` | barrel re-export semua engine sebagai namespace | — |

Tooling `packages/core`: `package.json` (vitest+typescript, script `test`/`typecheck`),
`tsconfig.json` (target ES2020 utk bigint), `.gitignore` (node_modules/dist/coverage),
`package-lock.json` di-commit (reproducible CI §G).

### Hasil verifikasi

- `npm test` → **74 test LULUS** (7 file: money 40, permission 7, statemachine 6,
  tz 5, notification 7, ident 5, audit 4).
- `npx tsc --noEmit` → **EXIT 0** (strict mode bersih).
- **TIDAK ADA** perubahan di `backend/`, `web-internal/`, `web-client-portal/`
  (freeze dihormati). Tidak membuat root workspace `package.json` (sesuai peringatan
  handoff sesi 1 — `packages/core` self-contained).

### Catatan desain (deviasi kecil, terdokumentasi di sini)

- `statemachine.evaluate()` mengembalikan **nilai terstruktur** `TransitionDecision`
  (`{ok:true}` / `blocked` / `role_denied` / `auto_computed` / `unknown_machine`),
  bukan throw — sesuai rekomendasi §B.2 (lebih mudah di-assert TS/pgTAP, dan route
  handler memetakan ke HTTP 409/403 tanpa parse string error). Ini keputusan yang
  sudah diarahkan appendix, bukan deviasi dari PRD.
- `Money` memakai `bigint` (bukan `number`) + guard range int64 eksplisit → memenuhi
  paritas `PercentOf`/`Mul` overflow → `ErrBadAmount` di Go (§B.5).
- `audit.buildEntry` menolak field rahasia (`password`/`password_hash`/`token`/
  `secret`, termasuk nested) → `SecretInAuditError`. Ini memperkuat house-rule §B.3
  (JSON before/after tidak boleh memuat hash) dengan guard kode + test, bukan hanya
  review manusia.

## 3. Langkah berikutnya (sisa §5, urutan disarankan)

1. **§5.3 Setup CI** (GitHub Actions, Lampiran §G): `supabase start` + `db reset`
   (apply 28 migrasi) + pgTAP (immutability, `ident_next`, `sm_transition`) + `vitest run`
   di `packages/core`. Job juga `tsc --noEmit`. Ini yang mengunci paritas dua-sisi.
2. **§5.4 Seed fixture Alpha Digital** → `supabase/seed.sql` + kasus uji vitest
   (Speed Score 112.5%, Health Score ≈74.56 → Watch) sebagai kriteria lulus port.
3. **`packages/db`** — wiring `postgres.js` (`prepare:false` utk pooler 6543) + Drizzle
   types (`generate_typescript_types`), lalu port bagian DB engine: `audit` INSERT,
   `notification` Emit/resolver (fungsi SQL), `sm_transition` + `ident_next` wrapper.
4. **Fungsi SQL Fase 1** yang belum ada di migrasi: `sm_transition`, `sm_machines`/
   `sm_edges` (seed dari `config.ts`), resolver `leadsOfDivision`, RPC
   `mark_notification_read`. Trigger `forbid_mutation` + `ident_next` SUDAH ada
   (migrasi sesi 1).
5. **§F.1 importer** — port `backend/internal/importer/` (belum disentuh) 1:1, replay
   lewat jalur domain (bukan raw INSERT).
6. **Fase 1 auth/RLS/Vercel** — lihat `HANDOFF_SUPABASE_FASE0.md` §5.5–5.6.

## 4. Peringatan yang masih berlaku

- House rules CLAUDE.md penuh: string BI `[...]` persis (kini SATU sumber di
  `bi-messages.ts` — extend di sana, jangan inline), katalog notifikasi FROZEN 15
  event (kini di `catalog.ts`), transisi hanya lewat engine, audit append-only,
  derived recomputable.
- Predikat permission WAJIB identik antara `permission.ts` (TS) dan RLS SQL (§D) —
  test kontrak dua-sisi saat RLS dibuat (§G).
- QC skema yang ditandai sesi 1 (`creator_lists.included_bookings` text vs jsonb;
  nama constraint; seed `'0001-01-01'` di `perf_*`) masih terbuka — cek saat seed.
- Project SALAH REGION `CDPS` (`klrmguatvzbmujihzacl`, Sydney) masih harus DIHAPUS
  MANUAL oleh pemilik (biaya dobel sampai dihapus). Lihat `HANDOFF_SUPABASE_FASE0.md` §2.

## 5. Commit sesi ini (branch `claude/supabase-fase0-sesi2-handoff-fpz613`)

- (sesi ini) `feat(fase0): port core engines Go → TypeScript di packages/core + vitest`
