-- P1 (Revisi Sales/Creative/Performa, Tahap 1) — indeks tambahan untuk enam
-- pembacaan daftar yang paling sering dipukul (leads/clients/prospect_attempts/
-- services/complaints), semua diurutkan `created_at desc` tanpa indeks yang
-- menopangnya. Aditif, netral perilaku — pola `20260724132631_fk_covering_indexes.sql`.
-- Lihat docs/backlog/REVISI_CDPS_SALES_CREATIVE_PERFORMA.md Bagian 4 (P1 langkah 2).

CREATE INDEX IF NOT EXISTS idx_leads_created_at
  ON leads (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_leads_created_by
  ON leads (created_by);

CREATE INDEX IF NOT EXISTS idx_clients_created_at
  ON clients (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_prsp_created_at
  ON prospect_attempts (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_prsp_lead_status
  ON prospect_attempts (lead_id, status);
CREATE INDEX IF NOT EXISTS idx_prsp_owner_lead
  ON prospect_attempts (owner_employee_id, lead_id);

CREATE INDEX IF NOT EXISTS idx_services_client_status
  ON services (client_id, status);

CREATE INDEX IF NOT EXISTS idx_complaints_client_status
  ON complaints (client_id, status);
