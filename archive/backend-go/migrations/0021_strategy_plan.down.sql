-- Reverse of 0021. Drop the STR- table first (it FKs services), then the two
-- pinned/versioned flag columns. Nothing in 0002/0020 was relaxed.
DROP TABLE IF EXISTS strategy_plans;

ALTER TABLE services
    DROP COLUMN requires_strategy_plan;

ALTER TABLE master_service_versions
    DROP COLUMN requires_strategy_plan;
