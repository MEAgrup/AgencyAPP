-- Reverse of 0030. Drops the acquisition Campaign (CMP-) entity. Nothing in earlier
-- migrations was relaxed; this migration created only the campaigns table.
DROP TABLE campaigns;
