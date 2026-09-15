-- CDPS — PDT G1-09-DETEKSI-PREAMBLE-AMBIGU (sesi 27): koreksi `pdt_parser_modul`
-- (seed G1-02) untuk `shopee_ams_afiliasi`, mencerminkan koreksi yang sama di
-- `packages/core/src/pdt/modules.ts` (docs/DECISIONS.md 2026-09-15, sesi 27) —
-- gerbang dual-home `pdt.registry.test.ts` (@cdps/db) menegakkan TS ≡ DB
-- untuk `tanda_tangan_kolom`, jadi baris ini WAJIB ikut berubah setiap
-- `tandaTanganKolom` TS berubah.
--
-- Sample EKSPOR ASLI (ZIP "Sample nama asli" pemilik) membuktikan
-- `Data+Keseluruhan+Iklan+Shopee-*.csv` (shopee_ads_cpc) dan
-- `Search-Ads-Overall-Data-*.csv` (shopee_ads_search) KEDUANYA cocok
-- `shopee_ams_afiliasi` juga (preamble Rule 2 baris `Username,<toko>`
-- memenuhi `anyOf`, header ber-'Omzet' memenuhi `must`) — `mustNot: ["ID
-- Toko"]` ditambahkan, pola sama `shopee_ams_produk` (`mustNot: ["ID
-- Affiliates"]`, migrasi 20261020010000): export AMS backend TERBUKTI tidak
-- pernah membawa baris preamble `ID Toko` (nol identitas toko), sedangkan
-- SEMUA laporan per-toko (ads_cpc/ads_search/ads_live/shop_stats/dst.)
-- selalu membawanya (Rule 2).
--
-- `versi` SENGAJA TIDAK dinaikkan (pola sama migrasi 20261019010000/
-- 20261020010000 — `pdt.registry.test.ts` menegakkan versi === 1 untuk
-- seluruh modul hari ini). Nol perubahan `kolom_dipanen`/`baris_header_hint`.
UPDATE pdt_parser_modul
   SET tanda_tangan_kolom = '{"must": ["Omzet"], "mustNot": ["ID Toko"], "anyOf": [{"must": ["Username"]}, {"must": ["Kreator"]}, {"must": ["Creator"]}]}'::jsonb
 WHERE kode = 'shopee_ams_afiliasi';
