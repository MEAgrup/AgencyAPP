-- Port dari backend/migrations/0027_kol.up.sql (MySQL) — konversi per docs/SUPABASE_MIGRATION_TECH_APPENDIX.md §A
--
-- CDPS Wave 2 — Module 9 (KOL), Cluster 1: the Creator Booking (BKG-) entity, the
-- Creator Payment Request (CPR-), and the compiled Creator List (Brief-level).
--
-- A Creator Booking is KOL's unit of work (M9 §2): one row per creator secured for
-- a client campaign, the same fan-out principle as Creative's Asset (M7) and Ads'
-- Ad Campaign (M8) — a Brief for "Book 5 Micro KOLs" spawns up to 5 Booking rows.
-- Unlike an Asset (internal staff on the canonical brief_task machine), a Booking
-- has its OWN native lifecycle (STATE_MACHINES §8, machine creator_booking) with
-- room for sourcing/negotiation and the real possibility a creator does not deliver
-- (escalation/drop). It is NOT a canonical Task row: for Module 12 Speed Score its
-- 8 native states are MAPPED onto the canonical machine (§11), never driven by it.
--
-- House rules honoured (CLAUDE.md #1/#2/#3/#4/#7):
--   - the BKG-/CPR- ids are minted (ident.Next) ONLY after mandatory-field
--     validation passes (house rule 1);
--   - status is set at birth by INSERT (a creation) and every later move goes
--     through the transition engine, never a raw UPDATE (house rule 2);
--   - Revision Count / Sourcing Turnaround / Delivery Turnaround / Speed Score are
--     DERIVED from the immutable audit log, never stored (house rules 3/4);
--   - the Booking's Payment Status is a READ-ONLY reflection of the linked Creator
--     Payment Request (§8 Rule 4) — derived at read time, NOT a mutable column.
--
-- Migration range: Wave-2 M6/M12 own 0020–0029; M9 takes 0027 within that range
-- (logged in DECISIONS.md — W2-M9-C1). Migrations 0002–0026 stay frozen.

-- creator_bookings (BKG-): field spec M9 §10.3. Status = the creator_booking
-- machine (STATE_MACHINES §8), born [Sourcing].
CREATE TABLE creator_bookings (
    id                   varchar(32)   NOT NULL PRIMARY KEY,          -- BKG-YYYYMM-NNNN
    brief_id             varchar(32)   NOT NULL,                      -- parent KOL Brief (FK)
    creator_name         varchar(191)  NOT NULL,                      -- Creator Name / Handle (mandatory)
    creator_handle       varchar(191)  NULL,                          -- optional separate handle
    platform             varchar(48)   NOT NULL,                      -- TikTok / Instagram / YouTube ... (mandatory)
    niche                varchar(191)  NULL,                          -- Niche/Category (optional)
    source_pool          varchar(32)   NOT NULL,                      -- MCN MEA Roster | KOL External Pool | Ad-hoc New (M9-OA-1)
    pool_reference       varchar(191)  NULL,                          -- reference into the pool used (conditional)
    agreed_rate          numeric(20,2) NOT NULL,                      -- Agreed Rate (Rp, mandatory)
    status               varchar(48)   NOT NULL DEFAULT '[Sourcing]', -- creator_booking machine
    content_link         text          NULL,                          -- mandatory BEFORE [Content Submitted] (app-enforced, §4 Rule 3)
    qc_notes             text          NULL,                          -- required on fail/escalate (§10.3)
    sla_target_hours     numeric(10,2) NULL,                          -- Task-level SLA Target (DATA_MODEL §3); NULL => Speed Score N/A, never backfilled
    hours_logged         numeric(10,2) NULL,                          -- self-reported effort (§7 Rule 2), optional, never scored
    assigned_coordinator varchar(64)   NULL,                          -- owning KOL Coordinator (§3); NULL until assigned
    attributed_gmv       numeric(20,2) NULL,                          -- §10.3 / M9-OA-4: written back via trackable affiliate link; NULL if none (never estimated). No writer in C1.
    created_at           timestamptz   NOT NULL DEFAULT now(),
    updated_at           timestamptz   NOT NULL DEFAULT now(),
    created_by           varchar(64)   NOT NULL,
    CONSTRAINT fk_bkg_brief FOREIGN KEY (brief_id) REFERENCES briefs (id)
);

CREATE INDEX idx_bkg_brief_status ON creator_bookings (brief_id, status);
CREATE INDEX idx_bkg_coordinator ON creator_bookings (assigned_coordinator);

CREATE TRIGGER trg_creator_bookings_updated_at BEFORE UPDATE ON creator_bookings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- creator_payment_requests (CPR-): field spec M9 §10.4. KOL requests, Finance
-- executes (M9-OA-5). Status = the creator_payment_request machine (STATE_MACHINES
-- §9), born [Requested]. Amount MUST equal the Booking's Agreed Rate (app-enforced).
-- Not UNIQUE per booking: a [Rejected] request may be superseded by a fresh one
-- (the create guard blocks a second while an active, non-[Rejected] one exists).
CREATE TABLE creator_payment_requests (
    id               varchar(32)   NOT NULL PRIMARY KEY,             -- CPR-YYYYMM-NNNN
    booking_id       varchar(32)   NOT NULL,                         -- parent Booking (FK); created only once [QC Passed]
    amount           numeric(20,2) NOT NULL,                         -- must match Agreed Rate
    payment_details  text          NOT NULL,                         -- creator bank/e-wallet info (mandatory)
    status           varchar(48)   NOT NULL DEFAULT '[Requested]',   -- creator_payment_request machine
    rejection_reason text          NULL,                             -- required if [Rejected]
    requested_by     varchar(64)   NOT NULL,                         -- KOL Coordinator
    paid_by          varchar(64)   NULL,                             -- Finance PIC
    created_at       timestamptz   NOT NULL DEFAULT now(),
    updated_at       timestamptz   NOT NULL DEFAULT now(),
    created_by       varchar(64)   NOT NULL,
    CONSTRAINT fk_cpr_booking FOREIGN KEY (booking_id) REFERENCES creator_bookings (id)
);

CREATE INDEX idx_cpr_booking ON creator_payment_requests (booking_id);
CREATE INDEX idx_cpr_status ON creator_payment_requests (status);

CREATE TRIGGER trg_creator_payment_requests_updated_at BEFORE UPDATE ON creator_payment_requests
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- creator_lists: the Brief-level compiled Creator List output (§6 / §10.5). One row
-- per Brief (UPSERT on generate/refresh). The eligibility logic is AUTO (a Booking
-- becomes list-eligible the instant it reaches [QC Passed], §6 Rule 2 / M9-OA-3),
-- but the Drive document generation/refresh is a MANUAL, Coordinator-triggered
-- action that records the link + snapshot + timestamp. The Drive document itself
-- lives outside CDPS — only the link is stored (no Drive integration).
CREATE TABLE creator_lists (
    brief_id           varchar(32) NOT NULL PRIMARY KEY,  -- 1:1 with the KOL Brief
    creator_list_link  text        NULL,                  -- Drive document link (Coordinator-supplied)
    included_bookings  text        NULL,                  -- JSON snapshot of [QC Passed] BKG ids at last compile
    last_compiled      timestamptz NULL,                  -- when the snapshot was last produced
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    created_by         varchar(64) NOT NULL,
    CONSTRAINT fk_creator_list_brief FOREIGN KEY (brief_id) REFERENCES briefs (id)
);

CREATE TRIGGER trg_creator_lists_updated_at BEFORE UPDATE ON creator_lists
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
