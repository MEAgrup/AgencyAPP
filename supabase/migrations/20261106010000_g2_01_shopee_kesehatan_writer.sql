-- G2-01-SHOPEE-KESEHATAN-WRITER — tabel fakta baru untuk modul `shopee_kesehatan`
-- (sudah terdaftar+terdeteksi sejak awal, `modules.ts` — signature SANGAT sederhana,
-- "seluruh sheet hanya 3 kolom" PRD §7.2 — tapi NOL penulis fakta ada di manapun
-- dalam skema sampai migrasi ini).
--
-- Bentuk berkas ('Poin Penalti'/'Deskripsi'/'Durasi', satu baris = satu pelanggaran
-- aktif) TIDAK punya identitas natural per-baris (nol "ID Penalti" di sumber) — pola
-- SAMA `pdt_fact_ads` (sku_id/content_id selalu NULL): replace-on-recommit
-- (DELETE scope client_platform_id+periode, lalu INSERT ulang), bukan ON CONFLICT.
-- Konsumen: `PdtSkorInputKesehatanShopee.poinTotal` (Σ poin periode ini,
-- `packages/core/src/pdt/skor.ts` — `computeSkorShopee`'s `scoreKesehatanToko` SUDAH
-- dibangun+diuji sejak sesi 34, menunggu input sungguhan). `deskripsi`/`durasi`
-- disimpan APA ADANYA (tampilan/insight, bukan dihitung) — cermin persis
-- `report/shopee/metrik.ts` `parseKesehatan`'s `Penalti { poin, deskripsi, durasi }`.
--
-- Beda dari dimensi lain yang butuh agregasi HARIAN (cr/cancelRate): berkas ini
-- BUKAN laporan berdurasi-hari — daftar penalti AKTIF pada saat diunggah, jadi
-- SATU snapshot per periode langsung sesuai, nol masalah "metrik per-periode vs
-- per-hari" yang menunda repeatRate (migrasi 20261105010000).

CREATE TABLE pdt_fact_kesehatan_penalti (
    id                  bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_platform_id  bigint        NOT NULL REFERENCES client_platforms (id),
    periode             date          NOT NULL, -- awal bulan, pola sama pdt_fact_sku_period/pdt_fact_creator_period
    batch_id            bigint        NOT NULL REFERENCES pdt_upload_batch (id),
    parser_versi        integer       NOT NULL,

    poin                numeric(10,2) NOT NULL, -- konsumen: PdtSkorInputKesehatanShopee.poinTotal (Σ)
    deskripsi           text          NOT NULL, -- tampilan/insight — konsumen: laporan (belum dibangun)
    durasi              varchar(64)   NOT NULL  -- tampilan/insight — teks bebas dari sumber ("30 hari", dst.), bukan tanggal terstruktur
);
CREATE INDEX idx_pdt_fkp_client_periode ON pdt_fact_kesehatan_penalti (client_platform_id, periode);
CREATE INDEX idx_pdt_fkp_batch ON pdt_fact_kesehatan_penalti (batch_id);

REVOKE ALL ON public.pdt_fact_kesehatan_penalti FROM anon;
REVOKE ALL ON public.pdt_fact_kesehatan_penalti FROM authenticated;
GRANT SELECT ON public.pdt_fact_kesehatan_penalti TO authenticated;
ALTER TABLE public.pdt_fact_kesehatan_penalti ENABLE ROW LEVEL SECURITY;
CREATE POLICY pdt_fact_kesehatan_penalti_sel ON public.pdt_fact_kesehatan_penalti FOR SELECT TO authenticated
  USING (public.jwt_can_read_all()
         OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
         OR public.jwt_owns_client_platform_am(client_platform_id));

COMMENT ON TABLE pdt_fact_kesehatan_penalti IS
  'G2-01-SHOPEE-KESEHATAN-WRITER — satu baris per pelanggaran/penalti AKTIF Shopee '
  '("Bisnis — Kesehatan Toko"), replace-on-recommit per (client_platform_id, periode) '
  '(nol identitas natural per-baris di sumber, sama pola pdt_fact_ads). Snapshot, '
  'bukan agregasi harian — berkas sumber sendiri bukan laporan berdurasi-hari.';

-- Gerbang CI — SATU tabel baru (nol prefix/lifecycle/notifikasi baru — fakta murni,
-- sama kelas pdt_fact_sku_period/pdt_fact_creator_period, tidak ber-ID PREFIX-YYYYMM-NNNN):
--   public base tables : 181 → 182
--   entity_prefix      : 45 → 45
--   sm_machines        : 35 → 35
--   notif_events       : 76 → 76
