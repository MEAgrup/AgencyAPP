# HANDOFF — Riset Awal Baseline / M6B: **Wave D dimulai (RAB-14 + RAB-15)** — Sesi 38

> Rantai: … → SESI36 (RAB-09/10, PR #177) → SESI37 (RAB-11/12/13, PR #178 — **MERGE**)
> → **SESI38 (ini, terbaru — Wave D: RAB-14 + RAB-15).**
> Baca yang bernomor tertinggi lebih dulu; **SESI31 tetap sumber SPEK & KEPUTUSAN** (jangan tanya ulang).
>
> **Status: RAB-01…RAB-15 SELESAI, teruji.** Wave A + B + C tuntas; Wave D **separuh**
> (RAB-14 + RAB-15 selesai; **RAB-16 + RAB-17 belum**). Lalu **Wave E** (RAB-18…RAB-20, dokumen).

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch & PR

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch sesi ini** | `claude/rab-14-15-lanjutan-4j32z0` |
| **PR sesi ini** | **#179** (base `main`) — RAB-14 + RAB-15. |
| **Base saat kerja** | `main` (`e5f1bc3`, hasil merge #178). Branch di-restart dari `main`. |

**Cek status merge dulu sebelum lanjut RAB-16:**
- **Kalau PR #179 SUDAH merge:** restart branch baru dari main —
  `git fetch origin main && git checkout -B <branch-baru> origin/main`, kerjakan RAB-16 → PR baru.
- **Kalau belum:** lanjut di branch sesi ini atau branch baru dari commit-nya.

### 0.1 Aturan main yang MASIH berlaku (SESI31 §0.2 — jangan dilanggar)
- Migrasi HANYA lewat `supabase/migrations/**` + `apply_migration`. DB lokal HANYA lewat `scripts/db-rebuild.sh`.
- Tulis via service-role + gate domain; RLS memikul row-scope. Wire snake_case lewat `apps/api/src/lib/wire.ts`.
- **Rute = shell**: `requireActor` → validasi/map body → domain. **Jangan taruh logika di rute** (gerbang/audit/statemachine di domain).
- Setiap wire interface yang dibaca `web-internal` wajib dipasangkan di `shape-parity.test.ts` (`WIRE_TO_FE`)
  **dan** file FE-nya didaftarkan di `FE_FILES` (array hardcoded, baris ~173). File FE baru yang tak masuk
  `FE_FILES` = pasangannya tak terbaca ⇒ "registry points at missing FE types".
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
Jangan `npx vitest run` dari ROOT. **Rebuild DB sebelum run ulang suite penuh** (tes count audit id-tetap
gagal palsu di run kedua). Kalau tes domain "hang": cek Postgres (`psql -d cdps -c 'select 1'`).

---

## 1. Yang SUDAH selesai sesi ini (jangan ulang)

### 1.1 RAB-14 — `createPlanRow` + rute (satu-satunya lubang nyata M6B)
Sebelum ini `plan_row` hanya di-insert lewat SQL mentah di `plan.test.ts`.

- **Domain** `createPlanRow(sql, actor, planId, input: CreatePlanRowInput)` (`packages/domain/src/plan.ts`,
  tepat setelah `loadPlanRow`). Gerbang **mencerminkan CHECK DB** agar penelepon dapat pesan BI `[...]`
  (CHECK DB tetap backstop): PC-3 asal-tunggal (`ck_plan_row_asal_tunggal` — tepat satu dari
  `strategiPillarId`/`serviceId`/`diLuarStrategi`/`diLuarService`), alasan wajib untuk baris Di Luar
  (`ck_plan_row_di_luar_alasan`), pilar ∈ 8 nilai, prioritas/visibilitas enum, kuota/budget non-negatif.
  Pesan baru: `MSG_PLAN_ROW_INCOMPLETE`/`_PILAR_INVALID`/`_PRIORITAS_INVALID`/`_VISIBILITAS_INVALID`/
  `_KUOTA_INVALID`/`_ASAL_INVALID`/`_DILUAR_ALASAN_REQUIRED`/`_CREATE_STATUS`.
- **Write-scope** `canWritePlan`; periode wajib **`Draft` atau `Aktif`** (§8 M6B: AM menulis P-A…P-F pada
  dua status itu — BUKAN `Draft`/`Terjadwal` seperti `adjustPlanTarget`; jangan samakan).
- Kolom auto (PC-13/14/15/16, carry-over) **tidak** diterima dari penelepon — baris lahir `Rencana`,
  un-carried. Audit `baris_dibuat` immutable per insert (CLAUDE.md #3).
- **Rute** `POST /plan/{id}/rows` (201) → `planRowToWire`. FE `createPlanRow` + `CreatePlanRowBody`.

### 1.2 RAB-15 — 11 rute untuk fungsi domain M6B yang sudah ada
**Menulis rute, bukan logika.** Pola: `requireActor` → map body snake→camel → domain → `plan*ToWire`.

`POST /plan/{id}/submit` `/approve` `/return` `/activate` `/rows` `/target` `/target/approve` `/actual`
`/sengketa` · `POST /plan/rows/{rowId}/weeks` · `GET /contracts/{id}/plan-deficit`.

- **Wire baru** (`wire.ts`): `planToWire`/`planTargetToWire`/`planRowToWire`/`planRowWeekToWire`/
  `planActualToWire` + 5 antarmuka `*Wire`. `plan` ditambahkan ke import `@cdps/domain` di `wire.ts`.
- **FE** `web-internal/src/lib/plan.ts` (baru) — 5 antarmuka snake_case + fetchers. Didaftarkan di
  shape-parity `WIRE_TO_FE` (+5) **dan** `FE_FILES` (+`'plan.ts'`).
- `contractDeficit` mengembalikan `{ defisit_terbawa }` (angka tunggal terbungkus, `plan.ts::PlanDeficit`) —
  tak butuh `*Wire` interface (bukan objek domain).
- `wire.plan.test.ts` (baru): tiap konverter emit snake_case + nilai benar (tes bentuk wire per rute).

### 1.3 ⚠️ `generatePlanPeriods` & `deriveWeeklyDistribution` — SENGAJA tetap internal
Dua dari 12 fungsi yang backlog RAB-15 sebut, **TIDAK** diberi rute manual. Keduanya bertanda tangan
`TransactionSql` dan hanya jalan **di dalam** transaksi milik alur lain: `generatePlanPeriods` dipanggil
`approveStrategi` (Rule 1: "periode di-GENERATE, tak pernah dibuat manual" — rute manual melanggar itu),
`deriveWeeklyDistribution` dipanggil `activatePlanPeriode` (dan tambah gerbang kepemilikan = logika di rute).
Dicatat lengkap `docs/DECISIONS.md` 2026-08-18. **Kalau kelak "regenerate periode Terjadwal" / "reset
distribusi ke auto" diinginkan sebagai aksi pengguna, itu keputusan tersendiri** — jangan diam-diam bikin.

### 1.4 Verifikasi yang dijalankan (DB fresh, sekali jalan)
- **domain 1371 hijau** (serial; +5 tes `createPlanRow`).
- **api 345 hijau** (shape-parity +5 pasangan wire, +5 tes `wire.plan.test.ts`, route-parity `KNOWN_GAPS` kosong).
- **web-internal 257 hijau** + typecheck + eslint bersih.
- typecheck **domain/api/web-internal** bersih.
- **NOL migrasi/tabel/mesin/prefix/event baru** ⇒ gate **118/35/23/57 TETAP** (`db-rebuild` memverifikasi).

---

## 2. BERIKUTNYA — sisa Wave D + Wave E (`RISET_AWAL_BASELINE_BACKLOG.md` §4–§5)

### RAB-16 · `brief-inherit.ts` + UI satu klik
`packages/domain/src/brief-inherit.ts` — pemetaan `plan_row` → Brief (klien, service, divisi PIC, kanal,
pilar, kuota, satuan, hasil diharapkan, baseline, lampiran sumber) di **satu** tempat. UI: plan ter-`activate`
→ semua Brief dibuat sekaligus → AM hanya mengisi **jatuh tempo + prioritas** di satu daftar (keputusan 3).
⚠️ `plan_row` kini punya write path (RAB-14) — `brief-inherit` membaca baris itu.

### RAB-17 · Jalur STR- tetap dilayani
Sampai UI `web-internal` pindah. 4 Brief yang sudah ada **tetap di tempatnya** — nol migrasi. Pensiun STR- =
entri `DECISIONS.md` tersendiri, di luar backlog ini.

### Wave E — dokumen
RAB-18 (BUAT `docs/prd/CDPS_Module6_Interview.md` — **akar drift**), RAB-19 (koreksi 5 baris PRD M6A/M6B —
satu keputusan ditulis tiga tempat), RAB-20 (Build Plan + `DATA_MODEL.md` + `STATE_MACHINES.md`).

---

## 3. Jebakan yang MASIH relevan
1. **Tes domain integration WAJIB serial.** Rebuild DB sebelum run ulang suite penuh (audit id-tetap).
2. **web-internal app Next MANDIRI** — `cd web-internal && npm install` terpisah. (Ini versi Next dgn
   breaking changes — baca `web-internal/AGENTS.md`.)
3. **File FE lib baru wajib didaftarkan DI DUA tempat** di `shape-parity.test.ts`: `WIRE_TO_FE` (per interface)
   **dan** `FE_FILES` (per file). Lupa `FE_FILES` ⇒ "registry points at missing FE types".
4. **Rute = shell, logika di domain.** Jangan tambah gerbang/validasi di rute. Itu sebabnya
   `generatePlanPeriods`/`deriveWeeklyDistribution` tak dirutekan (§1.3).
5. **createPlanRow status-gate = `Draft`/`Aktif`** (§8 M6B), beda dari `adjustPlanTarget` (`Draft`/`Terjadwal`).
   Jangan "seragamkan".
6. **`plan/rows/{rowId}` = segmen statis** bersebelahan dengan `plan/{id}` dinamis. Next.js: statis menang;
   PLAN- id tak pernah bernama literal `rows`. Aman.
7. Migrasi hanya lewat `supabase/migrations/**`; kalau nambah tabel, naikkan gate di DUA tempat
   (`.github/workflows/ci.yml` + `scripts/db-rebuild.sh`).

---

## 4. Sumber kebenaran
- **Backlog:** `docs/backlog/RISET_AWAL_BASELINE_BACKLOG.md` (§4 = Wave D, §5 = Wave E) · **Spek/keputusan:**
  `HANDOFF_M6ABC_SESI31.md` (+ SESI32…37).
- `docs/DECISIONS.md` 2026-08-18 (RAB-14+15 di baris teratas; RAB-11/12/13 tepat di bawahnya).
- **Kode berubah sesi ini:**
  - `packages/domain/src/plan.ts` (`createPlanRow` + `CreatePlanRowInput` + 8 pesan BI baru + const
    `PLAN_ROW_PILAR`/`PRIORITAS`/`VISIBILITAS`) + `plan.test.ts` (+5 tes, describeDb `createPlanRow`).
  - `apps/api/src/lib/wire.ts` (5 konverter `plan*ToWire` + 5 antarmuka `*Wire` + import `plan`).
  - `apps/api/src/lib/wire.plan.test.ts` (baru). `apps/api/src/lib/shape-parity.test.ts` (`WIRE_TO_FE` +5,
    `FE_FILES` +`plan.ts`).
  - 11 rute baru di `apps/api/src/app/api/v1/plan/**` + `contracts/[id]/plan-deficit/`.
  - `web-internal/src/lib/plan.ts` (baru — 5 antarmuka + fetchers).
- `CLAUDE.md` aturan rumah #1–#8.
