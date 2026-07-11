# Langkah Manusia Sebelum Go-Live CDPS — Panduan Detail

> Dokumen ini ditujukan untuk **Nerissa, CRO/Account team, Finance team, Sales Head, dan HR**.
> Semua langkah di bawah harus selesai sebelum sesi build berikutnya menjalankan import final.
> Hasil smoke test terakhir (2026-07-10): **239 klien aktif** butuh form pelengkap, **1.097 dormant**
> siap import otomatis, **18 lead** lolos filter. Angka ini bisa berubah sedikit bila data sumber
> diperbarui.

---

## 1. FORM PELENGKAP 239 KLIEN AKTIF (CRO + Finance)

### Apa ini?
File `form_pelengkap.csv` berisi 239 klien yang masih aktif (layanan masih berjalan ATAU ada tagihan belum lunas). Sistem sudah mengisi data yang bisa diambil dari ledger spreadsheet lama. **13 kolom sisanya KOSONG — harus diisi manusia** supaya klien bisa masuk CDPS dengan data lengkap.

### Siapa mengisi apa?

| Kolom | Siapa | Penjelasan | Contoh isian |
|---|---|---|---|
| `konfirmasi_aktif` | CRO/Account | **Y** = klien memang masih aktif, impor penuh ke CDPS. **N** = ternyata sudah tidak aktif → masuk arsip (dormant), tidak perlu isi kolom lain untuk baris ini. | `Y` atau `N` |
| `kota` | CRO/Account | Kota domisili bisnis klien. | `Jakarta Selatan` |
| `kategori` | CRO/Account | Kategori bisnis klien (fashion, F&B, elektronik, dll). | `Fashion` |
| `gmv_baseline_bulanan` | CRO/Account | Rata-rata GMV bulanan klien saat ini (dalam Rupiah, angka saja tanpa "Rp" atau titik ribuan). Tulis `0` jika tidak diketahui. | `50000000` |
| `target_gmv` | CRO/Account | Target GMV yang disepakati (angka saja). Tulis `0` jika tidak ada target. | `100000000` |
| `marketing_budget` | CRO/Account | Budget marketing klien per bulan (angka saja). Kosongkan jika tidak ada. | `5000000` |
| `sales_pic_nik` | CRO/Sales Head | NIK karyawan Sales PIC utama klien ini (format 9 digit dari sheet HRIS, contoh: `260210001`). **Harus NIK yang terdaftar di data karyawan.** | `260210001` |
| `alokasi_sales` | CRO/Sales Head | Pembagian persentase antar sales yang menangani klien. Format: `NIK:persentase` dipisah `\|`. Total HARUS = 100. Jika satu orang: `NIK:100`. | `260210001:60\|260210002:40` |
| `commission_payment_pic_nik` | Sales Head/Finance | NIK karyawan yang bertanggung jawab follow-up pembayaran & komisi. | `260210003` |
| `skema_final` | Finance | Skema pembayaran yang berlaku sekarang. **Pilih salah satu dari 4 opsi persis ini:** `Bayar Penuh (Lunas)`, `Bayar Sebagian`, `Termin`, `Bayar di Belakang`. Kolom `skema_prefill` (sudah terisi) adalah tebakan dari data lama — Finance memastikan/mengoreksi. | `Termin` |
| `jadwal_termin` | Finance | **Hanya jika skema = Termin.** Daftar cicilan: `jumlah@tanggal` dipisah `\|`. Jumlah = angka Rupiah tanpa Rp/titik. Tanggal format `YYYY-MM-DD`. Total semua jumlah HARUS = `total_nominal`. **Urutan tanggal harus dari yang paling awal ke paling akhir (tidak boleh mundur).** | `5000000@2026-03-01\|5000000@2026-04-01` |
| `pembayaran_terverifikasi` | Finance | Pembayaran yang SUDAH masuk (terbukti). Format sama: `jumlah@tanggal` dipisah `\|`. Jika belum ada pembayaran, kosongkan. Urutan tanggal = urutan termin yang dibayar (jika termin, posisi 1→termin 1, dst). | `5000000@2026-03-05` |
| `link_kontrak` | Finance/CRO | Link ke dokumen kontrak (Google Drive, dsb). Kosongkan jika belum ada. | `https://drive.google.com/...` |

### Cara kerja

1. **Buka** `form_pelengkap.csv` di Google Sheets atau Excel.
2. **Kolom A–L sudah terisi** (abu-abu / prefilled) — **jangan diubah**. Ini data dari ledger lama: ID, nama toko, nama PIC, sales, tanggal closing, daftar layanan, platform, skema awal, email, telepon, link toko, total nominal.
3. **Kolom M–Y** (konfirmasi_aktif sampai link_kontrak) = yang harus diisi.
4. **Mulai dari `konfirmasi_aktif`**: jika klien ternyata sudah tidak aktif, tulis `N` dan lanjut ke baris berikutnya (tidak perlu isi kolom lain).
5. Untuk klien `Y`: isi semua kolom sesuai tabel di atas.
6. **Pembagian kerja yang disarankan:**
   - **CRO/Account** mengisi: konfirmasi_aktif, kota, kategori, GMV baseline, target GMV, marketing budget, link kontrak.
   - **Sales Head** membantu: sales_pic_nik, alokasi_sales.
   - **Finance** mengisi: commission_payment_pic_nik, skema_final, jadwal_termin, pembayaran_terverifikasi.
7. **Simpan sebagai CSV** (bukan .xlsx) dan serahkan kembali ke tim dev.

### Validasi otomatis yang akan dijalankan sistem

Sistem akan **menolak baris** jika:
- `konfirmasi_aktif` bukan `Y` atau `N`
- `sales_pic_nik` atau anggota `alokasi_sales` tidak terdaftar sebagai karyawan
- Total alokasi ≠ 100%
- `skema_final` bukan salah satu dari 4 opsi di atas
- `jadwal_termin` totalnya ≠ `total_nominal`
- Tanggal di `jadwal_termin` mundur (baris ke-2 lebih awal dari baris ke-1)
- `pembayaran_terverifikasi` ada tapi `jadwal_termin` kosong (untuk skema Termin)

Baris yang ditolak akan dilaporkan dengan nomor baris + alasan — perbaiki lalu jalankan lagi (dry-run dulu, baru apply).

### Estimasi waktu

239 klien, tapi banyak yang kemungkinan akan di-`N`-kan (sudah tidak aktif). Skenario realistis: ~50–80 klien benar-benar aktif perlu diisi lengkap. Dengan 2–3 orang mengerjakan parallel, perkiraan **2–3 hari kerja**.

---

## 2. SALES-MAP — DISEDERHANAKAN (revisi 2026-07-11)

> **✅ Keputusan Nerissa 2026-07-11:** tidak ada sistem nickname. Di spreadsheet, semua sales
> ditulis dengan **nama lengkap** — satu-satunya pengecualian adalah **Sales Head yang memakai
> nickname "Cena"**.

### Konsekuensi

Sistem akan me-resolusi nama sales **otomatis** dengan mencocokkan nama lengkap di spreadsheet
terhadap nama karyawan di data HRIS (tidak case-sensitive, spasi dirapikan). Tabel konversi manual
~20 baris **tidak diperlukan lagi**.

File `sales_map.csv` tetap ada tapi hanya untuk **pengecualian**, minimal 1 baris:

```
nickname,employee_id
Cena,<NIK Sales Head>
```

Tambahkan baris lain hanya jika laporan dry-run import menampilkan nama yang tidak ter-resolusi
otomatis (mis. ejaan beda dengan HRIS, bot seperti "Cekat AI" → kosongkan NIK-nya, atau dua
karyawan bernama sama persis — sistem tidak menebak dan meminta ditegaskan lewat file ini).

### Yang masih dibutuhkan dari manusia

- **NIK Sales Head (Cena)** — 1 menit.
- Setelah dry-run pertama: cek daftar "nama tidak ter-resolusi" (kalau ada), lengkapi di `sales_map.csv`.

### Estimasi waktu

**~5 menit** (turun dari 30 menit).

---

## 3. VALIDASI MSL — Master Service List (Sales Head)

> **✅ Update 2026-07-11 (Nerissa):** basis harga standar = **spreadsheet pricelist resmi**
> (Google Sheets, sudah terbaca sistem). Harga deal di ledger yang berbeda adalah hasil negosiasi
> per-klien — itu tetap sah sebagai harga deal, tapi `standard_price` diambil dari pricelist.
> Tim dev akan **mem-prefill** `usulan_standard_price` dari pricelist; tugas Sales Head berubah
> dari "mengisi dari nol" menjadi **memeriksa hasil pencocokan** (lihat laporan rekonsiliasi yang
> akan disiapkan tim dev di `docs/handoff/`).

### Apa ini?
File `docs/handoff/MSL_DRAFT_KOMPILASI.csv` berisi 180 layanan yang dikompilasi dari 1.517 deal di ledger lama. Sistem sudah mengelompokkan dan menghitung statistik harga. Dua kolom kunci:
- `usulan_standard_price` — harga standar resmi per layanan (**di-prefill dari pricelist di mana cocok; sisanya diisi Sales Head**)
- `usulan_commission_rule` — aturan komisi per layanan (**tetap diisi Sales Head** — pricelist hanya menyebut komisi untuk sebagian kecil layanan, mis. Store Management "+ komisi 5%", KOL "10% ratecard")

### Langkah per baris

Untuk **setiap baris** (180 baris, tapi 10 layanan teratas = 63% deal — prioritaskan ini):

1. **Cek nama layanan** (`canonical_name`): apakah benar satu layanan? Kolom `varian_ejaan` menunjukkan nama-nama yang digabung. Kolom `catatan` bertuliskan "MIRIP TAPI TIDAK DIGABUNG: ..." jika ada layanan lain yang mirip tapi belum digabung — putuskan apakah seharusnya satu layanan (laporkan ke dev untuk digabung) atau memang beda.

2. **Isi `usulan_standard_price`**: angka desimal IDR, **tanpa "Rp" dan tanpa titik ribuan**. Contoh: `2950000` (bukan `Rp2.950.000`). Kolom `harga_min`/`median`/`modus`/`max` adalah referensi sebaran harga deal riil (sudah campur negosiasi) — jangan ambil mentah-mentah.

3. **Isi `usulan_commission_rule`**: HANYA salah satu dari 2 format:
   - `"X% of standard price"` — contoh: `10% of standard price`
   - `"flat Rp X"` — contoh: `flat Rp 500000`
   
   Tidak ada format lain yang diterima sistem. Kalau ada aturan tiered/khusus, catat di catatan dan diskusikan — perubahan komisi per kuartal ditangani lewat versioning (tanggal berlaku), bukan formula rumit.

4. **Tandai apakah layanan masih dijual** (aktif) — akan diisi di sistem.

5. **Tetapkan `effective_from`** (tanggal mulai berlaku): format `YYYY-MM-DD`. Deal historis mengunci versi harga pada tanggal closing masing-masing.

### Setelah selesai

Serahkan CSV yang sudah terisi kembali ke tim dev. Akan diinput via admin MSL atau di-seed langsung ke database.

### Estimasi waktu

180 baris, tapi bisa dimulai dari **10 baris teratas** (63% deal). Realistis: **1 hari kerja** untuk top 30–50, sisanya menyusul.

---

## 4. DAFTAR NIK → EMAIL KARYAWAN (HR)

### Apa ini?
Sheet karyawan HRIS **tidak ada kolom email**. CDPS butuh email untuk login. HR perlu menyediakan mapping.

### Format yang dibutuhkan

File CSV, 2 kolom:

```
nik,email
260210001,cena@meagency.co.id
260210002,esal@meagency.co.id
```

- Semua NIK dari sheet HRIS (186 karyawan)
- Email kerja resmi masing-masing

### Dampak jika belum ada

Karyawan **tidak bisa login** ke CDPS sampai email terisi. Sync karyawan tetap bisa jalan (data nama, divisi, jabatan masuk), tapi akses sistem = nol.

### Estimasi waktu

Jika HR sudah punya data di sistem lain: **1-2 jam** (export + format). Jika harus dikumpulkan manual: **1 hari kerja**.

---

## 5. VALIDASI ROLE MAPPING (OD/Nerissa) — ✅ 6 [KONFIRMASI] SELESAI (2026-07-11)

Jawaban Nerissa sudah diterapkan ke `docs/handoff/HRIS_ROLE_MAPPING_DRAFT.md` §0:

1. **CREATIVE - EKSTERNAL** → freelance/vendor **tanpa akun CDPS** (tidak disync)
2. **ADVERTISER** → tim **Ads** ✓
3. **MCN** → **keluar dari CDPS** (divisi sister company, tidak disync)
4. **AFFILIATE** → **gabung ke KOL**
5. **BUSINESS DEVELOPMENT** → **di luar modul** (sync tanpa akses); 1 orang BD = marketing pembuat leads awal → kandidat akses M2 (Wave 3), per-orang
6. **GROWTH & BUSINESS CONSULTATION** → **bagian dari Account**

### Yang MASIH dibutuhkan dari Nerissa/OD

- Keputusan untuk: **TIKTOK GO**, **DATA & BUSINESS INTELLIGENCE** (belum dijawab), dan konfirmasi akhir **IT / HRGA / SKILSKUL** (usulan saat ini: tanpa akses CDPS).
- Daftar **employee_id** kandidat layered role **OD** (read-only seluruh sistem).
- Daftar **employee_id** kandidat layered role **Director** (akses penuh).
- Nama/NIK **1 orang BD** yang bagian marketing (untuk akses M2 nanti).

### Estimasi sisa

**~10 menit.**

---

## Urutan yang disarankan

| Prioritas | Item | Status (2026-07-11) | Pemblokir | Estimasi sisa |
|---|---|---|---|---|
| **1 (PARALEL)** | Sales-map (§2) | ✅ Disederhanakan — hanya butuh NIK Cena + cek dry-run | Blokir import lead & klien | ~5 menit |
| **1 (PARALEL)** | NIK→email (§4) | ⏳ Menyusul dari HR | Blokir login CDPS | 1-2 jam |
| **1 (PARALEL)** | Role mapping (§5) | ✅ 6 [KONFIRMASI] selesai; sisa TikTok Go, Data & BI, daftar OD/Director | Blokir sync karyawan | ~10 menit |
| **2** | Form pelengkap (§1) | ⏳ Dikirim menyusul (CRO + Finance) | Butuh NIK sales untuk kolom `sales_pic_nik` | 2-3 hari |
| **3** | MSL validasi (§3) | 🔄 Pricelist diterima — dev mem-prefill, Sales Head tinggal review | Tidak memblokir import, tapi blokir kalkulasi komisi | ~0,5 hari review |

Item prioritas 1 bisa dikerjakan **bersamaan** oleh orang yang berbeda. Form pelengkap (§1) adalah yang paling berat — mulai secepat mungkin.

---

## Setelah semua selesai

Serahkan semua file ke sesi build berikutnya:
1. `form_pelengkap.csv` (terisi)
2. `sales_map.csv`
3. `MSL_DRAFT_KOMPILASI.csv` (terisi standard_price + commission_rule)
4. `nik_email.csv`
5. Jawaban [KONFIRMASI] role mapping

Tim dev akan menjalankan:
```
import leads-dryrun  → leads-apply     (18+ lead)
import clients-dryrun → clients-apply  (klien aktif dari form)
import dormant-apply                    (1.097 klien arsip)
hrisconvert + sync                      (186 karyawan + email + role)
MSL seed                                (180 layanan + harga + komisi)
```

Dry-run (simulasi) selalu dijalankan dulu — tidak ada data yang berubah sampai apply.
