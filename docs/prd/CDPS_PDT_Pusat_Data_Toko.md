# PRD — PDT (Pusat Data Toko)
**Versi 1.2 · 13 September 2026 · PT MEA Agensi Digital**
*Revisi 1.1: strategi storage berubah — raw disimpan sebagai paket ZIP dengan purge otomatis,
parse menjadi selektif, `extras jsonb` dibatalkan (PDT-15 revisi 2, PDT-25 s/d PDT-27).*
*Revisi 1.2 (sesi 2, ketokan Nerissa 2026-09-13): §7 mendapat 27 kolom ber-konsumen nyata yang
sesi 1 lewatkan + modul baru `shopee_kesehatan` (daftar mengikat sekarang di
`docs/backlog/PDT_KOLOM_DIPANEN.md`); Rule 2 (pengikatan `shop_id` dari preamble Shopee),
Rule 5 (toleransi bulan-sama), dan Rule 11 (status `tidak_dapat_dipulihkan` per platform)
direvisi; `pdt_satuan_t` dapat nilai `rasio`; lima Open Assumption lagi tertutup, total sembilan
dari sebelas (§9) — lihat `docs/handoff/HANDOFF_PDT_SESI1.md`.*
**Repo:** `MEAgrup/AgencyAPP` (CDPS) · **Supabase:** `egddxfcnrtecheiykhlf` (`ap-southeast-1`) · **Schema:** `public`, prefiks `pdt_`

Satu subsistem yang menggantikan **AM Baseline (Riset Awal + Video Factory)**, **AM Co-Pilot**,
**Report Engine TikTok**, dan **Report Engine Shopee**. AM upload berkas platform **satu kali per
toko per periode**; seluruh kebutuhan hilir — onboarding, Section B, strategi, brief, plan,
reporting, dan Product Exchange — dibaca dari lapisan fakta yang sama.

---

> ## ⚠️ Catatan penyelarasan repo — WAJIB DIBACA SEBELUM TIKET PERTAMA
>
> PRD ini masuk repo **apa adanya** kecuali empat koreksi di bawah, yang lahir dari verifikasi
> langsung ke kode `MEAgrup/AgencyAPP` (bukan dari pembacaan ulang PRD). Pola sama dengan kepala
> `CDPS_ProductExchange_M1_M2.md`: PRD tetap spesifikasi, penyesuaian repo dicatat di satu tempat.
> Rinciannya di `docs/backlog/PDT_BACKLOG.md` §0 dan §5.
>
> **K-1 · Kode keputusan `PDT-15`…`PDT-27` → `PDT-15`…`PDT-27`.** Namespace `D-NN` **sudah terpakai** di
> repo ini untuk tiket backlog M6D — `D-14` berarti *"Disiplin Rekap Mingguan + Kepatuhan Catatan
> Mingguan"* (migrasi `20260814090000_d14_recap_discipline.sql`, `DECISIONS.md` baris 288–289), bukan
> *"ID memakai bigint tanpa prefix"* seperti yang §6.1 PRD ini maksud. Dua arti untuk satu kode selalu
> berakhir menyimpang. Tabel pemetaan ada di §2.
>
> **K-2 · §6.1 — rujukan "(D-14)" untuk `bigint` dicabut.** Preseden nyatanya bukan D-14, melainkan
> tiga tabel yang sudah hidup: `client_reports`, `px_eligibility_policy`, dan `client_platforms` —
> semuanya `bigint GENERATED ALWAYS AS IDENTITY`, **nol prefix baru**. Artinya `entity_prefix`
> **tidak bergerak** (tetap 44) dan gerbang CI prefix tidak perlu dinaikkan untuk PDT.
>
> **K-3 · §6.6 — `requirePermission` TIDAK ADA di repo ini.** Nol hasil grep. Keputusan eksplisit
> PX-M2a (`DECISIONS.md` 2026-09-12) menolak sistem permission-key. Pola rumah = **predikat bernama**
> di `packages/domain`, ditegakkan RLS. Jadi `canUploadBatch` / `canKelolaBenchmark` /
> `canKirimLaporan` ditulis sebagai fungsi di `packages/domain/src/pdt.ts`, menyalin lingkup
> `showcase.canKelolaIzinPitch` (`packages/domain/src/showcase.ts:112`) — persis seperti yang §6.6
> sudah minta. Yang gugur hanya kata "`requirePermission`".
>
> **K-4 · §6.2 — `level2_category` dan `price_segment` BELUM PUNYA TIPE di CDPS.** Grep seluruh
> `supabase/migrations/**`: nol hasil untuk keduanya (dan untuk enum `price_segment_t`). Keduanya
> hidup di sisi **MCN/MSDPS**. Konsekuensi: **G5 diblokir** sampai P-02/P-03 dijawab; G1–G4 tidak
> terpengaruh karena kedua kolom itu hanya dikonsumsi Product Exchange.
>
> **Satu hal lagi yang bukan koreksi PRD, tapi wajib diketahui:** PDT-25/PDT-26 **membalik invarian
> house rule** yang tercatat di `DECISIONS.md` 2026-08-20 — *"buang raw seketika, simpan hanya hasil
> + provenans metadata; jangan pernah persist biner/rows mentah"* — dan larangan
> `PLAN_KONSOLIDASI_ALAT_ADVERTISER.md` §3.4 (*"Jangan tambah multipart/Storage"*). §1 PRD ini memang
> sudah menyebut keputusan 2026-08-20 sebagai akar masalah, tapi pembalikannya dicatat sebagai
> **baris `DECISIONS.md` tersendiri**, bukan diselipkan ke salah satu dari 13 keputusan terkunci —
> yang dibalik adalah aturan lintas-modul, bukan aturan PDT.

---

## Daftar Isi
1. [Background](#1-background)
2. [Keputusan Terkunci](#2-keputusan-terkunci)
3. [Rules](#3-rules)
4. [Flow](#4-flow)
5. [Example](#5-example)
6. [System Requirements](#6-system-requirements)
7. [Modul & Peta Kolom dari Export Asli](#7-modul--peta-kolom-dari-export-asli)
8. [Rencana Strangler](#8-rencana-strangler)
9. [Open Assumptions](#9-open-assumptions)
10. [Success Metrics](#10-success-metrics)

---

## 1. Background

**Masalah terukur (dari audit internal 12 Sep 2026).** 8 titik upload, nol yang saling memakai
ulang. AM mengunggah export yang **sama** 2–3× per klien per bulan (5× se-organisasi untuk klien 2
platform, 7× di bulan onboarding). 11 kelompok data diketik/dikonfirmasi ulang. **7 dari 9 rantai
data putus**. 13 temuan KRITIS + 12 SERIUS tersebar di empat tool.

**Akar masalahnya satu keputusan, bukan empat tool.** `DECISIONS.md` 2026-08-20 memutuskan CDPS
membuang berkas export seketika dan hanya menyimpan sidik jari (`sha256`) plus hasil hitungnya.
Semua duplikasi turun dari situ: tidak ada yang bisa dipakai ulang karena tidak ada yang disimpan.
Membangun tool kelima tanpa membalik konsekuensi keputusan itu = membangun tool kelima yang juga
amnesia.

**Jalan keluar yang dipilih (ketokan PDT-15 revisi 2).** Tiga lapis, masing-masing satu tugas:

1. **Raw disimpan sebagai satu paket ZIP** di Object Storage — bukan di database — dengan
   **retensi berjenjang dan purge otomatis**. Paket ZIP adalah **satu-satunya** jalan reparse, dan
   ia berumur terbatas.
2. **Parsed selektif**: hanya field yang punya konsumen nyata — **lima konsumen** (strategi, brief,
   plan, report, **Product Exchange**) — ditambah total shop-level per basis sebagai sisi
   pembanding checksum. Kolom tanpa konsumen **tidak disimpan**.
3. **`extras jsonb` dibatalkan.** Paket ZIP menggantikan fungsinya dengan biaya ~6× lebih murah.
   Yang tetap dicatat hanyalah **nama** kolom baru yang belum dikenali parser (bukan nilainya) —
   cukup untuk mendeteksi drift kolom, biaya mendekati nol.

Diukur dari 28 berkas sample (2 klien, Juli 2026), per klien per bulan:

| Cara menyimpan | Per klien/bulan | 500 klien × 12 bulan | Lokasi |
|---|---|---|---|
| Raw longgar (tanpa zip) | 0,78 MB | 4,6 GB | Object Storage |
| **Raw satu paket ZIP (`-9`)** | **0,59 MB** | **3,4 GB** | **Object Storage** |
| **Parsed selektif** | **1,47 MB** | **8,6 GB** | **Database** |
| Parsed + `extras` semua kolom *(ditolak)* | 9,15 MB | 53,6 GB | Database |

**Yang dipakai = ZIP + parsed selektif ≈ 2,06 MB/klien/bulan (≈12 GB di 500 klien/tahun)**, dan
angka ZIP-nya **menyusut lagi** oleh purge. Bandingkan dengan 53,6 GB bila `extras` disimpan —
penghematan ~41 GB/tahun, tanpa kehilangan kemampuan reparse selama paket masih dalam masa retensi.

> **Catatan teknis yang menjelaskan angka di atas:** `.xlsx` **sudah** zip, jadi kompresi ulang
> hampir tidak menambah. Penghematan 24% datang dari berkas `.csv` (Shopee ads, TikTok orders) yang
> belum terkompresi sama sekali. Karena itu aturan ZIP-nya menguntungkan, tapi bukan ajaib —
> jangan berharap lebih dari itu.

**Kenapa sekarang.** Tiga hal bertumpuk pada lapisan data yang sama: (a) beban AM yang sudah
terukur di atas; (b) laporan klien yang **sudah terkirim dengan skor salah** karena kegagalan parse
ditelan senyap (Shopee: error 16 dari 17 modul dibuang; dimensi ROAS berbobot 22% diberi 5/10
dengan alasan salah); (c) Product Exchange M3 yang butuh baris per-SKU dan hari ini tidak punya
tempat menyimpannya. Satu lapisan fakta menyelesaikan ketiganya; tiga solusi terpisah tidak.

**Batas lingkup yang sengaja dijaga (ketokan PDT-18).** `strategi.ts` (7.763 baris) **tidak
disentuh** di gelombang ini. PDT mengisi setiap field form yang ada datanya di platform, lalu
berhenti — AM hanya mengisi yang memang tidak punya sumber data. Mengganti mesin strateginya
sekaligus adalah risiko yang tidak perlu ditanggung bersamaan.

---

## 2. Keputusan Terkunci

Sepuluh keputusan berikut sudah diketok CEO 12 Sep 2026. Developer **tidak boleh** mendesain ulang.
Kesepuluhnya wajib masuk entri `AgencyAPP/docs/DECISIONS.md` sebelum migrasi pertama di-merge.

> **Penomoran (koreksi K-1).** Kode di repo memakai prefiks **`PDT-`**, bukan `D-`. Namespace `D-NN`
> sudah dipakai tiket backlog M6D dan `D-14` di sana berarti hal yang sama sekali lain. Kolom
> *"nomor asli PRD"* menjaga rujukan silang ke dokumen sumber tetap bisa ditelusuri.
>
> Perhatikan juga bahwa **`D-20`, `D-23`, dan `D-24` tidak pernah ada** di dokumen sumber — lompatan
> itu ikut dibawa apa adanya, tidak dirapatkan, supaya nomor asli tetap cocok.

| Kode repo | Nomor asli PRD | Keputusan |
|---|---|---|
| **PDT-15** | D-15 | **Revisi 2.** Raw disimpan sebagai **paket ZIP di Object Storage** dengan purge otomatis. Parse bersifat **selektif**: hanya field yang dikonsumsi lima konsumen + total shop-level untuk checksum. **`extras jsonb` dibatalkan** |
| **PDT-16** | D-16 | **Checksum rekonsiliasi wajib saat parse.** Total per-SKU harus cocok dengan total shop-level dari berkas periode yang sama; selisih > **0,5%** ⇒ batch **DITOLAK**, bukan diterima diam-diam |
| **PDT-17** | D-17 | **Strangler.** PDT menjadi satu-satunya pintu upload lebih dulu; empat tool lama dimatikan bertahap, bukan serentak |
| **PDT-18** | D-18 | PDT **mengisi semua field form yang ada datanya di platform**. AM hanya mengisi yang tidak ada sumbernya. `strategi.ts` tidak dirombak di gelombang ini |
| **PDT-19** | D-19 | Gerbang kelayakan PX = **GMV SKU total**, basis **pesanan dibayar**, jendela **30 hari** (detail di PRD M3) |
| **PDT-21** | D-21 | **Laporan = view atas fakta (recomputable).** Snapshot beku dibuat **hanya saat laporan dikirim ke klien** |
| **PDT-22** | D-22 | Fase 1 PDT = **TikTok + Shopee**. Meta Ads masuk sebagai modul opsional. Tokopedia/Lazada/Blibli tetap entri manual, **tanpa** mesin parse |
| **PDT-25** | D-25 | **AM mengunggah satu berkas ZIP per toko per periode**, bukan 13 berkas longgar. ZIP disimpan utuh di bucket `pdt-raw`; nol berkas raw di database |
| **PDT-26** | D-26 | **Retensi berjenjang + purge otomatis harian.** Default 120 hari. Diperpanjang otomatis untuk paket yang menopang laporan terkirim atau SKU di katalog PX. `legal_hold` manual oleh Director |
| **PDT-27** | D-27 | Daftar field yang diparse = **gabungan lima konsumen** (strategi, brief, plan, report, Product Exchange) + total shop-level per basis. Daftar ini hidup di `pdt_parser_modul.kolom_dipanen`, bukan di kode |

---

## 3. Rules

### 3.1 Identitas & gerbang

1. Satu batch upload = satu `client_platform` + satu periode. Berkas dari dua toko atau dua
   periode **tidak boleh** masuk satu batch.
2. **Identitas toko divalidasi dari berkas, bukan dari pilihan AM.** Ketiga export iklan Shopee
   membawa preamble `Username`, `Nama Toko`, `ID Toko`, dan `Periode` (baris 1–6). Bila `ID Toko`
   di berkas ≠ `client_platforms.shop_id`, batch **ditolak** dengan pesan yang menyebut kedua nilai.

   **Pengikatan `shop_id` (direvisi sesi 2, ketokan Nerissa Q-1 opsi A — simetris Rule 4).**
   Bila `client_platforms.shop_id` **masih kosong** (kasus F-4: Product Exchange belum dimulai,
   jadi belum pernah diisi), batch Shopee **pertama** boleh masuk berstatus
   `identitas_belum_terikat` — bukan ditolak. Sistem mengusulkan `ID Toko` dari preamble berkas,
   AM mengonfirmasi **sekali**, nilainya terikat permanen ke `client_platforms.shop_id`. `shop_id`
   dengan demikian terisi sebagai **efek samping** validasi identitas PDT — bukan field yang AM
   ketik terpisah — dan Product Exchange (yang memakai kolom yang sama untuk gerbang M3) ikut siap
   begitu batch pertama terverifikasi. Setelah terikat, kembali ke jalur normal ayat pertama Rule
   ini: `ID Toko` berkas vs `shop_id` tersimpan, bukan lagi diusulkan ulang.
3. Export TikTok **tidak membawa shop_id sama sekali** (fakta terverifikasi dari sample). Identitas
   TikTok divalidasi dari `ID Kreator` akun toko terhadap `client_platforms.akun_konten_toko`.
   Kolom itu diisi **sekali** saat onboarding dan tidak pernah diketik ulang — ini yang
   menggantikan pengetikan `linked_accounts` selamanya.
4. Bila `akun_konten_toko` masih kosong, batch TikTok pertama boleh masuk dengan status
   `identitas_belum_terikat`; sistem mengusulkan `ID Kreator` yang paling sering muncul di berkas,
   AM mengonfirmasi satu kali, lalu nilainya terikat permanen.
5. **Periode diambil dari berkas, tidak dari input AM**, bila berkasnya membawanya (preamble Shopee,
   `Date Range`/`Rentang Tanggal` TikTok, `Tanggal analisis` Shop Analytics). Untuk modul Shopee
   yang memang tidak membawa tanggal terbaca, periode diwarisi dari berkas lain di batch yang sama
   — **bukan** diketik AM.

   **Toleransi bulan-sama (direvisi sesi 2, ketokan: "export sesuai sample, ada yang 28 hari ada
   yang 1 bulan, cek saja dari sample").** Batch **ditolak hanya bila berkas-berkasnya berasal dari
   BULAN kalender berbeda** (mencegah Juli tercampur Agustus — maksud asli rule ini utuh). Rentang
   yang berbeda **di dalam bulan yang sama** (mis. satu berkas 1–31 Juli, berkas lain 1–28 Juli)
   **diterima**; `periode_mulai`/`periode_selesai` batch diambil sebagai **rentang terluas** di
   antara seluruh berkas dalam batch itu. ⛔ **Jangan hardcode angka 28** — rentang per modul yang
   sebenarnya (28 hari vs 1 bulan penuh) seharusnya diturunkan dari sample dan dicatat di
   `pdt_parser_modul`, bukan sebagai konstanta di kode. **Catatan jujur:** rentang per modul belum
   bisa dicek hari ini — export asli tidak disimpan di repo (lihat A-3, §9). Toleransi bulan-sama
   di atas sudah membuat gerbang ini aman tanpa mengetahui angka pastinya, dan **tidak** memblokir
   G1; presisi `pdt_parser_modul` menyusul setelah A-3 terjawab.

### 3.2 Parse

6. Setiap modul punya baris di `pdt_parser_modul` berisi tanda tangan kolom, baris header, dan
   versi. Deteksi modul **tidak boleh** bergantung pada nama berkas — nama berkas platform tidak
   stabil (`product_list.xlsx` vs `product_list_20260701.xlsx`, header di baris 3 vs baris 4).
7. **Baris header dicari, tidak diasumsikan.** Sample terverifikasi: CSV iklan Shopee header di
   baris 8; `video-overview` Shopee punya header **dua lapis** dengan blok berulang; TikTok
   `Live Analysis` dan `Video Performance List` header di baris 3.
8. **Hanya kolom yang ada di whitelist `pdt_parser_modul.kolom_dipanen` yang disimpan** (PDT-15
   revisi 2 + PDT-27). Kolom di luar whitelist dilewati. **Nama** kolom yang belum dikenal dicatat di
   `pdt_file.kolom_baru text[]` — nama saja, **bukan nilainya**. Ini yang membuat drift kolom
   terdeteksi dengan biaya mendekati nol.
   **Whitelist wajib memuat field Product Exchange** meski laporan klien tidak memakainya:
   `SKU ID`/`Product ID`, `Seller SKU`, harga satuan, `Product category`, `gmv_dari_kreator`,
   `Sampel terkirim`, `ID Video`, `ID Kreator`, dan GMV basis **pesanan dibayar**. Menghapusnya
   karena "tidak ada di report" akan mematikan M3.
9. **Nama kolom berubah = kasus normal, bukan kasus tepi.** `pdt_kolom_alias` memegang pemetaan
   alias → kolom kanonik per modul. Kolom wajib yang tidak ditemukan **dan** tidak punya alias ⇒
   berkas `parse_status = 'gagal'` dengan pesan yang **menyebut nama kolom yang dicari**.
10. **Kegagalan parse tidak boleh ditelan.** Setiap berkas punya `parse_status` sendiri
    (`ok` / `sebagian` / `gagal`) dan `parse_error` yang tersimpan. Pesan "berkas tidak diunggah"
    **dilarang** dipakai untuk berkas yang diunggah tapi gagal diparse — keduanya harus dapat
    dibedakan di UI dan di DB.
11. `parser_versi` dicatat per batch dan per baris fakta. Bila parser diperbaiki atau whitelist
    diperluas, batch lama dapat **di-reparse dari paket ZIP** selama paket itu **masih dalam masa
    retensi**, dengan entri `audit_logs`. Paket yang sudah dipurge ⇒ batch ditandai
    `perlu_upload_ulang`; UI wajib menyebut tanggal purge-nya, bukan hanya "tidak tersedia".

    **Status `tidak_dapat_dipulihkan` (ditambahkan sesi 2, §2.4 — retensi CDPS tetap 120 hari,
    lihat PDT-26; ini bukan penurunan retensi, melainkan pasangan status untuk kasus di luar
    jendela platform).** `perlu_upload_ulang` mengasumsikan berkas aslinya **masih bisa** diunggah
    ulang dari Seller Center/Shopee Seller Center — sebuah janji yang hanya benar selama jendela
    mundur platform belum lewat. Bila umur batch (dihitung dari `periode_selesai`) melewati ambang
    **per platform** — **TikTok > 180 hari**, **Shopee > 90 hari** — batch ditandai
    `tidak_dapat_dipulihkan`, bukan `perlu_upload_ulang`: menyuruh AM "upload ulang" di luar jendela
    itu adalah instruksi yang mustahil dijalankan, karena platformnya sendiri sudah tidak
    menyimpan berkasnya. UI wajib membedakan ketiganya (`tersedia` / `perlu_upload_ulang` /
    `tidak_dapat_dipulihkan`), bukan menyamaratakan jadi "tidak tersedia".
12. **Skor netral 5/10 dihapus.** Dimensi yang berkasnya tidak ada ⇒ `null` + label
    `data tidak tersedia`, dan dimensi itu **dikeluarkan dari pembobotan** (bobot dinormalisasi
    ulang). Kelengkapan berkas tidak boleh lagi menurunkan skor performa klien.

### 3.3 Rekonsiliasi (PDT-16)

13. Saat semua berkas dalam batch terparse, sistem membandingkan: Σ GMV per-SKU vs GMV shop-level
    pada **basis yang sama**; Σ pesanan per-SKU vs pesanan shop-level.
14. Selisih ≤ 0,5% ⇒ `status = 'verified'`. Selisih > 0,5% ⇒ `status = 'ditolak'`, `reconcile_delta_pct`
    tersimpan, dan UI menampilkan modul mana yang paling mungkin penyebabnya (modul dengan
    `parse_status != 'ok'` disebut lebih dulu).
15. **Basis GMV tidak boleh dicampur dalam satu total.** TikTok = GMV − refund; Shopee memiliki tiga
    basis terpisah (`Pesanan Dibuat`, `Pesanan Siap Dikirim`, `Pesanan Dibayar`) dan ketiganya
    disimpan sebagai baris berbeda di `pdt_fact_shop_daily`, bukan dijumlah. Kasus Fim Motor
    (selisih Rp 295.710.122 = 18,2%) adalah akibat pencampuran ini.
16. Basis default untuk laporan klien Shopee = **Pesanan Siap Dikirim** (konsisten dengan ketokan
    Bedah Toko). Basis untuk gerbang Product Exchange = **Pesanan Dibayar** (PDT-19). Keduanya hidup
    berdampingan karena keduanya tersimpan.

### 3.4 Export tersaring & kelengkapan master SKU

17. `product_list_*.xlsx` TikTok adalah **export tersaring** — kolom `Rentang GMV` berisi filter
    (mis. "GMV ≥250 atau produk terjual"). Master SKU **tidak boleh** dibangun dari berkas ini
    sendirian.
18. Sumber kanonik master SKU: **TikTok** = `Semua pesanan.csv` (`SKU ID`, `Seller SKU`, harga
    satuan) digabung `Transaction_Analysis_Product_List` (`Product ID`, `Product category`);
    **Shopee** = `parentskudetail.xlsx` (`Kode Produk`, `Kode Variasi`, `SKU Induk`).
19. SKU **tidak pernah dihapus** dari master. Yang berubah hanya `status_listing` dan `last_seen_at`.
    Ini yang memungkinkan pelacakan perpindahan kuadran antar bulan (hidden gem → bintang) tanpa
    membandingkan dua laporan HTML dengan mata.
20. **Nama SKU tidak pernah menjadi kunci.** Semua rantai hilir (kuadran → hero SKU → Plan → Brief)
    memakai `pdt_sku_master.id`. Teks bebas nama SKU dilarang menjadi identitas di tabel mana pun.

### 3.5 Laporan (PDT-21)

21. Laporan adalah **view atas fakta**. Tidak ada baris laporan yang menyimpan angka yang bisa
    dihitung dari fakta.
22. Snapshot beku dibuat **hanya** saat laporan dikirim ke klien: `pdt_laporan_kiriman` menyimpan
    payload final + `parser_versi` + `benchmark_versi` + `dikirim_pada`. Baris ini append-only,
    dilindungi trigger `_frozen()`.
23. Benchmark ganti versi ⇒ seluruh laporan **yang belum dikirim** otomatis ikut versi baru; yang
    sudah dikirim tetap memakai versi saat pengiriman. **Nol permintaan upload ulang ke AM** —
    inilah yang menutup bug "ganti ambang = seluruh export historis harus diunggah ulang".
24. Pencabutan laporan **wajib** memicu perhitungan ulang agregat klien (`total_sales`, Health
    Score, baseline Ads). Nol jalan keluar lewat SQL manual.
25. Benchmark dapat diubah lewat **UI admin** (Director), tersimpan sebagai versi baru di
    `pdt_benchmark`. Mengubah ambang tidak boleh lagi butuh migrasi SQL + deploy.

### 3.6 Usulan (pengganti AM Co-Pilot)

26. Katalog aksi hidup di **DB** (`pdt_usulan_katalog`), bukan di dua tempat (server + HTML).
    Nol logika perhitungan di berkas HTML mandiri.
27. **Setiap metrik dan target wajib punya satuan bertipe** (`rupiah` / `persen` / `hitungan` /
    `jam` / `hari` / `views` / **`rasio`** *(§6.3, ditambahkan sesi 2 — ROAS `x` butuh slotnya
    sendiri)*. Target disimpan sebagai `(nilai numeric, satuan enum)`. Ini yang menutup bug
    "20 sesi live dicetak Rp 20,00" dan "CTOR 1,5% dicetak sebagai Rupiah".
28. Rendering target ke brief divisi **wajib** lewat satu formatter yang membaca `satuan`.
    Formatter bebas-satuan dilarang.
29. Setiap aksi menyatakan `platform_berlaku` secara eksplisit. **Aksi yang hanya berlaku TikTok
    tidak boleh membuat klien Shopee menerima nol usulan tanpa pesan.** Bila nol aksi memenuhi
    syarat, UI wajib menampilkan alasannya per aksi terdekat.
30. Minimal **6 aksi khusus Shopee** wajib ada sebelum tool lama dimatikan — populasi klien miring
    ke Shopee, dan Co-Pilot lama menghasilkan nol usulan untuk seluruh populasi itu.
31. **Loop evaluasi wajib hidup.** `pdt_usulan` menyimpan `nilai_sekarang`, `target_nilai`,
    `realisasi_nilai`, dan `verdict` (`tidak_dikerjakan` / `gagal` / `tercapai`). Pemisahan
    "tidak dikerjakan" (masalah tim) vs "gagal" (masalah taktik) adalah satu-satunya sinyal yang
    membedakan keduanya — dan hari ini ia tidak pernah jalan.
32. Nol komponen LLM. Seluruh usulan deterministik (konsisten dengan ketokan Bedah Toko).

### 3.7 Prefill (PDT-18)

33. Setiap field di Riset Awal, Section B, Plan, Brief, dan WRR yang punya sumber di fakta **wajib**
    terisi otomatis dan **read-only**, dengan tautan ke batch sumbernya. AM tidak boleh diminta
    "memeriksa satu per satu" field yang sistem sudah tahu.
34. Field tanpa sumber data tetap manual, ditandai jelas sebagai **input manusia**.
35. **Riwayat GMV 6 bulan tidak pernah diketik** (hari ini: sampai 24 sel manual). Ia dihitung dari
    `pdt_fact_shop_daily` batch-batch sebelumnya.
36. **Riset Awal wajib punya jalur koreksi.** Submit kedua membuat batch baru dengan
    `menggantikan_batch_id`; batch lama ditandai `digantikan`, bukan dihapus. Salah upload sekali
    tidak boleh mengunci skor klien selamanya.
37. `tanggal_tarik_data` **selalu dari jam server**, tidak pernah dari jam browser.

### 3.8 Paket ZIP, retensi, dan purge (PDT-25, PDT-26)

38. **Satu batch = satu berkas ZIP.** AM mengunggah satu paket, bukan 13 berkas longgar. Ini
    sekaligus menegakkan Rule 1 secara fisik: satu paket = satu toko = satu periode.
39. Nama berkas **di dalam** ZIP tidak diatur dan tidak divalidasi. Deteksi modul tetap dari tanda
    tangan kolom (Rule 6) — AM tidak perlu mengganti nama berkas apa pun.
40. Struktur folder di dalam ZIP diabaikan (folder per platform boleh, tidak wajib). Sistem membaca
    seluruh entri secara rata.
41. **Entri yang ditolak:** ZIP bersarang, entri terenkripsi/berkata sandi, ekstensi di luar
    `.xlsx` / `.xls` / `.csv`, dan path yang keluar dari akar arsip (zip-slip). Entri
    `__MACOSX/`, `.DS_Store`, dan berkas berawalan `._` **dilewati tanpa peringatan** — sample lu
    membawanya, dan itu normal untuk zip dari macOS.
42. **Pagar zip bomb:** ukuran paket ≤ **50 MB**, jumlah entri ≤ **40**, rasio dekompresi total
    ≤ **100:1**. Terlampaui ⇒ paket ditolak sebelum entri mana pun dibaca.
43. `sha256` dihitung untuk **paket** dan untuk **setiap entri**. Sidik jari entri yang sama pada
    `client_platform_id` berbeda ⇒ peringatan keras (Rule di §6.1).
44. Paket disimpan di bucket **privat** `pdt-raw`, path
    `{client_id}/{client_platform_id}/{periode_selesai}/{batch_id}.zip`. Bucket **tidak pernah**
    publik; akses hanya lewat signed URL berumur ≤ 15 menit, dan hanya untuk peran yang boleh
    membaca batch itu.
45. **Retensi berjenjang.** `retensi_sampai` dihitung saat batch dibuat dan **diperpanjang
    otomatis**, tidak pernah diperpendek:

    | Kondisi paket | `retensi_sampai` | Alasan |
    |---|---|---|
    | Default (batch `verified`) | **+120 hari** | cukup untuk 1 siklus benchmark + diagnosa |
    | Batch `ditolak` | **+30 hari** | hanya untuk diagnosa parse |
    | Menopang laporan yang **sudah dikirim** ke klien | **+12 bulan** sejak pengiriman | bukti ke klien |
    | Membentuk `px_sku_volume` SKU yang **ada di katalog PX** | selama SKU di katalog **+90 hari** | pernyataan kelayakan komersial harus dapat dibuktikan |
    | `legal_hold = true` | **tidak dipurge** | sengketa klien; hanya Director yang menyalakan/mematikan |

46. **Purge berjalan harian**, menghapus **objek storage saja**. Baris fakta, laporan, verdict, dan
    `pdt_file` **tidak pernah** ikut terhapus — purge storage bukan penghapusan data.
47. Setiap purge menulis `pdt_upload_batch.raw_dihapus_pada` + satu entri `audit_logs`
    (`type = 'auto'`, `action = 'pdt_raw_purged'`) berisi jumlah objek dan total byte.
48. **Purge tidak boleh menghapus objek yang `retensi_sampai`-nya belum lewat, dan tidak boleh
    menghapus lebih dari 5% total objek dalam satu hari** tanpa persetujuan Director. Pagar kedua
    ini melindungi dari bug penghitung retensi yang menghapus massal.
49. Objek yang ada di bucket tapi **tidak punya baris `pdt_upload_batch`** (yatim, mis. upload
    gagal di tengah) dipurge setelah **7 hari**.
50. UI batch wajib menampilkan status paketnya: **tersedia** (dengan tanggal kedaluwarsa),
    **kedaluwarsa** (dengan tanggal purge), atau **legal hold**. AM harus bisa tahu sebelum
    bertanya ke engineer apakah reparse masih mungkin.

---

## 4. Flow

**Flow A — Upload satu kali per toko per periode (jalur utama AM)**
1. AM membuka PDT → pilih klien → toko (`client_platform`) → periode.
2. AM mengunggah **satu berkas ZIP** berisi seluruh export platform periode itu (PDT-25). Sistem
   memeriksa pagar paket lebih dulu (Rule 41–42); paket yang melanggar ditolak sebelum satu entri
   pun dibaca.
3. Sistem mendeteksi modul per entri dari tanda tangan kolom, menampilkan tabel hasil deteksi
   **sebelum** disimpan: modul terdeteksi, baris header, kolom dipanen, kolom baru (nama saja),
   status.
4. AM dapat menimpa hasil deteksi per berkas dari dropdown **seluruh** modul (bukan 4 dari 16
   seperti sekarang).
5. Sistem memvalidasi identitas toko (Rule 2–4) dan periode (Rule 5). Gagal ⇒ tolak batch, jelaskan.
6. Parse selektif → tulis baris fakta sesuai whitelist (Rule 8). Paket ZIP disimpan utuh ke bucket
   `pdt-raw` dengan `retensi_sampai` awal (Rule 45).
7. Rekonsiliasi (PDT-16). Lolos ⇒ `verified`. Gagal ⇒ `ditolak` + tunjuk modul penyebab.
8. Sistem menghitung: skor per dimensi, kuadran SKU, usulan, prefill semua form hilir, dan
   `px_sku_volume` (PRD M3).
9. *Error path:* kegagalan di langkah 6–7 menyisakan batch berstatus `ditolak` yang **tetap
   tersimpan** beserta `parse_error` per berkas, agar dapat didiagnosis tanpa upload ulang.

**Flow B — Laporan**
1. AM membuka laporan periode X → laporan dirender dari view atas fakta.
2. Benchmark aktif dibaca `where aktif = true order by versi desc limit 1` (preseden
   `adsscanner_benchmark`).
3. AM melakukan QC, memperbaiki hal yang perlu (di sumber: fakta/benchmark, bukan di laporan).
4. AM menekan **Kirim ke klien** ⇒ snapshot beku ditulis ke `pdt_laporan_kiriman` (Rule 22).
5. Laporan revisi = snapshot baru, menunjuk `menggantikan_kiriman_id`. **Tidak** meminta berkas
   ulang (Rule 23).

**Flow C — Usulan & evaluasi**
1. Setelah batch `verified`, mesin menjalankan katalog aksi terhadap fakta + benchmark.
2. Aksi yang lolos syarat ditulis ke `pdt_usulan` dengan `(nilai_sekarang, satuan)` dan
   `(target_nilai, satuan)`.
3. Usulan terpilih diteruskan ke Plan → Brief divisi, melalui formatter bersatuan (Rule 28).
4. Pada batch periode berikutnya, mesin mengisi `realisasi_nilai` dari fakta baru dan menetapkan
   `verdict` (Rule 31).
5. Verdict `tidak_dikerjakan` masuk ke ringkasan eksekusi tim; `gagal` masuk ke evaluasi taktik.

**Flow D — Reparse setelah perbaikan parser**
1. Engineer merilis `parser_versi` baru.
2. Job reparse **mengunduh paket ZIP** batch lama yang masih dalam masa retensi, memparse ulang,
   menaikkan `parser_versi` baris fakta, dan mencatat `audit_logs` (`action = 'pdt_reparse'`).
   Batch yang paketnya sudah dipurge dilewati dan dilaporkan sebagai daftar — bukan digagalkan
   diam-diam.
3. Laporan yang belum dikirim otomatis ikut nilai baru; snapshot yang sudah dikirim **tidak
   berubah**.
4. Batch yang tidak bisa direparse (paket sudah dipurge) ditandai `perlu_upload_ulang` secara
   eksplisit, dan hanya batch itu. Upload ulang hanya mungkin bila berkasnya masih ada di Seller
   Center — jendela retensi platform, lihat P-08.

**Flow E — Purge harian (otomatis)**
1. Job harian memilih batch dengan `retensi_sampai < current_date`, `legal_hold = false`,
   `raw_dihapus_pada IS NULL`.
2. Sebelum menghapus, job **menghitung ulang** perpanjangan retensi (Rule 45): laporan terkirim dan
   keanggotaan katalog PX bisa berubah sejak batch dibuat.
3. Job memeriksa pagar 5%/hari (Rule 48). Terlampaui ⇒ berhenti, kirim notifikasi ke Director,
   **nol objek dihapus**.
4. Hapus objek, isi `raw_dihapus_pada`, tulis `audit_logs`.
5. Pass kedua: hapus objek yatim > 7 hari (Rule 49).
6. *Error path:* kegagalan hapus pada satu objek tidak menghentikan sisanya; objek yang gagal
   dicoba lagi besok. `raw_dihapus_pada` **hanya** diisi setelah penghapusan objek benar-benar
   berhasil.

---

## 5. Example

**Input.** AM Rizki mengunggah 13 berkas Shopee klien Fim Motor periode 01–31 Juli 2026 dalam satu
batch.

**Deteksi (langkah 3).**

Paket: `FimMotor_Shopee_202607.zip` — 0,73 MB, 15 entri (2 di antaranya `__MACOSX/._*` yang
dilewati per Rule 41), rasio dekompresi 1,3:1 ⇒ lolos pagar paket.

| Entri | Modul terdeteksi | Header | Kolom dipanen | Kolom baru | Status |
|---|---|---|---|---|---|
| `fim_motor.shopee-shop-stats...xlsx` | `shopee_shop_stats` | 1 | 12 × 3 basis | 0 | ok |
| `parentskudetail.20260701_20260731.xlsx` | `shopee_parent_sku` | 1 | 16 dari 40 | 0 | ok |
| `Data+Keseluruhan+Iklan+Shopee...csv` | `shopee_ads_cpc` | **8** | 9 dari 21 | 3 | ok |
| `Search-Ads-Overall-Data...csv` | `shopee_ads_search` | **8** | 8 dari 22 | 0 | ok |
| `Data-Semua-Iklan-Live...csv` | `shopee_ads_live` | **7** | 7 dari 16 | 0 | ok |
| `voucher_...xlsx` / `discount_...xlsx` | `shopee_voucher` / `shopee_diskon` | 1 | 6 / 6 | 2 | ok |
| `chat_...xlsx` | `shopee_chat` | 1 | 7 | 1 | ok |
| `live_streaming_...xlsx` | `shopee_live` | 1 | 6 | 0 | ok |
| `In_Shop_Flash_Sale_Metrics...xlsx` | `shopee_flash_sale` | 1 | 6 | 0 | ok |
| `video-overview-v3...csv` | `shopee_video` | **2 lapis** | 11 dari 54 | 0 | ok |
| `ProductPerformance_...csv` | `shopee_ams_produk` | 1 | 7 | 0 | ok |
| `AMSAffiliatePerformance_...csv` | `shopee_ams_afiliasi` | 1 | 6 | 0 | ok |
| `Laporan-tanpa-judul-Jul...xlsx` | **`meta_ads`** (bukan Shopee) | 1 | 8 dari 14 | 0 | ok |

Tiga hal yang hari ini tidak terjadi dan di PDT terjadi: entri ke-13 **dikenali sebagai Meta Ads**
dan tidak diam-diam diabaikan; `shopee_video` yang berheader dua lapis **terparse** (11 kolom yang
memang dipakai) alih-alih dilaporkan sebagai "berkas tidak diunggah"; dan enam kolom baru
tercatat **namanya** di tiga entri — sinyal drift yang ditinjau engineer tanpa membayar
penyimpanan nilainya.

**Yang tidak lagi disimpan, dan itu disengaja:** 24 dari 40 kolom `parentskudetail`, 43 dari 54
kolom `video-overview`, dan ~150 dari 176 kolom `product_list` TikTok. Semuanya tetap dapat
dipulihkan dari paket ZIP selama masa retensi.

**Validasi identitas.** Preamble ketiga CSV iklan berisi `ID Toko,938284780` dan
`Periode,01/07/2026 - 31/07/2026`. Keduanya cocok dengan `client_platforms.shop_id` dan periode
batch ⇒ lolos.

**Rekonsiliasi.** Σ `Penjualan (Pesanan Siap Dikirim)` dari 1.504 baris `parentskudetail`
dibandingkan dengan `Pesanan Siap Dikirim` shop-level Rp 1.515.002.476. Selisih 0,18% ⇒ `verified`.

Bila AM keliru memasukkan export Agustus ke batch Juli, langkah 5 menolaknya. Bila parser
`ads_toko` gagal, dimensi ROAS bernilai `null` dan bobot 22% dinormalisasi ulang — **bukan** diberi
5/10 lalu dikirim ke klien sebagai skor KRITIS.

**Hasil satu batch ini (yang sebelumnya butuh 3–5 upload + 11 kelompok data manual):**

| Konsumen hilir | Terisi otomatis |
|---|---|
| Riset Awal / Kondisi Toko | skor 17 modul, kuadran SKU |
| Section B (~20 field) | ROAS, belanja iklan, AOV, omzet, jumlah SKU, target — read-only dari fakta |
| Riwayat GMV 6 bulan | 24 sel, dari batch-batch sebelumnya |
| Plan & Brief | hero SKU sebagai `sku_id`, angle dari konten berperforma baik |
| WRR RM-C | CTR/CVR + tautan batch sebagai bukti (nol `file_bukti` teks) |
| Laporan klien | view, siap QC |
| Product Exchange | `px_sku_volume` basis pesanan dibayar 30 hari |

---

## 6. System Requirements

### 6.1 Tabel batch & berkas

**`pdt_upload_batch`**

| Field | Tipe | Wajib | Catatan |
|---|---|---|---|
| `id` | `bigint` | ya | `bigint GENERATED ALWAYS AS IDENTITY`, **nol prefix baru** — preseden `client_reports` / `px_eligibility_policy` / `client_platforms` (koreksi K-2; `entity_prefix` tetap 44) |
| `client_id` | `bigint` | ya | FK `clients` |
| `client_platform_id` | `bigint` | ya | FK `client_platforms` |
| `platform` | `text` | ya | `tiktok` / `shopee` / `meta` |
| `periode_mulai`, `periode_selesai` | `date` | ya | dari berkas (Rule 5) |
| `status` | `text` | ya | `parsing` / `verified` / `ditolak` / `digantikan` |
| `reconcile_delta_pct` | `numeric(6,3)` | tidak | diisi saat rekonsiliasi |
| `alasan_ditolak` | `text` | tidak | wajib bila `status = 'ditolak'` |
| `parser_versi` | `integer` | ya | |
| `identitas_sumber` | `jsonb` | tidak | `{shop_id, username, nama_toko}` dari preamble |
| `menggantikan_batch_id` | `bigint` | tidak | FK diri sendiri (Rule 36) |
| `dibuat_oleh` | `uuid` | ya | FK `team_members` |
| `dibuat_pada` | `timestamptz` | ya | `now()`, **jam server** (Rule 37) |

**Kolom paket raw pada `pdt_upload_batch`** (PDT-25/PDT-26): `raw_path text` (objek di bucket
`pdt-raw`), `raw_sha256 text`, `raw_bytes bigint`, `raw_entri smallint`, `raw_entri_dilewati smallint`,
`retensi_sampai date NOT NULL`, `retensi_alasan text` (`default` / `laporan_terkirim` /
`katalog_px` / `ditolak`), `raw_dihapus_pada timestamptz`, `legal_hold boolean NOT NULL DEFAULT false`.
- CHECK: `raw_dihapus_pada IS NULL OR raw_path IS NOT NULL`.
- Index: `(retensi_sampai)` **where** `raw_dihapus_pada IS NULL AND legal_hold = false` — indeks
  kerja job purge.

- Unique partial: `(client_platform_id, periode_mulai, periode_selesai)` **where** `status = 'verified'`.
  Batch `ditolak`/`digantikan` tidak memblokir batch pengganti — ini yang hari ini tidak ada jalan
  keluarnya.
- Index: `(client_platform_id, periode_mulai desc)`.

**`pdt_file`** — satu baris per **entri di dalam ZIP**: `batch_id`, `modul_kode`, `nama_entri`,
`sha256`, `bytes`, `baris_header`, `deteksi_oleh` (`tanda_tangan`/`override_am`),
`kolom_dipanen smallint`, `kolom_baru text[]` (nama saja, **bukan nilai** — Rule 8),
`parse_status` (`ok`/`sebagian`/`gagal`), `parse_error text`, `baris_terparse`.
- **`sha256` wajib di-query** saat upload: bila sidik jari sama sudah ada pada
  `client_platform_id` berbeda ⇒ peringatan keras. Hari ini indeksnya ada tapi **nol** query.

### 6.2 Tabel fakta

| Tabel | Kunci | Isi utama |
|---|---|---|
| `pdt_fact_shop_daily` | `(client_platform_id, tanggal, basis)` | gmv, pesanan, produk_terjual, pengunjung, produk_diklik, cr, pembeli, pembeli_baru, refund |
| `pdt_sku_master` | `(client_platform_id, platform_product_id, platform_variation_id)` | seller_sku, nama_produk, nama_variasi, kategori_platform, ⛔`level2_category`, ⛔`price_segment`, harga_satuan_terakhir, status_listing, first_seen_at, last_seen_at |
| `pdt_fact_sku_period` | `(sku_id, periode, basis)` | gmv, gmv_dari_kreator, gmv_video_penjual, gmv_live_penjual, pesanan, pesanan_sku, produk_terjual, impresi, klik, ctr, ctor, atc, cr, refund, kuadran |
| `pdt_fact_content` | `(client_platform_id, platform_content_id)` | jenis (`video`/`live`), creator_platform_id, creator_handle, `is_akun_toko`, waktu_posting, sku_id, vv, likes, komentar, dibagikan, pengikut_baru, produk_dilihat, klik_produk, gmv, durasi_detik |
| `pdt_fact_creator_period` | `(client_platform_id, creator_handle, periode)` | gmv, gmv_live, gmv_video, pesanan_teratribusi, aov, ctor, jumlah_live, jumlah_video, sampel_terkirim |
| `pdt_fact_ads` | `(client_platform_id, sumber, kampanye_id, sku_id, content_id, periode)` | biaya, tayangan, klik, pesanan_sku, gmv, roas |

- Setiap tabel fakta membawa `batch_id` dan `parser_versi`. **Nol `extras jsonb`** (PDT-15 revisi 2)
  — kolom di luar whitelist tidak disimpan; pemulihannya lewat reparse dari paket ZIP.
- Kolom pada setiap tabel fakta **wajib punya konsumen yang disebut namanya** di komentar migrasi
  (`-- konsumen: report.dimensi_roas, px.L2`). Kolom tanpa konsumen tidak boleh lahir. Ini yang
  menjaga PDT-27 tetap berlaku setahun dari sekarang, bukan hanya saat migrasi pertama ditulis.
- **`pdt_fact_content` menyimpan `platform_content_id`** (`ID Video` TikTok). Hari ini export
  membawanya dan CDPS membuangnya — akibatnya GMV Impact konten organik PIC selalu kosong. Kolom
  ini yang menutup rantai itu.
- ⛔ **`level2_category` dan `price_segment` BELUM PUNYA TIPE di CDPS** (koreksi K-4). Grep
  `supabase/migrations/**`: nol hasil untuk keduanya dan untuk enum `price_segment_t` —
  keduanya hidup di sisi MCN/MSDPS (`bridge.px_creator_capability`,
  `creator_subcat_segment_gmv`). **Jangan lahirkan kedua kolom itu di migrasi G1.**
  Keduanya milik G5, dan G5 diblokir sampai P-02/P-03 dijawab. G1–G4 tidak terpengaruh:
  satu-satunya konsumen kedua kolom itu adalah Product Exchange.
- `is_akun_toko` diturunkan dari `client_platforms.akun_konten_toko` — pemisah toko-vs-afiliasi
  yang hari ini diketik ulang AM setiap laporan.

### 6.3 Tabel konfigurasi

- **`pdt_parser_modul`**: `kode` PK, `platform`, `nama_tampilan`, `tanda_tangan_kolom jsonb`,
  `baris_header_hint`, `wajib boolean`, `versi`. Seed berisi seluruh modul di §7.
- **`pdt_kolom_alias`**: `(modul_kode, kolom_kanonik, alias)` PK, `versi_pertama`. Append-only.
- **`pdt_benchmark`**: `versi integer PK`, `nilai jsonb`, `aktif boolean default true`, `catatan`,
  `dibuat_pada`, `dibuat_oleh`. CHECK `versi >= 1`, trigger `pdt_benchmark_frozen()`,
  `REVOKE` + `ENABLE RLS` + nol policy. **Mengikuti preseden `adsscanner_benchmark` huruf per
  huruf**: versi aktif dibaca `where aktif = true order by versi desc limit 1`; nol UPDATE, nol
  partial unique.
- **`pdt_usulan_katalog`**: `kode` PK, `platform_berlaku text[]`, `kondisi jsonb`, `metrik_kunci`,
  `satuan pdt_satuan_t`, `target_formula jsonb`, `divisi_tujuan`, `aktif`.
- ENUM baru: `pdt_satuan_t` = (`rupiah`, `persen`, `hitungan`, `jam`, `hari`, `views`, **`rasio`**
  *(ditambahkan sesi 2, ketokan F-6)*. Katalog Co-Pilot memakai **7** satuan (`Rp`, `%`, `x`,
  `kreator`, `VV`, `video`, `jam`) — enum v1.1 tidak punya slot untuk `x` (mis. ROAS `9,63×`).
  Memaksanya ke `hitungan` mencetak "9,63" tanpa satuan; ke `rupiah` mencetak "Rp. 9,63" — persis
  bug yang Rule 27 ada untuk mencegah. `rasio` mengisi slot itu.

### 6.4 Tabel usulan & laporan

- **`pdt_usulan`**: `id`, `batch_id`, `kode_aksi`, `nilai_sekarang numeric`, `satuan_sekarang`,
  `target_nilai numeric`, `satuan_target`, `realisasi_nilai numeric`, `verdict` (`null` /
  `tidak_dikerjakan` / `gagal` / `tercapai`), `dievaluasi_pada`, `plan_ref`, `brief_ref`.
- **`pdt_laporan_kiriman`**: `id`, `client_platform_id`, `periode_*`, `payload jsonb`,
  `parser_versi`, `benchmark_versi`, `dikirim_pada`, `dikirim_oleh`, `menggantikan_kiriman_id`.
  Append-only, trigger `pdt_laporan_kiriman_frozen()`.

### 6.5 Perubahan pada tabel yang sudah ada

| Tabel | Perubahan | Alasan |
|---|---|---|
| `client_platforms` | `+ akun_konten_toko jsonb` (daftar `ID Kreator`/handle akun toko) | Rule 3–4; menghapus pengetikan `linked_accounts` selamanya |
| `client_platforms` | `+ shop_username text` | validasi identitas Shopee dari preamble |
| `clients` | `target_gmv` dibaca oleh PDT | menghapus pengetikan ulang D-1 floor target |

### 6.6 Keamanan & akses

- `REVOKE ALL` pada seluruh tabel `pdt_*` dari `anon`, `authenticated`. Tulis hanya lewat
  route handler yang memanggil `requireActor(request)` lalu **predikat bernama di domain**
  (koreksi K-3 — `requirePermission` tidak ada di repo ini; PX-M2a menolak permission-key).
- Predikat domain baru di `packages/domain/src/pdt.ts`: `canUploadBatch(actor, ownerAm)` —
  lingkupnya disalin dari `showcase.canKelolaIzinPitch` (Lead Account atau AM pemilik klien);
  `canKelolaBenchmark(actor)` — Director saja; `canKirimLaporan(actor, ownerAm)`.
- **Predikat berdiri sendiri, jangan menumpang predikat lain** — konsisten dengan keputusan di
  PX-M2a.

### 6.7 Non-functional

- Batch 13 berkas (~1.500 baris SKU + ~2.000 baris konten) selesai parse + rekonsiliasi
  **< 45 detik**. Bila lebih, parse dipindah ke job asinkron dengan status polling — **bukan**
  dengan mengurangi kedalaman parse.
- Parse dijalankan **di server**. Nol perhitungan di berkas HTML mandiri; nol `localStorage`
  sebagai tempat bergantung.
- Nol integrasi API ke tool HTML lama. Tool HTML lama akan dimatikan, bukan disambungkan.
- Encoding: CSV Shopee = `utf-8-sig` dengan pemisah koma dan angka format Indonesia
  (`1.234,56`) — parser wajib punya normalisasi angka lokal terpusat, bukan per modul.
- Paket ZIP: ≤ 50 MB, ≤ 40 entri, rasio dekompresi ≤ 100:1 (Rule 42). Ekstraksi dilakukan
  **streaming ke disk sementara**, tidak seluruhnya ke memori.
- Job purge harian selesai < 2 menit pada 500 klien × 12 bulan riwayat.

### 6.8 Anggaran storage

| Komponen | Per klien/bulan | 500 klien × 12 bulan |
|---|---|---|
| Paket ZIP di `pdt-raw` (sebelum purge) | 0,59 MB | 3,4 GB |
| Paket ZIP **setelah** purge 120 hari (≈⅓ bertahan) | — | **≈1,2 GB** |
| Baris fakta parsed selektif (database) | 1,47 MB | 8,6 GB |
| **Total efektif** | ≈2,06 MB | **≈9,8 GB** |

Pembanding yang ditolak: parsed + `extras` semua kolom = **53,6 GB** tanpa kemampuan reparse yang
lebih baik. Penghematan ≈44 GB/tahun. Harga per GB Supabase **perlu dicek** sebelum dikutip sebagai
angka rupiah; yang mengikat di sini adalah ukurannya, bukan tarifnya.

---

## 7. Modul & Peta Kolom dari Export Asli

> **§7 diturunkan dari konsumen nyata, bukan sebaliknya — daftar yang mengikat ada di
> `docs/backlog/PDT_KOLOM_DIPANEN.md`.** Revisi sesi 2 (`docs/handoff/HANDOFF_PDT_SESI1.md` §3):
> verifikasi langsung ke `requireCols`/pemanggil kolom di `packages/core` menemukan **27 kolom
> ber-konsumen nyata** yang §7 (versi sesi 1) lewatkan — tiga di antaranya (`Pendapatan kotor`
> di dua modul Ads, `GPM (Rp)`/`GMV dari video (Rp)` di `tt_video`) adalah kolom yang
> **`requireCols` wajibkan**, sehingga menyusun whitelist harfiah dari tabel di bawah **tanpa**
> merujuk `PDT_KOLOM_DIPANEN.md` akan mematikan parse tiga modul. Satu modul, `shopee_kesehatan`,
> **tidak ada sama sekali** di versi sesi 1 — ditambahkan di §7.2. Tabel di bawah sudah memuat
> penambahan itu; rincian per-kolom dengan kutipan `file:baris` dan bucket
> (derived-keep/derived-add/human-call) ada di `PDT_KOLOM_DIPANEN.md`, bukan diulang di sini.

Terverifikasi terhadap 28 berkas sample (Fim Motor/Shopee, Avitaskin/TikTok), Juli 2026.

### 7.1 TikTok

| Modul | Berkas sample | Kunci yang dipanen | Mengisi |
|---|---|---|---|
| `tt_orders` | `Semua pesanan-*.csv` (65 kolom) | `Order ID`, **`SKU ID`**, `Seller SKU`, `Product Name`, `Variation`, `Quantity`, `SKU Unit Original Price`, `SKU Subtotal After Discount`, `Order Status`, `Paid Time`, `Product Category`, `Creator Handle` | `pdt_sku_master` (harga ⇒ `price_segment`), `pdt_fact_sku_period` basis **dibayar**, atribusi kreator |
| `tt_product_analytics` | `product_list_20260701.xlsx` (176 kolom, header baris 4) | `ID Produk`, `GMV`, `GMV dari kreator`, `GMV dari video/LIVE penjual`, `Pesanan SKU`, `AOV`, `CTR`, `CTOR`, `Impresi produk`, **`Nama`, `Klik produk`** *(sesi 2)* | `pdt_fact_sku_period` (≈16 dari 176 kolom dipanen; sisanya hanya di paket ZIP); `Klik produk`/`Nama` = sumbu X kuadran SKU, dimensi Portfolio Produk 0,12 |
| `tt_transaction_product` | `Transaction_Analysis_Product_List_*.xlsx` | `Product ID`, **`Product category`**, `GMV dari kreator`, `CTOR`, `Video`, `Siaran LIVE`, `Sampel terkirim` | kategori SKU, sinyal PX ("SKU ini sudah jalan di afiliasi") |
| `tt_transaction_creator` | `Transaction_Analysis_Creator_List_*.xlsx` | `Creator name`, `GMV dari kreator`, `AOV`, `CTOR`, `Video`, `Siaran LIVE`, **`Perkiraan komisi`** *(sesi 2)* | `pdt_fact_creator_period`, deteksi kebocoran GMV; `Perkiraan komisi` = sumber `commission_pct` PX Flow D |
| `tt_video` | `Video Performance List_*.xlsx` (header baris 3) | `ID Kreator`, **`ID Video`**, `Waktu`, `Produk`, `VV`, `Likes`, `Dibagikan`, `Klik Produk`, **`Informasi Video`, `GPM (Rp)`, `GMV dari video (Rp)`** *(sesi 2 — `requireCols` wajib)* | `pdt_fact_content`; menutup GMV Impact organik; tiga kolom sesi 2 menutup dimensi Video 0,18 (tanpanya `requireCols` gagal dan modul ini tidak terparse sama sekali) |
| `tt_live` | `Live Analysis*.xlsx` (header baris 3) | `ID Kreator`, `Waktu Live`, `Durasi`, `GMV dari LIVE`, `Produk Terjual`, **`Penonton`, `CTOR`, `Kreator`/`Nama panggilan`** *(sesi 2)* | `pdt_fact_content` jenis `live`; tiga kolom sesi 2 = Co-Pilot L3 + pemisah toko-vs-afiliasi |
| `tt_shop_analytics` | `Shop Analytics_Key metrics_*.xlsx` | `GMV`, `Pesanan`, `Pembeli`, `Pesanan SKU`, `Pengunjung`, `Persentase konversi`, `Pendapatan bruto`, **`Pengembalian dana`, `GMV dari LIVE kreator`, `GMV dari LIVE akun tertaut` (alias `GMV LIVE penjual`/`GMV tidak langsung dari LIVE penjual`), `GMV dari video afiliasi`, `GMV dari video akun tertaut`** *(sesi 2)* | `pdt_fact_shop_daily`, sisi rekonsiliasi; lima kolom sesi 2 = `gmvNet` (standar GMV MEA = GMV − refund) + channel-mix live/video/kartu (dimensi Kartu Produk & Shop Tab 0,14) + Section B-2.3 |
| `tt_ads_product` | `creative data for product campaigns *.xlsx` | `ID Campaign`, **`ID produk`**, **`ID video`**, `Akun TikTok`, `Biaya`, `Pesanan SKU`, `Biaya per pesanan`, **`Pendapatan kotor`** *(sesi 2 — `requireCols` wajib)* | `pdt_fact_ads` tersambung ke SKU **dan** konten; `Pendapatan kotor` = sisi pendapatan ROAS, dimensi GMV Max Ads 0,22 |
| `tt_ads_live` | `livestream data for live campaigns *.xlsx` | `Nama LIVE`, `ID Campaign`, `Biaya`, `Pesanan SKU`, `ROI`, **`Pendapatan kotor`** *(sesi 2 — `requireCols` wajib)* | `pdt_fact_ads`; `Pendapatan kotor` = sisi pendapatan ROAS, dimensi GMV Max Ads 0,22 |

⚠️ Dua `Shop Analytics_Key metrics` di sample punya **jumlah kolom berbeda (11 vs 14)** dan angka
berbeda jauh (Rp 130.097 vs Rp 26.560.049). **Perlu dicek** apakah salah satu hasil filter produk.
Sampai terjawab, `tt_shop_analytics` tidak boleh dipakai sebagai satu-satunya sisi rekonsiliasi —
pakai `tt_orders` sebagai sisi kanonik.

### 7.2 Shopee

| Modul | Berkas sample | Kunci yang dipanen | Mengisi |
|---|---|---|---|
| `shopee_shop_stats` | `*.shopee-shop-stats.*.xlsx` (12 sheet) | 3 basis × 14 metrik + asal kunjungan + asal penjualan | `pdt_fact_shop_daily` per basis (Rule 15) |
| `shopee_parent_sku` | `parentskudetail.*.xlsx` (7 sheet, 40 kolom, 1.504 baris) | `Kode Produk`, `Kode Variasi`, **`SKU Induk`**, penjualan 2 basis, views, klik, CTR, CR, repeat order, **`Pengunjung Produk (Kunjungan)`** *(sesi 2)* | `pdt_sku_master`, `pdt_fact_sku_period`; `Pengunjung Produk (Kunjungan)` = sumbu X 4-kuadran Shopee, dimensi Product Performance 0,14 |
| `shopee_ads_cpc` | `Data+Keseluruhan+Iklan+Shopee-*.csv` (header **baris 8**) | preamble `ID Toko`/`Periode`; `Kode Produk`, `Dilihat`, `Klik`, `Konversi`, `Biaya`, omzet, **`nama iklan`, `omzet penjualan`, `Efektifitas Iklan` (ROAS), kolom `(ACOS)`** *(sesi 2)* | identitas + `pdt_fact_ads` per SKU; empat kolom sesi 2 = dimensi ROAS & Channel 0,22 |
| `shopee_ads_search` | `Search-Ads-Overall-Data-*.csv` (header baris 8) | `Kata Pencarian`, `SOV`, klik, konversi | `pdt_fact_ads` + riset keyword |
| `shopee_ads_live` | `Data-Semua-Iklan-Live-*.csv` (header baris 7) | `ID Iklan`, `Penonton`, `Pesanan`, `Omzet`, `Biaya`, `Efektifitas Iklan` | `pdt_fact_ads` |
| `shopee_live` | `live_streaming_*.xlsx` (3 sheet) | `Informasi Streaming`, `Waktu Mulai`, `Pengunjung`, `Penjualan` | `pdt_fact_content` jenis `live` — **menutup dimensi Live Shopee yang hari ini struktural maks 5/10** |
| `shopee_video` | `video-overview-v3*.csv` (header **2 lapis**, 54 kolom) | transaksi, kunjungan, sumber penonton, konversi | `pdt_fact_content` (11 dari 54 kolom dipanen) |
| `shopee_voucher` / `shopee_diskon` / `shopee_flash_sale` | `voucher_*`, `discount_*`, `In_Shop_Flash_Sale_*` | penjualan 2 basis, klaim, tingkat penggunaan, biaya promo | dimensi promo + biaya promo |
| `shopee_chat` | `chat_*.xlsx` (5 sheet) | waktu respon, % dibalas, CSAT, konversi chat | dimensi layanan |
| `shopee_chat_broadcast` | `Chat_Broadcast_overview_*.xlsx` | penerima, dibaca, diklik, pesanan | dimensi CRM |
| `shopee_ams_produk` | `ProductPerformance_*.csv` | `Kode Item`, omzet, komisi, ROI | sinyal PX sisi Shopee; `komisi` = sumber `commission_pct` PX Shopee |
| `shopee_ams_afiliasi` | `AMSAffiliatePerformance_*.csv` | `ID Affiliates`, omzet, komisi, ROI | `pdt_fact_creator_period` Shopee |
| **`shopee_kesehatan`** *(modul baru, sesi 2 — tidak ada di v1.1)* | tersirat dalam paket ZIP Bisnis Saya (header sheet: `Poin Penalti`, `Deskripsi`, `Durasi`) | `Poin Penalti`, `Deskripsi`, `Durasi` — seluruh modul, tiga kolom | dimensi Kesehatan Toko 0,12 (`report/shopee/skor.ts:104-111`), Section B-4.3 poin penalti; modul ini **tidak ada sama sekali** di §7 v1.1, bukan kasus "kolom hilang dari modul yang sudah terdaftar" |

### 7.3 Lintas platform

| Modul | Berkas sample | Catatan |
|---|---|---|
| `meta_ads` | `Laporan-tanpa-judul-Jul-*.xlsx` | **Fakta baru:** klien Shopee ini menjalankan Meta Ads. Kolom: `Nama kampanye`, `Nama iklan`, `Jumlah yang dibelanjakan`, `Nilai Konversi Pembelian`, `ROAS`, `Impresi`, `Klik tautan`, `CTR`, `CPM`, `CPC`, **`Minggu`** *(sesi 2)*. Modul **opsional** (PDT-22); tidak masuk rekonsiliasi karena bukan sumber GMV toko; `Minggu` = kunci baris pemisah ringkasan vs mingguan saat parse |

---

## 8. Rencana Strangler (PDT-17)

| Gelombang | Isi | Tool lama yang mati |
|---|---|---|
| **G1** | Migrasi tabel + `pdt_parser_modul` + parse TikTok & Shopee + rekonsiliasi + halaman upload & hasil deteksi | — (PDT jalan berdampingan, **wajib** untuk semua batch baru) |
| **G2** | Laporan sebagai view + benchmark UI admin + pengiriman & snapshot | Report Engine TikTok & Shopee |
| **G3** | Prefill Riset Awal + Section B + riwayat GMV + Video Factory | AM Baseline (Riset Awal + Video Factory) |
| **G4** | Katalog usulan bersatuan + 6 aksi Shopee + loop verdict | AM Co-Pilot (termasuk berkas HTML mandiri) |
| **G5** | `px_sku_volume` + `px_sku_eligibility` (PX-M2b) | — |

**Aturan strangler yang tidak boleh dilanggar:** sejak G1 merge, **nol batch baru** boleh masuk
lewat tool lama. Tool lama hanya boleh dibaca (untuk data historis), tidak ditulis. Tanpa aturan
ini, strangler berubah menjadi "dua sistem paralel selamanya" — dan duplikasi kerja AM justru naik.

**Gerbang antar gelombang:** sebuah gelombang hanya boleh merge bila gelombang sebelumnya sudah
`verified` pada **minimal 10 klien nyata** (campuran TikTok & Shopee), bukan pada data seed.

---

## 9. Open Assumptions

Wajib dijawab sebelum coding modul terkait.

> **Status verifikasi ditambahkan saat PRD masuk repo.** Empat dari sebelas sudah bisa dijawab
> dari kode hari ini — tiga di antaranya ternyata **premisnya keliru**, dan itu justru alasan
> kenapa kolom ini ada. Rinciannya `docs/backlog/PDT_BACKLOG.md` §5.
>
> **Update sesi 2 (2026-09-13, ketokan Nerissa — `docs/handoff/HANDOFF_PDT_SESI1.md` §2–§2.4).**
> Lima lagi tertutup: **P-01** (verifikasi kode), **P-06** (tertutup F-9), **P-08** (§2.4 — retensi
> **tidak** diturunkan), **P-10** (150–300 klien, dikunci ke 300), **P-11** (SOP, bersyarat).
> **Sembilan dari sebelas** sekarang punya jawaban tertulis — termasuk **P-02/P-03**, yang
> jawabannya memblokir **G5 saja** (taksonomi lintas-sistem belum diputuskan bagaimana masuk
> CDPS), bukan G1–G4. Sisa **dua yang benar-benar belum terjawab**: **P-04** (🟠 sebagian —
> lingkup G1-02/G1-03 sudah melebar mengikutinya) dan **P-07** (kapasitas partisi, menunggu Hans)
> — **tidak satu pun dari sebelas memblokir G1**.

| # | Asumsi | Status | Penjawab | Dampak bila salah |
|---|---|---|---|---|
| P-01 | Dua `Shop Analytics_Key metrics` berbeda kolom (11 vs 14) karena filter produk, bukan versi export berbeda | ✅ **terjawab (sesi 2)** — **premis salah, tapi jinak.** Kedua sample adalah `shop_tt` (TikTok) vs `shop_tp` (Tokopedia) — **35 baris sama, periode sama** — bukan filter produk. Pembeda: `GMV dari LIVE kreator` (TikTok) vs `Pendapatan bruto` (Tokopedia), `packages/core/src/baseline/detect.ts:26-27`. Rp 130.097 = kanal Tokopedia yang nyaris mati | Claude (verifikasi kode) | ⇒ **`tt_orders` tetap sisi rekonsiliasi kanonik TikTok** (tidak berubah); `tt_shop_analytics` tetap **bukan** satu-satunya sisi rekonsiliasi (Rule di G1-07) |
| P-02 | `Product category` TikTok (mis. "Perawatan & Kecantikan") dapat dipetakan ke `level2_category` taksonomi MCN (198 nilai). **Kemungkinan besar tidak** — granularitasnya beda | 🔴 **premis salah** — `level2_category` nol hasil di `supabase/migrations/**`; ia hidup di MCN. Blokir **G5** | Hans | gerbang PX tidak bisa mencocokkan kategori; lihat PRD M3 §Rules 7 |
| P-03 | Nilai enum `price_segment_t` di MCN cukup untuk sebaran harga SKU klien agency (A-01 masih terbuka sejak PRD M1) | 🔴 **premis salah** — enum `price_segment_t` tidak ada di CDPS sama sekali. Blokir **G5** | Hans | `price_segment` SKU tidak bisa dihitung |
| P-04 | Tiga tool lama benar melewati jalur parse yang sama di `packages/core` (A-09) | 🟠 **sebagian terjawab dari kode** — `baseline/sheet.ts readSheet` memang dipakai bersama, tapi ada **4 registry tanda tangan terpisah** + **2 parser angka berbeda perilaku** | Hans | lingkup G1 melebar |
| P-05 | `optimization_tracker` (PK `screening_id, product_code`) dapat di-migrasi ke `pdt_sku_master` tanpa kehilangan riwayat (A-10) | ✅ **terjawab — premis salah, dan itu bukan kerugian.** `optimization_tracker` adalah tracker A/B before-after yang **mutable**, bukan master SKU; `product_code`-nya jatuh balik ke **nama produk**, melanggar Rule 20. "Kehilangan riwayat kuadran" yang P-05 khawatirkan **tidak terjadi** — riwayat kuadran memang tidak pernah ada di sana | Claude (verifikasi kode) | ⇒ **tidak dimigrasi.** `optimization_tracker` kelak *menunjuk* ke `pdt_sku_master.id`; baris ber-kunci-nama diperlakukan sebagai yatim yang di-*resolve*, bukan diimpor |
| P-06 | Shopee `Kode Produk` stabil antar periode (tidak berubah saat produk di-edit penjual) | ✅ **tertutup (F-9)** — pertanyaan stabilitas jadi tidak-memblokir: ketokan F-9 ("SKU tanpa Kode Produk tidak dimasukkan ke Product Exchange") sudah menegaskan **Rule 20 menang** — `skuKey` fallback-nama **tidak** dipakai di `pdt_sku_master` apa pun jawabannya. SKU yang `Kode Produk`-nya berubah/hilang antar periode cukup diperlakukan sebagai baris baru/yatim yang di-*resolve*, bukan alasan menunda desain master SKU | Nerissa (ketokan F-9, 2026-09-13) | tidak lagi memblokir — stabilitas empirisnya tetap berguna untuk dipantau AM/Hans, tapi bukan prasyarat G1 |
| P-07 | Kapasitas Supabase cukup untuk ~1.500 baris SKU × ~500 klien × 12 bulan (≈9 juta baris/tahun di `pdt_fact_sku_period`) | 🟡 terbuka | Hans | butuh partisi per tahun sejak awal |
| P-08 | **Jendela retensi export di Seller Center TikTok & Shopee ≥ 120 hari.** Bila lebih pendek, retensi default PDT-26 harus diturunkan ke jendela itu — menyimpan paket lebih lama dari kemampuan platform mengganti berkasnya tetap berguna (reparse), tapi klaim "bisa upload ulang" jadi tidak benar | ✅ **terjawab (§2.4) — dan saran PRD ("turunkan retensi") SENGAJA tidak dijalankan.** TikTok 180 hari mundur > retensi 120 hari (aman); **Shopee 90 hari < 120 hari** — ada **30 hari** di mana paket ZIP kita satu-satunya salinan. Menurunkan retensi ke jendela platform berarti menghapus salinan itu **tepat saat ia mulai jadi satu-satunya** | Nerissa (ketokan, 2026-09-13) | **Retensi TETAP 120 hari** (PDT-26 tidak berubah). Yang berubah: status `perlu_upload_ulang` (Rule 11) butuh pasangan **`tidak_dapat_dipulihkan`**, ambang per platform TikTok >180h / Shopee >90h |
| P-09 | Supabase Storage (bucket privat + signed URL) tersedia dan dapat dipakai dari `AgencyAPP`; belum ada preseden bucket di repo ini | ✅ **terkonfirmasi** — nol bucket, nol `supabase/functions/`, `storage.objects` kosong. Konsekuensi: job purge **tidak bisa pure SQL** | Hans | butuh penyimpanan objek alternatif; anggaran storage berubah |
| P-10 | Jumlah klien aktif ~500 (asumsi gue, belum diverifikasi) | ✅ **terjawab (150–300)** — desain dikunci ke **batas atas 300** klien: ≈5,4 jt baris/tahun `pdt_fact_sku_period`, ≈0,72 GB ZIP pasca-purge, ≈5,3 GB fakta | Anty (ketokan, 2026-09-13) | §6.8 di bawah masih dihitung di atas asumsi 500 klien — **butuh direvisi turun** mengikuti 300 sebagai patokan baru; dicatat sebagai gap dokumentasi terbuka, bukan diubah di revisi ini (di luar cakupan Tugas §4 sesi 2) |
| P-11 | AM sanggup mengubah kebiasaan jadi "zip dulu, upload sekali" tanpa tool bantu. Bila tidak, butuh 1 halaman panduan + tombol "cek paket" sebelum upload | ✅ **terjawab (SOP) — bersyarat, bukan tanpa syarat.** Jawabannya bukan "AM pasti bisa tanpa bantuan": F-3/F-10 menegaskan adopsi rendah tool lama justru **gejala** tool HTML lama yang tidak membantu (AM berulang kali mengisi kolom yang sama), bukan bukti AM menolak berubah. Syaratnya dua: SOP tertulis (satu batch per toko per periode + arti mengisi Shop ID) **dan** tombol "cek paket" sebelum upload (sudah masuk desain G1-09) | Nerissa + Anty (ketokan F-3/F-10, 2026-09-13) | Tiket SOP non-coding ada di `PDT_BACKLOG.md` §7 butir 5 — owner Nerissa + Anty, bukan Claude; **wajib selesai sebelum G1 merge** |

---

## 10. Success Metrics

| Metrik | Baseline hari ini | Target G4 selesai | Sumber ukur |
|---|---|---|---|
| Upload export per klien per bulan (se-organisasi, klien 2 platform) | 5× (7× bulan onboarding) | **2×** (1 per toko) | `pdt_upload_batch` |
| Kelompok data diketik/dikonfirmasi ulang | 11 + ~20 field Section B | **≤ 3 kelompok** (hanya yang tanpa sumber data) | audit field manual |
| Rantai data putus | 7 dari 9 | **0 dari 9** | tes integrasi per rantai |
| Laporan terkirim dengan dimensi ber-skor netral 5/10 | tidak terukur | **0** | `pdt_laporan_kiriman.payload` |
| Batch ditolak karena identitas/periode salah (terdeteksi, bukan lolos) | 0 terdeteksi | **100% terdeteksi** | `pdt_upload_batch.alasan_ditolak` |
| Klien Shopee menerima nol usulan tanpa pesan | seluruh populasi Shopee | **0** | `pdt_usulan` per batch |
| Usulan yang punya `verdict` pada periode berikutnya | 0% (loop mati) | **≥ 80%** | `pdt_usulan.verdict` |
| Laporan revisi yang butuh upload ulang berkas | 100% | **0%** | Flow B langkah 5 |
| Storage terpakai per klien per bulan | tidak terukur | **≤ 2,5 MB** (ZIP + fakta) | §6.8 |
| Paket ZIP dipurge sesuai jadwal (tanpa objek yatim > 7 hari) | n/a | **100%** | `audit_logs` `pdt_raw_purged` |
| Batch yang gagal reparse karena paket sudah dipurge | n/a | **≤ 5%** dari permintaan reparse | `perlu_upload_ulang` |

---

## Langkah konkret

| # | Langkah | Owner (role) | Metrik sukses |
|---|---|---|---|
| 1 | Tulis entri `DECISIONS.md` untuk PDT-15 (revisi 2) s/d PDT-27 sebelum migrasi pertama — termasuk **pembatalan `extras jsonb`** dan alasan angkanya | CTO (Hans) | entri ada, di-review Nerissa |
| 2 | Jawab P-01 s/d P-11 | CTO (Hans) + Anty | 11 dari 11 terjawab tertulis |
| 2b | **Susun daftar `kolom_dipanen` per modul (PDT-27)** dari lima konsumen, sebelum migrasi pertama | CTO (Hans) + Head of Account (Anty) | daftar final, field PX ikut masuk |
| 2c | Buat bucket privat `pdt-raw` + job purge harian + notifikasi pagar 5% | CTO (Hans) | purge jalan di staging, `audit_logs` terisi |
| 3 | Seed `pdt_parser_modul` dari §7 + kumpulkan sample 2 klien lain per platform | Head of Account (Anty) | ≥ 4 set sample, semua modul punya tanda tangan kolom |
| 4 | Bangun G1 | CTO (Hans) | 10 klien nyata `verified`, rekonsiliasi ≤ 0,5% |
| 5 | SOP AM: satu batch per toko per periode + arti mengisi Shop ID | COO (Nerissa) + Head of Account (Anty) | 100% AM tersosialisasi sebelum G1 merge |
| 6 | Matikan tulis di tool lama saat G1 merge | CTO (Hans) | nol batch baru di tool lama |
