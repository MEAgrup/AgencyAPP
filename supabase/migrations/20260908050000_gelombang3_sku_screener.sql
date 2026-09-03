-- ============================================================================
-- Gelombang 3 (SKU Screener) — SC-01..SC-07: prefix registry + schema for
-- Modul A/B (`screening_run`), Modul C (`ads_decision_log`, `ADL-`) and
-- Modul D (`optimization_tracker`).
--
-- Sources: docs/plan/PLAN_KONSOLIDASI_ALAT_ADVERTISER.md §6,
-- docs/design/PRD_MEA_SKU_SCREENER_v1.0.md §5.2/§5.3, docs/design/README.md,
-- docs/DECISIONS.md (O66, SC-00/SCR-1..SCR-10).
--
-- SCOPE OF THIS MIGRATION: schema + prefix registry only. The pure R01-R12
-- math/validation this schema stores the RESULT of lives in
-- `packages/core/src/skuscreener/`. There is NO domain/route layer writing to
-- these tables yet (that is a later ticket, SC-08 UI included) — writes here
-- are service-role only until then, exactly like every other CDPS table
-- before its domain module lands (see `renewal_requests` for the same
-- schema-first shape). NOT applied to the live Supabase project this pass —
-- local `scripts/db-rebuild.sh` verification only.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Prefix registry: entity_prefix 37 → 39 (SCR, ADL). MUST stay identical to
--    `PREFIXES` in packages/core/src/ident.ts (M6A §7, ident.registry.test.ts
--    checks both directions) — bumped together in this SAME commit, per the
--    PR #170 near-miss warning (one gate updated, the other forgotten).
-- ---------------------------------------------------------------------------
INSERT INTO entity_prefix (prefix, entity_name, module) VALUES
    ('SCR', 'Screening run (SKU Screener Modul A/B)', 'Gelombang 3 (SKU Screener)'),
    ('ADL', 'Ads Decision Log entry (SKU Screener Modul C)', 'Gelombang 3 (SKU Screener)');

-- ---------------------------------------------------------------------------
-- 2. screening_run (SCR-) — Modul A (screening/routing) AND Modul B
--    (sebelum/sesudah) share this ONE table/prefix, disambiguated by `jenis`
--    (plan §6: "dipakai Modul A dan B lewat kolom jenis" — not two prefixes).
--
--    Computed output (R04 medians, per-SKU routes/CPC-max for Modul A, or
--    per-pair deltas/verdicts for Modul B) is stored as a FROZEN `payload`
--    jsonb — same shape of decision as `client_reports.payload` (house rule
--    #4: computed, never user-typed, always recomputable from the export the
--    run was built from). A run is a point-in-time analysis of an uploaded
--    export; there is no "edit a run" concept in either Module A or B of the
--    shipped tool — a changed input means a NEW run, not a mutated old one —
--    so the whole row is frozen (mirrors `client_reports_frozen`), not just
--    `payload`.
--
--    `sumber_berkas` follows the RAB-04 pattern used by baseline/report:
--    parse happens in the browser, the server never sees or stores the
--    binary — only `{nama_berkas, sha256, ukuran_bytes, peran}` provenance
--    per uploaded file (peran ∈ 'performa_produk'/'iklan_cpc' for Modul A,
--    'sebelum'/'sesudah' for Modul B). Supabase Storage is still not wired up
--    (plan §9) — this is provenance, not a file store.
-- ---------------------------------------------------------------------------
CREATE TABLE screening_run (
    id                 varchar(32)   NOT NULL PRIMARY KEY,   -- SCR-YYYYMM-NNNN
    client_id          varchar(32)   NOT NULL,
    jenis              varchar(16)   NOT NULL,                -- 'screening' (Modul A) | 'perbandingan' (Modul B)
    -- Modul A inputs (Flow A3/R06) — NULL for jenis='perbandingan'.
    target_roas        numeric(8,2)  NULL,
    cpc_pasar_kategori numeric(15,2) NULL,                    -- optional even within Modul A (Flow A3)
    faktor_cr_iklan    numeric(6,2)  NULL,
    -- Modul B input (Flow B1/R10) — NULL for jenis='screening'.
    min_klik_sesudah   integer       NULL,
    payload_schema     varchar(48)   NOT NULL DEFAULT 'cdps.skuscreener.v1',
    payload            jsonb         NOT NULL,                -- computed: medians (Modul A) / matched pairs (Modul B)
    sumber_berkas      jsonb         NOT NULL,                -- [{nama_berkas, sha256, ukuran_bytes, peran}]
    created_at         timestamptz   NOT NULL DEFAULT now(),
    created_by         varchar(64)   NOT NULL,
    CONSTRAINT fk_scr_client FOREIGN KEY (client_id) REFERENCES clients (id),
    CONSTRAINT ck_scr_jenis CHECK (jenis IN ('screening', 'perbandingan')),
    CONSTRAINT ck_scr_screening_inputs CHECK (
        jenis <> 'screening' OR (target_roas IS NOT NULL AND faktor_cr_iklan IS NOT NULL)),
    CONSTRAINT ck_scr_perbandingan_inputs CHECK (
        jenis <> 'perbandingan' OR min_klik_sesudah IS NOT NULL),
    CONSTRAINT ck_scr_payload_shape CHECK (jsonb_typeof(payload) = 'object'),
    CONSTRAINT ck_scr_sumber_shape CHECK (jsonb_typeof(sumber_berkas) = 'array')
);

CREATE INDEX idx_scr_client ON screening_run (client_id, jenis, created_at DESC);

CREATE TRIGGER trg_screening_run_frozen BEFORE UPDATE ON screening_run
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER trg_screening_run_no_delete BEFORE DELETE ON screening_run
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

COMMENT ON TABLE screening_run IS
  'Gelombang 3 Modul A/B — satu baris per RUN screening (jenis=screening) atau '
  'perbandingan (jenis=perbandingan). Payload beku (trigger): angka dihitung '
  'packages/core/src/skuscreener/, tidak pernah diedit — input berubah = run baru.';

-- ---------------------------------------------------------------------------
-- 3. ads_decision_log (ADL-) — Modul C, R13-R16.
--
--    APPEND-ONLY (R13: "Log bersifat append-only — baris yang sudah ada
--    tidak boleh diedit atau dihapus"), forbid_mutation on UPDATE + DELETE,
--    mirrors `client_report_insight`'s pattern exactly.
--
--    ⚠️ JUDGMENT CALL (flagged in the handoff report): R13's append-only rule
--    sits in tension with Flow C3 ("Setelah 7 hari, isi kolom Verdict dan GMV
--    7 hari" — which reads as amending the SAME row). Rather than silently
--    picking a side, this schema keeps R13's append-only guarantee (it is the
--    rule explicitly numbered and the one the porting brief calls out
--    verbatim) and represents the 7-day follow-up as a SEPARATE row: `momen`
--    gets a 5th value ('review_7_hari') beyond R13's 4 mandatory moments, and
--    `reviews_decision_id` self-references the decision row being reviewed.
--    This is the same shape as `client_report_insight`'s revision rows (new
--    row, not a mutated old one) — confirm with the owner whether a review
--    should instead read as an update to the ORIGINAL row (which would
--    require relaxing R13, a PRD deviation that needs a DECISIONS.md entry,
--    not something to decide silently in a migration).
--
--    `OPT-` (M8 Optimization Log) vs `ADL-` — deliberately TWO tables, not
--    one, not a spectrum of the same thing:
--      - `OPT-` (`optimization_logs`, M8): a log of changes made to an
--        already-RUNNING ad campaign (`ad_campaigns`/`ADC-`) — budget bump,
--        targeting tweak, creative swap, schedule change. It always has a
--        `campaign_id` and lives entirely inside a campaign's lifetime.
--      - `ADL-` (this table): a PRE-campaign, PER-SKU decision LADDER (R15)
--        — "should this SKU go to ads at all, and at what stage" — anchored
--        to a SKU/object, not a campaign, and spans the time BEFORE a
--        campaign exists as well as decisions made about a candidate/paused
--        campaign (R15''s scale-up/hold/reduce/pause ladder references ROAS
--        vs the client''s PHASE TARGET, not a specific ADC- row).
--    Different anchors (SKU vs campaign), different granularity (a ladder of
--    advisory decisions vs a changelog of applied settings), different
--    lifecycle (spans pre- through active-campaign vs campaign-scoped only).
--    Extending `OPT-` to cover R13-R16 would force every pre-campaign
--    decision to fake a `campaign_id`, and would mix M8's execution log with
--    a decision-audit trail that Lead Advertiser reviews weekly for
--    compliance (PRD §3.3 C4) — a different read pattern with a different
--    audience. Kept apart on purpose; do not unify.
--
--    R16 (batas kampanye aktif = budget_mingguan ÷ Rp350.000) is a computed
--    CHECK against `ad_campaigns`/client budget data at READ time, not a
--    stored column here — same "derived, not stored" house rule #4 as every
--    other rollup in CDPS.
-- ---------------------------------------------------------------------------
CREATE TABLE ads_decision_log (
    id                   varchar(32)   NOT NULL PRIMARY KEY,   -- ADL-YYYYMM-NNNN
    client_id            varchar(32)   NOT NULL,
    screening_id         varchar(32)   NULL,                    -- optional link back to the screening_run that surfaced this SKU
    advertiser_id        varchar(64)   NOT NULL,                -- employee id (PRD's advertiser_name enum → FK to employee, house convention)
    platform             varchar(16)   NOT NULL,
    object_type          varchar(16)   NOT NULL,
    object_name          varchar(120)  NOT NULL,
    momen                varchar(24)   NOT NULL,                -- R13's 4 mandatory moments + 'review_7_hari' (Flow C3, see note above)
    sop_stage            varchar(24)   NOT NULL,
    decision             varchar(32)   NOT NULL,
    metric_key           varchar(24)   NOT NULL,
    metric_value         numeric(18,4) NOT NULL,
    metric_target        numeric(18,4) NOT NULL,
    status_vs_target     varchar(20)   NOT NULL,                -- computed at write time, stored as a real value (house convention, never a formula)
    spend_7d             numeric(18,2) NULL,
    gmv_7d               numeric(18,2) NULL,
    roas_result          numeric(12,4) NULL,                    -- computed gmv_7d/spend_7d; NULL (not 0/Infinity) when spend_7d is absent or 0 — house rule #7
    verdict              varchar(20)   NULL,
    reviews_decision_id  varchar(32)   NULL,                    -- set only when momen='review_7_hari' — the ADL- row this review completes
    premature            boolean       NOT NULL DEFAULT false,  -- R14: <50 klik AND <3 konversi AND <3 hari jalan
    notes                varchar(300)  NULL,
    created_at           timestamptz   NOT NULL DEFAULT now(),
    created_by           varchar(64)   NOT NULL,
    CONSTRAINT fk_adl_client FOREIGN KEY (client_id) REFERENCES clients (id),
    CONSTRAINT fk_adl_screening FOREIGN KEY (screening_id) REFERENCES screening_run (id),
    CONSTRAINT fk_adl_reviews FOREIGN KEY (reviews_decision_id) REFERENCES ads_decision_log (id),
    CONSTRAINT ck_adl_platform CHECK (platform IN ('Shopee', 'TikTok', 'Meta', 'Google')),
    CONSTRAINT ck_adl_object_type CHECK (object_type IN ('SKU', 'Kampanye', 'Kreator', 'Konten')),
    CONSTRAINT ck_adl_momen CHECK (momen IN ('masuk_iklan', 'mulai_test', 'scale_turun_kill', 'jeda_restart', 'review_7_hari')),
    CONSTRAINT ck_adl_sop_stage CHECK (sop_stage IN ('1-Screening SKU', '2-Setup Test', '3-Evaluasi', '4-Scale', '5-Kill')),
    CONSTRAINT ck_adl_decision CHECK (decision IN (
        'Loloskan ke iklan', 'Tolak', 'Mulai test', 'Naikkan budget', 'Turunkan budget',
        'Ubah target ROAS', 'Ganti kreatif', 'Pause', 'Biarkan', 'Eskalasi ke lead')),
    CONSTRAINT ck_adl_metric_key CHECK (metric_key IN ('ROAS', 'ACOS', 'CTR', 'CR', 'GMV', 'Biaya per konversi', 'Pesanan', 'Views')),
    CONSTRAINT ck_adl_status_vs_target CHECK (status_vs_target IN ('SESUAI', 'DI BAWAH TARGET', 'DI ATAS TARGET')),
    CONSTRAINT ck_adl_verdict CHECK (verdict IS NULL OR verdict IN ('Berhasil', 'Gagal', 'Belum cukup data')),
    -- a review row must point to what it reviews; a non-review row must not
    -- (see the judgment-call note above this table).
    CONSTRAINT ck_adl_review_shape CHECK ((momen = 'review_7_hari') = (reviews_decision_id IS NOT NULL))
);

CREATE INDEX idx_adl_client ON ads_decision_log (client_id, created_at DESC);
CREATE INDEX idx_adl_screening ON ads_decision_log (screening_id) WHERE screening_id IS NOT NULL;
CREATE INDEX idx_adl_reviews ON ads_decision_log (reviews_decision_id) WHERE reviews_decision_id IS NOT NULL;

CREATE TRIGGER trg_adl_no_update BEFORE UPDATE ON ads_decision_log
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER trg_adl_no_delete BEFORE DELETE ON ads_decision_log
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

COMMENT ON TABLE ads_decision_log IS
  'Gelombang 3 Modul C (R13-R16) — decision ladder PRA-kampanye per SKU, '
  'append-only. BUKAN OPT- (M8): OPT- adalah log kampanye yang SUDAH JALAN, '
  'ADL- adalah tangga keputusan per-SKU sebelum/di sepanjang siklus itu. Lihat '
  'komentar di atas CREATE TABLE untuk alasan lengkap dua entitas terpisah.';

-- ---------------------------------------------------------------------------
-- 4. optimization_tracker (Modul D, §5.3) — child of screening_run, keyed
--    (screening_id, product_code), NO prefix of its own (plan §6 explicit).
--
--    Unlike ads_decision_log this table IS mutated over its life (Flow
--    D1→D4: created with `before_*`/`initial_route` only, `after_*` filled in
--    ≥14 days later, `verdict`/`delta_*` computed once `after_*` lands) — a
--    tracker row, not a log entry, so `set_updated_at` applies (no
--    forbid_mutation here; contrast with the two tables above).
--
--    `product_code` is NOT NULL despite PRD §5.3 marking `product_code`
--    optional with `product_name` as fallback key: the composite PK needs a
--    non-null value, so the app layer stores R09's resolved key here (the
--    real Kode Produk when present, else `normalizeProductName(product_name)`
--    from `packages/core/src/skuscreener/compare.ts#skuKey`) — the SAME value
--    Modul B's matching would compute, so a tracker row and a Modul B match
--    always agree on identity.
--
--    `metric_evaluated`/`delta_ctr_pct`/`delta_cr_pct`/`delta_metric_pct`/
--    `verdict` are R12's computed columns, stored as real values (never a
--    formula string) — computed by `evaluateOptimization` in
--    `packages/core/src/skuscreener/compare.ts`. `verdict`'s vocabulary is
--    §5.3's own (BERHASIL/…), DELIBERATELY DIFFERENT from Modul B's
--    `compareBeforeAfter` verdict (MEMBAIK/…) — see the long comment atop
--    `compare.ts` for why the two are not unified.
-- ---------------------------------------------------------------------------
CREATE TABLE optimization_tracker (
    screening_id     varchar(32)   NOT NULL,
    product_code     varchar(191)  NOT NULL,                    -- R09 resolved key (real Kode Produk, or normalized-name fallback)
    product_name     varchar(191)  NOT NULL,
    client_id        varchar(32)   NOT NULL,
    change_date      date          NOT NULL,
    initial_route    varchar(32)   NOT NULL,                    -- Rute from Modul A at record creation (R05 vocabulary)
    change_type      varchar(32)   NOT NULL,                    -- REF's 10 types (§5.3)
    metric_evaluated varchar(4)    NOT NULL,                    -- 'CTR' | 'CR' — computed from change_type (R12)
    before_views     integer       NOT NULL,
    before_clicks    integer       NOT NULL,
    before_ctr       numeric(8,4)  NOT NULL,
    before_cr        numeric(8,4)  NOT NULL,
    before_orders    integer       NOT NULL,
    after_views      integer       NULL,
    after_clicks     integer       NULL,
    after_ctr        numeric(8,4)  NULL,
    after_cr         numeric(8,4)  NULL,
    after_orders     integer       NULL,
    delta_ctr_pct    numeric(10,4) NULL,
    delta_cr_pct     numeric(10,4) NULL,
    delta_metric_pct numeric(10,4) NULL,                        -- mirrors delta_ctr_pct or delta_cr_pct per metric_evaluated
    verdict          varchar(20)   NOT NULL DEFAULT 'BELUM CUKUP DATA',
    budget_decision  varchar(32)   NULL,
    notes            varchar(300)  NULL,
    created_at       timestamptz   NOT NULL DEFAULT now(),
    created_by       varchar(64)   NOT NULL,
    updated_at       timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (screening_id, product_code),
    CONSTRAINT fk_opttrk_screening FOREIGN KEY (screening_id) REFERENCES screening_run (id),
    CONSTRAINT fk_opttrk_client FOREIGN KEY (client_id) REFERENCES clients (id),
    CONSTRAINT ck_opttrk_initial_route CHECK (initial_route IN (
        'SCALE', 'KANDIDAT IKLAN', 'OPTIMASI GAMBAR/JUDUL', 'OPTIMASI DESKRIPSI/HARGA', 'PARKIR')),
    CONSTRAINT ck_opttrk_change_type CHECK (change_type IN (
        'Gambar utama', 'Judul produk', 'Video produk', 'Thumbnail & badge', 'Deskripsi',
        'Foto detail & ukuran', 'Harga', 'Voucher/promo', 'Bundling/minimum belanja', 'Dorong ulasan')),
    CONSTRAINT ck_opttrk_metric_evaluated CHECK (metric_evaluated IN ('CTR', 'CR')),
    CONSTRAINT ck_opttrk_verdict CHECK (verdict IN ('BERHASIL', 'TIDAK BERUBAH', 'MEMBURUK', 'BELUM CUKUP DATA')),
    CONSTRAINT ck_opttrk_budget_decision CHECK (budget_decision IS NULL OR budget_decision IN (
        'Naikkan budget +30%', 'Pertahankan', 'Turunkan budget', 'Kembalikan perubahan', 'Belum ada tindakan')),
    -- after_* fields land together (Flow D3/D4) — never a half-filled after.
    CONSTRAINT ck_opttrk_after_shape CHECK (
        (after_views IS NULL AND after_clicks IS NULL AND after_ctr IS NULL AND after_cr IS NULL AND after_orders IS NULL)
        OR (after_views IS NOT NULL AND after_clicks IS NOT NULL AND after_ctr IS NOT NULL AND after_cr IS NOT NULL AND after_orders IS NOT NULL))
);

CREATE INDEX idx_opttrk_client ON optimization_tracker (client_id, change_date DESC);

CREATE TRIGGER trg_opttrk_updated_at BEFORE UPDATE ON optimization_tracker
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE optimization_tracker IS
  'Gelombang 3 Modul D (§5.3) — child of screening_run, PK (screening_id, '
  'product_code), NOL prefix sendiri. Mutable (before→after progression), '
  'BEDA dari ads_decision_log yang append-only. metric_evaluated/delta_*/'
  'verdict computed oleh evaluateOptimization (packages/core/src/skuscreener/'
  'compare.ts), disimpan sebagai nilai nyata, bukan formula.';

-- ---------------------------------------------------------------------------
-- 5. RLS — pola sama ad_campaigns/ads_weekly_reports: read-all (Director/OD),
--    pemilik baris (created_by), pemilik klien (jwt_owns_client), atau lead
--    divisi Ads (division-wide read, CLAUDE.md rule #6). Tulis lewat
--    service-role saja sampai domain layer-nya ada (pola sama renewal_requests
--    sebelum domain wrapper-nya lahir) — nol policy INSERT/UPDATE/DELETE di
--    sini dengan sengaja.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.screening_run FROM anon;
REVOKE ALL ON public.screening_run FROM authenticated;
GRANT SELECT ON public.screening_run TO authenticated;
ALTER TABLE public.screening_run ENABLE ROW LEVEL SECURITY;
CREATE POLICY screening_run_select ON public.screening_run FOR SELECT TO authenticated
USING (public.jwt_can_read_all()
       OR created_by = public.jwt_employee_id()
       OR private.jwt_owns_client(client_id)
       OR (public.jwt_is_lead() AND public.jwt_division() = 'Ads'));

REVOKE ALL ON public.ads_decision_log FROM anon;
REVOKE ALL ON public.ads_decision_log FROM authenticated;
GRANT SELECT ON public.ads_decision_log TO authenticated;
ALTER TABLE public.ads_decision_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY ads_decision_log_select ON public.ads_decision_log FOR SELECT TO authenticated
USING (public.jwt_can_read_all()
       OR created_by = public.jwt_employee_id()
       OR advertiser_id = public.jwt_employee_id()
       OR private.jwt_owns_client(client_id)
       OR (public.jwt_is_lead() AND public.jwt_division() = 'Ads'));

REVOKE ALL ON public.optimization_tracker FROM anon;
REVOKE ALL ON public.optimization_tracker FROM authenticated;
GRANT SELECT ON public.optimization_tracker TO authenticated;
ALTER TABLE public.optimization_tracker ENABLE ROW LEVEL SECURITY;
CREATE POLICY optimization_tracker_select ON public.optimization_tracker FOR SELECT TO authenticated
USING (public.jwt_can_read_all()
       OR created_by = public.jwt_employee_id()
       OR private.jwt_owns_client(client_id)
       OR (public.jwt_is_lead() AND public.jwt_division() = 'Ads'));
