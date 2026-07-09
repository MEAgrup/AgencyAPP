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
