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
    ADD COLUMN category     VARCHAR(120)  NULL,
    ADD COLUMN unit         VARCHAR(80)   NULL,
    ADD COLUMN min_qty      DECIMAL(15,2) NULL,
    ADD COLUMN pricing_mode VARCHAR(20)   NOT NULL DEFAULT 'flat',
    ADD COLUMN apply_ppn    TINYINT(1)    NOT NULL DEFAULT 0,
    ADD COLUMN frequency    VARCHAR(20)   NULL,
    ADD COLUMN price_note   VARCHAR(255)  NULL,
    ADD COLUMN description  TEXT          NULL;

ALTER TABLE qualified_form_services
    ADD COLUMN quantity     DECIMAL(15,2) NOT NULL DEFAULT 1,
    ADD COLUMN input_amount DECIMAL(15,2) NULL,
    ADD COLUMN unit         VARCHAR(80)   NULL,
    ADD COLUMN min_qty      DECIMAL(15,2) NULL,
    ADD COLUMN pricing_mode VARCHAR(20)   NOT NULL DEFAULT 'flat',
    ADD COLUMN apply_ppn    TINYINT(1)    NOT NULL DEFAULT 0,
    ADD COLUMN subtotal     DECIMAL(15,2) NOT NULL DEFAULT 0;

UPDATE qualified_form_services SET subtotal = standard_price;
