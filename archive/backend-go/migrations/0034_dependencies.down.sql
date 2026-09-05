-- Reverse of 0034. Drops the cross-Brief Dependency table. Nothing in earlier
-- migrations was relaxed; this migration created only the dependencies table (the
-- Brief/Service/Client entities and their columns are untouched).
DROP TABLE dependencies;
