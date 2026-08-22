-- CDPS — M6A B-2.3: komposisi trafik = GMV-share platform (TUMPANG-TINDIH),
-- bukan lagi partisi yang wajib berjumlah 100%.
--
-- ## Kenapa
-- Data yang diberikan platform (TikTok Shop `product_list` breakdown per bucket)
-- adalah **GMV-share yang saling tumpang-tindih**: satu order lewat video afiliasi
-- dihitung di bucket Video DAN Affiliate; Iklan adalah **overlay** yang nempel di
-- video/live/kartu (klik 7 hari), jadi sh-nya bisa >100% (over-attribution wajar).
-- Memaksa enam bucket berjumlah 100% (±0,5) berarti angka baseline harus dikarang
-- ulang oleh AM supaya "pas" — justru menghapus sinyal tumpang-tindih yang ingin
-- kita lihat di report. Keputusan pemilik (DECISIONS 2026-08-22): biarkan tool
-- mengisi B-2.3 **apa adanya**, form menerima tanpa menolak.
--
-- ## Yang diubah (hanya MELONGGARKAN — tidak menyentuh data, tidak menghapus kolom)
--   1. DROP `ck_strch_trafik_total` — aturan "semua kosong ATAU semua terisi &
--      berjumlah 100 ±0,5". Komposisi kini informasional, boleh timpang-tindih.
--   2. Enam kolom trafik: batas atas 100 dilepas (overlay/afiliasi bisa >100%);
--      tetap `>= 0` (share negatif tak bermakna). Field persen lain (CR, rating,
--      dst.) TETAP 0–100 — cuma enam bucket trafik yang dilonggarkan.
--   3. Kolom keenam `trafik_luar_persen` kini memuat bucket **Kartu Produk**
--      (klik kartu produk di feed) — label form berubah, nama kolom tetap demi
--      menghindari rename lintas-lapis. Lihat COMMENT di bawah.

ALTER TABLE strategi_channel DROP CONSTRAINT IF EXISTS ck_strch_trafik_total;

ALTER TABLE strategi_channel DROP CONSTRAINT IF EXISTS ck_strch_persen_range;
ALTER TABLE strategi_channel
    -- Persen non-trafik: tetap 0–100. Enam bucket trafik: hanya `>= 0` (GMV-share
    -- tumpang-tindih; Iklan overlay bisa >100%). numeric(6,2) sudah membatasi
    -- kewarasan di 9999,99.
    ADD CONSTRAINT ck_strch_persen_range CHECK (
        (conversion_rate_persen    IS NULL OR (conversion_rate_persen    BETWEEN 0 AND 100))
    AND (listing_layak_persen      IS NULL OR (listing_layak_persen      BETWEEN 0 AND 100))
    AND (chat_response_rate_persen IS NULL OR (chat_response_rate_persen BETWEEN 0 AND 100))
    AND (pesanan_terlambat_persen  IS NULL OR (pesanan_terlambat_persen  BETWEEN 0 AND 100))
    AND (gmv_affiliate_persen      IS NULL OR (gmv_affiliate_persen      BETWEEN 0 AND 100))
    AND (beban_promo_persen        IS NULL OR (beban_promo_persen        BETWEEN 0 AND 100))
    AND (komisi_open_persen        IS NULL OR (komisi_open_persen        BETWEEN 0 AND 100))
    AND (komisi_target_persen      IS NULL OR (komisi_target_persen      BETWEEN 0 AND 100))
    AND (trafik_organik_persen     IS NULL OR trafik_organik_persen      >= 0)
    AND (trafik_iklan_persen       IS NULL OR trafik_iklan_persen        >= 0)
    AND (trafik_affiliate_persen   IS NULL OR trafik_affiliate_persen    >= 0)
    AND (trafik_live_persen        IS NULL OR trafik_live_persen         >= 0)
    AND (trafik_video_persen       IS NULL OR trafik_video_persen        >= 0)
    AND (trafik_luar_persen        IS NULL OR trafik_luar_persen         >= 0));

COMMENT ON COLUMN strategi_channel.trafik_luar_persen IS
  'M6A B-2.3 (revisi 2026-08-22) — bucket keenam komposisi trafik: kini memuat '
  'GMV-share Kartu Produk (klik kartu produk di feed). Label form: "Kartu Produk". '
  'Nama kolom dipertahankan (bukan rename) demi menghindari migrasi lintas-lapis. '
  'Komposisi = GMV-share platform yang tumpang-tindih; TIDAK wajib berjumlah 100%.';
