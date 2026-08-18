# HANDOFF — Riset Awal Baseline: **RAB-01 + RAB-02 selesai, lanjut RAB-03** — Sesi 32

> Rantai: … → SESI30 (pengukuran waktu riset awal) → SESI31 (spek + keputusan pemilik, nol kode)
> → **SESI32 (ini, terbaru — kode pertama: RAB-01 + RAB-02 + resolusi §5)**.
> Baca yang bernomor tertinggi lebih dulu; SESI31 tetap sumber SPEK & KEPUTUSAN (jangan tanya ulang).
>
> **Status: RAB-01 (skema+RLS) + RAB-02 (mesin baseline) SELESAI, teruji, di PR #173.**
> Berikutnya mulai **RAB-03** (`docs/backlog/RISET_AWAL_BASELINE_BACKLOG.md`).

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch & PR

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch sesi ini** | `claude/store-mgmt-svc-handoff-morjwg` |
| **PR** | **#173** → base `main` (RAB-01 + RAB-02 + resolusi §5). 3 commit di atas `main`. |
| **Commit di branch** | `dae0107` (docs SESI31) · `fb89f4d` (RAB-01 + §5) · `422e53d` (RAB-02) |
| **Base `main` saat PR dibuat** | `210ba4a` |

**Mulai kerja berikut — CEK STATUS PR #173 DULU:**
- **Kalau #173 SUDAH merge:** jangan menumpuk di atas history yang sudah merge. Restart branch dengan nama SAMA dari main:
  `git fetch origin main && git checkout -B claude/store-mgmt-svc-handoff-morjwg origin/main`, lalu kerjakan RAB-03 sebagai perubahan baru → PR baru.
- **Kalau #173 BELUM merge:** lanjut di branch ini, tambahkan commit RAB-03 di atas `422e53d`.

### 0.1 Aturan main yang MASIH berlaku (dari SESI31 §0.2 — jangan dilanggar)
- **PRD boleh dikoreksi** di 5 titik Wave E (RAB-19) lewat `DECISIONS.md`; di situ aturan `CLAUDE.md` "PRD menang" TIDAK berlaku. Jangan berhenti dengan alasan "PRD melarang".
- Migrasi HANYA lewat `supabase/migrations/**` + `apply_migration`. DB lokal dibangun ulang HANYA lewat `scripts/db-rebuild.sh`.
- Tulis via service-role + gate domain; RLS memikul row-scope. Badan respons wire snake_case lewat `apps/api/src/lib/wire.ts`.

---

## 1. Yang SUDAH selesai sesi ini (jangan ulang)

### 1.1 Resolusi §5 (handoff SESI31 §5) — `DECISIONS.md` 2026-08-17
- **§5.1 SheetJS** — `xlsx@0.18.5` = **Apache-2.0** (diverifikasi dari tarball npm, bukan ingatan). Aman dibundel; pin `0.18.5` (rilis registry-npm terakhir). Edisi "Pro" = produk terpisah.
- **§5.2 satuan** — `median_6m`/`runrate_3m` keduanya **per bulan**; `B1-5` = total **3 bulan**. **JANGAN petakan `median_6m`→`B1-5`** (salah satuan ~3× ⇒ verdict bergeser). `median_6m`/`runrate_3m` → **baseline GMV** (RAB-05/RAB-11). Kalau B1-5 kelak di-prefill: sumbernya total 3 bulan = `runrate_3m × 3`, bertanda usulan + konfirmasi, dirakit server (RAB-06).

### 1.2 RAB-01 — migrasi `supabase/migrations/20260817000000_riset_awal_baseline_schema.sql`
4 tabel (semua `bigint IDENTITY` / kunci alami / `versi` integer ⇒ **nol prefix baru**):
- **`riset_awal_analisa`** (per riset awal × platform aktif, FK `client_platforms`): `payload` immutable (append-only, trigger `trg_analisa_frozen`); `kondisi_toko` CHECK **5 nilai**; CHECK `manual ⇒ belum_dapat_diukur + skor NULL`; `skor` hanya dari `analisa_penuh` & wajib `benchmark_versi + parser_versi`.
- **`riset_awal_sumber_berkas`**: sha256 + tipe + periode + rows; fakta beku, hanya `tipe_override` editable.
- **`interview_riset_awal_isian`** (pola `interview_answer`): `sumber` (`analisa|manual|sales`) + `nilai_usulan` (beku via UPDATE trigger) + `dikonfirmasi`. **DELETE hanya via cascade** (guard DELETE-forbid DIHAPUS karena memblok cascade & mengunci interview — lihat catatan di migrasi).
- **`riset_awal_benchmark`**: 16 ambang BENCH berversi, Director-only, append-only, **default-deny** (dibaca via service-role). v1 di-seed.
- RLS cermin `interview_riset_awal` (Account-scope, Sales default-deny). Arm lead/divisi **DI-INLINE** ⇒ **nol perubahan ledger O48** (`rls_checks.sql §42`).
- Gerbang CI **tabel 114→118** di `.github/workflows/ci.yml` **dan** `scripts/db-rebuild.sh` (mesin **23**, prefix **35**, event **57** TETAP).
- Tes: `packages/domain/src/riset-awal-baseline.rls.test.ts` (32) — RLS 7 peran, immutability `payload`+`nilai_usulan`, CHECK `manual⇒null` menggigit di DB.

### 1.3 RAB-02 — `packages/core/src/baseline/` (15 modul + tes)
Port DOM-free & deterministik dari `docs/design/BASELINE_TOOL_TIKTOK_v1.html`. Diekspor lewat `@cdps/core` sebagai `baseline`.
- `angka.ts` (`n(v,raw)`, div/mul/median/fx/clamp, formatter Rp) · `sheet.ts` (heuristik header) · `detect.ts` (12 tanda-tangan) · `metrik.ts` (C.*) · `riwayat.ts` (histStats) · `skor.ts` (5 pilar) · `meter.ts` · `temuan.ts` (TANTANGAN) · `payload.ts` (`cdps.baseline.tiktok.v1` + `kondisiTokoFromScore`) · `run.ts` (`runBaseline`) · `benchmark.ts` (`BENCH_V1`) · `errors.ts` (`BaselineError`) · `types.ts`.
- **4 fix diterapkan:** #1 `mul(x,100)` semua situs + `meter()` `''` untuk null · #2 kolom wajib absen ⇒ gagal keras `[...]`, opsional absen ⇒ `null` (bukan 0) · #3 `detect()` toko-vs-afiliasi dari `linkedAccounts` CDPS (ambigu ⇒ ditandai) · #4 benchmark = parameter berversi.
- **xlsx binary-parse SENGAJA di luar core** — `sheet.ts` menerima AoA (`unknown[][]`), yaitu keluaran `XLSX.utils.sheet_to_json(ws,{header:1})`. Parse biner ada di boundary FE/adapter (RAB-04). ⇒ core nol dependensi baru.
- Tes: `packages/core/src/baseline/baseline.test.ts` (17). Core total **240** lulus.

### 1.4 Verifikasi yang sudah dijalankan
- `scripts/db-rebuild.sh --yes` hijau di **118 tabel** + 4 invariant SQL (ident/immutability/rls/auth) PASS.
- `packages/domain` RLS test 32/32; `packages/core` 240/240; typecheck core & domain bersih.
- DB lokal: Postgres 16 cluster (`pg_ctlcluster 16 main start`), `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/cdps` (password sudah di-set di sesi ini; kalau container baru, set ulang `ALTER USER postgres PASSWORD 'postgres'`).

---

## 2. BERIKUTNYA — RAB-03 dan seterusnya (`RISET_AWAL_BASELINE_BACKLOG.md`)

Urutan wave tak berubah. Mulai **RAB-03**.

### RAB-03 · `belum_dapat_diukur` + pengaman kosakata
CHECK 5-nilai `kondisi_toko` **sudah** di RAB-01. Yang KURANG = **tes**, bukan skema:
- **Tes irisan kosakata**: enum verdict Blok C (`growth_ready/bersyarat/risiko_tinggi/tidak_siap`) ∩ enum Kondisi Toko (5 nilai) = ∅ ⇒ CI merah kalau beririsan. (Sebagian sudah dicicil di `baseline.test.ts` "vocabulary disjoint" + `riset-awal-baseline` — jadikan tes eksplisit permanen, idealnya di level yang membaca KEDUA enum dari sumbernya.)
- **Tes Kondisi Toko tak pernah memicu** `kualifikasi_tidak_siap` atau gerbang Blok C.
- **Tes `belum_dapat_diukur` ⇒ nol TANTANGAN.**
- ⚠️ `belum_dapat_diukur` ≠ `mesin_belum_terbangun` — jangan dilebur (handoff SESI31 §2.3). `kondisiTokoFromScore()` di `payload.ts` HANYA menghasilkan 4 nilai terhitung; `belum_dapat_diukur` di-set caller (manual/Tokopedia tipis).

### RAB-04 · Halaman riset awal per-platform + konfirmasi per angka (`RisetAwalPanel.tsx`)
- Sub-bagian **diturunkan dari `client_platforms` aktif** — JANGAN buat tombol pilih platform.
- Di sinilah **xlsx bundel npm** dipakai (adapter: bytes → `XLSX.utils.sheet_to_json(header:1)` → `readSheet` → `detect` → `runBaseline`). `detect().ambiguous` ⇒ minta AM konfirmasi toko/afiliasi.
- Entri manual minimal (keputusan 5): GMV/bulan · order · AOV · SKU · belanja iklan · ROAS. Platform non-TikTok ⇒ `metode_baseline='manual'`, `kondisi_toko='belum_dapat_diukur'`, `skor NULL` (CHECK memaksa).
- Output **POST** ke CDPS (bukan clipboard). Waktu dari modul `tz` WIB server, `generatedAt` diinjeksi (payload sudah menerima param ini). Kirim `null` eksplisit, bukan `omitempty`.
- Submit butuh **setiap field berskor terkonfirmasi**.

### RAB-05 · Field terisi otomatis
`toko.aov`→`B2-9` · `produk.sku_total`→`B2-3` · `gmv_baseline.median_6m/runrate_3m`→**baseline GMV** · `iklan.roas`→baseline ROAS · `arah_strategi`→catatan arah (usulan). ⚠️ `B3-3`/`B7-3` TETAP pertanyaan interview. ⚠️ **median_6m ≠ B1-5** (§5.2, sudah diputus).

### RAB-06 · Tutup kebocoran provenance skor
`SCORED_FIELD_KEYS` & `hitungKualifikasi` **nol perubahan**. Ubah `scoreInterview` (`packages/domain/src/interview.ts:747`) + `POST …/score`: rakit `KualifikasiInput` dari **kedua** tabel, **abaikan** nilai kunci riset awal dari body. **Tes terpenting: fixture Alpha Digital ⇒ skor + verdict Blok C IDENTIK sebelum/sesudah.**

### RAB-07 · Gerbang prasyarat (Interview butuh riset awal submit)
⚠️ **"Selesai" per-platform**: setiap `client_platforms` aktif punya baseline (analisa **atau** manual). **Tes anti-deadlock Shopee-only WAJIB** (Shopee 156× vs TikTok 16× di seed).

**Wave B** (RAB-08 dedup pertanyaan · RAB-09 hidupkan `PREFILL_MAPPING`+`handoffKeStrategi` nol pemanggil produksi · RAB-10 6 seksi B0/B5/B8-B11).
**Wave C** (RAB-11 isian→`strategi_channel`+`strategi_baseline_bulan`, CHECK `alasan_periode_pendek` wajib kalau <3 bulan · RAB-12 `gmv_mix` = rincian dalam-platform BUKAN kanal · RAB-13 gerbang ACC pakai mesin #15).
**Wave D** (RAB-14 `createPlanRow`+rute · RAB-15 rute ~12 fungsi M6B, risiko O43 wire snake_case · RAB-16 `brief-inherit.ts` satu-klik · RAB-17 STR- tetap dilayani).
**Wave E — WAJIB di PR yang SAMA dengan Wave A-D** (RAB-18 BUAT PRD Interview · RAB-19 koreksi 5 baris PRD M6A/M6B satu entri DECISIONS · RAB-20 Build Plan + DATA_MODEL + STATE_MACHINES).

---

## 3. Jebakan yang MASIH relevan (dari SESI31 §4 — jangan diabaikan)
1. **Gerbang prasyarat + analisa TikTok-only = deadlock** (RAB-07). Tes anti-deadlock wajib.
2. `gmv_mix` BUKAN baseline per-kanal (RAB-12).
3. 6 field berskor (`B1-5,B2-9,B2-3,B4-9,B3-3,B7-3`) — `SCORED_FIELD_KEYS` & `hitungKualifikasi` **nol perubahan**; fixture Alpha Digital IDENTIK.
4. Kebocoran provenance — server merakit `KualifikasiInput`, abaikan body (RAB-06).
5. `B3-3`/`B7-3` tetap pertanyaan interview.
6. 12 rute M6B = risiko O43 (wire snake_case).
7. Jangan matikan STR- sebelum UI pindah; `KNOWN_GAPS` tetap kosong.
8. Migrasi hanya lewat `supabase/migrations/**`.
9. Gerbang CI: kalau nambah tabel, naikkan **DUA** tempat (`ci.yml` + `db-rebuild.sh`). Event baru ⇒ versi katalog baru.

---

## 4. Sumber kebenaran
- **Backlog:** `docs/backlog/RISET_AWAL_BASELINE_BACKLOG.md` · **Spek/keputusan:** `docs/handoff/HANDOFF_M6ABC_SESI31.md` (§1 keputusan, §2 verifikasi, §4 jebakan, §5 [SUDAH diselesaikan]).
- **Arsip tool (rujukan port satu arah):** `docs/design/BASELINE_TOOL_TIKTOK_v1.html`. Mesin sudah diport ke `packages/core/src/baseline/` — **jangan pelihara paralel**.
- `docs/DECISIONS.md` 2026-08-17 (resolusi §5 + 7 keputusan pemilik).
- **Kode baru sesi ini:** `supabase/migrations/20260817000000_riset_awal_baseline_schema.sql` · `packages/core/src/baseline/*` · `packages/domain/src/riset-awal-baseline.rls.test.ts`.
- `CLAUDE.md` aturan rumah #1-#8.
