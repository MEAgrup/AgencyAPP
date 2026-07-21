# Handoff — Migrasi CDPS: Railway → Render + Supabase + Vercel

> Ringkasan sesi keputusan (2026-07-21) untuk dieksekusi di akun team lain.
> Tujuan: semua perubahan bisa dikerjakan dari **Claude Code** dengan terminal
> seminimal mungkin, lepas dari Railway. **Backend Go DIPERTAHANKAN.**

## 1. Konteks & masalah

- CDPS sekarang: backend **Go** (modular monolith, ~57k baris, 262 file, 16
  modul + 7 core engine) + frontend **Next.js** (`web-internal`) + **MySQL**,
  deploy di **Railway** (3 service). `web-client-portal` baru README (belum ada).
- Masalah Yohan: sulit melakukan perubahan; banyak yang harus dijalankan manual
  di terminal; Claude Code tidak bisa mengendalikan Railway.

## 2. Temuan kunci (menentukan semua keputusan)

- Yang **bisa dikendalikan Claude Code langsung**: **Supabase** (via MCP —
  **Postgres saja**) dan **GitHub** (push → auto-deploy, trigger & baca log Actions).
- **Tidak ada MCP** untuk Railway / Fly / Render / MySQL / PlanetScale.
- Lingkungan Claude Code hanya boleh keluar lewat **HTTPS proxy** → koneksi DB
  mentah (MySQL 3306 / Postgres 5432) **diblokir**. Maka satu-satunya DB yang
  bisa dikontrol penuh dari Claude Code = **Supabase Postgres** (lewat MCP HTTPS).
- Konsekuensi: host Go (Render/dll) dikendalikan **via push→auto-deploy**;
  DB dikendalikan **via Supabase MCP** (kalau sudah Postgres).

## 3. Keputusan yang diambil

| Keputusan | Pilihan | Alasan |
|---|---|---|
| Arah besar | **Opsi X — pertahankan Go**, otomatiskan deploy (BUKAN rewrite Supabase-native) | Perubahan paling sedikit, risiko rendah, logika & 86 test terjaga |
| Host backend Go | **Render** (bukan Fly.io) | Setup 100% browser, auto-deploy saat push, tanpa terminal |
| Database | **Supabase Postgres**, **buat project CDPS baru** (jangan pakai MSDPS/MCN yg ada) | Satu-satunya DB yg bisa dikontrol penuh dari Claude Code |
| Frontend | **Vercel** | Sudah siap (proxy `/api/v1` via `BACKEND_URL`), auto-deploy saat push |
| Supabase-native (buang Go) | **DITOLAK** untuk sekarang | Rewrite ~2–4 bulan, risiko tinggi di jalur uang/state machine |

> Catatan: perubahan stack (MySQL→Postgres) WAJIB dicatat di `docs/DECISIONS.md`
> saat dieksekusi (aturan CLAUDE.md).

## 4. Urutan eksekusi (WAJIB berurutan — ubah satu hal per langkah)

### Langkah 1 — Backend Go → Render (pakai MySQL Railway yg ada) ⬅ MULAI DI SINI
Tanpa perubahan kode. Config sudah ada: **`render.yaml`** (root repo).
Setup Anda (100% browser):
1. render.com → login GitHub → **New → Blueprint** → repo `MEAgrup/AgencyAPP`,
   pilih branch yg berisi `render.yaml`.
2. Render baca `render.yaml` → service `cdps-backend` → **Apply**.
3. Service → **Environment** → isi **`DATABASE_URL`** = connection string MySQL
   Railway yg sekarang (sementara; app menormalkan `mysql://…` otomatis).
4. Tunggu deploy (build `backend/Dockerfile`, migrasi jalan saat boot) → salin
   **URL publik**-nya. Verifikasi `GET /healthz` → `200`.

Hasil: deploy backend jadi **push-driven** (Claude push → Render auto-deploy).
Keterbatasan: log build Render tak terbaca dari Claude Code (andalkan `/healthz`).

### Langkah 2 — DB → Supabase Postgres (port; dikerjakan Claude, direview Anda)
Ini bagian terberat (~1–2 minggu). Ruang lingkup teknis:
- **Buat project Supabase "CDPS"** (biaya **$10/bln** per project di org ini;
  staging opsional +$10/bln atau pakai *branch* yg lebih murah). **Belum dibuat.**
- **Terjemahkan 37 migrasi** `backend/migrations/*.up.sql` MySQL → Postgres:
  - `AUTO_INCREMENT` → `GENERATED ALWAYS AS IDENTITY` (atau `bigserial`)
  - `DATETIME` / `DATETIME(3)` → `timestamptz`; `TINYINT(1)` → `boolean`
  - `ON UPDATE CURRENT_TIMESTAMP` → trigger `BEFORE UPDATE`
  - `` `backtick` `` → `"double quote"`; hapus `ENGINE=InnoDB DEFAULT CHARSET=…`
  - trigger immutability `SIGNAL SQLSTATE '45000'` → fungsi trigger PL/pgSQL
    `RAISE EXCEPTION` (audit_log & notifications append-only)
  - `JSON` → `jsonb`
- **Ganti driver Go** `github.com/go-sql-driver/mysql` → `jackc/pgx` (atau `lib/pq`):
  - placeholder `?` → `$1,$2,…` (~958 call-site `Query/Exec`)
  - `LastInsertId()` → `INSERT … RETURNING id` (10 file MySQL-isme)
  - sesuaikan `backend/internal/db/db.go` (normalisasi DSN → terima `postgres://`)
- **Update CI** `.github/workflows/ci.yml`: service `mysql:8.0` → `postgres:17`,
  sesuaikan env DSN. **Validasi test lewat CI** (86 file test) — bukan lokal,
  karena koneksi DB dari lingkungan Claude diblokir; loop = push → baca log CI → fix.
- **Migrasi diterapkan ke Supabase via MCP** (`apply_migration` / `execute_sql`);
  bisa pakai **branch DB** untuk uji aman sebelum ke project utama.
- Saat hijau: **flip `DATABASE_URL`** di Render ke connection string Supabase.
- Catat keputusan di `docs/DECISIONS.md`.

### Langkah 3 — Frontend → Vercel
- Vercel → import repo → root `web-internal` → set env **`BACKEND_URL`** =
  URL Render backend. Auto-deploy saat push. (Kode FE nyaris tanpa ubahan.)

Setelah Langkah 2 selesai → **Railway lepas total**; DB dikontrol penuh dari
Claude Code via Supabase MCP.

## 5. Sudah dikerjakan di sesi ini (branch `claude/cdps-supabase-migration-enh0gp`, PR #27 draft)

- `docs/SUPABASE_MIGRATION_ASSESSMENT.md` — analisis 3 jalur + estimasi.
- `render.yaml` — Render Blueprint untuk backend (reuse `backend/Dockerfile`).
- `docs/handoff/HANDOFF_MIGRASI_RENDER_SUPABASE.md` — dokumen ini.
- (Config Fly.io sempat dibuat lalu dihapus — diganti Render.)

## 6. Catatan penting untuk eksekusi di akun team lain

- **Supabase MCP** di sesi ini terotorisasi ke org `yohanagustian-del's Org`
  (`dpuhrnweghnmnklyonhf`). Project existing: MSDPS, MSDPS Staging, MCN MEA,
  MCN MEA Staging (semua ap-southeast-2). Di akun team lain, **otorisasi ulang
  Supabase MCP** dan **buat project CDPS** di org yg diinginkan.
- **GitHub**: pastikan sesi baru punya akses ke repo `MEAgrup/AgencyAPP`.
- **Kredensial (token Render, `DATABASE_URL`, dll.) tidak boleh dipegang Claude** —
  selalu diisi manual oleh manusia di dashboard (browser), sekali saja.
- Region Supabase = `ap-southeast-2` (Sydney); Render pilih region `singapore`
  (terdekat ke Indonesia). Pertimbangkan latency DB↔backend.
- Estimasi total: Langkah 1 ~hitungan menit setup; Langkah 2 ~1–2 minggu;
  Langkah 3 ~hitungan menit setup.
