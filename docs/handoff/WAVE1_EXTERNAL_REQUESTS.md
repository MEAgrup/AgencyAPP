# CDPS — Permintaan Eksternal untuk Wave 1 (jalur kritis)

> Disiapkan oleh sesi build Wave 1. Dua permintaan ini **di luar tim dev** dan berada di jalur kritis Wave 1. Selama menunggu, CDPS berjalan dengan fallback (mock HRIS + seed MSL) sehingga pengembangan Wave 1 tidak terblokir; tetapi **UAT/exit Wave 1 (W1-20) tidak bisa go tanpa keduanya.**

---

## Permintaan #1 — 2 endpoint HRIS asli (ke: maintainer HRIS)

Kontrak lengkap sudah ditulis di **`docs/HRIS_API_CONTRACT.md`** (draft v1). Yang diminta dari maintainer HRIS:

### Aksi yang dibutuhkan
1. **Review & konfirmasi field** yang ditandai ⚠ di kontrak:
   - Nama field persis pada payload `GET /api/v1/employees` (`employee_id`, `nama`, `email`, `divisi`, `jabatan`, `status_aktif`, `updated_at`).
   - **Daftar nilai `divisi` dan `jabatan` yang riil** — dibutuhkan untuk mengisi tabel role-mapping CDPS (HRIS jabatan/divisi → role CDPS). Tanpa ini, mapping role tidak bisa divalidasi ke data nyata.
   - Konfirmasi `employee_id` **stabil & immutable** (CDPS memakainya sebagai foreign key; tidak boleh berubah).
2. **Sediakan 2 endpoint di lingkungan staging** (server-to-server, read-only):
   - `GET /api/v1/employees` — sinkronisasi karyawan (mendukung `updated_since`, `page`, `page_size`).
   - `POST /api/v1/auth/verify` — verifikasi email+password; balikan `{valid, employee_id}`. (Alternatif: `POST /auth/token` + JWKS bila HRIS sudah menerbitkan JWT — CDPS sudah diabstraksi di balik interface `Authenticator`, pola mana pun diterima.)
3. **Pilih mekanisme auth server-to-server**: static service token (`Authorization: Bearer <service-token>`) atau mTLS.

### Yang sudah siap di sisi CDPS (tidak menunggu HRIS)
- Interface `EmployeeSource` + implementasi HTTP sesuai kontrak (`backend/internal/hris/http_source.go`).
- Fallback CSV (`backend/testdata/employees.csv`) + mock HRIS (`cmd/mockhris`, :8081) untuk dev/staging sampai endpoint asli hidup.
- Login fail-closed dengan pesan BI `[sistem HRIS tidak dapat dihubungi, coba beberapa saat lagi]`.

### Cara switch ke HRIS asli (tanpa perubahan kode konsumen)
Set env `CDPS_HRIS_BASE_URL` ke base URL HRIS staging + suntik service token; source HTTP menggantikan CSV lewat interface yang sama.

---

## Permintaan #2 — Kompilasi Master Service List riil (ke: Sales Head/SPV)

Master Service List (MSL) adalah sumber angka untuk **Estimasi Nilai** dan **Perhitungan Komisi** di M0. Saat ini CDPS berisi 3 layanan contoh (seed Alpha Digital). Untuk Wave 1 riil dibutuhkan daftar lengkap tervalidasi.

### Aksi yang dibutuhkan (Sales Head/SPV — bukan salesperson individual, per keputusan M0 OD-2)
Untuk **setiap layanan**, isi kolom berikut (satu baris = satu layanan):

| Kolom | Tipe | Contoh | Wajib |
|---|---|---|---|
| `name` | teks | Jasa Buka Toko Online Basic | ✅ |
| `standard_price` | angka desimal (IDR, tanpa `Rp`/titik ribuan) | `5000000.00` | ✅ |
| `commission_rule` | aturan komisi (lihat format di bawah) | `10% of standard price` | ✅ |
| `active` | ya/tidak | ya | ✅ |
| `effective_from` | tanggal `YYYY-MM-DD` (mulai berlaku) | `2026-01-01` | ✅ |

**Format `commission_rule`** (dikunci per versi, deal mengunci versi pada tanggal closing). Dua bentuk yang didukung parser (provisional, lihat DECISIONS O14):
- `<N>% of standard price` → komisi = N% dari harga standar layanan itu (mis. `10% of standard price`).
- `flat Rp <N>` → komisi nominal tetap IDR (mis. `flat Rp 500.000`).

Pembulatan komisi: **round-half-up ke rupiah utuh** (tampilan `Rp. X.XXX.XXX,00`).
> Jika ada bentuk aturan komisi lain di daftar riil (mis. tiered, per-platform), **cantumkan apa adanya** — kami akan konfirmasi grammar final (DECISIONS O14) dan tambahkan dukungan parser, bukan menebak.

### Aturan yang sudah dikunci di sistem (konteks untuk pengisian)
- MSL dikelola **Sales Head/SPV** saja; salesperson individual tidak bisa mengubah (keputusan M0 OD-2, guardrail integritas komisi).
- Setiap perubahan harga = **versi baru** (immutable, ter-log). Deal mengunci **versi yang efektif pada tanggal closing** — jadi `effective_from` penting.
- Harga custom per deal tetap lewat jalur approval negosiasi (M0 §5), bukan mengubah MSL.

### Cara memasukkan ke sistem
Setelah daftar tervalidasi: input via admin MSL (`web-internal /master-services`, role Sales Head/SPV/Director) **atau** serahkan CSV ke tim dev untuk seed. Format harga tampil di UI sebagai `Rp. X.XXX.XXX,00`.

---

## Status blocking

| Permintaan | Blokir dev Wave 1? | Blokir UAT/exit Wave 1 (W1-20)? |
|---|---|---|
| #1 Endpoint HRIS asli | ❌ (fallback CSV/mock aktif) | ✅ login & sync riil harus jalan |
| #2 MSL riil | ❌ (seed contoh aktif) | ✅ komisi harus dispot-check vs MSL riil oleh Sales Head |

---

## Permintaan #3 — Sample data migrasi spreadsheet, W1-19 (ke: Yohan — menindaklanjuti DECISIONS O6)

W1-19 = **impor satu kali data operasional existing** (yang sekarang hidup di spreadsheet) ke CDPS saat go-live Wave 1. Dua kelompok data, dua jalur masuk:

1. **Leads existing (belum closing)** → masuk lewat **engine dedup M1** (bukan INSERT langsung): normalisasi telepon, tabel keputusan duplikat (aktif ⇒ ditolak dengan pesan BI; Rejected/Not-Qualified ⇒ reopen ke Pool), audit provenance per baris.
2. **Klien aktif existing (sudah closing sebelum CDPS)** → dibuat sebagai `CLI-` + `SVC-` + `TRX-` + `INST-` sesuai skema 0002, supaya Finance bisa lanjut menagih termin berjalan (reminder W1-17 langsung hidup) dan Account melihat klien sebagai released.

Proses: **dry-run report dulu** (valid / duplikat / error per baris, rekonsiliasi hitungan) → real run setelah disetujui. Parser dibangun **setelah sample masuk** (keputusan O6) supaya mengikuti bentuk kolom riil — karena itu sample ini jalur kritis.

### Kolom minimum yang dibutuhkan pada sample
**Sheet LEADS (satu baris = satu lead):**
`nama_lead, no_telepon, email (ops), sumber (form/scout/dll), campaign_asal (ops), sales_pemegang (ops), status_terakhir (pool/diproses/not-qualified/rejected), catatan (ops)`

**Sheet KLIEN AKTIF (satu baris = satu klien; layanan & termin boleh sheet terpisah ber-key nama klien):**
`toko, nama_pic, kota, link_toko, kategori, platform_list (+link toko per platform, tanggal mulai dikelola), gmv_baseline_bulanan, target_gmv, marketing_budget (ops), sales_pic, alokasi_sales (nama:% — Σ100%), commission_payment_pic, tanggal_closing, layanan_dibeli (nama + harga deal per layanan), nilai_transaksi_total, skema_pembayaran (Lunas/Sebagian/Termin/Bayar di Belakang), jadwal_termin (amount + due date per termin, Σ = total), pembayaran_terverifikasi (amount + tanggal per pembayaran yang sudah masuk), link_kontrak (ops)`

> Data kotor/tidak lengkap tidak masalah untuk sample — justru dibutuhkan agar dry-run report dan aturan penolakan bisa dirancang realistis. Kirim apa adanya.

## Permintaan #4 — Data & prasyarat UAT W1-20 (ke: Nerissa/Yohan + Sales Head)

W1-20 = **satu deal nyata dijalankan end-to-end** lintas hasil kedua stream: registrasi lead → attempt → Qualified Form → negosiasi (approval SPV) → Closing (generate `CLI-`/`TRX-`/`SVC-`) → Payment Intent → jadwal Termin → verifikasi pembayaran pertama → klien rilis ke antrean Account → reminder installment; komisi di-spot-check manual vs MSL oleh Sales Head. Go/no-go Wave 2 dicatat di DECISIONS.md.

### Yang dibutuhkan
1. **Prasyarat teknis (internal dev):** PR foundation + PR Akun A (M0/M1, s.d. W1-09 Closing) + PR stream B (#2) ter-merge ke `main`; environment staging dengan MariaDB + migrasi 0001–0012.
2. **Permintaan #1 & #2 di atas terpenuhi:** endpoint HRIS staging (login & sync karyawan riil, daftar divisi/jabatan riil untuk role mapping) dan **MSL riil tervalidasi** (dasar spot-check komisi).
3. **Akun peran lengkap** (karyawan riil hasil sync HRIS, ter-mapping): Sales Staff, Sales Head/SPV, Finance Staff, Finance Head/SPV, Account Staff, Account Lead, OD (layered), Director (layered).
4. **Satu deal riil/realistis:**
   - Identitas lead (nama, telepon, sumber/campaign).
   - Data Qualified: identitas klien (toko, PIC, kota, link, kategori), platform list, GMV baseline (rata-rata 3 bulan), Target GMV, Marketing Budget.
   - Proposal negosiasi: layanan (≤5) + harga (standar/custom) → butuh approval SPV bila custom.
   - Closing Form: salespeople (≤5) + alokasi Σ100% + Commission & Payment PIC.
   - Payment Intent + jadwal Termin (amount + due date, Σ = nilai transaksi).
   - Bukti pembayaran pertama (nominal, tanggal, link bukti transfer) + link kontrak.

---

## Jawaban diterima (2026-07-10, via Nerissa)

### Permintaan #1 — HRIS: endpoint DITUNDA, data karyawan riil via spreadsheet
Tim internal HRIS **belum sempat mengerjakan** 2 endpoint staging. Interim yang diputuskan: pakai **data karyawan asli dalam format aslinya** dari spreadsheet berikut, masuk lewat jalur fallback CSV (`EmployeeSource`) yang memang sudah disiapkan:
- Data karyawan (format asli): https://docs.google.com/spreadsheets/d/1rLCbdGk7zZ6TaK2-3f2DO4PwhS4TIxh7Nz8uHmq8_g8/edit?usp=sharing

Konsekuensi: (a) adapter kolom `format asli → employees.csv` dibuat begitu isi sheet terbaca; (b) daftar `divisi`/`jabatan` riil untuk tabel role-mapping diambil dari sheet yang sama; (c) sinkronisasi periodik & auth via HRIS tetap menunggu endpoint — login staging sementara tetap via mock HRIS yang diisi data riil.

### Permintaan #2 — Sumber kompilasi MSL riil (dari Sales Head/SPV)
- Dashboard team account: https://docs.google.com/spreadsheets/d/1aLNK1m2fIbCC9La3j4IlUZJuc1FrTvGIMAJNYKQ4yAM/edit?usp=drivesdk
- Database client: https://docs.google.com/spreadsheets/d/1uAUws99FedD4q2IMuVI8Wz4jWGOIIOv4YdDUHwbQ3zI/edit?usp=sharing

Catatan: kedua sheet adalah **sumber mentah** — daftar layanan + harga standar + aturan komisi final tetap perlu dikompilasi ke format tabel Permintaan #2 (name, standard_price, commission_rule, active, effective_from) dan divalidasi Sales Head sebelum seed.

### Permintaan #3 — Sample data migrasi W1-19 (dari Yohan, DECISIONS O6)
- **Dashboard sales**: https://docs.google.com/spreadsheets/d/1ZeRvOvtW6rTgP0tK7B-N3ziRTxQEUgKMZ2wVMDyEtGs/edit?usp=drivesdk — lead masuk dicek di tab **dashboard iklan** dan **dashboard organik**.
- **Daily lead / prospek & closing**: https://docs.google.com/spreadsheets/d/19pfVwm_mvfkbx35aVEL1OWSzshRAIFPg4jpRSRraRmU/edit?usp=drivesdk — quality lead di tab **daily lead**; closingan di tab **prospek dan closing**.
- **Rekapan input sales (harian)**: https://docs.google.com/spreadsheets/d/1KtN_vAo1U6hK9r3aFl45fMzezL7sy38cm0uA_3NQoIo/edit?usp=drivesdk — per tanggal: berapa lead masuk dan klasifikasinya (masuk **seller** / **affiliate** / **ga respon** / **bad respon**).

### ⚠ Kendala akses (blocking ekstraksi, bukan blocking kode)
Environment build remote **tidak bisa membuka docs.google.com** (network policy proxy menolak CONNECT; konektor Google Drive org ada tapi tidak diaktifkan untuk sesi). Parser W1-19, adapter HRIS, dan seed MSL riil menunggu SALAH SATU dari:
1. Konektor **Google Drive diaktifkan** pada sesi Claude Code (org sudah memasangnya), atau
2. Network policy environment mengizinkan `docs.google.com`, atau
3. Tiap sheet di-export **CSV/XLSX dan di-commit ke repo** (mis. `backend/testdata/import_samples/`) / dilampirkan ke sesi.

Begitu salah satu jalur terbuka, sisa Jalur B (parser bentuk-kolom, adapter HRIS, kompilasi MSL) tinggal eksekusi — import core, dry-run engine, dan replay pembayaran sudah selesai & teruji.
