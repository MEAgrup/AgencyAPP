-- ============================================================================
-- PDT — `pdt_fact_content` mendapat kolom `periode` (sesi 34, riset G2-01).
--
-- Ketokan pemilik (`AskUserQuestion`, opsi "Tambah kolom periode sekarang"):
-- lihat `docs/DECISIONS.md` untuk konteks lengkap.
--
-- Masalah: `pdt_fact_content` (video/live TikTok+Shopee) adalah SATU-SATUNYA
-- tabel fakta G1-01 tanpa kolom periode — kuncinya `(client_platform_id,
-- platform_content_id)`, murni identitas konten, BEDA dari `pdt_fact_ads`/
-- `pdt_fact_sku_period`/`pdt_fact_creator_period` yang semuanya sudah
-- `periode` sejak lahir. Akibatnya: video/sesi live yang GMV-nya masih
-- berjalan di periode BERIKUTNYA akan menimpa baris periode SEBELUMNYA lewat
-- `ON CONFLICT DO UPDATE` — bertentangan langsung dengan premis G2-01/PDT-21
-- ("laporan = view atas fakta yang bisa dihitung ulang KAPAN PUN", Rule 21).
--
-- Aman dilakukan SEKARANG (nol backfill berisiko): tabel ini genuinely KOSONG
-- di produksi — G1 belum lulus gerbang keluar (≥10 klien nyata `verified`,
-- `docs/backlog/PDT_BACKLOG.md` §1), jadi nol baris nyata bergantung pada
-- bentuk kunci lama.
--
-- `periode` — AWAL BULAN, pola SAMA `pdt_fact_ads`/`pdt_fact_creator_period`
-- (Q-3, `docs/DECISIONS.md` 2026-09-13: partisi bulanan nanti = DDL murni,
-- bukan tanggal presisi apa adanya dari berkas).
-- ============================================================================

ALTER TABLE pdt_fact_content
  ADD COLUMN periode date NULL;

COMMENT ON COLUMN pdt_fact_content.periode IS
  'Awal bulan batch yang menulis baris ini (Q-3, pola sama pdt_fact_ads/pdt_fact_creator_period) — '
  'BUKAN waktu_posting konten itu sendiri. Mencegah video/sesi live yang GMV-nya masih berjalan di '
  'periode berikutnya menimpa baris periode sebelumnya (Rule 21/PDT-21: laporan harus bisa dihitung '
  'ulang untuk periode MANA PUN, bukan hanya periode commit terakhir).';

-- Tabel genuinely kosong hari ini (G1 belum lulus gerbang ≥10 klien nyata) — backfill di bawah
-- murni jaga-jaga (pola sama migrasi 20261025010000), bukan mengasumsikan kekosongan.
DO $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM pdt_fact_content WHERE periode IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'pdt_fact_content: % baris lama tanpa periode — backfill manual dibutuhkan sebelum NOT NULL', n;
  END IF;
END $$;

ALTER TABLE pdt_fact_content
  ALTER COLUMN periode SET NOT NULL;

DROP INDEX uq_pdt_fact_content;
CREATE UNIQUE INDEX uq_pdt_fact_content ON pdt_fact_content (client_platform_id, platform_content_id, periode);
