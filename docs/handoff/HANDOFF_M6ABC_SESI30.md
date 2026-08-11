# HANDOFF — Modul Interview ("Kelola Klien") Sesi 30 (titik mulai sesi berikutnya)

> Rantai: … → SESI28 (langkah 4–6, #137) → SESI29 (langkah 5/6 bagian 2, #138) →
> SESI30-langkah7 (UI "Kelola Klien", #139) → **SESI30 (ini — langkah 8+9, terbaru)**.
> Baca yang bernomor tertinggi lebih dulu; sesi sebelumnya hanya konteks sejarah.
>
> SESI30 menutup **langkah 8 (Blok D handoff)** dan **langkah 9 (fixture Alpha Digital)**.
> **Modul Interview kini SELESAI end-to-end (langkah 1–9).** Tak ada 🔶 tersisa.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch (persis, akhir sesi 30)

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **`main` HEAD sebelum sesi ini** | merge PR #139 (langkah 7 / UI Kelola Klien). |
| **Branch tugas sesi ini** | `claude/strategi-prefill-fixture-oo5ck3` — 1 commit di atas #139 (langkah 8+9). |
| **Mulai kerja berikut** | Kalau branch ini SUDAH merge: `git fetch origin main && git checkout -B <branch-baru> origin/main`. Kalau BELUM: lanjut di branch ini. JANGAN menumpuk di atas history yang sudah merge. |

### 0.1 Status modul Interview — **SELESAI (langkah 1–9)**

| # | Langkah | Status |
|---|---|---|
| 1–3 | Rekon / migrasi / core engine | ✅ #136 |
| 4 | `packages/db` executor | ✅ #137 |
| 5 | pg_cron reminder/SLA + eskalasi N=2 | ✅ #137 + #138 |
| 6 | `apps/api` + paritas 7-role | ✅ #137 + #138 |
| 7 | UI "Kelola Klien" + sidebar skoring live | ✅ #139 |
| 8 | **Blok D prefill + flag verdict Strategi** | ✅ **SESI30 (ini)** |
| 9 | **Seed fixture Alpha Digital + CI hijau** | ✅ **SESI30 (ini)** |

### 0.2 Posisi persis (akhir sesi 30)

| | |
|---|---|
| Migrasi | **87 berkas** (+ `20260811090000_strategi_interview_handoff.sql` — hanya ALTER kolom di `strategi`, nol tabel) |
| Gate CI (ci.yml + db-rebuild.sh) | tabel **104** · mesin **19** · event **44** · prefix **32** — **TIDAK BERUBAH** (langkah 8 menambah kolom, bukan tabel/mesin/event/prefix). Gate seed 10/12/4/1 juga tak berubah. |
| Test | core **210** (+8: `buildStrategiPrefill`) · db 40 · domain **1127** (+6: Blok D handoff) · api 344 — semua hijau lokal (PG16) |
| Typecheck | `@cdps/core\|db\|domain\|api` + web-internal bersih |
| Lint | `@cdps/api --max-warnings 0` bersih |
| Build | web-internal `next build` bersih (227 test hijau) |
| Invariant SQL | `ident`/`immutability`/`rls`/`auth_claims` **PASS** |
| Shape-parity | `StrategiWire` ↔ FE `web-internal/src/lib/strategi.ts::Strategi` hijau dengan 4 field baru |
| `KNOWN_GAPS` (route-parity) | tetap **kosong** |

### 0.3 DB lokal — WAJIB sebelum kerja DB/domain/api

Sandbox ini PG16 (CI = PG17, otoritas). Bootstrap yang dipakai sesi ini
(perhatikan: dir `$BASE` harus dimiliki user `postgres` — beda dari SESI29):
```bash
BASE=/tmp/cdpspg; PGBIN=/usr/lib/postgresql/16/bin
sudo rm -rf "$BASE"; sudo mkdir -p "$BASE"; sudo chown -R postgres:postgres "$BASE"; sudo chmod 777 "$BASE"
sudo -u postgres "$PGBIN/initdb" -D "$BASE/data" -U postgres --auth=trust
sudo -u postgres "$PGBIN/pg_ctl" -D "$BASE/data" -o "-p 5433 -k /tmp" -l "$BASE/server.log" start
psql -h 127.0.0.1 -p 5433 -U postgres -d postgres -c "create database cdps;"
# apply 87 migrasi urut (ls supabase/migrations/*.sql | sort), lalu seed.sql 2×.
npm install                       # node_modules TIDAK persist antar sesi
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cdps"
npm test -w @cdps/core ; npm test -w @cdps/db ; npm test -w @cdps/domain ; npm test -w @cdps/api
```
DB direklaim saat idle — kalau `psql` "Connection refused", start ulang pg_ctl,
drop+create cdps, apply ulang semua migrasi + seed.

## 1. Apa yang berubah sesi ini (langkah 8+9)

Detail penuh: `docs/DECISIONS.md` **2026-08-11** baris teratas (langkah 8+9).

**Langkah 8 — Blok D handoff ke Strategi.**
- **Migrasi** `20260811090000`: 4 kolom di `strategi` — `sumber` (`manual`\|`interview`),
  `interview_id` (FK→`interview`, RESTRICT), `interview_version` (beku), `blok_d_flags`
  (jsonb subset `<@` tiga flag). CHECK konsistensi provenance.
- **Domain** `packages/domain/src/strategi.ts`: `createStrategi(input.interviewId?)` →
  `resolveBlokDHandoff` (muat verdict + versi, flag dari **`handoffKeStrategi` core**,
  cek klien cocok). Provenance + flag di INSERT + audit `create`. `openRevision` menyalin
  keempat kolom maju. Interface `Strategi` + `StrategiRow` + `rowToStrategi` + wire + FE.
- **Core** `packages/core/src/interview.ts`: fungsi murni **`buildStrategiPrefill(answers)`**
  memproyeksikan jawaban Interview → field Strategi via `PREFILL_MAPPING`, **memfilter
  `isStrategiBaselineForbidden`** (Section B baseline tak pernah keluar).
- **Tes wajib LULUS:** (a) baseline numerik Section B tak pernah di-prefill (core +
  domain); (b) `tidak_siap` tetap membuka Strategi & membawa flag `sasaran_konservatif`
  + `hambatan_mendasar_tercatat`. Plus: manual→`sumber=manual`, klien-mismatch/not-found
  ditolak, provenance persisten setelah reload.

**Langkah 9 — fixture Alpha Digital.** `supabase/seed.sql` seksi 6 baru: 1 klien Alpha
Digital + 1 Interview `Selesai` + `interview_kualifikasi` growth_ready @ 100 (angka dari
fixture core "perfect client"). Idempoten (seed 2×). Gate seed CI tak berubah.

### Catatan mekanis / gotcha (BACA untuk kerja Strategi/Interview berikutnya)

1. **Prefill NILAI Section A belum ditulis ke kolom** — `buildStrategiPrefill` mengembalikan
   pasangan `{strategiField, value}` untuk dipakai FORM (AM meninjau + autosave). DB hanya
   menyimpan TAUTAN + FLAG. Field enum/child (A-2/A-4/A-11/A-12/A-14/A-15/A-16, C-7, E-4)
   **sengaja tidak** di-inject: kosakata Interview↔Strategi tidak PRD-spesifik 1:1, menyuntiknya
   = "mengarang" (CLAUDE.md). Kalau nanti form Strategi (backlog A-05…A-09) dibangun, ia yang
   memanggil `buildStrategiPrefill` + memetakan ke input form.
2. **Belum ada UI create-Strategi** — tidak ada halaman `strategi` di web-internal (form
   A-05…A-09 belum ada). Jadi `interviewId` belum benar-benar dikirim FE→API; jalur wire
   (`strategiHeaderFromWire` baca `interview_id`) sudah siap untuk saat form itu lahir.
   Tak ada tombol "Buka Strategi dari Interview" di halaman Kelola Klien — itu menunggu form.
3. **`blok_d_flags` advisory** — tidak ada gate, tidak ada UI badge yet. Panel Strategi
   nanti boleh menampilkannya (sudah di `StrategiWire`/FE type).
4. **Teardown tes** `strategi.test.ts` `afterEach` kini menghapus `interview` (di antara
   `strategi` dan `clients`) dengan `trg_flag_frozen` di-disable — Strategi FK→interview,
   interview FK→clients. Blok Blok-D `beforeAll` menanam employee `ZZ-AM`/`ZZ-SALES`
   (interview FK→employees), dibersihkan `afterAll`.

## 2. Tugas berikutnya (Modul Interview SELESAI — pilih dari backlog)
Modul Interview tidak punya langkah tersisa. Kandidat berikut (bukan urutan wajib):
- **Form Strategi A-05…A-09** (backlog M6A) — saat lahir, wire `interviewId` FE→API +
  panggil `buildStrategiPrefill` untuk pra-isi + tampilkan `blok_d_flags`.
- Sisa Wave 2/3 sesuai `docs/prd/CDPS_Build_Plan.md` §4.

## 3. Sumber kebenaran
- `docs/DECISIONS.md` 2026-08-11 baris teratas (langkah 8+9).
- `packages/core/src/interview.ts` — `PREFILL_MAPPING`, `handoffKeStrategi`,
  `STRATEGI_FLAG`, `isStrategiBaselineForbidden`, `buildStrategiPrefill`.
- `packages/domain/src/strategi.ts` — `createStrategi` (`interviewId`), `resolveBlokDHandoff`,
  `openRevision` (carry-forward).
- `supabase/migrations/20260811090000_strategi_interview_handoff.sql`.
- `supabase/seed.sql` seksi 6 (Alpha Digital interview fixture).
- `CLAUDE.md`, `docs/STATE_MACHINES.md`, `docs/DATA_MODEL.md`.
