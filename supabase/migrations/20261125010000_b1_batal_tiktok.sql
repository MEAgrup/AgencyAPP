-- ============================================================================
-- B1-BATAL-TIKTOK — `% Batal` B-1 untuk TikTok Shop (docs/DECISIONS.md
-- 2026-09-20, ketokan pemilik: "jalankan termasuk persen batal tiktok").
--
-- Dua hal dalam satu migrasi karena keduanya satu fitur yang sama:
--   (1) kolom baru `pdt_fact_shop_daily.pesanan_penyebut_batal`
--   (2) `pdt_parser_modul.kolom_dipanen` `tt_orders` += 'Created Time'
--
-- ---------------------------------------------------------------------------
-- KENAPA ADA KOLOM PENYEBUT SENDIRI
--
-- `pesanan_dibatalkan` sudah ada sejak `20261105010000` (G2-01, Shopee). Di
-- Shopee pembilang dan penyebutnya datang dari BERKAS YANG SAMA — satu sheet
-- `shopee_shop_stats` membawa `Pesanan` dan `Pesanan Dibatalkan` berdampingan —
-- jadi `pesanan` adalah penyebut yang benar dan tidak perlu kolom tambahan.
--
-- Di TikTok tidak begitu. Pembilangnya hanya ada di `tt_orders` (`Order Status`
-- = `Dibatalkan`), sedangkan `pdt_fact_shop_daily.pesanan` ditulis berkas LAIN
-- (`tt_shop_analytics`). Keduanya BUKAN populasi yang sama — diverifikasi ke
-- ekspor asli Avitaskin Juli 2026, dua berkas dari ZIP yang sama:
--
--     Shop Analytics "Pesanan" Juli ......... 143
--     tt_orders, Order ID unik, dibuat Juli . 169   (115 Selesai, 50 Dibatalkan, 4 Dikirim)
--     tt_orders, non-batal .................. 119
--
-- 143 bukan 169 dan bukan 119, dan selisih HARIANNYA berayun dua arah
-- (01/07 +3, 20/07 −3) — jadi `Pesanan` Shop Analytics bukan sekadar "169
-- dikurangi yang batal", melainkan populasi lain dengan atribusi tanggal lain.
-- Memakainya sebagai penyebut melahirkan `% batal` harian yang keliru dan satu
-- angka bulanan yang hanya kebetulan dekat: 50/143 = 34,97% vs 50/169 =
-- **29,59%** yang sebenarnya.
--
-- Jadi pembilang dan penyebut HARUS dari berkas yang sama. Kolom ini menyimpan
-- penyebut versi `tt_orders`, dan pembacanya memakai
-- `coalesce(pesanan_penyebut_batal, pesanan)` — per BARIS, sehingga Shopee
-- (kolom ini NULL) tetap memakai `pesanan` seperti sebelumnya tanpa satu pun
-- perubahan perilaku.
--
-- Kolom `pesanan` SENGAJA tidak disentuh penulis TikTok: ia milik
-- `tt_shop_analytics`, dibaca B-1 (`jumlahPesanan`) dan rekonsiliasi Rule 13-14.
-- Menimpanya = dua sumber kebenaran untuk satu kolom.
--
-- ---------------------------------------------------------------------------
-- KENAPA 'Created Time' DAN BUKAN 'Cancelled Time'
--
-- Yang diukur B-1 adalah "dari pesanan yang MASUK hari itu, berapa persen
-- batal" — satu populasi, satu hari. `Cancelled Time` mencampur populasi
-- (pesanan Juni yang batal di Juli) dan, di berkas ini, memindahkan 4 pesanan
-- Juli ke Agustus karena batalnya terjadi setelah periode berakhir.
-- `Cancelled Time` karena itu TIDAK dipanen sama sekali — nol konsumen, dan
-- memanen kolom tanpa konsumen adalah skema spekulatif (aturan yang sama
-- dipakai `20261105010000` saat menolak `'Penjualan Dibatalkan'`).
--
-- `'Created Time'` ikut `kolom_opsional` DENGAN SENGAJA, alasan persis sama
-- `20261123010000`/`20261124010000`: `tt_orders` modul `wajib`, jadi kolom
-- wajib yang hilang menjatuhkan berkas ke `parse_status='gagal'`, membuangnya
-- dari `terparse`, dan menutup pintu upload seluruh batch.
--
-- `versi` SENGAJA TIDAK dinaikkan — `packages/db/src/pdt.registry.test.ts`
-- menegakkan `versi === 1` untuk SELURUH modul. Yang naik `PDT_PARSER_VERSI`
-- (kode, 3 → 4), supaya tick reparse G1-11 menyapu batch lama.
-- ============================================================================

ALTER TABLE pdt_fact_shop_daily
  ADD COLUMN pesanan_penyebut_batal integer NULL;

COMMENT ON COLUMN pdt_fact_shop_daily.pesanan_penyebut_batal IS
  'Cacah pesanan hari itu menurut SUMBER YANG SAMA dengan pesanan_dibatalkan — penyebut '
  '% batal, dipakai hanya saat pembilangnya datang dari berkas yang BERBEDA dari kolom '
  '"pesanan". Diisi penulis TikTok (tt_orders, basis ''net''); NULL untuk Shopee, yang '
  'pembilang dan penyebutnya satu sheet sehingga "pesanan" sudah benar. Pembaca memakai '
  'coalesce(pesanan_penyebut_batal, pesanan) PER BARIS. NULL BUKAN berarti nol pesanan '
  '(G1-03 tiga-keadaan).';

UPDATE pdt_parser_modul
   SET kolom_dipanen = ARRAY[
         'Order ID','SKU ID','Seller SKU','Product Name','Variation','Quantity',
         'SKU Unit Original Price','SKU Subtotal After Discount','Order Status','Paid Time',
         'Product Category','Creator Handle','Created Time'
       ],
       kolom_opsional = ARRAY['Created Time']
 WHERE kode = 'tt_orders';

-- Gerbang CI — nol perubahan struktural (satu kolom NULLABLE di tabel yang sudah ada):
--   public base tables : nol tabel baru
--   entity_prefix      : nol prefix baru
--   sm_machines        : nol lifecycle baru
--   notif_events       : nol event notifikasi baru
