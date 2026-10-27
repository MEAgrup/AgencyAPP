-- ============================================================================
-- WEBSITE-LEAD — form website (WordPress `mea-leads`) → Pool CDPS, tanpa input
-- manual. Katalog notifikasi v23.
--
-- Rujukan: docs/decisions/2026-10-27-website-lead-intake.md,
--          docs/decisions/2026-10-27-origin-division-seo-website.md,
--          docs/decisions/2026-10-27-pool-rls-sales.md,
--          docs/plan/PLAN_WEBSITE_LEAD_INTAKE.md.
--
-- Pengirim menandatangani setiap request (HMAC, kontrak `mea.website_lead.v1`);
-- rute `POST /api/v1/internal/website-leads` memverifikasi, lalu
-- `websiteLead.intake()` (packages/domain/src/website-lead.ts) menjalankan pintu
-- import Marketing yang SAMA (`leads.poolIntake`) dan mencatat tanda terimanya di
-- tabel ini dalam satu transaksi.
--
-- ## GATE
--
--   tabel public    187 → 188   `website_lead_inbox`
--   entity_prefix   TETAP 45    baris inbox bukan entitas ber-lifecycle (nol ID PREFIX-)
--   sm_machines     TETAP 36    nol mesin baru
--   notif_events     84 → 85    `m1.lead.website_masuk` (v23, SATU event)
--
-- Angka ABSOLUT, dinaikkan di `scripts/db-rebuild.sh` DAN
-- `.github/workflows/ci.yml` pada commit yang SAMA dengan berkas ini.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. `website_lead_inbox` — satu baris per lead yang diterima dari website.
--
--    Baris ini adalah tanda terima, bukan lead: lead-nya hidup di `leads`
--    (`lead_id`). Untuk hasil `duplikat`, `lead_id` menunjuk lead yang SUDAH
--    ada (nol lead baru). Kolom tampilan (site, sumber_form, halaman_asal, utm)
--    disalin dari payload saat diterima supaya filter dan badge tidak perlu
--    membongkar JSON; payload mentahnya tetap tersimpan utuh.
--
--    Imutabel (aturan rumah #3): nol jalur UPDATE/DELETE, dijaga trigger.
-- ---------------------------------------------------------------------------
CREATE TABLE website_lead_inbox (
    id               bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idempotency_key  varchar(64)  NOT NULL UNIQUE,
    site             varchar(191) NOT NULL,
    sumber_form      varchar(100) NOT NULL,
    halaman_asal     varchar(255) NOT NULL,
    utm_source       varchar(191) NULL,
    utm_medium       varchar(191) NULL,
    utm_campaign     varchar(191) NULL,
    payload          jsonb        NOT NULL,
    payload_schema   varchar(64)  NOT NULL,
    hasil            varchar(16)  NOT NULL,
    lead_id          varchar(32)  NOT NULL REFERENCES leads (id),
    diterima_pada    timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT ck_wli_hasil CHECK (hasil IN ('dibuat', 'dibuka_ulang', 'duplikat')),
    CONSTRAINT ck_wli_payload_shape
        CHECK (jsonb_typeof(payload) = 'object' AND payload <> '{}'::jsonb)
);

CREATE INDEX idx_wli_lead ON website_lead_inbox (lead_id);
CREATE INDEX idx_wli_diterima ON website_lead_inbox (diterima_pada);

CREATE TRIGGER trg_website_lead_inbox_immutable
BEFORE UPDATE OR DELETE ON website_lead_inbox
FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Baca: ikut visibilitas lead-nya. Subquery di bawah dievaluasi dengan RLS
-- `leads_select` milik pemanggil, jadi tidak ada aturan kedua yang bisa
-- berbeda dari aturan lead (CLAUDE.md: kedua sisi tidak boleh berselisih).
-- Tulis hanya lewat rute mesin + domain (service-role); nol policy INSERT
-- untuk `authenticated`.
REVOKE ALL ON public.website_lead_inbox FROM anon;
REVOKE ALL ON public.website_lead_inbox FROM authenticated;
GRANT SELECT ON public.website_lead_inbox TO authenticated;
ALTER TABLE public.website_lead_inbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY website_lead_inbox_select ON public.website_lead_inbox FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = website_lead_inbox.lead_id));

-- ---------------------------------------------------------------------------
-- 2. `leads_select` — arm Pool untuk divisi Sales (2026-10-27-pool-rls-sales).
--    Cakupan = `leads.canReadPool` (Sales level apa pun; Director/OD sudah
--    lewat `jwt_can_read_all`). Arm lain identik dengan 20260729031525.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS leads_select ON public.leads;
CREATE POLICY leads_select ON public.leads FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR (jwt_is_lead() AND origin_division = jwt_division())
       OR private.jwt_owns_lead(id)
       OR private.jwt_owns_lead_campaign(id)
       OR (record_status = '[Pool]' AND jwt_division() = 'Sales'));

-- ---------------------------------------------------------------------------
-- 3. Notifikasi — katalog v23, SATU event.
--
--    `m1.lead.website_masuk` → lead Sales (division 'Sales'), plus pemilik
--    attempt terbuka bila nomornya sudah diproses (explicit). Resolver
--    `explicitOrLeads`; aktor SYSTEM tidak pernah jadi penerima.
--    Emitter: packages/domain/src/website-lead.ts intake().
-- ---------------------------------------------------------------------------
INSERT INTO notif_catalog_versions (version, description, event_count, decision_ref) VALUES
    (23,
     'WEBSITE-LEAD — 1 event (m1.lead.website_masuk): lead dari form website diterima — ke lead Sales, plus pemilik attempt terbuka bila nomornya sudah diproses.',
     1,
     'docs/DECISIONS.md 2026-10-27 (WEBSITE-LEAD — lead form website masuk Pool, disetujui Yohan)');

INSERT INTO notif_events (event_type, description, resolver, catalog_version) VALUES
    ('m1.lead.website_masuk',
     'Lead website baru — ke lead Sales (+ pemilik attempt bila nomor sudah diproses)',
     'explicitOrLeads',
     23);
