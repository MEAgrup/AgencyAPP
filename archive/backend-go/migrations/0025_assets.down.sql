-- Reverse of 0025. Drops the Asset entity and its block-request queue (child
-- first, for the FK). Nothing in earlier migrations was relaxed.
DROP TABLE asset_block_requests;
DROP TABLE assets;
