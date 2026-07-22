# HANDOFF — Migrasi Supabase/Vercel, Fase 0 → SESI 3 (untuk chat berikutnya)

> Handoff mandiri untuk sesi berikutnya. Baca berurutan:
> 1. Ini (status terkini + langkah berikutnya).
> 2. `HANDOFF_SUPABASE_FASE0.md` (sesi 1 — migrasi skema) & `HANDOFF_SUPABASE_FASE0_SESI2.md`
>    (sesi 2 — port engine + CI/pgTAP).
> 3. `docs/SUPABASE_MIGRATION_PLAN.md` (plan induk) + `docs/SUPABASE_MIGRATION_TECH_APPENDIX.md`
>    (§A–§G konvensi teknis) + entri `docs/DECISIONS.md` 2026-07-22.
>
> **Branch kerja: `claude/supabase-fase0-sesi2-handoff-fpz613`** (lanjutkan di branch
> yang sama; PR belum dibuat — jangan buat PR tanpa diminta pemilik).

## 1. Keputusan final (JANGAN tanya ulang)

- **Arsitektur:** hybrid/strangler. Go+MySQL(Railway) **DIBEKUKAN** sampai cutover
  big-bang. Backend baru TypeScript Next.js API routes (Vercel) + DB Supabase Postgres.
- **Auth:** Supabase Auth (GoTrue), import bcrypt existing (BUKAN reset paksa) — OQ-3.
- **HRIS:** `GET /employees` tidak dipakai lagi (OQ-4) → import CSV/spreadsheet admin.
- **Data:** masih UAT/seed → migrasi = re-seed/importer (cutover Opsi A), bukan pgloader.
- **Layout:** `apps/api` terpisah; kode bersama `packages/core` + `packages/db`.
- **Region Supabase: SINGAPORE `ap-southeast-1`** (arahan pemilik).
- `sm_transition`/`ident` didesain sebagai **fungsi PL/pgSQL tunggal** (bukan urutan
  query TS) karena pooler transaksi 6543 tak punya session state (§E.2).

## 2. Kondisi infrastruktur

- **Project Supabase aktif: `CDPS SG`** — ref **`egddxfcnrtecheiykhlf`**,
  `ap-southeast-1`, Postgres 17, org `dpuhrnweghnmnklyonhf`. Semua 28 migrasi SUDAH
  ter-apply di sini (sesi 1). Verifikasi: `mcp__Supabase__list_migrations` = 28 entri.
- ⚠️ **Project SALAH REGION harus DIHAPUS MANUAL pemilik dari dashboard:** `CDPS`
  ref `klrmguatvzbmujihzacl` (Sydney `ap-southeast-2`). API tak bisa delete. Selama
  belum dihapus = biaya dobel. Setelah dihapus, `CDPS SG` boleh di-rename jadi `CDPS`.
- **Staging & Vercel BELUM dibuat** (dijadwalkan saat dibutuhkan).

## 3. Yang SUDAH selesai (branch ini)

- **Sesi 1:** `supabase/migrations/` **28 file** (foundation + port 26 migrasi MySQL →
  49 tabel; `ident_next`), semua ter-apply ke `CDPS SG`, smoke + advisors lulus.
- **Sesi 2 (a) — port core engines Go → TypeScript di `packages/core/`** (murni, testable
  tanpa DB): `money`, `tz`, `permission`, `bi-messages`, `statemachine` (14 machine +
  `evaluate()` keputusan terstruktur), `notification` (katalog 15 event FROZEN +
  `selectRecipients`), `ident` (format/parse), `audit` (buildEntry + guard no-secret).
  → **74 test vitest lulus**, `tsc --noEmit` bersih.
- **Sesi 2 (b) — CI + pgTAP:** `.github/workflows/supabase-newstack.yml` (job
  `core-engines` = vitest+tsc; job `db-parity` = `supabase start` + `supabase test db`),
  `supabase/config.toml` (service non-DB dimatikan; `major_version=17`),
  `supabase/tests/` 2 file pgTAP (foundation wib/ident + immutability) → **16/16 lulus**
  di Postgres fresh (divalidasi lokal).
- **TIDAK ADA perubahan** di `backend/`, `web-internal/`, `web-client-portal/`, `ci.yml`
  (freeze dihormati). Tidak ada root workspace `package.json`.

### Layout repo baru saat ini
```
apps/api/                     # scaffold Next.js API-only (healthz), belum ada endpoint domain
packages/core/                # engine TS ter-port + vitest (SELESAI sejauh murni)
  src/{money,tz,permission,bi-messages,ident,audit}.ts + *.test.ts
  src/statemachine/{config,machine,index}.ts + statemachine.test.ts
  src/notification/catalog.ts + catalog.test.ts
packages/db/                  # STUB — belum di-wire (postgres.js/drizzle)
supabase/migrations/          # 28 file (final, sudah applied)
supabase/config.toml          # config lokal/CI
supabase/tests/               # pgTAP (foundation + immutability)
.github/workflows/supabase-newstack.yml
```

## 4. Cara verifikasi cepat di sesi baru

```sh
# engine TS
cd packages/core && npm install && npm test && npm run typecheck   # 74 pass, tsc 0

# pgTAP TANPA Docker (Docker daemon TIDAK tersedia di environment ini).
# PostgreSQL 16 + pgtap ada lewat apt; jalankan sebagai user `postgres` (bukan root):
apt-get install -y postgresql-16-pgtap
BASE=/var/lib/postgresql/pgtest; rm -rf "$BASE"; mkdir -p "$BASE"/{data,sock}; chown -R postgres:postgres "$BASE"
export PATH=/usr/lib/postgresql/16/bin:$PATH
runuser -u postgres -- bash -c "initdb -D $BASE/data -U postgres --auth=trust >/dev/null 2>&1 && \
  pg_ctl -D $BASE/data -o '-p 5433 -k $BASE/sock -c listen_addresses=\"\"' -l $BASE/pg.log -w start && \
  createdb -h $BASE/sock -p 5433 -U postgres cdps"
for f in supabase/migrations/*.sql; do runuser -u postgres -- psql -h $BASE/sock -p 5433 -U postgres -d cdps -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done
runuser -u postgres -- env PGHOST=$BASE/sock PGPORT=5433 PGUSER=postgres PGDATABASE=cdps pg_prove --ext .sql supabase/tests/*.sql
runuser -u postgres -- pg_ctl -D $BASE/data -w stop; rm -rf "$BASE"
```
Catatan: jalankan pgTAP di DB **fresh** — `ident_next` mengkonsumsi sequence, jadi DB
yang dipakai ulang akan menggeser nomor (0001→0003) dan bikin false-fail (bukan bug).

## 5. Langkah berikutnya (urutan disarankan)

1. **§5.4 Seed fixture Alpha Digital → `supabase/seed.sql`** (BERIKUTNYA).
   - Sumber: `backend/seed/` + `backend/internal/seed/` (Go). Filosofi §F.1: data lama
     di-**replay lewat jalur domain** (bukan raw INSERT) — tapi untuk seed statik,
     `seed.sql` boleh INSERT langsung ASAL angka derived final tetap benar & recomputable.
   - **Kriteria lulus:** reproduksi worked example — Speed Score **112.5%** (54÷48),
     Health Score **≈74.56 → Watch** (lihat DECISIONS). Tambahkan kasus uji vitest
     yang menghitung ulang dari log dan assert angka ini (mirror kebiasaan Go).
   - Perhatikan QC skema yang ditandai sesi 1: `creator_lists.included_bookings` text
     vs jsonb; nama constraint eksplisit; seed tanggal `'0001-01-01'` di `perf_*`.

2. **`packages/db`** — wire `postgres.js` **`{ prepare: false }`** (WAJIB utk pooler 6543,
   §E.2) + Drizzle types (`mcp__Supabase__generate_typescript_types` project
   `egddxfcnrtecheiykhlf`). Lalu port bagian DB engine: `audit` INSERT (pakai `buildEntry`),
   `notification` Emit, wrapper `ident_next`/`sm_transition`.

3. **Fungsi SQL Fase 1** (migrasi baru, lanjutkan penomoran `2026010200000X`):
   `sm_machines`/`sm_edges` (seed dari `packages/core/src/statemachine/config.ts` — SATU
   sumber), fungsi `sm_transition(...)` (§B.2: lock + cek edge + require_lead + UPDATE +
   audit INSERT + emit notif, kembalikan `jsonb {ok,message}`), resolver `leadsOfDivision`,
   RPC `mark_notification_read`. **Tambah pgTAP**: transisi ilegal terblok + tidak
   menulis audit; immutability layer-2 (`REVOKE UPDATE/DELETE FROM authenticated,anon`).
   Perbaiki juga 5 WARN advisor: `SET search_path = ''` di tiap fungsi.

4. **§F.1 importer** — port `backend/internal/importer/` 1:1 ke `packages/core/importer/`
   (replay lewat jalur domain).

5. **Fase 1 auth/RLS/Vercel** — Supabase Auth import bcrypt (OQ-3; hati-hati kolom
   `auth.users`, cek versi GoTrue; custom claim `app_metadata` via Access Token Hook,
   §C.3), importer CSV karyawan (OQ-4), MSL admin, RLS baseline (§D — predikat HARUS
   identik dengan `packages/core/src/permission.ts`, test kontrak dua-sisi §G).
   Di `supabase/config.toml` nyalakan lagi `[auth]`/`[api]` saat vitest-vs-stack.
   Vercel project `apps/api` (env dari `.env.example`).

## 6. Peringatan penting

- **House rules CLAUDE.md berlaku penuh:** string BI `[...]` persis — kini SATU sumber
  di `packages/core/src/bi-messages.ts`, **extend di sana, jangan inline**. Katalog
  notifikasi **FROZEN 15 event** di `catalog.ts`. Transisi hanya lewat engine. Audit
  append-only. Derived recomputable.
- **Predikat permission WAJIB identik** TS (`permission.ts`) ↔ RLS SQL (§D) — test
  kontrak dua-sisi saat RLS dibuat.
- `statemachine.evaluate()` sengaja **return terstruktur** (bukan throw) — keputusan
  §B.2, sudah dicatat. Bagian atomik (write status/audit/emit) = fungsi SQL `sm_transition`,
  BUKAN diimplementasi di TS.
- Setiap deviasi baru dari PRD → entri `docs/DECISIONS.md` (jangan pilih diam-diam).
- **Docker daemon tidak tersedia** di environment sesi ini — untuk validasi DB pakai
  resep PostgreSQL-16-lokal di §4 (bukan `supabase start`, yang butuh Docker).

## 7. Riwayat commit branch ini (di atas merge #29)

- `6887a63` feat(fase0): port core engines Go → TypeScript di packages/core + vitest
- `ac34fc7` ci(fase0): CI stack baru (vitest core-engines) + pgTAP paritas DB
- (berikutnya) seed Alpha Digital + update handoff ini
