-- ============================================================================
-- PDT G1-09 sub-langkah 2b-ii — sesi 23. Pemilik menjawab tiga keputusan
-- tertunda `HANDOFF_PDT_SESI22.md` §2-4: C (diskon/flash_sale — "jalan
-- rekomendasi" MVP) dan D (shopee_video — "tidak ada" laporan per-video lain
-- di Shopee Seller Center). Lihat `docs/DECISIONS.md` 2026-09-14 untuk
-- rincian lengkap; migrasi ini mencerminkan koreksi yang sama di
-- `packages/core/src/pdt/modules.ts` (Rule G1-09: `pdt.registry.test.ts`
-- menegakkan TS ≡ DB).
--
-- `G1-09-2BII-DISKON-FLASHSALE-STRUKTUR` DITUTUP — `shopee_diskon`/
-- `shopee_flash_sale` dinyalakan dari `UNVERIFIED_SIGNATURE` ke tanda tangan +
-- kolomDipanen MVP sungguhan (agregat harian sheet "Kriteria Utama" SAJA —
-- sheet "Rincian Performa" per-promosi individual ditunda, HANDOFF_PDT_
-- SESI21.md §3.C opsi 2). Nol writer fact-table — sama seperti shopee_
-- voucher/shopee_chat/shopee_chat_broadcast/meta_ads, modul ini cuma perlu
-- parse_status='ok' + audit kolom.
--
-- `G1-09-2BII-SHOPEEVIDEO-GRAIN` DITUTUP — `shopee_video.wajib` diturunkan
-- true → false (deviasi PRD §7.2, disetujui pemilik langsung: Shopee Seller
-- Center TIDAK punya laporan per-video lain). `tanda_tangan_kolom`/`kolom_
-- dipanen` TIDAK berubah (tetap UNVERIFIED_SIGNATURE/kosong — berkas ini
-- secara struktural tidak bisa menulis apa pun, PR #380).
--
-- `versi` SENGAJA TIDAK dinaikkan (pola sama migrasi 20261019-20261023).
-- ============================================================================
UPDATE pdt_parser_modul
   SET tanda_tangan_kolom = '{"must": ["Tanggal", "Tipe Promosi"]}'::jsonb,
       kolom_dipanen = ARRAY[
         'Tanggal', 'Tipe Promosi', 'Penjualan (Pesanan Dibuat) (IDR)', 'Penjualan (Pesanan Siap Dikirim) (IDR)',
         'Pesanan (Pesanan Dibuat)', 'Pesanan (Pesanan Siap Dikirim)'
       ]
 WHERE kode = 'shopee_diskon';

UPDATE pdt_parser_modul
   SET tanda_tangan_kolom = '{"must": ["Periode Waktu", "Jumlah Produk Dilihat"]}'::jsonb,
       kolom_dipanen = ARRAY[
         'Periode Waktu', 'Penjualan (Pesanan Dibuat)(Rp)', 'Penjualan (Pesanan Siap Dikirim)(Rp)',
         'Pesanan (Pesanan Dibuat)', 'Pesanan (Pesanan Siap Dikirim)', 'Jumlah Produk Dilihat', 'Produk Diklik'
       ]
 WHERE kode = 'shopee_flash_sale';

UPDATE pdt_parser_modul
   SET wajib = false
 WHERE kode = 'shopee_video';
