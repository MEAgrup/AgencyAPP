# HANDOFF — Riset Awal Baseline / Strategi: **Wave C SELESAI (RAB-11 + RAB-12 + RAB-13)** — Sesi 37

> Rantai: … → SESI34 (RAB-06/07, PR #175) → SESI35 (RAB-04 sisa + RAB-08, PR #176)
> → SESI36 (RAB-09 + RAB-10, PR #177 — **MERGE**) → **SESI37 (ini, terbaru — Wave C).**
> Baca yang bernomor tertinggi lebih dulu; **SESI31 tetap sumber SPEK & KEPUTUSAN** (jangan tanya ulang).
>
> **Status: RAB-01…RAB-13 SELESAI, teruji.** Wave A + B + **C** tuntas. Berikutnya **Wave D**
> (RAB-14…RAB-17, M6B route surface) + **Wave E** (RAB-18…RAB-20, dokumen).

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch & PR

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch sesi ini** | `claude/rab-11-13-handoff-axr4po` |
| **PR sesi ini** | **#<ISI setelah dibuat>** (base `main`) — RAB-11 + RAB-12 + RAB-13. |
| **Base saat kerja** | `main` (1801941, hasil merge #177). Branch di-restart dari `main`. |

**Cek status merge dulu sebelum lanjut RAB-14:**
- **Kalau PR sesi ini SUDAH merge:** restart branch baru dari main —
  `git fetch origin main && git checkout -B <branch-baru> origin/main`, kerjakan RAB-14 → PR baru.
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
Jangan `npx vitest run` dari ROOT (config root berbeda → failure PALSU rebutan `CLI-ZZI-0001`).
⚠️ **Tes count audit_log yang pakai id TETAP** (`admin.test.ts` hari libur, `client.test.ts` Hold Service)
gagal PALSU kalau suite dijalankan **dua kali tanpa `db-rebuild`** — mereka menghitung baris untuk id tetap
lalu ronde kedua melihat baris ronde pertama. Rebuild DB sebelum menjalankan ulang suite penuh.
⚠️ **Kalau tes domain "hang":** cek Postgres hidup (`psql -d cdps -c 'select 1'`), `pg_ctlcluster 16 main start`.

---

## 1. Yang SUDAH selesai sesi ini (jangan ulang)

### 1.1 RAB-11 — baseline riset awal → Section B channel prefill
Jalur yang RAB-09 **sengaja TIDAK** bawa. RAB-09 = isian interview → Section A; RAB-11 = **baseline riset
awal (angka + provenance Rule 5) → Section B channel** — persis kunci baseline numerik yang `isStrategiBaselineForbidden` drop di RAB-09.

- **Domain** `getBaselinePrefill(sql, actor, strategiId)` (`packages/domain/src/strategi.ts`): gerbang baca
  sama dengan `getStrategi`; menemukan interview klien terakhir selesai+terskor lewat helper bersama baru
  **`latestScoredInterview`** (di-refactor keluar dari `getStrategiPrefill` — dipakai KEDUANYA, jadi "interview
  mana" tak bisa menyimpang). Membaca `riset_awal_analisa` + `riset_awal_sumber_berkas`, mengomposisi **satu
  `ChannelBaselineSuggestion` per platform teranalisa**.
- Tiap saran membawa: `channel` (platform→taksonomi D1), `periodeBaselineBulan` (dari `gmv_baseline.bulan_terisi`),
  `cakupanRiwayat`, **`alasanPeriodePendekWajib`** (RAB-11 DoD dinaikkan ke UI: <3 bulan ⇒ DB CHECK
  `ck_strch_alasan_pendek` **dan** `validateChannel` menolak simpan tanpa alasan), provenance
  (`sumberData`/`lampiran`/`tanggalAmbilData` dari nama berkas), agregat `roas`/`adSpend`/`aov` di level kanal,
  dan `baselineBulan` dari `gmv_baseline.riwayat` — **hanya `gmv`+`jumlahPesanan`** (dua yang riwayat bawa
  per-bulan; belanja/ROAS/ACOS/persen-batal = **agregat periode**, TIDAK dikarang per bulan — "absent ≠ zero").
- **Rute** `GET /api/v1/strategi/{id}/baseline-prefill` (+ `strategiBaselinePrefillToWire` + 4 antarmuka wire,
  shape-parity FE_MAP dipasangkan). ⚠️ `/strategi/{id}/prefill` sudah RAB-09; ini `baseline-prefill`.
- **FE**: `getBaselinePrefill(id)` (`web-internal/src/lib/strategi.ts`) + `BaselinePrefillPanel.tsx` dirender
  di tab Section B. **Suggestion-only, nol tulis:** AM menyalin & mengonfirmasi tiap angka di editor Section B.

### 1.2 RAB-12 — `gmv_mix` = rincian DI DALAM platform, BUKAN kanal
`gmv_mix` (video/LIVE × afiliasi/toko + kartu produk) menempel sebagai `gmvMix` pada saran kanal **TikTok Shop
saja** — tak pernah jadi `ChannelBaselineSuggestion` tersendiri. Tes menegakkan: jumlah saran = jumlah platform
teranalisa, tak ada kanal bernama kategori mix, dan tiap kanal ada di taksonomi D1. Memetakan kategori mix ke
`strategi_channel` = memecah baseline satu platform jadi lima kanal fantom + menggandakan GMV.

### 1.3 RAB-13 — gerbang ACC pakai mesin #15 yang sudah ada
Baseline mengalir ke **Draft** Strategi dan diterima lewat mesin #15 (edge `Diajukan → Aktif` = ACC Head/SPV).
**Tidak ada gerbang/mesin kedua.** Tes: (a) DB menolak channel `Eksisting` <3 bulan tanpa `alasan_periode_pendek`
(RAB-11 DoD, `ck_strch_alasan_pendek`); (b) `getBaselinePrefill` **nol tulis** (0 baris `strategi_channel`
setelah dibaca); (c) edge ACC ada di mesin `strategi`, tak ada mesin `baseline`/`*_acc`.

### 1.4 Verifikasi yang dijalankan (DB fresh, sekali jalan)
- **domain 1366 hijau** (serial; +7: 5 `getBaselinePrefill` + 2 gerbang baseline).
- **api 338 hijau** (shape-parity +4 pasangan wire, route-parity `KNOWN_GAPS` kosong).
- **web-internal 257 hijau** + typecheck + eslint bersih.
- typecheck **domain/api/web-internal** bersih.
- **NOL migrasi/tabel/mesin/prefix/event baru** ⇒ gate **118/35/23/57 TETAP** (`db-rebuild` memverifikasi).

---

## 2. BERIKUTNYA — Wave D (`RISET_AWAL_BASELINE_BACKLOG.md` §4)

### RAB-14 · `createPlanRow` + rute
Satu-satunya lubang nyata di M6B: `plan_row` hari ini hanya di-insert di `plan.test.ts` lewat SQL mentah.

### RAB-15 · Rute untuk 12 fungsi domain M6B yang sudah ada
`generatePlanPeriods` · `submitPlanPeriode` · `approvePlanPeriode` · `returnPlanPeriode` · `activatePlanPeriode` ·
`adjustPlanTarget` · `approveTargetAdjustment` · `deriveWeeklyDistribution` · `setWeeklyDistribution` ·
`recordManualActual` · `fileSengketa` · `contractDeficit`. **Menulis rute, bukan logika.** Pola:
`requireActor` → validasi → domain. ⚠️ **12 rute = risiko O43** — badan respons snake_case lewat `wire.ts`,
tiap rute punya tes bentuk wire, `route-parity` hijau, `KNOWN_GAPS` kosong.

### RAB-16 · `brief-inherit.ts` + UI satu klik · RAB-17 · Jalur STR- tetap dilayani
Lihat backlog §4. Lalu **Wave E**: RAB-18 (PRD Interview — **akar drift**), RAB-19 (koreksi 5 baris PRD M6A/M6B),
RAB-20 (Build Plan + registry).

---

## 3. Jebakan yang MASIH relevan
1. **Tes domain integration WAJIB serial.** Kalau "hang": cek Postgres (§0.2). Rebuild DB sebelum run ulang
   (tes count audit id-tetap gagal palsu di run kedua tanpa rebuild).
2. **web-internal app Next MANDIRI** — `cd web-internal && npm install` terpisah.
3. **Mesin baseline di server, bukan browser.** Jangan impor `@cdps/core` ke `web-internal`.
4. **RAB-11 suggestion-only.** Jangan ubah jadi auto-write Section B tanpa keputusan storage provenance
   (`sumber='riset_awal'` belum ada kolomnya di `strategi_channel`; sama alasannya dengan RAB-09).
5. **`/strategi/{id}/prefill` = RAB-09 (Section A); `/strategi/{id}/baseline-prefill` = RAB-11 (Section B).**
6. **RAB-12: `gmv_mix` BUKAN kanal.** Jangan pernah emit kategori mix sebagai `ChannelBaselineSuggestion`.
7. **RAB-13: jangan buat gerbang ACC kedua.** Penerimaan baseline = `submitStrategi`→`approveStrategi` (mesin #15).
8. **`latestScoredInterview` dipakai RAB-09 & RAB-11.** Ubah "interview mana" di satu tempat itu, jangan salin.
9. Interview `am_pengisi_id` FK ke `employees` (clients/services tidak) — tes yang bikin interview seed employee
   dulu (`seedScoredInterview`). `client_platforms` TIDAK cascade dari `clients` — hapus sebelum clients (afterEach).
10. Migrasi hanya lewat `supabase/migrations/**`; kalau nambah tabel, naikkan gate di DUA tempat.

---

## 4. Sumber kebenaran
- **Backlog:** `docs/backlog/RISET_AWAL_BASELINE_BACKLOG.md` (§3 = Wave C, §4 = Wave D) · **Spek/keputusan:**
  `HANDOFF_M6ABC_SESI31.md` (+ SESI32…36).
- `docs/DECISIONS.md` 2026-08-18 (RAB-11+12+13 di baris teratas).
- **Kode berubah sesi ini:**
  - `packages/domain/src/strategi.ts` (`getBaselinePrefill` + tipe `ChannelBaselineSuggestion`/`BaselineMonthSuggestion`/`GmvMixRincian`/`StrategiBaselinePrefill` + helper `latestScoredInterview` + `platformToChannel`) + `.test.ts`.
  - `apps/api/src/lib/wire.ts` (`strategiBaselinePrefillToWire` + 4 antarmuka wire) + `shape-parity.test.ts` (FE_MAP +4) + rute baru `apps/api/src/app/api/v1/strategi/[id]/baseline-prefill/route.ts`.
  - `web-internal/src/lib/strategi.ts` (`getBaselinePrefill` + 4 antarmuka) · `web-internal/src/components/strategi/BaselinePrefillPanel.tsx` (baru) · `.../account/strategi/[id]/page.tsx` (fetch + render panel di Section B).
- `CLAUDE.md` aturan rumah #1–#8.
