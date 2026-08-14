-- M9 Creator Booking — per-creator deliverable quantities (qty_video, qty_live).
--
-- Additive, backward-compatible: existing rows and any INSERT that omits these
-- columns get 0. One brief batches many creators, each with their own video/live
-- counts, so these live on the booking (not the brief's single quantity_target).
--
-- House rule: migrations are append-only files under supabase/migrations/** — the
-- original creator_bookings DDL (20260722055735_kol.sql) stays frozen. Pure
-- ADD COLUMN, so the db-rebuild table/count gates are unchanged.
ALTER TABLE creator_bookings
    ADD COLUMN qty_video integer NOT NULL DEFAULT 0,   -- number of video deliverables (>= 0)
    ADD COLUMN qty_live  integer NOT NULL DEFAULT 0;   -- number of live-session deliverables (>= 0)

-- Guard the non-negative invariant at the DB (mirrors the domain check).
ALTER TABLE creator_bookings
    ADD CONSTRAINT ck_bkg_qty_nonneg CHECK (qty_video >= 0 AND qty_live >= 0);
