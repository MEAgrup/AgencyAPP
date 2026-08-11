# HANDOFF — M6A/M6B/M6C Sesi 23 (titik mulai sesi berikutnya)

> Rantai: … → SESI21 → SESI22 → **SESI23 (ini, terbaru)**. Baca yang bernomor
> tertinggi lebih dulu; sesi sebelumnya hanya konteks sejarah.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch (persis, akhir sesi 22→23)

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **`main` (default)** | memuat **B-00…B-09 + M6A A-00…A-13d + X-17/O59-b (#127)**. PR #126 (B-08) & #127 (X-17/O59-b) **sudah merge**. |
| **Sesi ini mengerjakan** | **B-09 scheduled jobs — SELESAI**, + PR untuk itu. |
| **Branch B-09** | `claude/b-09-scheduled-jobs` — dicabang dari `origin/main` (post-#127). |
| **PR B-09** | **#___** (lihat GitHub) — base `main`. Merge saat hijau. |
| **PR MASIH TERBUKA (lama)** | **#115** — M6A A-11 (`/s/{token}`). **X-16 kini FINAL** ⇒ #115 tidak lagi terblokir tier; tinggal **diff J-4** (filter per-field) + review pemilik. |
| **Branch tugas berikutnya** | Setelah PR B-09 merge: `git fetch origin main && git checkout -B <branch-baru> origin/main`. |

### 0.1 DB lokal — WAJIB, Postgres MATI SENDIRI (sama seperti sebelumnya)

```bash
pg_ctlcluster 16 main start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""   # HANYA pertama kali
npm install
scripts/db-rebuild.sh --yes                 # 77 migrasi + seed + gate + invariant
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  npx vitest run --root packages/domain      # full domain hijau
```

### 0.2 Posisi persis (sesudah B-09)

| | |
|---|---|
| Migrasi | **77 berkas** (B-09 **nol migrasi**) · gerbang tabel **89** · prefix 31 · mesin 17 · event **34** · `CATALOG_VERSION` 4 |
| Test | domain `plan.test.ts` **+8** (B-09) · api **+4** (gerbang secret endpoint) · typecheck 4 paket bersih · `KNOWN_GAPS` kosong |
| Endpoint baru | `POST /api/v1/internal/plan/tick` — ber-secret `PLAN_TICK_SECRET` (header `x-plan-tick-secret`). **Tanpa FE caller** (cron eksternal satu-satunya klien). |
| Menggantung | Kode: **NOL**. Deploy: pasang cron eksternal + `PLAN_TICK_SECRET` (lihat §2). Arah tercatat: O60/O49/O48/O45/O47b. Open baru: **X-19**. |

## 1. Apa yang berubah sesi ini — B-09 scheduled jobs

Detail penuh: `docs/DECISIONS.md` **2026-08-11 (B-09)** + `docs/backlog/M6ABC_BACKLOG.md` (B-09).

- **NOL migrasi.** Sweep membaca kolom B-01; idempotensi lewat baris yang sudah
  dimodelkan (`plan_flag('belum_dieksekusi')` untuk (b); penanda `audit_log`
  `realisasi_belum_lengkap` untuk (c)); notif lewat `notify_emit` yang sudah ada.
- **`packages/domain/src/plan.ts`** — `runPlanTick(sql, today)` **murni terhadap
  jam** (tanggal WIB disuplai pemanggil, nol `Date.now()`), tiga sweep terekspor
  (`sweepPeriodeTransitions`, `sweepBelumDieksekusi`, `sweepRealisasiBelumLengkap`)
  + helper `midpointDate` + `PLAN_JOB_ACTOR_ID='SISTEM'`. Badan `activate`/
  `forceClose` diekstrak (`activatePlanPeriodeTx`/`forceClosePlanPeriodeTx`) supaya
  job & manusia menempuh jalur identik; job lewati hanya gerbang kepemilikan.
- **`apps/api/.../internal/plan/tick/route.ts`** — POST ber-secret. Secret tak
  diset ⇒ **tertutup**. Body opsional `{tanggal:"YYYY-MM-DD"}` override WIB.
- **Notif M6B kini BENAR-BENAR diemisikan** (katalog v2 sudah terdaftar — koreksi
  PA-8 sesi lalu). `plan_baris_belum_dieksekusi` & `plan_realisasi_belum_lengkap`
  ke AM + SPV.

## 2. Deploy B-09 (bukan kode — langkah rilis)

Endpoint sudah ada; yang perlu disetel di deploy:
1. **Set `PLAN_TICK_SECRET`** (env di Vercel `agency-app-api`) — token acak. Tanpa
   ini endpoint menolak semua (aman-default).
2. **Pasang cron eksternal** memanggil `POST https://<api-host>/api/v1/internal/plan/tick`
   dengan header `x-plan-tick-secret: <PLAN_TICK_SECRET>`, **17:00 UTC = 00:00 WIB**
   harian. Opsi: **Vercel Cron** (vercel.json `crons`) atau **GitHub Action** (schedule).
   Idempoten ⇒ aman jika terpanggil ganda.
3. (Opsional test) `POST` dengan body `{"tanggal":"YYYY-MM-DD"}` untuk backfill satu hari.

## 3. Tugas berikutnya (branch baru dari `main`)

M6B/M6C yang tersisa:
- **B-10** — Plan Satuan (M6C §7): `lingkup='klien'`, parent Service, `Di Luar
  Service`, review 4 field, **dormansi mesin #17** (ditunda dari B-01). Besar tapi
  mandiri; **menutup Rule 6 M6C**.
- **B-11** — constraint integritas §4(b): partial unique index (satu service ⇒ ≤1
  Plan; service full-management tak boleh menunjuk Plan `lingkup='klien'`). Kecil.

M6A:
- **A-11** (#115) — tinggal **diff J-4** (X-16: generator diff WAJIB filter
  per-field) + review pemilik. X-16 sudah FINAL.

Arah teknis tercatat (PR fokus masing-masing): **O60 · O49 · O48 · O45 · O47b**.

## 4. Open questions (detail `docs/DECISIONS.md` §Open)

| # | Inti | Status |
|---|---|---|
| **X-19 (BARU)** | Sweep (b) memakai `status_baris='Rencana'`, bukan "tanpa Brief" (tautan Brief↔baris M7/M12 belum ada) | 🟡 Tak blokir B-09; ganti = 1 predikat saat M7/M12 menautkan Brief |
| X-16 | Tier 6 field §4.1 | ✅ FINAL — buka A-11 |
| X-08 | `jam_live` manual? | 🟡 `gmv`-only sampai Hans |
| X-12 | Komponen KPI keterlambatan | 🟡 rumah di M14; B-09 hanya audit/notif |
| X-11 | D-3 turunan (provisional) | 🟡 tinjau QC produksi |

## 5. Perintah pertama chat baru

```bash
pg_ctlcluster 16 main start && npm install && scripts/db-rebuild.sh --yes
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  npx vitest run --root packages/domain      # full domain hijau
# lalu: B-10 (Plan Satuan, menutup M6C) atau B-11 (kecil), branch baru dari origin/main.
```
