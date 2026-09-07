-- ============================================================================
-- D-4 — perlakuan PPN jadi PILIHAN EKSPLISIT per transaksi.
--
-- Diketok pemilik 2026-09-07: *"Bruto dulu untuk harga; Sales/Finance yang
-- memilih kena PPN atau tidak. Nilai disimpan BRUTO; perlakuan PPN jadi pilihan
-- EKSPLISIT per transaksi. Mesin accrual TIDAK menghitung PPN sendiri — ia
-- menyimpan nilai bruto + penanda pilihan, manusia yang memilih."*
--
-- APA YANG BERUBAH, DAN APA YANG SENGAJA TIDAK.
--
-- YANG BERUBAH: satu kolom di `transactions`, tempat satu-satunya baris uang
-- per penjualan hidup (`sales.close` menulis tepat satu; `renewal.executeRenewal`
-- satu lagi per perpanjangan). Itu granularitas yang ketokan minta — "per
-- transaksi" — dan ia satu baris dengan `total_agreed_value`, angka yang
-- penanda ini menerangkan, jadi keduanya tidak bisa terpisah.
--
-- YANG SENGAJA TIDAK: `master_service_versions.apply_ppn` dan
-- `qualified_form_services.apply_ppn` DIBIARKAN apa adanya, termasuk fakta
-- bahwa `qualified_form_services.subtotal` sudah memuat PPN 11% saat flag-nya
-- menyala (`sales.computeSubtotal`). Keduanya adalah masukan KALKULATOR
-- PENAWARAN pra-negosiasi — dipin sebagai snapshot Qualified/Closing dan dipakai
-- menghitung Estimasi Nilai Transaksi M0. Mengubah perhitungannya sekarang akan
-- menggeser angka estimasi setiap attempt yang sudah tersimpan, dan ketokan D-4
-- tidak meminta itu. Jadi batasnya ditulis di sini supaya tidak ada yang
-- menyimpulkan sendiri: **katalog memberi SARAN untuk penawaran; kolom ini
-- mencatat KEPUTUSAN untuk transaksi.** Kalau keduanya berbeda, yang berlaku
-- adalah yang di sini, karena inilah satu-satunya yang seorang manusia pilih.
--
-- KENAPA NULLABLE TANPA DEFAULT. Ketokan memberi pilihannya kepada MANUSIA.
-- Sebuah `DEFAULT false`/`'tidak_kena'` akan menjawab pertanyaan itu untuk
-- mereka — diam-diam, untuk setiap transaksi yang belum pernah ditanyakan — dan
-- menghapus perbedaan antara "sudah diputuskan tidak kena" dan "belum ada yang
-- memutuskan". Itu aturan kerja #4, kelas yang sama dengan `0` vs `null`, dan
-- kelas yang sama yang melahirkan `pengakuan` di D-KOM. 11 transaksi yang sudah
-- ada di live karena itu bernilai NULL, dan itu JUJUR: tidak ada seorang pun
-- yang pernah memilih untuk mereka.
--
-- Aditif ⇒ boleh mendahului deploy kode (aturan urutan rilis §7): kolom baru
-- yang nullable, nol kolom yang di-rename/dihapus, nol backfill.
-- ============================================================================

ALTER TABLE transactions
    ADD COLUMN ppn_pilihan varchar(12) NULL;

ALTER TABLE transactions
    ADD CONSTRAINT ck_trx_ppn_pilihan
    CHECK (ppn_pilihan IS NULL OR ppn_pilihan IN ('kena', 'tidak_kena'));

COMMENT ON COLUMN transactions.ppn_pilihan IS
  'Perlakuan PPN transaksi ini sebagaimana DIPILIH manusia (ketokan D-4 2026-09-07): ''kena'' | ''tidak_kena'' | NULL = belum ada yang memilih. NULL BUKAN "tidak kena" — pilihannya milik Sales (saat Closing) atau Finance (saat menerbitkan invoice), dan membedakan "belum dipilih" dari "dipilih tidak kena" adalah seluruh alasan kolom ini nullable tanpa default. Nilai `total_agreed_value` di baris yang sama tetap BRUTO: sistem TIDAK menambah atau mengurangi PPN dari angka itu, dan mesin accrual tidak punya pendapat soal pajak sama sekali. Berbeda dari `master_service_versions.apply_ppn`/`qualified_form_services.apply_ppn`, yang adalah masukan KALKULATOR PENAWARAN pra-negosiasi (saran), bukan keputusan transaksi.';
