-- Reverse of 0029. Drop the per-engagement override column; the pinned flag and
-- the STR- machinery (0021) are untouched.
ALTER TABLE services
    DROP COLUMN requires_strategy_plan_override;
