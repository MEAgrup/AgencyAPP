# HANDOFF — Riset Awal Baseline: **RAB-04 sisa (UI) + RAB-08 selesai, lanjut RAB-09/RAB-10 (Wave B)** — Sesi 35

> Rantai: … → SESI32 (RAB-01/02, PR #173) → SESI33 (RAB-03/04 submit/05, PR #174)
> → SESI34 (RAB-06 skor server-authoritative + RAB-07 gerbang, PR #175)
> → **SESI35 (ini, terbaru — RAB-04 sisa UI panel penuh + RAB-08 dedup pertanyaan interview).**
> Baca yang bernomor tertinggi lebih dulu; SESI31 tetap sumber SPEK & KEPUTUSAN (jangan tanya ulang).
>
> **Status: RAB-01…RAB-08 SELESAI, teruji.** Berikutnya **RAB-09** (hidupkan `PREFILL_MAPPING` +
> `handoffKeStrategi`) dan **RAB-10** (enam seksi Blok B belum dibangun — bangun atau nyatakan keluar cakupan).

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch & PR

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch sesi ini** | `claude/rab-04-rab-08-ui-ntw48p` |
| **PR sesi ini** | **#176** (base `main`, draft) — RAB-04 UI + RAB-08. |
| **RAB-06/07** | PR **#175** — sudah **MERGE** ke `main`. |
| **RAB-03/04/05** | PR **#174** — MERGE. **RAB-01/02** PR **#173** — MERGE. |
| **Base saat kerja** | `main` (2409df3, hasil merge #175). Branch di-restart dari `main`. |

**Cek status merge dulu sebelum lanjut RAB-09:**
- **Kalau PR sesi ini SUDAH merge ke `main`:** restart branch baru dari main —
  `git fetch origin main && git checkout -B <branch-baru> origin/main`, kerjakan RAB-09 → PR baru.
- **Kalau belum:** lanjut di branch sesi ini di atas commit-nya, atau branch baru dari situ.

### 0.1 Aturan main yang MASIH berlaku (SESI31 §0.2 — jangan dilanggar)
- Migrasi HANYA lewat `supabase/migrations/**` + `apply_migration`. DB lokal HANYA lewat `scripts/db-rebuild.sh`.
- Tulis via service-role + gate domain; RLS memikul row-scope. Wire snake_case lewat `apps/api/src/lib/wire.ts`.
- **Mesin baseline jalan di SERVER, bukan browser** (SESI33 §1.4 — jangan impor `@cdps/core` ke `web-internal`).
- Setiap wire interface yang dibaca `web-internal` wajib dipasangkan di `shape-parity.test.ts` (FE_MAP).

### 0.2 Setup DB lokal + install deps (kalau container baru)
```
pg_ctlcluster 16 main start
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" bash scripts/db-rebuild.sh --yes
npm install                          # root workspaces
cd web-internal && npm install       # web-internal app Next MANDIRI — install terpisah
```
⚠️ **Tes domain integration WAJIB serial** — `npm run -w @cdps/domain test` (config `fileParallelism:false`).
`npx vitest run` dari ROOT mengabaikan itu → `interview.test.ts` & `riset-awal.integration.test.ts` berebut
`CLI-ZZI-0001` → failure PALSU (§0.2 SESI34, masih relevan).

---

## 1. Yang SUDAH selesai sesi ini (jangan ulang)

### 1.1 RAB-04 SISA — `RisetAwalPanel.tsx` penuh (paruh analisa, bukan cuma timer)
- **Read-model baseline diperluas** supaya panel bisa merender sub-bagian per platform TANPA
  ronde kedua & tanpa tombol pilih platform:
  - `packages/domain/src/riset-awal.ts` — `interface PlatformSlot { clientPlatformId, platform, metode, storeLink }`
    + `BaselineView.platforms`. `readBaseline` query `client_platforms` **aktif** (join via interview),
    `metode` diturunkan `metodeForPlatform` (satu sumber). Slot untuk platform yang **belum** disubmit
    juga muncul (itu inti RAB-04).
  - `apps/api/src/lib/wire.ts` — `RisetAwalPlatformWire` + `platforms` di `RisetAwalBaselineWire`.
  - `web-internal/src/lib/riset-awal.ts` — `RisetAwalPlatform` + `platforms`.
  - `apps/api/src/lib/shape-parity.test.ts` FE_MAP — pasangan `RisetAwalPlatformWire ↔ RisetAwalPlatform`.
- **`RisetAwalPanel.tsx`** (`web-internal/src/components/interview/`): timer (lama) **+**
  - Satu kartu per `baseline.platforms`. Tersubmit ⇒ tampil kondisi_toko/skor/cakupan read-only.
  - **analisa_penuh (TikTok Shop):** input file (`parseExportFile` → aoa+sha256 **di browser saja**),
    tabel berkas + **override tipe toko/afiliasi per-file** (jalur ambigu fix #3: `vid_toko/vid_aff/live_toko/live_aff`),
    grid **riwayat GMV 6 bulan opsional** (tanda campaign/belum/masalah milik AM), toggle **net**,
    akun tertaut (bedakan toko vs afiliasi). Submit → `submitBaselineAnalisa`.
  - **manual/analisa_tipis (platform lain):** entri minimal GMV/order/AOV/SKU/belanja iklan/ROAS +
    periode & tanggal ambil (Rule 5). Submit → `submitBaselineManual`.
  - **Grid konfirmasi per-angka** (B2-9 money, B2-3 count): usulan + koreksi + centang → `confirmBaselineIsian`.
  - **Submit riset awal** (timer) hanya hidup saat **semua platform aktif ter-baseline DAN semua angka
    terkonfirmasi** (cermin gerbang RAB-07; server tetap penegak sebenarnya). Checklist "yang kurang" ditampilkan.
- **Gerbang di tab Interview:** tombol **Simpan jadwal** & **Mulai interview** terkunci sampai
  `riset_awal.status = Selesai`, dengan banner "Buka Riset Awal". (Server tetap tolak via
  `MSG_RISET_AWAL_BELUM_LENGKAP`; ini cuma menuntun, bukan pengganti.)
- Panel & page fetch baseline sendiri (`getRisetAwalBaseline`) + `getClient`; `reloadBaseline` refresh
  tanpa spinner blank.

### 1.2 RAB-08 — dedup pertanyaan interview
- `web-internal/src/lib/interview-dedup.ts` (**pure, teruji** — `interview-dedup.test.ts`, 4 tes):
  `computeDedup(baseline)` → peta `field_key → {display, source, confirmed}` untuk **B2-9 & B2-3 saja**.
- `DedupField.tsx`: Blok B merender chip "terisi dari data" (nilai + sumber), bukan input kosong;
  tombol **"berbeda dari data"** → pindah ke tab Riset Awal (koreksi & konfirmasi ulang di SATU tempat —
  skor membaca isian riset awal, bukan Blok B; RAB-06).
- `SalesContextCard.tsx`: identitas & baseline toko dari `clients` (snapshot `qualified_forms`) read-only,
  link koreksi ke Client Record. Interview tak menanyakan ulang identitas.
- **Draft di-seed** dari isian terkonfirmasi (B2-9/B2-3) supaya preview skor sidebar tetap lengkap
  walau input tersembunyi (**preview = submit** tetap terjaga). Tak pernah menimpa nilai ketikan AM.
- **Set dedup SENGAJA SEMPIT** (jangan lebarkan tanpa alasan): `gmv_baseline`/`target_gmv` → field skor
  **tidak** dilebur (`median_6m`→`B1-5` selisih satuan ~3×, §5.2); `B1-5`/`B3-3`/`B7-3` tetap pertanyaan
  interview (penilaian manusia). Melebarkan set = merusak skor diam-diam.

### 1.3 Verifikasi yang dijalankan
- **domain 1356 hijau** (serial, `npm run -w @cdps/domain test`; +1 tes `platforms` di
  `riset-awal.integration.test.ts`). **api parity+wire 166** (`shape-parity`/`route-parity`/`wire`,
  `KNOWN_GAPS` kosong). **web-internal 257** (17 file; `interview-dedup.test.ts` 4 baru).
- typecheck **domain/api/web-internal** bersih; **eslint web-internal** bersih.
- **NOL migrasi/tabel/mesin/prefix/event baru** ⇒ gate 118/35/23/57 TETAP.

---

## 2. BERIKUTNYA — RAB-09 dan seterusnya (`RISET_AWAL_BASELINE_BACKLOG.md`)

### RAB-09 · Hidupkan `PREFILL_MAPPING` + `handoffKeStrategi`
Sudah ditulis & diuji (`packages/core/src/interview.ts:1058`) tapi **nol pemanggil produksi**.
Sambungkan ke jalur Interview→Strategi. **Jangan tulis ulang.**

### RAB-10 · Enam seksi Blok B belum dibangun
B0, B5, B8–B11 (`web-internal/src/lib/interview-fields.ts` — `INTERVIEW_SECTIONS` `wired:false`)
diselesaikan **atau** dinyatakan sengaja keluar cakupan di PRD Interview yang baru (RAB-18).
Jangan menggantung tanpa status.

**Wave C–E** (RAB-11…RAB-20) tak berubah — lihat backlog + SESI31/32/33/34.
Catatan: **RAB-18** (BUAT PRD Interview) & **RAB-19** (koreksi 5 baris PRD M6A/M6B lewat DECISIONS)
menyertai Wave A–D; RAB-04 UI + RAB-08 memperkuat kebutuhan RAB-18 (alur riset awal→dedup→Blok B kini nyata).

---

## 3. Jebakan yang MASIH relevan
1. **Tes domain integration WAJIB serial** — `npm run -w @cdps/domain test`, JANGAN `npx vitest run` root.
2. **web-internal app Next MANDIRI** — `cd web-internal && npm install` terpisah; `node_modules` tak ikut clone.
3. **Mesin baseline di server, bukan browser** — panel hanya `parseExportFile` (xlsx→aoa+sha256). Jangan
   impor `@cdps/core` ke `web-internal`. Deteksi/skor/ambang tetap di server.
4. **Set dedup RAB-08 SEMPIT** = B2-9/B2-3 saja (§1.2). `median_6m`≠`B1-5` (§5.2); `B3-3`/`B7-3` manual.
5. **Skor B2-9/B2-3 otoritatif dari isian riset awal terkonfirmasi (RAB-06).** UI meng-hide input Blok B
   & meng-seed draft dari isian; koreksi mengalir lewat grid konfirmasi Riset Awal, bukan Blok B.
6. **Setiap wire baru yang dibaca FE wajib punya pasangan di `shape-parity.test.ts` FE_MAP** — kalau tidak,
   tes "finds both sides" gagal. `KNOWN_GAPS` route-parity tetap **kosong**.
7. Gerbang RAB-07: kalau menambah platform aktif SETELAH interview mulai, gerbang start tak menghitung
   ulang (jebakan §3 SESI34) — pertimbangkan saat merancang UI penambahan platform.
8. Migrasi hanya lewat `supabase/migrations/**`; kalau nambah tabel, naikkan gate di DUA tempat.

---

## 4. Sumber kebenaran
- **Backlog:** `docs/backlog/RISET_AWAL_BASELINE_BACKLOG.md` · **Spek/keputusan:**
  `HANDOFF_M6ABC_SESI31.md` (+ SESI32/33/34).
- `docs/DECISIONS.md` 2026-08-18 (RAB-04 UI + RAB-08 di baris teratas; RAB-06/07; RAB-03/04/05; RAB §5).
- **Kode berubah sesi ini:**
  - `packages/domain/src/riset-awal.ts` (`PlatformSlot`, `BaselineView.platforms`, `readBaseline` query) +
    `riset-awal.integration.test.ts` (tes `platforms` slot).
  - `apps/api/src/lib/wire.ts` (`RisetAwalPlatformWire` + `platforms`) + `shape-parity.test.ts` (FE_MAP).
  - `web-internal/src/lib/riset-awal.ts` (`RisetAwalPlatform`) ·
    `web-internal/src/lib/interview-dedup.ts` (+ `.test.ts`) ·
    `web-internal/src/components/interview/RisetAwalPanel.tsx` (rakit ulang penuh) ·
    `.../interview/DedupField.tsx` · `.../interview/SalesContextCard.tsx` (baru) ·
    `web-internal/src/app/(shell)/account/interview/[id]/page.tsx` (fetch baseline+client, seed draft,
    gerbang jadwal/mulai, render SalesContextCard/DedupField).
- **Arsip tool (rujukan port satu arah):** `docs/design/BASELINE_TOOL_TIKTOK_v1.html` — jangan pelihara paralel.
- `CLAUDE.md` aturan rumah #1–#8.
