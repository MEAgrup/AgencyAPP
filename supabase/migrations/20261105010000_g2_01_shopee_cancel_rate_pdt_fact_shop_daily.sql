-- G2-01-SHOPEE-CANCEL-REPEAT-RATE (separuh — hanya cancelRate, repeatRate DITUNDA
-- sengaja, keputusan pemilik via AskUserQuestion sesi ini).
--
-- `pesanan_dibatalkan` (harian, per basis) — konsumen: `PdtSkorInputPesananDibuatShopee.
-- cancelRate` (`packages/core/src/pdt/skor.ts`), dihitung pemanggil sebagai rasio
-- Σ pesanan_dibatalkan / Σ pesanan basis 'dibuat' satu periode (ratio-of-sums, BUKAN
-- rata-rata rasio harian — pola sama `cr`/Rule cvr toko). Kolom `'Pesanan Dibatalkan'`
-- SUDAH terverifikasi ada di sample asli sejak sesi 27 (`shopee_shop_stats.kolomDipanen`,
-- `modules.ts`) — hanya `pdt_fact_shop_daily` yang belum punya kolomnya (skema G1-01
-- dirancang sebelum kolom ini terverifikasi ada), dicatat `docs/backlog/PDT_BACKLOG.md`.
--
-- `'Penjualan Dibatalkan'` (nilai Rp, BUKAN hitungan pesanan) SENGAJA TIDAK ditambah di
-- migrasi ini — `cancelRate` mesin lama (`report/shopee/skor.ts` `scoreConv`) HANYA
-- memakai hitungan pesanan (`k.batal_pesanan / k.pesanan`), nol konsumen untuk nilai
-- Rupiah-nya hari ini. Menambah kolom tanpa konsumen adalah skema spekulatif — akan
-- ditambah begitu ada pemakainya, bukan sekarang.
--
-- `repeatRate` ('Tingkat Pembelian Berulang') SENGAJA TIDAK disentuh migrasi ini —
-- metrik itu "pembeli unik yang membeli >1x SELAMA SATU PERIODE PENUH", TIDAK bisa
-- direkonstruksi dari Σ/rata-rata baris HARIAN (satu pembeli yang muncul di dua hari
-- berbeda tidak bisa dideteksi "repeat" dari baris harian terpisah — beda kelas
-- metrik dari cr/cancelRate yang aditif). Shopee sendiri hanya menyediakan SATU angka
-- per periode (baris ringkasan sheet, bukan turunan harian) — `pdt_fact_shop_daily`
-- yang skemanya PER HARI bukan "rumah" yang tepat untuknya. Keputusan pemilik (via
-- `AskUserQuestion` sesi ini): tunda sampai pola penyimpanan metrik per-periode
-- (bukan per-hari) diputuskan lebih matang — kemungkinan dipakai bersama
-- `G2-01-SHOPEE-KESEHATAN-WRITER` (skor Kesehatan Toko kemungkinan juga per-periode)
-- supaya tidak ada dua solusi berbeda untuk kelas masalah yang sama. Dicatat
-- `docs/DECISIONS.md`/`docs/backlog/PDT_BACKLOG.md`, TIDAK ditutup migrasi ini.

ALTER TABLE pdt_fact_shop_daily
  ADD COLUMN pesanan_dibatalkan integer NULL;

COMMENT ON COLUMN pdt_fact_shop_daily.pesanan_dibatalkan IS
  'Σ harian "Pesanan Dibatalkan" (Shopee, basis apa pun yang menuliskannya — konsumen '
  'sesungguhnya hanya basis ''dibuat''). Konsumen: PdtSkorInputPesananDibuatShopee.cancelRate '
  '(rasio Σ/Σ terhadap pesanan, dihitung pemanggil). NULL = kolom sumber tidak terbaca di '
  'baris ini, BUKAN nol pesanan dibatalkan sungguhan (G1-03 tiga-keadaan).';

-- Gerbang CI — nol perubahan struktural (satu kolom NULLABLE di tabel yang sudah ada):
--   public base tables : 181 → 181 (nol tabel baru)
--   entity_prefix      : 45 → 45  (nol prefix baru)
--   sm_machines        : 35 → 35  (nol lifecycle baru)
--   notif_events       : 76 → 76  (nol event notifikasi baru)
