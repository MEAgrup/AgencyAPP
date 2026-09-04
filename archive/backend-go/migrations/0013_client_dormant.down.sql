-- Reverse of 0013. Pure column drop (0002 already had transaction_id /
-- payment_intent NULLable, so nothing was relaxed and nothing needs restoring).
ALTER TABLE clients
    DROP COLUMN dormant_at;
