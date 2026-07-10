# MSL_DRAFT_KOMPILASI — Draf Kompilasi Master Service List

> Jawaban **Permintaan #2** (`WAVE1_EXTERNAL_REQUESTS.md`). Ini adalah **bahan validasi untuk Sales Head/SPV, BUKAN seed final**. Sesuai **M0 OD-2 / DECISIONS O3**: yang berhak menetapkan `standard_price` dan `commission_rule` adalah **Sales Head**, bukan tim dev dan bukan hasil olah data otomatis. File pasangan: `MSL_DRAFT_KOMPILASI.csv` (180 baris kandidat layanan, terurut jumlah deal terbanyak).

## Tujuan

CDPS butuh Master Service List riil untuk menghitung **Estimasi Nilai** (M0 Qualified Form) dan **Perhitungan Komisi** (M0/M5), memakai grammar yang sudah dikunci di **DECISIONS O14**: hanya dua bentuk — `<N>% of standard price` atau `flat Rp <N>` (rounding round-half-up ke rupiah utuh). Sheet "database client" (`db_jasa`, 1.517 baris ledger deal riil) adalah sumber yang paling dekat dengan daftar layanan nyata, tapi berisi **harga deal actual** (hasil closing per klien, sudah kena nego/tier/durasi) — bukan daftar harga standar. Dokumen ini mengubah 1.517 baris transaksi mentah menjadi kandidat daftar layanan yang bisa dibaca dan divalidasi Sales Head, tanpa menebak angka standar apa pun.

## Sumber & metode

- **Sumber:** `db_jasa.csv` (export sheet "Database Client" pada spreadsheet Permintaan #2), 1.517 baris, kolom relevan: `Detail Jasa` (nama layanan free-text), `Jasa` (platform), `Nominal Jasa` (harga `Rp...`), `Durasi Jasa (bulan)`, `Tanggal Closing`.
- **Normalisasi:** trim + collapse spasi + lowercase untuk kunci pengelompokan; nama tampilan (`canonical_name`) memakai ejaan asli yang **paling sering muncul** pada grup itu. Platform dinormalisasi ke casing baku (`Shopee`, `TikTok`, `TikTok Shop`, `Meta`, `Lazada`, `Tokopedia`, `Google`, `Dokumen`). Nominal `Rp2.950.000` diparse jadi integer `2950000`. `Tanggal Closing` (format `6-Mei-2025`, bulan Indonesia) diparse penuh.
- **Aturan gabung (konservatif, by design):** dua nama hanya digabung otomatis ke satu `canonical_name` jika:
  1. identik setelah normalisasi case/spasi/tanda baca, ATAU
  2. **permutasi kata** yang sama persis (mis. `"Optimasi Rating Shopee 100x"` vs `"Optimasi Rating 100x Shopee"`), ATAU
  3. **typo tingkat-kata**: jumlah kata sama, hanya 1–2 kata berbeda, tiap kata yang berbeda punya edit-distance ≤2 **dan** panjang kata ≥4 huruf **dan** tidak ada angka yang berubah nilainya.
  - Guardrail sengaja ketat: token pendek (≤3 huruf, mis. akhiran tier `"Paket A"` vs `"Paket B"`) dan token berisi angka yang beda (`"50x"` vs `"100x"`) **tidak pernah** digabung otomatis walau jaraknya dekat secara string — karena di data riil pola ini konsisten dipakai untuk membedakan **tier/paket harga berbeda**, bukan salah ketik. Tanda `+` (mis. `"Basic"` vs `"Basic+"`) juga sengaja **tidak** dianggap tanda baca dekoratif — ini konvensi penamaan tier premium MEA yang berulang di banyak keluarga layanan, jadi tetap dipisah.
  - Setiap pasangan grup yang **mirip tapi tidak memenuhi kriteria gabung** (Jaccard kemiripan kata ≥0.6) dicatat di kolom `catatan` sebagai kandidat yang perlu **konfirmasi manual Sales Head**, bukan digabung sepihak.
- **Skrip:** Python, `compile_msl.py` (di scratchpad sesi build) — deterministik, sanity-check otomatis di akhir run (lihat di bawah).

## Yang harus dikerjakan Sales Head, per baris `MSL_DRAFT_KOMPILASI.csv`

Untuk **setiap baris** (satu kandidat layanan):
1. **Konfirmasi apakah `canonical_name` + `varian_ejaan` yang tergabung memang satu layanan.** Kalau kolom `catatan` menyebut "MIRIP TAPI TIDAK DIGABUNG" — putuskan apakah dua baris itu sebenarnya sama (lalu minta gabung manual ke tim dev) atau memang berbeda (biarkan terpisah).
2. **Isi `usulan_standard_price`** — angka desimal IDR tanpa `Rp`/titik ribuan. Kolom `harga_min/median/modus/max` di setiap baris hanya **referensi** sebaran harga deal riil (sudah campur nego/tier/durasi) — bukan usulan otomatis, jangan diambil mentah-mentah.
3. **Isi `usulan_commission_rule`** — HARUS salah satu dari 2 bentuk grammar O14: `"<N>% of standard price"` atau `"flat Rp <N>"`. Kalau ada aturan komisi lain di kepala (tiered/per-platform), catat apa adanya untuk didiskusikan — sudah diputuskan di **O14** bahwa varian per-kuartal ditangani lewat **versioning MSL** (`effective_from`), bukan grammar rumit.
4. **Tandai `active`** (kolom disiapkan di sisi sistem, bukan di CSV ini) — apakah layanan ini masih dijual.
5. **Tetapkan `effective_from`** (`YYYY-MM-DD`) — tanggal harga ini mulai berlaku; deal historis mengunci versi yang efektif pada tanggal closing masing-masing.

Setelah tervalidasi, serahkan kembali CSV yang sudah terisi ke tim dev untuk di-input via admin MSL (`/master-services`) atau di-seed langsung.

## Angka ringkas

| Metrik | Nilai |
|---|---|
| Total baris ledger (`db_jasa.csv`) | **1.517** |
| Baris di-exclude (Detail Jasa kosong / nominal tak terparse) | **0** |
| Baris masuk kompilasi | **1.517** |
| Grup dasar (normalisasi case/spasi persis) | 184 |
| Grup final setelah gabung konservatif | **180** (`canonical_name` di CSV) |
| Pasangan varian tergabung otomatis (typo/permutasi) | 4 |
| Grup dengan hanya 1 deal (long tail) | 83 |
| Grup ditandai "mirip tapi tidak digabung" — butuh konfirmasi Sales Head | 135 |
| Grup muncul di >1 platform sekaligus | 43 |

Sanity check (dijalankan otomatis di skrip): Σ `jumlah_deal` seluruh grup (1.517) + baris di-exclude (0) = **1.517**, cocok dengan total baris ledger. Tidak ada grup dengan `canonical_name` kosong. CSV divalidasi ulang dengan parser CSV standar (180 baris data + 1 header, terbaca bersih).

### Baris di-exclude

**Tidak ada baris yang di-exclude.** Seluruh 1.517 baris memiliki `Detail Jasa` terisi dan `Nominal Jasa` dalam format `Rp<angka>` yang terparse bersih ke integer. (Kalau ada kiriman data lanjutan dengan baris kosong/rusak, skrip yang sama akan menghitung dan melaporkannya di kategori ini tanpa mengubah baris yang sudah valid.)

### Top 10 layanan berdasar jumlah deal

| # | Layanan (canonical_name) | Jumlah Deal |
|---|---|---:|
| 1 | Optimasi Rating 100x | 290 |
| 2 | Jasa Iklan Traffic Marketplace Basic | 210 |
| 3 | Jasa Pengajuan Shopee Mall | 81 |
| 4 | Jasa Buka Toko Online Basic | 76 |
| 5 | Optimasi Rating 50x | 71 |
| 6 | GMV Max Mea Basic | 55 |
| 7 | Tiktok Ads GBS (Free Kelola ads Tiktok) | 51 |
| 8 | Jasa Iklan Shopee 10 SKU | 48 |
| 9 | Jasa Buka Toko Online Premium | 36 |
| 10 | Meta Ads CPAS x Shopee Premium | 33 |

10 layanan ini saja mencakup **951 dari 1.517 deal (~63%)** — prioritaskan validasi harga pada baris-baris ini dulu kalau waktu Sales Head terbatas.

## Caveat penting (wajib dibaca sebelum mengisi angka)

1. **Harga di ledger = harga deal, BUKAN rate card.** Kolom `harga_min/median/modus/max` menunjukkan sebaran harga transaksi riil, yang sudah dipengaruhi negosiasi, tier durasi (`Durasi Jasa (bulan)` bervariasi 1–30 bulan pada baris yang sama), dan kemungkinan diskon per-klien. Rentang pada beberapa grup **sangat lebar** (mis. beberapa grup GMV Max/Meta Ads punya `harga_min` jauh di bawah `harga_max`) — ini indikasi campuran durasi/nego, bukan kesalahan parsing. Sales Head yang menentukan `standard_price` yang representatif, bukan modus/median otomatis.
2. **Varian nama butuh konfirmasi merge manual.** Skrip sengaja konservatif: 135 dari 180 grup punya catatan "MIRIP TAPI TIDAK DIGABUNG" — biasanya karena beda kata kualifier (`Basic` vs `Basic+` vs `Premium` vs `Pro` vs `Intensive Premium`), beda platform yang disebut di nama (`Optimasi Rating 100x` vs `Optimasi Rating 100x Shopee` vs `... TikTok`), atau beda akhiran tier (`Paket A` vs `Paket B`). Contoh nyata dari ledger: `"ajasa iklan shoppe basic"` (typo) tergabung otomatis dengan `"Jasa iklan shoppe Basic"` dan `"Jasa Iklan Shopee Basic"` (edit-distance 1–2, tanpa beda angka) — **tapi sengaja TIDAK** digabung dengan `"Jasa Iklan Traffic Marketplace Basic"` (grup #2 di atas, 210 deal) walau nama-namanya terdengar mirip di telinga, karena secara tekstual bedanya jauh lebih dari sekadar typo (hilang frasa "Traffic Marketplace" sepenuhnya) — kedua grup ini tetap dua baris terpisah di CSV; Sales Head yang paling tahu apakah keduanya memang layanan yang sama.
3. **`Status Pembayaran` di ledger memuat nilai di luar 4 skema resmi CDPS** (skema resmi: `Lunas` / `Sebagian` / `Termin` / `Bayar di Belakang`, per kontrak Permintaan #3). Distribusi 1.517 baris:

   | Nilai di ledger | Jumlah | Status vs skema CDPS |
   |---|---:|---|
   | `Lunas` | 1.388 | cocok skema CDPS |
   | `Termin` | 113 | cocok skema CDPS |
   | `DP (Down Payment)` | 9 | **di luar 4 skema** |
   | `Monthly` | 3 | **di luar 4 skema** |
   | (kosong) | 3 | **di luar 4 skema** |
   | `Deposit` | 1 | **di luar 4 skema** |

   Skema `Sebagian` dan `Bayar di Belakang` **tidak pernah muncul** apa adanya di ledger ini — kemungkinan salah satu dari 4 nilai di luar skema di atas adalah sinonim lokal untuk salah satu dari keduanya (mis. `DP (Down Payment)` mungkin = `Sebagian`, atau perlu skema baru). **Ini di luar cakupan MSL** (dicatat di sini murni sebagai temuan sampingan) — relevan untuk kerja **W1-19** (impor data migrasi terpisah, lihat `WAVE1_EXTERNAL_REQUESTS.md` Permintaan #3 dan DECISIONS O18) yang membangun parser skema_pembayaran sendiri; parser itu perlu mapping eksplisit untuk 16 baris (9+3+3+1) di luar 4 nilai skema resmi, bukan menebak.

## File terkait

- Output A (data): `docs/handoff/MSL_DRAFT_KOMPILASI.csv`
- Sumber mentah: sheet "Database Client" (`db_jasa`), lihat link di `WAVE1_EXTERNAL_REQUESTS.md` § Permintaan #2.
- Konteks keputusan: `docs/DECISIONS.md` O3, O14, O18; `docs/handoff/WAVE1_EXTERNAL_REQUESTS.md` § Permintaan #2.
