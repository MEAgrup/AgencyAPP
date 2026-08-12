-- CDPS — Module 6 (Account & Service), Cluster 2: QA revisi "Buat Strategy & Plan".
--
-- Three additive changes to `strategy_plans`, driven by the product owner's QA
-- feedback (DECISIONS.md 2026-08-12, "M6 Strategy KPI terstruktur + gate GMV +
-- task satuan"):
--
-- 1) Target KPI becomes STRUCTURED. The free-text `target_kpi` is demoted from
--    the mandatory field to an optional catatan, and four fixed KPI points take
--    its place: `target_gmv`, `target_roas`, `target_ctr`, `target_cvr`. GMV is
--    the anchor — it flows down from the client's own expectation
--    (`clients.target_gmv`, captured by Sales at intake) and the AM adjusts it.
--    `target_kpi` is only made NULLable + defaulted here; existing rows keep
--    their text, so this is additive (no back-fill, no data loss).
--
-- 2) GMV adjustment GATE (±20% tolerance). `client_target_gmv` snapshots the
--    client's expectation at draft time so the ±20% band is measured against a
--    fixed baseline, not a moving one. `gmv_adjustment_status` records whether
--    the AM's `target_gmv` is inside tolerance, awaiting Head/SPV sign-off, or
--    approved; `gmv_adjustment_reason` is mandatory once out of tolerance (DB
--    CHECK), and `gmv_adjustment_approved_by` records who cleared it. The
--    approval itself is an audited before→after edit in the domain layer — no new
--    notification event is minted (the notification catalog is a frozen invariant
--    still pending sign-off, 6A RA-1), so the "ada lognya" requirement is met by
--    audit_log + a status the SPV sees on the approval queue.
--
-- 3) DIVISION TASK SATUAN. `division_tasks` holds the per-division unit-of-work
--    quotas the strategy commits to (Creative: video seller / SKU optimize; KOL:
--    video creator / live-stream creator; Ads: ads spent; Live Stream: live
--    stream count). Stored as JSONB on the parent row rather than a child table
--    so it inherits `strategy_plans`' existing RLS with no new policy, and so a
--    strategy's KPI + tasks load in one read. These are what the AM turns into
--    Briefs (M6B P3: Briefs are created manually from the plan rows).
--
-- Money is IDR; these are numeric(15,2) like `clients.target_gmv` / contract
-- figures, kept exact and formatted at the wire boundary.

ALTER TABLE strategy_plans
    ALTER COLUMN target_kpi DROP NOT NULL,
    ALTER COLUMN target_kpi SET DEFAULT '',
    ADD COLUMN target_gmv                 numeric(15,2) NULL,
    ADD COLUMN target_roas                numeric(8,2)  NULL,
    ADD COLUMN target_ctr                 numeric(6,3)  NULL,
    ADD COLUMN target_cvr                 numeric(6,3)  NULL,
    ADD COLUMN client_target_gmv          numeric(15,2) NULL,
    ADD COLUMN gmv_adjustment_status      varchar(32)   NOT NULL DEFAULT 'dalam_toleransi',
    ADD COLUMN gmv_adjustment_reason      text          NULL,
    ADD COLUMN gmv_adjustment_approved_by varchar(64)   NULL,
    ADD COLUMN division_tasks             jsonb         NOT NULL DEFAULT '[]'::jsonb;

-- The status is a small closed set; an out-of-tolerance status must carry the
-- reason that justified it. Both mirror the TS validation (belt & braces).
ALTER TABLE strategy_plans
    ADD CONSTRAINT ck_strategy_gmv_adj_status
        CHECK (gmv_adjustment_status IN ('dalam_toleransi', 'menunggu_persetujuan', 'disetujui')),
    ADD CONSTRAINT ck_strategy_gmv_adj_reason
        CHECK (gmv_adjustment_status = 'dalam_toleransi' OR gmv_adjustment_reason IS NOT NULL),
    ADD CONSTRAINT ck_strategy_division_tasks_array
        CHECK (jsonb_typeof(division_tasks) = 'array');
