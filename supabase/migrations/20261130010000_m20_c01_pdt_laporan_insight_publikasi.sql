-- M20 Gelombang C-01 (docs/plan/PLAN_PORT_M14_KE_PDT.md, PRD docs/prd/CDPS_Module20_PDT_Laporan_Klien.md
-- R3-R5): dua tabel baru + satu mesin `pdt_laporan`, supaya AM bisa menyunting
-- narasi laporan PDT dan menerbitkannya ke klien lewat paku revisi — TANPA
-- pernah menyentuh `pdt_laporan_kiriman`, yang tetap beku total (R5).
--
-- `pdt_laporan_insight` (append-only, revisi 0 = mesin, revisi >0 = AM) dan
-- `pdt_laporan_publikasi` (status hidup DI SINI, bukan di kiriman) adalah dua
-- objek TERPISAH karena punya arah tulis yang berbeda: insight bertambah tanpa
-- batas (setiap suntingan = baris baru), publikasi punya TEPAT SATU baris per
-- kiriman yang bergerak lewat sm_transition. Menyatukan keduanya berarti status
-- publikasi ikut "append-only", yang salah — status memang harus bisa berubah
-- (Draf → Terbit ⇄ Dicabut).
--
-- Nol prefix baru (K-2 PDT, koreksi 2026-09) — kedua tabel bigint identity /
-- kiriman_id sebagai kunci, sama seperti `pdt_laporan_kiriman` sendiri.

-- ===========================================================================
-- 1. Mesin `pdt_laporan` — [Draf] → [Terbit] ⇄ [Dicabut], NOL terminal state
--    (PRD R5: laporan tercabut harus bisa dikoreksi lalu diterbitkan lagi).
--
--    Ketiga edge require_lead/require_director = false: gerbang siapa-boleh
--    BUKAN peran generik di sini (beda dari kebanyakan mesin) — ia adalah
--    `canKirimLaporan` (AM pemilik toko ATAU Lead/Director Account, PRD §5),
--    yang lebih sempit daripada "siapa saja level lead". Predikat itu
--    dievaluasi di TS SEBELUM memanggil `sm_transition` (pola sama
--    `submitRisetAwal`/`canWriteInterview`), jadi mengunci edge ke
--    `require_lead: true` di sini akan menolak AM staf pemilik toko yang
--    justru PALING berhak menerbitkan laporannya sendiri.
-- ===========================================================================
INSERT INTO sm_machines (name, initial_state, auto_computed, flags) VALUES
    ('pdt_laporan', '[Draf]', false, '{}');

INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('pdt_laporan', '[Draf]',    '[Terbit]',  false),
    ('pdt_laporan', '[Terbit]',  '[Dicabut]', false),
    ('pdt_laporan', '[Dicabut]', '[Terbit]',  false);

-- ===========================================================================
-- 2. Helper kepemilikan — pola sama `jwt_owns_pdt_batch_am`
--    (20261011010000_g1_01_pdt_tables.sql §3): menumpang `jwt_owns_client_platform_am`
--    yang sudah ada, bukan menduplikasi logikanya.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.jwt_owns_pdt_kiriman_am(p_kiriman_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1 FROM public.pdt_laporan_kiriman k
     WHERE k.id = p_kiriman_id AND public.jwt_owns_client_platform_am(k.client_platform_id))
$$;
REVOKE EXECUTE ON FUNCTION public.jwt_owns_pdt_kiriman_am(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.jwt_owns_pdt_kiriman_am(bigint) TO authenticated;

-- ===========================================================================
-- 3. pdt_laporan_insight — append-only (R3). `(revisi = 0) = (sumber = 'mesin')`
--    menegakkan di SKEMA (bukan cuma di TS) bahwa revisi 0 SELALU narasi mesin
--    dan setiap revisi berikutnya SELALU suntingan AM — jadi "reset ke narasi
--    mesin" (tombol FE, C-04) tidak bisa dipalsukan sebagai revisi 0 baru; ia
--    menulis revisi BARU yang isinya SALINAN revisi 0, sumber tetap 'am'.
--
--    UPDATE **dan** DELETE diblok (pola `pdt_kolom_alias_frozen`, BUKAN pola
--    `pdt_laporan_kiriman_frozen` yang UPDATE-only) — insight tidak punya
--    semantik "digantikan_oleh" seperti kiriman; satu-satunya arah adalah baris
--    baru dengan `revisi` lebih tinggi.
-- ===========================================================================
CREATE TABLE pdt_laporan_insight (
    id                  bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kiriman_id          bigint      NOT NULL REFERENCES pdt_laporan_kiriman (id),
    revisi              integer     NOT NULL,
    sumber              varchar(16) NOT NULL,
    ringkasan           text        NOT NULL,
    poin                jsonb       NOT NULL,
    rekomendasi_tinggi  jsonb       NOT NULL,
    rekomendasi_sedang  jsonb       NOT NULL,
    outlook             text        NOT NULL,
    indikator           jsonb       NOT NULL,
    tahap_narasi        text        NULL,
    ditulis_oleh        varchar(64) NOT NULL REFERENCES employees (employee_id),
    ditulis_pada        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ck_pdt_laporan_insight_sumber        CHECK (sumber IN ('mesin', 'am')),
    CONSTRAINT ck_pdt_laporan_insight_revisi_nonneg CHECK (revisi >= 0),
    CONSTRAINT ck_pdt_laporan_insight_revisi_sumber CHECK ((revisi = 0) = (sumber = 'mesin')),
    CONSTRAINT ck_pdt_laporan_insight_poin_array    CHECK (jsonb_typeof(poin) = 'array'),
    CONSTRAINT ck_pdt_laporan_insight_rekt_array    CHECK (jsonb_typeof(rekomendasi_tinggi) = 'array'),
    CONSTRAINT ck_pdt_laporan_insight_reks_array    CHECK (jsonb_typeof(rekomendasi_sedang) = 'array'),
    -- indikator adalah ARRAY {nama,target}[] (PdtLaporanInsight.indikator), BUKAN satu objek.
    CONSTRAINT ck_pdt_laporan_insight_indikator_arr CHECK (jsonb_typeof(indikator) = 'array'),
    CONSTRAINT uq_pdt_laporan_insight_kiriman_revisi UNIQUE (kiriman_id, revisi)
);
CREATE INDEX idx_pdt_laporan_insight_kiriman ON pdt_laporan_insight (kiriman_id, revisi DESC);

COMMENT ON TABLE pdt_laporan_insight IS
  'M20 R3 — revisi narasi laporan PDT, append-only. revisi 0 = narasi mesin, ditulis_oleh = '
  'dikirim_oleh kiriman induknya (lazy-seeded dari payload.insight untuk kiriman lama yang belum '
  'punya baris ini — revisi 0 tidak punya "penulis" manusia sendiri, ditulis_oleh ber-FK employees '
  'jadi tidak bisa literal SYSTEM), revisi>0 = suntingan AM. Angka (GMV/ROAS/skor/funnel/kuadran) '
  'TIDAK ADA di sini — tabel ini murni naratif, R3.';

CREATE OR REPLACE FUNCTION pdt_laporan_insight_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    RAISE EXCEPTION 'pdt_laporan_insight: append-only (M20 R3, aturan rumah #3) — revisi baru, bukan UPDATE/DELETE';
END;
$$;
CREATE TRIGGER trg_pdt_laporan_insight_frozen BEFORE UPDATE OR DELETE ON pdt_laporan_insight
    FOR EACH ROW EXECUTE FUNCTION pdt_laporan_insight_frozen();

REVOKE ALL ON public.pdt_laporan_insight FROM anon;
REVOKE ALL ON public.pdt_laporan_insight FROM authenticated;
GRANT SELECT ON public.pdt_laporan_insight TO authenticated;
ALTER TABLE public.pdt_laporan_insight ENABLE ROW LEVEL SECURITY;
CREATE POLICY pdt_laporan_insight_sel ON public.pdt_laporan_insight FOR SELECT TO authenticated
  USING (public.jwt_can_read_all()
         OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
         OR public.jwt_owns_pdt_kiriman_am(kiriman_id));

-- ===========================================================================
-- 4. pdt_laporan_publikasi — SATU baris per kiriman (R5). `status` ditulis
--    EKSKLUSIF oleh `sm_transition` (rule sama seluruh mesin lain: satu-satunya
--    UPDATE dinamis di sm_transition menyentuh HANYA kolom status); kolom lain
--    (insight_revisi/diterbitkan_pada/diterbitkan_oleh/alasan_cabut) ditulis
--    oleh domain lewat UPDATE biasa di TRANSAKSI YANG SAMA, tepat setelah
--    sm_transition sukses — pola sama `stampRisetAwalSubmit` mendahului
--    `statemachine.transition` di `submitRisetAwal`.
--
--    FK komposit (kiriman_id, insight_revisi) → pdt_laporan_insight(kiriman_id,
--    revisi) menegakkan DI SKEMA bahwa paku (R4) tidak pernah menunjuk revisi
--    yang tidak ada — bukan sekadar disiplin TS.
-- ===========================================================================
CREATE TABLE pdt_laporan_publikasi (
    kiriman_id        bigint      NOT NULL PRIMARY KEY REFERENCES pdt_laporan_kiriman (id),
    status            varchar(16) NOT NULL DEFAULT '[Draf]',
    insight_revisi    integer     NOT NULL DEFAULT 0,
    diterbitkan_pada  timestamptz NULL,
    diterbitkan_oleh  varchar(64) NULL REFERENCES employees (employee_id),
    alasan_cabut      text        NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        varchar(64) NOT NULL DEFAULT 'SYSTEM',

    CONSTRAINT ck_pdt_laporan_publikasi_status        CHECK (status IN ('[Draf]', '[Terbit]', '[Dicabut]')),
    CONSTRAINT ck_pdt_laporan_publikasi_revisi_nonneg CHECK (insight_revisi >= 0),
    -- Dicabut WAJIB membawa alasan (PRD §5 "Cabut ... wajib mengisi alasan"); Draf/Terbit tidak.
    CONSTRAINT ck_pdt_laporan_publikasi_alasan_cabut  CHECK (status <> '[Dicabut]' OR alasan_cabut IS NOT NULL),
    CONSTRAINT fk_pdt_laporan_publikasi_insight_revisi
        FOREIGN KEY (kiriman_id, insight_revisi) REFERENCES pdt_laporan_insight (kiriman_id, revisi)
);

COMMENT ON TABLE pdt_laporan_publikasi IS
  'M20 R4/R5 — status publikasi + paku revisi (insight_revisi) per kiriman. Render mode klien '
  'membaca revisi TERPAKU di sini, bukan yang terbaru di pdt_laporan_insight (R4); pratinjau '
  'internal membaca yang terbaru. status ditulis EKSKLUSIF sm_transition, mesin pdt_laporan.';

REVOKE ALL ON public.pdt_laporan_publikasi FROM anon;
REVOKE ALL ON public.pdt_laporan_publikasi FROM authenticated;
GRANT SELECT ON public.pdt_laporan_publikasi TO authenticated;
ALTER TABLE public.pdt_laporan_publikasi ENABLE ROW LEVEL SECURITY;
CREATE POLICY pdt_laporan_publikasi_sel ON public.pdt_laporan_publikasi FOR SELECT TO authenticated
  USING (public.jwt_can_read_all()
         OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
         OR public.jwt_owns_pdt_kiriman_am(kiriman_id));

-- ===========================================================================
-- 5. Gerbang CI — ringkasan perubahan (bump bersama .github/workflows/ci.yml
--    dan scripts/db-rebuild.sh dalam commit yang sama, pelajaran PR #170/#335):
--      public base tables : 184 → 186  (+2: pdt_laporan_insight, pdt_laporan_publikasi)
--      sm_machines         : 35 → 36   (+1: pdt_laporan)
--      entity_prefix       : 45 → 45   (nol prefix baru — K-2 PDT, bigint identity/kiriman_id)
--      notif_events        : 79 → 79   (nol event notifikasi baru di tiket ini — PRD M20 tidak
--        menyebut satu pun event notifikasi untuk terbit/cabut; kandidat tiket lanjutan)
-- ===========================================================================
