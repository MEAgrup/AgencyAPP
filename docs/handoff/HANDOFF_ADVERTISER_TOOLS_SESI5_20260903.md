# HANDOFF — sesi 5: UI Gelombang 2+3, migrasi live, UAT export asli, SHP-1/2/3 tuntas

**Tanggal:** 2026-09-03 (sesi lanjutan KELIMA hari yang sama). **BACA INI
DULU.** Handoff sebelumnya masih ada sebagai riwayat tapi sebagian usang:
`HANDOFF_ADVERTISER_TOOLS_UI_20260903.md` →
`HANDOFF_ADVERTISER_TOOLS_SC08_20260903.md` →
`HANDOFF_ADVERTISER_TOOLS_G2G3G4_20260903.md`.

**Branch:** `claude/advertiser-tools-consolidation-handoff-96gswr` (dari
`origin/main` pasca-merge PR #277)
**Pemilik permintaan:** Nerissa (COO)

---

## 0. Posisi persis — SALIN KE SESI BERIKUTNYA

| | |
|---|---|
| **Repo / branch** | `MEAgrup/AgencyAPP`, `claude/advertiser-tools-consolidation-handoff-96gswr` — sudah di-push |
| **PR** | Dibuka sesi ini (lihat §5). Base `main`. **Jangan merge sendiri** — itu keputusan pemilik. |
| **PR #276 / #277** | SUDAH MERGE sebelum sesi ini. Jangan cari lagi. |
| **Rencana 4 gelombang** | G1 ✅ · G2 ✅ · G3 ✅ — ketiganya kode + UI + **migrasi sudah di live** · **G4 belum dimulai** |
| **Live `CDPS SG`** | ✅ SINKRON dengan `main` per akhir sesi ini. `entity_prefix` 39 · relasi 144 · `sm_machines` 31 · `notif_events` 67 · `report_benchmark_shopee` 1 baris aktif v1 |
| **Keputusan pemilik terbuka** | **NOL** untuk Gelombang 1–3. SHP-1/2/3 ✅ RESOLVED & dibangun. Sisa: **SCR-UI-1** (nice-to-have, tidak blocking) + **O65** (ledger migrasi live, lama terbuka) |
| **⚠️ Yang belum pernah terjadi** | Belum ada satu laporan pun (TikTok maupun Shopee) yang **diterbitkan lalu dibaca kontak klien sungguhan**. Itu aksi pemilik/AM, bukan sesi Claude. |

---

## 1. Yang landed sesi ini — empat commit

| Commit | Isi |
|---|---|
| `b69e69b` | **SH-07** UI form laporan Shopee (`ShopeeReportForm.tsx`, radio mesin di `ReportPanel`, `parseShopeeExportFile`, pemilih kampanye yang dikecualikan + rute baca `GET /clients/{id}/reports/shopee/campaigns`) |
| `ce8f4eb` | **SC-09** UI SKU Screener `/ads/screening` — 4 tab (A screening, B sebelum/sesudah, C Decision Log, D Tracker), `skuscreener-ui.ts`, gate `canUseSkuScreener`, nav + tautan dari halaman kampanye Ads |
| `95991c1` + `cb9d877` | Dokumen: DECISIONS/backlog/plan/handoff, **migrasi diterapkan ke live**, laporan UAT export asli |
| `d9ae949` | **SHP-1 + SHP-3** (SHP-2 sengaja nol perubahan) — lihat §3 |

Rincian desain SH-07 & SC-09 (tujuh keputusan yang jangan dibongkar tanpa
alasan baru) ada di `HANDOFF_ADVERTISER_TOOLS_UI_20260903.md` §1 — masih
akurat, tidak diulang di sini.

---

## 2. Migrasi live — sudah diterapkan, cara verifikasinya

`gelombang3_sku_screener` (ledger live `20260903160219`) dan
`sh01_shopee_report_engine` (`20260903160257`), lewat
`mcp__Supabase__apply_migration`, **bukan `supabase db push`** (O65: ledger
live memakai timestamp saat apply, jadi nama berkas repo tidak cocok dan
`db push` bisa salah menilai apa yang sudah ada).

**Pola yang dipakai dan sebaiknya diulang untuk migrasi live berikutnya:**

1. Diff daftar relasi live vs lokal-pra-migrasi **DUA ARAH** — nol drift baru
   boleh apply.
2. Cek tabel yang akan kena `ADD CONSTRAINT` benar-benar kosong / lolos
   constraint-nya. (Di sini `client_reports` 0 baris, jadi
   `ck_report_benchmark_by_schema` tidak punya baris lama untuk divalidasi.)
3. Grep DDL-nya lebih dulu: nol `DROP`/`UPDATE`/`TRUNCATE`.
4. Sesudah apply, cocokkan gate hitungan dengan lokal (prefix, relasi, mesin,
   notif, RLS, trigger).

**Berkas migrasi di repo masih memuat komentar "NOT applied to the live
Supabase project this pass"** — itu peninggalan sesi sebelumnya dan sekarang
salah. Sengaja TIDAK diedit: menyunting migrasi yang sudah diterapkan adalah
kebiasaan buruk. Kenyataannya tercatat di `DECISIONS.md` dan di sini.

---

## 3. SHP-1 / SHP-2 / SHP-3 — apa yang berubah dan mengapa

Ketiganya lahir dari UAT export ASLI (Fim Motor Juli 2026, 15 berkas) dan
dijawab pemilik hari yang sama. Laporan lengkap + hitungannya:
**`docs/handoff/UAT_SHOPEE_FIM_MOTOR_20260903.md`** (§2–§4 keadaan SEBELUM,
**§7 keadaan SESUDAH**).

### 3.1 SHP-1 ✅ — GMV kotor dan bersih berhenti jadi angka yang sama

Berkas Bisnis — Home memuat tabel yang SAMA **tiga kali**, satu per status
pesanan. Engine cuma membaca dua; yang ketiga (**Pesanan Dibayar**) tidak
diparse sama sekali. Akibatnya `gmv_kotor` dan `gmv_net` diisi angka identik,
dan `clients.total_sales` menghitung pesanan batal sebagai penjualan.

| | Nilai | |
|---|---|---|
| `gmv_kotor` | Rp 1.624.937.476 | Pesanan Dibuat |
| `gmv_net` | Rp 1.329.227.354 | Pesanan **Dibayar** (baru) |
| selisih | Rp 295.710.122 (18,2%) | di dalamnya Rp 359.295.534 batal + Rp 24.586.464 retur |

**Rantai yang bergerak:** `gmv_net` → `gmv_runrate_bulanan` →
`recomputeTotalSales` → `clients.total_sales` → **Health Score M13**. Jadi
keputusan pemilik ("bersih = Dibayar") memindahkan skor kesehatan klien Shopee
ke uang yang benar-benar masuk.

**Fallback dinyatakan, bukan senyap.** Export tanpa bagian ketiga (export lama,
dan fixture engine sendiri) → `kpi.dibayar` null → net jatuh ke gross DAN
`payload.periode.gmv_bersih_sumber = 'tidak_tersedia'`, dan kartu bersih di
laporan berbunyi "export tidak memuat bagian Pesanan Dibayar". **Jangan** ubah
ini jadi fallback diam-diam.

**`client_reports` beku** (aturan rumah #3): laporan yang SUDAH ada tidak
dihitung ulang — `gmv_net` mereka tetap gross. Hanya laporan baru yang ikut
basis Dibayar. Di live belum ada laporan Shopee sama sekali, jadi praktisnya
nol baris terdampak; TikTok tidak berubah sama sekali.

### 3.2 SHP-2 ✅ — nol perubahan, sengaja

Pemilik memilih **biarkan**. Ambang `skor.ts` (≥8 SEHAT / ≥6 PERLU PERHATIAN /
<6 KRITIS) tetap port apa adanya. Toko dengan skor 5,7 tetap dilabeli **KRITIS**
ke klien walau ROAS 9,63× dan ketiga flag iklan hijau. **Jangan "perbaiki" ini**
— itu keputusan pemilik yang sudah dicatat.

### 3.3 SHP-3 ✅ — deteksi berhenti menaruh berkas di slot yang salah

`detectModuleFromRawName` di `report/shopee/detect.ts`: 19 pola stem nama
export Seller Centre, sebagai lapisan nama **KEDUA**.

**Urutan tiga lapisan (jangan diubah):**
1. konvensi rename tim (`parseFilename`) — pernyataan niat manusia, tetap menang;
2. stem nama export mentah (baru) — dugaan tentang nama buatan mesin;
3. tanda-tangan isi — pilihan terakhir, dan yang UAT buktikan menaruh berkas di
   slot SALAH ketika harus menebak.

Di dalam tabel pola, **yang sempit didahulukan**: `chat_broadcast` sebelum
`chat`, kalau tidak setiap export broadcast mendarat di `layanan_chat`. Ada
test khusus untuk urutan ini.

**Tiga pola ads ditandai ⚠️** karena bacaan atas tujuan export, bukan tipe yang
dinyatakan. Biaya salahnya paling kecil: `ads_toko`/`ads_produk`/`ads_banner`
memakai SATU parser dan DIJUMLAHKAN untuk setiap angka terhitung — tertukar di
antara ketiganya memindahkan kampanye antar daftar tampilan dan tidak mengubah
satu angka pun. Diverifikasi: kedua berkas iklan disjoint (Σ biaya
127.142.120 + 6.200.000 = 133.342.120, persis total engine), jadi lapisan ini
tidak bisa menimbulkan double-count.

`Laporan-tanpa-judul-…` (Meta CPAS) **sengaja tidak** dikenali dari nama —
"laporan tanpa judul" nol informasi tipe, dan tanda-tangan isinya sudah benar.

**Hasil di data asli, nol override manual:** deteksi **8/15 → 15/15**, salah
slot **3 → 0**, tak terdeteksi **4 → 0**, slot terisi 8/17 → 15/17.

---

## 4. Verifikasi — jalankan ulang, jangan percaya baris ini

```bash
service postgresql start                       # container restart mematikannya
su postgres -c "psql -c \"alter user postgres password 'postgres'\""
npm ci                                         # root (apps/* + packages/*)
cd web-internal && npm ci && cd ..             # TERPISAH — bukan workspace root!
bash scripts/db-rebuild.sh --yes
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
npm test --workspaces --if-present
npm run typecheck && npm run lint -w @cdps/api -- --max-warnings 0
cd web-internal && npm run typecheck && npm test && npm run build
```

Hasil di DB **fresh** akhir sesi ini:

```
db-rebuild    171 migrasi · 143 tabel · entity_prefix 39 · 4 invariant SQL LOLOS
@cdps/core    530/530     (dari 500 — +30 test SHP-1/SHP-3)
@cdps/db      53/53
@cdps/domain  1765/1766 (1 skip)   (dari 1761 — +4 test SHP-1)
@cdps/api     398/398
web-internal  487/487     (diukur commit sebelumnya; nol perubahan sejak itu)
typecheck     4 workspace + web-internal bersih
eslint        @cdps/api --max-warnings 0 bersih
```

**Baseline `main` untuk perbandingan:** `web-internal` 441, `@cdps/core` 500,
`@cdps/domain` 1756. Ralat yang berdiri: pesan commit `b69e69b` menyebut
"web-internal 451/451" — hasil ukur sungguhan saat itu **446/446**; 451 adalah
aritmetika keliru, bukan hasil ukur. Riwayat commit tidak ditulis ulang
(`git reset --hard` diblokir di lingkungan sesi ini).

---

## 5. PR

Dibuka sesi ini dengan base `main`, memuat keempat commit di §1.
**Jangan merge atas inisiatif sendiri** — merge adalah keputusan pemilik.
Kalau CI merah atau ada konflik, itu pekerjaan sesi berikutnya (branch ini
di-push, jadi PR-nya ikut ter-update tiap push).

---

## 6. Jebakan lingkungan — hemat waktu sesi berikutnya

1. **`web-internal` BUKAN npm workspace.** `package.json` root cuma
   mendaftarkan `apps/*` dan `packages/*`. `npm ci` di root TIDAK memasang
   dependensinya, dan `tsc` di sana lalu gagal `Cannot find module 'xlsx'` —
   terbaca seperti dependensi hilang, padahal install-nya belum jalan. Juga:
   `npm test --workspaces` TIDAK menjalankan test-nya.
2. **Postgres mati setiap container restart.** `service postgresql start`, dan
   set password sekali (`alter user postgres password 'postgres'`) karena
   `db-rebuild.sh` jalan lewat socket sebagai OS user `postgres` sementara test
   butuh `DATABASE_URL` TCP.
3. **`route-parity` bisa hijau secara VAKUUM** — "nol endpoint hilang" juga
   benar kalau scanner-nya tidak melihat panggilan FE baru sama sekali. Sesi
   ini memverifikasi langsung dengan `vite-node` memanggil
   `feCalls()`/`servedBy()` dan mencetak 11 panggilan baru + statusnya. Lakukan
   itu tiap menambah rute.
4. **`shape-parity` (O43c)** tetap butuh DUA pendaftaran per `*Wire` baru:
   `WIRE_TO_FE` map DAN `FE_FILES` array. Field wire **satu-per-baris**
   (parsernya regex, bukan compiler TS).
5. **1 error lint `react-hooks/static-components`** di
   `web-internal/src/app/(shell)/admin/employees/page.tsx` — PRE-EXISTING, di
   luar cakupan, dan CI tidak menjalankan lint `web-internal` (cuma `build` +
   `test`). Jangan panik, jangan pula "sekalian diperbaiki" tanpa tiket.
6. **Kelas badge `badgeSuccess`/`badgeWarning`/`badgeDanger` tidak ada di
   `globals.css`** — badge di `ReportPanel` tampil tanpa warna sejak Gelombang
   1. Kosmetik, pre-existing, butuh tiket kecil sendiri. Kode baru pakai
   `badge-green` … `badge-darkgray` yang benar-benar terdefinisi.
7. **Data klien tidak masuk repo.** 15 berkas export Fim Motor dipakai untuk
   UAT lalu dibuang; harness-nya juga tidak di-commit. §6 dokumen UAT
   menjelaskan cara mengulang ujinya.

---

## 7. Urutan kerja yang disarankan untuk sesi berikutnya

1. **Gelombang 4 — AS-01…AS-04 (TikTok Ads Scanner).** Satu-satunya gelombang
   yang belum dimulai, dan sekarang jalur terbesar yang tersisa. O67 & O69
   sudah RESOLVED (port penuh ke `packages/core/`, tabel CDPS baru mirror pola
   `screening_run`). Engine `packages/core/src/adsscanner/tiktok/` **sudah
   lengkap dan teruji**; yang belum ada: migrasi, domain layer, rute, UI. Pola
   yang tinggal diikuti persis: migrasi `20260908050000` +
   `packages/domain/src/skuscreener.ts` + halaman `/ads/screening`.
2. **UAT lanjutan yang masih milik pemilik/AM** (bukan kode):
   (a) terbitkan satu laporan ke kontak klien sungguhan dan pastikan terbaca di
   portal; (b) uji atribusi `MTR-` dengan klien yang PUNYA kampanye
   `Shopee Ads` aktif — jalur "tidak upload manual" ke M6D RM-C belum pernah
   kena data nyata; (c) sisi TikTok belum pernah kena export asli.
3. **SCR-UI-1** — apakah divisi Ads perlu bisa me-LIST klien. Tidak blocking:
   `/ads/screening` memakai kolom ID klien + tautan dari halaman kampanye.
   Kalau ya, itu rute picker sempit + entri `DECISIONS.md`, bukan pelebaran
   `clients_select` apa adanya.
4. **Sidebar IA v3** (`docs/CDPS_Sidebar_IA_v3.md`) — track terpisah, masih
   butuh keputusan produk untuk 3 pasang halaman yang mungkin duplikat. Menu
   bertambah satu baris sesi ini (`/ads/screening`).
5. **Tiket kosmetik kecil** kalau ada waktu: kelas badge di `ReportPanel`
   (§6.6), lint `admin/employees` (§6.5).

---

## 8. Peta berkas

**SHP-1:** `packages/core/src/report/shopee/metrik.ts` (`parseBisnisHome`,
`KpiPesananDibayar`, `buildShopeeMetrics`), `payload.ts` (`kpi.dibayar`,
`periode.gmv_bersih_sumber`), `render.ts` (`seksiRingkasan` dua kartu),
`packages/domain/src/report.ts` (`createReportShopee` — blok komentar panjang
di atas `gmvKotor`/`gmvNet` menjelaskan rantai ke Health Score).

**SHP-3:** `packages/core/src/report/shopee/detect.ts`
(`RAW_NAME_PATTERNS`, `detectModuleFromRawName`, `detectModule` tiga lapisan).

**Test:** `packages/core/src/report/shopee/shopee.test.ts` (blok
"SHP-1"/"SHP-3"), `packages/domain/src/report.shopee.domain.test.ts` (blok
"SHP-1" di akhir berkas).

**SH-07 / SC-09 (UI):** lihat `HANDOFF_ADVERTISER_TOOLS_UI_20260903.md` §6.

**UAT:** `docs/handoff/UAT_SHOPEE_FIM_MOTOR_20260903.md` — §2 cek-ulang angka
ke berkas mentah, §3 tabel deteksi, §4 tiga keputusan + hitungan untung-rugi,
**§7 keadaan sesudah perbaikan**.

**Rencana & backlog:** `docs/plan/PLAN_KONSOLIDASI_ALAT_ADVERTISER.md`,
`docs/backlog/CLIENT_REPORT_PORTAL_BACKLOG.md` (G2 SH-01…SH-09 ✅, G3
SC-00…SC-09 ✅, G4 AS-01…AS-04 belum).

**Keputusan:** `docs/DECISIONS.md` — empat baris Decided teratas bertanggal
2026-09-03; SHP-1/2/3 di tabel Open bertanda ✅ RESOLVED; SCR-UI-1 masih 🔴.
