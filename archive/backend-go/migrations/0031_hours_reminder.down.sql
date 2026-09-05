-- Reverse of 0030. Drop the Hours Logged reminder fire-once column; the
-- Asset entity (0025) and hours_logged (M7 §5 Rule 2) are untouched.
ALTER TABLE assets
    DROP COLUMN hours_reminder_sent_at;
