# RENCANA ROLLBACK — cutover Go/MySQL → TS/Supabase

> Draft **2026-07-31**. Butir #5 daftar sisa `HANDOFF_CUTOVER_SESI25.md` §2.
> Status: **kerangka lengkap; dua bagian TBD sampai butir #4 (backup MySQL Railway) selesai** —
> ditandai 🔶 dan tidak disamarkan sebagai selesai.
>
> Berkas ini **bukan** runbook yang boleh dijalankan tanpa dibaca. Rollback membuang pekerjaan
> dan, sesudah titik tertentu, **membuang data yang tidak bisa dikembalikan** (§4).

---

## 0. Hal terpenting: rollback sekarang HAMPIR GRATIS, dan jendela itu akan tertutup

Dibaca dari live `CDPS SG` hari ini:

| | |
|---|---|
| `clients` | **0** |
| `transactions` · `installments` | **0** · **0** |
| `leads` | 6 — **semuanya data uji** (3 dibuat fixture O50, 3 residu C-03) |
| `master_services` | 32 (seed MSL, ada CSV sumbernya, bisa di-seed ulang kapan saja) |
| `employees` | 69 (59 aktif riil + 10 fixture nonaktif) — sumbernya HRIS, bisa disinkron ulang |

**Tidak ada satupun data bisnis yang hanya hidup di Supabase.** Artinya rollback hari ini =
mengarahkan pengguna kembali ke sistem lama. Bukan migrasi data, bukan rekonsiliasi.

**Yang menutup jendela ini bukan tanggal, melainkan satu peristiwa: transaksi riil pertama.**
Begitu ada `clients` + `transactions` riil di Supabase, rollback berubah sifat — ia menuntut
ekspor-impor mundur menyusuri rantai FK `LEAD → ATTEMPT → CLIENT → SERVICE → TRX → INST`,
dan **perkakas untuk itu sengaja tidak dibangun** (O47: `cmd/import` ditinggalkan, tidak diport).

> 🔴 **Konsekuensi yang harus dinyatakan terang-terangan:** sesudah transaksi riil pertama,
> **tidak ada rencana rollback yang jujur** selain "bangun dulu importer mundur yang belum
> pernah ada". Karena itu keputusan GO bukan *"apakah TS sudah siap"* saja — ia juga
> *"apakah kita menerima bahwa mulai saat itu jalan mundur praktis tertutup"*.
> Sebaiknya diputuskan sadar, bukan ditemukan belakangan.

---

## 1. Dua skenario yang sering tercampur — pisahkan dulu

| | **A — Rollback deployment** | **B — Rollback cutover** |
|---|---|---|
| Pemicu | Deploy TS baru rusak (regresi, 500, halaman blank) | Keputusan mundur dari stack TS secara keseluruhan |
| Kembali ke | Deployment TS **sebelumnya** | **Go + MySQL** (Railway) |
| Biaya | Menit | Hari + keputusan pemilik |
| Data | Tak tersentuh — DB sama | Dua DB berbeda; lihat §0 dan §4 |
| Frekuensi harapan | Wajar, bagian operasi normal | Sekali, atau tidak sama sekali |

Sebagian besar "rollback" yang akan benar-benar dibutuhkan adalah **A**. Skenario **B** adalah
yang membuat dokumen ini ada, tetapi jangan sampai A diperlakukan seberat B.

---

## 2. Skenario A — rollback deployment TS (murah, sering)

1. **Vercel → project `agency-app-api` → Deployments → deployment hijau terakhir → Promote to
   Production.** Sama untuk `web-internal`. Tidak menyentuh DB.
2. **Cek nyala:** `GET /api/healthz` ⇒ `200 {"status":"ok","service":"cdps-api"}`.
3. **Cek fungsional 5 menit:** jalankan workflow **C-03 deployment UAT** (`confirm_write: YA`,
   approve `c03-production`). Target **22/22 · 34/34 · 13/13**.
   ⚠️ Ia **menulis ke produksi** (§4 residu) — untuk verifikasi pasca-rollback itu sepadan,
   untuk iseng tidak.

**Batas skenario A yang gampang terlewat:** kalau deployment rusak itu **sudah menjalankan
migrasi**, mempromosikan build lama **tidak** membatalkan perubahan skema. Kode lama berjalan
di atas skema baru. Kalau perubahan skemanya aditif (kolom/tabel baru), biasanya aman; kalau
ia mengubah/menghapus, ini jadi skenario B untuk lapisan DB. **Tidak ada down migration di repo
(44 maju, nol mundur)** — jadi mundurnya skema selalu manual dan selalu butuh keputusan.

---

## 3. Skenario B — rollback cutover ke Go + MySQL

### 3.1 Prasyarat — **#1 dan #2 SUDAH TERPENUHI** (diperbarui PR #86, 2026-07-31)

| # | Prasyarat | Status |
|---|---|---|
| 1 | **Backup MySQL Railway** (butir #4) | ✅ **ADA & TERVERIFIKASI 4 LAPIS** — `cdps-mysql-railway-20260731T055157Z.sql.gz.enc`, sha256 `1b9ecffd…47cb3e`, tersimpan **di luar GitHub** oleh pemilik. Butir 6 gate GO `[x]`. Detail: `BACKUP_MYSQL_RAILWAY_REPORT_20260731.md` |
| 2 | **Verifikasi OQ-2**: `SELECT count(*)` per tabel MySQL | ✅ **TERVERIFIKASI** — run `30604816629`: **50 tabel · 239 baris**, dan **rantai FK jalur uang NOL** (`clients` 0 · `transactions` 0 · `installments` 0 · `services` 0 · `qualified_forms` 0). Bukan 3 tabel yang diminta, melainkan **50** |
| 3 | Konfirmasi **service Go di Railway masih hidup / masih bisa dihidupkan** | 🔶 belum diverifikasi — Railway di luar jangkauan Claude. **Tapi DB-nya terbukti hidup** (dump diambil darinya 2026-07-31 05:51 UTC) |
| 4 | Kredensial pengguna di sistem lama masih berlaku | 🔶 belum diverifikasi |

> Prasyarat #2 bukan formalitas. *"0 baris"* pada DB kosong **tidak bisa dibedakan** dari
> *"0 baris karena querynya salah"* — kesalahan yang sudah pernah terjadi (O41). Hitungan itu
> harus dilampirkan sebagai output, bukan diringkas jadi kalimat.
>
> **Cara batas itu ditutup:** skrip OQ-2 mencetak `DATABASE()`, **jumlah kolom per tabel**, dan
> `COUNT(*)` sungguhan (bukan taksiran `information_schema.table_rows`) **berdampingan** — tabel
> ber-23-kolom yang melaporkan 0 baris terbukti ada dan terbaca. Skrip **keluar exit 2** kalau
> `leads`/`clients`/`transactions` tidak ditemukan, jadi "0 karena querynya salah" tidak bisa
> lolos sebagai "0 karena kosong".

> 🔴 **Yang WAJIB dibaca sebelum §3.2 langkah 3.** Backup itu **tidak bisa dipulihkan apa
> adanya oleh `mysqldump` polos** — ketujuh trigger imutabilitas CDPS tersimpan dengan `;` di
> ujung badannya, sehingga dump mentah memicu `ERROR 1064 … near ' */'` dan restore **mati di
> tengah jalan**, sesudah sebagian tabel masuk. Berkas yang tersimpan **sudah diperbaiki** dan
> restore-nya **sudah dibuktikan** ke MySQL 8.4 kosong (50 tabel · 239 baris · 7 trigger
> identik). ⇒ **Pakai berkas yang tersimpan itu; jangan mengambil dump baru dengan `mysqldump`
> biasa** kecuali lewat `scripts/railway-mysql-backup.sh` yang memuat perbaikannya.

### 3.2 Urutan eksekusi (setelah prasyarat lengkap)

1. **Bekukan tulis di TS.** Cabut akses pengguna sebelum menyalin apa pun, supaya titik potongnya
   pasti. Mekanisme yang sudah terbukti: `set_employee_banned(<nik>, true)` massal — persis yang
   dipakai O50 hari ini, dan **reversibel** (`false` mengembalikan `status_aktif` + mencabut ban).
2. **Arsipkan keadaan Supabase apa adanya** — `pg_dump` penuh, disimpan di luar Supabase.
   Ini bukan untuk dipulihkan ke MySQL; ini supaya keputusan mundur tetap bisa diaudit nanti.
3. **Hidupkan kembali Go + MySQL** dari backup prasyarat #1.
4. **Rekonsiliasi delta** — 🔶 **TBD, dan inilah bagian yang paling mahal.** Isinya bergantung
   sepenuhnya pada §0: selama `clients` dan `transactions` **0**, langkah ini **kosong** dan
   rollback selesai di langkah 5. Begitu tidak nol lagi, langkah ini adalah proyek tersendiri.
5. **Arahkan pengguna kembali** (DNS/URL/bookmark) dan umumkan. Sebutkan eksplisit bahwa data
   yang dimasukkan ke CDPS TS sesudah titik beku **tidak ikut** kecuali langkah 4 dijalankan.

### 3.3 Yang TIDAK perlu dilakukan

- **Jangan hapus project Supabase `CDPS SG`.** Rollback ≠ pemusnahan. Biarkan nonaktif; ia bukti
  dan sekaligus jalan maju kalau keputusannya berbalik lagi.
- **Jangan roll back migrasi Supabase satu per satu.** Nol down migration; mencoba menyusunnya
  ad-hoc di bawah tekanan adalah cara membuat drift, bukan cara mundur (pelajaran O38).

---

## 4. Yang TIDAK BISA di-rollback — sadari sebelum, bukan sesudah

| Hal | Kenapa permanen |
|---|---|
| **Baris `audit_log`** | Aturan rumah #3: append-only, nol jalur UPDATE/DELETE. Termasuk 10 baris O50 hari ini dan 7 baris residu C-03. Mundur pun jejaknya tetap. |
| **Nomor ID yang sudah tercetak** | `PREFIX-YYYYMM-NNNN` **tidak pernah dipakai ulang**. `LEAD-202607-0006` tetap terpakai walau lead-nya dibersihkan. Counter tidak mundur. |
| **38 notifikasi `m14.performance.published`** | Sudah sampai ke 38 karyawan riil. Bisa ditandai terbaca, tidak bisa "tidak pernah terkirim". |
| **Ban GoTrue O50** | Reversibel secara teknis (`set_employee_banned(..., false)`), tapi **sesi yang sudah putus tidak kembali sendiri** — pemakainya harus login ulang. |
| **Kata sandi yang sudah diubah pengguna di CDPS TS** | Hidup di GoTrue, bukan di MySQL. Mundur ke Go = kembali ke kata sandi lama. Harus diumumkan, bukan dibiarkan jadi kejutan. |
| **Keputusan yang sudah tercatat** | `DECISIONS.md` append-only. Rollback melahirkan **entri baru**, tidak menghapus entri lama. |

---

## 5. Kapan rencana ini dipicu — dan siapa yang memicunya

Rollback **B** hanya dipicu oleh **PIC gate OQ-1: Yohan & Nerissa berdua**. Bukan oleh CI merah,
bukan oleh satu bug, bukan oleh Claude.

Kandidat pemicu yang masuk akal, sebagai bahan diskusi — **belum disetujui**:

- Cacat kelas data (kehilangan/kerusakan data yang tidak bisa dipulihkan dari log) yang tidak
  tertutup dalam **1×24 jam**.
- Celah otorisasi produksi yang tidak bisa ditambal cepat (kelas O37/O46) — perhatikan bahwa
  keduanya justru **ditemukan dan ditutup** sebelum GO, jadi ini kemungkinan, bukan ramalan.
- Ketidaktersediaan berulang di luar kendali (deployment/pooler) yang menghentikan operasi harian.

**Yang BUKAN pemicu:** satu halaman error, satu endpoint 500, satu regresi UI. Itu skenario A.

---

## 6. Sisa yang harus diisi

| # | Butir | Siapa | Memblokir |
|---|---|---|---|
| 1 | Backup MySQL Railway + simpan di luar Railway | **pemilik** | §3.1 #1 → seluruh skenario B |
| 2 | `SELECT count(*)` per tabel MySQL (lampirkan output apa adanya) | **pemilik** | §3.1 #2 · dekomisi Railway |
| 3 | Konfirmasi service Go masih bisa dihidupkan | **pemilik** | §3.1 #3 |
| 4 | Isi §3.2 langkah 4 begitu `clients`/`transactions` tidak nol lagi | Claude | — (nol sekarang) |
| 5 | **Putuskan sadar** bahwa GO menutup jalan mundur (§0) | **pemilik (OQ-1)** | gate GO |

> Begitu butir 1–3 selesai, berkas ini naik dari **draft** jadi **rencana yang bisa dijalankan**.
> Sebelum itu, jangan perlakukan ia sebagai jaring pengaman yang sudah terpasang.
