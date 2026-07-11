# MSL_REKONSILIASI — Rekonsiliasi Basis Harga Kalkulator vs Draf Ledger

> **Tujuan:** menyandingkan **basis harga resmi** (sheet "Kalkulator Service Jasa", ditetapkan Nerissa sebagai basis: *"kadang klien nego harga, tapi basicnya dari sini"*) dengan **180 kandidat layanan** hasil kompilasi ledger deal riil (`docs/handoff/MSL_DRAFT_KOMPILASI.csv`).
>
> **Status:** bahan bantu untuk **Sales Head** — BUKAN penetapan `standard_price`/`commission_rule`. Sesuai **M0 OD-2 / DECISIONS O3**, hanya Sales Head yang berhak menetapkan angka MSL; dokumen ini hanya memetakan agar keputusan itu lebih cepat dan berbasis data. Harga custom per deal tetap sah lewat approval negosiasi (M0 OD-2).
>
> **Grammar yang harus dipatuhi saat mengisi (DECISIONS O14):** `standard_price` = harga per satuan layanan; `commission_rule` = **hanya** salah satu dari `"<N>% of standard price"` atau `"flat Rp <N>"`.

Catatan metode: pencocokan di bawah **fungsional** (nama/fungsi mirip, bukan string persis) dan diberi label confidence **tinggi / sedang / rendah**. Tidak ada match yang dipaksakan; layanan yang tidak masuk akal dipadankan dibiarkan tanpa pasangan.

---

## 1. Pemetaan Kalkulator → Entri Draf Ledger (yang match)

Angka kalkulator adalah **harga per satuan**; angka ledger adalah **median harga deal** (sudah campur quantity × durasi × nego), jadi selisih besar itu **wajar** dan bukan pertanda salah — yang dinilai di sini adalah apakah keduanya **layanan yang sama secara fungsi**.

| Layanan Kalkulator | Harga Kalkulator | Canonical Ledger (padanan) | Median Ledger | Selisih / Catatan | Confidence |
|---|---|---|---|---|---|
| Shopee Rating Optimization | Rp15.000 / checkout (min 50) | Optimasi Rating 50x | Rp750.000 | 50 × 15.000 = **750.000 → PERSIS** | **tinggi** |
| Shopee Rating Optimization | Rp15.000 / checkout | Optimasi Rating 100x / Optimasi Rating Shopee 100x | Rp1.300.000 | 100 × 15.000 = 1.500.000; ledger 13.000/checkout (nego/volume −13%) | **tinggi** |
| Shopee Rating Optimization | Rp15.000 / checkout | Optimasi Rating 200x | Rp2.800.000 | 200 × 15.000 = 3.000.000 (= harga_max ledger) | **tinggi** |
| Shopee Rating Optimization | Rp15.000 / checkout | Optimasi Rating 500x | Rp6.000.000 | 500 × 15.000 = 7.500.000; ledger 12.000/checkout (diskon volume) | sedang |
| TikTok Rating Optimization | Rp17.000 / checkout (min 50) | Optimasi Rating 100x TikTok / Jasa Optimasi Rating Toko Tiktok | Rp1.500.000 | 100 × 17.000 = 1.700.000; ledger 15.000/checkout | sedang–tinggi |
| A. Store Management (paket) | Rp6.000.000 / bulan (+ komisi 5%) | Store Management | Rp36.000.000 (6 bln) | 36.000.000 ÷ 6 = **6.000.000/bln → PERSIS**. Soal "+komisi 5%" lihat §4(a) | **tinggi** |
| SKU Design | Rp100.000 / SKU | Jasa Desain 25 SKU | Rp2.250.000 | 25 × 100.000 = 2.500.000; ledger 90.000/SKU | tinggi |
| SKU Design | Rp100.000 / SKU | Jasa Desain 50 SKU / Jasa desain marketplace 50 SKU | Rp3.150.000 | 50 × 100.000 = 5.000.000; ledger 63.000/SKU (diskon volume) | sedang |
| Product Catalog Photos – 4 Outputs | Rp150.000 / produk | Jasa Foto Katalog | Rp500.000 (modus 250.000) | ledger = agregat beberapa produk per deal | sedang |
| Thematic Product Photos – 4 Outputs | Rp250.000 / produk | Jasa Foto Katalog Tematik | Rp1.950.000 | ledger = agregat; ada juga "Jasa Foto Katalog dan Model" (2.410.000) | sedang |
| Banner / OBS Design | Rp250.000 / 5 slide | OBS | Rp750.000 | struktur mirip (desain OBS/banner) | sedang |
| Short Video (UGC Style) / Ad Content | Rp150.000 / video (min 5) | Short Video (UGC Style) / Ad Content | Rp135.000.000 (6 bln) | **NAMA PERSIS**; harga = retainer bulk × banyak video × 6 bln | tinggi (nama) |
| Short Video (Premium) | Rp250.000 / video (min 5) | Short Video (Premium) | Rp90.000.000 (6 bln) | **NAMA PERSIS**; harga = retainer bulk | tinggi (nama) |
| Massive Video Production (sample required) | Rp50.000 / video (min 50) | Massive Video Production | Rp30.000.000 (6 bln) | **NAMA PERSIS**; harga bulk. Lihat juga "Massive Video Affiliate" (55.000.000) & "...Premium+" (100.000.000) | tinggi (nama) |
| Live Streaming (education & selling) | Rp350.000 / sesi 3 jam (min 10) | Live Streaming Basic / Jasa live Streaming | Rp3.000.000 | 10 × 350.000 = 3.500.000 ≈ 3.000.000. Keluarga "Jasa Live Shopee/Tiktok Basic" & "Live Shopee 30 jam" satu rumpun | sedang |
| Night & Weekend Sessions | Rp150.000 / sesi 3 jam | Add on Weekend/Weekday Night – 8/22 Hours; Jasa Addon Live Streaming Malam Weekday/Weekend | Rp400.000–1.500.000 | fungsi sama (add-on sesi malam/akhir pekan); **satuan beda** (blok 8/22 jam vs sesi 3 jam) | sedang–rendah |
| Nano / Micro KOL (10% ratecard) | Rp5.000.000 / KOL | Endorsement Konten Tiktok Basic | Rp3.770.000 | rumpun endorsement/KOL | sedang |
| Macro & Mega KOL (10% ratecard) | Rp10.000.000 / KOL | Endorsement Konten Tiktok Premium / Endorsement Creator Premium | Rp9.750.000–10.000.000 | ≈ persis di titik Premium | sedang–tinggi |
| Live / Video with TC/KOL/Celebrities (10% Rate Card) | Rp10.000.000 | Matchmaking Top Creator Live Streaming … Affiliator; Live Affiliate … Affiliator; Shopee Video Affiliate | Rp2.925.000–90.000.000 | fungsi sama (talent/affiliator live & video); rentang sangat lebar → harga per-affiliator/per-jam, lihat §4(b) | sedang |
| B. ADS SPENDING → GMV MAX | (spend-based, tanpa harga satuan di sheet) | GMV Max Mea Basic / GMV MAX MEA / GMV Max Mea Premium / GMV MAX Advertising Management (+ rumpun GMV) | Rp15.000.000–53.250.000 | keluarga besar & pasti ada; harga tak bisa diambil dari sheet (basis = spend), tetap butuh angka Sales Head | sedang (eksistensi tinggi, harga rendah) |
| B. ADS SPENDING → Awareness & Consideration | Rp10.000 / 1K view (min 300) | Traffic Tiktok Shop Awareness Basic/Premium 360; Jasa Iklan Riset/…Awareness | Rp15.000.000–21.500.000 | basis **spend/view**, bukan harga layanan tetap → padanan lemah, hitung terpisah | rendah |

**Poin validasi kuat:** rumpun **Optimasi Rating** dan **Store Management** cocok nyaris eksak dengan basis kalkulator (50x = 750.000 persis; Store Management 6 jt/bln persis). Ini bukti kuat bahwa sheet kalkulator memang basis harga riil untuk keluarga-keluarga itu — Sales Head bisa memakainya dengan percaya diri di sana, dan lebih hati-hati di rumpun yang confidence-nya sedang/rendah.

---

## 2. Layanan Ledger TANPA Padanan Kalkulator (kandidat legacy / nego — butuh harga standar dari Sales Head)

**72 dari 180 canonical_name** tidak punya padanan fungsional di kalkulator, dan **justru menyumbang 768 dari 1.517 deal (50,6%)** — didominasi jasa iklan-management marketplace, buka toko, pengajuan mall, dokumen legal, dan commitment/budget fee yang memang **tidak ada di sheet kalkulator**. Ini adalah kandidat harga standar yang **wajib** ditetapkan Sales Head dari luar kalkulator.

**Top-20 by jumlah_deal (dari 72 baris tanpa padanan):**

| # | Canonical Ledger | Jumlah Deal | Median Ledger | Kategori |
|---|---|---:|---|---|
| 1 | Jasa Iklan Traffic Marketplace Basic | 210 | Rp10.200.000 | Iklan-management marketplace |
| 2 | Jasa Pengajuan Shopee Mall | 81 | Rp5.500.000 | Pengajuan/registrasi platform |
| 3 | Jasa Buka Toko Online Basic | 76 | Rp6.000.000 | Buka toko |
| 4 | Tiktok Ads GBS (Free Kelola ads Tiktok) | 51 | Rp1.665.000 | Iklan-management TikTok |
| 5 | Jasa Iklan Shopee 10 SKU | 48 | Rp3.599.000 | Iklan-management Shopee |
| 6 | Jasa Buka Toko Online Premium | 36 | Rp10.000.000 | Buka toko |
| 7 | Meta Ads CPAS x Shopee Premium | 33 | Rp23.100.000 | Iklan-management Meta |
| 8 | HAKI | 24 | Rp3.800.000 | Dokumen/legal |
| 9 | Meta Ads CPAS x Shopee Basic | 17 | Rp21.600.000 | Iklan-management Meta |
| 10 | Management Tiktok Shop Shopping Centre Optimization Basic | 17 | Rp10.000.000 | Store optimization |
| 11 | Management Tiktok Shop Shopping Centre Optimization Pro | 13 | Rp10.000.000 | Store optimization |
| 12 | NIB | 11 | Rp1.000.000 | Dokumen/legal |
| 13 | Budget Ads + PPN 11% | 11 | Rp10.000.000 | Budget/pass-through |
| 14 | Tiktok Ads Premium | 10 | Rp14.850.000 | Iklan-management TikTok |
| 15 | Tiktok Ads Basic | 10 | Rp16.050.000 | Iklan-management TikTok |
| 16 | Saldo Ads | 10 | Rp10.000.000 | Budget/pass-through |
| 17 | Jasa Iklan Traffic Marketplace Premium | 8 | Rp16.720.000 | Iklan-management marketplace |
| 18 | Jasa Admin Campaign Marketplace | 6 | Rp3.250.000 | Admin campaign |
| 19 | Tiktok Ads Premium+ | 5 | Rp5.500.000 | Iklan-management TikTok |
| 20 | Jasa Buka Toko Online Pro | 5 | Rp18.000.000 | Buka toko |

**Sisanya 52 baris tanpa padanan** (masing-masing 1–5 deal) mencakup a.l.: rumpun Meta/Tiktok Ads lain, Jasa Iklan Shopee 3 SKU / Maksimal 10 SKU / Basic, Jasa Pengajuan/Tiktok Mall, Pengajuan Blue Tick, Riset Judul 10/25 SKU, Paket Hemat / Shopee Booster / Tiktok Growth Pro, MEAGO Basic/Video, seluruh rumpun **Komitmen Fee / Fee Komitmen GMV Max** (client-side revenue share — lihat §4a), Jasa Traffic SEO Awareness (Google), Jasa Personal Branding, dan beberapa entri idiosinkratik (`IG Yohan`, `Meta – Jasa Free Trial … | Yusi`, `Perpanjangan`). Semua ini butuh keputusan harga & status aktif dari Sales Head.

> Selain 72 "tanpa padanan", ada **18 baris berpadanan LEMAH (partial, 64 deal)** — rumpun Awareness/Traffic 360 (basis spend/view), Jasa Content Premium(+), Jasa Trending Video, Konten Feed & Reels IG, dan Add On Talent/Model. Diperlakukan terpisah dari "cover penuh" karena basis kalkulatornya spend-based atau add-on yang tak ber-harga-satuan jelas.

---

## 3. Layanan Kalkulator TANPA Padanan Ledger (layanan baru — belum pernah closing)

Layanan-layanan ini ada di basis harga resmi tetapi **tidak muncul** sebagai canonical_name di ledger 1.517 deal — artinya belum pernah terjual, atau dijual terbungkus dalam paket lain. Perlu dibuat sebagai entri MSL baru bila memang ditawarkan:

| Layanan Kalkulator | Harga Kalkulator | Fase |
|---|---|---|
| Growth Strategic (paket) | (harga paket, kosong di sheet) | A. Store Management |
| Account Manager (paket) — PRIORITAS TRUE | (kosong) | A. Store Management |
| Insight & Analytic (paket) — PRIORITAS TRUE | (kosong) | A. Store Management |
| Carousel Content | Rp150.000 / set (5 konten), min 5 | Konten Organik |
| Single Image Content | Rp50.000, min 5 | Konten Organik |
| Special Spot | Rp700.000 (di fase Consideration) | Konten Organik / Consideration |
| Educational Videos | Rp250.000 / video, min 5 | Consideration – Service |
| Special Talent | (kosong) | Consideration – Service |
| Customer Review Management | Rp500.000 / bulan | Social Proof |
| Video Review | Rp20.000 / video, min 5 | Social Proof |
| SKU Video | Rp150.000 / produk | Asset Produk (padanan ledger "MEAGO Video"? lemah — konfirmasi) |
| Model (Add On) | (kosong) | Asset / Konten (mungkin = "Add On Talent" ledger — konfirmasi) |

Catatan: "Ads Management" (paket A #5) dan "TOTAL AWARENESS (per 10K view)" tidak dimasukkan sebagai "baru" karena berhimpitan fungsi dengan rumpun iklan/awareness yang sudah ada di ledger — statusnya perlu diklarifikasi Sales Head, bukan otomatis baru.

---

## 4. Catatan Struktural untuk Sales Head (WAJIB dibaca sebelum mengisi angka)

### (a) "6.000.000 + komisi 5%" pada Paket A Store Management ≠ commission_rule MSL
Angka "+ komisi 5%" di paket Store Management adalah **komponen harga yang dibayar KLIEN** — bagi hasil 5% atas **GMV/omset toko** klien. Ini **BUKAN** `commission_rule` MSL, yang di CDPS berarti **komisi internal untuk sales** atas nilai deal. Keduanya hidup di dua tempat berbeda dan **harus diisi terpisah**:
- `standard_price` Store Management = Rp6.000.000/bulan (fixed fee).
- Komponen "komisi 5% GMV" = variabel harga sisi-klien → **tidak muat di grammar O14** (`% of standard price` / `flat Rp N`), karena basisnya GMV, bukan standard_price. Ini perlu **mekanisme terpisah** (add-on/komponen deal), bukan dipaksakan ke `commission_rule`.
- `commission_rule` (komisi sales) tetap harus ditetapkan sendiri oleh Sales Head.

Pola yang sama muncul berkali-kali di ledger dengan komisi GMV/omset tertanam di **nama** layanan — semuanya sisi-klien, bukan komisi sales: `Free Jasa Tiktok Ads Komisi 10% dari Omset Toko`, `Komitmen Fee … GMV Max MEA free biaya jasa & Komisi 3%` / `… 5%`, `Komitmen Fee GMV Max Tiktok Free Jasa Plus Komisi 5%`, `Paket Hemat Tiktok Ads 1 Bulan (Komisi 5%)`, `Fee Komitmen GMV Max MEA Free Biaya Jasa Free Komisi`. **Jangan** menyalin angka "%"" dari nama-nama ini ke `commission_rule` MSL.

### (b) Model "per unit dengan batas minimal" (kalkulator) vs "standard_price per layanan" (MSL)
Sebagian besar layanan kalkulator berharga **per satuan** dengan batas minimal: `per video`, `per KOL`, `per checkout`, `per produk`, `per SKU`, `per sesi 3 jam`, `per 1K/10K view`. Implikasi ke MSL:
- **`standard_price` = harga PER SATUAN** (mis. Rp15.000 per checkout), dan **quantity ada di level DEAL**, bukan di MSL. Estimasi Nilai deal = `standard_price × quantity`.
- **KEPUTUSAN yang harus diambil Sales Head:** ledger menyimpan varian sebagai **bundle tetap** — `Optimasi Rating 50x / 100x / 200x / 500x` adalah 4 canonical_name terpisah (guardrail kompilasi sengaja tidak menggabung angka `50x` vs `100x`). Dua pilihan pemodelan MSL, dan keduanya sah:
  1. **Model per-satuan:** SATU entri MSL "Rating Optimization Shopee" `standard_price = Rp15.000/checkout`; angka 50/100/200/500 menjadi **quantity di deal**. → 4 baris ledger kolaps jadi 1 layanan.
  2. **Model bundle:** tetap 4 entri MSL (`…50x`, `…100x`, …), masing-masing `flat` harga bundle. → cocok dengan cara ledger & sales bekerja sekarang, tapi MSL jadi banyak baris.
  - Hal yang sama berlaku untuk rumpun **Live Affiliate / Matchmaking Creator** (dibedakan per jumlah affiliator × jam × siang/malam) dan **Jasa Live … 30/50/100 Jam**. Pilih satu model **konsisten** per rumpun sebelum di-seed — ini menentukan berapa baris MSL final dan bagaimana Estimasi Nilai dihitung.

### (c) Kolom PRIORITAS (TRUE/FALSE) di kalkulator
Sheet punya kolom `PRIORITAS` yang mayoritas `FALSE`; hanya **3 bernilai TRUE**: *Store Management*, *Account Manager*, *Insight & Analytic* (ketiganya paket fase A). **Maknanya tidak terdefinisi** di PRD/DATA_MODEL — bisa berarti prioritas upsell, urutan tampil, atau layanan unggulan. **Jangan** memetakannya otomatis ke field MSL apa pun (khususnya jangan disamakan dengan flag `active`). Perlu konfirmasi Sales Head soal arti & apakah perlu dijadikan atribut MSL.

### (d) `commission_rule` masih 100% KOSONG — tidak ada sumbernya di kedua file
Baik CSV ledger maupun sheet kalkulator **tidak memuat satu pun aturan komisi sales internal**. Yang ada di kalkulator ("10% ratecard" untuk KOL, "komisi 5%" untuk Store Management) adalah **basis harga sisi-klien** (markup atas ratecard KOL / bagi hasil GMV), **bukan** komisi sales. Konsekuensinya: seluruh `usulan_commission_rule` (180 baris) **harus diisi Sales Head dari kebijakan komisi**, tidak bisa diturunkan dari data mana pun. Ingat batas grammar O14: hanya `"<N>% of standard price"` atau `"flat Rp <N>"`; aturan tiered/per-kuartal ditangani lewat versioning MSL (`effective_from`), bukan grammar rumit.

---

## 5. Ringkasan Angka

Basis: 180 canonical_name / 1.517 deal ledger. Klasifikasi fungsional terhadap basis kalkulator:

| Kategori cover | Jumlah canonical_name | Jumlah deal | % deal |
|---|---:|---:|---:|
| **Ter-cover basis kalkulator** (match tinggi/sedang) | 90 | 685 | 45,2% |
| **Padanan lemah / partial** (spend-based, add-on, konten) | 18 | 64 | 4,2% |
| **TANPA padanan kalkulator** (legacy/nego → butuh harga Sales Head) | 72 | 768 | 50,6% |
| **Total** | **180** | **1.517** | **100%** |

- **Ter-cover (penuh + partial): 108 canonical_name / 749 deal (49,4%).**
- **Tidak ter-cover: 72 canonical_name / 768 deal (50,6%).**

**Baca angka ini dengan hati-hati:** meski hampir setengah *jenis layanan* (90 baris) cocok dengan basis kalkulator, **>50% volume deal justru datang dari layanan yang TIDAK ada di kalkulator** — satu layanan saja (`Jasa Iklan Traffic Marketplace Basic`, 210 deal) sudah lebih besar dari gabungan banyak layanan tercover. Artinya:
1. Basis kalkulator **valid dan kuat** untuk rumpun yang dicakupnya (Rating, Store Management, Desain, Foto, Short Video, KOL) — pakai dengan percaya diri di sana.
2. Basis kalkulator **belum menutupi mesin pendapatan utama** MEA: iklan-management marketplace (Traffic Marketplace, Shopee/Tiktok/Meta Ads), buka toko, pengajuan mall, dan dokumen legal. Untuk 72 layanan ini Sales Head **wajib** menetapkan `standard_price` dari luar sheet kalkulator.

**Selain itu:** 12 layanan kalkulator (§3) belum pernah closing — kandidat entri MSL baru. Dan `commission_rule` untuk **seluruh 180 baris** masih harus diisi Sales Head (§4d).
