# MSL_KALKULATOR_VALIDASI — Worksheet Validasi Master Service List (Rate Card Aktif)

> Bahan validasi untuk **Sales Head/COO**, **BUKAN seed final**. Sesuai **DECISIONS O3**: yang berhak menetapkan `standard_price` dan `commission_rule` adalah Sales Head, bukan tim dev. File pasangan: `backend/seed/msl_kalkulator.csv` (32 baris layanan, hasil ekstraksi rate card aktif).

## 1. Tujuan & sumber

CDPS butuh Master Service List riil untuk menghitung **Estimasi Nilai** (M0 Qualified Form) dan **Perhitungan Komisi** (M0/M5). Dokumen ini memproses spreadsheet Google Sheets **"Kalkulator Service Jasa"** — kalkulator rate card yang **aktif dipakai tim sales MEA hari ini** untuk menghitung penawaran ke klien baru — bukan ledger deal historis (itu sudah dikerjakan terpisah di `MSL_DRAFT_KOMPILASI.md`, 180 layanan).

- **Sumber:** file export `kalkulator_service.xlsx`, tab **"Kalkulator 1"** (tab AKTIF — tab `CARD` melakukan query ke tab ini untuk tampilan kartu harga ke sales). Tanggal ekstraksi: **2026-07-16**.
- **Cakupan:** 32 baris layanan leaf (baris header seksi seperti "B. ADS SPENDING" dan sub-item non-harga di dalam paket Store Management **tidak** dihitung sebagai baris layanan tersendiri).
- **Metode ekstraksi:** dibaca dengan `openpyxl` mode formula (`data_only=False`) agar rumus SUBTOTAL (kolom H) bisa diverifikasi manual, bukan hanya nilai cache. Setiap baris leaf diverifikasi: nama (kolom B, verbatim/trim), satuan (C), batas minimal (D), harga (E), frekuensi (G), lalu rumus kolom H dipetakan ke salah satu dari 4 mode:
  - `flat` = qty × harga (tanpa syarat minimal)
  - `min_floor` = `IF(qty<=batas_minimal, batas_minimal×harga, qty×harga)` — tagihan tidak pernah di bawah lantai batas minimal
  - `batch_ceiling` = `CEILING(qty, batas_minimal) × harga` — qty dibulatkan ke atas ke kelipatan batas minimal
  - `passthrough` = nominal rupiah diketik langsung di kolom QUANTITY (dipakai untuk item custom/nego seperti GMV Max dan Model Add-On)
  - PPN 11% ditandai `apply_ppn=1` bila rumus mengandung perkalian `×0.11` tambahan.
- Deskripsi tiap layanan diambil **verbatim** dari tab **"Note"** (kolom B, dicocokkan per nama layanan), tanpa parafrase.
- **Diabaikan:** tab **"Copy of Kalkulator 1 v.1"** (varian lama, lihat Anomali #5), tab `Sheet3` (scratch kosong/tidak relevan).

## 2. Tabel ringkas — 32 layanan

| Baris sumber | Layanan | Kategori | Satuan | Batas Minimal | Harga | Mode | PPN | Frekuensi |
|---|---|---|---|---:|---:|---|---|---|
| 5 | Store Management (Paket) | Store Management | Paket | — | Rp. 6.000.000,00 | flat | Tidak | Monthly |
| 13 | Awareness & Consideration Ads Spending | Ads Spending | per 1K view | 300 | Rp. 10.000,00 | min_floor | Ya | Monthly |
| 14 | GMV Max | Ads Spending | — | — | input manual (passthrough) | passthrough | Ya | Monthly |
| 17 | Product Catalog Photos – 4 Outputs | Asset Produk | per produk | 1 | Rp. 150.000,00 | batch_ceiling | Tidak | One-time |
| 18 | Product Catalog Photo – 1 Output | Asset Produk | per foto | 1 | Rp. 40.000,00 | batch_ceiling | Tidak | — |
| 19 | Thematic Product Photos – 4 Outputs | Asset Produk | per produk | 1 | Rp. 250.000,00 | batch_ceiling | Tidak | One-time |
| 20 | SKU Video | Asset Produk | per produk | 1 | Rp. 150.000,00 | batch_ceiling | Tidak | One-time |
| 21 | SKU Design | Asset Produk | per SKU | 1 | Rp. 100.000,00 | batch_ceiling | Tidak | — |
| 22 | Model (Add On) — Asset Produk | Asset Produk | — | — | input manual (passthrough) | passthrough | Tidak | — |
| 23 | Banner / OBS Design | Asset Produk | Per 5 slide | — | Rp. 250.000,00 | flat | Tidak | — |
| 26 | Short Video (UGC Style) / Ad Content | Konten Organik | per video | 5 | Rp. 150.000,00 | min_floor | Tidak | Monthly |
| 27 | Short Video (Premium) | Konten Organik | per video | 5 | Rp. 250.000,00 | min_floor | Tidak | Monthly |
| 28 | Carousel Content | Konten Organik | per set (5 konten) | 5 | Rp. 150.000,00 | min_floor | Tidak | Monthly |
| 29 | Single Image Content | Konten Organik | — | 5 | Rp. 50.000,00 | min_floor | Tidak | — |
| 30 | Model (Add On) — Konten Organik | Konten Organik | — | — | input manual (passthrough) | passthrough | Tidak | — |
| 31 | Special Spot — Konten Organik | Konten Organik | — | — | input manual (passthrough) | passthrough | Tidak | — |
| 34 | Nano KOL (1K–10K followers) | KOL & Influencer | per KOL | 10 | Rp. 5.000.000,00 | min_floor | Ya | Campaign |
| 35 | Micro KOL (10K–50K followers) | KOL & Influencer | per KOL | 1 | Rp. 5.000.000,00 | min_floor | Ya | Campaign |
| 36 | Macro & Mega KOL (50K–500K followers) | KOL & Influencer | per KOL | 1 | Rp. 10.000.000,00 | min_floor | Ya | Campaign |
| 39 | Massive Video Production (sample required) | Affiliator | per 1 video | 50 | Rp. 50.000,00 | min_floor | Tidak | One-time |
| 40 | Total Awareness | Affiliator | per 10K view | 10 | Rp. 100.000,00 | min_floor | Ya | — |
| 45 | Live Streaming (education & selling) | Live & Content Service | per session (3 jam) | 10 | Rp. 350.000,00 | min_floor | Tidak | Monthly |
| 46 | Educational Videos | Live & Content Service | per video | 5 | Rp. 250.000,00 | min_floor | Tidak | Monthly |
| 47 | Special Talent | Live & Content Service | — | — | input manual (passthrough) | passthrough | Tidak | — |
| 48 | Live with TC / KOL / Celebrities (10% Rate Card) | Live & Content Service | — | — | Rp. 10.000.000,00 | flat | Tidak | — |
| 49 | Video with TC / KOL / Celebrities (10% Rate Card) | Live & Content Service | — | — | Rp. 10.000.000,00 | flat | Tidak | — |
| 50 | Special Spot — Live & Content | Live & Content Service | — | — | Rp. 700.000,00 | flat | Tidak | — |
| 51 | Night & Weekend Sessions | Live & Content Service | per session (3 jam) | — | Rp. 150.000,00 | flat | Tidak | — |
| 54 | Customer Review Management | Social Proof | per bulan | — | Rp. 500.000,00 | flat | Tidak | Monthly |
| 55 | Video Review | Social Proof | per video | 5 | Rp. 20.000,00 | min_floor | Tidak | — |
| 56 | Shopee Rating Optimization | Social Proof | per checkout | 50 | Rp. 15.000,00 | min_floor | Tidak | — |
| 57 | TikTok Rating Optimization | Social Proof | per checkout | 50 | Rp. 17.000,00 | min_floor | Tidak | — |

Nama dengan akhiran em-dash (`Model (Add On) — ...`, `Special Spot — ...`) adalah **penambahan tim dev**, bukan teks asli sheet — sheet sumber memakai nama identik ("Model ( Add On)", "Special Spot") di tiga kategori berbeda (Asset Produk, Konten Organik, Live & Content Service) untuk tiga item add-on/spot yang harganya berbeda. Suffix ditambahkan hanya di `name`/`service_key` seed supaya tidak tabrakan sebagai baris duplikat; teks `description` tetap verbatim dari tab Note tanpa suffix ini.

## 3. Anomali yang butuh konfirmasi Sales Head/COO

1. **Nano KOL — batas minimal kemungkinan salah isi.** Baris 34 punya `Batas Minimal = 10` dengan harga Rp5.000.000/KOL → mode `min_floor` membuat tagihan minimum jadi **Rp50.000.000 + PPN** untuk kerja sama Nano KOL (1K–10K followers). Sebagai perbandingan, Micro KOL (baris 35, followers lebih besar) dan Macro & Mega KOL (baris 36) sama-sama punya `Batas Minimal = 1`. Tab **Note** untuk Nano KOL justru menyebut **"biaya komitmen sebesar Rp5.000.000 di awal kerja sama"** — bukan Rp50 juta. Indikasi kuat `Batas Minimal` baris 34 salah ketik (seharusnya 1, sama seperti Micro KOL) dan hasil kali `10 × Rp5jt` di kalkulator adalah bug, bukan rate card yang disengaja. **Perlu keputusan eksplisit sebelum baris ini dipakai untuk estimasi nilai/komisi.**
2. **Store Management "Rp6.000.000 + komisi 5%" — basis komisi tidak didefinisikan.** Sel harga (kolom E baris 5) berisi teks `"6000000+ komisi 5%"`, tapi rumus SUBTOTAL hanya memakai angka `6000000` (komisi 5% tidak pernah dihitung di kalkulator). Basis 5% ini — GMV toko? Nilai kontrak? Sesuatu yang lain? — tidak disebutkan di sheet mana pun. Disimpan sebagai `price_note` di CSV, **tidak dihitung otomatis** oleh sistem sampai basisnya dikonfirmasi.
3. **Bug rumus baris 48** memakai harga baris 49 (`=IFERROR(E49*F48,0)`, bukan `E48*F48`). Karena `E48` dan `E49` kebetulan sama-sama Rp10.000.000, hasil akhirnya tidak berbeda hari ini — tapi ini bug struktural di sheet: kalau Sales Head suatu saat mengubah salah satu harga tanpa sadar keduanya saling terkait lewat rumus ini, akan terjadi salah hitung. Seed CSV memakai harga aktual masing-masing baris (keduanya Rp10.000.000) dan mencatat bug ini agar tidak terulang di sistem CDPS.
4. **Sel FREKUENSI baris 22 ("Model (Add On)" — Asset Produk) berisi `2026`.** Nilai ini tidak bermakna sebagai frekuensi (kemungkinan sisa input tanggal/tahun yang salah taruh sel). Dikosongkan di seed CSV.
5. **Tab "Copy of Kalkulator 1 v.1" diabaikan.** Tab ini memuat varian lama kalkulator (a.l. Store Management dihargai Rp60.000.000, bukan Rp6.000.000) yang sudah tidak dipakai — tab `CARD` (kartu harga yang dilihat sales) meng-query tab **"Kalkulator 1"**, bukan tab Copy ini. Dicatat di sini semata sebagai jejak keputusan kenapa varian itu tidak diekstrak.
6. **GMV Max — syarat budget minimum belum ditegakkan sistem.** Tab Note untuk GMV Max menyebut ketentuan operasional: *"Budget iklan minimum per campaign (per SKU) per bulan Rp8,5 juta exclude PPN. Untuk iklan yang sudah berjalan dengan budget di atas Rp8,5 juta per campaign per SKU, budget tidak boleh diturunkan."* Karena mode pricing-nya `passthrough` (nominal diketik bebas oleh sales/AM), syarat Rp8,5jt ini **tidak di-enforce oleh kalkulator maupun oleh seed v1** — dicatat di `description` sebagai ketentuan operasional, perlu keputusan apakah CDPS harus menegakkan floor ini secara sistem (validasi server-side) di iterasi berikutnya.
7. **`commission_rule` seluruh 32 baris = interim `"0% of standard price"` (komisi Rp0).** Sales Head belum menetapkan aturan komisi per layanan untuk rate card ini. Nilai interim ini **WAJIB diisi Sales Head sebelum UAT komisi Wave 1** — tanpa ini, semua perhitungan komisi di modul M0/M5 untuk 32 layanan ini akan menghasilkan Rp0.

### Catatan tambahan (bukan anomali yang butuh keputusan, tapi relevan untuk transparansi)
- Baris 45 & baris 41 (Note tab) memuat kolom `C` tambahan (`30.0`, `150.0`) di tab Note yang tidak dipakai kalkulator — kemungkinan draf catatan internal, diabaikan karena tidak memengaruhi harga.
- Deskripsi tab Note untuk "Video with TC / KOL / Celebrities (10% Rate Card)" (baris 49) memuat tanda kutip ganda yang tampaknya salah taruh di tengah teks (bukan di awal/akhir kalimat penuh) — dipertahankan verbatim di kolom `description` sesuai instruksi ekstraksi, tidak diperbaiki secara sepihak.
- KOL Nano/Micro/Macro di tab Note memakai penamaan sedikit berbeda dari tab Kalkulator (`"KOL Nano (1-10K followers)"` vs `"Nano KOL (1K–10K followers)"`) — dicocokkan berdasarkan urutan baris dan kesamaan konten (bukan kecocokan string persis), karena tidak ada nama lain yang lebih cocok di tab Note.

## 4. Hubungan dengan MSL_DRAFT_KOMPILASI (180 layanan ledger historis)

Dua dokumen ini melayani tujuan berbeda dan **tidak saling menggantikan**:

| | `MSL_KALKULATOR_VALIDASI` (dokumen ini) | `MSL_DRAFT_KOMPILASI` |
|---|---|---|
| Sumber | Kalkulator rate card **aktif** ("Kalkulator Service Jasa") | Ledger deal historis (`db_jasa`, 1.517 baris transaksi riil) |
| Isi | 32 layanan, harga standar per satuan/formula | 180 kandidat layanan hasil normalisasi nama dari deal masa lalu |
| Kegunaan | **Rate card untuk deal BARU** — dipakai kalkulasi Estimasi Nilai di M0 Qualified Form ke depan | Referensi harga historis/legacy — dipakai untuk **impor migrasi data** deal lama (lihat DECISIONS O18, W1-19) |
| Harga | Harga standar (list price), bukan hasil nego | Harga deal aktual (sudah kena nego/tier/durasi) — sebaran `min/median/modus/max`, bukan harga standar |

Bila Sales Head menemukan nama layanan yang muncul di kedua daftar (mis. "GMV Max" ada di kalkulator maupun di top-10 ledger `MSL_DRAFT_KOMPILASI`), **rate card kalkulator ini yang berlaku untuk deal baru** ke depan; entri di draf kompilasi tetap dipertahankan apa adanya sebagai catatan harga historis untuk keperluan migrasi, bukan digabung/ditimpa oleh baris kalkulator.

## 5. Instruksi pengisian untuk Sales Head

Untuk setiap baris `backend/seed/msl_kalkulator.csv` (atau revisi yang dikirim balik dalam format CSV yang sama):

1. **Konfirmasi anomali di atas** (khususnya #1 Nano KOL dan #2 basis komisi Store Management) — jawaban ini menentukan apakah `unit_price`/`min_qty` di baris tersebut perlu direvisi sebelum seed dipakai produksi.
2. **Isi `commission_rule`** per baris, memakai grammar yang sudah dikunci di **DECISIONS O14**: hanya dua bentuk — `"<N>% of standard price"` atau `"flat Rp <N>"`. Nilai saat ini (`"0% of standard price"`) adalah placeholder interim, bukan usulan.
3. **Tinjau `price_note`** pada baris 5 (Store Management) dan baris 48/49 (Live/Video with TC-KOL-Celebrities) — putuskan apakah catatan ini cukup atau perlu didefinisikan sebagai field terpisah/aturan sistem (mis. basis komisi 5%, formula fee manajemen 10% dari ad spend).
4. **Tandai `active`** bila ada layanan di antara 32 ini yang sebenarnya sudah tidak dijual lagi (kolom saat ini semua `true`).
5. Serahkan kembali revisi via:
   - CSV yang sudah diisi ulang, diserahkan ke tim dev untuk di-input ke seed, ATAU
   - Langsung via admin Master Service List (`/master-services`) setelah modul tersebut tersedia di Wave 1.

## File terkait

- Output data: `backend/seed/msl_kalkulator.csv`
- Sumber mentah: Google Sheets "Kalkulator Service Jasa", tab "Kalkulator 1" (export `kalkulator_service.xlsx`, 2026-07-16).
- Dokumen terkait: `docs/handoff/MSL_DRAFT_KOMPILASI.md` / `.csv` (180 layanan ledger historis); `docs/DECISIONS.md` O3, O14, O18 (di luar cakupan perubahan agent ini — hanya dirujuk).

## Cara seed ke sistem (tim dev)

CLI `backend/cmd/mslseed` memuat `backend/seed/msl_kalkulator.csv` ke Master Service List lewat `internal/admin` (`CreateService`/`UpdateService` saja — jadi setiap tulis tetap tervalidasi, teraudit, dan terversi persis seperti lewat admin UI). Idempotent berdasarkan **nama layanan**: baris yang belum ada akan dibuat, baris yang sudah ada tapi ada field berubah akan naik versi, baris yang identik dilewati.

**WAJIB dry-run dulu** (konvensi importer CDPS — lihat `backend/cmd/import`). Skema harus sudah termigrasi (`go run ./cmd/migrate up`) dan `--actor` wajib employee yang lolos `admin.CanEditMasterServices` (Sales Head/SPV Sales, atau Director — staff Sales biasa akan ditolak dengan pesan `[anda tidak memiliki akses untuk mengubah master service list]`).

```bash
cd backend

# 1) Dry-run — tidak menulis apa pun, cuma menampilkan rencana (create / versi baru / dilewati)
go run ./cmd/mslseed --actor <employee_id>

# (opsional) pakai CSV revisi Sales Head, bukan file default:
go run ./cmd/mslseed --actor <employee_id> --csv path/ke/revisi.csv

# 2) Setelah rencana dicek dan sesuai harapan, baru apply
go run ./cmd/mslseed --actor <employee_id> --apply
```

Contoh `<employee_id>`: `EMP-0006` (Dewi Anggraini, Sales Head) atau `EMP-0008`/`EMP-0009`/`EMP-0010` (Director, lihat `backend/internal/seed/seed.go`).

Catatan:
- Setiap baris CSV divalidasi dulu (enum `pricing_mode`, `min_qty` wajib ada hanya untuk `min_floor`/`batch_ceiling`, `unit_price > 0` untuk mode non-`passthrough`, `commission_rule` harus lolos grammar DECISIONS O14, `effective_from` format `YYYY-MM-DD`) — **sebelum** menyentuh DB sama sekali. Satu baris tidak valid akan menggagalkan seluruh run (dry-run maupun apply) dengan exit code bukan 0, baris mana yang salah selalu disebutkan di output.
- Menjalankan ulang `--apply` dengan CSV yang sama itu aman (semua baris "sama, dilewati") — tidak akan membuat duplikat layanan atau versi kosong.
- Ingat anomali #7 di atas: `commission_rule` di seed ini masih placeholder `"0% of standard price"` sampai Sales Head mengisi aturan komisi final; re-run `mslseed --apply` setelah CSV direvisi akan otomatis menaikkan versi baris yang berubah.
