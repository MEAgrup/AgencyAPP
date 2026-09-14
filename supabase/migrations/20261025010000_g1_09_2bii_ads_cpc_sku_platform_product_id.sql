-- ============================================================================
-- PDT G1-09 sub-langkah 2b-ii — `G1-09-2BII-ADS-CPC-SKU` DITUTUP sesi 23.
-- Pemilik menjawab (`HANDOFF_PDT_SESI22.md` §2, opsi A): "Kebutuhan hanya GMV
-- per produk bukan sampai varian" — opsi 3 (rekomendasi) dipilih. Lihat
-- `docs/DECISIONS.md` 2026-09-14 untuk rincian lengkap.
--
-- Masalah: `pdt_fact_ads`/`pdt_fact_sku_period` berkunci PER VARIAN (`sku_id`
-- → `pdt_sku_master`), tapi `shopee_ads_cpc` dan modul KEDELAPAN kandidat
-- `shopee_ams_produk` hanya punya identitas level PRODUK INDUK (`Kode
-- Produk`/`Kode Item`) — satu produk bisa punya banyak varian, memaksa
-- `sku_id` ke salah satu akan mengarang atribusi (persis kelas kesalahan
-- Rule 13-16 dirancang mencegah).
--
-- Solusi: `platform_product_id` — kolom IDENTITAS SALINAN LANGSUNG (bukan
-- lookup/FK, disengaja — `pdt_sku_master` berkunci per varian, tidak ada
-- baris "level produk" untuk di-FK-kan), `sku_id` tetap NULL untuk baris yang
-- sumbernya level produk-induk. Lebar `varchar(128)` MENCERMIN
-- `pdt_sku_master.platform_product_id` (identitas SUMBER yang sama, disalin
-- — bukan angka 64 arbitrer draf awal).
--
-- 1. `pdt_fact_ads.platform_product_id` — tabel ini SUDAH punya
--    `client_platform_id` sendiri, jadi RLS-nya TIDAK berubah.
-- 2. `pdt_fact_sku_period.platform_product_id` — tabel ini TIDAK punya
--    `client_platform_id` (RLS-nya `jwt_owns_pdt_sku_am(sku_id)`, resolve
--    lewat `pdt_sku_master`). Baris level-produk punya `sku_id = NULL`, jadi
--    RLS lama akan SELALU false untuk baris itu (kebocoran akses, bukan
--    longgar tapi SEMPIT — AM pemilik toko sendiri pun tidak akan melihat
--    barisnya). Solusinya: tambah `client_platform_id` LANGSUNG ke tabel ini
--    (didenormalisasi dari konteks batch yang SELALU diketahui pemanggil,
--    sama pola `pdt_fact_ads`/`pdt_fact_creator_period`), backfill dari
--    `pdt_sku_master` untuk baris lama (nol baris hari ini — "NOL penulis"
--    per `HANDOFF_PDT_SESI21.md` §1 — tapi migrasi tetap menulis backfill
--    generik, bukan mengasumsikan tabel kosong), lalu NOT NULL. RLS diganti
--    memakai kolom ini LANGSUNG (`jwt_owns_client_platform_am`), sama pola
--    `pdt_fact_ads` — `jwt_owns_pdt_sku_am` dibiarkan ada (masih benar untuk
--    baris ber-`sku_id`) tapi tidak lagi satu-satunya jalur.
-- 3. `sku_id` dilonggarkan NULLABLE + CHECK `sku_id IS NOT NULL OR
--    platform_product_id IS NOT NULL` (identitas TIDAK BOLEH kosong dua-
--    duanya — baris tanpa identitas apa pun bukan baris yang sah).
-- 4. `uq_pdt_fact_sku_period` LAMA (`sku_id, periode, basis`) TIDAK aman
--    untuk baris `sku_id IS NULL` (Postgres: NULL≠NULL, unique index tidak
--    pernah mencegah duplikat) — diganti DUA index PARSIAL: satu untuk baris
--    ber-`sku_id` (perilaku lama, identik), satu untuk baris level-produk
--    (`client_platform_id, platform_product_id, periode, basis`, HANYA saat
--    `sku_id IS NULL`). Pemanggil menulis baris level-produk lewat replace-
--    on-recommit (DELETE+INSERT transaksional), sama pola `pdt_fact_ads`.
-- ============================================================================

ALTER TABLE pdt_fact_ads
  ADD COLUMN platform_product_id varchar(128) NULL; -- salinan identitas Kode Produk/Kode Item — BUKAN FK (lihat catatan di atas)

COMMENT ON COLUMN pdt_fact_ads.platform_product_id IS
  'Identitas produk induk (Kode Produk/Kode Item) disalin LANGSUNG dari sumber — bukan lookup ke '
  'pdt_sku_master (yang berkunci per varian). NULL untuk modul tanpa identitas produk sama sekali '
  '(shopee_ads_live/shopee_ads_search) atau baris iklan toko (mis. "Shop GMV Max", shopee_ads_cpc).';

ALTER TABLE pdt_fact_sku_period
  ADD COLUMN client_platform_id bigint NULL REFERENCES client_platforms (id),
  ADD COLUMN platform_product_id varchar(128) NULL; -- salinan identitas, sama pola pdt_fact_ads di atas

UPDATE pdt_fact_sku_period p
   SET client_platform_id = s.client_platform_id
  FROM pdt_sku_master s
 WHERE s.id = p.sku_id
   AND p.client_platform_id IS NULL;

-- Baris (kalau ada) yang tetap NULL sesudah backfill berarti sku_id-nya sudah tidak ada di
-- pdt_sku_master (seharusnya mustahil — FK NOT NULL sebelum migrasi ini) — bukan diam-diam
-- dibiarkan, migrasi berhenti kalau itu terjadi supaya tidak menyembunyikan data rusak.
DO $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM pdt_fact_sku_period WHERE client_platform_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'pdt_fact_sku_period: % baris tidak bisa di-backfill client_platform_id (sku_id yatim)', n;
  END IF;
END $$;

ALTER TABLE pdt_fact_sku_period
  ALTER COLUMN client_platform_id SET NOT NULL,
  ALTER COLUMN sku_id DROP NOT NULL,
  ADD CONSTRAINT ck_pdt_fact_sku_period_identitas CHECK (sku_id IS NOT NULL OR platform_product_id IS NOT NULL);

COMMENT ON COLUMN pdt_fact_sku_period.client_platform_id IS
  'Didenormalisasi dari konteks batch (selalu diketahui pemanggil) — bukan hanya diturunkan lewat '
  'sku_id, supaya baris level-produk (sku_id NULL) tetap punya pemilik untuk RLS.';
COMMENT ON COLUMN pdt_fact_sku_period.platform_product_id IS
  'Identitas produk induk disalin LANGSUNG dari sumber (mis. shopee_ams_produk Kode Item) — BUKAN '
  'lookup ke pdt_sku_master (berkunci per varian). sku_id tetap NULL untuk baris jenis ini '
  '(G1-09-2BII-ADS-CPC-SKU, docs/DECISIONS.md 2026-09-14): pemilik menjawab kebutuhan hanya GMV '
  'per PRODUK, bukan per varian, jadi memaksa salah satu sku_id varian akan mengarang atribusi.';

DROP INDEX uq_pdt_fact_sku_period;
CREATE UNIQUE INDEX uq_pdt_fact_sku_period_sku ON pdt_fact_sku_period (sku_id, periode, basis) WHERE sku_id IS NOT NULL;
CREATE UNIQUE INDEX uq_pdt_fact_sku_period_produk ON pdt_fact_sku_period (client_platform_id, platform_product_id, periode, basis) WHERE sku_id IS NULL;
CREATE INDEX idx_pdt_fsp_client_platform ON pdt_fact_sku_period (client_platform_id);

DROP POLICY pdt_fact_sku_period_sel ON pdt_fact_sku_period;
CREATE POLICY pdt_fact_sku_period_sel ON public.pdt_fact_sku_period FOR SELECT TO authenticated
  USING (public.jwt_can_read_all()
         OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
         OR public.jwt_owns_client_platform_am(client_platform_id));
