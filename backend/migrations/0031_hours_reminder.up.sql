-- CDPS Wave 3 — W3-CAT-1: opening of the notification catalog for Wave 3
-- (DECISIONS.md O29 RESOLVED 2026-07-14 -> "GO — W2 langkah 49" 2026-07-17,
-- the entry that lifts the catalog freeze and names EvHoursLoggedReminder as
-- the one queued event). Adds the fire-once dedup column for the Hours
-- Logged end-of-day reminder sweep (M7-OA-2), module7_creative/reminder.go.
--
-- assets.hours_reminder_sent_at mirrors the M5 reminder fire-once columns
-- (0012: reminder_h3_sent_at / overdue_notified_at) but this reminder repeats
-- DAILY rather than firing once ever, so the scan compares the column's WIB
-- calendar day (tz.Date) against the current WIB day rather than just
-- NULL-checking it: once the stored day is in the past, the guard opens
-- again for the new day. NULL = never reminded.
ALTER TABLE assets
    ADD COLUMN hours_reminder_sent_at DATETIME NULL AFTER hours_logged;
