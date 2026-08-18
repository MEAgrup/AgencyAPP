# HANDOFF — Riset Awal Baseline: **RAB-03 + RAB-04 + RAB-05 selesai, lanjut RAB-06** — Sesi 33

> Rantai: … → SESI31 (spek + keputusan pemilik) → SESI32 (RAB-01 skema + RAB-02 mesin, PR #173)
> → **SESI33 (ini, terbaru — RAB-03 kosakata + RAB-04 submit baseline + RAB-05 auto-fill)**.
> Baca yang bernomor tertinggi lebih dulu; SESI31 tetap sumber SPEK & KEPUTUSAN (jangan tanya ulang).
>
> **Status: RAB-03 + RAB-04 + RAB-05 SELESAI, teruji.** Berikutnya **RAB-06** (tutup kebocoran
> provenance skor) lalu **RAB-07** (gerbang prasyarat + tes anti-deadlock Shopee-only).

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch & PR

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch sesi ini** | `claude/store-mgmt-svc-handoff-16xfyt` |
| **PR RAB-03/04/05** | **#174** (judul awal "RAB-03"; badannya diperbarui ke RAB-03/04/05). |
| **PR RAB-01/02** | **#173** (branch `claude/store-mgmt-svc-handoff-morjwg`) — dependensi. |
| **Isi branch 16xfyt** | `82ba40b` (= head morjwg: docs+RAB-01+RAB-02) → `d0dea40` (RAB-03) → `<RAB-04/05>` |
| **Base saat kerja** | 16xfyt di-stack di atas `morjwg` (RAB-01/02 belum di `main`). |

⚠️ **Kenapa dua branch:** SESI32 mengerjakan RAB-01/02 di `morjwg` (PR #173, belum merge).
Branch tugas sesi ini (ditetapkan harness) = `16xfyt`, jadi 16xfyt **di-reset ke head morjwg**
supaya mewarisi RAB-01/02, lalu RAB-03/04/05 ditumpuk di atasnya. Diff PR #174 vs base `morjwg`
= hanya RAB-03/04/05.

**Cek status merge dulu sebelum lanjut RAB-06:**
- **Kalau #173 & #174 SUDAH merge ke `main`:** restart branch baru dari main —
  `git fetch origin main && git checkout -B <branch-baru> origin/main`, kerjakan RAB-06 → PR baru.
- **Kalau belum:** lanjut di `16xfyt` di atas commit RAB-04/05, atau branch baru dari 16xfyt.

### 0.1 Aturan main yang MASIH berlaku (SESI31 §0.2 — jangan dilanggar)
- **PRD boleh dikoreksi** di 5 titik Wave E (RAB-19) lewat `DECISIONS.md`.
- Migrasi HANYA lewat `supabase/migrations/**` + `apply_migration`. DB lokal HANYA lewat `scripts/db-rebuild.sh`.
- Tulis via service-role + gate domain; RLS memikul row-scope. Wire snake_case lewat `apps/api/src/lib/wire.ts`.
- **Mesin baseline jalan di SERVER, bukan browser** (klarifikasi sesi ini — lihat §1.4).

### 0.2 Setup DB lokal (kalau container baru)
```
pg_ctlcluster 16 main start
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" bash scripts/db-rebuild.sh --yes
```
⚠️ **Tes domain integration WAJIB serial** — jalankan lewat `npm run -w @cdps/domain test`
(config paket sudah `fileParallelism:false`). `npx vitest run packages/domain` dari ROOT
**mengabaikan** config itu dan membanjiri koneksi Postgres ⇒ ratusan failure PALSU.

---

## 1. Yang SUDAH selesai sesi ini (jangan ulang)

### 1.1 RAB-03 — pengaman kosakata + `belum_dapat_diukur`
- `packages/core/src/baseline/types.ts`: `ALL_KONDISI_TOKO` (5 nilai) + `COMPUTED_KONDISI_TOKO`
  (4 nilai yang bisa dihasilkan mesin) + penjaga exhaustiveness level-tipe (`_AssertNever`) —
  daftar runtime gagal-compile kalau tipe `KondisiToko` berubah.
- `packages/core/src/baseline/riset-awal-vocab.test.ts` (8 tes, membaca KEDUA enum dari sumbernya):
  irisan verdict Blok C ∩ Kondisi Toko = ∅ (dua arah); Kondisi Toko tak pernah kode HAMBATAN
  ⇒ tak bisa memicu `tidak_siap`; `belum_dapat_diukur` ⇒ nol TANTANGAN; analisa kosong turun ke
  `mesin_belum_terbangun` (≠ `belum_dapat_diukur`, §2.3).

### 1.2 RAB-04 — submit baseline per-platform + konfirmasi per angka
- **Domain** `packages/domain/src/riset-awal.ts` (diekspor `@cdps/domain` sebagai `risetAwal`):
  - `metodeForPlatform`: TikTok Shop=`analisa_penuh` · Tokopedia=`analisa_tipis` · sisanya=`manual`.
  - `submitBaseline`: satu baris `riset_awal_analisa` per **client_platforms AKTIF** (UNIQUE); tulis
    `riset_awal_sumber_berkas` (provenance sha256 + tipe terdeteksi) + `interview_riset_awal_isian`
    (auto-fill RAB-05, `dikonfirmasi=false`); submit ulang platform sama = `ConflictError`
    (append-only, re-analisa = baris baru butuh re-open); platform non-aktif/asing ditolak.
  - `confirmIsian`: membalik `dikonfirmasi` + koreksi nilai; `nilai_usulan` beku (keputusan 1).
  - `getBaseline`/`readBaseline`: read-model per interview; `semua_terkonfirmasi` = gerbang submit.
- **Rute** `apps/api/.../interview/[id]/baseline/route.ts` (GET+POST) + `.../baseline/confirm/route.ts` (POST).
- **Wire** `risetAwalBaselineToWire` di `wire.ts`; didaftarkan `shape-parity` (WIRE_TO_FE + FE_FILES).
- **FE** `web-internal/src/lib/riset-awal.ts`: `parseExportFile` (xlsx→AoA + sha256, satu-satunya
  langkah browser) + klien API (`getRisetAwalBaseline`/`submitBaselineAnalisa`/`submitBaselineManual`/
  `confirmBaselineIsian`). `xlsx@0.18.5` (pin, Apache-2.0 §5.1) ditambahkan ke `web-internal`.

### 1.3 RAB-05 — field terisi otomatis
`deriveIsianFromPayload`/`deriveIsianFromManual`: `toko.aov`→**B2-9** (money, ×100 minor units) ·
`produk.sku_total`→**B2-3** (count). ⚠️ `median_6m`/`runrate_3m`/`roas`/`arah_strategi` TETAP di
payload untuk baseline Strategi (RAB-11) — **bukan** isian interview. `median_6m`≠`B1-5` (§5.2).
`B3-3`/`B7-3` tetap pertanyaan interview (penilaian manusia).

### 1.4 ⛔ KLARIFIKASI ARSITEKTUR — mesin baseline jalan di SERVER
Sub-keputusan (d) SESI31 berbunyi "parsing di browser". Tapi `web-internal` adalah app Next
mandiri **tanpa `@cdps/core`** (`interview-scoring.ts:16`), jadi browser tak bisa menjalankan
mesin skor/`detect()` — menyalinnya = drift yang keputusan 4 larang. **Pembagian final:**
- **Browser:** parse xlsx → baris (AoA) + sha256 (`parseExportFile`), lalu POST.
- **Server (`packages/domain` → `@cdps/core`):** `readSheet`+`detect`+`runBaseline`; MEMILIKI skor +
  `benchmark_versi`+`parser_versi`+`generated_at` (di-stamp server, bukan jam browser).
  Ambiguitas toko-vs-afiliasi ⇒ error BI `[...]` sampai AM kirim `tipe_override`.

Ini memperkuat aturan #4 (skor otoritatif server) dan menutup separuh RAB-06 lebih awal.
Dicatat di `DECISIONS.md` 2026-08-18.

### 1.5 Verifikasi yang dijalankan
- core **248** hijau; domain riset (unit 6 + integration 8 + rls 32) hijau; **domain suite penuh
  hijau** (serial, `npm run -w @cdps/domain test`).
- typecheck core/domain/api/web-internal bersih; lint `@cdps/api` + FE `riset-awal.ts` bersih;
  `shape-parity` + `route-parity` (KNOWN_GAPS kosong) hijau.
- **NOL tabel/migrasi/mesin/prefix/event baru** ⇒ gate 118/35/23/57 TETAP (RAB-01 sudah menyiapkan skema).

---

## 2. BERIKUTNYA — RAB-06 dan seterusnya (`RISET_AWAL_BASELINE_BACKLOG.md`)

### RAB-06 · Tutup kebocoran provenance skor (tes TERPENTING di backlog)
`SCORED_FIELD_KEYS` **jangan disentuh** (15 kunci). `hitungKualifikasi` **nol perubahan**. Ubah
`scoreInterview` (`packages/domain/src/interview.ts:747`) + `POST …/score`: rakit `KualifikasiInput`
dari **kedua** tabel (`interview_answer` + `interview_riset_awal_isian` terkonfirmasi) dan
**abaikan** nilai kunci riset awal dari body. **DoD:** fixture Alpha Digital ⇒ skor + verdict Blok C
**IDENTIK** sebelum/sesudah; `POST …/score` yang mengirim angka beda untuk kunci riset awal diabaikan.
⚠️ Sebagian sudah tertutup: skor baseline sudah server-authoritative (§1.4), tapi B2-9/B2-3 yang
masuk kualifikasi masih dari body → RAB-06 memindahnya ke server-merge.

### RAB-07 · Gerbang prasyarat (Interview butuh riset awal submit)
Gerbang di transisi mesin Interview, pesan BI `[...]`. ⚠️ **"Selesai" per-platform:** setiap
`client_platforms` aktif punya baseline (analisa **atau** manual). **Tes anti-deadlock Shopee-only
WAJIB** (Shopee 156× vs TikTok 16× di seed). Perhatikan: `getBaseline().semua_terkonfirmasi` +
"satu baris per platform aktif" sudah tersedia sebagai bahan gerbang.

### RAB-04 SISA (UI) — belum dirakit
Data-layer FE + adapter xlsx **siap**, tapi **`RisetAwalPanel.tsx` penuh belum dibangun**: sub-bagian
per `client_platforms` aktif, unggah + `detect().ambiguous`→konfirmasi toko/afiliasi, grid konfirmasi
per-angka, entri manual minimal, tombol submit yang butuh `semua_terkonfirmasi`. Panel yang ada
sekarang masih hanya paruh pengukuran M6A (timer). Wire ke `web-internal/src/lib/riset-awal.ts`.

**Wave B–E** (RAB-08…RAB-20) tak berubah — lihat SESI32 §2 / backlog.

---

## 3. Jebakan yang MASIH relevan
1. **Tes domain integration WAJIB serial** — `npm run -w @cdps/domain test`, jangan `npx vitest run packages/domain` dari root (banjir koneksi ⇒ failure palsu). Lihat §0.2.
2. **`SCORED_FIELD_KEYS` & `hitungKualifikasi` nol perubahan** (RAB-06); fixture Alpha Digital IDENTIK.
3. `median_6m`≠`B1-5` (§5.2); `B3-3`/`B7-3` tetap interview.
4. Mesin baseline di server, bukan browser (§1.4) — jangan impor `@cdps/core` ke `web-internal`.
5. Gerbang prasyarat + analisa TikTok-only = deadlock ⇒ tes anti-deadlock Shopee-only wajib (RAB-07).
6. Jangan matikan STR- sebelum UI pindah; `KNOWN_GAPS` route-parity tetap kosong.
7. Migrasi hanya lewat `supabase/migrations/**`; kalau nambah tabel, naikkan gate di DUA tempat.

---

## 4. Sumber kebenaran
- **Backlog:** `docs/backlog/RISET_AWAL_BASELINE_BACKLOG.md` · **Spek/keputusan:** `HANDOFF_M6ABC_SESI31.md` + `HANDOFF_M6ABC_SESI32.md`.
- `docs/DECISIONS.md` 2026-08-18 (RAB-03/04/05 + klarifikasi mesin-di-server) & 2026-08-17 (§5 + 7 keputusan pemilik).
- **Kode baru sesi ini:** `packages/core/src/baseline/{types.ts,riset-awal-vocab.test.ts}` ·
  `packages/domain/src/{riset-awal.ts,riset-awal.test.ts,riset-awal.integration.test.ts}` ·
  `apps/api/src/app/api/v1/interview/[id]/baseline/**` · `apps/api/src/lib/wire.ts` ·
  `web-internal/src/lib/riset-awal.ts` · `apps/api/src/lib/shape-parity.test.ts`.
- **Arsip tool (rujukan port satu arah):** `docs/design/BASELINE_TOOL_TIKTOK_v1.html` — jangan pelihara paralel.
- `CLAUDE.md` aturan rumah #1–#8.
