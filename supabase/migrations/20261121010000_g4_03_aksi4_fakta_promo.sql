-- =============================================================================
-- G4-03 aksi 4 · tabel fakta untuk `shopee_diskon` + `shopee_flash_sale`
--
-- Kedua modul sudah terdaftar dan terdeteksi sejak G1-02, tapi NOL penulis fakta
-- sampai tiket ini — pola sama `20261106010000` (shopee_kesehatan) dan
-- `20261115010000` (shopee_chat), dua modul lain yang juga lama terdeteksi tanpa
-- writer.
--
-- PREMIS "UNVERIFIED" SUDAH GUGUR. `modules.ts` masih memuat catatan G1-02 bahwa
-- pasangan diskon/flash-sale "hanya terselesaikan lewat NAMA BERKAS MENTAH, yang
-- Rule 6 larang". Itu benar pada sample tunggal Fim Motor; TIDAK lagi benar pada
-- 6 klien: `shopee_diskon` menang tunggal lewat ('Tanggal'+'Tipe Promosi') dan
-- `shopee_flash_sale` lewat ('Periode Waktu'+'Jumlah Produk Dilihat'), nol
-- ambiguitas, di 6 dari 6 berkas nyata. Verifikasi itu yang membuka tiket ini.
--
-- ⚠️ BARIS `Tipe Promosi = 'Semua'` BUKAN JUMLAH BARIS LAIN — ia MEN-DEDUP.
-- Ini ditemukan hanya karena ada klien kelima. Pada 5 dari 6 klien, Σ(Diskon +
-- Paket Diskon + Kombo Hemat) KEBETULAN sama persis dengan baris 'Semua', yang
-- membuat "jumlahkan saja komponennya" tampak benar. Pada klien Nubutik ia
-- TIDAK sama:
--
--   Semua        Rp354.987.431   (2.019 pesanan)
--   Diskon       Rp318.741.842   (1.926)
--   Paket Diskon Rp125.702.470   (  412)
--   Kombo Hemat  Rp0             (    0)
--   Σ komponen   Rp444.444.312   (2.338)  ← 25% DI ATAS total sebenarnya
--
-- Sebabnya nyata, bukan kesalahan ekspor: SATU pesanan bisa membawa lebih dari
-- satu tipe promosi sekaligus (produk ber-Diskon yang juga masuk Paket Diskon),
-- jadi ia tercatat di KEDUA baris komponen dan dihitung SEKALI di 'Semua'.
-- Itulah gunanya baris 'Semua' ada.
--
-- Karena itu: SELURUH baris disimpan apa adanya, `tipe_promosi` jadi kolom, dan
-- yang berhak dipakai sebagai total periode HANYA baris 'Semua'. Menjumlahkan
-- baris di tabel ini adalah bug — kelas yang SAMA dengan
-- `G1-07-SHOPEE-DOBEL-HITUNG` (Σ semua baris parentskudetail = 1,87× angka
-- shop-level karena baris parent dan varian dijumlah bersama).
--
-- Nol aksi katalog/verdict di tiket ini — keputusan pemilik 2026-09-19: nol
-- angka ambang diskon/flash-sale ada di `pdt_benchmark` MAUPUN
-- `report_benchmark_shopee`, jadi pemicunya menunggu angka dari pemilik. Yang
-- dibangun sekarang hanya lapisan faktanya, supaya aksi 4 tinggal membaca.
--
-- Replace-on-recommit (DELETE scope client_platform_id+jenis+periode lalu INSERT
-- ulang), bukan ON CONFLICT: berkasnya nol identitas natural per-baris selain
-- `tipe_promosi` yang bisa saja NULL untuk flash sale — pola sama
-- `pdt_fact_ads`/`pdt_fact_layanan_chat`/`pdt_fact_kesehatan_penalti`.
-- =============================================================================

CREATE TABLE pdt_fact_promo (
    id                       bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_platform_id       bigint        NOT NULL REFERENCES client_platforms (id),
    periode                  date          NOT NULL, -- awal bulan, pola sama pdt_fact_layanan_chat
    batch_id                 bigint        NOT NULL REFERENCES pdt_upload_batch (id),
    parser_versi             integer       NOT NULL,

    -- Modul asalnya. Dipisah (bukan dua tabel) karena bentuk metriknya sama;
    -- yang berbeda hanya `tipe_promosi` dan pasangan funnel di bawah.
    jenis                    varchar(16)   NOT NULL,

    -- HANYA `jenis='diskon'`. 'Semua' = total periode yang SUDAH di-dedup;
    -- nilai lain ('Diskon'/'Paket Diskon'/'Kombo Hemat') adalah KOMPONEN yang
    -- boleh saling tumpang tindih. NULL untuk flash sale (berkasnya satu baris,
    -- nol dimensi tipe).
    tipe_promosi             text          NULL,

    penjualan_dibuat         numeric(15,2) NULL, -- konsumen: G4-03 aksi 4 (menunggu ambang)
    penjualan_siap_dikirim   numeric(15,2) NULL,
    pesanan_dibuat           integer       NULL,
    pesanan_siap_dikirim     integer       NULL,

    -- HANYA `jenis='flash_sale'` — satu-satunya hal yang flash sale punya dan
    -- diskon tidak (`modules.ts` sudah mencatatnya sebagai kolom pembedanya).
    produk_dilihat           integer       NULL,
    produk_diklik            integer       NULL,

    CONSTRAINT ck_pdt_fact_promo_jenis CHECK (jenis IN ('diskon', 'flash_sale')),
    -- Menjaga invarian bentuk di DB, bukan cuma di TS (aturan rumah: penegakan
    -- ada di DB): flash sale tidak pernah punya tipe promosi, dan diskon tidak
    -- pernah punya funnel tampilan. Tanpa ini, satu writer yang salah kolom
    -- akan lolos diam-diam dan baru ketahuan di laporan.
    CONSTRAINT ck_pdt_fact_promo_bentuk CHECK (
        (jenis = 'diskon'     AND produk_dilihat IS NULL AND produk_diklik IS NULL)
     OR (jenis = 'flash_sale' AND tipe_promosi IS NULL)
    )
);
CREATE INDEX idx_pdt_fact_promo_client_periode ON pdt_fact_promo (client_platform_id, periode);
CREATE INDEX idx_pdt_fact_promo_batch ON pdt_fact_promo (batch_id);

REVOKE ALL ON public.pdt_fact_promo FROM anon;
REVOKE ALL ON public.pdt_fact_promo FROM authenticated;
GRANT SELECT ON public.pdt_fact_promo TO authenticated;
ALTER TABLE public.pdt_fact_promo ENABLE ROW LEVEL SECURITY;
CREATE POLICY pdt_fact_promo_sel ON public.pdt_fact_promo FOR SELECT TO authenticated
  USING (public.jwt_can_read_all()
         OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
         OR public.jwt_owns_client_platform_am(client_platform_id));

COMMENT ON TABLE pdt_fact_promo IS
  'G4-03 aksi 4 — fakta promo Shopee (shopee_diskon sheet "Kriteria Utama", shopee_flash_sale '
  'sheet "Kriteria Utama"), replace-on-recommit per (client_platform_id, jenis, periode).';
COMMENT ON COLUMN pdt_fact_promo.tipe_promosi IS
  'JANGAN menjumlahkan baris tabel ini. Untuk jenis=diskon, baris tipe_promosi=''Semua'' adalah '
  'total periode yang SUDAH di-dedup; baris lain adalah komponen yang boleh saling tumpang tindih '
  '(satu pesanan bisa membawa beberapa tipe promosi sekaligus). Diverifikasi ke klien nyata: '
  'Σ komponen bisa 25% DI ATAS baris Semua. NULL untuk jenis=flash_sale.';
