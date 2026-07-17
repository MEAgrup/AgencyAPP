-- Reverse of 0032. Drops ONLY the client-side rollup index this cluster added. The
-- linkage columns (leads.origin_campaign_id / leads.last_touch_campaign_id /
-- clients.origin_campaign_id) belong to the 0002 foundation and are left untouched.
DROP INDEX idx_clients_origin_campaign ON clients;
