-- Reverse of 0033. Drops the Marketing Performance Record. Nothing in earlier
-- migrations was relaxed; this migration created only the marketing_performance_records
-- table (the Campaign entity and its linkage columns are untouched).
DROP TABLE marketing_performance_records;
