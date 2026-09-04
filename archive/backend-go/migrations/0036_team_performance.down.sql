-- Rollback of 0036_team_performance: drop the KPI config tables, the immutability
-- triggers, and the snapshot table (no cross-table FKs among them beyond the
-- staff_id -> employees FK on the snapshot, which drops with the table).
DROP TRIGGER IF EXISTS performance_snapshots_no_update;
DROP TRIGGER IF EXISTS performance_snapshots_no_delete;

DROP TABLE IF EXISTS perf_period_targets;
DROP TABLE IF EXISTS perf_kpi_weights;
DROP TABLE IF EXISTS performance_snapshots;
