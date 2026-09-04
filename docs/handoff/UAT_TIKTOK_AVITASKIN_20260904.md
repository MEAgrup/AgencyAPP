# UAT — dua mesin TikTok dari export ASLI (Avitaskin, Juli 2026)

**Tanggal:** 2026-09-04 · **Data:** 12 berkas export TikTok Shop Seller Center +
TikTok Ads Manager toko **Avitaskin** (`avitaskin_official`), periode
**01–31 Juli 2026**, diberikan pemilik.
**Menutup:** `HANDOFF_LANJUT_SEMUA_BUILD_SESI2_20260904.md` §0 baris 2 — *"UAT dua
engine TikTok dengan export **asli** (Ads Scanner + Report Engine) — belum pernah
kena data nyata"*.

**Cara diuji:** jalur produksi persis, dua lapis.
1. **Lapis mesin** — langkah browser direplikasi di node (`parseAdsScanExport` /
   `riset-awal.ts`: `sheet_to_json{header:1, raw:false, defval:''}`), lalu
   `adsscanner.tiktok.runAdsScanner` dan `report.runReport` dipanggil langsung.
2. **Lapis domain** — `adsscanner.runAdsScan` dan `report.createReport` di DB
   lokal hasil `scripts/db-rebuild.sh` (172 migrasi, semua gate & invariant
   lolos) — persis yang dipanggil rute `POST /clients/{id}/adsscanner/scan` dan
   `POST /clients/{id}/reports`.

---

## 1. Verdict

| Mesin | Deteksi berkas | Jalan sampai tersimpan | Angkanya benar? |
|---|---|---|---|
| **Report Engine** (TikTok) | ✅ **12 dari 12** berkas dikenali benar | ✅ `createReport` sukses, skor 4,5 KRITIS, periode terbaca dari berkas | ✅ semua KPI headline cocok **persis** ke berkas mentah |
| **Ads Scanner** (TikTok) | ✅ 4 slot terisi benar dari 4 berkasnya | ✅ `ASR-202609-0001` terbentuk & terbaca ulang | ❌ **TIDAK** sebelum sesi ini — lihat §3 (**O70**, sudah diperbaiki + dites) |

**Satu bug berat ditemukan dan diperbaiki** (§3): Ads Scanner membaca **86% GMV
lebih rendah dari yang sebenarnya** karena bentuk export aslinya sama sekali
berbeda dari fixture. Bug ini **mustahil terlihat tanpa data nyata** — dan itulah
persis alasan UAT ini ada di daftar.

Dua temuan kecil (§4) dan satu pertanyaan pemilik (§5) menyusul.

---

## 2. Report Engine — semua angka cocok

### 2.1 Deteksi: 12/12

| Berkas | Terdeteksi | Baris | Rentang terbaca |
|---|---|---|---|
| `Shop Analytics_Key metrics_20260810.xlsx` | `shop_tt` | 35 | 2026-07-01..31 (31h) |
| `Shop Analytics_Key metrics_20260810 (1).xlsx` | `shop_tp` | 35 | idem |
| `product_list_20260701.xlsx` | `prod_tt` | 24 | idem |
| `product_list.xlsx` | `prod_tp` | 25 | idem |
| `Video Performance List_…0605.xlsx` | `vid_toko` | 225 | idem |
| `Video Performance List_…0616.xlsx` | `vid_aff` | 439 | idem |
| `Live Analysis…0537.xlsx` | `live_toko` | 1 | idem |
| `Live Analysis…0544.xlsx` | `live_aff` | 149 | idem |
| `Transaction_Analysis_Creator_List_…xlsx` | `aff_kr` | 561 | — |
| `Transaction_Analysis_Product_List_…xlsx` | `aff_pr` | 25 | — |
| `creative data for product campaigns….xlsx` | `ads_prod` | 2093 | — |
| `livestream data for live campaigns….xlsx` | `ads_live` | 0 (hanya header) | — |

Pemisahan toko-vs-afiliasi **tepat keempat-empatnya** (video toko = 225 posting
`avitaskin_official`; video afiliasi = 439 posting 201 kreator; LIVE toko = 1
sesi; LIVE afiliasi = 149 sesi) — tapi keempatnya ditandai **ambigu**, jadi
`createReport` menolak dengan 400 selama klien belum punya akun tertaut:

```
[tipe berkas tidak jelas (toko atau afiliasi) — konfirmasi tipe untuk berkas berikut]
Live Analysis…0537.xlsx, Live Analysis…0544.xlsx, Video Performance List_…0605.xlsx, Video Performance List_…0616.xlsx
```

Ini **perilaku benar** (heuristik `u.size<=2` tidak dipercaya diam-diam), dan
dengan `linkedAccounts=['avitaskin_official']` laporan langsung terbentuk.
Konsekuensi operasional: **`client_platforms` klien TikTok harus terisi handle
tokonya** sebelum AM bisa membuat laporan tanpa mengoverride 4 berkas manual.

### 2.2 Cek-ulang KPI ke berkas mentah

| Yang dilaporkan engine | Nilai | Cek ulang ke `Shop Analytics_Key metrics` | Cocok? |
|---|---|---|---|
| GMV kotor | Rp 26.560.049 | *GMV* baris "Total nilai" | ✅ persis |
| GMV bersih | Rp 26.225.409 | 26.560.049 − 334.640 (refund) | ✅ dihitung ulang |
| Pengembalian dana | Rp 334.640 | *Pengembalian dana* | ✅ persis |
| Pesanan / Pembeli / Terjual | 143 / 137 / 147 | tiga kolomnya | ✅ persis |
| Pengunjung | 20.627 | *Pengunjung* | ✅ persis |
| CVR | 0,66418% | *Persentase konversi* `0.006641780191011781` | ✅ persis, digit demi digit |
| Impresi / Klik produk | 832.842 / 27.208 | dua kolomnya | ✅ persis |
| AOV | Rp 183.173 | dibaca dari kolom *AOV* export (bukan dihitung) | ✅ |
| Periode | 2026-07-01..31, 31 hari | baris 1 berkas | ✅ `rentang_dari_berkas=true` |

Silang-mesin: `Σ Biaya` berkas iklan = **Rp 6.540.407** dan `Σ Pendapatan kotor`
= **Rp 20.666.992** menghasilkan ROI **3,16×** — **angka yang sama persis**
dengan `blendedRoi` Ads Scanner dari berkas yang sama. Dua mesin, dua jalur
parsing, satu angka.

> Catatan parser: berkas Ads Manager memakai **titik sebagai desimal**
> (`1407834.000` = Rp 1.407.834), berbeda dari export Seller Center yang memakai
> titik sebagai pemisah ribuan (`Rp10.945.407`). Kedua mesin membacanya benar —
> `toNum` menangani keduanya. Ini pernah jadi sumber salah hitung di percobaan
> manual saat menyusun laporan ini; mesinnya sendiri tidak.

### 2.3 Skor

Total **4,5 → KRITIS** (via benchmark DB versi 1, pro-rata 31 hari). Dimensi:
GMV Max Ads 3,0 (ROI 3,16× • 38% belanja tanpa pesanan) · LIVE 0,1 (1 sesi,
tanpa penjualan) · Video 6,2 · Kartu Produk 6,1 · Affiliate 5,0 (28/559 kreator
produktif) · Portfolio Produk 1,5. Konsisten dengan ambangnya.

`avitaskin_official` otomatis dikeluarkan dari kolam kreator afiliasi (560 → 559)
karena ia muncul di export video TOKO — **perilaku yang benar**, dan ini
verifikasi pertamanya di data nyata.

---

## 3. 🔴 O70 — Ads Scanner membaca kolom dari seksi yang SALAH (diperbaiki)

### 3.1 Apa yang terjadi

Export **"Analitik Produk"** yang sebenarnya bukan tabel datar. Ia **176 kolom
dalam 5 seksi**, dan baris di ATAS baris header memberi label seksinya:

| Kolom | Seksi |
|---|---|
| 4–50 | `Semua` ← **total toko, ini yang benar** |
| 51–75 | `LIVE penjual` |
| 76–100 | `Video penjual` |
| 101–151 | `Afiliasi` |
| 152–175 | `Kartu produk penjual` |

**30 nama kolom berulang** di seksi-seksi itu: `GMV`, `Pesanan SKU`,
`Impresi produk`, `Klik produk`, `CTR`, `CTOR (pesanan SKU)`, dan seterusnya.

`rowsToObjects` (di-port verbatim dari tool pemilik,
`docs/design/TIKTOK_ADS_SCANNER.html:414-431`) menulis `o[hdr[c]] = v` polos —
**yang TERAKHIR menang**. Akibatnya **setiap metrik headline SKU** dibaca dari
seksi terakhir, *Kartu produk penjual*, bukan dari total toko.

### 3.2 Besarnya salah (Avitaskin, Juli 2026)

| Metrik | Dibaca engine (seksi `Kartu produk`) | Sebenarnya (seksi `Semua`) | |
|---|---|---|---|
| Σ GMV 24 SKU | Rp 3.743.633 | **Rp 26.560.049** | 86% GMV tak terlihat |
| Σ Impresi produk | 55.345 | **832.842** | |
| Σ Pesanan SKU | — | **145** | |
| SKU teratas — GMV | Rp 1.891.251 | **Rp 10.945.407** | |
| SKU teratas — CTR | 2,36% | **3,51%** | |
| SKU teratas — CTOR | 3,39% | **0,40%** | |
| `skuAktifGmv` | 9 dari 24 | **15 dari 24** | |

Oracle independennya kuat: Σ kolom PERTAMA (`Semua`) = **Rp 26.560.049**, yaitu
**persis** GMV di export *Analitik Toko* (`shop_tt`) untuk periode yang sama.
Dua berkas berbeda, satu angka — tidak ada tafsiran di sini.

### 3.3 Kenapa ini bukan sekadar angka meleset

Nasihat yang dikeluarkan alat ini **berbalik arah**. SKU teratas Avitaskin:

- **sebelum:** *"Konversi sehat, traffic kurang — kreatif/hook lemah, butuh angle baru."*
- **sesudah:** *"CTR sehat, konversi bocor — cek harga, review, foto & deskripsi halaman produk."*

Yang pertama mengirim advertiser ke tim Creative untuk masalah yang ada di
halaman produk. Itu bukan angka salah — itu minggu kerja yang salah.

### 3.4 Perbaikannya

`packages/core/src/adsscanner/tiktok/detect.ts` — `rowsToObjects` sekarang
memakai **kemunculan PERTAMA**, kemunculan berikutnya disimpan di kunci
bersuffix `nama#<indeks kolom>` (tidak ada kolom yang hilang). Ini **persis
aturan `packages/core/src/baseline/sheet.ts:readSheet`** yang sudah dipakai
mesin baseline/report sejak awal — jadi perbaikan ini justru **menghapus** dua
aturan berbeda untuk satu masalah yang sama di repo ini, bukan menambah.

Ini **satu-satunya titik** di mesin Ads Scanner yang menyimpang dari tool
pemilik, dan penyimpangannya disengaja — dicatat di `docs/DECISIONS.md`
(**O70**) dan di komentar modulnya.

**Kenapa boleh diperbaiki sekarang** padahal aturan rumah bilang bug di alat asli
pemilik di-port apa adanya: aturan itu (handoff Gelombang 2-4 §4 butir 5) berbunyi
*"jangan perbaiki diam-diam **tanpa data nyata untuk memverifikasi perbaikannya
benar**"*. Data nyata itu sekarang ada, lengkap dengan oracle silang-berkasnya.

**Diverifikasi:**
- `@cdps/core` **535/535** lolos (dari 532; 3 tes baru mengunci bentuk export
  asli — 5 seksi, nama kolom berulang), typecheck bersih.
- `adsscanner.domain` **37/37** lolos di DB lokal.
- Jalur produksi diulang setelah perbaikan: `ringkasan.totalGmv` = **26.560.049**.

> ✅ **Tidak ada pekerjaan retroaktif.** Pemilik mengonfirmasi (2026-09-04) Ads
> Scanner **belum dipakai di aplikasi** — baris `adsscanner_run` yang ada hanya
> hasil uji, jadi tak ada scan produksi yang perlu dijalankan ulang (O70-b,
> `DECISIONS.md`).

---

## 4. Dua temuan kecil

### 4.1 ✅ 16 video hilang dari penyebut Report Engine (O71 — dijawab & diperbaiki)

`report/metrik.ts:videoRows` membuang baris yang `Informasi Video`-nya kosong
(`if (!judul) continue;`). Di data Avitaskin ada **16 video tanpa caption, 15 di
antaranya punya VV > 0** — konten sungguhan. Efeknya: "34 dari **648** video ada
penjualan" seharusnya "34 dari **664**" (5,25% → 5,12%).

Bukan bug parsing: baris itu memang tak bercaption. Tapi caption adalah judul,
bukan identitas — `ID Video` yang identitas, dan ia terisi di semua 664 baris.

**Keputusan pemilik 2026-09-04: video tanpa caption TETAP dihitung, diberi nama
`(tanpa caption)`.** Sudah dibangun: baris dibuang hanya bila caption **dan**
`ID Video` sama-sama kosong (baris keterangan/tooltip — target asli filter itu).
Diverifikasi ulang ke export asli: **34 dari 664** (225 toko + 439 afiliasi,
persis jumlah baris berkasnya). Aturan barunya sama dengan
`baseline/metrik.ts:video` yang sudah memakai kunci itu sejak awal, dan
placeholder-nya mengikuti `'(tanpa judul)'` pada kreatif iklan di file yang sama.
3 tes baru.

### 4.2 ✅ Pesan "Ringkasan data" kini menyebut nama berkasnya (diperbaiki)

Saat 12 berkas satu folder diunggah sekaligus, seluruh scan ditolak oleh satu
berkas `Shop Analytics` dengan pesan `[berkas ini ekspor "Ringkasan data", …]`
— tanpa memberi tahu **berkas yang mana**. Sekarang nama berkasnya ditempel di
belakang string BI-nya, pola yang sama dengan `MSG_AMBIGU` di mesin laporan
(string `[...]`-nya sendiri tidak berubah). Ditambah satu tes.

Penolakan seluruh batch-nya sendiri **tidak** diubah — itu memang gerbang yang
disengaja terhadap salah-unduh yang paling sering terjadi.

---

## 5. Untuk pemilik

**Kedua pertanyaan dokumen ini sudah dijawab pada hari yang sama** — tak ada yang
menggantung dari UAT ini:

| # | Pertanyaan | Jawaban pemilik | Tindak lanjut |
|---|---|---|---|
| **O71** | Video tanpa caption: hitung atau buang? | **Hitung**, beri nama `(tanpa caption)` | ✅ dibangun + 3 tes (§4.1) |
| **O70-b** | Ada scan Ads Scanner produksi sebelum 2026-09-04? | **Belum dipakai di aplikasi** | ✅ nol pekerjaan retroaktif |

Kosakata status produk TikTok kini **terverifikasi data nyata**: `Aktif` /
`Nonaktif` di export Analitik Produk (dan `Active` di export produk yang lain).
Perbaikan **O67** sesi sebelumnya (`\baktif\b` dengan batas kata) terbukti benar
di data ini — produk `Nonaktif` masuk bucket **DIBLOKIR** dengan blocker
*"Produk tidak aktif (Nonaktif)"*, bukan lolos sebagai aktif. Ini menutup
keraguan yang ditulis handoff sesi lalu ("vocabulary status asli belum
diverifikasi").

---

## 6. Berkas & cara mengulang

Export asli TIDAK disimpan di repo (data klien). Untuk mengulang: taruh 12
berkasnya di satu folder, lalu jalankan lapis 1 dengan skrip sekali-pakai yang
memanggil `runAdsScanner` / `runReport` seperti diuraikan di kepala dokumen ini,
dan lapis 2 lewat `runAdsScan` / `createReport` di atas
`DATABASE_URL=…/cdps` hasil `scripts/db-rebuild.sh --yes`.
