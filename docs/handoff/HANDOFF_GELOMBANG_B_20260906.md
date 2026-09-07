# Handoff — Build 4-Gelombang CDPS: **Gelombang A SELESAI, lanjut di B2**

> **Baca ini dulu.** Sesi 2026-09-06 menyelesaikan **Gelombang A** (PR #300, draft).
> Sesi berikutnya **mulai dari Gelombang B2** (engine baseline Shopee) sesuai instruksi
> pemilik. B1 belum dikerjakan dan **sengaja** — lihat §5.
>
> Rencana lengkap keempat gelombang: `/root/.claude/plans/root-claude-uploads-d86214f0-6922-56bd-piped-gizmo.md`
> (sesi ini). Kalau berkas itu tidak terbawa, dokumen ini memuat cukup untuk melanjutkan.

---

## 1. Posisi sebenarnya

| Gelombang | Isi | Status |
|---|---|---|
| **A** | PR kecil QA: verifikasi bug 42P17 · UX editor insight · pindah 2 alat Ads ke MEA AI Tools · dok Upcoming Milestone | ✅ **SELESAI** — commit `ee0cad7`, **PR #300** (draft) |
| **B1** | Perluas payload baseline TikTok (+4 turunan) | ⏸️ belum — lihat §5 |
| **B2** | **Engine baseline Shopee** | ▶️ **MULAI DI SINI** |
| **B3** | Section B Strategi terisi dari satu upload | ⏸️ belum |
| **B4** | AM Co-Pilot mengisi Section E dari server | ⏸️ belum |
| **B5** | Baris Plan tersemai dari Section E | ⏸️ belum |
| **C** | Showcase Klien Terbaik | ⏸️ belum |
| **D** | Laporan keuangan accrual | ⏸️ belum |

Branch kerja: **`claude/cdps-build-plan-update-4v8vth`** (sudah di-push, PR #300 dibuka
sebagai draft, session sudah `subscribe_pr_activity`).

---

## 2. Keputusan pemilik yang MENGIKAT (jangan ditawar ulang)

Dari `AskUserQuestion` + koreksi langsung pemilik, 2026-09-06:

| Topik | Keputusan |
|---|---|
| Cara menyederhanakan | **Upload 1×, sisanya otomatis** — export hanya di Riset Awal; Section B terisi server-side dari payload beku yang sudah dikonfirmasi AM |
| Jembatan `postMessage` antar tool | **DITOLAK** |
| Pangkas kolom wajib (W→O) | **DITOLAK** — gerbang submit tidak dilonggarkan |
| Wizard 1 halaman | **DITOLAK** |
| B-4 kesehatan toko (TikTok) | **Tetap wajib manual.** Pemilik: *"ini tidak ada export hanya bisa manual"* ⇒ **bukan** pertanyaan terbuka, dan **tidak akan** ada parser TikTok untuknya |
| **Engine baseline Shopee** | **DIBUAT.** Pemilik: *"Kita sekalian buat mesin otomatis shopee… gunakan logika sama untuk mengisi datanya"* + *"ini perlu dibuat"* |
| **Video Factory** (`AM - baseline riset`) | **TETAP HIDUP, JANGAN dinonaktifkan.** Pemilik: *"berguna untuk mencari angle video yg sudah perform. ini dibutuhkan untuk lanjutan brief ke creative"* |
| Section E | **AM Co-Pilot mengisinya otomatis**, menerima konteks Strategi langsung tanpa export/paste |
| **Pilar SKU / harga** | **Ke AI Optimizer / Store Operation — AM yang memilih** akan diberikan ke mana |

⚠️ **Draf rencana pertama sesi ini SALAH pada dua hal, sudah dikoreksi pemilik. Jangan
ulangi:** (a) draf itu mencabut panel Video Factory — pemilik menolak; (b) draf itu
menyebut B-4 sebagai "menunggu contoh export" — untuk TikTok tidak ada export-nya sama
sekali, jadi itu permanen manual.

---

## 3. Yang PERSISNYA dikerjakan Gelombang A (biar tidak diulang)

Commit `ee0cad7`:

1. **Butir QA #1 diverifikasi, bukan diasumsikan.** `packages/domain/src/client-report-rls.test.ts`
   **DIJALANKAN** ⇒ **33 tes lulus** (bukan `skip`). Migrasi
   `20260914010000_fix_client_report_rls_recursion.sql` ada di repo; **jumlah migrasi
   sekarang 182**, bukan 181 — angka acuan lama sudah usang.
2. `web-internal/src/lib/nav.ts` — `/ads/screening` + `/ads/scanner` pindah dari `DELIVERY`
   ke `MEA_AI_TOOLS`; label → `Shopee Screening SKU`, `TikTok Ads Scanner`. **Href tidak
   berubah.**
3. `web-internal/src/lib/nav.test.ts` — klausa "wajib `/tools/*`" dilonggarkan **hanya**
   untuk dua href yang didaftar di `ADS_PAGES_IN_GROUP`; predikat tetap `toBe`
   by-reference. Dua tes baru (keempat href dalam urutan dipaku; Delivery tak lagi
   memuatnya). Tes "setiap baris bergerbang" **tidak disentuh**.
4. **Divisi Ads sekarang melihat judul grup `MEA AI Tools`** — konsekuensi yang disengaja
   dari `visibleNav` (judul muncul begitu satu baris lolos). Bukan pelebaran akses: satu
   tes baru memakukan Ads melihat **tepat** `['/ads/screening','/ads/scanner']`. `Ads`
   dikeluarkan dari daftar "divisi tanpa akses".
5. `ReportPanel.tsx` — label `insight & terbit` → **`Edit insight & terbitkan`**.
   `InsightEditor.tsx` — cabang `if (err && !bundle)` tak lagi kotak merah polos; kini
   menyebut galatnya + tombol **"Coba lagi"**.
6. Heading + teks akses-ditolak di `ads/screening/page.tsx`, `ads/scanner/page.tsx`, dan
   tautan silang di `ads/[id]/page.tsx`.
7. `docs/FITUR_UPCOMING_MILESTONE.md` **(baru)**, ditautkan dari `DATA_MODEL.md` +
   `M6D_BACKLOG.md`. **Koreksi fakta:** mesinnya bernama **`client_milestone`**
   (`STATE_MACHINES.md` **§16**) — **bukan "mesin #16"**, yang adalah mesin **Plan**.
8. Dua baris dokumen basi dikoreksi: `docs/design/README.md` ("belum diport" padahal
   `packages/core/src/baseline/` sudah ada) dan `docs/CDPS_Sidebar_IA_v3.md` (§"Peran →
   grup" menyebut Sales punya "Alat Bantu AM", padahal gerbangnya menolak Sales).
9. Satu baris `docs/DECISIONS.md` (2026-09-06, tujuh butir).

---

## 4. AUDIT — akar masalah yang Gelombang B perbaiki

Dibaca dari kode, bukan dari PRD. **Ini bagian yang paling mahal untuk ditemukan ulang.**

### 4.1 Export TikTok yang SAMA di-upload DUA KALI

AM upload export di **Riset Awal** (`RisetAwalPanel.tsx` → `POST /interview/{id}/baseline`
→ engine server `packages/core/src/baseline/` → `riset_awal_analisa.payload`, 5 pilar +
skor). Lalu AM membuka `/tools/video-factory` dan **upload export yang sama lagi**, karena
hanya tool itu yang mengeluarkan payload `cdps.section_b.v1` untuk Section B Strategi.

### 4.2 Copy-paste JSON 3× antar halaman

Nol `postMessage` (dikonfirmasi: nol hit di kedua HTML dan di `tools/[slug]/page.tsx`),
iframe satu arah, dan **nol ingest server-side** untuk payload kedua tool —
`DECISIONS.md` 2026-08-21 mencatatnya sebagai tiket lanjutan yang belum pernah dikerjakan.

| # | Dari | Ke | Cara sekarang |
|---|---|---|---|
| 1 | Video Factory | Strategi Section B | `VideoFactoryImportPanel` — tempel JSON manual |
| 2 | Strategi | AM Co-Pilot | tombol "Salin/Unduh JSON" (`buildExportJson`) — manual |
| 3 | AM Co-Pilot | Section C/D/E | `CockpitImportPanel` — tempel/unggah JSON manual |

### 4.3 Pewarisan server-side yang SUDAH ADA cuma memakai 4 field

`getBaselinePrefill` (`packages/domain/src/strategi.ts:1993`) sudah membaca
`riset_awal_analisa.payload`, dan `strategiBaselinePrefillToWire` sudah **mengirim**
`roas`, `ad_spend`, `aov`, `gmv_mix`. Tapi `mergeBaselinePrefill`
(`web-internal/src/lib/strategi-baseline-inherit.ts`) hanya memakai **B-0.6 sumber ·
B-0.7 periode · B-1 gmv + jumlah_pesanan**. Sisanya **dibuang di FE**, lalu diminta ulang
dari AM.

### 4.4 Payload baseline server sudah memuat ~15 angka Section B yang AM ketik ulang

Dari `packages/core/src/baseline/payload.ts` — semuanya ada, **nol** yang dipakai:

| Section B | Kunci payload |
|---|---|
| B-1.4 % batal | `toko.refund_rate` |
| B-2.1 pengunjung | `toko.pengunjung` |
| B-2.2 conversion rate | `toko.konversi` |
| B-2.3 komposisi | `gmv_mix` + `iklan.setara_persen_gmv` |
| B-3.1 SKU terdaftar/aktif | `produk.sku_total` / `.sku_ada_penjualan` |
| B-3.3 Top 5 SKU | `produk.top_sku[]` |
| B-5.1/5.2 belanja iklan, ROAS | `iklan.belanja` / `.roas` |
| B-6.1/6.2 affiliate | `afiliasi.kreator_posting` / `.gmv` |
| B-6.4 top kreator | `afiliasi.top_kreator[]` |
| B-6.5 sampel | `afiliasi.sampel_terkirim` |
| B-7.1 video/views/GMV | `video.toko` + `video.afiliasi` |
| B-7.2 jam live/GMV/GMV per jam | `live.toko` |

### 4.5 Section B = ~40 kolom wajib PER CHANNEL

Dihitung dari `checkCompleteness` + `kekuranganSectionB` (`packages/domain/src/strategi.ts`):
B-0.3(2) · B-0.6(6) · B-1(n bulan × 2) · B-2(2) · B-3(4+top5) · B-4(6) · B-5(1+list) ·
B-6(6) · B-7(7) · B-8(1+2 list) · B-9(2+list) · A-15 · C-1/C-3/C-4 · D-2 · D-4 · E-2 —
**semua per channel**. Klien 3 channel ⇒ **±120 kolom wajib**.

### 4.6 Section E kosong di hampir semua Strategi

`DECISIONS.md` 2026-09-02 menyatakannya eksplisit. Rantai akibatnya: PC-3 dicabut dari
Plan kontrak → pewarisan pilar → baris Plan mati → `generatePlanPeriods` sengaja **tidak**
menyemai baris ("No row skeleton yet", `plan.ts:876`) walau PRD M6B Flow step 1
memintanya. `suggestRowFromPillar` (`plan-row-suggest.ts`) **hanya** terpasang untuk
`isKlien` (Plan Satuan) — Plan **kontrak**, jalur utama, tak pernah mendapatnya.

### 4.7 Brief SUDAH beres — jangan disentuh

`brief-inherit.ts` sudah "satu klik, warisi semua": AM hanya isi jatuh tempo + prioritas.
`planRowToBriefInput` sudah mewariskan kanal, pilar, aksi, SKU sasaran, budget, prasyarat,
dan `instruksiBrief` (teks **atau** link; jatuh juga ke `referenceAttachments` bila URL).

### 4.8 AM Co-Pilot BUKAN AI — dan itu kabar baik

`am-copilot.html` adalah mesin aturan deterministik: `KATALOG` **4 pilar × 20 aksi**
(VIDEO V1–V6→Creative, LIVE L1–L4→Live Stream, AFFILIATE A1–A5→KOL, ADS D1–D5→Ads),
`verdict()` ambang tetap, `skor()` run-rate vs floor (`AMAN ≥95% / TIPIS ≥75% / MELESET`),
`saranD5()`. **Nol LLM, nol API key, nol endpoint** — dan **tidak ada infrastruktur AI apa
pun di repo ini** (nol dependency, nol env var AI, nol prompt file; dikonfirmasi lewat
grep menyeluruh). Artinya logikanya **bisa diport ke `packages/core`** dan dijalankan
server — preseden `docs/plan/PLAN_KONSOLIDASI_ALAT_ADVERTISER.md` (SKU Screener, report
engine Shopee/TikTok, Ads Scanner: keempat gelombang sudah diport penuh).

### 4.9 Jawaban atas pertanyaan pemilik: "cek apakah sudah ada tempat mengirim brief angle video ini"

**ADA — tiga tempat, ketiganya sudah dibangun, dan data angle-nya tak pernah sampai ke
satu pun.** Jadi yang kurang **isi**, bukan tempat:

| Lapis | Kolom | Sudah ada? |
|---|---|---|
| Strategi E-6 | `strategi_pillar` `jenis='konten'` — `aksi`, `target`, `detail` | ✅ ada, kosong |
| Plan P-C | `aksi` (PC-4) · `hasil_diharapkan` (PC-11) · `instruksi_brief` (teks/link) | ✅ ada |
| Brief | `instructions` (dirangkai `planRowToBriefInput`) + `referenceAttachments` bila URL | ✅ ada, tampil di `/creative/briefs/{id}` |

Dan angle-nya **sudah ada di payload baseline server**: `video.top_video[]` — 10 video
teratas dengan `judul`, `akun`, `gmv`, `gpm`, `vv`, `tuntas` (finish rate), `ctr`.
⇒ Rantainya lengkap; **B4** yang mengisinya.

---

## 5. Kenapa B1 dilewati dan B2 lebih dulu

Instruksi pemilik eksplisit: *"lanjut gelombang b2 di chat berikutnya"*. B1 (4 turunan
payload TikTok) **tidak bergantung** pada B2, dan sebaliknya — keduanya berdiri sendiri dan
baru bertemu di **B3** (satu pemeta Section B untuk dua schema payload). Jadi mengerjakan
B2 dulu tidak menciptakan utang: B3 hanya boleh mulai setelah **B1 dan B2** beres.

Kalau ada waktu di sesi B2, **B1 boleh dikerjakan sekalian** — kecil dan tidak bertabrakan.

---

## 6. ▶️ GELOMBANG B2 — engine baseline Shopee (mulai di sini)

### 6.1 Temuan yang mengubah ukuran pekerjaan: engine Shopee BUKAN greenfield

`packages/core/src/report/shopee/` **sudah ada**: ~3.000 baris, **17 slot modul**
(`detect.ts`), `metrik.ts` **962 baris**, plus `skor.ts`, `bench.ts`, `payload.ts`,
`insight.ts`, `render.ts`, `run.ts`, dan `shopee.test.ts` **632 baris** — dan sudah **UAT
dengan export Shopee ASLI** (Fim Motor, Juli 2026, 15 berkas — `DECISIONS.md` 2026-09-03,
*"engine LOLOS"*).

**Yang belum ada adalah irisan BASELINE-nya, bukan parser-nya.** Jadi:
- **JANGAN** tulis parser Shopee baru. Pakai `report/shopee/detect.ts` + `metrik.ts`
  (`MODULE_PARSER`) apa adanya.
- Contoh berkas dari pemilik dipakai untuk **memverifikasi irisan baseline** (modul mana
  yang realistis diupload AM di Riset Awal, dan apakah `bisnis_home` + `bisnis_produk`
  selalu ada) — **bukan** untuk membangun dari nol.

### 6.2 17 slot modul yang sudah dikenali

`bisnis_home` · `bisnis_produk` · `bisnis_live` · `bisnis_kesehatan` · `bisnis_video` ·
`ads_toko` · `ads_produk` · `ads_live` · `ads_banner` · `aff_product` · `aff_creator` ·
`promo_diskon` · `promo_voucher` · `promo_flashsale` · `layanan_chat` ·
`layanan_broadcast` · `meta`

### 6.3 Berkas yang dibuat/diubah

| Berkas | Isi |
|---|---|
| `packages/core/src/baseline/shopee/metrik-baseline.ts` *(baru)* | Irisan baseline dari `ShopeeParsed` |
| `packages/core/src/baseline/shopee/payload.ts` *(baru)* | `cdps.baseline.shopee.v1` |
| `packages/core/src/baseline/shopee/index.ts` *(baru)* | Barrel |
| `packages/core/src/baseline/shopee/*.test.ts` *(baru)* | Per modul + **paritas bentuk payload TikTok↔Shopee** |
| `packages/domain/src/riset-awal.ts` | `metodeForPlatform('shopee')` → **`analisa_penuh`** (baris ~65) + jalur submit analisa Shopee |
| `packages/domain/src/riset-awal.test.ts` | Shopee `analisa_penuh` + `kondisi_toko`; `ck_analisa_skor_penuh` terpenuhi; gerbang per platform tetap; firewall kosakata tetap hijau |
| `web-internal/src/components/interview/RisetAwalPanel.tsx` | Sub-bagian Shopee jadi jalur analisa (upload berkas), bukan entri manual |

### 6.4 Pemetaan irisan baseline (yang sudah dipastikan ADA di `metrik.ts`)

| Section B / payload | Sumber di engine Shopee | Modul export |
|---|---|---|
| GMV / pesanan / AOV / pengunjung / CR | `bisnis_home` (`parseHome`, dua seksi header) | Bisnis — Home |
| B-1.4 % batal | `pesanan_batal` / `penjualan_batal` | Bisnis — Home |
| SKU total/aktif/Pareto/slow + top SKU | `bisnis_produk` | Bisnis — Produk |
| Belanja iklan / ROAS / jumlah kampanye | `ads_toko` / `ads_produk` / `ads_live` | Ads — * |
| Affiliate + top kreator | `aff_creator` / `aff_product` | Affiliate — * |
| Video + live | `bisnis_video` / `bisnis_live` | Bisnis — Video/Live |
| Voucher & promo (→ B-8) | `promo_diskon` / `promo_voucher` / `promo_flashsale` | Promo — * |
| **B-4.2 chat response rate** | `layanan_chat.summary.response_rate` | Layanan — Chat |
| **B-4.2 response time** | `layanan_chat.summary.waktu_respon_detik` | Layanan — Chat |
| **B-4.4 poin penalti** | `bisnis_kesehatan.poin_total` (+ rincian) | Bisnis — Kesehatan Toko |

⚠️ **Tiga baris terakhir MENUNGGU KETOKAN PEMILIK — lihat §8 pertanyaan #1.** Pemilik
menyatakan B-4 manual (benar untuk TikTok, di mana memang tidak ada export-nya). Untuk
**Shopee** ternyata ADA sumbernya. **Jangan isi diam-diam** — itu menabrak pernyataan
pemilik sendiri.

`B-4.1 rating & jumlah ulasan` dan `B-4.3 % pesanan terlambat` **tetap tidak terbaca** ⇒
tetap manual, untuk kedua platform.

### 6.5 Aturan yang WAJIB dipatuhi

1. **Bentuk payload sekongruen mungkin dengan `cdps.baseline.tiktok.v1`** (`toko`,
   `produk`, `iklan`, `afiliasi`, `video`, `live`, `gmv_baseline`, `skor`,
   `benchmark_versi`, `temuan`, `kelengkapan_file`) supaya `getBaselinePrefill` (B3)
   membacanya lewat **SATU** pemeta, bukan dua cabang besar. Kunci yang Shopee tak punya
   ⇒ **absen**, dan absen berarti manual.
2. **Kunci absen = `null`, NEVER `0`.** Kelas kesalahan yang engine baseline sendiri ada
   untuk mencegah (RAB-02 fix #2, "absent ≠ zero").
3. `kondisi_toko` → pakai `kondisiTokoFromScore` yang **sudah ada**
   (`baseline/payload.ts:26`). Kosakata 5-nilai tetap **disjoint** dari verdict Blok C —
   tes firewall kosakata (`baseline/riset-awal-vocab.test.ts`) **tidak negosiabel**
   (M6 Interview §9).
4. `skor.ts` + `bench.ts` Shopee **dipakai apa adanya** (ambang dari
   `report_benchmark_shopee`, sudah versioned). **Jangan** tulis ambang baru.
5. Math tetap di `packages/core`. Nol perhitungan ulang di domain/FE.

### 6.6 Konsekuensi `metodeForPlatform('shopee') → analisa_penuh` — periksa, jangan asumsikan

- CHECK **`ck_analisa_skor_penuh`** menuntut `analisa_penuh` membawa `skor` **dan**
  provenance lengkap (`benchmark_versi` + `parser_versi`) ⇒ keduanya **wajib** diisi
  engine Shopee, kalau tidak insert-nya ditolak DB.
- **`assertRisetAwalGate`** (M6 Interview §4.2) tetap per platform aktif — klien
  Shopee-only kini lolos gerbang dengan **analisa**, bukan baseline manual. Anti-deadlock
  tetap: gerbang butuh **baris** baseline per platform, bukan skor.
- **RAB-05** auto-fill isian `toko.aov` → **B2-9** dan `produk.sku_total` → **B2-3** kini
  berlaku untuk Shopee juga. `mergeRisetAwalScoredInputs` **tidak** berubah — ia membaca
  isian terkonfirmasi, bukan platform.
- **`riset_awal_benchmark` JANGAN disentuh** — ambang Shopee punya rumahnya sendiri
  (`report_benchmark_shopee`). Kalau baris seed-nya belum ada di live, itu satu `INSERT`
  migrasi — **cek dulu lewat kueri katalog**, jangan diasumsikan.
- Jalur `VideoFactoryBaselineImportPanel` mendemosikan `metode_baseline` platform jadi
  `manual` (`DECISIONS.md`:124) sehingga skor 5-pilar hilang. **Pemilik memilih Video
  Factory tetap hidup**, jadi panel itu **tetap dirender**; cukup pastikan jalur upload
  langsung Riset Awal jadi jalur utama, dan panel tempel jadi jalur pelengkap.

---

## 7. Sisa Gelombang B, C, D — ringkas

### B1 — perluas payload baseline TikTok
`packages/core/src/baseline/payload.ts` (`buildPayload`), dari data yang `Metrics` **sudah
bawa** (jadi **nol parser baru**):

| Kunci baru | Diturunkan dari | Untuk |
|---|---|---|
| `produk.sku_pareto_80` | `prod().rows` diurut GMV desc; berapa SKU pertama menutup 80% Σ GMV | B-3.2 |
| `produk.sku_slow_moving` | `prod().rows` dengan `gmv <= 0` | B-3.4 |
| `iklan.jumlah_kampanye` | `Object.keys(ads().byCamp).length` | B-5.3 |
| `iklan.tipe_materi[]` | kunci `ads().byMat` → key form (`video_ads`/`live_ads`/`gmv_max`) | B-5.3 |

Tes: Pareto tepat di batas 80%; `byCamp` kosong ⇒ `null` bukan `0`; `byMat` tak dikenal ⇒
dibuang, bukan diteruskan sebagai teks bebas.

### B3 — Section B terisi dari satu upload
Perluas `ChannelBaselineSuggestion` (`packages/domain/src/strategi.ts`) dengan seluruh
field §4.4 — **satu pemeta untuk dua schema**, dipilih dari `payload.schema`. Wire:
`null` **eksplisit**, jangan hilangkan kunci (kelas bug **O43**); `shape-parity.test.ts`
ber-anchor ke tipe FE ⇒ **tipe FE ditulis dulu**. FE: `mergeBaselinePrefill` isi field
baru dengan kontrak yang sudah berlaku (hanya field kosong; list hanya bila list tujuan
kosong; nilai yang AM sudah simpan **tidak pernah** ditimpa). `SectionB.tsx`: chip
**"terisi dari Riset Awal"** + ringkasan otomatis/manual per channel + kalimat jujur untuk
payload versi lama dan channel tanpa engine.

**B-2.3:** `video_*`→video, `live_*`→live, `kartu_produk_dan_lain`→luar,
`iklan.setara_persen_gmv`→iklan; **organik JANGAN dihitung sebagai residu** (share
platform boleh tumpang-tindih/>100%, `DECISIONS.md` 2026-08-22) ⇒ organik `null`.
`gmv_mix` **tetap** rincian di dalam TikTok Shop, bukan channel sendiri (**RAB-12**).

**`ad_spend`/`roas` di payload adalah AGREGAT periode**, sedangkan B-5.1/B-5.2 disimpan
**per bulan** ⇒ diusulkan di tingkat channel saja; per-bulan tetap manual. Menyebarnya
rata ke tiap bulan = mengarang angka yang export tak pernah bawa.

### B4 — AM Co-Pilot mengisi Section E dari server
Port `KATALOG`/`verdict`/`skor`/`saranD5` ke `packages/core/src/copilot.ts` (**tes ditulis
DULUAN** untuk `verdict` + `skor`; ambang jadi konstanta bernama, pola `KualifikasiConfig`
di `interview.ts`). Peringkat **angle video** dari `video.top_video[]`: jangkar `gpm`,
penguat `tuntas` + `ctr`, maks 5, seri diputus `gmv` desc lalu `judul` asc; `detail`
disusun dari angka asli lewat template BI tetap ⇒ byte-identik saat dihitung ulang.
Payload tanpa `top_video` ⇒ pilar konten tetap dibuat **tanpa** blok angle, dan
mengatakannya.

`susunPilarUsulan(sql, actor, strategiId)` di domain: gerbang `canReadStrategi`; **pola
baca meniru `baseline-prefill/route.ts` apa adanya (`db()` + gerbang domain, BUKAN
`readAsActor`)** — dua jalur baca berbeda untuk dua endpoint bersaudara di halaman yang
sama adalah drift. Resolusi interview lewat **`latestScoredInterview`**, helper yang sama
yang `getStrategiPrefill`/`getBaselinePrefill` pakai.

`GET /api/v1/strategi/[id]/copilot` (**direktorinya belum ada**, sudah dicek) +
`copilotUsulanToWire`. `route-parity.test.ts` `KNOWN_GAPS` **tetap kosong**.

FE: tombol **"Susun draft dari AM Co-Pilot"** di `SectionE.tsx`; tulis lewat
`saveStrategiPillars` + `mergeCockpitPillars` yang **sudah terbukti** (cocokkan
`(jenis, channel, aksi)`). ⚠️ **Label pengelompokan pilar masuk `detail`, BUKAN `peran`**
— `ck_strpil_peran` enum peran SKU tertutup; bug ini sudah pernah terjadi
(`DECISIONS.md`:500). `CockpitImportPanel` + tombol Salin/Unduh JSON **tetap dirender**
(jalur mundur).

### B5 — baris Plan tersemai dari Section E
`PILAR_TO_DIVISI` + `suggestRowFromPillar` **dipindah** dari
`web-internal/src/lib/plan-row-suggest.ts` ke `packages/core` (pola dual-home registry).
`generatePlanPeriods` menyemai `plan_row` periode 1 untuk **5 jenis unambiguous**
(`konten`→Creative, `iklan`→Ads, `affiliate`→KOL, `live`→Live Stream,
`operasional`→Ops), membawa `strategi_pillar_id` ⇒ **bukan** `di_luar_strategi`, sehingga
metrik deviasi **PG-1** (`<15%`) dapat daya bedanya kembali. **Dropdown PC-3 yang pemilik
cabut 2026-09-02 JANGAN dikembalikan** — `DECISIONS.md` menyebut sendiri jalannya:
*"mengisi Section E lalu menautkan otomatis"*.

Pilar **`sku`/`harga`/`retensi`**: `divisi_pic` `NOT NULL` ⇒ tidak bisa disemai tanpa
divisi, dan menebaknya melanggar keputusan pemilik. Jadi **panel "Pilar Strategi menunggu
divisi (n)"** di halaman Plan periode 1, kandidat dari **registry**
(`division.briefAssignableNames()`), dengan **AI Optimizer** dan **Store Operation**
ditawarkan lebih dulu. AM memilih ⇒ baris dibuat lewat `createPlanRow` yang **sudah ada**
(nol endpoint baru, nol migrasi). `jenis` task dari `PLAN_TASK_CATALOG` yang **sudah
cocok**: `AI Optimizer` → `sku_optimize_ai` (satuan **SKU**), `Store Operation` →
`setup_promo_toko` (satuan **promo**) / `qc_konten_toko`; tidak cocok ⇒ `Lainnya`.

`kuota` tak terbaca dari teks target ⇒ baris **tidak** disemai (**bukan** `kuota=0`:
`brief-inherit.ts` melewati baris `kuota_nol`, jadi baris kuota-0 = baris mati).

**Brief: NOL perubahan.**

### C — Showcase Klien Terbaik · D — Laporan keuangan accrual
Rancangan lengkap keduanya ada di rencana unggahan pemilik
(`44c0cee5-masalahqahalamanagileunicorn_2.md`) dan di berkas rencana sesi ini. Keputusan
pemilik untuk keduanya **tidak berubah**. ⚠️ **Baca peringatan di muka**: hari ini halaman
Showcase akan **KOSONG** (satu-satunya laporan live pra-R3, `payload` **beku permanen**,
tak bisa di-backfill), dan skedul pendapatan hanya mencakup **3 dari 14 layanan** (11
tanpa periode; `durasi_jasa` MSL terisi **0 dari 14**). Keduanya bukan cacat — itu laporan
yang jujur menunjukkan data yang belum diisi.

---

## 8. Pertanyaan terbuka — WAJIB diketok pemilik, JANGAN ditebak

> ⚠️ **2026-09-07 — daftar ini SUDAH DIPINDAH.** Butir 1 (B-4 Shopee) sudah
> diketok 2026-09-06 dan berfungsi (diverifikasi UAT). Butir 3–9 dipindahkan ke
> `docs/DECISIONS.md` §Open sebagai baris `E9-RETENSI` · `C-1` · `C-2` · `C-3` ·
> `D-1`…`D-4`, dan briefnya (opsi + untung-rugi + rekomendasi + angka live yang
> sudah diverifikasi) ada di
> `docs/handoff/KEPUTUSAN_PEMILIK_GELOMBANG_C_D_20260907.md`. **Pakai dua berkas
> itu, bukan daftar di bawah** — daftar ini disimpan hanya sebagai riwayat.
> Khususnya: alasan "halaman Showcase kosong" di §7 **salah sebab**; lihat brief
> §0.

1. **B-4 untuk Shopee.** Engine Shopee sudah mem-parse chat response rate, response time,
   dan poin penalti (`layanan_chat` + `bisnis_kesehatan`) — **3 dari 6 kolom B-4**.
   Pemilik menyatakan B-4 manual (untuk TikTok, di mana memang tidak ada export). Untuk
   Shopee: isi otomatis, atau tetap manual demi keseragaman? **Blocking untuk B2 §6.4.**
2. **Contoh berkas Shopee** dari pemilik — dipakai memverifikasi irisan baseline (modul
   mana yang realistis diupload AM di Riset Awal). **Tidak memblokir** pembangunan engine
   (engine-nya sudah UAT dengan export asli), hanya verifikasinya.
3. **Pilar `retensi`** (E-9: follow-up chat, WhatsApp broadcast/Sebari) — pemilik
   menetapkan pemilik untuk `sku`/`harga`, **belum** untuk `retensi`. Sementara masuk
   daftar "menunggu pilihan AM" yang sama; **jangan tebak**.
4. Sales dibuka aksesnya ke halaman Showcase, atau cukup terima dokumen anonim?
5. Layanan di-void di tengah periode: porsinya dibagikan ulang, atau hangus?
6. Apakah `[On Hold]` menjeda pengakuan pendapatan?
7. Perlukah kunci tutup buku per bulan?
8. Pendapatan diakui bruto atau dipisah PPN?
9. Apakah kontrak klien mengizinkan angkanya dipakai di materi pitch **walau sudah
   dianonimkan**?

---

## 9. Verifikasi — perintah + angka acuan BARU

```
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""   # sekali per container
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
bash scripts/db-rebuild.sh --yes
npm install                                    # root workspace, sekali per container
npm test --workspaces
npm run typecheck --workspaces --if-present
cd web-internal && npm install && npx vitest run && npx tsc --noEmit && npm run build
```

**Angka acuan BARU per akhir Gelombang A** (lebih KECIL dari ini = regresi). Angka
`HANDOFF_SESI7` §2 sudah usang — merge PR #299 + dua tes nav baru menaikkannya:

| Suite | Sekarang | `HANDOFF_SESI7` §2 (usang) |
|---|---|---|
| core | **667** | 663 |
| db | **53** | 53 |
| apps/api | **447** | 442 |
| domain | **1903** (+1 skip) | 1870 (+1 skip) |
| web-internal | **565** | 563 |
| web-client-portal | 19 | 19 |
| migrasi db-rebuild | **182** | 181 |
| gate db-rebuild | 145 / 40 / 31 / 69 | sama |

### Jebakan yang sudah terbukti menggigit di repo ini

- **`skip` bukan `pass`.** Tanpa `DATABASE_URL` puluhan berkas tes lewat begitu saja
  (`HANDOFF_SESI7` §6).
- Container ini butuh **`ALTER USER postgres PASSWORD 'postgres'`** sekali sebelum
  `db-rebuild.sh` bisa konek.
- Root workspace butuh **`npm install`** sekali; tanpa itu `vitest` tidak ada dan
  `vitest.config.ts` gagal dimuat dengan `ERR_MODULE_NOT_FOUND`.
- **Suite dijalankan dua kali di DB yang sama tanpa rebuild ⇒ 2 kegagalan PALSU** berbentuk
  `expected N to be 1` (`admin.test.ts` hari libur, `client.test.ts` Hold Service —
  keduanya menghitung baris `audit_log`). **Rebuild dulu sebelum mencari bug.**
- `web-internal` & `web-client-portal` **bukan** anggota workspace root — `npm install` +
  `npm test` sendiri di direktorinya.
- 1 error lint `react-hooks/static-components` di `admin/employees/page.tsx` adalah
  **PRE-EXISTING**, di luar cakupan.

### Migrasi ke live

**JANGAN `supabase db push`** — ledger versi live berbeda *wholesale* dari nama berkas repo
(isi skemanya sama), jadi `db push` akan mencoba menerapkan ulang ~100 migrasi dan gagal
massal (`DECISIONS.md` 2026-09-03 / **O65**). Pakai `mcp__Supabase__apply_migration` per
berkas ke proyek **`egddxfcnrtecheiykhlf`**, dan cek prasyaratnya lewat kueri katalog —
**nomor migrasi di dua sisi tidak sebanding**, jadi *"nomornya lebih kecil, pasti sudah
jalan"* adalah kesimpulan yang salah.

Gelombang **A, B, C = nol migrasi** ⇒ tetap 182. Gelombang **D** menambah **satu** ⇒ 183.

---

## 10. Uji terima Gelombang B (bukan tes otomatis)

1. **Satu upload (TikTok).** Riset & Interview Klien → upload export TikTok Shop + Ads
   Manager **satu kali** → konfirmasi isian → submit. Buka Strategi klien itu → Section B:
   B-1, B-2.1/2.2, B-3.1/3.2/3.3/3.4, B-5.3, B-6.1/6.2/6.4/6.5, B-7.1/7.2 sudah terisi
   dengan chip "terisi dari Riset Awal". **Tanpa** membuka `/tools/video-factory`.
2. **Satu upload (Shopee).** Klien Shopee → upload export Shopee di Riset Awal → baseline
   jadi **`analisa_penuh`** dengan skor + `kondisi_toko` (bukan lagi
   `belum_dapat_diukur`), dan Section B channel Shopee ikut terisi.
3. **Yang manual tetap terlihat manual.** B-4 (6 kolom TikTok), B-8, B-9, host/studio masih
   kosong dan masih menggerbang submit; panel "Kekurangan" menyebutnya per channel. **Ini
   benar, bukan bug.**
4. **Klien lama tidak rusak.** Strategi yang baseline-nya dibuat sebelum build ini: hanya
   4 field lama terisi, sisanya kosong, dan halamannya **mengatakan** payload-nya versi
   lama — **bukan** terisi `0`.
5. **Section E otomatis + angle video.** Tekan "Susun draft dari AM Co-Pilot": daftar pilar
   muncul **tanpa export/paste/file**; pilar `konten` membawa angle video yang sudah
   perform dengan angka aslinya. Centang → simpan → E-3…E-10 terisi.
6. **Baris Plan tersemai.** Setujui Strategi → Plan periode 1: baris kerja sudah ada untuk
   pilar konten/iklan/affiliate/live/operasional ber-`strategi_pillar_id` (**bukan** badge
   `Di Luar Strategi`); pilar `sku`/`harga` muncul di panel "Pilar Strategi menunggu
   divisi" dengan pilihan **AI Optimizer / Store Operation**.
7. **Brief tetap satu klik, dan angle-nya ikut.** Aktifkan periode → "Berikan Brief": AM
   hanya isi jatuh tempo + prioritas. Buka `/creative/briefs/{id}` → `instructions` memuat
   angle video dari Section E, dan link `instruksiBrief` (bila URL) tampil di
   "Referensi / Lampiran".
