# PRD — MEA SKU Screener

> **Provenance:** ekstraksi teks dari `PRD_MEA_SKU_SCREENER_v1.0.docx` yang dikirim pemilik
> 2026-09-03, disimpan di sini persis sebagai dokumen sumber porting Gelombang 3 (§6 plan).
> Kalau ada keraguan tentang satu baris, minta pemilik kirim ulang berkas aslinya — jangan
> menebak dari ekstraksi ini. Tabel Word yang berubah jadi daftar baris rata (bukan `| a | b |`)
> selama konversi; strukturnya dipertahankan (nama kolom, lalu nilai per baris) tapi visualnya
> tidak sama dengan docx aslinya.

Product Requirements Document
v1.0 — 27 Juli 2026
Status: Draft — menunggu konfirmasi asumsi terbuka
Produk: MEA Ads Tooling Internal | Owner: MEA Agency (Yohan) | Dev: Hans

## Daftar Isi
1. Background
2. Rules
3. Flow
4. Contoh Skenario Konkret
5. System Requirements
6. Open Assumptions
7. Success Metrics

## 1. Background

### 1.1 Masalah yang dipecahkan
Tim advertiser MEA Agency menangani 16–30 klien aktif per orang di berbagai platform (Shopee, TikTok, Meta, Google). Selama ini cara kerja bergantung pada judgment individual karena:
- Tidak ada angka baku yang menentukan SKU mana yang layak diiklankan dan mana yang tidak
- Keputusan diambil dari melihat dashboard platform langsung — tidak berjejak, tidak bisa dibandingkan antar advertiser
- Optimasi halaman produk (gambar, deskripsi, harga) dilakukan tanpa pencatatan terstruktur sehingga tidak ada akumulasi pembelajaran
- Hasil "buruk" pada klien sering dinilai sebagai kegagalan advertiser, padahal akar masalahnya bisa di kualitas katalog, budget yang terpecah terlalu tipis, atau fase investasi yang memang wajar merugi

MEA SKU Screener hadir untuk menggantikan judgment individual dengan keputusan berbasis angka yang bisa diaudit dan direplikasi, mencakup tiga pekerjaan berbeda dalam satu sistem:
- Screening & routing SKU — menentukan SKU mana yang siap diiklankan, mana yang harus dioptimasi dulu, mana yang diparkir
- Perbandingan sebelum vs sesudah optimasi — mengukur dampak perubahan gambar, deskripsi, atau harga secara objektif
- Decision log & tracking — mencatat setiap keputusan beriklan dan optimasi agar bisa diaudit, dikoreksi, dan dijadikan bahan pembelajaran

### 1.2 Konteks bisnis
Dua temuan empiris dari data 8 klien Shopee (20–26 Juli 2026) yang menjadi dasar desain:
- ROAS = AOV × CR ÷ CPC. ROAS bukan hasil kepintaran pengaturan iklan — melainkan keluaran tiga angka. Jika AOV × CR < target ROAS × CPC, target itu mustahil dicapai berapa pun budget-nya.
- Target ROAS bergantung fase kerja sama: seller memang wajar rugi di 6–12 bulan pertama saat menaikkan order. Fase 1 (bulan 0–6) menggunakan ROAS floor kontribusi, bukan ROAS target profit. Floor kontribusi = harga jual ÷ (margin Rp − biaya platform Rp).

Satu batas yang tidak bisa dinegosiasikan: di bawah ROAS floor kontribusi, setiap pesanan tambahan menambah kerugian. Volume memperburuk, bukan memperbaiki.

### 1.3 Target pengguna

| Persona | Kebutuhan utama | Frekuensi pakai |
|---|---|---|
| Advertiser MEA Agency | Screening SKU klien baru, routing mana yang dioptimasi vs diiklankan, catat keputusan | Setiap onboarding klien baru + mingguan |
| Lead Advertiser | Audit log keputusan, lihat variance antar advertiser, susun agenda upgrading | Mingguan (Jumat) |
| Head of Account (Yulianti) | Ringkasan klien off-target, perbandingan sebelum/sesudah optimasi, keputusan komersial | Mingguan + awal bulan |

### 1.4 Lingkup v1
- Platform yang dicakup: Shopee (data ekspor Seller Centre). TikTok, Meta, Google masuk v2.
- Pengguna: tim advertiser MEA Agency internal. Bukan SaaS publik.
- Komponen: (a) web tool screening berbasis browser, (b) tracker Excel/Sheets untuk log keputusan dan optimasi

## 2. Rules

Setiap aturan bernomor R01–dst. Developer wajib mengimplementasikan seluruh aturan ini dan mereferensikannya di komentar kode.

### 2.1 Pembacaan Angka

**R01** File ekspor Shopee Seller Centre menulis angka sebagai teks dengan titik sebagai pemisah ribuan Indonesia (misal: 740.900). Parser WAJIB menangani format ini secara eksplisit.
- Angka bertitik satu (740.900) dideteksi sebagai pemisah ribuan jika semua segmen setelah titik memiliki tepat 3 digit, sehingga hasilnya 740900.
- Angka bertitik dua atau lebih (249.535.512) selalu dianggap pemisah ribuan, hasilnya 249535512.
- Koma tunggal (3,21) dianggap pemisah desimal, hasilnya 3.21.
- Koma dan titik bersamaan (1.234,56) → titik = ribuan, koma = desimal, hasilnya 1234.56.
- Nilai '-', kosong, 'nan', 'None' → NaN (bukan 0).
- DILARANG: memakai fungsi parseFloat() langsung pada string format Indonesia tanpa preprocessing.

**R02** Hanya baris produk induk (Kode Variasi = '-') yang diproses. Baris variasi diabaikan untuk mencegah double-counting GMV.

**R03** Nilai negatif yang dihasilkan parser (misal rugi atau refund) TETAP dipertahankan sebagai negatif, tidak di-abs().

### 2.2 Aturan Screening & Routing SKU

**R04** Pembanding (median CTR dan median CR) dihitung dari dataset toko itu sendiri, bukan dari benchmark lintas klien. Ini memungkinkan tool bekerja untuk klien baru tanpa riwayat iklan.
- Median CTR dihitung dari SKU dengan Views ≥ 200.
- Median CR dihitung dari SKU dengan Clicks ≥ 20.
- Jika kurang dari 5 SKU memenuhi ambang di atas, ambang Views/Clicks diturunkan 50% secara iteratif sampai setidaknya 5 SKU tersedia atau floor absolut (Views ≥ 50, Clicks ≥ 5) tercapai.
- Floor absolut CTR: 2,0%. Floor absolut CR: 0,5%. Dipakai jika median toko di bawah nilai ini.

**R05** Setiap SKU yang punya Views > 0 dirutekan ke tepat satu dari lima kategori, menggunakan kondisi if-else berurutan:
- SCALE: CTR ≥ median CTR DAN CR ≥ median CR DAN Views ≥ median Views.
- KANDIDAT IKLAN: CTR ≥ median CTR DAN CR ≥ median CR DAN Views < median Views. (Closing terbukti, traffic kurang — prioritas utama klien baru.)
- OPTIMASI GAMBAR/JUDUL: Views ≥ median Views DAN CTR < median CTR. (Dilihat banyak, jarang diklik.)
- OPTIMASI DESKRIPSI/HARGA: CTR ≥ median CTR DAN CR < median CR.
- PARKIR: semua kondisi lain.

**R06** CPC Maksimum per SKU = AOV × (CR / 100 × faktor_CR_iklan) ÷ target_ROAS.
- Jika CPC Maksimum < CPC Pasar Kategori (bila diisi), rute KANDIDAT IKLAN dan SCALE ditimpa menjadi 'TAHAN — CPC max terlalu rendah, naikkan CR atau AOV dulu'.
- Anti-rule absolut: SKU dengan Views ≥ 2.000 DAN CR < 0.5% selalu ditandai 'ANTI-RULE — jangan diiklankan'. Kondisi ini mengalahkan rute apapun.

**R07** Target ROAS mengikuti fase klien:
- Fase 1 (bulan 0–6): ROAS Floor Kontribusi = harga_jual ÷ (margin_Rp − biaya_platform_Rp).
- Fase 2 (bulan 6–12): ROAS Break-Even Penuh = harga_jual ÷ (margin_Rp − biaya_platform_Rp − service_fee_per_pesanan_Rp).
- Fase 3 (bulan 12+): ROAS Target Profit = harga_jual ÷ (margin_Rp − biaya_platform_Rp − service_fee_per_pesanan_Rp − target_profit_Rp).
- Jika margin klien belum diisi, sistem menggunakan default 7.0 dan menampilkan peringatan 'Target sementara — margin belum diterima'.

**R08** Biaya platform dihitung dari harga jual, bukan dari margin: biaya_platform_Rp = (admin_pct + komisi_pct + biaya_program_lain_pct) × harga_jual.
- Service fee MEA bersifat flat bulanan (bukan persen per transaksi): service_fee_per_pesanan = service_fee_bulanan_Rp ÷ pesanan_per_bulan.
- Keduanya adalah data yang diminta Account dari klien via Form Intake, bukan dikalkukasi dari data ekspor.

### 2.3 Aturan Perbandingan Sebelum vs Sesudah

**R09** Pencocokan SKU antara dua periode menggunakan Kode Produk sebagai primary key. Jika Kode Produk kosong atau tidak tersedia, fallback ke lowercase(nama_produk).

**R10** Syarat minimum data sebelum dapat dinilai: Clicks Sesudah ≥ 20. Di bawah ambang ini, verdict = 'BELUM CUKUP DATA', bukan gagal.

**R11** Threshold verdict perbandingan:
- MEMBAIK: metrik yang dinilai naik ≥ 20% relatif (mis. CTR dari 3% ke 3.6% = +20%).
- TIDAK BERUBAH: antara -10% dan +20%.
- MEMBURUK: turun ≥ 10% relatif.
- Jika MEMBURUK: tampilkan instruksi 'Kembalikan ke versi sebelumnya'.

**R12** Metrik yang dinilai ditentukan oleh jenis perubahan yang dilakukan:
- Perubahan yang memengaruhi klik (gambar utama, judul, video, thumbnail): dinilai lewat CTR.
- Perubahan yang memengaruhi closing (deskripsi, foto detail, harga, voucher, bundling, ulasan): dinilai lewat CR.
- Satu record optimasi = satu jenis perubahan. Sistem MENOLAK record yang mencatat dua jenis sekaligus (karena hasilnya tidak bisa diatribusikan).

### 2.4 Aturan Decision Log

**R13** Setiap keputusan beriklan WAJIB dicatat sebelum dieksekusi. Log bersifat append-only — baris yang sudah ada tidak boleh diedit atau dihapus.
- Empat momen wajib: (1) SKU masuk iklan, (2) mulai test kreator/konten, (3) scale/down/kill kampanye, (4) jeda atau restart kampanye.

**R14** Syarat minimum data sebelum keputusan kampanye valid: ≥ 50 klik ATAU ≥ 3 konversi ATAU ≥ 3 hari jalan. Keputusan sebelum ambang ini ditandai sebagai 'PREMATUR' di log.
- Di platform GMV Max (Shopee), setiap perubahan budget atau target ROAS me-reset fase belajar algoritma. Oleh karena itu hanya satu perubahan per kampanye per hari yang diizinkan.

**R15** Tangga keputusan kampanye (dibanding ROAS target fase klien):
- ROAS ≥ 1.3× target, stabil 3 hari → SCALE UP, maksimum +30% budget/hari.
- ROAS 0.8–1.3× target → JANGAN DISENTUH (zona aman, menyentuh = reset learning).
- ROAS 0.5–0.8× target, 3 hari → TURUNKAN BUDGET -30% ATAU ganti kreatif (pilih satu, tidak boleh keduanya).
- ROAS < 0.5× target, 7 hari → PAUSE.
- Spend ≥ 3× target biaya/konversi, konversi = 0 → PAUSE hari itu juga.
- Spend > 0 & omzet = 0 selama 7 hari → PAUSE + catat di log.

**R16** Batas jumlah kampanye aktif per klien = budget_mingguan ÷ Rp350.000. Sistem menampilkan peringatan jika kampanye aktif melebihi batas ini.

## 3. Flow

### 3.1 Flow Utama — Screening & Routing (Modul A)

| Langkah | Aktor | Aksi | Error path |
|---|---|---|---|
| A1 | Advertiser | Upload file 'Bisnis Saya → Performa Produk' (.xlsx). File iklan (.csv) opsional. | File bukan xlsx/csv → tolak, tampilkan format yang diharapkan. |
| A2 | Sistem | Parse angka dengan aturan Indonesia (R01). Filter baris produk induk saja (R02). Hitung median CTR dan CR toko (R04). Jika file iklan ada, hitung CPC aktual. | Jika 0 SKU memenuhi ambang minimum → tampilkan peringatan 'Tidak ada SKU dengan data cukup'. |
| A3 | Advertiser | Isi target: nama klien, target ROAS (atau pilih fase 1/2/3), CPC pasar kategori (opsional), faktor CR iklan (default 1.0). | ROAS ≤ 0 → validasi error. |
| A4 | Sistem | Terapkan anti-rule (R06) terlebih dahulu. Kemudian hitung CPC Maksimum tiap SKU (R06). Terapkan pembatasan CPC vs pasar. Rutekan setiap SKU ke salah satu dari 5 kategori (R05). | — |
| A5 | Sistem | Tampilkan ringkasan KPI (jumlah per rute, median toko, CPC konteks) dan tabel SKU terurut berdasarkan CPC Maksimum descending. | — |
| A6 | Advertiser | Opsional: unduh (a) hasil screening lengkap .csv, (b) baris siap tempel ke Decision Log untuk SKU yang lolos, (c) baris siap tempel ke Tracker Optimasi untuk SKU yang perlu dioptimasi. | — |

### 3.2 Flow Perbandingan Sebelum vs Sesudah (Modul B)

| Langkah | Aktor | Aksi | Error path |
|---|---|---|---|
| B1 | Advertiser | Upload dua file 'Performa Produk' dari periode berbeda. Label 'SEBELUM' dan 'SESUDAH'. Isi ambang klik minimum (default 20). | Format salah atau sheet tidak ditemukan → tolak. |
| B2 | Sistem | Parse keduanya dengan aturan Indonesia. Cocokkan SKU menggunakan Kode Produk (primary) atau lowercase nama (fallback). Hitung delta CTR, CR, Views, GMV relatif. | Tidak ada SKU yang cocok → peringatan 'File dari toko berbeda?' |
| B3 | Sistem | Terapkan threshold verdict (R10). Tampilkan ringkasan: n SKU membaik, n memburuk, n belum cukup data. Tabel SKU diurut berdasarkan delta CR descending. | — |
| B4 | Advertiser | Unduh hasil perbandingan .csv. Baris 'MEMBAIK' memiliki kolom 'Direkomendasikan: naikkan budget +30%'. | — |

### 3.3 Flow Decision Log & Audit (Modul C)

| Langkah | Aktor | Aksi | Error path |
|---|---|---|---|
| C1 | Advertiser | Buka Decision Log (Google Sheets). Isi satu baris per keputusan SEBELUM eksekusi: tanggal, nama klien, platform, SKU/kampanye, tahap SOP, keputusan, metrik kunci, nilai metrik, target metrik. | Wajib field kosong → sel berwarna merah, log_id tidak ter-generate. |
| C2 | Sistem (Sheets) | Generate log_id otomatis (LOG-NNNN). Hitung kolom 'Status vs Target' otomatis: SESUAI / DI BAWAH TARGET / DI ATAS TARGET berdasarkan arah metrik. | — |
| C3 | Advertiser | Setelah 7 hari, isi kolom Verdict (Berhasil / Gagal / Belum cukup data) dan GMV 7 hari. | — |
| C4 | Lead Advertiser | Setiap Jumat: ekspor log, upload ke Claude Project, jalankan 'audit log [periode]'. Hasil: keputusan menyimpang, advertiser dengan compliance rendah, agenda upgrading. | — |

### 3.4 Flow Tracker Optimasi (Modul D)

| Langkah | Aktor | Aksi | Error path |
|---|---|---|---|
| D1 | Advertiser | Jalankan Modul A. Download baris Tracker Optimasi untuk SKU rute OPTIMASI. Tempel ke tab TRACKER (Google Sheets). | — |
| D2 | Advertiser | Kerjakan perubahan satu jenis per SKU per periode. Isi tanggal mulai dan jenis perubahan. | Dua jenis perubahan pada satu SKU dalam periode sama → peringatan di Sheets. |
| D3 | Advertiser | Setelah ≥ 14 hari atau ≥ 20 klik sesudah, upload file sesudah ke Modul B. Salin angka sesudah ke tab TRACKER. | Klik sesudah < 20 → verdict tetap BELUM CUKUP DATA. |
| D4 | Sistem (Sheets) | Hitung delta, tentukan verdict (BERHASIL / TIDAK BERUBAH / MEMBURUK). Tab PEMBELAJARAN ter-update otomatis. | — |
| D5 | Lead Advertiser | Setiap awal bulan baca tab PEMBELAJARAN. Jadikan materi upgrading: jenis perubahan sering berhasil → standarisasi. Jarang berhasil → hentikan. | — |

## 4. Contoh Skenario Konkret

### 4.1 Skenario A — Klien baru tanpa data iklan (Welmer)
Input: File Bisnis Saya Welmer 20–26 Juli 2026, 118 baris SKU induk, tidak ada file iklan.
Konfigurasi: Target ROAS 3.57 (Fase 1, margin 40%, platform 12%), CPC pasar Rp691 (acuan Gold Pigeon sekategori), faktor CR iklan 1.0.

Proses kalkulasi sistem:
- Median CTR toko = 5.24% (dari 32 SKU dengan Views ≥ 200)
- Median CR toko = 0.00% → floor absolut dipakai: 0.5%
- Median Views = 765
- SKU 'Sneakers Corduroy Slip On': AOV 313.333, CR 1.25%, Views 1.240
- CPC Max = 313.333 × (1.25/100 × 1.0) ÷ 3.57 = Rp1.097
- CPC Max 1.097 > CPC Pasar 691 → lolos filter
- CTR 5.87% ≥ 5.24%, CR 1.25% ≥ 0.5%, Views 1.240 < 765 → Rute: KANDIDAT IKLAN

Output ringkasan: 6 SKU SCALE, 10 KANDIDAT IKLAN, 10 OPTIMASI GAMBAR, 6 OPTIMASI DESKRIPSI, 6 PARKIR.
Rekomendasi sistem: '10 SKU Kandidat Iklan siap dibelanjakan. Mulai dengan budget sesuai floor kampanye (Rp50.000/hari per kampanye). Kerjakan optimasi gambar pada 10 SKU sebelum menaikkan budget di sana.'

### 4.2 Skenario B — Perbandingan sebelum vs sesudah optimasi gambar
Input: Performa Produk Welmer 1–14 Juli (SEBELUM), 15–28 Juli (SESUDAH). Perubahan yang dilakukan: ganti gambar utama 'Sneakers Outdoor Trail' dari foto sudut samping menjadi foto flat lay + latar polos.

| Metrik | Sebelum | Sesudah | Delta | Verdict |
|---|---|---|---|---|
| Views | 3.120 | 3.844 | +23,2% | — |
| Klik | 58 | 96 | +65,5% | — |
| CTR | 1,86% | 2,50% | +34,4% | MEMBAIK ✓ |
| CR | 0,00% | 0,00% | 0% | BELUM CUKUP DATA |

Keputusan sistem: CTR naik 34,4% → MEMBAIK. CPC Maksimum SKU ini sebelumnya Rp0 (CR 0), sekarang naik karena klik bertambah — evaluasi ulang di Modul A setelah 14 hari berikutnya.

### 4.3 Skenario C — Klien Sperantia, ROAS di bawah floor kontribusi
Input: file Sperantia, ROAS aktual 0.92. Margin klien (diasumsikan 40%), platform 12%.
- Floor Kontribusi = harga_jual ÷ (margin_Rp − biaya_platform_Rp)
- Contoh AOV Rp80.000: margin Rp32.000, platform Rp9.600, kontribusi Rp22.400
- Floor = 80.000 ÷ 22.400 = 3.57
- ROAS aktual 0.92 < Floor 3.57

Output sistem: 'PERINGATAN KRITIS: ROAS aktual di bawah floor kontribusi. Setiap pesanan baru menambah kerugian. Volume memperburuk, bukan memperbaiki. Jangan tambah budget. Yang dikerjakan: perbaikan CPC (CPC Rp1.369 vs acuan kategori Rp261 — anomali 5x), atau perbaikan listing & harga.'

## 5. System Requirements

### 5.1 Komponen sistem

| Komponen | Teknologi awal (v1) | Catatan |
|---|---|---|
| Modul A & B — Screening & Perbandingan | HTML + JS, jalan di browser | Tidak ada server, semua kalkulasi di client-side. Data tidak dikirim keluar. Library: xlsx.js dari CDN. |
| Modul C — Decision Log | Google Sheets (v1) → migrasi ke Supabase (v2) | Skema dibuat kompatibel Supabase sejak v1: append-only, primary key stabil, tanpa merged cell. |
| Modul D — Tracker Optimasi | Google Sheets (v1) | Tab PEMBELAJARAN menggunakan COUNTIFS/AVERAGEIFS, tidak memerlukan backend di v1. |
| Claude Project (Lead Audit) | Claude claude.ai Projects | Instruksi system prompt + knowledge base dari ekspor Sheets. Bukan integrasi API. |

### 5.2 Struktur data — Decision Log
Tabel: `decision_log`

| Field | Tipe | Wajib | Validasi & Catatan |
|---|---|---|---|
| log_id | string | auto | Format 'LOG-NNNN'. Auto-generate dari nomor urut baris. Immutable setelah terbuat. |
| created_at | date | ya | Format dd/mm/yyyy. Diisi advertiser saat membuat keputusan. |
| advertiser_name | enum | ya | Dari daftar nama di tab REF. Dropdown validation. |
| client_name | enum | ya | Dari daftar klien aktif di tab REF. |
| platform | enum | ya | Shopee \| TikTok \| Meta \| Google |
| object_type | enum | ya | SKU \| Kampanye \| Kreator \| Konten |
| object_name | string | ya | Nama SKU atau nama kampanye. Maks 120 karakter. |
| sop_stage | enum | ya | 1-Screening SKU \| 2-Setup Test \| 3-Evaluasi \| 4-Scale \| 5-Kill |
| decision | enum | ya | Loloskan ke iklan \| Tolak \| Mulai test \| Naikkan budget \| Turunkan budget \| Ubah target ROAS \| Ganti kreatif \| Pause \| Biarkan \| Eskalasi ke lead |
| metric_key | enum | ya | ROAS \| ACOS \| CTR \| CR \| GMV \| Biaya per konversi \| Pesanan \| Views |
| metric_value | float | ya | Nilai aktual metrik saat keputusan dibuat. |
| metric_target | float | ya | Nilai target yang ditetapkan (dari fase klien). |
| status_vs_target | computed | auto | SESUAI \| DI BAWAH TARGET \| DI ATAS TARGET. Dihitung otomatis berdasarkan arah metrik dan nilai aktual vs target. |
| spend_7d | integer | tidak | Biaya iklan 7 hari dalam Rp. Diisi advertiser, opsional saat membuat, wajib saat review. |
| gmv_7d | integer | tidak | GMV 7 hari dalam Rp. Diisi saat review. |
| roas_result | computed | auto | gmv_7d ÷ spend_7d. Computed, tidak boleh diisi manual. |
| verdict | enum | tidak | Berhasil \| Gagal \| Belum cukup data. Diisi Lead saat review mingguan. |
| notes | string | tidak | Teks bebas. Maks 300 karakter. |

### 5.3 Struktur data — Optimization Tracker
Tabel: `optimization_tracker`

| Field | Tipe | Wajib | Validasi & Catatan |
|---|---|---|---|
| opt_id | string | auto | Format 'OPT-NNNN'. Auto-generate. |
| change_date | date | ya | Tanggal perubahan mulai dilakukan. |
| client_name | enum | ya | Foreign key ke daftar klien. |
| product_code | string | tidak | Kode Produk dari Seller Centre. Dipakai sebagai primary key pencocokan di Modul B. |
| product_name | string | ya | Nama SKU. Fallback key jika product_code kosong. |
| initial_route | enum | ya | Rute dari Modul A saat record dibuat. |
| change_type | enum | ya | 10 jenis dari REF: Gambar utama \| Judul produk \| Video produk \| Thumbnail & badge \| Deskripsi \| Foto detail & ukuran \| Harga \| Voucher/promo \| Bundling/minimum belanja \| Dorong ulasan. |
| metric_evaluated | computed | auto | CTR jika change_type = gambar/judul/video/thumbnail. CR jika selainnya. Computed dari pemetaan di REF. |
| before_views … before_orders | integer/float | ya | 5 kolom: views, klik, CTR, CR, pesanan dari periode SEBELUM. |
| after_views … after_orders | integer/float | tidak | 5 kolom yang sama dari periode SESUDAH. Diisi setelah ≥ 14 hari. |
| delta_ctr \| delta_cr | computed | auto | (sesudah ÷ sebelum − 1) × 100. Computed. |
| delta_metric_evaluated | computed | auto | Mengacu delta_ctr atau delta_cr sesuai metric_evaluated. |
| verdict | computed | auto | BERHASIL (+≥20%) \| TIDAK BERUBAH (-10%..+20%) \| MEMBURUK (-≥10%) \| BELUM CUKUP DATA (<20 klik sesudah). |
| budget_decision | enum | tidak | Naikkan budget +30% \| Pertahankan \| Turunkan budget \| Kembalikan perubahan \| Belum ada tindakan. |
| notes | string | tidak | Maks 300 karakter. |

### 5.4 File parser (Modul A & B) — spesifikasi fungsi

**Fungsi `parseIndonesianNumber(value: string | number): number`**
- Input: semua tipe. Output: number atau NaN.
- Algoritma: (a) strip whitespace, Rp prefix, %. (b) Deteksi format gabungan titik+koma → strip titik, ganti koma ke '.'. (c) Koma tunggal → ganti ke '.'. (d) Titik tunggal: split, cek semua segmen setelah titik berukuran tepat 3 digit → strip titik (ribuan). Else: biarkan (desimal). (e) parseFloat. (f) Nilai negatif dalam kurung → kalikan -1.

**Fungsi `readShopeePerformanceFile(arrayBuffer: ArrayBuffer): SKURecord[]`**
- Gunakan sheetname yang mengandung 'performa' (case-insensitive) sebagai target sheet.
- Baris header dideteksi otomatis dari baris pertama yang mengandung 'Produk', bukan dari nomor baris hardcoded.
- Filter hanya baris dengan Kode Variasi = '-' (produk induk). Baris lain diabaikan.
- Jika kolom 'Kode Produk' tidak ada, isi dengan empty string.

**Fungsi `matchSKUs(before: SKURecord[], after: SKURecord[]): MatchedPair[]`**
- Primary key: Kode Produk. Fallback: normalize(nama_produk).
- Normalize: lowercase, strip karakter non-alfanumerik, trim.
- SKU yang tidak memiliki pasangan di periode lain diabaikan dengan silent skip (tidak error).

### 5.5 Constraint dan non-functional

**Performa:**
- Parsing file xlsx hingga 1.000 baris SKU harus selesai dalam < 3 detik pada device mid-range.
- Kalkulasi routing setelah parsing harus selesai dalam < 500ms.

**Keamanan data:**
- Modul A & B: TIDAK BOLEH ada network request ke server eksternal. Semua data tetap di browser. Tidak ada telemetry.
- Modul C & D (Sheets): data klien tidak boleh diakses oleh akun di luar tim MEA. Perlu access control di level Google Sheets.

**Migrasi ke Supabase (v2):**
- Skema Decision Log dan Optimization Tracker harus kompatibel sebagai tabel SQL dari hari pertama: (a) Satu baris = satu record. (b) Tidak ada sel gabungan. (c) Tidak ada warna sebagai encoding data. (d) Enum fields menggunakan nilai tetap dari REF. (e) Kolom computed tidak menyimpan formula sebagai data, melainkan nilai hasil formula.
- Kolom tambahan di masa depan ditambahkan di kanan, tidak di tengah.

## 6. Open Assumptions

Semua item di bawah ini harus dikonfirmasi SEBELUM atau SELAMA sprint pertama. Developer dilarang mengasumsikan sendiri.

| # | Asumsi | Dampak jika salah | Perlu konfirmasi dari |
|---|---|---|---|
| A01 | Kolom 'Kode Variasi' selalu ada di ekspor Performa Produk Shopee. Nilai '-' untuk produk induk. | Filter baris produk induk gagal, semua baris diproses, GMV double-count. | Tim advertiser — cek minimal 5 ekspor dari klien berbeda. |
| A02 | Nama sheet yang mengandung performa produk selalu mengandung kata 'Performa' (case-insensitive) di semua bahasa antarmuka Shopee Seller Centre. | File tidak bisa dibaca otomatis, harus hardcode nama sheet. | Tim advertiser — cek ekspor Seller Centre bahasa Inggris jika ada. |
| A03 | Kolom 'Kode Produk' tersedia di semua versi ekspor Performa Produk. Dipakai sebagai primary key pencocokan antar periode. | Fallback ke nama produk wajib, risiko mismatch jika nama berubah. | Tim advertiser — tampilkan 3–5 ekspor untuk dikonfirmasi. |
| A04 | Library xlsx.js v0.18.5 dari CDN cdnjs.cloudflare.com dapat memuat file ekspor Shopee tanpa kerusakan karakter atau format. | Parser gagal pada file tertentu. | Developer — uji dengan 3 file ekspor nyata. |
| A05 | Google Sheets yang dikonversi dari .xlsx mempertahankan dropdown DataValidation dari tab REF. | Dropdown hilang, advertiser isi bebas, log tidak bisa diaudit. | Developer — uji konversi dan cek dropdown. |
| A06 | Struktur ekspor Laporan Iklan Produk/CPC Shopee memiliki baris header di baris ke-7 (index 6). Format kolom: 'Biaya' dan 'Jumlah Klik' adalah string dengan format angka Indonesia. | CPC parser gagal, fallback ke input manual. | Tim advertiser — konfirmasi dengan 3 ekspor CPC nyata. |
| A07 | Service fee MEA bersifat flat bulanan untuk semua klien. Tidak ada klien yang membayar service fee berbasis persentase GMV. | Kalkulasi biaya per pesanan di EKONOMI_KLIEN salah. | Yohan / Head of Account — konfirmasi struktur kontrak. |
| A08 | Angka default 'Fase 1' di ROAS adalah floor kontribusi dengan margin 40% dan platform 12% (= 3.57) jika margin klien belum diisi. Ini cukup konservatif untuk semua kategori. | Target sementara terlalu rendah untuk kategori margin tipis, atau terlalu tinggi untuk margin tinggi. | Yohan — setujui atau ganti angka default. |
| A09 | Faktor CR Iklan defaultnya 1.0 (konservatif). Tidak ada klien yang CR iklannya lebih rendah dari CR organik. | CPC Maksimum di bawah estimasi, terlalu banyak SKU masuk 'TAHAN'. | Tim advertiser — kumpulkan data CR organik vs CR iklan 5 klien. |
| A10 | Modul A & B tidak memerlukan autentikasi atau session. Siapapun yang memiliki file HTML dapat menggunakannya. | Risiko akses data klien oleh pihak yang tidak berwenang. | Yohan / Hans — keputusan arsitektur keamanan. |

## 7. Success Metrics

### 7.1 Activation event
Advertiser dianggap 'aktivasi' jika dalam 7 hari pertama memakai tool:
- Menjalankan Modul A pada minimal 1 klien, DAN
- Mengisi minimal 3 baris di Decision Log dengan target metrik terisi (bukan kosong)

Lead dianggap aktivasi jika menjalankan 'audit log' pertama kali di Claude Project.

### 7.2 North-star metric

| Persona | North-star | Alasan |
|---|---|---|
| Tim advertiser | % keputusan kampanye yang punya target metrik terisi (bukan kosong) per minggu | Ini proxy untuk 'keputusan berbasis angka'. Target: ≥ 80% dalam 4 minggu. |
| Lead advertiser | Variance compliance antar advertiser (standar deviasi % keputusan sesuai standar) | Masalah awalnya adalah beda hasil antar orang. Variance yang menyempit = masalah terpecahkan. |
| Business (Yohan) | % klien yang naik kelas (C→B atau B→A) dalam 3 bulan | Proxy untuk dampak sistem ke kualitas akun iklan. |

### 7.3 Leading indicators (cek mingguan)
- Jumlah log entries per advertiser per minggu (target: ≥ 8 per advertiser)
- % SKU yang punya rute dari Modul A sebelum kampanye pertama dinyalakan
- Jumlah SKU di tab Tracker Optimasi yang sudah ada data sesudah (tidak terbengkalai)
- Jumlah eskalasi ke lead (tanda sistem berjalan, bukan kelemahan)

### 7.4 Guardrail metrics (jangan naik)
- % baris Decision Log tanpa target metrik (target: < 20%, batas merah 40%)
- % log entries dari klien kelas A yang ROAS-nya di bawah fase mereka (tanda tangga keputusan tidak dipakai)
- Jumlah klien kelas C yang diiklankan tanpa catatan 'Eskalasi ke lead' (tanda sistem diterobos)

## Catatan Versi

| Versi | Tanggal | Perubahan |
|---|---|---|
| v1.0 | 27 Jul 2026 | Draft pertama. Mencakup Modul A–D. Belum mencakup TikTok, Meta, Google. Semua kalkulasi berbasis data Shopee 8 klien 20–26 Juli 2026. |

Dokumen ini adalah draft — menunggu konfirmasi 10 Open Assumptions sebelum dianggap final. Bagian yang berpotensi berubah signifikan: default target ROAS Fase 1 (A08), struktur kode produk sebagai primary key (A03), dan keputusan arsitektur keamanan Modul A/B (A10).
