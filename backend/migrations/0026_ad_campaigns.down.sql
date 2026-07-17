-- Reverse of 0026. Drops the Ad Campaign entity and its append-only child rows,
-- children before parents for the FKs. Nothing in earlier migrations was relaxed;
-- assets.attributed_gmv (added in 0025) is left in place — it is a Creative-side
-- column M8 only writes into, not one this migration created.
DROP TABLE optimization_logs;
DROP TABLE metric_entry_assets;
DROP TABLE metric_entries;
DROP TABLE ad_campaign_assets;
DROP TABLE ad_campaigns;
