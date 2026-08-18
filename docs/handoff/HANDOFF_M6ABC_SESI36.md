# HANDOFF — Riset Awal Baseline / Interview: **RAB-09 (jembatan Interview→Strategi) + RAB-10 (status enam seksi Blok B) SELESAI** — Sesi 36

> Rantai: … → SESI33 (RAB-03/04/05, PR #174) → SESI34 (RAB-06/07, PR #175)
> → SESI35 (RAB-04 sisa UI + RAB-08, PR #176 — **MERGE**)
> → **SESI36 (ini, terbaru — RAB-09 + RAB-10).**
> Baca yang bernomor tertinggi lebih dulu; SESI31 tetap sumber SPEK & KEPUTUSAN (jangan tanya ulang).
>
> **Status: RAB-01…RAB-10 SELESAI, teruji.** Wave A + Wave B tuntas. Berikutnya **Wave C** (RAB-11…RAB-13,
> baseline → Strategi) lalu **Wave D** (RAB-14…RAB-17, M6B route surface) + **Wave E** (RAB-18…RAB-20, dokumen).

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch & PR

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch sesi ini** | `claude/rab-9-10-tasks-qgpjiz` |
| **PR sesi ini** | **#PR_PLACEHOLDER** (base `main`) — RAB-09 + RAB-10. |
| **RAB-04 UI + RAB-08** | PR **#176** — **MERGE** ke `main`. |
| **RAB-06/07** #175 · **RAB-03/04/05** #174 · **RAB-01/02** #173 — semua MERGE. |
| **Base saat kerja** | `main` (e98e58f, hasil merge #176). Branch di-restart dari `main`. |

**Cek status merge dulu sebelum lanjut RAB-11:**
- **Kalau PR sesi ini SUDAH merge:** restart branch baru dari main —
  `git fetch origin main && git checkout -B <branch-baru> origin/main`, kerjakan RAB-11 → PR baru.
- **Kalau belum:** lanjut di branch sesi ini atau branch baru dari commit-nya.

### 0.1 Aturan main yang MASIH berlaku (SESI31 §0.2 — jangan dilanggar)
- Migrasi HANYA lewat `supabase/migrations/**` + `apply_migration`. DB lokal HANYA lewat `scripts/db-rebuild.sh`.
- Tulis via service-role + gate domain; RLS memikul row-scope. Wire snake_case lewat `apps/api/src/lib/wire.ts`.
- **Mesin baseline jalan di SERVER, bukan browser** (jangan impor `@cdps/core` ke `web-internal`).
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
Jangan `npx vitest run` dari ROOT (config root berbeda → `interview.test.ts` & `riset-awal.integration.test.ts`
berebut `CLI-ZZI-0001` → failure PALSU).
⚠️ **Kalau tes domain "hang" tanpa output:** cek Postgres hidup (`psql -d cdps -c 'select 1'`). Container ini
sempat mematikan Postgres (stale pid) → postgres.js retry tanpa henti, tampak seperti hang. `pg_ctlcluster 16 main start`.

---

## 1. Yang SUDAH selesai sesi ini (jangan ulang)

### 1.1 RAB-09 — `PREFILL_MAPPING` + `handoffKeStrategi` dihidupkan (jembatan Interview→Strategi)
Keduanya sudah ada & teruji tapi **nol pemanggil produksi**. Sekarang punya jalur end-to-end. **Tidak** ditulis ulang.

- **Core komposer** `resolveStrategiPrefill(verdict, answers)` (`packages/core/src/interview.ts`, setelah
  `handoffKeStrategi`): menggabungkan `handoffKeStrategi(verdict)` + `PREFILL_MAPPING` jadi satu nilai
  (`StrategiPrefill` = handoff flags + `items: StrategiPrefillItem[]`). Hanya field yang **terjawab** yang
  diusulkan; entri yang menargetkan baseline numerik Section B (`isStrategiBaselineForbidden`) **di-drop**.
  Murni, teruji (`interview.test.ts`, 3 tes baru).
- **Domain** `getStrategiPrefill(sql, actor, strategiId)` (`packages/domain/src/strategi.ts`): gerbang baca
  sama dengan `getStrategi`; cari interview klien **terakhir yang selesai & terskor** (link via `client_id` —
  **tak ada `interview_id` di `strategi`**), baca verdict + answers, panggil komposer. `null` kalau belum ada
  interview selesai. Teruji (`strategi.test.ts`, 3 tes integrasi).
- **Rute** `GET /api/v1/strategi/{id}/prefill` (+ `StrategiPrefillWire`/`StrategiPrefillItemWire` +
  `strategiPrefillToWire`, shape-parity FE_MAP dipasangkan). ⚠️ Path `/strategi/{id}/handoff` **sudah dipakai**
  Section I (dispatch) — makanya `prefill`, bukan `handoff`.
- **FE**: `getStrategiPrefill(id)` (`web-internal/src/lib/strategi.ts`) + `InterviewPrefillPanel.tsx` dirender
  di tab Section A. **Suggestion-only, nol tulis:** AM menyalin & mengonfirmasi tiap angka di editor Section
  (aturan M6A "usulan→konfirmasi") — itu sebabnya **tak perlu kolom provenance `sumber='interview'`** di `strategi`.

> **Batas nyata (baca sebelum RAB-11):** permukaan prefill masih kecil. Banyak sumber `PREFILL_MAPPING`
> (B8-1..6, B10-1, B3-1/2, B2-1/12/14, B1-8/9, B6-2, B7-1/4/5/7) ada di seksi Blok B yang **belum diisi**
> (persis RAB-10). Yang beririsan dengan katalog interview yang wired hari ini: **B1-4→A-2, B2-8→A-3,
> B7-6→A-13, B7-3→A-15, B6-2→A-9, B7-9→C-7**. Jembatannya hidup & forward-compatible — permukaannya melebar
> otomatis saat RAB-18 mengisi seksi-seksi itu.

### 1.2 RAB-10 — status enam seksi Blok B ditetapkan (bukan digantung)
`web-internal/src/lib/interview-fields.ts` — `INTERVIEW_SECTIONS` tak lagi `wired:boolean` telanjang; tiap seksi
punya `status: SectionStatus`:
- **B0, B5, B8, B10, B11 = `ditunda_rab18`** — deskriptif/teks-bebas; tak ada katalog pertanyaan server & spek
  Interview masih prompt (bukan doc), jadi membangun input = mengarang ~80 field key yang tak dibaca skor →
  dilarang CLAUDE.md ("Never invent fields"). **Sengaja keluar cakupan** sampai RAB-18 (opsi sah DoD RAB-10).
- **B9 = `config_driven`** — muncul saat route config-driven melayaninya.
- Toggle seksi di halaman Interview menampilkan alasannya (`s.catatan` / label status).
- Keputusan dicatat: `docs/DECISIONS.md` 2026-08-18 (RAB-09 + RAB-10, baris teratas).

### 1.3 Verifikasi yang dijalankan
- **core 251 hijau** (`npm run -w @cdps/core test`; +3 tes `resolveStrategiPrefill`).
- **domain 1359 hijau** (serial, `npm run -w @cdps/domain test`; +3 tes `getStrategiPrefill` di
  `strategi.test.ts`).
- **api parity+wire 236 hijau** (`shape-parity`/`route-parity`/`wire`; `KNOWN_GAPS` kosong, +2 pasangan wire).
- **web-internal 257** (typecheck + eslint bersih; panel & lib baru presentational, dicakup typecheck).
- typecheck **core/domain/api/web-internal** bersih.
- **NOL migrasi/tabel/mesin/prefix/event baru** ⇒ gate 118/35/23/57 TETAP.

---

## 2. BERIKUTNYA — Wave C (`RISET_AWAL_BASELINE_BACKLOG.md` §3)

### RAB-11 · Isian riset awal → `strategi_channel` + `strategi_baseline_bulan`
Memenuhi CHECK Rule 5 yang **sudah ada** (`20260806064000_m6a_strategi.sql:278-296`): `periode_baseline_bulan`
(1–6) · `periode_mulai/akhir` · `sumber_data` · `tanggal_ambil_data` · `lampiran`.
**`cakupan_riwayat='kurang'` (<3 bulan) ⇒ `alasan_periode_pendek` wajib** (ditolak DB kalau kosong).
Ini beda dari RAB-09: RAB-09 mengalirkan **isian interview** ke Section A; RAB-11 mengalirkan **baseline riset
awal** (angka/lampiran) ke Section B channel — jalur yang sengaja TIDAK di-prefill RAB-09.

### RAB-12 · `gmv_mix` = rincian, BUKAN kanal · RAB-13 · Gerbang ACC pakai mesin #15
Lihat backlog §3. Lalu **Wave D** (RAB-14 `createPlanRow`+rute, RAB-15 12 rute M6B, RAB-16 brief-inherit,
RAB-17 STR-) dan **Wave E** (RAB-18 PRD Interview — **akar drift**, RAB-19 koreksi 5 baris PRD M6A/M6B, RAB-20
Build Plan).

---

## 3. Jebakan yang MASIH relevan
1. **Tes domain integration WAJIB serial** — `npm run -w @cdps/domain test`. Kalau "hang": cek Postgres hidup (§0.2).
2. **web-internal app Next MANDIRI** — `cd web-internal && npm install` terpisah.
3. **Mesin baseline di server, bukan browser.** Jangan impor `@cdps/core` ke `web-internal`.
4. **RAB-09 suggestion-only.** Jangan ubah jadi auto-write Section A tanpa keputusan storage provenance
   (`sumber='interview'` belum ada kolomnya — model ke `strategi_field_visibility` kalau kelak perlu).
5. **`/strategi/{id}/handoff` sudah dipakai Section I.** Prefill = `/strategi/{id}/prefill`.
6. **Set `PREFILL_MAPPING` & set dedup RAB-08 tetap SEMPIT** — melebarkan tanpa alasan merusak skor/baseline.
7. **RAB-10: jangan "isi" B0/B5/B8/B10/B11 dengan field karangan.** Mereka menunggu RAB-18. B9 config-driven.
8. Interview `am_pengisi_id` punya FK ke `employees` (clients/services tidak) — tes yang bikin interview harus
   seed baris employee dulu (lihat `seedScoredInterview` di `strategi.test.ts`).
9. Migrasi hanya lewat `supabase/migrations/**`; kalau nambah tabel, naikkan gate di DUA tempat.

---

## 4. Sumber kebenaran
- **Backlog:** `docs/backlog/RISET_AWAL_BASELINE_BACKLOG.md` · **Spek/keputusan:** `HANDOFF_M6ABC_SESI31.md`
  (+ SESI32/33/34/35).
- `docs/DECISIONS.md` 2026-08-18 (RAB-09 + RAB-10 di baris teratas).
- **Kode berubah sesi ini:**
  - `packages/core/src/interview.ts` (`resolveStrategiPrefill` + `StrategiPrefill`/`StrategiPrefillItem`) + `.test.ts`.
  - `packages/domain/src/strategi.ts` (`getStrategiPrefill` + `StrategiPrefill`) + `.test.ts`.
  - `apps/api/src/lib/wire.ts` (`StrategiPrefillWire`/`StrategiPrefillItemWire` + `strategiPrefillToWire`) +
    `shape-parity.test.ts` (FE_MAP) + rute baru `apps/api/src/app/api/v1/strategi/[id]/prefill/route.ts`.
  - `web-internal/src/lib/strategi.ts` (`getStrategiPrefill` + interfaces) ·
    `web-internal/src/components/strategi/InterviewPrefillPanel.tsx` (baru) ·
    `.../account/strategi/[id]/page.tsx` (fetch + render panel) ·
    `web-internal/src/lib/interview-fields.ts` (`SectionStatus` + status per seksi) ·
    `.../account/interview/[id]/page.tsx` (tampilkan alasan seksi).
- `CLAUDE.md` aturan rumah #1–#8.
