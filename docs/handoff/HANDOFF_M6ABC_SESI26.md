# HANDOFF — M6A/M6B/M6C Sesi 26 (titik mulai sesi berikutnya)

> Rantai: … → SESI24 → SESI25 → **SESI26 (ini, terbaru)**. Baca yang bernomor
> tertinggi lebih dulu; sesi sebelumnya hanya konteks sejarah.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch (persis, akhir sesi 26)

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **`main` (default) HEAD** | `a1431f7` — Merge PR #133 (M6A closeout). |
| **Sesi ini menutup** | **#131 (B-11) MERGE**, **#132 (A-11 re-cut) MERGE**, **#133 (M6A closeout: J-4 + Section J + poles klien) MERGE**. **#115 CLOSED** (digantikan #132). |
| **PR terbuka** | **Tidak ada.** Semua sudah merge. |
| **Branch tugas** | `claude/lanjutkan-task-berikutnya-mlxb4q` sudah **== `main`** (semua PR merge). **Cabang BARU dari `main` untuk kerja berikut:** `git fetch origin main && git checkout -B <branch-baru> origin/main`. |

### 0.1 Status modul — **M6A + M6B + M6C = 100%**

| Modul | Status |
|---|---|
| **M6A Strategi** | ✅ 100% (A-00…A-13d + A-11 share link + **J-4 diff + Section J + poles `/s/{token}`**). |
| **M6B Plan** | ✅ 100% (B-00…B-11). |
| **M6C Plan Gate** | ✅ 100% (C-01…C-07 + B-10 Rule 6). |

Yang **bukan** fitur inti modul dan masih terbuka: **seam job Plan Satuan** (tugas
utama chat berikutnya, §2 di bawah), de-eskalasi row-close, emisi notif gate/Plan,
dan keputusan pemilik **O54** (re-tier katalog live).

### 0.2 Posisi persis (akhir sesi 26)

| | |
|---|---|
| Migrasi | **80 berkas** · gerbang tabel **92** · mesin **18** · `KNOWN_GAPS` kosong |
| Test | core **137** · domain **1101** (+1 skip) · api **344** · web-internal **191** — semua hijau |
| Typecheck | 5 paket bersih · eslint bersih · `next build` (web-internal) sukses |
| Migrasi baru sesi ini | **NOL** — J-4 turunan (dihitung saat baca, Rule 4) |

### 0.3 DB lokal — WAJIB, Postgres MATI SENDIRI

```bash
pg_ctlcluster 16 main start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""   # HANYA pertama kali
npm install
scripts/db-rebuild.sh --yes                 # 80 migrasi + seed + gate (92/18) + invariant
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  npx vitest run --root packages/domain      # full domain hijau
```

## 1. Apa yang berubah sesi ini (M6A DITUTUP)

Detail penuh: `docs/DECISIONS.md` **2026-08-11 (M6A DITUTUP)** + `M6ABC_BACKLOG.md`.

- **J-4 auto-diff** (`strategiDiff` di `packages/domain/src/strategi.ts`, TEPAT
  **sebelum** `checkCompleteness` — lihat catatan mekanis di bawah). Skalar
  presisi + ringkasan koleksi (keputusan pemilik). v1 → `adaPerbandingan=false`.
  **D-7 dikeluarkan** (tak dibawa `openRevision`).
- **`clientVisibleDiff`** — filter per-field X-16 WAJIB (defensif; J-4 internal-only
  per RA-7). Koleksi lintas-tier ditandai anggota paling ketat (resources→`F-5`).
- **`GET /api/v1/strategi/{id}/diff`** + `StrategiDiffWire`/`StrategiDiffEntryWire`
  (flat, ramah shape-parity). Terdaftar di `WIRE_TO_FE`.
- **Form Section J** (`web-internal/.../components/strategi/SectionJ.tsx`,
  read-only) — J-1/J-2/J-3/J-4. `WIRED` di `page.tsx` menambah `'J'` ⇒ toggle
  visibilitas J-1/J-4 (A-13d) kini **terjangkau**. `saveActive` tak punya cabang J.
- **`/s/{token}` dipoles** (`apps/api/src/app/s/[token]/route.ts`) — layout deck,
  teks panjang jadi blok, header MEA + footer rahasia. Nol perubahan kontrak data.

### ⚠️ Catatan mekanis (jangan diulang salah)
Blok J-4 SENGAJA ditaruh **sebelum** `checkCompleteness` di `strategi.ts`.
`apps/api/src/lib/gate-reachability.test.ts` memindai literal field-ID dari
`checkCompleteness` **ke EOF** dan menuntut tiap literal punya baris `DOORS`.
Literal diff (non-gate) di region itu = false positive. Kalau menambah kode
ber-literal-field-ID lagi, taruh **di atas** `checkCompleteness` atau di file lain.

## 2. TUGAS BERIKUTNYA — seam job Plan Satuan (yang "kurang")

**Konteks.** B-10 (Plan Satuan, M6C §7) sengaja menunda dua job (documented seam,
`plan.ts` ~2697): **generasi periode berjalan** + **sweep dormansi otomatis**. Jalur
tulisnya sudah ada; yang kurang adalah **pemicunya di `runPlanTick`**.

**Tempat kerja:** `packages/domain/src/plan.ts` — fungsi **`runPlanTick`** (line
~2664) kini menjalankan HANYA tiga sweep full-management: `sweepPeriodeTransitions`
(a) · `sweepBelumDieksekusi` (b) · `sweepRealisasiBelumLengkap` (c). Endpoint
sudah ada: `POST /api/v1/internal/plan/tick` (idempoten, ber-secret, aktor SISTEM).

### 2a. Sweep #1 — generasi periode berjalan Plan Satuan
Untuk tiap rantai `plan_satuan` **`Aktif`**, pastikan periode jendela
anniversary-month **saat ini** ada. Pola sudah lengkap:
- `anniversaryWindowContaining(cycleStart, today)` (plan.ts ~2764) → jendela kini.
- `openPlanSatuanPeriodeTx(...)` (plan.ts ~2793) → insert periode `Terjadwal`
  (lalu sweep (a) meng-`Aktif`-kannya saat jendela current).
- **Idempotensi:** lewati kalau periode jendela-kini sudah ada untuk klien itu.
- Tambah `periodeSatuanDibuat: string[]` ke `PlanTickResult` + panggil di
  `runPlanTick`. Tes: rantai Aktif tanpa periode current → satu periode dibuat;
  panggil dua kali → tak ada duplikat.

### 2b. Sweep #2 — dormansi otomatis (§10 job c)
Jalur tulis **sudah ada**: `markPlanSatuanDormant(sql, actor, clientId)` (menolak
selagi ada periode non-terminal, `MSG_...`). Yang kurang: pemicu "service terakhir
berakhir" di job. Kandidat kondisi grounded: rantai `Aktif` yang **nol periode
non-terminal** → `markPlanSatuanDormant`. Tambah `didormankan: string[]` ke result.

### ⚠️ KEPUTUSAN PEMILIK yang perlu ditanyakan dulu (contoh + rekomendasi)
**Sweep #1 dan #2 saling tarik.** Kalau #1 selalu menaruh periode current baru
untuk **setiap** rantai Aktif, rantai **tak pernah** punya "nol periode
non-terminal" ⇒ **tak pernah dorman**. Jadi #1 harus hanya menggeneralisasi
periode kalau rantai **masih punya service aktif**; kalau service terakhir habis,
#2 mendormankannya.

- **Contoh:** Klien A punya 1 service satuan (`ditentukan_am`). Periode 1 jalan,
  lalu service selesai/kontraknya berakhir. Bulan depan: apakah sistem (i) tetap
  bikin periode kosong tiap bulan selamanya, atau (ii) mendormankan rantai?
- **Pertanyaannya:** apa sinyal "rantai masih punya kerja aktif"? Kandidat:
  (a) ada `service_plan_gate` menunjuk rantai + service-nya masih aktif/kontrak
  berjalan; (b) hanya lihat periode non-terminal.
- **Rekomendasi:** **(a)** — #1 bikin periode berjalan HANYA jika rantai punya ≥1
  service aktif (via `service_plan_gate.plan_id` → service hidup); #2 mendormankan
  saat service aktif = 0 **dan** periode non-terminal habis. Ini menghindari
  "periode kosong abadi" dan memakai lifecycle service sebagai kebenaran, bukan
  menebak. **Catatan:** cek dulu apakah status "service aktif/berakhir" sudah ada
  di data (M6C `service_plan_gate` + service/contract) — kalau belum, itu sub-seam
  tersendiri dan #2 sementara bisa manual-only (AM memicu `markPlanSatuanDormant`),
  #1 tetap gated ke "punya periode non-terminal ATAU service aktif". **Tanyakan
  pemilik sebelum menulis** — pilihan ini menentukan kapan tagihan/kerja berhenti.

### 2c. Emisi notif (opsional, seam terpisah)
Katalog notif Plan sudah terdaftar (O59-b). Kalau job Plan Satuan perlu notif
(mis. "rantai didormankan"), itu ikut seam emisi notif gate/Plan — konfirmasi
katalog dulu, jangan karang event baru.

## 3. Open questions (detail `docs/DECISIONS.md` §Open)

| # | Inti | Status |
|---|---|---|
| O54 | Re-tier katalog live (33 entri) — usul, bukan keputusan | 🟡 butuh ratifikasi pemilik |
| X-19 | Sweep (b) pakai `status_baris='Rencana'`, bukan "tanpa Brief" | 🟡 tak blokir; ganti saat M7/M12 menautkan Brief↔baris |
| X-08 | `jam_live` manual? | 🟡 `gmv`-only sampai Hans |
| X-12 | Komponen KPI keterlambatan | 🟡 rumah di M14 |
| X-18 | Σ negative variance → deficit | 🟡 toggle P-F eksplisit bila diinginkan |

## 4. Perintah pertama chat baru

```bash
git fetch origin main && git checkout -B claude/plan-satuan-seam origin/main
pg_ctlcluster 16 main start && npm install && scripts/db-rebuild.sh --yes
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  npx vitest run --root packages/domain      # full domain hijau (baseline)
# lalu: seam job Plan Satuan (§2) — TANYAKAN keputusan §2b/§2c ke pemilik dulu.
```
