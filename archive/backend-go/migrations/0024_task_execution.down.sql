-- Reverse of 0024. Drops the block-request queue and the Task-level SLA column.
-- Nothing in 0002/0010/0020/0021/0022/0023 was relaxed, so there is nothing to
-- restore beyond removing the new table and column.
DROP TABLE brief_block_requests;

ALTER TABLE briefs
    DROP COLUMN sla_target_hours;
