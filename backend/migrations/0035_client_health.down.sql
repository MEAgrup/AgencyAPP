-- Rollback of 0035_client_health: drop the ROAS toggle override column, the
-- immutability triggers, and the snapshot table (children first).
ALTER TABLE clients DROP COLUMN roas_health_included_override;

DROP TRIGGER IF EXISTS client_health_snapshots_no_update;
DROP TRIGGER IF EXISTS client_health_snapshots_no_delete;

DROP TABLE IF EXISTS client_health_snapshots;
