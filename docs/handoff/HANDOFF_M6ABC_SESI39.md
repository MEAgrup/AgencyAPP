# HANDOFF — Riset Awal Baseline / M6B: **Wave D SELESAI (RAB-16 + RAB-17) + Wave E dimulai (RAB-18)** — Sesi 39

> Rantai: … → SESI37 (RAB-11/12/13, PR #178) → SESI38 (RAB-14/15, PR #179 — **MERGE**)
> → **SESI39 (ini, terbaru — RAB-16 + RAB-17 + RAB-18).**
> Baca yang bernomor tertinggi lebih dulu; **SESI31 tetap sumber SPEK & KEPUTUSAN** (jangan tanya ulang).
>
> **Status: RAB-01…RAB-18 SELESAI, teruji.** Wave A+B+C tuntas; **Wave D TUNTAS** (RAB-14…RAB-17);
> **Wave E separuh** (RAB-18 selesai; **RAB-19 + RAB-20 belum**).

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch & PR

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch sesi ini** | `claude/rab-16-18-lanjutan-gc2ta9` |
| **PR sesi ini** | **#180** (base `main`) — RAB-16 + RAB-17 + RAB-18. |
| **Base saat kerja** | `main` (`937417e`, hasil merge #179). Branch di-restart dari `main`. |

**Cek status merge dulu sebelum lanjut RAB-19:**
- **Kalau PR #180 SUDAH merge:** restart branch baru dari main —
  `git fetch origin main && git checkout -B <branch-baru> origin/main`, kerjakan RAB-19/20 → PR baru.
- **Kalau belum:** lanjut di branch sesi ini.

### 0.1 Aturan main yang MASIH berlaku (SESI31 §0.2 — jangan dilanggar)
- Migrasi HANYA lewat `supabase/migrations/**` + `apply_migration`. DB lokal HANYA lewat `scripts/db-rebuild.sh`.
- Tulis via service-role + gate domain; RLS memikul row-scope. Wire snake_case lewat `apps/api/src/lib/wire.ts`.
- **Rute = shell**: `requireActor` → validasi/map body → domain. **Jangan taruh logika di rute.**
- Setiap wire interface yang dibaca `web-internal` wajib dipasangkan di `shape-parity.test.ts` (`WIRE_TO_FE`)
  **dan** file FE-nya di `FE_FILES`. **Import tipe FE lintas-lib WAJIB pakai alias `@/lib/xxx`** — parser
  shape-parity (`feImports`) hanya mengenali `import type { X } from '@/lib/xxx'`, BUKAN `'./xxx'` relatif
  (jebakan sesi ini: `import type { Brief } from './account'` bikin nested-ref "exists in several lib files").
- `route-parity.test.ts` `KNOWN_GAPS` **tetap kosong**.

### 0.2 Setup DB lokal + install deps (kalau container baru)
```
pg_ctlcluster 16 main start
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" bash scripts/db-rebuild.sh --yes
npm install                          # root workspaces
cd web-internal && npm install       # web-internal app Next MANDIRI — install terpisah
```
⚠️ **Tes domain integration WAJIB serial** — `npm run -w @cdps/domain test` (config `fileParallelism:false`).
**Rebuild DB sebelum run ulang suite penuh** (tes count audit id-tetap gagal palsu di run kedua).
⚠️ **Rebuild DB SETELAH menambah migrasi** sebelum menjalankan tes yang memakai kolom baru (jebakan sesi ini:
tes `brief-inherit` gagal "column plan_row_id does not exist" karena `db-rebuild` jalan sebelum migrasi ditulis).

---

## 1. Yang SUDAH selesai sesi ini (jangan ulang)

### 1.1 RAB-16 — Brief "satu klik, warisi semua" (keputusan pemilik 3)
Saat periode Plan `Aktif`, tiap `plan_row` yang memenuhi syarat menurunkan **satu Brief** ke divisi PIC-nya;
AM hanya mengisi **jatuh tempo + prioritas**.

- **Domain** `packages/domain/src/brief-inherit.ts` (BARU):
  - `planRowToBriefInput(row, fill)` — pemetaan `plan_row → Brief` di **SATU** tempat (fungsi murni).
    divisi←`divisi_pic`, kuota←`kuota` (dibulatkan), deliverable←`satuan`|`aksi`|`pilar`, judul←`hasil_diharapkan`|`"<pilar> — <channel>"`, instruksi←jejak kanal/pilar/aksi/prasyarat.
  - `inheritBriefsFromPlan(sql, actor, planId, fills)` — orchestrator. Gate: `canWritePlan` + periode wajib
    `Aktif` (`MSG_INHERIT_PLAN_NOT_ACTIVE`); `fills` (tanggal+prioritas) divalidasi SEBELUM id di-mint;
    idempoten (baris yang sudah menurunkan Brief di-skip); hasil `{ created: Brief[], skipped: {planRowId, reason}[] }`.
- **Migrasi `20260818000000_m6b_brief_plan_row_link.sql`** — kolom `briefs.plan_row_id` (bigint NULL,
  FK→`plan_row` ON DELETE SET NULL, index parsial UNIQUE `uq_briefs_plan_row`). **KOLOM, bukan tabel** ⇒
  gate tabel TETAP 118. Dua asal Brief saling eksklusif: **manual (STR-, `strategy_id`)** vs
  **warisan M6B (`plan_row_id`, `strategy_id` NULL)** — `strategi`/`plan` (STRG-) tak pernah menulis `strategy_plans`.
- **`account.ts`** — `insertBrief` / `advanceServiceToBriefed` / `isServiceBriefable` diekstrak & **diekspor**
  (kelahiran Brief tunggal, dibagi dua jalur). `createBrief` perilakunya **identik** (65 tes account tetap hijau).
- **`plan.ts`** — ekspor `loadPlanForUpdate`, `ownerAmOfClient`, `PLAN_AKTIF`, `listPlanRows` (dipakai brief-inherit).
- **Rute** `POST /plan/{id}/briefs`, `briefInheritResultToWire` (+`BriefInheritResultWire`/`BriefInheritSkipWire`),
  FE `plan.ts::inheritBriefsFromPlan` + `BriefInheritResult`/`BriefInheritSkip`, dipasangkan shape-parity.

**⚠️ Resolusi service per PC-3 (OPEN QUESTION — `DECISIONS.md` 2026-08-18):**
- baris `service_id` → service itu (tegas);
- baris `strategi_pillar_id` (Full-Management) → **Strategi terikat KONTRAK, bukan service** (`strategi.contract_id`;
  kolom `strategi.service_id` sudah TIDAK ADA — migrasi lama menggantinya dengan `contract_id`). Satu kontrak bisa
  punya beberapa service ⇒ kita warisi ke service kontrak HANYA bila **tepat satu**; beberapa = `service_ambigu`
  (di-skip, tak ditebak);
- `di_luar_*` → tak ada jangkar → `di_luar` (di-skip).
- **Butuh keputusan pemilik:** apakah kontrak Full-Management kanoniknya satu service, atau baris pilar wajib
  ber-`service_id` eksplisit? Sampai itu diputuskan, ambigu = skip aman.

### 1.2 RAB-17 — Jalur STR- manual tetap dilayani
`createBrief` (STR-) tetap jalan, perilaku identik; Brief manual `plan_row_id` NULL; 4 Brief lama tak tersentuh
(kolom baru nullable). Tes coexistence membuktikan dua dunia di satu tabel. **Pensiun STR- = keputusan tersendiri.**

### 1.3 RAB-18 — BUAT `docs/prd/CDPS_Module6_Interview.md` (akar drift)
PRD kanonik Modul Interview (dulu tanpa PRD). Memuat: alur 5 langkah · Riset Awal berisian + gerbang prasyarat
(mesin #20, 4 tabel baseline, auto-fill `['B2-9','B2-3']`, `belum_dapat_diukur`) · dedup pertanyaan · 12 seksi
Blok B berstatus eksplisit (wired B1/B2/B3/B4/B6/B7; `ditunda_rab18` B0/B5/B8/B10/B11; `config_driven` B9) +
18 field terbangun + 15 terskor · mesin #19 lengkap (11 status; edge mulai-langsung dari `20260812000000`) ·
scorer server-authoritative (RAB-06 merge) + verdict advisory · handoff prefill · izin · SLA 3-langkah.
**Batas TEGAS Skor Kondisi Toko (TANTANGAN, `riset_awal_analisa.kondisi_toko`) vs Blok C verdict
(HAMBATAN MENDASAR, `interview_kualifikasi.verdict_kualifikasi`)** — kosakata disjoint, dijaga tes CI.
**Dokumen-saja — nol kode/migrasi/tes berubah.**

### 1.4 Verifikasi yang dijalankan (DB fresh, sekali jalan)
- **domain 1380 hijau** (serial; +10 tes `brief-inherit` termasuk coexistence RAB-17), 1 skip.
- **api 351 hijau** (+1 tes `briefInheritResultToWire`, +2 pasangan wire shape-parity, route-parity `KNOWN_GAPS` kosong).
- **web-internal 257 hijau** + typecheck + eslint bersih.
- typecheck core/db/domain/api/web-internal bersih.
- **Migrasi menambah KOLOM, bukan tabel** ⇒ gate **118/35/23/57 TETAP** (`db-rebuild` memverifikasi).

---

## 2. BERIKUTNYA — sisa Wave E (`RISET_AWAL_BASELINE_BACKLOG.md` §5)

### RAB-19 · Koreksi PRD (satu entri `DECISIONS.md` untuk ketiga baris M6A)
Lima titik (M6A:38 D5, M6A:51 D18, M6A:435 OA-9, M6A Rule 5, M6B_Plan:37 P3). **Ketiga baris M6A = satu
keputusan ditulis di tiga tempat** — kalau hanya satu dikoreksi, dua sisanya dipakai tiket berikutnya untuk
membatalkan pekerjaan ini. Ingat SESI31 §0.2: untuk lima titik ini PRD **dikoreksi** (aturan "PRD menang"
ditangguhkan). P3 M6B ("no auto-Brief") sudah **usang** — RAB-16 justru membuat "satu klik warisi-semua".

### RAB-20 · Build Plan + dokumen registry
`CDPS_Build_Plan.md:81-87` — tambah klaster tiket (Riset Awal Baseline Engine + M6B Route Surface + Brief
inherit) di Wave 2 + satu baris exit criteria. Juga `DATA_MODEL.md` (4 tabel baseline + kolom `briefs.plan_row_id`)
· `STATE_MACHINES.md §6f` (subseksi **gerbang prasyarat** `assertRisetAwalGate` — masih TODO, dicatat di PRD Interview).

---

## 3. Jebakan yang MASIH relevan
1. **Tes domain integration WAJIB serial.** Rebuild DB sebelum run ulang suite penuh (audit id-tetap).
2. **Rebuild DB SETELAH menulis migrasi baru** sebelum tes yang memakai kolomnya (jebakan sesi ini).
3. **web-internal app Next MANDIRI** — `cd web-internal && npm install` terpisah (baca `web-internal/AGENTS.md`).
4. **Import tipe FE lintas-lib WAJIB `@/lib/xxx`**, bukan relatif — kalau tidak, shape-parity nested-ref gagal
   "exists in several lib files".
5. **`strategi` (STRG-) terikat KONTRAK, bukan service** — `strategi.service_id` tak ada lagi. Jangan asumsikan
   pemetaan 1:1 strategi→service (jebakan resolusi service RAB-16).
6. **Rute = shell, logika di domain.** `activatePlanPeriode` SENGAJA tidak auto-menjalankan pewarisan Brief
   (AM harus isi jatuh tempo+prioritas dulu = satu klik terpisah) — jangan tambah logika ke aktivasi.
7. Migrasi hanya lewat `supabase/migrations/**`; nambah **tabel** naikkan gate di DUA tempat
   (`.github/workflows/ci.yml` + `scripts/db-rebuild.sh`) — nambah **kolom** tak mengubah gate tabel.

---

## 4. Sumber kebenaran
- **Backlog:** `docs/backlog/RISET_AWAL_BASELINE_BACKLOG.md` (§5 = Wave E) · **Spek/keputusan:**
  `HANDOFF_M6ABC_SESI31.md` (+ SESI32…38).
- `docs/DECISIONS.md` 2026-08-18 (RAB-18 + RAB-16/17 di baris teratas; lalu RAB-14/15).
- **PRD baru:** `docs/prd/CDPS_Module6_Interview.md` (RAB-18).
- **Kode berubah sesi ini:**
  - `packages/domain/src/brief-inherit.ts` (BARU) + `brief-inherit.test.ts` (BARU, 10 tes).
  - `packages/domain/src/account.ts` (`insertBrief`/`advanceServiceToBriefed`/`isServiceBriefable` ekspor;
    `ALLOWED_PRIORITIES` ekspor; `createBrief` refactor perilaku-identik).
  - `packages/domain/src/plan.ts` (ekspor `loadPlanForUpdate`/`ownerAmOfClient`/`PLAN_AKTIF`/`listPlanRows`).
  - `packages/domain/src/index.ts` (ekspor `briefInherit`).
  - `apps/api/src/lib/wire.ts` (`briefInheritResultToWire` + 2 `*Wire`) + `wire.plan.test.ts` (+1 tes) +
    `shape-parity.test.ts` (+2 `WIRE_TO_FE`).
  - `apps/api/src/app/api/v1/plan/[id]/briefs/route.ts` (BARU).
  - `web-internal/src/lib/plan.ts` (import `Brief` dari `@/lib/account`, `inheritBriefsFromPlan` + 2 tipe).
  - `supabase/migrations/20260818000000_m6b_brief_plan_row_link.sql` (BARU).
- `CLAUDE.md` aturan rumah #1–#8.
