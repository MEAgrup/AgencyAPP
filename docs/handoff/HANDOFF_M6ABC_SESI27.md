# HANDOFF — M6A/M6B/M6C Sesi 27 (titik mulai sesi berikutnya)

> Rantai: … → SESI25 → SESI26 → **SESI27 (ini, terbaru)**. Baca yang bernomor
> tertinggi lebih dulu; sesi sebelumnya hanya konteks sejarah.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch (persis, akhir sesi 27)

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch tugas sesi ini** | `claude/plan-satuan-seam-job-dobeb5` — seam job Plan Satuan (§2 SESI26). |
| **Isi** | 1 commit: seam job Plan Satuan (#1 generasi periode + #2 dormansi) di `runPlanTick`. |
| **Cabang BARU dari `main` untuk kerja berikut** | `git fetch origin main && git checkout -B <branch-baru> origin/main` (setelah branch ini merge). |

### 0.1 Status modul — **M6A + M6B + M6C = 100%**; seam job Plan Satuan = SELESAI

| Modul | Status |
|---|---|
| **M6A Strategi** | ✅ 100% |
| **M6B Plan** | ✅ 100% |
| **M6C Plan Gate** | ✅ 100% |
| **Seam job Plan Satuan** | ✅ SELESAI sesi ini (#1 generasi periode berjalan + #2 dormansi otomatis). |

### 0.2 Posisi persis (akhir sesi 27)

| | |
|---|---|
| Migrasi | **80 berkas** · gerbang tabel **92** · mesin **18** · `KNOWN_GAPS` kosong |
| Test | core **137** · domain **1105** (+4 sesi ini, +1 skip) · api **344** · web-internal **191** — semua hijau |
| Typecheck | 5 paket bersih |
| Migrasi baru sesi ini | **NOL** — job murni perilaku di atas jalur tulis B-10 |

### 0.3 DB lokal — WAJIB, Postgres MATI SENDIRI

```bash
pg_ctlcluster 16 main start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""   # HANYA pertama kali
npm install
scripts/db-rebuild.sh --yes                 # 80 migrasi + seed + gate (92/18) + invariant
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  npx vitest run --root packages/domain      # full domain hijau (1105)
```

## 1. Apa yang berubah sesi ini (seam job Plan Satuan)

Detail penuh: `docs/DECISIONS.md` **2026-08-11 (Seam job Plan Satuan DIEKSEKUSI)** +
open item **X-20**. Semua di `packages/domain/src/plan.ts` + tesnya.

- **`runPlanTick` sekarang 5 sweep** (urutan sengaja): `sweepPlanSatuanPeriodeBerjalan`
  (#1) → `sweepPeriodeTransitions` (a) → `sweepPlanSatuanDormansi` (#2) →
  `sweepBelumDieksekusi` (b) → `sweepRealisasiBelumLengkap` (c). Alasan urutan di
  docstring `runPlanTick` (#1 sebelum (a) agar periode jendela-kini teraktivasi tick
  yang sama; #2 sesudah (a) agar periode yang dipaksa-tutup terhitung terminal).
- **#1 `sweepPlanSatuanPeriodeBerjalan`** — untuk tiap rantai `Aktif` yang punya
  service hidup, buat periode jendela anniversary-month kini (`Terjadwal`, via
  `openPlanSatuanPeriodeTx`). Idempoten (cek `tanggal_mulai = jendela.mulai`), kunci
  `plan_satuan` `FOR UPDATE`.
- **#2 `sweepPlanSatuanDormansi`** — rantai `Aktif` dengan **nol service hidup DAN
  nol periode non-terminal** → `markPlanSatuanDormant`. Menangkap `ConflictError`
  (balapan bangun) → lewati.
- **Sinyal "kerja aktif" = lifecycle service** (`planSatuanHasLiveService`): ada ≥1
  service tertaut (`service_plan_gate.plan_id` → periode klien) ber-status **BUKAN**
  terminal (`Done` / `[Cancelled — Service Voided]`). Konstanta `SERVICE_DONE` /
  `SERVICE_VOIDED` (cermin `client.ts`).
- **`PlanTickResult`** +2 field: `periodeSatuanDibuat: string[]`, `didormankan:
  string[]`. Endpoint tick cron-only → tanpa wire mapping.
- **Tes +4** di `plan.test.ts` (describe "Plan Satuan seam jobs"). `afterEach`
  diperluas: `delete from service_plan_gate` + `delete from plan ... or client_id
  like 'ZZ-CLI-%'` (menangkap periode buatan job aktor `SISTEM`).

### ⚠️ KEPUTUSAN PEMILIK yang dipakai (butuh ratifikasi — X-20)
Sinyal dormansi = **lifecycle service** (opsi a handoff SESI26 §2b). Ditanyakan ke
pemilik; **didelegasikan** (tak dipilih di prompt), jadi default rekomendasi
dieksekusi. Riset menutup caveat "cek dulu apakah status service ada di data" →
**ADA**. Kalau pemilik ingin semantik lain (dormansi manual-only, atau sinyal dari
kontrak/`durasi_bulan` bukan status service), balik di `planSatuanHasLiveService` /
kondisi `sweepPlanSatuanDormansi` — nol migrasi.

## 2. TUGAS BERIKUTNYA (kandidat, belum ada yang wajib)

Yang **bukan** fitur inti modul dan masih terbuka (dari SESI26 §0.1):

1. **De-eskalasi row-close** (butuh→tanpa Plan menutup baris Plan berjalan, Flow
   step 9) — tulisan lebih berat dari flip penentuan; masih seam.
2. **Emisi notif gate/Plan** — katalog terdaftar (O59-b); kalau dormansi/gate perlu
   notif, konfirmasi katalog dulu, **jangan karang event** (katalog Plan belum punya
   `rantai_didormankan`). Lihat X-20 (b).
3. **O54** — re-tier katalog live (33 entri): usul, butuh ratifikasi pemilik.

## 3. Open questions (detail `docs/DECISIONS.md` §Open)

| # | Inti | Status |
|---|---|---|
| X-20 | Sinyal dormansi Plan Satuan = lifecycle service (default rekomendasi) | 🟡 butuh ratifikasi pemilik; tak blokir |
| O54 | Re-tier katalog live (33 entri) | 🟡 butuh ratifikasi pemilik |
| X-19 | Sweep (b) pakai `status_baris='Rencana'`, bukan "tanpa Brief" | 🟡 tak blokir; ganti saat M7/M12 menautkan Brief↔baris |

## 4. Perintah pertama chat baru

```bash
git fetch origin main && git checkout -B <branch-baru> origin/main
pg_ctlcluster 16 main start && npm install && scripts/db-rebuild.sh --yes
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  npx vitest run --root packages/domain      # full domain hijau (baseline 1105)
```
