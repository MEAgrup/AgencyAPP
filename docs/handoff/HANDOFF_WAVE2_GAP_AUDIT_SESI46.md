# HANDOFF — B4-residual: baseline gate KPI-GMV kini HIDUP dari reporting — Sesi 46

> Rantai: … → SESI44 (C1 bagian 1: mesin + skema) → SESI45 (C1 bagian 2: domain +
> API + FE) → **SESI46 (ini, terbaru — B4-residual: baseline gate KPI-GMV dari
> `clients.total_sales`).** Baca yang bernomor tertinggi lebih dulu.
>
> **Status: B4-residual SELESAI. Gap Wave 2 yang bisa dikerjakan = HABIS.** Sisa
> hanya C2/C3 yang ditunda by-design (pipeline affiliate-link tracking belum ada).
> **Wave 2 boleh dianggap tutup → Wave 3 bisa dimulai** (lihat §3).

---

## 0. CARA MELANJUTKAN

### 0.0 Posisi branch & PR
| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch** | `claude/baca-handoff-b4-residual-bb2wr3`. Cabang dari `main` **setelah** #186 (C1) merged. |
| **Migrasi** | **119** total (NOL migrasi baru sesi ini — B4-residual murni domain: 1 helper + 1 kolom query + 2 tes). |
| **Gate** | `tabel public` **121** · `entity_prefix` 35 / `sm_machines` 23 / `notif_events` 58 **TETAP** — nol prefix/mesin/event baru. |
| **Keputusan** | `docs/DECISIONS.md` **2026-08-19** baris teratas ("B4-residual"). |

### 0.1 Aturan main (tak berubah) — lihat SESI44/45 §0.1 + `CLAUDE.md`
- Tes domain WAJIB serial (`--no-file-parallelism`); rebuild DB setelah migrasi baru.
- Wire snake_case lewat `apps/api/src/lib/wire.ts`; `null` eksplisit.
- `route-parity` `KNOWN_GAPS` **tetap kosong**.

### 0.2 Setup di container baru
```bash
service postgresql start
su postgres -c "psql -d postgres -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
npm ci                                          # WAJIB — tanpa ini @cdps/core tak ketemu saat test
bash scripts/db-rebuild.sh --yes                # harus lapor 'tabel public 121'
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
( cd packages/domain && npx vitest run src/ads.test.ts --no-file-parallelism )   # 24 hijau
```

---

## 1. Yang SELESAI sesi ini (jangan ulang)

**Konteks.** B4 (DECISIONS 2026-08-18) memasang gate: Advertiser tak boleh self-set
target GMV < `gmv_baseline × 1.20` (pertumbuhan 20%/kuartal) tanpa ACC SPV Ads.
Tapi `gmv_baseline` = angka onboarding **statis** yang tak pernah bergerak. B4-residual
sengaja ditunda sampai ada GMV hidup. C1 (SESI44/45) kini menulis `clients.total_sales`
= Σ run-rate bulanan laporan terbaru per toko aktif ⇒ datanya ADA.

**Keputusan pemilik (Nerissa, 2026-08-19, opsi "max(statis, hidup) × 1.20").**
Baseline efektif gate = **yang lebih besar** antara `gmv_baseline` onboarding dan
`total_sales` run-rate hidup; floor = baseline efektif × 1.20.
- **Kenapa `max`, bukan replace:** aman dua arah. Floor tak pernah turun di bawah
  harapan onboarding (cegah target rendah), TAPI naik ikut performa nyata (klien yang
  sudah tumbuh 2× tak diukur dengan angka basi; cegah sandbag setelah toko besar).

**Perubahan kode (`packages/domain/src/ads.ts`):**
- Helper murni baru **`effectiveGmvBaseline(staticBaseline, liveRunrate) = max`** (exported).
- `createCampaign`: query diperluas ambil `cl.total_sales`; hitung
  `baseline = effectiveGmvBaseline(parse(gmv_baseline), parse(total_sales))`; teruskan
  ke `gmvTargetBelowStandard(targetKpi, baseline)` — **`gmvTargetBelowStandard` &
  `parseGmvTarget` TAK berubah** (rasio 6/5 tetap). Pesan BI `MSG_KPI_BELOW_STANDARD` tetap.
- Bila belum ada laporan, `total_sales`=0 ⇒ `max` = baseline statis ⇒ **nol perubahan
  perilaku** (status quo aman).

**Tes (`packages/domain/src/ads.test.ts`, +2):**
- unit `effectiveGmvBaseline`: ambil yang lebih besar (live>static, static>live, live=0→static, static=0→live).
- DB `B4-residual`: client run-rate hidup 100jt ⇒ floor naik 12jt→120jt; target 90jt
  yang dulu lolos kini **diblok** `MSG_KPI_BELOW_STANDARD`; target 120jt **lolos**.

## 1.1 Verifikasi (DB fresh 119 migrasi, 121 tabel)
- `ads.test.ts` **24 hijau** (dari 22; +2 sesi ini).
- `tsc --noEmit` domain bersih **selain** deprecation `TS5101 baseUrl` — pra-ada,
  tingkat tsconfig, TS 5.9 mem-warning-nya sebagai error; BUKAN dari perubahan ini.
  (Bila mau bersih total: tambah `"ignoreDeprecations": "6.0"` di tsconfig — di luar scope.)
- `db-rebuild.sh --yes`: 121 tabel + semua gate + 4 invariant hijau.

## 2. Jebakan khusus sesi ini
1. **`total_sales` = satuan run-rate BULANAN** (C1 keputusan 3), sama satuan dengan
   `gmv_baseline`/`target_gmv`. Aman dibandingkan langsung — jangan skala ulang.
2. **`max`, bukan replace.** Kalau nanti ada yang "menyederhanakan" jadi `total_sales`
   saja, itu MENGUBAH keputusan pemilik (slump GMV akan melonggarkan gate). Butuh entri
   DECISIONS baru untuk membaliknya.
3. **`total_sales` penulis tunggal = mesin laporan (C1).** B4-residual **membaca** kolom
   itu, tak menulisnya. Jangan tambah penulis tandingan (CLAUDE.md: dua versi kebenaran).
4. **`npm ci` wajib sebelum test** — tanpa install workspace, `@cdps/core` tak ketemu
   dan suite gagal load (bukan gagal assert).

## 3. BERIKUTNYA — Wave 2 sudah HABIS item yang bisa dikerjakan → Wave 3

**Sisa Wave 2 (semua ditunda by-design, JANGAN mulai tanpa keputusan pemilik baru):**
- **C2 (M9 §10.3)** — Attributed GMV dari affiliate-link tracking (kini diketik manual).
- **C3 (M7 §8 Rule 3)** — review-and-lock bulanan Attributed GMV.
- Keduanya butuh **pipeline affiliate-link tracking yang belum ada sama sekali**.
  Pemilik sudah bilang affiliate tracking dikerjakan **nanti** ⇒ ini bukan blocker Wave 3.
- **B1-residual** (tabel `creator_blacklist`) & **B2-residual** (aksi SPV→Director eksplisit
  + notif) — kecil, opsional, "hanya bila dibutuhkan"; butuh keputusan bentuk dari pemilik.

**⇒ Wave 2 boleh ditutup. Wave 3 (Attribution, visibility & scoring) bisa dimulai:**
Epics **M2, M3, M11, M13, M14, M15** (Build Plan §Wave 3; M15 Client Portal **terakhir**,
setelah spec keamanan Portal). Exit criteria Wave 3: satu dashboard menampilkan Health band
tiap klien; staff melihat skor bulanannya + breakdown; satu pilot client login Portal.

**Dua prasyarat Wave 3 (Build Plan §risk, kerjakan lebih dulu):**
1. **Spec keamanan Portal detail** ditulis **sebelum** Wave 3 (minimum sudah di Phase 0 v2 §11).
2. **Cek embeddability `mea-client-reporting`** (R2, "one afternoon"). Fallback: M15 link-out.
3. (R6) Data target/benchmark M14 & ROAS — data operasional, harus masuk selama Wave 2 agar
   scoring Wave 3 pakai angka nyata, bukan placeholder. Konfirmasi ke SPV Ads + OD.

**Catatan bagus untuk Wave 3:** M13 Health Score kini punya **sinyal GMV hidup** (C1) —
komponen GMV Growth (§6.2 #5) yang dulu buta kini terisi. Wave 3 M13 tinggal membacanya.

## 4. Sumber kebenaran
- `docs/DECISIONS.md` 2026-08-19 (baris teratas — B4-residual; di bawahnya C1 bagian 1 & 2).
- `docs/backlog/WAVE2_GAP_AUDIT.md` — B4-residual ✅; sisa hanya C2/C3.
- Kode: `packages/domain/src/ads.ts` (`effectiveGmvBaseline`, `createCampaign`) +
  `ads.test.ts`. Pola B4 asli: DECISIONS 2026-08-18.
- Pipa GMV hidup: `packages/domain/src/report.ts` (`recomputeTotalSales`).
