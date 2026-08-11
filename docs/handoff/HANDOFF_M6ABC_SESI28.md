# HANDOFF — Modul Interview ("Kelola Klien") Sesi 28 (titik mulai sesi berikutnya)

> Rantai: … → SESI26 (M6A/B/C ditutup) → SESI27 (fondasi Interview, #136) → **SESI28 (ini, terbaru)**.
> Baca yang bernomor tertinggi lebih dulu; sesi sebelumnya hanya konteks sejarah.
>
> SESI28 menutup **langkah 4, 5, 6** dari 9 Modul Interview. Fondasi (langkah 1–3)
> ada di SESI27/#136. **Langkah 7–9 tersisa** dan dispesifikasi penuh di §2.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch (persis, akhir sesi 28)

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **`main` HEAD sebelum sesi ini** | `03c95d2` — Merge PR #136 (SESI27 / fondasi Interview). |
| **Sesi ini** | **PR #137** (`feat(interview): Modul Interview langkah 4–6`) dari branch `claude/handoff-m6abc-sesi27-0kj1ij`, **3 commit**: `af7d37b` (langkah 4), `95da482` (langkah 5), `95c0dd3` (langkah 6). **Setelah #137 MERGE, `main` HEAD = merge commit #137.** |
| **Branch tugas** | `claude/handoff-m6abc-sesi27-0kj1ij` — SUDAH merge lewat #137. **Mulai kerja berikut dari `main` yang memuat #137:** `git fetch origin main && git checkout -B <branch-baru> origin/main`. JANGAN menumpuk di atas history yang sudah merge. |

### 0.1 Status modul Interview — **langkah 4–6 selesai, 3 langkah tersisa**

| # | Langkah | Status |
|---|---|---|
| 1 | Rekon repo + laporan | ✅ SESI27 |
| 2 | Migrasi Interview + katalog notif v5 | ✅ #136 |
| 3 | `packages/core` engine skoring + verdict | ✅ #136 (67 tes) |
| 4 | `packages/db` executor + tes | ✅ #137 (`af7d37b`, +14 tes) |
| 5 | pg_cron reminder/SLA (idempotent) | ✅ #137 (`95da482`, +8 tes) |
| 6 | `apps/api` route handler + paritas 7-role | ✅ #137 (`95c0dd3`, +20 tes) |
| 7 | UI "Kelola Klien" + sidebar skoring live (desktop-first) | ⬜ **tugas utama berikutnya (terbesar)** |
| 8 | Blok D prefill + flag verdict di Strategi | ⬜ |
| 9 | Seed fixture Alpha Digital + CI hijau | ⬜ |

### 0.2 Posisi persis (akhir sesi 28, setelah #137)

| | |
|---|---|
| Migrasi | **84 berkas** (82 + `20260811040000_interview_cron` + `20260811050000_interview_verdict_view`) |
| Gate CI (ci.yml + db-rebuild.sh) | tabel **103** · mesin **19** · event **43** · prefix **32** · catalog v1 tetap **17** — **tak berubah** sejak #136 (view ≠ BASE TABLE; langkah 5/6 nol objek gate) |
| Test | core **205** · db **37** (+14+8) · domain **1121** (+20) · api **344** — semua hijau lokal (PG16) |
| Typecheck/lint | `@cdps/core\|db\|domain\|api` + `web-internal` bersih · eslint api bersih |
| Invariant SQL | `auth_claims`/`ident`/`immutability`/`rls_checks` (O48) PASS |
| `KNOWN_GAPS` (route-parity) | tetap **kosong** (belum ada panggilan web-internal — itu langkah 7) |

### 0.3 DB lokal — WAJIB sebelum kerja DB/domain/api

Sandbox ini PG16 (CI = PG17, otoritas). Skrip bootstrap dipakai sesi ini ada di
scratchpad; intinya (jalankan sebagai user `postgres`, pg_ctl menolak root):
```bash
BASE=/tmp/cdpspg; PGBIN=/usr/lib/postgresql/16/bin
# init sekali, start, createdb cdps, lalu apply 84 migrasi urut + seed x2.
# DB direklaim saat idle — kalau psql "Connection refused", start ulang pg_ctl,
# drop+create cdps, apply ulang semua migrasi (urutan berkas = urutan apply).
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cdps" npm test -w @cdps/db
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cdps" npm test -w @cdps/domain
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cdps" npm test -w @cdps/api
```
`scripts/db-rebuild.sh` mencerminkan gate `db-and-migrations`. **`npm install` dulu** —
node_modules tidak persist antar sesi.

## 1. Apa yang berubah sesi ini (#137)

Detail penuh: `docs/DECISIONS.md` **2026-08-11** tiga entri (langkah 5, langkah 6,
dan fondasi dari SESI27).

- **Langkah 4 — `packages/db/src/interview.ts`** — executor terikat-tx: `createInterview`
  (mint ITV via `ident.nextId`, lineage re-interview), `upsertAnswer`, `loadKualifikasiConfig`
  + boundary jsonb (AOV minor-unit↔bigint), `persistKualifikasi` (jalur tulis skor SATU-satunya,
  panggil `hitungKualifikasi` core, simpan `config_snapshot`), `appendSanggahan`, `insertFlag`,
  `recordOutcome`, `snapshotVersion`. Tes `interview.integration.test.ts` (14).
- **Langkah 5 — `supabase/migrations/20260811040000_interview_cron.sql`** — fungsi SQL murni
  `interview_working_days_between`, `interview_reminder_tick(kind, now)`, `interview_daily_tick(now)`;
  trigger `trg_jadwal_reset_pengingat`; penjadwalan pg_cron **DIBUNGKUS GUARD** `pg_available_extensions`.
  Tes `interview.cron.integration.test.ts` (8, memutar kalender manual).
- **Langkah 6 — `packages/domain/src/interview.ts`** (+ `apps/api` 7 route, `wire.ts`,
  `web-internal/src/lib/interview.ts`, view `20260811050000_interview_verdict_view.sql`).
  Tes `interview.test.ts` (5) + `interview.rls.test.ts` (15).

### Catatan mekanis / gotcha (BACA sebelum langkah 7–9)

1. **Jalur baca produksi = `db()` service-role + predikat TS** (pola `getStrategi`), RLS
   sebagai kunci kedua yang diverifikasi setara (`interview.rls.test.ts`). Untuk UI langkah 7:
   panggil route `apps/api` yang sudah ada — JANGAN membuat jalur baca baru.
2. **`interview_verdict` (view) = permukaan Sales verdict-only.** Route `GET /interview/{id}/verdict`
   sudah menyajikannya. Print view klien (langkah 7) HANYA prasyarat — skor/verdict DIBUANG
   (bukan sekadar verdict-only; klien tak lihat verdict sama sekali). Jangan bocorkan Blok C.
3. **Verdict TIDAK memblok apa pun.** Langkah 8: `tidak_siap` TETAP boleh bikin Strategi;
   Strategi bawa flag (`sasaran_konservatif`/`hambatan_mendasar_tercatat`/`risiko_tinggi`).
   Pakai `PREFILL_MAPPING` + `handoffKeStrategi` dari `packages/core`. **Tanpa gate verdict.**
4. **`route-parity` `KNOWN_GAPS` harus tetap kosong.** Begitu langkah 7 menambah `fetch` di
   web-internal ke path interview, path itu WAJIB dilayani `apps/api` (sudah ada 7 route:
   `POST /interview`, `GET /interview/{id}`, `GET …/verdict`, `PUT …/answers`, `POST …/score`,
   `PUT …/jadwal`, `POST …/transition`). Kalau UI butuh path lain (mis. list), tambah route-nya
   di commit yang sama.
5. **shape-parity: tiap `*Wire` baru WAJIB terdaftar** di `WIRE_TO_FE` + tipe FE di
   `web-internal/src/lib/*.ts` (+ `FE_FILES`). Tipe FE Interview sudah ada di
   `web-internal/src/lib/interview.ts` — pakai itu di UI langkah 7.
6. **Sidebar skoring live (langkah 7)** memakai `hitungKualifikasi` core yang SAMA (preview =
   submit). JANGAN reimplement skor di FE — panggil `POST /interview/{id}/score` atau porting
   pure `hitungKualifikasi` ke FE dari `@cdps/core` (satu implementasi).
7. **`interviewScoreFromWire` (wire.ts)** sudah memetakan body → `KualifikasiInput` (money =
   string minor-unit → bigint, enum = kode kanonik). UI kirim shape itu ke `/score`.
8. **Money = minor units**; format `Rp. X.XXX.XXX,00`; div-by-zero → `—` (BEP ROAS sudah begitu).

### 🔶 Dua interpretasi menunggu konfirmasi pemilik (dicatat DECISIONS 2026-08-11)

- **Ambang flag prasyarat `bersyarat`** (langkah 5): dipakai anchor `dihitung_pada` + jendela
  `[7,60]` hari kalender, advisory flag-only. Koreksi fungsi `interview_daily_tick` bila spec beda.
- **Scope Sales pada verdict-view** (langkah 6): dipakai *sales closing* ATAU *Sales lead*
  (cermin `sales.ts`). Ubah view `interview_verdict` + `canReadVerdict` bila maksudnya Sales luas.

## 2. Tugas berikutnya (urut; tiap langkah PR kecil)

**Langkah 7 — UI "Kelola Klien" + sidebar skoring live (TERBESAR).** Interview = tab 1
default. Desktop-first (1440px, min 1280px; <1280px tampilkan notice). Section B0–B11,
progressive disclosure, autosave 20s pada Draft Isian (`PUT /interview/{id}/answers`),
sidebar skoring pinned (skor, per-blok, BEP ROAS, deal-breaker, verdict provisional — dari
`hitungKualifikasi` yang SAMA). Print view internal + print view klien (**prasyarat saja**,
skor/verdict dibuang). **Pelajari primitif form `web-internal` dulu** (mis. `strategi-sections`)
— jangan menambah library form baru. Route API + tipe FE sudah siap (§Gotcha 4–5).

**Langkah 8 — Blok D prefill + flag verdict Strategi.** Tambah kolom prefill
(`sumber`,`interview_id`,`interview_version`) ke tabel Strategi relevan + flag lemah
(`sasaran_konservatif`/`hambatan_mendasar_tercatat`/`risiko_tinggi`). Tes: (a) Section B numeric
baseline TAK PERNAH di-prefill (`STRATEGI_BASELINE_FORBIDDEN_PREFILL`); (b) `tidak_siap` membuat
Strategi & Strategi membawa flag. Pakai `PREFILL_MAPPING` + `handoffKeStrategi` dari core.
**Tanpa gate verdict.**

**Langkah 9 — seed fixture + CI hijau.** Perluas `supabase/seed.sql` (Alpha Digital) dengan 1
interview + kualifikasi (idempotent, seed dijalankan 2×). Naikkan gate hitungan seed bila perlu.
Semua CI hijau.

## 3. Sumber kebenaran
- Prompt spesifikasi Interview (versi final: verdict advisory non-blocking) — di luar repo.
- `docs/DECISIONS.md` 2026-08-11 (tiga entri Interview).
- `packages/core/src/interview.ts` = kontrak skoring (satu implementasi).
- `packages/domain/src/interview.ts` = domain (izin + orkestrasi).
- `packages/db/src/interview.ts` = persistence executor.
- `CLAUDE.md`, `docs/STATE_MACHINES.md`, `docs/DATA_MODEL.md`.
