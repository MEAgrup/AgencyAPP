# HANDOFF — Modul Interview ("Kelola Klien" tab 1) Sesi 27 (titik mulai sesi berikutnya)

> Rantai: … → SESI25 → SESI26 (M6A/B/C ditutup) → **SESI27 (ini, terbaru)**.
> Baca yang bernomor tertinggi lebih dulu; sesi sebelumnya hanya konteks sejarah.
>
> SESI27 memulai **modul BARU** (Interview / Kualifikasi Klien), bukan M6A/B/C.
> M6A+M6B+M6C tetap 100% (lihat SESI26).

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch (persis, akhir sesi 27)

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **`main` (default) HEAD sebelum sesi ini** | `cdcf470` — Merge PR #134 (SESI26 / M6A closeout). |
| **Sesi ini** | Membuka **PR #136** (`feat(interview): fondasi Modul Interview`) dari branch `claude/cdps-kelola-klien-verdict-1f230e`. **Setelah #136 MERGE, `main` HEAD = merge commit #136.** |
| **PR terbuka** | **#136** (fondasi Interview — langkah 2 & 3 dari 9). |
| **Branch tugas** | `claude/cdps-kelola-klien-verdict-1f230e`. **PR #136 sudah/akan merge → mulai kerja berikut dari `main` yang SUDAH memuat #136:** `git fetch origin main && git checkout -B <branch-baru> origin/main`. JANGAN menumpuk commit baru di atas history yang sudah merge. |

### 0.1 Status modul Interview — **fondasi selesai, 6 langkah tersisa**

Spesifikasi modul: prompt "Interview + Kualifikasi Klien" (verdict **advisory,
non-blocking** — versi final). Rencana 9 langkah; **langkah 2 & 3 SELESAI** di #136.

| # | Langkah | Status |
|---|---|---|
| 1 | Rekon repo + laporan temuan | ✅ (deviasi baseline dicatat DECISIONS 2026-08-11) |
| 2 | Migrasi Interview + katalog notif v5 | ✅ (#136) |
| 3 | `packages/core` engine skoring + verdict | ✅ (#136, 67 tes) |
| 4 | `packages/db` executor + tes | ⬜ **tugas utama berikutnya** |
| 5 | pg_cron reminder/SLA (idempotent) | ⬜ |
| 6 | `apps/api` route handler + paritas 7-role | ⬜ |
| 7 | UI "Kelola Klien" + sidebar skoring live (desktop-first) | ⬜ (terbesar) |
| 8 | Blok D prefill + flag verdict di Strategi | ⬜ |
| 9 | Seed fixture Alpha Digital + CI hijau | ⬜ |

### 0.2 Posisi persis (akhir sesi 27, setelah #136)

| | |
|---|---|
| Migrasi | **82 berkas** (80 + `20260811020000_notif_catalog_v5_interview` + `20260811030000_interview`) |
| Gate CI (ci.yml + db-rebuild.sh) | tabel **103** · mesin **19** · event **43** · prefix **32** · catalog v1 tetap **17** |
| Test | core **205** (+67 interview) · db **15** · domain **1101** (+1 skip) · api **344** (+7 skip) — semua hijau lokal (PG16) |
| Typecheck/lint | `@cdps/core|db|domain|api` bersih · eslint api bersih |
| `KNOWN_GAPS` (route-parity) | tetap **kosong** (belum ada route interview di web-internal) |

### 0.3 DB lokal — WAJIB sebelum kerja DB/domain/api

```bash
# Sandbox ini: Postgres 16 (bukan cluster CI PG17 — cukup untuk validasi).
# Jalankan sebagai user `postgres` (pg_ctl menolak root):
BASE=/tmp/cdpspg; rm -rf $BASE; mkdir -p $BASE; chown -R postgres:postgres $BASE
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $BASE/data -U postgres --auth=trust"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $BASE/data -o '-p 5433 -k $BASE -c listen_addresses=127.0.0.1' start"
su postgres -c "/usr/lib/postgresql/16/bin/psql -h 127.0.0.1 -p 5433 -U postgres -c 'create database cdps;'"
# apply 82 migrasi urut (as postgres, dari salinan yang bisa dibaca postgres):
#   for f in $(ls supabase/migrations/*.sql | sort); do psql ... -f "$f"; done
# lalu: seed x2, invariant SQL (supabase/tests/*.sql), gate hitungan.
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cdps" npm test -w @cdps/db
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cdps" npm test -w @cdps/domain
```
CI adalah otoritas (PG17). `scripts/db-rebuild.sh` mencerminkan gate `db-and-migrations`.

## 1. Apa yang berubah sesi ini (#136)

Detail penuh: `docs/DECISIONS.md` **2026-08-11 (Modul Interview — fondasi)**.

- **`packages/core/src/interview.ts`** — engine skoring MURNI, satu implementasi
  (dipanggil preview form & submit). `hitungKualifikasi()` (C-A…C-E, 100 poin),
  `hitungVerdict()` (presedensi deal-breaker cabang pertama, absolut, tanpa
  override), `resolveMargin()` (urutan klien→turunan→estimasi, `derivasiInput`
  reproducible), `hitungBepRoas()`, `kualitas_data`, grey zone, `KualifikasiConfig`
  (semua band = DATA, di-snapshot), `PREFILL_MAPPING` (tanpa Section B baseline),
  `handoffKeStrategi()` (non-blocking). Enum kanonik + `SCORED_FIELD_KEYS` +
  `HARD_INTERNAL_FIELD_KEYS` + `INTERVIEW_STATES`/`INTERVIEW_MACHINE`.
- **`interview.test.ts`** — 67 tes (batas 15/20/25/35, AOV 50k/80k/150k minor,
  SKU 3/9/29/30, rasio 2/3/5; 4 deal-breaker; 6 fixture; snapshot immutable).
- **`notification.ts` + `.test.ts`** — 9 event v5, `CATALOG_VERSION=5`, tes v5.
- **`ident.ts`** — prefix `ITV` (format rumah).
- **Migrasi** — lihat §0.2. `20260811030000_interview.sql`: 11 tabel + CHECK +
  mesin `interview` + RLS + seed. `20260811020000`: katalog v5.
- **`ci.yml` + `scripts/db-rebuild.sh`** — gate hitungan dinaikkan.

### Catatan mekanis / gotcha (BACA sebelum langkah 4–9)

1. **Verdict TIDAK memblok apa pun.** Jangan menambah gate Strategi berbasis
   verdict, enum routing, jalur reject, atau kolom override — spec versi final
   membuangnya. Ada tes yang harus dibuat (langkah 8): `tidak_siap` BISA membuat
   Strategi, dan Strategi itu membawa `sasaran_konservatif` + `hambatan_mendasar_tercatat`.
2. **Presedensi deal-breaker ditegakkan DB.** `ck_kualifikasi_dealbreaker`: baris
   dengan `hambatan_mendasar` tak-kosong & verdict ≠ `tidak_siap` DITOLAK. Tidak
   ada kolom override; jangan menambahnya.
3. **Field skor tak boleh kosong.** `ck_answer_scored_not_blank` mencerminkan
   `SCORED_FIELD_KEYS` di `packages/core`. Kalau menambah field skor, ubah KEDUANYA.
4. **RLS: Sales default-deny total** di tabel Interview (scope Account: assigned
   AM / Account-lead / OD / Director). Grant "verdict + prasyarat saja" untuk
   Sales (spec §Permissions) adalah **view aditif** yang harus dibuat di langkah 6
   — BUKAN pelonggaran policy tabel. Kriteria "breakdown/Blok B absen dari payload
   Sales" sudah terpenuhi oleh default-deny; view menambah verdict-only, jangan
   membuka answer/breakdown.
5. **Arm lead/divisi WAJIB in-line di policy** (detektor O48 `rls_checks.sql` §42
   sintaktik). Jangan sembunyikan di helper SECURITY DEFINER, atau tabelnya harus
   masuk ledger + entri DECISIONS. Kepemilikan assigned-AM ada di
   `jwt_owns_client_am` / `jwt_owns_interview_am` (SECURITY DEFINER), arm-nya inline.
6. **`kualifikasi_config` & `margin_deduksi_config` default-deny** (nol policy).
   Route handler (service-role) menyajikan ambang & Blok B9 ke form. Sengaja:
   Sales tak boleh reverse-engineer band; dan hindari menumbuhkan ledger O48.
7. **`margin_deduksi_config` PLACEHOLDER** (`is_placeholder=true`). Nilai riil
   dari Account. UI wajib menandai deduksi turunan berasal dari config, bukan klien.
8. **Money = minor units** (money.ts, ÷100 rupiah). AOV band di config = minor.
9. **Reminder cron (langkah 5)** idempotent lewat kolom di `interview_jadwal`
   (`pengingat_h1_pada`, `pengingat_hday_pada`, `overdue_emitted`,
   `overdue_escalated`, `butuh_data_nudge`, `terakhir_diproses`). Ganti IA-3 =
   RESET kolom itu (reminder MENGGANTI, tidak menumpuk). Semua SQL murni + pg_cron.
   Helper hari kerja SATU (SQL); libur nasional belum ditangani (Sabtu/Minggu saja).

## 2. Tugas berikutnya (urut; tiap langkah PR kecil)

**Langkah 4 — `packages/db` executor (mulai di sini).** Executor untuk:
create interview (mint ITV via `ident.nextId` di tx yang sama), upsert
`interview_answer`, persist scoring (`interview_kualifikasi` — jalur tulis
service-role; panggil `hitungKualifikasi` dari `packages/core`, simpan
`config_snapshot`), flags, outcome, version bump. Tes integrasi vs PG termigrasi
(gaya `packages/db/src/integration.test.ts`), termasuk: sanggahan append-only,
CHECK deal-breaker, field skor tak-kosong via jalur API langsung.

**Langkah 5 — pg_cron reminder/SLA** (migrasi baru; SQL murni; idempotent;
tes re-run-safety). H-1 08:00 & H-hari 07:00 WIB (UTC di cron, offset di satu
tempat), overdue harian maks 7 → eskalasi SPV, Butuh Data Klien tiap 3 hari maks
5, flag SLA (>3 wd unscheduled / >7 wd incomplete, skip Retroaktif), prasyarat
overdue `bersyarat` (jendela 60 hari). Semua via `notify_emit` + event v5.

**Langkah 6 — `apps/api` route handler + paritas 7-role.** Resolve actor →
validasi (pesan BI `[...]`) → panggil domain. Transisi via `sm_transition`.
`*ToWire` (snake_case) di `apps/api/src/lib/wire.ts` — kirim `null` eksplisit,
jangan `omitempty`. Tes: predikat TS == RLS untuk 7 role. View aditif verdict-only
untuk Sales. `route-parity.test.ts` `KNOWN_GAPS` tetap kosong.

**Langkah 7 — UI "Kelola Klien" + sidebar skoring live.** Interview = tab 1
default. Desktop-first (1440px, min 1280px; <1280px tampilkan notice). Section
B0–B11, progressive disclosure, autosave 20s pada Draft Isian, sidebar skoring
pinned (skor, per-blok, BEP ROAS, deal-breaker, verdict provisional — dari
`hitungKualifikasi` yang SAMA). Print view internal + print view klien
(prasyarat saja, skor/verdict dibuang). **Pelajari primitif form `web-internal`
dulu** — jangan menambah library form baru.

**Langkah 8 — Blok D prefill + flag verdict Strategi.** Tambah kolom prefill
(`sumber`,`interview_id`,`interview_version`) ke tabel Strategi yang relevan +
flag lemah (`sasaran_konservatif`/`hambatan_mendasar_tercatat`/`risiko_tinggi`).
Tes: (a) Section B numeric baseline TAK PERNAH di-prefill; (b) `tidak_siap`
membuat Strategi & Strategi membawa flag. Pakai `PREFILL_MAPPING` +
`handoffKeStrategi` dari core. **Tanpa gate verdict.**

**Langkah 9 — seed fixture + CI hijau.** Perluas `supabase/seed.sql` (Alpha
Digital) dengan 1 interview + kualifikasi (idempotent). Naikkan gate hitungan
seed jika perlu. Semua CI hijau.

## 3. Sumber kebenaran
- Prompt spesifikasi Interview (versi final: verdict advisory non-blocking).
- `docs/DECISIONS.md` 2026-08-11 (Modul Interview — fondasi): 6 keputusan.
- `packages/core/src/interview.ts` = kontrak skoring (satu implementasi).
- `CLAUDE.md`, `PERMISSIONS.md`, `docs/STATE_MACHINES.md`, `docs/DATA_MODEL.md`.
