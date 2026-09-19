-- =============================================================================
-- G3-06 · `tipeKampanye` (Section B-5.3) bersumber FAKTA, bukan ketikan AM
--
-- KENAPA KOLOM INI BARU ADA SEKARANG. Sesi 40 menutup G3-06 "sebagian" dan
-- SENGAJA menunda `tipeKampanye`: backlog menyarankan `distinct pdt_fact_ads.sumber`,
-- tapi `sumber` adalah NAMA MODUL PARSER (`shopee_ads_cpc`/`tt_ads_product`/…),
-- bukan konfigurasi kampanye — satu berkas ekspor memuat beberapa tipe kampanye
-- sekaligus. Memetakan nama modul → tipe kampanye akan MENGARANG klasifikasi.
--
-- Yang berubah: tiga ZIP sample pemilik (sesi 43, 12 klien nyata) membuktikan
-- ekspornya MEMANG membawa kolom konfigurasi kampanye yang selama ini tidak
-- pernah dipanen:
--
--   shopee_ads_cpc     `Mode Bidding`        'GMV Max ROAS' | 'GMV Max Auto Bidding (Shop)' | 'GMV Max Auto'
--   shopee_ads_search  `Mode Bidding`        'Bidding Manual' | 'Bidding Otomatis'
--   shopee_ads_live    `Tujuan`              'Live GMV Max Auto' | 'Live GMV Max ROAS' | 'Tingkatkan Jumlah Penonton'
--   tt_ads_product     `Jenis materi iklan`  'Video' | 'Kartu produk'
--   tt_ads_live        —                     (identitas modul: seluruh berkasnya kampanye LIVE)
--
-- YANG DISIMPAN DI SINI ADALAH TEKS MENTAHNYA, BUKAN NILAI TAKSONOMI.
-- `CAMPAIGN_TYPES` (gmv_max/manual_keyword/auto/live_ads/video_ads/affiliate_ads/
-- lainnya) hidup di `packages/domain` dan penyaringnya sudah ada di sana —
-- `packages/core/src/baseline/section-b.ts` mencatat alasannya: "taksonomi tidak
-- punya dua rumah". Menyimpan hasil pemetaan di kolom ini akan membuat rumah
-- kedua di DB, dan setiap koreksi pemetaan akan menuntut reparse SELURUH batch.
-- Menyimpan mentahnya membuat pemetaan bisa dikoreksi tanpa menyentuh data —
-- sekaligus menjaga aturan rumah #4 ("selalu bisa dihitung ulang dari log").
--
-- Nullable TANPA default: `NULL` berarti "berkas ini tidak membawa kolomnya"
-- (mis. seluruh baris lama sebelum migrasi ini, dan `meta_ads`), yang BEDA dari
-- string kosong "kolomnya ada tapi selnya kosong". Absen ≠ nol, pola sama
-- seluruh kolom fakta PDT lain.
-- =============================================================================

ALTER TABLE pdt_fact_ads
  ADD COLUMN tipe_kampanye_sumber text NULL;

COMMENT ON COLUMN pdt_fact_ads.tipe_kampanye_sumber IS
  'Teks MENTAH konfigurasi kampanye dari berkas (Mode Bidding / Tujuan / Jenis materi iklan), '
  'apa adanya. Pemetaan ke taksonomi CAMPAIGN_TYPES dilakukan di packages/domain saat DIBACA — '
  'sengaja TIDAK disimpan di sini supaya taksonomi tidak punya rumah kedua dan koreksi pemetaan '
  'tidak menuntut reparse. NULL = berkas sumbernya tidak membawa kolom ini.';
