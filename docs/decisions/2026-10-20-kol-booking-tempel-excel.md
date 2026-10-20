# 2026-10-20 — KOL: tempel/unggah Excel ke grid "Buat Booking Baru" (P9 / RC-8)

- **Tanggal:** 2026-10-20
- **Disetujui:** Yohan
- **Modul:** M9 KOL §4 (Creator Booking, entri batch)
- **Berkas:** `web-internal/src/lib/kol-booking-paste.ts` (+ `.test.ts`),
  `web-internal/src/app/(shell)/kol/briefs/[id]/page.tsx`

## Konteks

Tim KOL mengeluh input creator di "Buat Booking Baru" masih manual satu per
satu dan meminta bulk / upload Excel. Grid batch sebenarnya sudah ada (maks 20
baris), tetapi setiap sel harus diketik; tidak ada cara memasukkan daftar
creator dari spreadsheet yang sudah mereka pegang.

## Keputusan

1. **Tempel/unggah hanya MENGISI grid yang ada.** Tombol "Tempel dari Excel"
   (TSV dari Excel/Sheets), "Unggah Excel/CSV" (`.xlsx`/`.xls` sheet pertama,
   atau `.csv` koma/titik-koma), dan tautan "Unduh template" (CSV header saja,
   dibuat di klien). Tidak ada simpan otomatis: staff tetap memeriksa grid lalu
   menekan "Buat Booking", yang memanggil `createBooking` satu per baris secara
   sekuensial seperti sebelumnya, dengan perilaku error per baris yang sama.
2. **Tanpa endpoint baru, tabel baru, migrasi, atau jalur impor di backend.**
   Validasi wajib tetap milik domain `createBooking` (tidak diubah). Pra-cek
   klien (`validateRow`) dipindah — bukan disalin — ke `kol-booking-paste.ts`
   dan dipakai bersama oleh parser dan tombol submit.
3. **Kolom yang dibaca:** `Nama Creator`, `Handle`, `Niche`, `Agreed Rate`,
   `Qty Video`, `Qty Live`. Header opsional, dicocokkan tanpa peduli huruf
   besar/kecil, spasi, tanda baca, dan akhiran "(Rp)"; tanpa header, urutan
   kolom = urutan di atas. **Platform, Source Pool, dan Coordinator TIDAK dibaca
   dari berkas** — tetap satu per brief (M9 §4).
4. **Rate** `Rp 1.500.000` / `1.500.000` / `1500000` / `1.500.000,00` /
   `1,500,000.00` dinormalisasi ke string desimal `money.parse` (`1500000`).
   Teks yang tidak dikenali dibiarkan apa adanya supaya ditolak dengan pesan
   baku `[agreed rate wajib diisi & lebih dari 0]`.
5. **Baris yang gagal validasi tetap dimasukkan ke grid** dengan pesannya
   ("Baris N di Excel: …"), supaya staff memperbaikinya di tempat alih-alih
   mengetik ulang. Nomor baris = nomor baris data (1 = baris pertama sesudah
   header). Baris kosong dilewati.
6. **Batas baris per simpan dinaikkan dari 20 menjadi 50** (`BATCH_MAX = 50`).
   Baris terisi (valid atau tidak) memakan kapasitas; kelebihannya ditolak
   dengan satu pesan `[melebihi batas 50 baris per simpan — N baris mulai baris X
   tidak dimasukkan]`. Alasan angka 50: cukup untuk satu daftar campaign KOL
   biasa dalam sekali simpan, sementara submit tetap sekuensial (satu request
   per baris) sehingga waktu tunggu dan beban API masih wajar; daftar lebih
   besar dipecah per 50.

## Di luar cakupan

Endpoint bulk booking di backend, impor Google Sheets lewat URL, dan perubahan
validasi/aturan `createBooking`.
