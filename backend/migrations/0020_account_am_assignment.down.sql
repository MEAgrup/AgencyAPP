-- Reverse of 0020. Pure additive column + index drop (nothing in 0002 relaxed).
ALTER TABLE clients
    DROP KEY idx_clients_assigned_am,
    DROP COLUMN assigned_am_id;
