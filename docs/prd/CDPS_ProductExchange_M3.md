> **Catatan penerapan di CDPS (`AgencyAPP`) — dibaca sebelum §3.** Bagian **M3-B** PRD ini (sisi
> CDPS) dieksekusi lewat sesi terpisah 2026-09-15 (`PLAN_PX_M3B_AgencyAPP.md`, pemilik Yohan),
> **paralel** dengan pengerjaan PDT G2 yang sedang berjalan di sesi lain. Delapan deviasi/keputusan
> tambahan dicatat `docs/DECISIONS.md` 2026-09-15 sebagai **PX-M3-01..08** (namespace kode `D-19`/
> `D-20`/`D-23`/`D-24` di bawah bertumbukan dengan `D-NN` M6D yang sudah ada di CDPS — ketokan ulang
> ditulis sebagai `PX-D-19` dst. di teks keputusan, pola koreksi K-1 PDT). Ringkasan deviasi utama:
>
> 1. **Kunci volume per PRODUK (`platform_product_id`), bukan per SKU/varian** (§6.1 PRD memakai
>    `sku_id`) — PX-M3-07. Satu-satunya penulis `pdt_fact_sku_period` hari ini (`shopee_ams_produk`)
>    menulis level produk-induk (`sku_id NULL`); memaksa salah satu varian akan mengarang atribusi,
>    kelas kesalahan yang sama dengan `G1-09-2BII-ADS-CPC-SKU` (migrasi 20261025010000). TikTok belum
>    punya penulis fakta per-SKU sama sekali — lihat tiket `PDT-TIKET-TT-ORDERS-FAKTA-DIBAYAR` untuk
>    chat PDT di `docs/backlog/PX_M3_BACKLOG.md`.
> 2. **`level2_category` di tabel terpisah `px_sku_kategori`** (§6.1 PRD meminta ALTER
>    `pdt_sku_master`) — PX-M3-01, menghormati K-4 PDT ("`level2_category`/`price_segment` bukan
>    milik PDT").
> 3. **`px_sku_eligibility.coverage_snapshot_batch_key text`** menggantikan `coverage_snapshot_id
>    bigint` (§6.1) — merujuk `batch_key` (kunci idempotensi push, sudah unik) alih-alih satu baris
>    snapshot spesifik, karena L4 mengevaluasi per `(level2_category, price_segment)` yang bisa
>    berupa banyak baris snapshot dalam satu `batch_key`.
> 4. **Jendela 30 hari = bulan kalender penuh dari batch `verified` terakhir** (bukan jendela rolling
>    30 hari harfiah §3.2 Rule 4) — PX-M3-02, karena fakta hari ini bergranularitas bulanan
>    (`pdt_fact_sku_period.periode` = awal bulan), bukan harian.
> 5. **Endpoint bridge** di `/api/v1/internal/bridge/px-coverage` (konvensi path repo) — PX-M3-03,
>    bukan `/api/bridge/px-coverage` ilustratif §7.
> 6. **422 untuk kolom asing** payload bridge (§7 Rule 4/§4 Flow C langkah 4) — PX-M3-04, deviasi
>    sadar dari konvensi HTTP repo (validasi lain = 400), errornya `ProductExchangeContractError`.
> 7. **`require_stock_in` (M3-06, D-di atas) TIDAK dibaca Phase 1** — PX-M3-05: PRD sendiri men­catat
>    M3-06 sebagai Open Assumption belum terjawab ("tidak ada modul export yang membawa stok").
> 8. **`price_segment_bands`** (Rule 12, band harga) dibawa sebagai `px_eligibility_policy` **versi
>    2** (append-only, TBC menunggu Hans/M3-02) — PX-M3-06.
> 9. **Retensi `pdt_upload_batch`** (§0(b)/D-26) diperpanjang oleh **domain PX** langsung (UPDATE
>    `retensi_sampai`/`retensi_alasan='katalog_px'`), bukan lewat job purge PDT — PX-M3-08, menutup
>    setengah dari `G1-10-RETENSI-RECOMPUTE` (`docs/DECISIONS.md`, Open) tanpa menyentuh `pdt.ts`.
> 10. **Aktivasi ditunda**: tick route manual (`POST/GET /internal/px/evaluate/tick`), TANPA cron/hook
>     otomatis pada commit PDT, sampai PDT G1 `verified` di ≥10 klien (ketokan pemilik 2026-09-15,
>     selaras §0/Langkah 4 PRD "Selesaikan PDT G1 lebih dulu").
> 11. **Fase 1 mencakup TikTok + Shopee di seed policy** (`platforms: ["tiktok","shopee"]` versi 2) —
>     berbeda dari D-23 PRD ("Phase 1 = TikTok saja"): keputusan pemilik 2026-09-15 memasukkan Shopee
>     karena sumber fakta hari ini (`shopee_ams_produk`) justru Shopee, bukan TikTok (TikTok belum
>     punya penulis fakta per-SKU sama sekali — lihat poin 1). SKU Shopee tetap akan tersendat di L3
>     (`kategori_belum_dikonfirmasi`) sampai pemetaan `kategori_platform`→`level2_category` Shopee ada
>     (M3-03, Open) — konsisten dengan alasan D-23 sendiri, hanya gerbangnya pindah dari L1 ke L3.
>
> M3-A (eksporter coverage sisi `mcnapp`) dikerjakan di sesi terpisah; bagian §6.2/§7 PRD di bawah
> menjadi rujukan kontrak bersama, bukan pekerjaan sesi ini. Lihat `docs/BRIDGE_PRODUCT_EXCHANGE_CONTRACT.md`
> untuk bentuk final endpoint (mengunci deviasi 5/6 di atas) dan `docs/handoff/HANDOFF_PX_M3B_SESI1.md`
> untuk detail penerapan penuh.

# PRD — Product Exchange M3 (SKU Ingestion, Eligibility & Bridge Transport)
**Versi 1.1 · 12 September 2026 · PT MEA Agensi Digital**
*Selaras dengan PRD PDT v1.1 (D-15 revisi 2, D-25 s/d D-27).*

Melanjutkan `PRD-product-exchange-M1-M2.md` v1.0 dan plan induk revisi 2.
M3 adalah tempat kedua sisi benar-benar bertemu: **supply kreator** (PX-M1, `mcnapp`) dan
**demand SKU klien** (PX-M2a + PDT, `AgencyAPP`).

| Bagian | Repo | Supabase | Estimasi |
|---|---|---|---|
| **M3-A** — eksporter coverage + endpoint push | `yohanagustian-del/mcnapp` | `bqknstylbpwsnlgnzayw` | 3–4 dev-day |
| **M3-B** — penerima coverage + `px_sku_volume` + `px_sku_eligibility` + katalog | `MEAgrup/AgencyAPP` | `egddxfcnrtecheiykhlf` (`ap-southeast-1`) | 6–9 dev-day |

**Prasyarat keras:** PX-M1 merged (`bridge.px_coverage_map()` ada), PX-M2a merged
(`client_platforms.shop_id` + `px_eligibility_policy` ada), **PDT G1 merged** (`pdt_fact_sku_period`
+ `pdt_sku_master` berisi data terverifikasi). M3 **tidak boleh** dimulai sebelum PDT G1 `verified`
di ≥10 klien — tanpa lapisan fakta, M3 tidak punya sumber baris per-SKU dan akan mengulang
kesalahan "angka hidup di dalam payload laporan".

> **Dua ketergantungan ke PRD PDT v1.1 yang wajib dipegang, bukan diasumsikan.**
>
> **(a) D-27 — whitelist kolom.** PDT hanya menyimpan kolom yang punya konsumen. Field yang **hanya**
> dipakai M3 dan tidak dipakai laporan klien — `SKU ID`/`Product ID`, `Seller SKU`, harga satuan,
> `Product category`, `gmv_dari_kreator`, `Sampel terkirim`, dan **GMV basis pesanan dibayar** —
> **wajib** masuk daftar `pdt_parser_modul.kolom_dipanen` sejak migrasi pertama PDT. Kalau tidak,
> M3 lahir tanpa sumber data dan whitelist-nya harus diperluas lalu seluruh batch direparse.
>
> **(b) D-26 — retensi paket raw.** Paket ZIP batch yang membentuk `px_sku_volume` untuk SKU yang
> **ada di katalog** diperpanjang otomatis: selama SKU di katalog **+90 hari**. Pernyataan kelayakan
> komersial (SKU ini tembus Rp 200jt) harus dapat dibuktikan ulang dari sumbernya; verdict tanpa
> jejak sumber adalah persis kelemahan yang dicatat di audit (*"pernyataan kelayakan tanpa
> riwayat"*).

## Daftar Isi
1. [Background](#1-background)
2. [Keputusan Terkunci](#2-keputusan-terkunci)
3. [Rules](#3-rules)
4. [Flow](#4-flow)
5. [Example](#5-example)
6. [System Requirements](#6-system-requirements)
7. [Kontrak Bridge](#7-kontrak-bridge-mcn--cdps)
8. [Open Assumptions](#8-open-assumptions)
9. [Success Metrics](#9-success-metrics)

---

## 1. Background

**Yang sudah ada setelah gelombang M1/M2a.**
- Sisi MCN: `bridge.px_creator_capability` + `bridge.px_coverage_map()` menjawab *"sub-kategori dan
  segmen harga mana MEA punya kreatornya, dan berapa slot tersisa"*.
- Sisi CDPS: `client_platforms.shop_id` terisi = toko itu punya agency plan TAP/SAP = SKU-nya boleh
  diproses (ketokan 6). `px_eligibility_policy` v1 menyimpan ambang Rp 200jt, `per_sku`, 30 hari,
  `commission_floor_pct: null`, `require_stock_in: true`, `platforms: ["tiktok"]`.

**Tiga lubang yang M3 harus tutup.**
1. **Nol baris per-SKU yang persisten di CDPS.** `px_eligibility_policy` ada tapi **nol pembaca**.
   Dokumen penggabungan mencatatnya apa adanya: katalog SKU + matching belum ada. PDT menutup ini.
2. **Nol transport antar proyek.** PRD berhenti di nama schema `bridge`; transportnya tidak pernah
   ditulis. CDPS tidak bisa membaca database MCN — dua proyek Supabase terpisah (D-03).
3. **Nol kategori pada SKU.** Registry kreator berkunci `level2_category` (198 nama kanonik
   TikTok). Export produk platform **tidak** membawa nilai selevel itu: TikTok hanya membawa satu
   tingkat kategori (mis. "Perawatan & Kecantikan"), Shopee **nol kolom kategori**. Ini fakta dari
   sample, bukan dugaan — dan ia menentukan bentuk Flow B.

**Prinsip yang dipertahankan.** Demand-first: hanya SKU yang **ada kreatornya** yang boleh masuk
katalog. Kelayakan volume (Rp 200jt) dan ketersediaan kreator (coverage) adalah **dua gerbang
terpisah**; SKU besar di kategori kosong **tidak** masuk katalog, karena janji yang tidak bisa
dipenuhi lebih mahal daripada peluang yang terlewat.

---

## 2. Keputusan Terkunci

| Kode | Keputusan | Status |
|---|---|---|
| D-01 | Gate kelayakan per SKU, ambang **Rp 200.000.000/bulan** | sudah, dari M1/M2 |
| D-02 | Tanpa commission floor di Phase 1 | sudah |
| D-03 | Dua proyek Supabase terpisah; schema `bridge` di sisi MCN | sudah |
| D-06 | **Angka volume penjualan berhenti di CDPS**; hanya verdict yang menyeberang | sudah |
| K-1 | Bentuk keluaran `px_coverage_map()` persis 6 kolom, tidak ditambah | sudah (plan induk) |
| K-2 | **Hanya agregat yang menyeberang** — `creator_id` tidak pernah masuk CDPS | sudah (plan induk) |
| K-3 | `bridge.px_creator_capability` tidak pernah diekspor keluar proyek | sudah (plan induk) |
| **D-19** | Gerbang volume = **GMV SKU total**, basis **pesanan dibayar**, jendela **30 hari** | **baru, diketok CEO 12 Sep 2026** |
| **D-20** | Transport = **MCN push mingguan** di akhir pipeline ingest; **CDPS menyimpan salinan** | **baru, diketok CEO 12 Sep 2026** |
| **D-23** | Phase 1 PX = **TikTok saja**. Shopee menunggu tabel pemeta kategori | **baru, konsekuensi teknis; wajib dicatat** |
| **D-24** | `level2_category` SKU = **dikonfirmasi manusia satu kali per SKU kandidat**, dari dropdown tersaring | **baru, diketok bersama PRD ini** |

> **Kenapa D-23 bukan penyederhanaan, tapi satu-satunya yang mungkin.** Seed policy sudah
> `platforms: ["tiktok"]`. Sample Shopee mengonfirmasi alasannya: `parentskudetail.xlsx`
> (40 kolom, 1.504 baris) **nol kolom kategori**. Tanpa pemeta kategori Shopee → taksonomi MCN,
> gerbang coverage tidak bisa dievaluasi untuk SKU Shopee. Memaksakannya berarti mencocokkan SKU ke
> kreator berdasarkan nama produk — itu sumber kesalahan, bukan fitur.

> **Kenapa D-24, dan kenapa itu murah.** Perkiraan Yohan: **20–40 SKU** di seluruh basis klien yang
> tembus Rp 200jt/bulan. Mengonfirmasi `level2_category` satu kali untuk 20–40 SKU adalah pekerjaan
> satu jam, sekali. Alternatifnya (menunggu tabel master kategori resmi + mesin pemeta otomatis)
> memblokir M3 tanpa alasan yang sebanding. Konfirmasinya **melekat pada SKU**, bukan diulang setiap
> periode.

---

## 3. Rules

### 3.1 Gerbang admisi — empat lapis, berurutan

Sebuah SKU masuk katalog Product Exchange **hanya bila keempat lapis lolos**. Verdict mencatat lapis
mana yang menggagalkannya; ini yang membuat "kenapa SKU ini tidak masuk" dapat dijawab tanpa
membaca kode.

| Lapis | Gerbang | Sumber | Gagal ⇒ alasan |
|---|---|---|---|
| **L1** | `client_platforms.shop_id IS NOT NULL` **dan** `platform = 'tiktok'` | CDPS (ketokan 6, D-23) | `tanpa_agency_plan` / `platform_belum_didukung` |
| **L2** | `gmv_30d >= policy.ambang` pada basis **pesanan dibayar** | `pdt_fact_sku_period` (D-19) | `volume_kurang` |
| **L3** | `level2_category` **dan** `price_segment` SKU terisi | konfirmasi AM (D-24) + harga satuan | `kategori_belum_dikonfirmasi` |
| **L4** | `px_coverage_snapshot.status = 'covered'` pada `(level2_category, price_segment)` | salinan dari MCN (D-20) | `kreator_kosong` |

1. Urutan lapis **wajib** dipertahankan. L3 tidak boleh diminta ke AM untuk SKU yang gagal L2 —
   itu memindahkan kerja manual ke SKU yang tidak akan pernah dipakai.
2. Verdict disimpan, bukan dihitung ulang setiap render: `px_sku_eligibility` menyimpan verdict +
   `lapis_gagal` + `versi_policy` + `dihitung_pada`.
3. Verdict **tidak pernah** jadi sumber kebenaran angkanya. `gmv_30d` disimpan di
   `px_sku_volume` di CDPS dan **tidak menyeberang** ke MCN (D-06).

### 3.2 Volume (D-19)

4. `gmv_30d` dihitung dari `pdt_fact_sku_period` pada `basis = 'dibayar'`, jendela 30 hari
   kalender yang berakhir pada `periode_selesai` batch terverifikasi terakhir.
5. Hanya batch berstatus `verified` yang dipakai. Batch `ditolak`/`digantikan` diabaikan — ini yang
   mencegah pernyataan kelayakan berdiri di atas parse yang gagal rekonsiliasi.
6. Bila jendela 30 hari tidak tertutup penuh oleh batch `verified`, SKU **tidak dievaluasi** dan
   verdict = `data_tidak_lengkap`. Ekstrapolasi **dilarang** — Video Factory lama mengarang angka
   per bulan dengan membagi rata satu total jendela, dan itu tidak boleh terulang di gerbang yang
   memikul komitmen komersial.
7. `gmv_30d` **selalu turunan**, direcompute setelah setiap batch `verified`. Nol input manusia.
7b. `px_sku_volume.batch_ids` adalah **provenans wajib**, bukan kolom pelengkap: ia yang membuat
    perpanjangan retensi paket ZIP (D-26) dapat dihitung, dan yang membuat verdict dapat dilacak ke
    berkas sumbernya. Baris `px_sku_volume` **tanpa** `batch_ids` dilarang.
8. Ambang dibaca dari `px_eligibility_policy` versi aktif
   (`where aktif = true order by versi desc limit 1`). Tidak di-hardcode. Mengubah ambang = versi
   baru, dan seluruh verdict direcompute dengan `versi_policy` baru — verdict lama **tidak**
   ditimpa, ia jadi baris riwayat.

### 3.3 Kategori & segmen harga (D-24)

9. `pdt_sku_master.level2_category` diisi **sekali per SKU** oleh AM pemilik klien, dari dropdown
   yang **tersaring** oleh kategori platform yang sudah diketahui (mis. `Product category` =
   "Perawatan & Kecantikan" ⇒ dropdown hanya menampilkan `level2_category` MCN di bawah cabang itu).
10. Dropdown diisi dari `px_coverage_snapshot` + tabel master kategori bila sudah ada. **Selama
    tabel master belum ada**, dropdown menampilkan nilai `level2_category` yang muncul di
    `px_coverage_snapshot` — artinya AM hanya bisa memilih kategori yang MEA **punya** kreatornya.
    Itu keterbatasan yang disengaja dan konsisten dengan prinsip demand-first.
11. Konsekuensi yang wajib ditulis di UI: kategori yang MEA punya **nol kreator** tidak akan muncul
    di dropdown. SKU semacam itu berhenti di L3 dengan alasan `kategori_belum_dikonfirmasi`, bukan
    `kreator_kosong`. Kedua alasan harus dapat dibedakan di laporan internal, karena
    tindak lanjutnya beda: yang pertama ke Hans (master kategori), yang kedua ke MCN (rekrut/aktivasi
    kreator).
12. `price_segment` **dihitung**, tidak diketik: dari `pdt_sku_master.harga_satuan_terakhir`
    (sumber: `SKU Unit Original Price` di `Semua pesanan.csv`), dipetakan lewat ambang yang tersimpan
    di `px_eligibility_policy.nilai.price_segment_bands`.
13. Nilai enum `price_segment_t` harus persis sama dengan yang dipakai MCN. **A-01/P-03 masih
    terbuka** — daftar nilainya wajib dikonfirmasi Hans sebelum migrasi M3-B, karena salah nilai =
    L4 selalu gagal tanpa sebab yang kelihatan.

### 3.4 Coverage snapshot (D-20)

14. MCN **push** ke CDPS di akhir pipeline ingest mingguan, setelah recompute `proven_*` selesai.
    CDPS **tidak pernah** menarik dari MCN.
15. Yang dikirim hanya keluaran `px_coverage_map()`: 6 kolom persis (K-1). **Nol `creator_id`,
    nol baris per kreator** (K-2). Menambah kolom = perubahan kontrak, bukan perubahan kode.
16. CDPS menyimpan salinan lengkap per pengiriman di `px_coverage_snapshot`, **append-only**,
    dengan `snapshot_at` dan `batch_key`. Snapshot lama tidak dihapus — inilah yang memungkinkan
    menjawab "kenapa bulan lalu SKU ini boleh masuk katalog".
17. Evaluasi L4 memakai snapshot **terbaru**. Bila snapshot terbaru lebih tua dari **10 hari
    kalender**, UI menampilkan **banner data basi + tanggal snapshot**, dan katalog **tetap
    ditampilkan** — tidak diblokir. Alasannya: memblokir katalog karena MCN gagal push menghukum AM
    atas kegagalan sistem lain. Yang diblokir hanya **pembuatan match baru** (M5), bukan pembacaan.
18. Kegagalan push **tidak boleh** mengosongkan snapshot terakhir. Nilai terakhir bertahan; `audit_logs`
    mencatat keterlambatannya. Pola ini sama dengan Rule 12 PX-M1.

### 3.5 Katalog

19. `px_catalog_item` adalah **view**, bukan tabel: SKU dengan verdict `lolos` pada versi policy
    aktif. Nol duplikasi angka.
20. Katalog menampilkan: nama produk, `level2_category`, `price_segment`, klien (nama toko), dan
    **sinyal "sudah jalan di afiliasi"** dari `pdt_fact_sku_period.gmv_dari_kreator` +
    `Sampel terkirim`. Yang **tidak** ditampilkan ke sisi kreator: `gmv_30d`, jumlah pesanan, dan
    seluruh angka volume klien (D-06).
21. Permukaan kreator = halaman baru di portal (D-09/D-10), bukan perluasan `/portal/agency-plan`.
    M3 berhenti pada penyediaan view + API baca; halaman kreator dan `px_match` adalah M4/M5.

---

## 4. Flow

**Flow A — Recompute volume (otomatis, setelah batch PDT `verified`)**
1. Batch PDT selesai rekonsiliasi ⇒ memicu `px_recompute_volume(client_platform_id)`.
2. Untuk setiap `sku_id` pada toko itu: agregasi `pdt_fact_sku_period` basis `dibayar` jendela
   30 hari ⇒ UPSERT `px_sku_volume`.
3. Bila jendela tidak tertutup penuh ⇒ tulis `cakupan_hari` apa adanya; jangan ekstrapolasi.
4. *Error path:* rollback, `audit_logs` (`action = 'px_volume_recompute_failed'`), nilai lama
   bertahan.

**Flow B — Evaluasi kelayakan + konfirmasi kategori**
1. Job `px_evaluate_eligibility()` berjalan setelah Flow A.
2. Jalankan L1 → L2. SKU yang gagal berhenti di situ dengan verdict + `lapis_gagal`.
3. SKU yang lolos L2 masuk daftar **kandidat** dan muncul di halaman *Kandidat PX* AM pemilik klien.
4. AM mengonfirmasi `level2_category` dari dropdown tersaring (Rule 9–10). Satu kali per SKU.
5. Sistem menghitung `price_segment` dari harga satuan (Rule 12).
6. L4 dievaluasi terhadap snapshot terbaru ⇒ verdict final `lolos` / `kreator_kosong`.
7. SKU `lolos` muncul di `px_catalog_item`.

**Flow C — Push coverage mingguan (MCN → CDPS)**
1. Pipeline ingest MCN selesai ⇒ recompute `proven_*` (PX-M1 Flow A) selesai.
2. Eksporter memanggil `bridge.px_coverage_map()`, membentuk payload (§7).
3. `POST` ke endpoint CDPS dengan `Authorization: Bearer <BRIDGE_PX_SECRET>` dan
   `Idempotency-Key: px-coverage-<YYYYMMDD>-<hash payload>`.
4. CDPS memvalidasi bentuk payload. Kolom tak dikenal ⇒ **tolak 422**, bukan diabaikan — kontrak
   ditegakkan di penerima.
5. CDPS menulis `px_coverage_snapshot` (append-only) + membalas 200 dengan jumlah baris diterima.
6. Kunci idempotensi yang berulang mengembalikan **hasil ASLI**, HTTP 200, **nol baris baru**
   (preseden `BRIDGE_MSDPS_CONTRACT.md`).
7. Setelah snapshot masuk, CDPS memicu ulang L4 untuk seluruh SKU kandidat — kategori yang tadinya
   `kreator_kosong` bisa berubah `lolos` tanpa campur tangan AM.
8. *Error path:* MCN gagal kirim ⇒ retry 3× dengan backoff, lalu `audit_logs` di MCN + notifikasi
   ke CPM Lead. CDPS tidak tahu dan tidak perlu tahu; snapshot lama tetap dipakai (Rule 17–18).

---

## 5. Example

**Konteks.** Klien Avitaskin, toko TikTok, `shop_id` terisi (agency plan TAP aktif). Batch PDT Juli
2026 `verified`.

**Flow A.** Dari `pdt_fact_sku_period` basis `dibayar`, jendela 01–31 Juli:

| SKU (Product ID) | Nama | `gmv_30d` | `gmv_dari_kreator` |
|---|---|---|---|
| 1731432176719595405 | [BUNDLING] Avitaskin Glow… | Rp 10.945.407 | Rp 8.455.428 |
| 1731432242309728141 | [BUNDLING] Avitaskin Beauty… | Rp 8.769.094 | Rp 6.882.640 |

**Flow B — L2.** Ambang policy v1 = Rp 200.000.000. Kedua SKU **gagal L2** dengan verdict
`volume_kurang`. Keduanya **tidak** diminta konfirmasi kategori (Rule 1) — nol kerja manual untuk
SKU yang tidak lolos.

Ini hasil yang benar, dan sekaligus konfirmasi penting: **klien sebesar Avitaskin pun tidak lolos.**
Perkiraan 20–40 SKU se-basis-klien realistis, dan pilot 10 SKU tetap cukup. Ambang Rp 200jt
**tidak perlu diturunkan** — tapi sekarang itu pernyataan berbasis data, bukan perkiraan.

**Skenario lolos (klien lain, fashion).** SKU `Sepatu Wanita` dengan `gmv_30d` Rp 340.000.000 dan
harga satuan Rp 185.000:

| Lapis | Hasil |
|---|---|
| L1 | `shop_id` terisi, platform `tiktok` ⇒ **lolos** |
| L2 | Rp 340jt ≥ Rp 200jt ⇒ **lolos** |
| L3 | AM memilih `Sepatu Wanita`; `price_segment` dihitung = `mid` ⇒ **lolos** |
| L4 | Snapshot terbaru: `Sepatu Wanita / mid` = 7 kreator, 19 slot, `covered` ⇒ **lolos** |

⇒ masuk `px_catalog_item`. Yang dilihat kreator: nama produk, kategori, segmen harga, nama toko,
dan penanda "sudah jalan di afiliasi". Yang **tidak** dilihat kreator: Rp 340 juta.

**Skenario `kreator_kosong`.** SKU `Tas Wanita / mid` dengan `gmv_30d` Rp 260jt. Snapshot: 0 kreator,
0 slot. Verdict `kreator_kosong`. SKU tidak masuk katalog, **dan** baris ini masuk laporan internal
untuk MCN sebagai sinyal permintaan nyata di kategori yang belum punya supply. Itu input rekrutmen
kreator yang berbasis demand — bukan target volume yang ditebak.

---

## 6. System Requirements

### 6.1 Sisi CDPS (`AgencyAPP`, schema `public`)

**`px_sku_volume`**

| Field | Tipe | Wajib | Catatan |
|---|---|---|---|
| `sku_id` | `bigint` | ya | FK `pdt_sku_master(id)`; PK bersama `jendela_selesai` |
| `jendela_mulai`, `jendela_selesai` | `date` | ya | 30 hari (D-19) |
| `basis` | `text` | ya | selalu `'dibayar'` di Phase 1; kolom ada agar basis lain tidak butuh migrasi |
| `gmv_30d` | `numeric(15,2)` | ya | turunan, tidak editable |
| `pesanan_30d` | `integer` | ya | turunan |
| `cakupan_hari` | `smallint` | ya | jumlah hari yang benar-benar tertutup batch `verified` (Rule 6) |
| `dihitung_pada` | `timestamptz` | ya | |
| `batch_ids` | `bigint[]` | ya | provenans: batch mana yang membentuk angka ini |

- PK `(sku_id, jendela_selesai)`. Index `(gmv_30d desc)`.

**`px_sku_eligibility`**

| Field | Tipe | Catatan |
|---|---|---|
| `sku_id` | `bigint` | FK `pdt_sku_master` |
| `versi_policy` | `integer` | FK `px_eligibility_policy(versi)` |
| `verdict` | `px_verdict_t` | `lolos` / `volume_kurang` / `tanpa_agency_plan` / `platform_belum_didukung` / `kategori_belum_dikonfirmasi` / `kreator_kosong` / `data_tidak_lengkap` |
| `lapis_gagal` | `smallint` | `null` bila `lolos` |
| `coverage_snapshot_id` | `bigint` | snapshot yang dipakai saat L4 |
| `dihitung_pada` | `timestamptz` | |

- PK `(sku_id, versi_policy, dihitung_pada)` — **append-only**, trigger `px_sku_eligibility_frozen()`.
  Verdict lama tidak ditimpa (Rule 8). Verdict berlaku = baris terbaru per `sku_id` pada versi policy
  aktif.

**`px_coverage_snapshot`**

| Field | Tipe | Catatan |
|---|---|---|
| `id` | `bigint` | identity |
| `batch_key` | `text` | dari `Idempotency-Key`; UNIQUE |
| `snapshot_at` | `timestamptz` | waktu payload dibuat **di MCN** (bukan waktu terima) |
| `diterima_pada` | `timestamptz` | `now()` di CDPS |
| `level2_category` | `text` | |
| `price_segment` | `text` | nilai apa adanya dari MCN; **tidak** di-cast ke enum CDPS |
| `creator_count` | `integer` | |
| `total_slots_available` | `integer` | |
| `total_proven_gmv` | `numeric(15,2)` | |
| `status` | `text` | `covered` / `kosong` |

- Append-only, trigger frozen. Index `(level2_category, price_segment, snapshot_at desc)`.
- `price_segment` disimpan sebagai `text`, **bukan** enum: nilai dimiliki MCN. Meng-enum-kannya di
  CDPS menciptakan dua sumber kebenaran untuk daftar segmen.

**Perubahan pada `pdt_sku_master`** (dari PRD PDT): `+ level2_category text`,
`+ level2_dikonfirmasi_oleh uuid`, `+ level2_dikonfirmasi_pada timestamptz`,
`+ price_segment text` (generated dari harga + bands, atau kolom biasa yang direcompute).

**Domain & izin** — `packages/domain/src/productexchange.ts` (sudah ada dari M2a):
- `canKonfirmasiKategoriSku(actor, ownerAm)` — lingkup sama dengan `canIsiShopId`.
- `canLihatKatalogPx(actor)` — Lead Account + Director; sisi kreator lewat route portal terpisah.
- Endpoint bridge **tidak** memakai `requirePermission` — ia memakai Bearer secret (§7).

**Non-functional**
- `px_evaluate_eligibility()` untuk ~500 klien × ~1.500 SKU harus selesai < 5 menit; dijalankan
  per-klien saat dipicu batch, dan penuh hanya saat versi policy baru lahir.
- Endpoint bridge harus menerima payload ≤ 5.000 baris dalam satu request.

### 6.2 Sisi MCN (`mcnapp`, schema `bridge`)

- `bridge.px_coverage_export()` — wrapper atas `px_coverage_map()` yang **hanya** menambah
  `snapshot_at`. Nol kolom lain (K-1).
- Eksporter `src/lib/px/coverage-push.ts`, dipicu dari **akhir pipeline ingest yang sudah ada**.
  **Nol scheduler baru** (konsisten dengan PX-M1).
- Secret `BRIDGE_PX_SECRET`, **terpisah** dari `CRON_SECRET` dan dari `BRIDGE_INGEST_SECRET`
  (preseden D12).
- Komentar wajib di migrasi: `bridge.px_creator_capability` tidak pernah menyeberang (K-3).

### 6.3 Tes

**CDPS**
- Unit: keempat lapis gerbang, tiap verdict punya kasus positif & negatif.
- Unit: jendela 30 hari tidak tertutup ⇒ `data_tidak_lengkap`, **bukan** angka hasil ekstrapolasi.
- Unit: batch `ditolak` diabaikan dari `gmv_30d`.
- Integrasi: idempotensi endpoint — kunci berulang ⇒ 200, nol baris baru.
- Integrasi: payload dengan kolom asing ⇒ 422.
- Integrasi: snapshot > 10 hari ⇒ katalog tetap tampil + banner (Rule 17).
- **Fixture bersama** yang di-commit **identik** di kedua repo (preseden D12).

**MCN**
- Unit: bentuk payload persis 6 kolom + `snapshot_at`; tes gagal bila ada kolom tambahan.
- Unit: nol `creator_id` di payload (K-2) — tes eksplisit, bukan tersirat.
- `.qa-manual.test.ts`: push ke CDPS staging, verifikasi 200 + jumlah baris.

---

## 7. Kontrak Bridge (MCN → CDPS)

Ditulis sebagai `docs/BRIDGE_PRODUCT_EXCHANGE_CONTRACT.md` **identik di kedua repo**, mengikuti
bentuk `BRIDGE_MSDPS_CONTRACT.md`. Dokumen kontrak adalah sumber kebenaran; kedua sisi dibangun
tanpa saling menebak.

```
POST https://app.meagency.co.id/api/bridge/px-coverage
Authorization: Bearer <BRIDGE_PX_SECRET>
Idempotency-Key: px-coverage-20260918-<sha256(payload)[0:12]>
Content-Type: application/json

{
  "snapshot_at": "2026-09-18T02:14:00Z",
  "source": "mcnapp",
  "policy_note": "aggregate-only; no creator identity (K-2)",
  "rows": [
    {
      "level2_category": "Sepatu Wanita",
      "price_segment": "mid",
      "creator_count": 7,
      "total_slots_available": 19,
      "total_proven_gmv": 1284000000.00,
      "status": "covered"
    }
  ]
}
```

**Respons 200**
```json
{ "batch_key": "px-coverage-20260918-a1b2c3d4e5f6", "rows_received": 214, "duplicate": false }
```

| Aturan kontrak | Nilai |
|---|---|
| Arah | **MCN push → CDPS terima.** CDPS tidak pernah menarik (D-20) |
| Frekuensi | Mingguan, di akhir pipeline ingest MCN. Lebih sering percuma — `proven_*` hanya berubah saat ingest |
| Idempotensi | Kunci berulang ⇒ HTTP 200, hasil ASLI, **nol baris baru** |
| Kolom | Persis 6 + `snapshot_at`. Kolom asing ⇒ **422** |
| Identitas kreator | **Dilarang**. Nol `creator_id`, nol baris per kreator (K-2) |
| Angka volume klien | **Tidak pernah** ke arah sebaliknya (D-06) |
| Tipe | Diduplikasi di kedua repo + **satu fixture bersama** yang identik (D12). Nol paket npm bersama |
| Secret | `BRIDGE_PX_SECRET`, terpisah dari secret bridge lain |
| Degradasi | Snapshot basi ⇒ katalog tampil + banner; **pembuatan match baru** yang diblokir (M5), bukan pembacaan |

**⚠️ Kontradiksi region yang wajib diselesaikan sebelum coding.** PRD M1 mencatat **D-12: region MCN
= `ap-southeast-1` (Singapore), sama dengan CDPS**. Plan induk dan dokumen penggabungan mencatat
Supabase MCN `bqknstylbpwsnlgnzayw` berada di **`ap-southeast-2`**. Salah satunya salah.
**Perlu dicek Hans.** Dampaknya bukan kecil: kalau benar dua region, latensi dan biaya egress lintas
region masuk ke perhitungan, dan itu satu alasan tambahan mengapa **push berkala** (D-20) lebih
tepat daripada pull on-demand.

---

## 8. Open Assumptions

| # | Asumsi | Penjawab | Dampak bila salah |
|---|---|---|---|
| M3-01 | Region Supabase MCN — `ap-southeast-1` (PRD M1 D-12) atau `ap-southeast-2` (plan induk)? | Hans | asumsi latensi & biaya lintas region salah |
| M3-02 | Daftar nilai `price_segment_t` MCN (A-01/P-03, terbuka sejak PRD M1) | Hans | L4 selalu gagal tanpa sebab yang kelihatan |
| M3-03 | `Product category` TikTok dapat dipetakan ke cabang `level2_category` MCN untuk menyaring dropdown (P-02) | Hans | dropdown tidak tersaring; AM memilih dari 198 nilai |
| M3-04 | `optimization_tracker` dapat dipakai sebagai basis master SKU, memotong sebagian PDT (A-10) | Hans | master SKU mulai dari nol |
| M3-05 | MCN punya titik akhir pipeline ingest yang jelas untuk memicu push (A-03, terjawab untuk recompute — perlu konfirmasi untuk push) | Hans | butuh scheduler baru di MCN, yang PX-M1 sengaja hindari |
| M3-06 | `require_stock_in: true` di policy v1 punya sumber data di CDPS. **Belum diverifikasi** — tidak ada modul export yang membawa stok | Hans + Anty | gerbang stok tidak bisa dievaluasi; perlu dikeluarkan dari v1 atau diisi manual |
| M3-07 | Daftar `kolom_dipanen` PDT (D-27) memuat seluruh field PX di catatan (a) di atas | Hans | M3 lahir tanpa sumber data; butuh perluasan whitelist + reparse seluruh batch |
| M3-08 | Retensi paket ZIP (D-26) cukup panjang untuk menutup sengketa kelayakan SKU. Bila klien mempersoalkan verdict > 90 hari setelah SKU keluar katalog, buktinya harus ditarik dari platform | Nerissa | klaim kelayakan tidak dapat dibuktikan ulang |

---

## 9. Success Metrics

| Metrik | Target Phase 1 | Sumber ukur |
|---|---|---|
| SKU dievaluasi otomatis (nol pengetikan angka) | **100%** dari SKU pada toko ber-`shop_id` | `px_sku_eligibility` |
| SKU lolos keempat lapis | **≥ 10** (cukup untuk pilot) | `px_catalog_item` |
| Verdict yang dapat menjelaskan sendiri lapis kegagalannya | **100%** | `lapis_gagal` non-null saat gagal |
| Konfirmasi kategori manual | **≤ 40 SKU sekali**, nol pengulangan per periode | `level2_dikonfirmasi_pada` |
| Push coverage berhasil per minggu | **≥ 95%** | `px_coverage_snapshot.snapshot_at` |
| Baris per-kreator yang menyeberang ke CDPS | **0** (K-2) | tes kontrak + review payload |
| Angka volume klien yang menyeberang ke MCN | **0** (D-06) | tes kontrak |
| Kategori ber-demand tapi nol kreator (input rekrutmen MCN) | terlaporkan mingguan | verdict `kreator_kosong` |

---

## Langkah konkret

| # | Langkah | Owner (role) | Metrik sukses |
|---|---|---|---|
| 1 | Jawab M3-01 s/d M3-06 | CTO (Hans) | 6 dari 6 terjawab tertulis |
| 2 | Ketok D-19, D-20, D-23, D-24 ke `DECISIONS.md` kedua repo | CTO (Hans) + COO (Nerissa) | entri ada di kedua repo |
| 3 | Tulis `BRIDGE_PRODUCT_EXCHANGE_CONTRACT.md` identik di kedua repo + commit fixture bersama | CTO (Hans) | `diff` kedua berkas = nol |
| 4 | Selesaikan PDT G1 lebih dulu (prasyarat keras) | CTO (Hans) | 10 klien `verified` |
| 5 | Bangun M3-A (MCN push), lalu M3-B (CDPS terima + gerbang) | CTO (Hans) | push mingguan jalan; ≥10 SKU lolos |
| 6 | SOP AM: arti mengonfirmasi kategori SKU (pernyataan komersial, bukan pelengkap data) | Head of Account (Anty) | 100% AM tersosialisasi |
| 7 | Rutin mingguan: verdict `kreator_kosong` → daftar target rekrutmen kreator | Sr SPV MCN (Lukman) | daftar terkirim tiap minggu |
