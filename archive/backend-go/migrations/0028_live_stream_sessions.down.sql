-- Reverse of 0028. Drops the Live Stream Session entity. Nothing in earlier
-- migrations was relaxed. Idempotent-safe: IF EXISTS lets a partial-up rollback
-- (or a re-run) complete without error.
DROP TABLE IF EXISTS live_stream_sessions;
