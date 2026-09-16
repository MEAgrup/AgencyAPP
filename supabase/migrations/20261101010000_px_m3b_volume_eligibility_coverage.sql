-- ============================================================================
-- Product Exchange M3-B — px_sku_volume, px_sku_kategori, px_sku_eligibility,
-- px_coverage_snapshot/px_coverage_push, view px_catalog_item_v.
-- Sumber: PRD `PRD-product-exchange-M3.md` v1.1 (12 Sep 2026) + keputusan
-- pemilik 2026-09-15 (PLAN_PX_M3B_AgencyAPP.md). Deviasi lengkap:
-- docs/DECISIONS.md entri PX-M3-01..08 (2026-09-15).
--
-- KONTEKS. PX-M2a (20261008010000) sudah melahirkan `client_platforms.shop_id`
-- (gerbang L1) + `px_eligibility_policy` (kalibrasi berversi, tanpa pembaca).
-- M3-B melahirkan sisanya: penyimpan volume per-produk, verdict 4 lapis,
-- penerima push coverage MCN, konfirmasi kategori manusia, dan view katalog.
--
-- KUNCI PER PRODUK (`platform_product_id`), BUKAN per varian (`pdt_sku_master.id`)
-- — PX-M3-07. Satu-satunya penulis `pdt_fact_sku_period` hari ini
-- (`shopee_ams_produk`) menulis level produk (`sku_id NULL`); memaksa salah
-- satu varian akan mengarang atribusi (kelas kesalahan yang sama dengan
-- G1-09-2BII-ADS-CPC-SKU, migrasi 20261025010000). TikTok belum punya
-- penulis fakta per-SKU (tiket `PDT-TIKET-TT-ORDERS-FAKTA` dikirim ke chat PDT).
--
-- AKTIVASI DITUNDA (keputusan pemilik 2026-09-15): tick route manual, TANPA
-- cron/hook otomatis, sampai PDT G1 `verified` di ≥10 klien. Migrasi ini HANYA
-- membangun skema + mesin; `vercel.json`/hook commit PDT TIDAK disentuh.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. px_sku_volume — bukan append-only (UPSERT per recompute), default-deny.
--    PX-M3-07: kunci `(client_platform_id, platform_product_id, jendela_selesai)`.
-- ---------------------------------------------------------------------------
CREATE TABLE px_sku_volume (
    client_platform_id  bigint        NOT NULL REFERENCES client_platforms (id),
    platform_product_id varchar(128)  NOT NULL,
    sku_id               bigint        NULL REFERENCES pdt_sku_master (id), -- terisi bila fakta level varian; NULL bila level produk (kondisi hari ini)
    jendela_mulai        date          NOT NULL,
    jendela_selesai       date          NOT NULL,
    basis                 varchar(16)   NOT NULL DEFAULT 'dibayar',
    gmv_30d               numeric(15,2) NOT NULL,
    pesanan_30d           integer       NOT NULL,
    cakupan_hari          smallint      NOT NULL,
    dihitung_pada         timestamptz   NOT NULL DEFAULT now(),
    batch_ids             bigint[]      NOT NULL,

    CONSTRAINT ck_px_sku_volume_batch_ids CHECK (cardinality(batch_ids) >= 1),
    CONSTRAINT ck_px_sku_volume_nonneg CHECK (gmv_30d >= 0 AND pesanan_30d >= 0 AND cakupan_hari > 0),
    PRIMARY KEY (client_platform_id, platform_product_id, jendela_selesai)
);
CREATE INDEX idx_px_sku_volume_gmv ON px_sku_volume (gmv_30d DESC);

COMMENT ON TABLE px_sku_volume IS
  'Volume 30 hari per produk (PX-M3-07: kunci platform_product_id, bukan varian) — sumber '
  'pdt_fact_sku_period batch verified, basis dibayar (PX-M3-02). Bukan append-only: UPSERT '
  'per recompute (Flow A), riwayat verdict ada di px_sku_eligibility. Default-deny — dibaca/'
  'ditulis lewat service-role, gerbang di domain productexchange-m3.ts.';

REVOKE ALL ON public.px_sku_volume FROM anon;
REVOKE ALL ON public.px_sku_volume FROM authenticated;
ALTER TABLE public.px_sku_volume ENABLE ROW LEVEL SECURITY;
-- Nol policy (default-deny) — pola px_eligibility_policy/pdt_benchmark.

-- ---------------------------------------------------------------------------
-- 2. px_sku_kategori — konfirmasi manusia (PX-M3-01), pengganti ALTER
--    pdt_sku_master (K-4: level2_category/price_segment bukan milik PDT).
-- ---------------------------------------------------------------------------
CREATE TABLE px_sku_kategori (
    client_platform_id  bigint       NOT NULL REFERENCES client_platforms (id),
    platform_product_id varchar(128) NOT NULL,
    level2_category      text         NOT NULL,
    dikonfirmasi_oleh     varchar(64)  NOT NULL REFERENCES employees (employee_id),
    dikonfirmasi_pada     timestamptz  NOT NULL DEFAULT now(),

    PRIMARY KEY (client_platform_id, platform_product_id)
);

COMMENT ON TABLE px_sku_kategori IS
  'Konfirmasi kategori level-2 MCN oleh AM/Lead Account per produk (PX-M3-01, D-24) — '
  'pengganti ALTER pdt_sku_master (K-4). Boleh UPDATE (koreksi salah pilih); setiap '
  'perubahan tercatat audit_log (px_kategori_dikonfirmasi).';

REVOKE ALL ON public.px_sku_kategori FROM anon;
REVOKE ALL ON public.px_sku_kategori FROM authenticated;
GRANT SELECT ON public.px_sku_kategori TO authenticated;
ALTER TABLE public.px_sku_kategori ENABLE ROW LEVEL SECURITY;
CREATE POLICY px_sku_kategori_sel ON public.px_sku_kategori FOR SELECT TO authenticated
  USING (public.jwt_can_read_all()
         OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
         OR public.jwt_owns_client_platform_am(client_platform_id));

-- ---------------------------------------------------------------------------
-- 3. px_sku_eligibility — append-only, frozen (flavour A).
-- ---------------------------------------------------------------------------
CREATE TABLE px_sku_eligibility (
    client_platform_id  bigint        NOT NULL REFERENCES client_platforms (id),
    platform_product_id varchar(128)  NOT NULL,
    versi_policy         integer       NOT NULL REFERENCES px_eligibility_policy (versi),
    verdict               varchar(32)   NOT NULL,
    lapis_gagal           smallint      NULL,
    level2_category       text          NULL,
    price_segment         text          NULL, -- nilai yang dipakai saat L3/L4 — provenans, recomputable
    coverage_snapshot_batch_key text    NULL,
    dihitung_pada         timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT ck_px_sku_eligibility_verdict CHECK (verdict IN
        ('lolos', 'volume_kurang', 'tanpa_agency_plan', 'platform_belum_didukung',
         'kategori_belum_dikonfirmasi', 'kreator_kosong', 'data_tidak_lengkap')),
    CONSTRAINT ck_px_sku_eligibility_lapis CHECK (
        (verdict = 'lolos' AND lapis_gagal IS NULL) OR
        (verdict <> 'lolos' AND lapis_gagal BETWEEN 1 AND 4)),
    PRIMARY KEY (client_platform_id, platform_product_id, versi_policy, dihitung_pada)
);
CREATE INDEX idx_px_sku_eligibility_terbaru
  ON px_sku_eligibility (client_platform_id, platform_product_id, versi_policy, dihitung_pada DESC);

COMMENT ON TABLE px_sku_eligibility IS
  'Riwayat verdict kelayakan SKU Product Exchange, append-only (baris beku via trigger). '
  'Verdict terbaru per (client_platform_id, platform_product_id) pada versi_policy aktif '
  'adalah yang dibaca px_catalog_item_v/halaman Kandidat. Nol kolom angka volume.';

CREATE OR REPLACE FUNCTION px_sku_eligibility_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    RAISE EXCEPTION 'px_sku_eligibility: append-only — verdict baru = baris baru, baris lama tidak pernah diubah/dihapus';
END;
$$;
CREATE TRIGGER trg_px_sku_eligibility_frozen BEFORE UPDATE OR DELETE ON px_sku_eligibility
    FOR EACH ROW EXECUTE FUNCTION px_sku_eligibility_frozen();

REVOKE ALL ON public.px_sku_eligibility FROM anon;
REVOKE ALL ON public.px_sku_eligibility FROM authenticated;
GRANT SELECT ON public.px_sku_eligibility TO authenticated;
ALTER TABLE public.px_sku_eligibility ENABLE ROW LEVEL SECURITY;
CREATE POLICY px_sku_eligibility_sel ON public.px_sku_eligibility FOR SELECT TO authenticated
  USING (public.jwt_can_read_all()
         OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
         OR public.jwt_owns_client_platform_am(client_platform_id));

-- ---------------------------------------------------------------------------
-- 4. px_coverage_snapshot + px_coverage_push — append-only, salinan MCN (D-20).
--    `px_coverage_push` adalah kunci idempotensi + jawaban ASLI (Flow C
--    langkah 6); `price_segment` di snapshot adalah TEXT (nilai milik MCN,
--    bukan enum CDPS).
-- ---------------------------------------------------------------------------
CREATE TABLE px_coverage_snapshot (
    id                    bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_key             text          NOT NULL,
    snapshot_at           timestamptz   NOT NULL,
    diterima_pada         timestamptz   NOT NULL DEFAULT now(),
    level2_category        text          NOT NULL,
    price_segment          text          NOT NULL,
    creator_count          integer       NOT NULL,
    total_slots_available  integer       NOT NULL,
    total_proven_gmv       numeric(15,2) NOT NULL,
    status                 varchar(16)   NOT NULL,

    CONSTRAINT ck_px_coverage_snapshot_status CHECK (status IN ('covered', 'kosong')),
    CONSTRAINT ck_px_coverage_snapshot_nonneg CHECK (
        creator_count >= 0 AND total_slots_available >= 0 AND total_proven_gmv >= 0)
);
CREATE UNIQUE INDEX uq_px_coverage_snapshot ON px_coverage_snapshot (batch_key, level2_category, price_segment);
CREATE INDEX idx_px_coverage_snapshot_kategori ON px_coverage_snapshot (level2_category, price_segment, snapshot_at DESC);
CREATE INDEX idx_px_coverage_snapshot_batch ON px_coverage_snapshot (batch_key);

COMMENT ON TABLE px_coverage_snapshot IS
  'Salinan coverage MCN per (level2_category, price_segment), append-only (D-20) — agregat '
  'TANPA data klien, jadi authenticated boleh SELECT langsung (bukan pelebaran, ledger '
  'rls_checks.sql §48). Baris terbaru by snapshot_at per kategori/segmen dipakai L4.';

CREATE OR REPLACE FUNCTION px_coverage_snapshot_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    RAISE EXCEPTION 'px_coverage_snapshot: append-only — snapshot baru = baris baru, baris lama tidak pernah diubah/dihapus';
END;
$$;
CREATE TRIGGER trg_px_coverage_snapshot_frozen BEFORE UPDATE OR DELETE ON px_coverage_snapshot
    FOR EACH ROW EXECUTE FUNCTION px_coverage_snapshot_frozen();

REVOKE ALL ON public.px_coverage_snapshot FROM anon;
REVOKE ALL ON public.px_coverage_snapshot FROM authenticated;
GRANT SELECT ON public.px_coverage_snapshot TO authenticated;
ALTER TABLE public.px_coverage_snapshot ENABLE ROW LEVEL SECURITY;
-- USING(true) sengaja — agregat lintas kategori/segmen tanpa data klien atau
-- kreator, bukan "biar tes hijau" (justifikasi penuh: rls_checks.sql §48).
CREATE POLICY px_coverage_snapshot_sel ON public.px_coverage_snapshot FOR SELECT TO authenticated USING (true);

CREATE TABLE px_coverage_push (
    batch_key      text         NOT NULL PRIMARY KEY,
    snapshot_at    timestamptz  NOT NULL,
    diterima_pada  timestamptz  NOT NULL DEFAULT now(),
    source         text         NOT NULL,
    rows_received  integer      NOT NULL,
    payload        jsonb        NOT NULL -- raw apa adanya, pola external_orders.payload

);

COMMENT ON TABLE px_coverage_push IS
  'Kunci idempotensi bridge px-coverage (Flow C langkah 6) + jawaban ASLI untuk key berulang. '
  'payload disimpan mentah, immutable (pola external_orders.payload).';

CREATE OR REPLACE FUNCTION px_coverage_push_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    RAISE EXCEPTION 'px_coverage_push: immutable — satu batch_key, satu payload, tidak pernah diubah/dihapus';
END;
$$;
CREATE TRIGGER trg_px_coverage_push_frozen BEFORE UPDATE OR DELETE ON px_coverage_push
    FOR EACH ROW EXECUTE FUNCTION px_coverage_push_frozen();

REVOKE ALL ON public.px_coverage_push FROM anon;
REVOKE ALL ON public.px_coverage_push FROM authenticated;
ALTER TABLE public.px_coverage_push ENABLE ROW LEVEL SECURITY;
-- Nol policy (default-deny) — hanya service-role (route bridge) yang menyentuhnya.

-- ---------------------------------------------------------------------------
-- 5. Seed px_eligibility_policy versi 2 — price_segment_bands (PX-M3-06, TBC
--    Hans M3-02). Append-only: versi 1 tetap riwayat, versi 2 lahir aktif.
-- ---------------------------------------------------------------------------
INSERT INTO px_eligibility_policy (versi, nilai, catatan, dibuat_oleh) VALUES
    (2, '{
      "sales_threshold_idr": 200000000,
      "threshold_basis": "per_sku",
      "threshold_window_days": 30,
      "commission_floor_pct": null,
      "require_stock_in": true,
      "platforms": ["tiktok", "shopee"],
      "price_segment_bands": [
        {"segment": "low", "max_idr": 100000},
        {"segment": "mid", "max_idr": 500000},
        {"segment": "high", "max_idr": null}
      ]
     }'::jsonb,
     'PX-M3-06: versi 2 menambah price_segment_bands (low/mid/high) untuk L3/L4 M3-B + platforms '
     'shopee (M3-B mengaktifkan evaluasi Shopee). Band TBC — menunggu kalibrasi Hans (M3-02), '
     'placeholder low<=100rb/mid<=500rb/high=tak terbatas. Versi 1 tetap riwayat (append-only, '
     'aturan rumah #4).',
     'SYSTEM');

-- ---------------------------------------------------------------------------
-- 6. View px_catalog_item_v — katalog PX ('lolos' terbaru per produk pada
--    versi policy aktif). security_invoker=true: RLS TABEL DASAR (px_sku_
--    eligibility/px_sku_kategori/client_platforms/pdt_sku_master, semua
--    varian B) berlaku LANGSUNG untuk pemanggil — deviasi sadar dari pola
--    view lain di repo ini (interview_verdict, security_invoker=false +
--    WHERE eksplisit): di sini DRY menang karena keempat tabel dasar SUDAH
--    punya policy varian B yang identik (AM pemilik/lead Account/Director/OD
--    read-all), jadi menduplikasi WHERE-nya di view hanya menambah satu
--    tempat lagi yang bisa diam-diam menyimpang dari tabel dasarnya.
--    px_sku_volume TIDAK di-join untuk angka (D-06) — sinyal afiliasi HANYA
--    boolean lewat pdt_fact_sku_period.gmv_dari_kreator (RLS varian B tabel
--    itu sendiri, bukan lewat volume).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.px_catalog_item_v
    WITH (security_invoker = true) AS
WITH terbaru AS (
    SELECT e.*,
           row_number() OVER (
             PARTITION BY e.client_platform_id, e.platform_product_id
             ORDER BY e.dihitung_pada DESC
           ) AS rn
      FROM public.px_sku_eligibility e
     WHERE e.versi_policy = (SELECT max(versi) FROM public.px_eligibility_policy WHERE aktif = true)
       AND e.verdict = 'lolos'
),
nama_produk AS (
    SELECT DISTINCT ON (s.client_platform_id, s.platform_product_id)
           s.client_platform_id, s.platform_product_id, s.nama_produk
      FROM public.pdt_sku_master s
     ORDER BY s.client_platform_id, s.platform_product_id, s.id
)
SELECT
    t.client_platform_id,
    t.platform_product_id,
    n.nama_produk,
    cp.platform,
    cl.id AS client_id,
    cl.toko AS nama_toko,
    t.level2_category,
    t.price_segment,
    EXISTS (
        SELECT 1 FROM public.pdt_fact_sku_period f
         WHERE f.client_platform_id = t.client_platform_id
           AND f.platform_product_id = t.platform_product_id
           AND f.gmv_dari_kreator > 0
    ) AS sudah_afiliasi,
    t.dihitung_pada
FROM terbaru t
JOIN public.client_platforms cp ON cp.id = t.client_platform_id
JOIN public.clients cl ON cl.id = cp.client_id
LEFT JOIN nama_produk n ON n.client_platform_id = t.client_platform_id AND n.platform_product_id = t.platform_product_id
WHERE t.rn = 1;

COMMENT ON VIEW public.px_catalog_item_v IS
  'Katalog PX — verdict lolos terbaru per produk pada versi policy aktif. security_invoker=true '
  '(RLS tabel dasar berlaku langsung, lihat komentar migrasi). Nol gmv_30d/pesanan (D-06) — '
  'sinyal afiliasi hanya boolean sudah_afiliasi lewat pdt_fact_sku_period.gmv_dari_kreator.';

GRANT SELECT ON public.px_catalog_item_v TO authenticated;
