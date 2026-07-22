-- Port dari backend/migrations/0014_msl_calculator.up.sql (MySQL) — konversi per docs/SUPABASE_MIGRATION_TECH_APPENDIX.md §A

-- 0014 — MSL v2 "Kalkulator Service Jasa" pricing model (DECISIONS 2026-07-16).
-- The Master Service List moves from standard_price + commission_rule to the
-- sales-sheet calculator: a versioned service now carries a pricing mode, unit,
-- minimum quantity and an optional PPN flag. The qualified-form snapshot pins
-- every input plus the computed subtotal, so each line stays recomputable.
--
-- Additive only (follows 0013 style). Existing rows keep the flat (qty 1) model:
-- pricing_mode defaults 'flat', quantity 1, and the backfill sets
-- subtotal = standard_price so historical Estimasi Nilai is unchanged.

ALTER TABLE master_service_versions
    ADD COLUMN category     varchar(120)  NULL,
    ADD COLUMN unit         varchar(80)   NULL,
    ADD COLUMN min_qty      numeric(15,2) NULL,
    ADD COLUMN pricing_mode varchar(20)   NOT NULL DEFAULT 'flat',
    ADD COLUMN apply_ppn    boolean       NOT NULL DEFAULT false,
    ADD COLUMN frequency    varchar(20)   NULL,
    ADD COLUMN price_note   varchar(255)  NULL,
    ADD COLUMN description  text          NULL;

ALTER TABLE qualified_form_services
    ADD COLUMN quantity     numeric(15,2) NOT NULL DEFAULT 1,
    ADD COLUMN input_amount numeric(15,2) NULL,
    ADD COLUMN unit         varchar(80)   NULL,
    ADD COLUMN min_qty      numeric(15,2) NULL,
    ADD COLUMN pricing_mode varchar(20)   NOT NULL DEFAULT 'flat',
    ADD COLUMN apply_ppn    boolean       NOT NULL DEFAULT false,
    ADD COLUMN subtotal     numeric(15,2) NOT NULL DEFAULT 0;

UPDATE qualified_form_services SET subtotal = standard_price;
