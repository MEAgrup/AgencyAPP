-- CDPS — M6A B-6.2: % GMV affiliate = GMV-share yang TUMPANG-TINDIH, bisa >100%.
--
-- ## Kenapa (owner QA 2026-08-23, DECISIONS.md — lanjutan b23 traffic overlap)
-- `gmv_affiliate_persen` (B-6.2) dihitung Video Factory sebagai
--   affGmv / totGMV * 100
-- di mana `affGmv` adalah SUM GMV dari export **Transaction Creator** (affiliate)
-- dan `totGMV` adalah GMV total channel dari export toko. Kedua angka datang dari
-- SUMBER BERBEDA dan atribusinya TUMPANG-TINDIH: satu order lewat kreator afiliasi
-- ikut terhitung di GMV toko DAN di GMV affiliate, jadi untuk seller yang berat di
-- afiliasi (mis. EVEBAG) rasionya wajar melewati 100% (over-attribution) — persis
-- alasan yang sama yang membuat aturan Σ=100% komposisi trafik B-2.3 dicabut di
-- `20260822010000_b23_traffic_overlap.sql`.
--
-- Sampai sekarang batas atas 100 masih dipaksakan di DUA tempat: CHECK
-- `ck_strch_persen_range` (dinding) dan `validateChannelBaselineShape` (pesan BI).
-- Akibatnya paste "Tempel dari Video Factory" dengan afiliasi >100% melempar
-- `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]` dan
-- MENGGAGALKAN SELURUH simpan Section B — draft yang mestinya scratchpad malah
-- kehilangan seluruh pekerjaan gara-gara satu angka share yang justru benar.
--
-- ## Yang diubah (hanya MELONGGARKAN batas atas B-6.2 — tidak menyentuh yang lain)
-- DROP + re-ADD `ck_strch_persen_range` (didefinisikan ulang oleh b23) dengan satu
-- perubahan: `gmv_affiliate_persen` kini `>= 0` saja (share GMV-overlap, boleh
-- >100%), bukan lagi `BETWEEN 0 AND 100`. numeric(6,2) tetap membatasi kewarasan
-- di 9999,99. SEMUA persen lain TETAP 0–100 (CR, listing layak, chat response,
-- pesanan terlambat, beban promo, komisi open/target) — hanya B-6.2 yang dilepas,
-- persis pola enam bucket trafik. Konsistensi SKU (b3), rating 0–5, dan enum tetap
-- utuh; kelengkapan tetap ditegakkan di gerbang submit (`checkCompleteness`).

ALTER TABLE strategi_channel DROP CONSTRAINT IF EXISTS ck_strch_persen_range;
ALTER TABLE strategi_channel
    -- Persen non-trafik TETAP 0–100. Enam bucket trafik `>= 0` (GMV-share
    -- tumpang-tindih, b23). B-6.2 `gmv_affiliate_persen` kini IKUT `>= 0` saja:
    -- share affiliate lintas-export bisa >100% (over-attribution). numeric(6,2)
    -- membatasi kewarasan di 9999,99.
    ADD CONSTRAINT ck_strch_persen_range CHECK (
        (conversion_rate_persen    IS NULL OR (conversion_rate_persen    BETWEEN 0 AND 100))
    AND (listing_layak_persen      IS NULL OR (listing_layak_persen      BETWEEN 0 AND 100))
    AND (chat_response_rate_persen IS NULL OR (chat_response_rate_persen BETWEEN 0 AND 100))
    AND (pesanan_terlambat_persen  IS NULL OR (pesanan_terlambat_persen  BETWEEN 0 AND 100))
    AND (beban_promo_persen        IS NULL OR (beban_promo_persen        BETWEEN 0 AND 100))
    AND (komisi_open_persen        IS NULL OR (komisi_open_persen        BETWEEN 0 AND 100))
    AND (komisi_target_persen      IS NULL OR (komisi_target_persen      BETWEEN 0 AND 100))
    AND (gmv_affiliate_persen      IS NULL OR gmv_affiliate_persen       >= 0)
    AND (trafik_organik_persen     IS NULL OR trafik_organik_persen      >= 0)
    AND (trafik_iklan_persen       IS NULL OR trafik_iklan_persen        >= 0)
    AND (trafik_affiliate_persen   IS NULL OR trafik_affiliate_persen    >= 0)
    AND (trafik_live_persen        IS NULL OR trafik_live_persen         >= 0)
    AND (trafik_video_persen       IS NULL OR trafik_video_persen        >= 0)
    AND (trafik_luar_persen        IS NULL OR trafik_luar_persen         >= 0));

COMMENT ON COLUMN strategi_channel.gmv_affiliate_persen IS
  'M6A B-6.2 (revisi 2026-08-23) — % GMV dari affiliate = GMV-share TUMPANG-TINDIH '
  'lintas-export (affGmv Transaction Creator / totGMV toko). Boleh >100% '
  '(over-attribution), seperti komposisi trafik B-2.3; tidak dipangkas.';
