-- Reverse of 0027. Drops the KOL entities (children before parents, for the FKs).
-- Nothing in earlier migrations was relaxed. Idempotent-safe: IF EXISTS guards let
-- a partial-up rollback (or a re-run) complete without error.
DROP TABLE IF EXISTS creator_payment_requests;
DROP TABLE IF EXISTS creator_lists;
DROP TABLE IF EXISTS creator_bookings;
