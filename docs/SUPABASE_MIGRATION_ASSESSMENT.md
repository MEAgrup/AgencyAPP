# CDPS — Penilaian Kelayakan Migrasi ke Supabase + Vercel

> Dokumen analisis (bukan keputusan). Menjawab: (1) apakah semua code yang ada
> bisa dipakai untuk menjalankan CDPS di Supabase, (2) perkiraan waktu, (3)
> apakah PRD/logic/build plan/materi yang sudah ada bisa mempercepat.
> Tanggal: 2026-07-21. Penulis: sesi build (untuk keputusan Yohan/Nerissa).

## 0. Ringkasan eksekutif (TL;DR)

- **"Menjalankan semua code Go yang ada DI DALAM Supabase" — tidak bisa.**
  Supabase bukan host untuk aplikasi Go long-running. Supabase = Postgres +
  Auth + Storage + Realtime + Edge Functions (Deno/TypeScript). Backend Go kita
  (57.138 baris, 262 file, 16 modul + 7 core engine) tetap butuh host proses
  sendiri (Railway/Fly/Render) apa pun yang terjadi.
- **Yang realistis ada 3 jalur.** Rekomendasi: **Jalur A (lift DB ke Supabase
  Postgres, backend Go tetap jalan, frontend pindah ke Vercel)** — ±1–2 minggu,
  risiko rendah, semua logika bisnis & test terjaga. Ini memberi "rasa
  Supabase/Vercel" (DB browser, Auth/Storage/Realtime opsional, deploy FE
  1-klik) tanpa membuang aset terbesar kita.
- **Rewrite penuh ke Supabase-native (buang Go, pindah logika ke RLS + Postgres
  functions + Edge Functions)** = **2–4 bulan, risiko tinggi**, dan justru
  membuat house convention (state machine, audit immutable, money math) LEBIH
  sulit diubah, bukan lebih mudah.
- **PRD / STATE_MACHINES / DATA_MODEL / Build Plan / 86 file test = aset paling
  berharga dan 100% bisa dipindahkan apa adanya.** Mereka platform-agnostic dan
  merupakan pempercepat terbesar untuk jalur mana pun.

## 1. Kondisi aktual (hasil baca repo)

| Bagian | Isi | Catatan migrasi |
|---|---|---|
| Backend Go | Modular monolith, 262 file, ~57k baris, 16 modul + core engine (statemachine 718 baris, money 310, ident 290, notification 363, audit 206, permission 147) | Semua enforcement house convention ada di sini |
| API | ~196 route `/api/v1/*`, auth lokal (session/cookie/token di Go) | Kontrak API sudah stabil |
| DB | MySQL, 37 migrasi, sintaks MySQL (`AUTO_INCREMENT`, `ENGINE=`, `TINYINT`, `DATETIME`, `` `backtick` ``, `ON UPDATE CURRENT_TIMESTAMP`) | Supabase = Postgres → butuh terjemahan dialek |
| SQL di Go | ~958 call-site `Query/Exec`, placeholder gaya MySQL `= ?`, 10 file pakai MySQL-isme (`LAST_INSERT_ID`, dll.) | Titik kerja utama Jalur A |
| Frontend `web-internal` | Next.js standar, memanggil backend via proxy `/api/v1/*` → `BACKEND_URL` (`next.config.ts`), fetch wrapper `credentials: include` | **Sudah siap Vercel hampir tanpa ubahan** |
| `web-client-portal` | Baru README (belum dibangun) | Greenfield — bebas dibangun native Supabase |
| Deploy sekarang | Railway 3 service: backend (Docker), web-internal (Railpack), MySQL | — |
| Docs | 18 PRD, Build Plan, DATA_MODEL, STATE_MACHINES, DECISIONS, backlog, 86 file test | Platform-agnostic |

**Akar masalah "sulit diubah" bukan Railway.** Rasa sulit itu datang dari
konvensi ketat (semua status lewat transition engine, audit immutable, field
auto-calc read-only, test-first untuk money & state). Pindah ke Supabase TIDAK
otomatis menghapus itu — kalau konvensi yang sama dipaksakan lewat RLS + trigger
Postgres, hasilnya justru lebih sulit ditest dan diubah daripada Go. Yang benar
memberi keleluasaan adalah: FE ke Vercel (deploy cepat) + DB Supabase (Studio,
migrasi, instant API untuk dashboard read-only) — bukan membuang backend Go.

## 2. Tiga jalur migrasi

### Jalur A — Lift & shift (REKOMENDASI): DB → Supabase Postgres, Go tetap, FE → Vercel
Backend Go tidak dibuang; hanya DB-nya diganti ke Supabase Postgres, dan
frontend pindah ke Vercel. Backend Go tetap di-host di Railway/Fly/Render.

Pekerjaan:
1. Terjemahkan 37 migrasi MySQL → Postgres (`AUTO_INCREMENT`→`GENERATED … IDENTITY`,
   `DATETIME`→`timestamptz`, `ON UPDATE CURRENT_TIMESTAMP`→trigger, backtick→`"`,
   `TINYINT(1)`→`boolean`, tipe JSON).
2. Ganti driver `go-sql-driver/mysql` → `pgx`/`lib/pq`; ubah placeholder `?`→`$n`
   (958 call-site — sebagian besar mekanis; bisa dibantu query-builder tipis atau
   sed terarah + kompilasi ulang), tangani 10 file MySQL-isme (`LAST_INSERT_ID`
   → `RETURNING id`).
3. Jalankan 86 file test terhadap Postgres sebagai jaring pengaman.
4. FE `web-internal`: set `BACKEND_URL` ke URL backend → deploy Vercel (nyaris
   tanpa perubahan kode).
5. Opsional pakai fitur Supabase secara bertahap: Storage untuk asset kreatif,
   Auth untuk portal, Realtime untuk board.

- **Waktu: ±1–2 minggu** (fokus, 1 dev) · **Risiko: rendah** · logika & test utuh.
- **Keterbatasan:** backend Go masih perlu host non-Supabase; "kemudahan ubah"
  yang didapat = Studio DB + deploy FE Vercel, bukan perubahan paradigma.

### Jalur B — Hibrida bertahap: A + adopsi selektif Supabase-native
Setelah Jalur A, pindahkan modul read-heavy tertentu (dashboard M13/M14,
notifikasi) ke PostgREST/Edge Functions + RLS, sementara jalur uang (M0/M4/M5)
& state machine tetap di Go. Portal klien dibangun native di atas Supabase Auth.

- **Waktu: ±3–5 minggu total** · **Risiko: sedang** · migrasi terkendali per-modul.

### Jalur C — Rewrite penuh Supabase-native (buang Go)
Semua logika direimplementasi sebagai Postgres function/trigger (PL/pgSQL) + RLS
+ Edge Functions (TypeScript), Auth via Supabase. 57k baris Go ditulis ulang.

- **Waktu: ±2–4 bulan** · **Risiko: TINGGI.**
- Money math, transition engine, audit immutable, permission matrix berlapis
  (OD/Director), pesan BI verbatim, dan render `—` untuk div-by-zero **sulit
  ditegakkan murni di RLS/PostgREST** — butuh banyak PL/pgSQL + Edge Functions.
- 86 file test Go tidak jalan langsung; jadi oracle acuan, harus ditulis ulang.
- Menyalahi "do not change stack without a logged decision" (CLAUDE.md) → wajib
  entri `DECISIONS.md` + persetujuan.

## 3. Apa yang bisa "dipindahkan apa adanya" (materi eksisting)

| Aset | Jalur A | Jalur C (rewrite) |
|---|---|---|
| 18 PRD, Build Plan, DATA_MODEL, STATE_MACHINES, DECISIONS, backlog | ✅ 100% dipakai ulang (spec = sumber kebenaran) | ✅ 100% — **pemercepat terbesar**; spec sudah jadi |
| 37 skema migrasi DB | ✅ Terjemah mekanis MySQL→PG | ✅ Jadi acuan skema |
| Frontend `web-internal` (Next.js) | ✅ Nyaris tanpa ubahan → Vercel | ⚠️ Perlu ganti pemanggil API/Auth |
| 86 file test Go | ✅ Dipakai ulang sbg jaring pengaman | ⚠️ Jadi oracle, ditulis ulang di TS/PL |
| 57k baris engine + handler Go | ✅ Tetap dipakai | ❌ Dibuang/ditulis ulang |

**Kesimpulan poin 3:** PRD + logic + build plan **jelas mempercepat** — karena
spesifikasi dan state machine sudah lengkap dan berlabel BI, siapa pun (Go atau
Supabase) tinggal mengimplementasi, bukan mendesain ulang. Untuk Jalur A, bahkan
kode Go & test ikut terpakai; hanya lapisan DB yang disentuh.

## 4. Rekomendasi

1. **Ambil Jalur A** sebagai default: pindahkan DB ke Supabase Postgres +
   deploy `web-internal` ke Vercel. Cepat, murah, aman, langsung memberi DX
   Supabase (Studio, migrasi, instant API) & Vercel (deploy FE).
2. **Bangun `web-client-portal` (M15) langsung native Supabase** (Auth + RLS +
   allow-list) — ini greenfield, cocok jadi pilot Supabase-native tanpa risiko
   ke jalur uang.
3. **Tahan Jalur C** kecuali ada alasan kuat; kalau diambil, wajib bertahap
   (Jalur B) dengan 86 test Go sebagai oracle, dan dicatat di `DECISIONS.md`.

> Keputusan stack tidak boleh diubah tanpa entri di `docs/DECISIONS.md`
> (CLAUDE.md §"Stack & architecture"). Dokumen ini bahan untuk keputusan itu,
> bukan keputusannya.
