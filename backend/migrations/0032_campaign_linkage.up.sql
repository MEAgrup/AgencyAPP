-- CDPS Wave 3 — Module 3 (Campaign), Cluster 2 (W3-M3-C2): leads -> clients -> rollups
-- linkage.
--
-- IMPORTANT — the linkage COLUMNS already exist in the frozen 0002 foundation and are
-- NOT re-created here (re-adding them would fail up->down->up):
--   * leads.origin_campaign_id      VARCHAR(32) NULL  (0002, immutable once filled)
--   * leads.last_touch_campaign_id  VARCHAR(32) NULL  (0002, M1 §5 non-destructive touch)
--   * clients.origin_campaign_id    VARCHAR(32) NULL  (0002, stamped at closing, M3 §4 r2)
-- leads.origin_campaign_id is already indexed (0002: idx_leads_origin_campaign). The
-- foundation left the CLIENT side unindexed; this cluster's read-only rollups
-- (Clients won = COUNT clients by origin, Total value won = SUM their TRX) filter clients
-- by origin_campaign_id, so this migration adds ONLY the missing rollup index. No hard FK
-- (employee-column precedent: campaigns/leads/clients cross-reference by id, not FK).
--
-- Migration range: Wave-3 M3 Cluster 2 takes 0032 (next free after 0031). Earlier
-- migrations stay frozen.

CREATE INDEX idx_clients_origin_campaign ON clients (origin_campaign_id);
