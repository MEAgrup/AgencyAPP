-- ===========================================================================
-- B2 — provenance benchmark untuk baseline SHOPEE di `riset_awal_analisa`.
--
-- MASALAHNYA. Sejak `metodeForPlatform('shopee')` menjadi `analisa_penuh`,
-- baris Shopee membawa `skor`. Tiga aturan lama lalu bertabrakan:
--
--   * `ck_analisa_provenance` menuntut `benchmark_versi IS NOT NULL` untuk
--     setiap baris ber-skor (aturan rumah #4 — skor yang tak bisa dihitung
--     ulang adalah skor yang bohong);
--   * `fk_analisa_benchmark` mengunci kolom itu ke `riset_awal_benchmark`,
--     yang isinya 16 ambang khas TikTok (`cr`, `vidPostToko`, `gpmToko`, …);
--   * ambang Shopee tinggal di tabelnya sendiri, `report_benchmark_shopee`.
--
-- Mengisi `benchmark_versi` dengan versi `riset_awal_benchmark` untuk baris
-- Shopee berarti MENCATAT AMBANG YANG TIDAK DIPAKAI. Itu bukan penyederhanaan,
-- itu provenance palsu — persis hal yang `ck_analisa_provenance` ada untuk
-- mencegah.
--
-- PRESEDENNYA SUDAH ADA. SH-01 (`20260909010000_sh01_shopee_report_engine.sql`)
-- menghadapi masalah yang identik di `client_reports` dan menjawabnya dengan
-- kolom kedua `benchmark_versi_shopee` + CHECK yang memaksa TEPAT SATU dari
-- keduanya terisi. Migrasi ini menerapkan pola yang sama ke `riset_awal_analisa`.
--
-- BARIS LAMA TIDAK TERSENTUH. Kolom baru NULL untuk semua baris yang sudah ada;
-- baris TikTok ber-skor tetap punya `benchmark_versi` terisi, jadi kedua CHECK
-- baru sudah benar untuk mereka tanpa satu UPDATE pun.
-- ===========================================================================

ALTER TABLE riset_awal_analisa
    ADD COLUMN benchmark_versi_shopee integer NULL
        REFERENCES report_benchmark_shopee (versi);

COMMENT ON COLUMN riset_awal_analisa.benchmark_versi_shopee IS
  'Versi report_benchmark_shopee yang dipakai mesin baseline Shopee (cdps.baseline.shopee.v1). Padanan benchmark_versi (yang menunjuk riset_awal_benchmark, ambang TikTok). Tepat SATU dari keduanya terisi — lihat ck_analisa_benchmark_xor.';

-- Provenance: baris ber-skor wajib menyebut ambang mana yang dipakainya —
-- salah satu dari dua tabel benchmark, bukan tidak sama sekali.
ALTER TABLE riset_awal_analisa
    DROP CONSTRAINT ck_analisa_provenance;

ALTER TABLE riset_awal_analisa
    ADD CONSTRAINT ck_analisa_provenance
        CHECK (
            skor IS NULL
            OR ((benchmark_versi IS NOT NULL OR benchmark_versi_shopee IS NOT NULL)
                AND parser_versi IS NOT NULL)
        );

-- ...dan tidak boleh menyebut KEDUANYA: satu skor dihitung dari satu set
-- ambang. Dua kolom terisi berarti pembaca hilir harus menebak yang mana.
ALTER TABLE riset_awal_analisa
    ADD CONSTRAINT ck_analisa_benchmark_xor
        CHECK (benchmark_versi IS NULL OR benchmark_versi_shopee IS NULL);
