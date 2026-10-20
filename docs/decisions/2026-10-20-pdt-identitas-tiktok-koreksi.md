# 2026-10-20 — PDT identitas TikTok: hitung lintas berkas + koreksi `akun_konten_toko` dari batch ditolak

- **Tanggal:** 2026-10-20
- **Disetujui:** Yohan (owner)
- **Modul:** PDT (Pusat Data Toko), Rule 3-4 (`docs/prd/CDPS_PDT_Pusat_Data_Toko.md` §Rule 3-4)
- **Terkait:** G1-06 (identitas), G1-09-KONFIRMASI-IDENTITAS, P8/RC-6

## Konteks

Batch PDT #38 (Medikam, TikTok, Sep 2026) ditolak:
`[ID Kreator di berkas (7494549916237546503) tidak terdaftar di akun_konten_toko klien (7329668450138162177)]`.
Seluruh baris ekspor (`[bisnis]-Live` 49 baris, `[bisnis]-Video` 242 baris) ber-ID Kreator
`7494549916237546503`, jadi nilai terikat kemungkinan besar salah ikat atau akun lama. Rule 3-4
mengunci `akun_konten_toko` setelah terisi ("diisi sekali", "terikat permanen") dan aplikasi
tidak punya jalan untuk mengoreksi atau menambah akun kedua — tim Ads mentok.

Ditemukan juga bahwa `resolveIdentitas` (cabang TikTok) hanya membaca berkas pertama yang
membawa kolom `ID Kreator`, sehingga urutan berkas di ZIP bisa menentukan identitas batch.

## Keputusan

1. **ID Kreator terbanyak dihitung lintas SEMUA berkas TikTok di batch** yang modulnya memanen
   `ID Kreator` (`tt_video`, `tt_live`, dan modul berikutnya yang memanen kolom itu). Seri ⇒ nilai
   terkecil (urut string), deterministik. Berkas afiliasi (`tt_affiliate_video`) tidak dihitung
   karena milik kreator lain. `identitas_sumber` = `{ id_kreator, jumlah_baris, jumlah_berkas }`,
   dan kini juga disimpan saat verdict `tolak` (sebagai usulan koreksi).
2. **Rule 3-4 dilonggarkan untuk koreksi:** Lead Account atau Director (`permission.isLead(actor,
   'Account')`) boleh mengoreksi `akun_konten_toko` dari batch TikTok yang **ditolak karena
   identitas** (alasan `[ID Kreator di berkas (…) …]`), memakai usulan yang tersimpan di batch itu:
   - `tambah` — append ke array (tanpa duplikat), untuk akun konten kedua yang sah;
   - `ganti` — array diganti seluruhnya dengan usulan, untuk salah ikat/akun lama.
   Alasan wajib. Satu baris `audit_log` (`entity_type='client_platform'`,
   `action='akun_konten_toko_koreksi'`, before `{akun_konten_toko}`, after
   `{akun_konten_toko, mode, batch_id, alasan}`). Batch kemudian diproses ulang lewat jalur reparse
   yang sudah ada (sama seperti sesudah konfirmasi `identitas_belum_terikat`).
3. AM biasa dan divisi Ads **tidak** boleh mengoreksi (`ForbiddenError`). Konfirmasi satu-kali AM
   untuk `identitas_belum_terikat` tidak berubah.
4. Shopee (`shop_id`, Rule 2) **tidak** berubah.

## Alasan

Identitas tetap dibaca dari berkas (bukan diketik bebas) — koreksi hanya bisa memakai nilai yang
sistem baca dari ekspor batch yang ditolak, dibatasi ke Lead/Director, dengan alasan dan jejak
audit. Ini menjaga semangat Rule 3 (tidak ada pengetikan ulang identitas) sambil memberi jalan
keluar untuk salah ikat dan toko dengan lebih dari satu akun konten.

## Implementasi

Tanpa migrasi, tanpa tabel/endpoint baru: `kolomTerbanyakLintasBerkas` (`packages/core/src/pdt/identitas.ts`),
`resolveIdentitasDanSumber` + `konfirmasiIdentitasBatch` (param `koreksi`) di
`packages/domain/src/pdt.ts`, route `POST /account/pdt/batches/konfirmasi-identitas` menerima
`mode` + `alasan` opsional, dan tombol "Koreksi akun konten toko" di halaman Upload PDT.
