-- ============================================================================
-- PDT G1-09 sub-langkah 2b-ii — sesi 22, `G1-09-2BII-ADS-SEARCH` DITUTUP.
-- `HANDOFF_PDT_SESI21.md` §3.B: sample EKSPOR ASLI Fim Motor
-- (`Search-Ads-Overall-Data-*.csv`, header baris 8) membuktikan `Nama Iklan`
-- (identitas kampanye) dan `Biaya` (`pdt_fact_ads.biaya` NOT NULL) SUNGGUH
-- ADA di berkas ini — premis blocker lama ("nol kolom biaya/identitas") sudah
-- usang. `kolom_dipanen` `shopee_ads_search` dilebarkan mencerminkan koreksi
-- yang sama di `packages/core/src/pdt/modules.ts` (Rule G1-09: `pdt.registry.
-- test.ts` menegakkan kesetaraan TS ≡ DB). `Kata Pencarian` SENGAJA TIDAK
-- ditambahkan — bucket 3 (Q-6, isinya) masih DITAHAN, tapi kolomnya tetap
-- dibaca `ekstrakBarisShopeeAdsSearch` (@cdps/core) untuk membentuk
-- `kampanye_id` KOMPOSIT (identitas baris, bukan dimensi laporan baru).
--
-- `tanda_tangan_kolom` TIDAK berubah (`must: ['Kata Pencarian']`, sudah
-- benar sejak G1-02). `versi` SENGAJA TIDAK dinaikkan (pola sama migrasi
-- 20261019010000/20261020010000/20261021010000/20261022010000 —
-- `pdt.registry.test.ts` menegakkan versi === 1 untuk seluruh modul hari
-- ini).
-- ============================================================================
UPDATE pdt_parser_modul
   SET kolom_dipanen = ARRAY['Jumlah Klik', 'Konversi', 'Nama Iklan', 'Biaya']
 WHERE kode = 'shopee_ads_search';
