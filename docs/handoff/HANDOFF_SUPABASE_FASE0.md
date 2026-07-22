# HANDOFF — Migrasi Supabase/Vercel, Fase 0 (sesi 2026-07-22)

> Untuk sesi berikutnya. Baca ini bersama `docs/SUPABASE_MIGRATION_PLAN.md` (plan induk),
> `docs/SUPABASE_MIGRATION_TECH_APPENDIX.md` (konvensi teknis §A–§G), dan entri
> `docs/DECISIONS.md` 2026-07-22 (2 entri: keputusan migrasi + resolusi O36 ronde 2).
> Branch kerja: `claude/cdps-supabase-migration-plan-ypfwgx`.

## 1. Keputusan yang SUDAH final (jangan tanya ulang)

- **Arsitektur:** hybrid/strangler. Go+MySQL(Railway) DIBEKUKAN — tidak boleh diubah — sampai
  cutover big-bang; backend baru TypeScript Next.js API routes di Vercel; DB Supabase Postgres.
- **Auth:** Supabase Auth (GoTrue). Kredensial existing di-**import langsung** (hash bcrypt →
  `auth.users`), BUKAN reset paksa (OQ-3, keputusan pemilik). Wajib smoke-test login di staging.
- **HRIS:** endpoint `GET /employees` **tidak dipakai lagi** (OQ-4). Sumber data karyawan = import
  CSV/spreadsheet admin-triggered. `HRIS_API_CONTRACT.md` tidak diimplementasikan di stack baru.
- **Data:** masih UAT/seed (OQ-2) → migrasi data = re-seed/importer (cutover Opsi A). pgloader
  hanya cadangan terdokumentasi.
- **Layout:** API app TERPISAH `apps/api` (OQ-7); kode bersama `packages/core` + `packages/db`.
- **PIC gate:** Yohan & Nerissa berdua (OQ-1). Tanpa target biaya (OQ-6). Go diarsip read-only
  pasca-cutover (OQ-8).
- **Region Supabase: SINGAPORE `ap-southeast-1`** (arahan eksplisit pemilik, menimpa pola org lama
  yang Sydney).
- **OQ-5 masih open** (embeddability `mea-client-reporting` di Client Portal M15) — pemilik minta
  penjelasan; tidak blocking karena portal ditunda (O4/O5).

## 2. Kondisi infrastruktur saat handoff

- **Project Supabase aktif: `CDPS SG`** — ref **`egddxfcnrtecheiykhlf`**, region `ap-southeast-1`,
  Postgres 17, org `dpuhrnweghnmnklyonhf`. $10/bulan.
- ⚠️ **Project SALAH REGION yang harus DIHAPUS MANUAL oleh pemilik dari dashboard:** `CDPS`
  ref `klrmguatvzbmujihzacl` (Sydney `ap-southeast-2`, hanya berisi 1 migrasi foundation, tanpa
  data). API tidak bisa delete; pause ditolak (paid tier). Selama belum dihapus = biaya dobel
  $10/bulan. Setelah dihapus, project `CDPS SG` boleh di-rename jadi `CDPS` via dashboard.
- Project staging (`CDPS Staging`) BELUM dibuat — dijadwalkan saat dibutuhkan (pola org).
- Vercel BELUM disentuh sama sekali.

## 3. Yang sudah dikerjakan di repo (branch ini)

- `supabase/migrations/` — **28 file**: `20260101000000_pg_foundation.sql` (fungsi
  `set_updated_at`, `forbid_mutation`, `wib_date`, `wib_period` — WIB fixed-offset O20), port 1:1
  dari 26 migrasi MySQL `0001`–`0037` (49 tabel; trigger immutability `audit_log`/`notifications`/
  `client_health_snapshots`/`performance_snapshots`; `timestamptz(3)/(6)` presisi dipertahankan;
  IDENTITY; jsonb; komentar produk asli dipertahankan), dan `20260102000001_ident_next.sql`
  (fungsi `ident_next(prefix, at)` gap-free per prefix+period WIB, upsert `ON CONFLICT ... RETURNING`).
- `apps/api/` — scaffold Next.js API-only (versi Next/React/TS sama persis `web-internal`),
  endpoint contoh `GET /api/healthz`, `.env.example` berisi daftar env var (lihat Lampiran §E.3).
- `packages/core/` + `packages/db/` — stub (engine TS belum di-port). Belum ada root workspace
  tooling (sengaja, agar tidak menyentuh `web-internal`).
- Docs: plan + lampiran + inventaris + 2 entri DECISIONS + resolusi O36.
- **TIDAK ADA perubahan** di `backend/`, `web-internal/`, `web-client-portal/` (freeze dihormati).

## 4. Status apply migrasi ke `CDPS SG` (UPDATE DI SINI SEBELUM TUTUP SESI)

- ✅ **SELESAI (2026-07-22, diselesaikan orchestrator):** **SEMUA 28 migrasi sukses ter-apply**
  ke `CDPS SG` (`egddxfcnrtecheiykhlf`) tanpa satu pun error (19 pertama oleh eksekutor, 9 sisanya
  oleh orchestrator setelah eksekutor dihentikan sementara atas perintah pemilik).
- ✅ **Smoke test LULUS semua:**
  - `ident_next('CLI', now())` 2× → `CLI-202607-0001` lalu `CLI-202607-0002` (format & increment
    benar; periode WIB `202607`). Catatan: dua ID uji ini terkonsumsi di `id_sequences` dev —
    wajar, akan hilang saat `db reset`/re-seed.
  - `wib_period(now())` → `202607` ✓.
  - Immutability `audit_log`: UPDATE → error `P0001 audit_log is append-only/immutable: UPDATE
    forbidden`; DELETE → error serupa (`DELETE forbidden`). Keduanya terbukti via `forbid_mutation()`.
    Satu baris smoke (`entity_id='SMOKE-1'`) tertinggal permanen di `audit_log` dev — by design
    (append-only), hilang saat re-seed.
  - Jumlah tabel `public` = **49** — persis sesuai target inventaris.
- ✅ **Advisors (hasil sesuai ekspektasi Fase 0):**
  - Security: 49× ERROR `rls_disabled_in_public` + 1× `sensitive_columns_exposed`
    (`sessions.token`) — **EXPECTED**: RLS memang baru datang di Fase 1 (Lampiran §D). PENTING
    untuk Fase 1: aktifkan RLS di SEMUA tabel + pertimbangkan keluarkan tabel internal murni
    (`sessions`, `id_sequences`, `employee_credentials`) dari expose PostgREST. 5× WARN
    `function_search_path_mutable` (set_updated_at, forbid_mutation, wib_date, wib_period,
    ident_next) — perbaiki di migrasi berikutnya dengan `SET search_path = ''` per fungsi.
  - Performance: hanya INFO (3 FK tanpa index penutup: `client_platforms`,
    `negotiation_proposal_lines`, `payment_verifications`; "unused index" wajar di DB kosong;
    saran alokasi koneksi Auth persentase) — tidak ada blocker.
- Verifikasi cepat di sesi baru: `mcp__Supabase__list_migrations` project `egddxfcnrtecheiykhlf`
  = 28 entri.

## 5. Langkah berikutnya (urutan disarankan — sisa Fase 0 lalu Fase 1)

1. ~~Apply 28 migrasi + smoke test + advisors~~ ✅ SELESAI (lihat §4).
2. **Port core engines ke TypeScript** di `packages/core` (urutan disarankan: `money` + `tz`
   (murni, mudah), `bi-messages.ts` (konstanta string BI — kumpulkan dari DECISIONS + kode Go),
   `permission` (predikat murni), `statemachine` (baca `config.go` Go + `docs/STATE_MACHINES.md`),
   `ident` (wrapper pemanggil `ident_next`), `audit`, `notification`). Mirror test Go → vitest.
   Acuan: Lampiran §B, DoD di plan §8.
3. **Setup CI** (GitHub Actions): `supabase start` + apply migrasi + pgTAP (immutability, ident) +
   vitest. Acuan: Lampiran §G.
4. **Seed fixture Alpha Digital** → `supabase/seed.sql` (paritas dengan `backend/seed` +
   `backend/internal/seed`).
5. **Fase 1**: Supabase Auth (import bcrypt per OQ-3 — hati-hati kolom `auth.users`, verifikasi
   versi GoTrue; custom claims `app_metadata` via Access Token Hook per Lampiran §C.3), importer
   CSV karyawan (OQ-4), Master Service List admin, RLS baseline (Lampiran §D).
6. Vercel project untuk `apps/api` (env var dari `.env.example`; pooler 6543 `prepare:false`).

## 6. Peringatan penting untuk sesi berikutnya

- **House rules CLAUDE.md berlaku penuh di stack baru** — string BI `[...]` persis, katalog
  notifikasi FROZEN **15 event** (verifikasi di `backend/internal/core/notification/notification.go`),
  transisi hanya lewat engine, audit append-only, derived recomputable.
- Executor Sonnet menandai 3 hal butuh QC di port skema: (a) `creator_lists.included_bookings`
  tetap `text` (bukan jsonb) — cek intent source; (b) nama constraint eksplisit antar file —
  cek tidak bentrok; (c) seed tanggal `'0001-01-01'` di `perf_*` — valid tapi tidak umum.
- Jangan membuat root `package.json`/workspace yang menyentuh `web-internal` tanpa keputusan.
- Semua deviasi baru → entri `docs/DECISIONS.md` (jangan pilih diam-diam).

## 7. Riwayat commit sesi ini (branch `claude/cdps-supabase-migration-plan-ypfwgx`)

- `4467003` docs: plan migrasi (3 dokumen) + DECISIONS.
- `8dfc105` docs: resolusi O36 (konfirmasi pemilik ronde 2).
- `fbe4df7` feat(fase0): 28 migrasi Postgres + scaffold `apps/api` & `packages/`.
- (menyusul) update handoff ini + perbaikan file hasil proses apply, bila ada.
