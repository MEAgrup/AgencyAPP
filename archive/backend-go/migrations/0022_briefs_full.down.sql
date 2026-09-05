-- Reverse of 0022 (additive promotion of the `briefs` STUB to the full Brief
-- entity). Drops the strategy FK first (it depends on idx_briefs_strategy and on
-- the strategy_id column), then every column/index the up added, leaving the
-- 0010 stub (id, service_id, title, status, created_at, created_by +
-- idx_briefs_service + fk_briefs_service) exactly as it was. Nothing in
-- 0010/0020/0021 was relaxed.
ALTER TABLE briefs
    DROP FOREIGN KEY fk_briefs_strategy;

ALTER TABLE briefs
    DROP INDEX idx_briefs_division_status,
    DROP INDEX idx_briefs_strategy,
    DROP COLUMN strategy_id,
    DROP COLUMN assigned_division,
    DROP COLUMN assigned_pic,
    DROP COLUMN deliverable_type,
    DROP COLUMN quantity_target,
    DROP COLUMN due_date,
    DROP COLUMN priority,
    DROP COLUMN recurring,
    DROP COLUMN recurring_frequency,
    DROP COLUMN recurring_count,
    DROP COLUMN recurring_end_date,
    DROP COLUMN instructions,
    DROP COLUMN reference_attachments,
    DROP COLUMN updated_at;
