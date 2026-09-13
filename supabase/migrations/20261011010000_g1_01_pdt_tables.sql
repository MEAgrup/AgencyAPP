-- G1-01 · Migrasi tabel `pdt_*` (Pusat Data Toko) — fondasi G1.
-- Lihat docs/prd/CDPS_PDT_Pusat_Data_Toko.md §6 dan docs/backlog/PDT_BACKLOG.md G1-01.
--
-- Cakupan tiket ini: STRUKTUR TABEL + RLS + gerbang CI saja. Nol seed
-- pdt_parser_modul (G1-02), nol seed pdt_benchmark (G2-02), nol katalog aksi
-- (G4-01/G4-03) — mengisinya sekarang akan mendahului tiket yang memang
-- memilikinya (rencana build order, PDT_BACKLOG.md §0).
--
-- Semua tabel baru `bigint GENERATED ALWAYS AS IDENTITY` kecuali tabel
-- konfigurasi berkunci alami (`pdt_parser_modul.kode`, `pdt_benchmark.versi`,
-- `pdt_usulan_katalog.kode`) — nol prefix `entity_prefix` baru (koreksi K-2,
-- preseden client_reports/px_eligibility_policy/client_platforms).
--
-- Dua koreksi terhadap PRD §6.1 (dicatat docs/DECISIONS.md 2026-09-13,
-- pola sama dengan K-1..K-4 di kepala PRD — verifikasi ke repo, bukan
-- ditebak):
--   (a) `pdt_upload_batch.client_id` PRD menyebut `bigint`, tapi `clients.id`
--       aktual adalah `varchar(32)` (CLI-YYYYMM-NNNN) — FK di sini varchar(32),
--       bukan bigint, supaya benar-benar mereferensi PK yang ada.
--   (b) `pdt_upload_batch.dibuat_oleh` PRD menyebut `uuid FK team_members`,
--       tapi tabel `team_members` tidak ada di CDPS — aktornya `employees`
--       (PK `employee_id varchar(64)`, sama seperti `jwt_employee_id()`).
--       Kolom di sini `varchar(64) REFERENCES employees (employee_id)`,
--       pola `created_by`/`dibuat_oleh` yang sudah dipakai di seluruh repo.
--
-- Status paket (Rule 11/50 — tersedia/kedaluwarsa/legal_hold/perlu_upload_ulang/
-- tidak_dapat_dipulihkan) SENGAJA TIDAK disimpan sebagai kolom: kelimanya
-- 100% diturunkan dari `legal_hold` + `raw_dihapus_pada` + `retensi_sampai` +
-- `periode_selesai` + `platform` yang sudah ada di baris ini (ambang per
-- platform TikTok >180 hari / Shopee >90 hari, dihitung job G1-10/pembaca
-- G1-11) — aturan rumah #4 (auto-calculated fields read-only, always
-- recomputable) menang atas bacaan literal Rule 11/50 yang terdengar seperti
-- kolom tersimpan. Dicatat docs/DECISIONS.md 2026-09-13.

-- ===========================================================================
-- 0. ENUM pdt_satuan_t (Rule 27, F-6 — `rasio` ditambahkan sesi 2 untuk ROAS "x")
-- ===========================================================================
CREATE TYPE pdt_satuan_t AS ENUM ('rupiah', 'persen', 'hitungan', 'jam', 'hari', 'views', 'rasio');

-- ===========================================================================
-- 1. pdt_parser_modul — registry tanda tangan kolom per modul (§6.3)
--    Seed (§7 PRD, PDT_KOLOM_DIPANEN.md) menyusul G1-02 — tabel ini baru
--    strukturnya.
-- ===========================================================================
CREATE TABLE pdt_parser_modul (
    kode               varchar(64)  NOT NULL PRIMARY KEY,
    platform           varchar(16)  NOT NULL,
    nama_tampilan      varchar(191) NOT NULL,
    tanda_tangan_kolom jsonb        NOT NULL, -- kolom wajib yang mengidentifikasi modul ini (Rule 6 — bukan nama berkas)
    baris_header_hint  smallint     NOT NULL, -- baris header (Rule 7 — dicari, bukan diasumsikan; sebagian modul 2 lapis)
    kolom_dipanen      text[]       NOT NULL DEFAULT '{}', -- whitelist PDT-27 (PDT_KOLOM_DIPANEN.md) — hidup di sini, bukan di kode
    wajib              boolean      NOT NULL DEFAULT true,
    versi              integer      NOT NULL DEFAULT 1,
    dibuat_pada        timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT ck_pdt_parser_modul_platform CHECK (platform IN ('tiktok', 'shopee', 'meta')),
    CONSTRAINT ck_pdt_parser_modul_signature_shape CHECK (jsonb_typeof(tanda_tangan_kolom) = 'object'),
    CONSTRAINT ck_pdt_parser_modul_versi CHECK (versi >= 1),
    CONSTRAINT ck_pdt_parser_modul_header CHECK (baris_header_hint >= 1)
);

COMMENT ON TABLE pdt_parser_modul IS
  'Registry tanda tangan kolom per modul export (Rule 6-7). Konsolidasi EMPAT registry lama '
  '(baseline/detect.ts, report/detect.ts, report/shopee/detect.ts, adsscanner/tiktok/detect.ts) '
  '+ modul baru (shopee_video 2 lapis, shopee_chat_broadcast, meta_ads) — pengisiannya G1-02.';

-- Reference/konfigurasi bersama — dibaca SIAPA PUN yang boleh mengunggah/mereview batch PDT
-- (AM memilih dari dropdown "seluruh modul", Rule G1-09), bukan data klien. RLS aktif tapi
-- tanpa penyempitan baris (bukan variant A/B — kelas ketiga: reference table lintas-divisi).
REVOKE ALL ON public.pdt_parser_modul FROM anon;
REVOKE ALL ON public.pdt_parser_modul FROM authenticated;
GRANT SELECT ON public.pdt_parser_modul TO authenticated;
ALTER TABLE public.pdt_parser_modul ENABLE ROW LEVEL SECURITY;
CREATE POLICY pdt_parser_modul_sel ON public.pdt_parser_modul FOR SELECT TO authenticated USING (true);

-- ===========================================================================
-- 2. pdt_kolom_alias — pemetaan alias → kolom kanonik per modul (§6.3, Rule 9)
--    Append-only: nama kolom berubah = kasus normal, alias lama tidak pernah
--    dihapus/diubah (drift kolom historis harus tetap terbaca).
-- ===========================================================================
CREATE TABLE pdt_kolom_alias (
    modul_kode    varchar(64)  NOT NULL REFERENCES pdt_parser_modul (kode),
    kolom_kanonik varchar(128) NOT NULL,
    alias         varchar(128) NOT NULL,
    versi_pertama integer      NOT NULL DEFAULT 1,
    dibuat_pada   timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (modul_kode, kolom_kanonik, alias),
    CONSTRAINT ck_pdt_kolom_alias_versi CHECK (versi_pertama >= 1)
);

COMMENT ON TABLE pdt_kolom_alias IS
  'Alias nama kolom → kolom kanonik per modul (Rule 9). Append-only — kolom wajib yang tidak '
  'ditemukan DAN tidak punya alias di sini ⇒ parse_status=gagal dengan pesan menyebut nama kolom.';

CREATE OR REPLACE FUNCTION pdt_kolom_alias_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    RAISE EXCEPTION 'pdt_kolom_alias: append-only — alias lama tidak pernah dihapus/diubah, hanya ditambah (Rule 9)';
END;
$$;
CREATE TRIGGER trg_pdt_kolom_alias_frozen BEFORE UPDATE OR DELETE ON pdt_kolom_alias
    FOR EACH ROW EXECUTE FUNCTION pdt_kolom_alias_frozen();

REVOKE ALL ON public.pdt_kolom_alias FROM anon;
REVOKE ALL ON public.pdt_kolom_alias FROM authenticated;
GRANT SELECT ON public.pdt_kolom_alias TO authenticated;
ALTER TABLE public.pdt_kolom_alias ENABLE ROW LEVEL SECURITY;
CREATE POLICY pdt_kolom_alias_sel ON public.pdt_kolom_alias FOR SELECT TO authenticated USING (true);

-- ===========================================================================
-- 3. pdt_upload_batch (§6.1, PDT-25/PDT-26)
-- ===========================================================================
CREATE TABLE pdt_upload_batch (
    id                    bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_id             varchar(32)  NOT NULL REFERENCES clients (id),
    client_platform_id    bigint       NOT NULL REFERENCES client_platforms (id),
    platform              varchar(16)  NOT NULL, -- tiktok/shopee/meta (PDT-22) — vokab BERBEDA dari client_platforms.platform (Title Case, termasuk Tokopedia/Lazada/Blibli manual-only)
    periode_mulai         date         NOT NULL, -- dari berkas (Rule 5), rentang TERLUAS antar berkas dalam batch
    periode_selesai       date         NOT NULL,
    status                varchar(24)  NOT NULL DEFAULT 'parsing', -- parsing/identitas_belum_terikat/verified/ditolak/digantikan
    reconcile_delta_pct   numeric(6,3) NULL,
    alasan_ditolak        text         NULL,
    parser_versi          integer      NOT NULL,
    identitas_sumber      jsonb        NULL, -- {shop_id, username, nama_toko} dari preamble (Rule 2)
    menggantikan_batch_id bigint       NULL REFERENCES pdt_upload_batch (id),

    -- Kolom paket raw (PDT-25/PDT-26) — bucket privat pdt-raw, satu-satunya jalan reparse.
    raw_path              text         NULL, -- objek di bucket pdt-raw; NULL hanya sebelum upload selesai
    raw_sha256            text         NULL,
    raw_bytes             bigint       NULL,
    raw_entri             smallint     NULL,
    raw_entri_dilewati    smallint     NULL, -- __MACOSX/.DS_Store/._* (Rule 41, dilewati tanpa peringatan)
    retensi_sampai        date         NOT NULL, -- dihitung saat batch dibuat, diperpanjang otomatis, TIDAK PERNAH diperpendek (Rule 45)
    retensi_alasan        varchar(24)  NULL, -- default/laporan_terkirim/katalog_px/ditolak
    raw_dihapus_pada      timestamptz  NULL, -- diisi HANYA setelah penghapusan objek benar-benar berhasil (Flow E)
    legal_hold            boolean      NOT NULL DEFAULT false, -- Director saja yang menyalakan/mematikan (Rule 45/48)

    dibuat_oleh           varchar(64)  NOT NULL REFERENCES employees (employee_id),
    dibuat_pada           timestamptz  NOT NULL DEFAULT now(), -- selalu jam server (Rule 37), tidak pernah jam browser

    CONSTRAINT ck_pdt_upload_batch_platform CHECK (platform IN ('tiktok', 'shopee', 'meta')),
    CONSTRAINT ck_pdt_upload_batch_status CHECK (status IN ('parsing', 'identitas_belum_terikat', 'verified', 'ditolak', 'digantikan')),
    CONSTRAINT ck_pdt_upload_batch_periode CHECK (periode_selesai >= periode_mulai),
    CONSTRAINT ck_pdt_upload_batch_alasan_ditolak CHECK (status <> 'ditolak' OR alasan_ditolak IS NOT NULL),
    CONSTRAINT ck_pdt_upload_batch_retensi_alasan CHECK (retensi_alasan IS NULL OR retensi_alasan IN ('default', 'laporan_terkirim', 'katalog_px', 'ditolak')),
    -- Rule di §6.1: raw_dihapus_pada terisi ⇒ paket memang pernah ada (raw_path tidak NULL).
    CONSTRAINT ck_pdt_upload_batch_raw_purge CHECK (raw_dihapus_pada IS NULL OR raw_path IS NOT NULL)
);

-- Unique partial (Rule 36, PDT_BACKLOG.md G1-01): batch ditolak/digantikan TIDAK memblokir
-- penggantinya — hanya SATU batch verified per (toko, periode) yang boleh berdiri.
CREATE UNIQUE INDEX uq_pdt_upload_batch_verified
  ON pdt_upload_batch (client_platform_id, periode_mulai, periode_selesai)
  WHERE status = 'verified';

CREATE INDEX idx_pdt_upload_batch_platform_periode ON pdt_upload_batch (client_platform_id, periode_mulai DESC);
-- Indeks kerja job purge (Flow E) — hanya baris yang benar-benar kandidat purge.
CREATE INDEX idx_pdt_upload_batch_retensi ON pdt_upload_batch (retensi_sampai)
  WHERE raw_dihapus_pada IS NULL AND legal_hold = false;

COMMENT ON TABLE pdt_upload_batch IS
  'Satu batch upload = satu client_platform + satu periode (Rule 1). status ditulis LANGSUNG '
  'oleh domain (parse/rekonsiliasi), BUKAN lewat sm_transition — nol lifecycle ber-role-gate '
  'multi-langkah di sini, preseden M19 dailyops (pagar #5 PDT_BACKLOG.md §0). sm_machines TIDAK '
  'bergerak untuk tabel ini.';

-- Ownership AM langsung dari client_id (kolom ada di baris ini) — pakai helper yang SUDAH ADA,
-- bukan yang baru (rls_baseline.sql jwt_owns_client_am).
REVOKE ALL ON public.pdt_upload_batch FROM anon;
REVOKE ALL ON public.pdt_upload_batch FROM authenticated;
GRANT SELECT ON public.pdt_upload_batch TO authenticated;
ALTER TABLE public.pdt_upload_batch ENABLE ROW LEVEL SECURITY;
CREATE POLICY pdt_upload_batch_sel ON public.pdt_upload_batch FOR SELECT TO authenticated
  USING (public.jwt_can_read_all()
         OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
         OR public.jwt_owns_client_am(client_id));

-- ---------------------------------------------------------------------------
-- Helper kepemilikan turunan (SECURITY DEFINER) untuk tabel anak PDT yang
-- hanya membawa batch_id/client_platform_id/sku_id, bukan client_id langsung.
-- Pola sama dengan jwt_owns_interview_am (rls_baseline.sql) — menumpang
-- jwt_owns_client_am yang sudah ada, bukan menduplikasi logikanya.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.jwt_owns_pdt_batch_am(p_batch_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1 FROM public.pdt_upload_batch b
     WHERE b.id = p_batch_id AND public.jwt_owns_client_am(b.client_id))
$$;

CREATE OR REPLACE FUNCTION public.jwt_owns_client_platform_am(p_client_platform_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1 FROM public.client_platforms cp
     WHERE cp.id = p_client_platform_id AND public.jwt_owns_client_am(cp.client_id))
$$;

-- Permukaan EXECUTE (rls_checks.sql §44) — `REVOKE ... FROM PUBLIC` saja TIDAK
-- cukup di Supabase (ALTER DEFAULT PRIVILEGES memberi anon+authenticated EXECUTE
-- eksplisit begitu fungsi lahir); keduanya dipanggil LANGSUNG dari ekspresi
-- policy `TO authenticated` di bawah, jadi `authenticated` WAJIB tetap bisa,
-- `anon` TIDAK PERNAH boleh (ia tak pernah mengevaluasi policy itu).
REVOKE EXECUTE ON FUNCTION public.jwt_owns_pdt_batch_am(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.jwt_owns_pdt_batch_am(bigint) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.jwt_owns_client_platform_am(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.jwt_owns_client_platform_am(bigint) TO authenticated;

-- ===========================================================================
-- 4. pdt_file — satu baris per entri di dalam ZIP (§6.1)
-- ===========================================================================
CREATE TABLE pdt_file (
    id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_id       bigint      NOT NULL REFERENCES pdt_upload_batch (id),
    modul_kode     varchar(64) NULL REFERENCES pdt_parser_modul (kode), -- NULL = tidak terdeteksi modul apa pun
    nama_entri     text        NOT NULL, -- nama file DI DALAM zip, apa adanya — tidak diatur/divalidasi (Rule 39)
    sha256         text        NOT NULL,
    bytes          bigint      NOT NULL,
    baris_header   smallint    NOT NULL,
    deteksi_oleh   varchar(16) NOT NULL, -- tanda_tangan | override_am
    kolom_dipanen  smallint    NOT NULL, -- jumlah kolom whitelist yang benar-benar terisi di berkas ini
    kolom_baru     text[]      NOT NULL DEFAULT '{}', -- NAMA saja, bukan nilai (Rule 8) — sinyal drift, biaya ~nol
    parse_status   varchar(16) NOT NULL, -- ok/sebagian/gagal
    parse_error    text        NULL,
    baris_terparse integer     NULL,
    dibuat_pada    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ck_pdt_file_deteksi_oleh CHECK (deteksi_oleh IN ('tanda_tangan', 'override_am')),
    CONSTRAINT ck_pdt_file_parse_status CHECK (parse_status IN ('ok', 'sebagian', 'gagal')),
    -- Rule 10: "berkas tidak diunggah" DILARANG untuk berkas gagal parse — parse_error wajib terisi.
    CONSTRAINT ck_pdt_file_parse_error CHECK (parse_status = 'ok' OR parse_error IS NOT NULL)
);
CREATE INDEX idx_pdt_file_batch ON pdt_file (batch_id);
-- sha256 WAJIB di-query saat upload (Rule 43) — sidik jari sama pada client_platform_id
-- berbeda ⇒ peringatan keras. Indeksnya di sini; pemanggilnya menyusul G1-04/G1-09.
CREATE INDEX idx_pdt_file_sha256 ON pdt_file (sha256);

COMMENT ON TABLE pdt_file IS
  'Satu baris per entri DI DALAM paket ZIP (Rule 38-40). parse_status/parse_error membedakan '
  '"berkas tidak diunggah" dari "diunggah tapi gagal parse" (Rule 10) — keduanya tidak boleh '
  'ditelan menjadi satu pesan.';

REVOKE ALL ON public.pdt_file FROM anon;
REVOKE ALL ON public.pdt_file FROM authenticated;
GRANT SELECT ON public.pdt_file TO authenticated;
ALTER TABLE public.pdt_file ENABLE ROW LEVEL SECURITY;
CREATE POLICY pdt_file_sel ON public.pdt_file FOR SELECT TO authenticated
  USING (public.jwt_can_read_all()
         OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
         OR public.jwt_owns_pdt_batch_am(batch_id));

-- ===========================================================================
-- 5. Tabel fakta (§6.2) — nol `extras jsonb` (PDT-15 revisi 2): hanya kolom
--    whitelist yang disimpan, sisanya hanya di paket ZIP selama masa retensi.
--    Setiap kolom metrik membawa komentar `konsumen:` (PDT-27) — kolom tanpa
--    konsumen tidak boleh lahir. Nol created_at/created_by PER BARIS di enam
--    tabel ini secara sengaja: batch_id sudah memberi lineage penuh ke
--    pdt_upload_batch.dibuat_oleh/dibuat_pada, dan baris-baris ini diproyeksikan
--    jutaan/tahun (P-07) — audit kolom per baris di sini hanya biaya, nol manfaat.
-- ===========================================================================

-- 5a. pdt_fact_shop_daily — key (client_platform_id, tanggal, basis)
CREATE TABLE pdt_fact_shop_daily (
    id                 bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_platform_id bigint        NOT NULL REFERENCES client_platforms (id),
    tanggal            date          NOT NULL,
    -- 'net' = TikTok (GMV − refund, Rule 15, basis tunggal). Shopee TIGA basis terpisah,
    -- TIDAK PERNAH dijumlah (Rule 15/16) — Fim Motor 18,2% adalah akibat mencampur ini.
    basis              varchar(16)   NOT NULL,
    batch_id           bigint        NOT NULL REFERENCES pdt_upload_batch (id),
    parser_versi       integer       NOT NULL,

    gmv                numeric(15,2) NOT NULL, -- konsumen: report.gmv_net/gmv_kotor, G1-07 rekonsiliasi (sisi shop-level), px.gerbang_kelayakan (basis dibayar, PDT-19)
    pesanan            integer       NOT NULL, -- konsumen: report.dimensi_pesanan, G1-07 rekonsiliasi
    produk_terjual     integer       NULL,     -- konsumen: report.dimensi_produk_terjual
    pengunjung         integer       NULL,     -- konsumen: report.dimensi_traffic, kuadran SKU sumbu-X (Shopee)
    produk_diklik      integer       NULL,     -- konsumen: report.dimensi_traffic (Product Performance)
    cr                 numeric(6,3)  NULL,     -- konsumen: report.dimensi_konversi
    pembeli            integer       NULL,     -- konsumen: report.dimensi_pembeli
    pembeli_baru       integer       NULL,     -- konsumen: report.dimensi_pembeli_baru
    refund             numeric(15,2) NULL,     -- konsumen: report.gmv_net (TikTok Rule 15: GMV − refund)

    CONSTRAINT ck_pdt_fsd_basis CHECK (basis IN ('net', 'dibuat', 'siap_dikirim', 'dibayar')),
    CONSTRAINT ck_pdt_fsd_nonneg CHECK (gmv >= 0 AND pesanan >= 0)
);
CREATE UNIQUE INDEX uq_pdt_fact_shop_daily ON pdt_fact_shop_daily (client_platform_id, tanggal, basis);
CREATE INDEX idx_pdt_fsd_batch ON pdt_fact_shop_daily (batch_id);

REVOKE ALL ON public.pdt_fact_shop_daily FROM anon;
REVOKE ALL ON public.pdt_fact_shop_daily FROM authenticated;
GRANT SELECT ON public.pdt_fact_shop_daily TO authenticated;
ALTER TABLE public.pdt_fact_shop_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY pdt_fact_shop_daily_sel ON public.pdt_fact_shop_daily FOR SELECT TO authenticated
  USING (public.jwt_can_read_all()
         OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
         OR public.jwt_owns_client_platform_am(client_platform_id));

-- 5b. pdt_sku_master — key (client_platform_id, platform_product_id, platform_variation_id)
-- ⛔ K-4: level2_category dan price_segment TIDAK dilahirkan di sini — tipenya
-- tidak ada di CDPS (nol hasil grep termasuk enum price_segment_t), keduanya
-- hidup di MCN/MSDPS dan hanya dikonsumsi Product Exchange (G5, diblokir).
CREATE TABLE pdt_sku_master (
    id                     bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_platform_id     bigint       NOT NULL REFERENCES client_platforms (id),
    platform_product_id    varchar(128) NOT NULL, -- konsumen: Rule 20 — kunci SATU-SATUNYA yang boleh dipakai hilir (kuadran, hero SKU, Plan, Brief)
    platform_variation_id  varchar(128) NOT NULL DEFAULT '', -- '' bila platform tidak mengenal varian (mis. beberapa SKU Induk Shopee)
    seller_sku             varchar(191) NULL, -- konsumen: G1-06/PX identitas SKU sisi penjual
    nama_produk            varchar(255) NULL, -- TAMPILAN UI SAJA — Rule 20 melarangnya jadi kunci di tabel mana pun
    nama_variasi           varchar(255) NULL,
    kategori_platform      varchar(191) NULL, -- konsumen: Section B, kuadran per-kategori. BUKAN level2_category MCN (K-4)
    harga_satuan_terakhir  numeric(15,2) NULL, -- konsumen: report harga satuan, px gerbang kelayakan
    status_listing         varchar(16)  NOT NULL DEFAULT 'aktif', -- konsumen: Rule 19 — SKU TIDAK PERNAH dihapus, hanya status yang berubah
    first_seen_at          timestamptz  NOT NULL DEFAULT now(),
    last_seen_at           timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT ck_pdt_sku_master_status CHECK (status_listing IN ('aktif', 'nonaktif', 'dihapus_platform'))
);
CREATE UNIQUE INDEX uq_pdt_sku_master ON pdt_sku_master (client_platform_id, platform_product_id, platform_variation_id);
CREATE INDEX idx_pdt_sku_master_platform ON pdt_sku_master (client_platform_id);

COMMENT ON TABLE pdt_sku_master IS
  'Master SKU lintas periode (Rule 17-20). SKU tidak pernah dihapus — hanya status_listing/'
  'last_seen_at berubah, memungkinkan pelacakan perpindahan kuadran antar bulan. Nama SKU '
  'TIDAK PERNAH kunci di tabel manapun (Rule 20) — platform_product_id/platform_variation_id '
  'adalah kuncinya. ⛔ level2_category/price_segment SENGAJA tidak ada (K-4, milik G5).';

REVOKE ALL ON public.pdt_sku_master FROM anon;
REVOKE ALL ON public.pdt_sku_master FROM authenticated;
GRANT SELECT ON public.pdt_sku_master TO authenticated;
ALTER TABLE public.pdt_sku_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY pdt_sku_master_sel ON public.pdt_sku_master FOR SELECT TO authenticated
  USING (public.jwt_can_read_all()
         OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
         OR public.jwt_owns_client_platform_am(client_platform_id));

CREATE OR REPLACE FUNCTION public.jwt_owns_pdt_sku_am(p_sku_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1 FROM public.pdt_sku_master s
     WHERE s.id = p_sku_id AND public.jwt_owns_client_platform_am(s.client_platform_id))
$$;
REVOKE EXECUTE ON FUNCTION public.jwt_owns_pdt_sku_am(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.jwt_owns_pdt_sku_am(bigint) TO authenticated;

-- 5c. pdt_fact_sku_period — key (sku_id, periode, basis)
CREATE TABLE pdt_fact_sku_period (
    id                bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sku_id            bigint        NOT NULL REFERENCES pdt_sku_master (id),
    -- Awal bulan (Q-1..Q-6 sesi 2, DECISIONS.md 2026-09-13 Q-3): `date` dipilih supaya
    -- partisi per tahun kelak (P-07, terbuka) = DDL murni, bukan migrasi data. Ambang
    -- tinjau: > 20 juta baris ATAU > 10 GB — dicatat di sini, bukan di kode.
    periode           date          NOT NULL,
    basis             varchar(16)   NOT NULL,
    batch_id          bigint        NOT NULL REFERENCES pdt_upload_batch (id),
    parser_versi      integer       NOT NULL,

    gmv               numeric(15,2) NULL, -- konsumen: report.dimensi_produk, kuadran SKU, px.gerbang_kelayakan (basis dibayar, PDT-19)
    gmv_dari_kreator  numeric(15,2) NULL, -- konsumen: report.channel_mix, PX sinyal afiliasi ("SKU sudah jalan di afiliasi")
    gmv_video_penjual numeric(15,2) NULL, -- konsumen: report.channel_mix
    gmv_live_penjual  numeric(15,2) NULL, -- konsumen: report.channel_mix
    pesanan           integer       NULL, -- konsumen: report.dimensi_pesanan
    pesanan_sku       integer       NULL, -- konsumen: G1-07 rekonsiliasi Σ per-SKU vs shop-level
    produk_terjual    integer       NULL, -- konsumen: report.dimensi_produk_terjual
    impresi           integer       NULL, -- konsumen: report.dimensi_traffic
    klik              integer       NULL, -- konsumen: kuadran SKU sumbu-X (TikTok Klik Produk), report.dimensi_traffic
    ctr               numeric(6,3)  NULL, -- konsumen: report.dimensi_konversi
    ctor              numeric(6,3)  NULL, -- konsumen: report.dimensi_konversi, Co-Pilot L3
    atc               integer       NULL, -- konsumen: report.dimensi_konversi (add-to-cart)
    cr                numeric(6,3)  NULL, -- konsumen: report.dimensi_konversi
    refund            numeric(15,2) NULL, -- konsumen: G1-07 rekonsiliasi
    kuadran           varchar(24)   NULL, -- konsumen: Riset Awal kuadran SKU (hidden gem/bintang/dst., Rule 19 pelacakan lintas bulan)

    CONSTRAINT ck_pdt_fsp_basis CHECK (basis IN ('net', 'dibuat', 'siap_dikirim', 'dibayar'))
);
CREATE UNIQUE INDEX uq_pdt_fact_sku_period ON pdt_fact_sku_period (sku_id, periode, basis);
CREATE INDEX idx_pdt_fsp_batch ON pdt_fact_sku_period (batch_id);

REVOKE ALL ON public.pdt_fact_sku_period FROM anon;
REVOKE ALL ON public.pdt_fact_sku_period FROM authenticated;
GRANT SELECT ON public.pdt_fact_sku_period TO authenticated;
ALTER TABLE public.pdt_fact_sku_period ENABLE ROW LEVEL SECURITY;
CREATE POLICY pdt_fact_sku_period_sel ON public.pdt_fact_sku_period FOR SELECT TO authenticated
  USING (public.jwt_can_read_all()
         OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
         OR public.jwt_owns_pdt_sku_am(sku_id));

-- 5d. pdt_fact_content — key (client_platform_id, platform_content_id)
CREATE TABLE pdt_fact_content (
    id                   bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_platform_id   bigint        NOT NULL REFERENCES client_platforms (id),
    platform_content_id  varchar(128)  NOT NULL, -- 'ID Video' TikTok — konsumen: report.gmv_impact_organik (menutup rantai yang hari ini dibuang)
    batch_id             bigint        NOT NULL REFERENCES pdt_upload_batch (id),
    parser_versi         integer       NOT NULL,

    jenis                varchar(16)   NOT NULL, -- video | live
    creator_platform_id  varchar(128)  NULL,  -- konsumen: pdt_fact_creator_period join, deteksi kebocoran GMV
    creator_handle       varchar(191)  NULL,
    is_akun_toko         boolean       NOT NULL DEFAULT false, -- diturunkan dari client_platforms.akun_konten_toko — pemisah toko-vs-afiliasi (menggantikan pengetikan ulang tiap laporan)
    waktu_posting        timestamptz   NULL,
    sku_id               bigint        NULL REFERENCES pdt_sku_master (id),
    vv                   integer       NULL, -- konsumen: report.dimensi_video/live
    likes                integer       NULL, -- konsumen: report.dimensi_video
    komentar             integer       NULL, -- konsumen: report.dimensi_video
    dibagikan            integer       NULL, -- konsumen: report.dimensi_video
    pengikut_baru        integer       NULL, -- konsumen: report.dimensi_live (channel growth)
    produk_dilihat       integer       NULL, -- konsumen: report.dimensi_konten
    klik_produk          integer       NULL, -- konsumen: kuadran/report.dimensi_konten
    gmv                  numeric(15,2) NULL, -- konsumen: report.gmv_impact_organik, G1-07 sisi konten
    durasi_detik         integer       NULL, -- konsumen: report.dimensi_live (durasi siaran)

    CONSTRAINT ck_pdt_fact_content_jenis CHECK (jenis IN ('video', 'live'))
);
CREATE UNIQUE INDEX uq_pdt_fact_content ON pdt_fact_content (client_platform_id, platform_content_id);
CREATE INDEX idx_pdt_fact_content_batch ON pdt_fact_content (batch_id);
CREATE INDEX idx_pdt_fact_content_sku ON pdt_fact_content (sku_id);

REVOKE ALL ON public.pdt_fact_content FROM anon;
REVOKE ALL ON public.pdt_fact_content FROM authenticated;
GRANT SELECT ON public.pdt_fact_content TO authenticated;
ALTER TABLE public.pdt_fact_content ENABLE ROW LEVEL SECURITY;
CREATE POLICY pdt_fact_content_sel ON public.pdt_fact_content FOR SELECT TO authenticated
  USING (public.jwt_can_read_all()
         OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
         OR public.jwt_owns_client_platform_am(client_platform_id));

-- 5e. pdt_fact_creator_period — key (client_platform_id, creator_handle, periode)
CREATE TABLE pdt_fact_creator_period (
    id                   bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_platform_id   bigint        NOT NULL REFERENCES client_platforms (id),
    creator_handle       varchar(191)  NOT NULL,
    periode              date          NOT NULL, -- awal bulan, sama seperti pdt_fact_sku_period (Q-3)
    batch_id             bigint        NOT NULL REFERENCES pdt_upload_batch (id),
    parser_versi         integer       NOT NULL,

    gmv                  numeric(15,2) NULL, -- konsumen: report.dimensi_kreator, deteksi kebocoran GMV
    gmv_live             numeric(15,2) NULL, -- konsumen: report.dimensi_kreator
    gmv_video            numeric(15,2) NULL, -- konsumen: report.dimensi_kreator
    pesanan_teratribusi  integer       NULL, -- konsumen: report.dimensi_kreator
    aov                  numeric(15,2) NULL, -- konsumen: report.dimensi_kreator
    ctor                 numeric(6,3)  NULL, -- konsumen: Co-Pilot L3
    jumlah_live          integer       NULL, -- konsumen: report.dimensi_kreator
    jumlah_video         integer       NULL, -- konsumen: report.dimensi_kreator
    sampel_terkirim      integer       NULL  -- konsumen: PX sinyal afiliasi ("SKU sudah jalan di afiliasi")
);
CREATE UNIQUE INDEX uq_pdt_fact_creator_period ON pdt_fact_creator_period (client_platform_id, creator_handle, periode);
CREATE INDEX idx_pdt_fact_creator_period_batch ON pdt_fact_creator_period (batch_id);

REVOKE ALL ON public.pdt_fact_creator_period FROM anon;
REVOKE ALL ON public.pdt_fact_creator_period FROM authenticated;
GRANT SELECT ON public.pdt_fact_creator_period TO authenticated;
ALTER TABLE public.pdt_fact_creator_period ENABLE ROW LEVEL SECURITY;
CREATE POLICY pdt_fact_creator_period_sel ON public.pdt_fact_creator_period FOR SELECT TO authenticated
  USING (public.jwt_can_read_all()
         OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
         OR public.jwt_owns_client_platform_am(client_platform_id));

-- 5f. pdt_fact_ads — key (client_platform_id, sumber, kampanye_id, sku_id, content_id, periode)
CREATE TABLE pdt_fact_ads (
    id                  bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_platform_id  bigint        NOT NULL REFERENCES client_platforms (id),
    sumber              varchar(32)   NOT NULL, -- tt_ads_product/tt_ads_live/shopee_ads_cpc/shopee_ads_search/shopee_ads_live/meta_ads
    kampanye_id         varchar(128)  NOT NULL,
    sku_id              bigint        NULL REFERENCES pdt_sku_master (id),
    content_id          bigint        NULL REFERENCES pdt_fact_content (id), -- konsumen: report.dimensi_ads tersambung ke konten (tt_ads_product)
    periode             date          NOT NULL, -- awal bulan (Q-3)
    batch_id            bigint        NOT NULL REFERENCES pdt_upload_batch (id),
    parser_versi        integer       NOT NULL,

    biaya               numeric(15,2) NOT NULL, -- konsumen: report.dimensi_roas 22%, Co-Pilot GMV Max Ads
    tayangan            integer       NULL,     -- konsumen: report.dimensi_roas
    klik                integer       NULL,     -- konsumen: report.dimensi_roas
    pesanan_sku         integer       NULL,     -- konsumen: report.dimensi_roas
    gmv                 numeric(15,2) NULL,     -- konsumen: sisi pendapatan ROAS ("Pendapatan kotor", requireCols wajib tt_ads_product/tt_ads_live)
    roas                numeric(8,3)  NULL,     -- konsumen: report.dimensi_roas, satuan pdt_satuan_t.rasio (F-6 — bukan lagi dicetak "Rp 9,63")

    CONSTRAINT ck_pdt_fact_ads_biaya CHECK (biaya >= 0)
);
CREATE UNIQUE INDEX uq_pdt_fact_ads ON pdt_fact_ads (client_platform_id, sumber, kampanye_id, sku_id, content_id, periode);
CREATE INDEX idx_pdt_fact_ads_batch ON pdt_fact_ads (batch_id);

REVOKE ALL ON public.pdt_fact_ads FROM anon;
REVOKE ALL ON public.pdt_fact_ads FROM authenticated;
GRANT SELECT ON public.pdt_fact_ads TO authenticated;
ALTER TABLE public.pdt_fact_ads ENABLE ROW LEVEL SECURITY;
CREATE POLICY pdt_fact_ads_sel ON public.pdt_fact_ads FOR SELECT TO authenticated
  USING (public.jwt_can_read_all()
         OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
         OR public.jwt_owns_client_platform_am(client_platform_id));

-- ===========================================================================
-- 6. pdt_benchmark — Cermin HURUF PER HURUF adsscanner_benchmark (§6.3,
--    PDT_BACKLOG.md G1-01). Nol seed di sini (G2-02 mengisi versi 1 + UI admin).
-- ===========================================================================
CREATE TABLE pdt_benchmark (
    versi        integer      NOT NULL PRIMARY KEY,
    nilai        jsonb        NOT NULL, -- ambang skor per dimensi — bentuk final menyusul G2-02
    aktif        boolean      NOT NULL DEFAULT true,
    catatan      text         NULL,
    dibuat_pada  timestamptz  NOT NULL DEFAULT now(),
    dibuat_oleh  varchar(64)  NOT NULL DEFAULT 'SYSTEM',
    CONSTRAINT ck_pdt_benchmark_versi CHECK (versi >= 1),
    CONSTRAINT ck_pdt_benchmark_nilai_shape CHECK (jsonb_typeof(nilai) = 'object')
);

COMMENT ON TABLE pdt_benchmark IS
  'Benchmark skor dimensi PDT, berversi, Director-only (pdt.canKelolaBenchmark). Append-only: '
  'kalibrasi baru = versi baru, aktif TIDAK PERNAH dibalik — preseden adsscanner_benchmark/'
  'px_eligibility_policy huruf per huruf. Versi aktif dibaca where aktif=true order by versi '
  'desc limit 1 (Rule 23). Ganti versi ⇒ laporan BELUM terkirim ikut versi baru otomatis; yang '
  'sudah terkirim (pdt_laporan_kiriman) tetap memakai benchmark_versi saat pengiriman.';

CREATE OR REPLACE FUNCTION pdt_benchmark_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    RAISE EXCEPTION 'pdt_benchmark: append-only — kalibrasi baru = versi baru, versi lama immutable, aktif tidak pernah dibalik (Rule 25, preseden adsscanner_benchmark)';
END;
$$;
CREATE TRIGGER trg_pdt_benchmark_frozen BEFORE UPDATE OR DELETE ON pdt_benchmark
    FOR EACH ROW EXECUTE FUNCTION pdt_benchmark_frozen();

REVOKE ALL ON public.pdt_benchmark FROM anon;
REVOKE ALL ON public.pdt_benchmark FROM authenticated;
ALTER TABLE public.pdt_benchmark ENABLE ROW LEVEL SECURITY;
-- NOL policy (variant A, default-deny) — dibaca/ditulis HANYA service-role saat menskor;
-- gerbang Director di domain (pdt.canKelolaBenchmark).

-- ===========================================================================
-- 7. pdt_usulan_katalog — katalog aksi (§6.3, G4-01). Struktur lahir di sini;
--    ≥6 aksi Shopee (Rule 30) + UI admin menyusul G4. Nol seed (mencegah G1
--    mendahului G4).
-- ===========================================================================
CREATE TABLE pdt_usulan_katalog (
    kode             varchar(64)   NOT NULL PRIMARY KEY,
    platform_berlaku text[]        NOT NULL, -- Rule 29: aksi WAJIB menyatakan platform_berlaku eksplisit
    kondisi          jsonb         NOT NULL, -- syarat deterministik (Rule 32: nol komponen LLM)
    metrik_kunci     varchar(64)   NOT NULL,
    satuan           pdt_satuan_t  NOT NULL,
    target_formula   jsonb         NOT NULL,
    divisi_tujuan    varchar(32)   NOT NULL,
    aktif            boolean       NOT NULL DEFAULT true,
    dibuat_pada      timestamptz   NOT NULL DEFAULT now(),
    dibuat_oleh      varchar(64)   NOT NULL DEFAULT 'SYSTEM',

    CONSTRAINT ck_pdt_usulan_katalog_platform CHECK (
      platform_berlaku <@ ARRAY['tiktok', 'shopee', 'meta']::text[] AND array_length(platform_berlaku, 1) >= 1
    ),
    CONSTRAINT ck_pdt_usulan_katalog_kondisi_shape CHECK (jsonb_typeof(kondisi) = 'object'),
    CONSTRAINT ck_pdt_usulan_katalog_formula_shape CHECK (jsonb_typeof(target_formula) = 'object')
);

COMMENT ON TABLE pdt_usulan_katalog IS
  'Katalog aksi usulan (pengganti AM Co-Pilot HTML, G4-01). Struktur tabel lahir di G1-01; '
  'pengisian ≥6 aksi khusus Shopee (Rule 30) menyusul G4-03 — nol seed di sini.';

REVOKE ALL ON public.pdt_usulan_katalog FROM anon;
REVOKE ALL ON public.pdt_usulan_katalog FROM authenticated;
ALTER TABLE public.pdt_usulan_katalog ENABLE ROW LEVEL SECURITY;
-- NOL policy (variant A, default-deny, PDT_BACKLOG.md G1-01) — dibaca/ditulis service-role;
-- gerbang Director di domain. TIDAK diberi trigger frozen (bukan append-only seperti
-- pdt_benchmark) — kondisi/target_formula memang dimaksud diedit lewat UI admin G4-01.

-- ===========================================================================
-- 8. pdt_usulan — evaluasi aksi per batch (§6.4, Rule 31 loop evaluasi)
-- ===========================================================================
CREATE TABLE pdt_usulan (
    id               bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_id         bigint        NOT NULL REFERENCES pdt_upload_batch (id),
    kode_aksi        varchar(64)   NOT NULL REFERENCES pdt_usulan_katalog (kode),
    nilai_sekarang   numeric(15,3) NOT NULL,
    satuan_sekarang  pdt_satuan_t  NOT NULL,
    target_nilai     numeric(15,3) NOT NULL,
    satuan_target    pdt_satuan_t  NOT NULL,
    realisasi_nilai  numeric(15,3) NULL,
    verdict          varchar(24)   NULL, -- null/tidak_dikerjakan/gagal/tercapai (Rule 31)
    dievaluasi_pada  timestamptz   NULL,
    plan_ref         varchar(32)   NULL,
    brief_ref        varchar(32)   NULL,
    dibuat_pada      timestamptz   NOT NULL DEFAULT now(),
    dibuat_oleh      varchar(64)   NOT NULL DEFAULT 'SYSTEM', -- usulan digenerate mesin evaluasi (Flow C), bukan diketik AM

    CONSTRAINT ck_pdt_usulan_verdict CHECK (verdict IS NULL OR verdict IN ('tidak_dikerjakan', 'gagal', 'tercapai'))
);
CREATE INDEX idx_pdt_usulan_batch ON pdt_usulan (batch_id);
CREATE INDEX idx_pdt_usulan_kode ON pdt_usulan (kode_aksi);

COMMENT ON TABLE pdt_usulan IS
  'Loop evaluasi usulan (Rule 31): tidak_dikerjakan (masalah tim) vs gagal (masalah taktik) — '
  'satu-satunya sinyal yang membedakan keduanya, dan hari ini tidak pernah jalan di Co-Pilot lama.';

REVOKE ALL ON public.pdt_usulan FROM anon;
REVOKE ALL ON public.pdt_usulan FROM authenticated;
GRANT SELECT ON public.pdt_usulan TO authenticated;
ALTER TABLE public.pdt_usulan ENABLE ROW LEVEL SECURITY;
CREATE POLICY pdt_usulan_sel ON public.pdt_usulan FOR SELECT TO authenticated
  USING (public.jwt_can_read_all()
         OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
         OR public.jwt_owns_pdt_batch_am(batch_id));

-- ===========================================================================
-- 9. pdt_laporan_kiriman — snapshot beku HANYA saat dikirim ke klien (§6.4,
--    Rule 21-23, PDT-21). Pola client_reports_frozen (UPDATE-only, DELETE
--    tetap terbuka — sama seperti preseden client_reports).
-- ===========================================================================
CREATE TABLE pdt_laporan_kiriman (
    id                      bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_platform_id      bigint       NOT NULL REFERENCES client_platforms (id),
    periode_mulai           date         NOT NULL,
    periode_selesai         date         NOT NULL,
    payload                 jsonb        NOT NULL, -- snapshot beku (Rule 21-22) — laporan HARIAN adalah view; ini beku hanya saat kirim
    parser_versi            integer      NOT NULL,
    benchmark_versi         integer      NOT NULL REFERENCES pdt_benchmark (versi),
    dikirim_pada            timestamptz  NOT NULL DEFAULT now(),
    dikirim_oleh            varchar(64)  NOT NULL REFERENCES employees (employee_id),
    menggantikan_kiriman_id bigint       NULL REFERENCES pdt_laporan_kiriman (id),

    CONSTRAINT ck_pdt_laporan_kiriman_periode CHECK (periode_selesai >= periode_mulai),
    CONSTRAINT ck_pdt_laporan_kiriman_payload_shape CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX idx_pdt_laporan_kiriman_platform ON pdt_laporan_kiriman (client_platform_id, periode_selesai DESC);

COMMENT ON TABLE pdt_laporan_kiriman IS
  'Snapshot laporan TERKIRIM (Rule 22) — append-only, pola client_reports_frozen. Revisi = baris '
  'baru menunjuk menggantikan_kiriman_id (Flow B langkah 5), TIDAK meminta berkas ulang (Rule 23).';

CREATE OR REPLACE FUNCTION pdt_laporan_kiriman_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    RAISE EXCEPTION 'pdt_laporan_kiriman: baris laporan terkirim immutable (Rule 22, aturan rumah #3/#4) — revisi = baris baru menunjuk menggantikan_kiriman_id';
END;
$$;
CREATE TRIGGER trg_pdt_laporan_kiriman_frozen BEFORE UPDATE ON pdt_laporan_kiriman
    FOR EACH ROW EXECUTE FUNCTION pdt_laporan_kiriman_frozen();

REVOKE ALL ON public.pdt_laporan_kiriman FROM anon;
REVOKE ALL ON public.pdt_laporan_kiriman FROM authenticated;
GRANT SELECT ON public.pdt_laporan_kiriman TO authenticated;
ALTER TABLE public.pdt_laporan_kiriman ENABLE ROW LEVEL SECURITY;
CREATE POLICY pdt_laporan_kiriman_sel ON public.pdt_laporan_kiriman FOR SELECT TO authenticated
  USING (public.jwt_can_read_all()
         OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
         OR public.jwt_owns_client_platform_am(client_platform_id));

-- ===========================================================================
-- 10. Perubahan pada tabel yang sudah ada (§6.5)
-- ===========================================================================
ALTER TABLE client_platforms ADD COLUMN akun_konten_toko jsonb NULL;
COMMENT ON COLUMN client_platforms.akun_konten_toko IS
  'PDT G1-06 (Rule 3-4): daftar ID Kreator/handle akun konten toko TikTok. Diisi SEKALI saat '
  'batch TikTok pertama (status identitas_belum_terikat → AM konfirmasi usulan sistem → terikat '
  'permanen) — menggantikan linked_accounts yang selama ini diketik ulang di setiap request '
  'laporan/baseline. NULL = belum terikat.';

ALTER TABLE client_platforms ADD COLUMN shop_username text NULL;
COMMENT ON COLUMN client_platforms.shop_username IS
  'PDT G1-06 (Rule 2): Username toko dari preamble export Shopee, dipakai bersama shop_id untuk '
  'validasi identitas batch. NULL = belum ada batch Shopee terverifikasi.';

-- clients.target_gmv SUDAH ADA sejak wave1_money_path — PDT membacanya, nol migrasi (§6.5).

-- ===========================================================================
-- 11. Gerbang CI — ringkasan perubahan (bump bersama .github/workflows/ci.yml
--     dan scripts/db-rebuild.sh dalam commit yang sama, pelajaran PR #170/#335):
--       public base tables : 161 → 175  (+14: pdt_parser_modul, pdt_kolom_alias,
--         pdt_upload_batch, pdt_file, pdt_fact_shop_daily, pdt_sku_master,
--         pdt_fact_sku_period, pdt_fact_content, pdt_fact_creator_period,
--         pdt_fact_ads, pdt_benchmark, pdt_usulan_katalog, pdt_usulan,
--         pdt_laporan_kiriman)
--       entity_prefix      : 44 → 44  (nol prefix baru — seluruh tabel PDT
--         bigint identity atau berkunci alami, koreksi K-2)
--       sm_machines        : 35 → 35  (nol lifecycle ber-sm_transition — status
--         pdt_upload_batch ditulis domain langsung, preseden M19 dailyops)
--       notif_events       : 74 → 74  (nol event notifikasi baru di tiket ini)
-- ===========================================================================
