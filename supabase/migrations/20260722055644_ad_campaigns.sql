-- Port dari backend/migrations/0026_ad_campaigns.up.sql (MySQL) — konversi per docs/SUPABASE_MIGRATION_TECH_APPENDIX.md §A
--
-- CDPS Wave 2 — Module 8 (Ads), Cluster 1: the Ad Campaign (ADC-) entity and its
-- append-only child rows.
--
-- An Ad Campaign is the CLIENT's paid media (M8 §2) — distinct from Module 3's
-- own-lead-gen Campaign (CMP-). It is created while the parent setup Brief is
-- [In Progress] (a Brief-as-task on the §7 machine) and OUTLIVES that Brief: the
-- Brief closes once setup is approved, but the ADC keeps running and accruing
-- metrics/optimizations underneath it (STATE_MACHINES §14).
--
-- House rules honoured (CLAUDE.md #3/#4/#7):
--   - Total Spend / Total GMV / ROAS and each Asset's Attributed GMV are DERIVED
--     from the immutable child rows below, NEVER stored as mutable running columns
--     on ad_campaigns (M5 precedent: Amount Verified/Outstanding derived from the
--     payment_verifications log, not a running column). ad_campaigns therefore has
--     NO total_spend / total_gmv / roas column.
--   - Metric entries, optimization entries and the per-entry linked-asset snapshot
--     are append-only history (no UPDATE/DELETE path in the code).
--
-- Migration range: Wave-2 M6/M12 own 0020–0029; M8 takes 0026 within it (logged
-- in DECISIONS.md — W2-M8-C1). Migrations 0002–0025 stay frozen.

-- ad_campaigns (ADC-): field spec M8 §9.3. Status = the ad_campaign machine
-- (STATE_MACHINES §14), born [Paused]. Total Spend/GMV/ROAS are NOT columns here
-- (derived). Objective/target_kpi are free-text/number per §9.3.
CREATE TABLE ad_campaigns (
    id            varchar(32)   NOT NULL PRIMARY KEY,   -- ADC-YYYYMM-NNNN
    brief_id      varchar(32)   NOT NULL,               -- parent setup Brief (§9.3)
    client_id     varchar(32)   NOT NULL,               -- inherited via Brief->Service->Client (§9.3)
    platform      varchar(48)   NOT NULL,               -- Shopee Ads / TikTok Shop Ads / Social Ads
    objective     varchar(191)  NOT NULL,               -- Awareness / Traffic / Conversion-GMV ...
    budget        numeric(20,2) NOT NULL,               -- planned budget (Rp)
    start_date    date          NOT NULL,
    end_date      date          NOT NULL,
    target_kpi    varchar(191)  NOT NULL,               -- ROAS/GMV target or Spend cap (§9.3)
    status        varchar(24)   NOT NULL DEFAULT '[Paused]',
    created_at    timestamptz   NOT NULL DEFAULT now(),
    updated_at    timestamptz   NOT NULL DEFAULT now(),
    created_by    varchar(64)   NOT NULL,
    CONSTRAINT fk_adc_brief FOREIGN KEY (brief_id) REFERENCES briefs (id),
    CONSTRAINT fk_adc_client FOREIGN KEY (client_id) REFERENCES clients (id)
);

CREATE INDEX idx_adc_brief ON ad_campaigns (brief_id);
CREATE INDEX idx_adc_client_status ON ad_campaigns (client_id, status);

CREATE TRIGGER trg_ad_campaigns_updated_at BEFORE UPDATE ON ad_campaigns
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ad_campaign_assets: the Creative-Asset linkage (M8 §4 Rule 2), with a link
-- PERIOD so a mid-campaign Creative Swap (§6 Rule 3 / §7 Rule 3) is representable:
-- unlinked_at NULL == currently linked. A row is never deleted — swapping sets
-- unlinked_at and inserts a new row for the replacement Asset, so the full linkage
-- history stays visible (house rule 3).
CREATE TABLE ad_campaign_assets (
    id            bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    campaign_id   varchar(32)  NOT NULL,
    asset_id      varchar(32)  NOT NULL,
    linked_at     timestamptz  NOT NULL DEFAULT now(),
    unlinked_at   timestamptz  NULL,
    created_by    varchar(64)  NOT NULL,
    CONSTRAINT fk_aca_campaign FOREIGN KEY (campaign_id) REFERENCES ad_campaigns (id),
    CONSTRAINT fk_aca_asset FOREIGN KEY (asset_id) REFERENCES assets (id)
);

CREATE INDEX idx_aca_campaign ON ad_campaign_assets (campaign_id);
CREATE INDEX idx_aca_asset ON ad_campaign_assets (asset_id);

-- metric_entries (MTR-): periodic performance input, additive (M8 §5 / §9.4).
-- Manual or File Export (§9.4 Entry Method). Each entry covers a Period. Spend +
-- GMV are the raw inputs the running totals / ROAS derive from; CTR/CVR optional.
CREATE TABLE metric_entries (
    id            varchar(32)   NOT NULL PRIMARY KEY,  -- MTR-YYYYMM-NNNN
    campaign_id   varchar(32)   NOT NULL,
    period_start  date          NOT NULL,
    period_end    date          NOT NULL,
    spend         numeric(20,2) NOT NULL,
    gmv           numeric(20,2) NOT NULL,
    ctr           numeric(8,4)  NULL,                  -- % where the platform provides
    cvr           numeric(8,4)  NULL,
    entry_method  varchar(16)   NOT NULL,              -- Manual | File Export
    entered_by    varchar(64)   NOT NULL,
    created_at    timestamptz   NOT NULL DEFAULT now(),
    created_by    varchar(64)   NOT NULL,
    CONSTRAINT fk_mtr_campaign FOREIGN KEY (campaign_id) REFERENCES ad_campaigns (id)
);

CREATE INDEX idx_mtr_campaign ON metric_entries (campaign_id);

-- metric_entry_assets: an IMMUTABLE snapshot of which Assets were linked to the
-- campaign at the moment a Metric Entry was recorded (§7 Flow 1 "each metric entry
-- triggers a recompute across THAT period's linked Asset(s)"). Attributed GMV is a
-- pure function of these snapshots: entry.gmv split equally across its snapshot
-- rows (§7 Rule 2), summed per Asset. Recording the snapshot at entry time makes
-- attribution recomputable from immutable rows WITHOUT any timestamp-ordering
-- fragility, and makes the Creative-Swap rule (§7 Rule 3) fall out naturally —
-- entries before the swap keep the old Asset, entries after get the new one.
CREATE TABLE metric_entry_assets (
    metric_entry_id varchar(32) NOT NULL,
    asset_id        varchar(32) NOT NULL,
    PRIMARY KEY (metric_entry_id, asset_id),
    CONSTRAINT fk_mea_entry FOREIGN KEY (metric_entry_id) REFERENCES metric_entries (id),
    CONSTRAINT fk_mea_asset FOREIGN KEY (asset_id) REFERENCES assets (id)
);

CREATE INDEX idx_mea_asset ON metric_entry_assets (asset_id);

-- optimization_logs (OPT-): ongoing changes to a live campaign (M8 §6 / §9.5).
-- before/after/reason are mandatory text; this is NOT a Brief revision and never
-- reopens the Brief (§6 Rule 1). Append-only history (§6 Rule 2). A Creative Swap
-- (Change Type = Creative Swap) additionally re-points the linkage table above.
CREATE TABLE optimization_logs (
    id            varchar(32)  NOT NULL PRIMARY KEY,   -- OPT-YYYYMM-NNNN
    campaign_id   varchar(32)  NOT NULL,
    change_type   varchar(24)  NOT NULL,               -- Budget|Targeting|Creative Swap|Schedule|Other
    before_value  varchar(500) NOT NULL,
    after_value   varchar(500) NOT NULL,
    reason        varchar(500) NOT NULL,
    actor         varchar(64)  NOT NULL,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    created_by    varchar(64)  NOT NULL,
    CONSTRAINT fk_opt_campaign FOREIGN KEY (campaign_id) REFERENCES ad_campaigns (id)
);

CREATE INDEX idx_opt_campaign ON optimization_logs (campaign_id);
