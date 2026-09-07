# Handoff — Gelombang B: **B1 & B2 SELESAI, lanjut di B3**

> **Baca ini dulu, lalu `HANDOFF_GELOMBANG_B_20260906.md`** (sesi sebelumnya) untuk
> audit lengkap §4 dan rancangan B3–B5 §7. Dokumen ini hanya memuat apa yang BERUBAH
> dan apa yang harus dikerjakan berikutnya.

---

## 1. Posisi sebenarnya

| Gelombang | Isi | Status |
|---|---|---|
| **A** | PR kecil QA | ✅ SELESAI — `ee0cad7`, PR #300 |
| **B1** | 4 turunan payload baseline TikTok | ✅ **SELESAI** — `ac145b0` |
| **B2** | Engine baseline Shopee | ✅ **SELESAI** — `ac145b0` |
| **B3** | Section B terisi dari satu upload | ▶️ **MULAI DI SINI** |
| **B4** | AM Co-Pilot mengisi Section E dari server | ⏸️ belum |
| **B5** | Baris Plan tersemai dari Section E | ⏸️ belum |
| **C** | Showcase Klien Terbaik | ⏸️ belum |
| **D** | Laporan keuangan accrual | ⏸️ belum |

Branch kerja: **`claude/baca-handoff-build-b1-b2-5hktpr`** (di atas branch Gelombang A).

---

## 2. Angka acuan BARU (lebih KECIL dari ini = regresi)

| Suite | Sekarang | Sebelumnya (§9 handoff B) |
|---|---|---|
| core | **782** | 667 |
| db | 53 | 53 |
| apps/api | 447 | 447 |
| domain | **1908** (+1 skip) | 1903 (+1 skip) |
| web-internal | **572** | 565 |
| web-client-portal | 19 | 19 |
| **migrasi db-rebuild** | **183** | 182 |
| gate db-rebuild | 145 / 40 / 31 / 69 | sama |

Migrasi 183 sudah **di-apply ke live `egddxfcnrtecheiykhlf`** lewat
`mcp__Supabase__apply_migration` (BUKAN `db push` — O65) dan diverifikasi lewat kueri
katalog: kolom ada, `ck_analisa_provenance` ada, `ck_analisa_benchmark_xor` ada, FK ke
`report_benchmark_shopee` ada.

Perintah verifikasi tetap sama seperti §9 handoff sebelumnya (termasuk jebakan
`ALTER USER postgres`, `npm install` root sekali, dan **rebuild DB dulu** sebelum
mengulang suite — kalau tidak, 2 kegagalan PALSU berbentuk `expected N to be 1`).

---

## 3. Apa yang PERSISNYA dikerjakan (biar tidak diulang)

### 3.1 B1 — `packages/core/src/baseline/payload.ts`
Empat kunci baru + empat helper murni yang diuji terpisah
(`payload-b1.test.ts`, 17 tes):

| Kunci | Turunan dari | Perilaku batas yang dipaku tes |
|---|---|---|
| `produk.sku_pareto_80` | `prod().rows` GMV desc | `>=` dengan toleransi float ⇒ SKU yang menyentuh 80% PERSIS ikut dihitung; Σ ≤ 0 ⇒ `null` |
| `produk.sku_slow_moving` | `prod().rows` `gmv <= 0` | katalog nihil baris ⇒ `0` jujur, bukan `null` |
| `iklan.jumlah_kampanye` | `ads().byCamp` | kosong ⇒ **`null` bukan `0`** (kasus nyata: hanya Ads LIVE diunggah) |
| `iklan.tipe_materi[]` | `ads().byMat` | registry TERTUTUP; label tak dikenal DIBUANG; urutan stabil mengikuti registry, bukan urutan berkas; `[]` tak pernah dikirim (jadi `null`) |

⚠️ Hanya `'Video'` yang **terkonfirmasi** dari export asli. `gmv_max` dan `live_ads`
adalah PEMBACAAN atas menu Ads Manager, karena itu pencocokannya longgar
(substring, case-insensitive) dan `gmv max` diperiksa lebih dulu.

### 3.2 B2 — `packages/core/src/baseline/shopee/` (baru)

`metrik-baseline.ts` (irisan) · `payload.ts` (`cdps.baseline.shopee.v1`) ·
`run.ts` (orkestrator) · `index.ts` · `shopee-baseline.test.ts` (**98 tes**).

**Nol parser baru.** `runShopeeBaseline` memanggil `report/shopee/detect.ts`,
`SHOPEE_PARSERS`, `buildShopeeMetrics`, `computeSkor` apa adanya, lalu menambah dua
langkah: irisan Section B + payload.

**Diverifikasi dengan export ASLI pemilik** (Fim Motor, Juli 2026, 15 berkas):
**15/15 masuk slot yang benar tanpa satu pun rename manual** — lapis
`detectModuleFromRawName` (SHP-3) memang bekerja. Angka yang keluar dari payload:
GMV 1.624.937.476 · 523 SKU (378 ada penjualan, **Pareto 80% = 28 SKU**) ·
ROAS 9,63× · 997 kreator afiliasi · skor **57/100** ⇒ `fondasi_perlu_dibenahi`.

### 3.3 Keputusan pemilik sesi ini (AskUserQuestion, 2026-09-06)

| Topik | Keputusan | Konsekuensi di kode |
|---|---|---|
| **B-4 Shopee** | **Isi otomatis** | payload membawa blok `layanan` (response rate, waktu respon, CSAT, konversi chat) + `kesehatan_toko` (poin penalti). **B-4 TikTok tetap manual seluruhnya.** Rating, jumlah ulasan, % pesanan terlambat tetap manual di KEDUANYA |
| **Berkas wajib** | **Hanya `bisnis_home`** | modul absen ⇒ blok payload `null` (bukan `0`), dicatat `kelengkapan_file`, dimensi skornya netral 5/10 **sambil menyebut** berkasnya tak diunggah. Sample pemilik memang TANPA Kesehatan Toko — kasus ini bukan hipotesis |

### 3.4 Migrasi 183 — menabrak prediksi handoff, dan kenapa

Handoff sebelumnya memprediksi "Gelombang B = nol migrasi". Salah, dan alasannya
hanya kelihatan setelah membaca DDL:

`ck_analisa_provenance` menuntut `benchmark_versi IS NOT NULL` untuk setiap baris
ber-skor, tapi `fk_analisa_benchmark` mengunci kolom itu ke `riset_awal_benchmark`
— yang isinya **16 ambang khas TikTok** (`cr`, `vidPostToko`, `gpmToko`, …). Ambang
Shopee tinggal di `report_benchmark_shopee`. Mengisi kolom TikTok untuk baris Shopee
= **provenance palsu**, persis yang CHECK itu ada untuk mencegah.

Solusinya menyalin preseden **SH-01** (`client_reports`) apa adanya: kolom
`benchmark_versi_shopee` + `ck_analisa_benchmark_xor` (tepat SATU terisi). Baris lama
tak tersentuh — kolom baru NULL, baris TikTok ber-skor tetap punya `benchmark_versi`.

### 3.5 Skala skor ×10 — jangan dicabut

`computeSkor` Shopee mengeluarkan **0–10**; kolom `riset_awal_analisa.skor` adalah
`integer` **0–100** dan `kondisiTokoFromScore` berambang **75/60/45** pada skala itu.
Tanpa penskalaan, **setiap** toko Shopee jatuh ke `mesin_belum_terbangun`.
Penskalaan terjadi **sekali**, di `buildShopeeBaselinePayload`;
`payload.skor.total_mesin` menyimpan angka 0–10 aslinya supaya laporan dan baseline
tak pernah berdebat soal angka yang sama.

### 3.6 Satu bug NYATA yang sample temukan — SHP-4

`parseAffCsv(rows, ['nama produk', 'produk'])`: export AMS asli menulis header
**`Nama Item`**, bukan "Nama Produk". Kata kunci longgar `'produk'` lalu menangkap
kolom **`Produk Terjual`**, sehingga **setiap produk afiliasi bernama jumlah
terjualnya** — "812", "391". Diperbaiki dengan menaruh `'nama item'` paling depan.
Ini memperbaiki **laporan Shopee yang sudah jalan**, bukan hanya baseline.

### 3.7 Konsekuensi yang disengaja pada tes lama

`metodeForPlatform('Shopee')` berubah `manual` → `analisa_penuh`. Sepuluh tes di
`interview.test.ts` memakai Shopee sebagai contoh "platform tanpa mesin" lewat
`seedManualBaseline`. Diperbaiki dengan `manualOverride: true` — jalur pintas RESMI
(owner QA 2026-08-27) — bukan dengan melonggarkan gerbang. Anti-deadlock RAB-07 tetap
berlaku karena gerbangnya menuntut **BARIS** baseline per platform, bukan skor.
Coverage "platform benar-benar tanpa mesin" dipindah ke **Lazada**, tes baru.

---

## 4. ▶️ GELOMBANG B3 — Section B terisi dari satu upload (mulai di sini)

Rancangan lengkap ada di **`HANDOFF_GELOMBANG_B_20260906.md` §7 (B3)** — baca itu,
tidak diulang di sini. Yang BERUBAH sejak rancangan itu ditulis:

1. **Prasyaratnya sudah lengkap.** B1 dan B2 sama-sama beres, jadi B3 boleh mulai.
2. **Paritas bentuk payload sudah DIPAKU tes**, bukan sekadar niat. Lihat
   `KUNCI_KONGRUEN` di `packages/core/src/baseline/shopee/shopee-baseline.test.ts`:
   daftar kunci yang WAJIB ada di kedua payload. Pemeta B3 boleh membaca kunci di
   daftar itu **tanpa** mengecek platform lebih dulu. Menambah baris ke daftar itu
   berarti berjanji KEDUA mesin mengisinya.
3. **Kunci yang sengaja BERBEDA namanya** — jangan disamakan, dan jangan dikira lupa:

| Section B | TikTok | Shopee | Kenapa beda |
|---|---|---|---|
| B-1.4 | `toko.refund_rate` | `toko.batal_retur_rate` | TikTok hanya melaporkan pengembalian dana; Shopee memisahkan **batal** dan **retur**, dan judul PRD-nya menyebut keduanya ⇒ Shopee menjumlahkan keduanya. Isinya beda, jadi namanya beda |
| B-6 rate | `afiliasi.rate`, `kreator_posting` | **ABSEN** | `ShopeeMetrics.affiliate` hanya menyimpan 10 kreator teratas. Absen ⇒ Section B memintanya manual, yang benar |
| B-7.2 jam live | `live.toko.jam`, `gmv_per_jam` | `live` hanya `{ada_aktivitas}` | Shopee tak mengekspor jam/sesi/GMV per sesi ⇒ B-7.2 TETAP manual untuk Shopee |
| B-4 | **tak ada blok** | `layanan` + `kesehatan_toko` | keputusan pemilik §3.3 |

4. **`gmv_mix` Shopee berbeda ISI, sama peran.** Kuncinya nama kanal Shopee
   (`shopee_ads`, `affiliate`, `voucher`, `chat`, `meta_cpas`, `shopee_video`), bukan
   `video_afiliasi`/`live_afiliasi` TikTok. Share-nya **boleh tumpang tindih dan
   menjumlah >100%** (voucher 82% + ads 79% di export contoh) — aturan
   `DECISIONS.md` 2026-08-22 berlaku sama: **organik JANGAN dihitung sebagai residu**.
5. **`ad_spend`/`roas` tetap AGREGAT periode**, sedangkan B-5.1/B-5.2 disimpan **per
   bulan** — batasan ini tidak berubah dan berlaku untuk kedua mesin. Diusulkan di
   tingkat channel saja; menyebarnya rata ke tiap bulan = mengarang angka.
6. **Klien lama harus tetap jujur.** Payload yang dibuat sebelum B1/B2 tidak punya
   `sku_pareto_80` dsb. `SectionB.tsx` wajib MENGATAKAN "payload versi lama", bukan
   menampilkan `0`. Uji terima #4 di handoff sebelumnya masih berlaku apa adanya.

---

## 5. Sisa pertanyaan terbuka untuk pemilik

Dua yang blocking sudah **diketok sesi ini** (§3.3). Yang masih menunggu:

3. **Pilar `retensi`** (E-9: follow-up chat, WhatsApp broadcast/Sebari) — pemiliknya
   belum ditetapkan. **Blocking untuk B5**, bukan B3.
4. Sales dibuka aksesnya ke halaman Showcase, atau cukup terima dokumen anonim? (C)
5. Layanan di-void di tengah periode: porsinya dibagikan ulang, atau hangus? (D)
6. Apakah `[On Hold]` menjeda pengakuan pendapatan? (D)
7. Perlukah kunci tutup buku per bulan? (D)
8. Pendapatan diakui bruto atau dipisah PPN? (D)
9. Apakah kontrak klien mengizinkan angkanya dipakai di materi pitch walau sudah
   dianonimkan? (C)

---

## 6. Utang teknis yang SENGAJA dibiarkan (jangan dikira lupa)

1. **`flashsale_aktif` tidak diemit.** Slot `promo_flashsale` terdeteksi dan terparse,
   tapi `ZERO_ACTIVITY_MODULES` (`report/shopee/metrik.ts`) hanya memantau
   `bisnis_live`, `promo_diskon`, `layanan_broadcast`, `bisnis_video`. Membaca
   `zero_activity` untuk flash sale akan **selalu** berbunyi "ada aktivitas". B-8
   tetap manual untuk baris itu sampai mesin laporan benar-benar membawanya.
   Perbaikannya kecil (tambah satu entri) tapi mengubah keluaran laporan yang sudah
   berjalan ⇒ butuh keputusan, bukan diselipkan.
2. **`ads_live` pada sample = 0 baris.** Bukan bug: berkasnya memang hanya header —
   toko itu tidak menjalankan iklan Live di Juli. Jadi `tipe_materi` benar ketika
   tidak memuat `iklan_live`.
3. **`riset_awal_benchmark` tidak disentuh** (sesuai instruksi handoff sebelumnya).
   Ambang Shopee tetap di rumahnya sendiri.
