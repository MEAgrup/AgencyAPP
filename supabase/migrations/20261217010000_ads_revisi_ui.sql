-- ============================================================================
-- ADS-REVISI-UI (2026-10-05) — revisi UI halaman /ads dari tim Advertiser.
-- Rujukan: docs/DECISIONS.md 2026-10-05 "ADS-REVISI-UI",
--          docs/plan/PLAN_REVISI_UI_ADS_20261005.md.
--
-- Tiga perubahan skema, semuanya kecil:
--
-- (1) R2 — `ad_campaigns.end_date` jadi NULLABLE. Tim Advertiser: "Tanggal
--     Selesai tidak diisi dari awal tapi bisa di-toggle oleh advertiser".
--     NULL = rencana selesai belum ditentukan (kampanye terbuka). Tanggal iklan
--     SUNGGUHAN selesai tetap `iklan_selesai` (ADS-PERIODE-IKLAN-AKTUAL).
--     Query overlap SH-06 / PDT E-03 di `ads.ts` memperlakukan NULL sebagai
--     terbuka (`end_date IS NULL OR end_date >= …`).
--
-- (2) R4 — `ad_campaigns_select` mendapat arm **Lead Ads** (division-wide,
--     Phase 0 §4 Role Matrix). Sebelumnya tiga arm baseline semuanya per-orang
--     (`created_by`, `jwt_owns_client`) — persis kelas `client_sales_allocations`
--     / `employees_select`: `ads.canViewCampaign` sudah lama mengizinkan Lead
--     Ads membaca kampanye divisinya, policy-nya lah yang membantah. Tanpa arm
--     ini daftar kampanye baru (`GET /campaigns`) akan menampilkan kepada SPV Ads
--     hanya kampanye buatannya sendiri — 200 tanpa galat. Staff Ads TIDAK
--     mendapat arm baru: daftar per-orang adalah permintaan eksplisit
--     ("list semua campaign yg sudah dibuat per orang"). Nol arm TULIS.
--     `ad_campaigns_select` karenanya KELUAR dari ledger O60
--     (`supabase/tests/rls_checks.sql`) — ledger menyusut, arah yang benar.
--
-- (3) R1 — `private.ad_campaign_transisi(campaign_ids[])`: baris transisi status
--     kampanye dari `audit_log` immutable, untuk menurunkan HARI JEDA
--     (Estimasi Budget Terpakai = Budget Harian × hari iklan aktif). Lewat
--     SECURITY DEFINER karena `audit_log_select` per-aktor: AM pemilik yang
--     membuka daftar kampanye tidak melihat baris pause yang ditulis Advertiser,
--     dan estimasinya akan diam-diam lebih besar dari yang dilihat Advertiser.
--     Fungsi ini hanya mengembalikan (action, created_at) transisi — nol actor,
--     nol before/after JSON — dan pemanggilnya (`ads.listCampaigns` /
--     `ads.getCampaign`) sudah melewati gerbang baca kampanye.
--
-- Nol tabel / prefix / mesin / event baru ⇒ gerbang tabel/prefix/mesin/event TETAP.
-- ============================================================================

ALTER TABLE ad_campaigns ALTER COLUMN end_date DROP NOT NULL;

COMMENT ON COLUMN ad_campaigns.end_date IS
  'ADS-REVISI-UI R2 — tanggal RENCANA selesai, OPSIONAL (NULL = belum ditentukan, '
  'kampanye terbuka). Tanggal iklan sungguhan selesai ada di iklan_selesai.';

COMMENT ON COLUMN ad_campaigns.budget IS
  'ADS-REVISI-UI R1 — Budget HARIAN (Rp). Estimasi Budget Terpakai = budget × hari '
  'iklan aktif, diturunkan tiap baca (tidak disimpan).';

-- ALTER POLICY (bukan DROP + CREATE): perintah & peran (FOR SELECT TO
-- authenticated) baseline tetap, hanya USING yang diganti. Juga karena DROP
-- POLICY lewat kanal MCP `apply_migration` menggantung (timeout 60 dtk,
-- 2026-10-05) sedangkan ALTER POLICY lolos — lihat DECISIONS 2026-10-05.
ALTER POLICY ad_campaigns_select ON public.ad_campaigns
USING (
  public.jwt_can_read_all()
  OR created_by = public.jwt_employee_id()
  OR private.jwt_owns_client(client_id)
  -- ADS-REVISI-UI R4 BARU: Lead/SPV Ads — division-wide, cermin ads.canViewCampaign.
  OR (public.jwt_is_lead() AND public.jwt_division() = 'Ads')
);

COMMENT ON POLICY ad_campaigns_select ON public.ad_campaigns IS
  'ADS-REVISI-UI (2026-10-05): + arm Lead Ads (division-wide), cermin '
  'ads.canViewCampaign, supaya daftar kampanye GET /campaigns tidak kosong untuk '
  'SPV Ads. Arm baseline (read_all / created_by / owns_client) utuh. Nol arm TULIS.';

CREATE OR REPLACE FUNCTION private.ad_campaign_transisi(p_campaign_ids text[])
RETURNS TABLE (campaign_id text, action text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT a.entity_id::text, a.action::text, a.created_at
    FROM public.audit_log a
   WHERE a.entity_type = 'ad_campaign'
     AND a.entity_id = ANY (p_campaign_ids)
     AND a.action LIKE 'transition:%'
   ORDER BY a.entity_id ASC, a.created_at ASC, a.id ASC
$$;

COMMENT ON FUNCTION private.ad_campaign_transisi(text[]) IS
  'ADS-REVISI-UI R1 — (campaign_id, action, created_at) transisi status Ad Campaign, '
  'untuk menurunkan hari jeda / hari iklan aktif. Array id supaya daftar kampanye '
  'membaca semuanya dalam satu kueri. Tanpa actor & JSON before/after.';

REVOKE EXECUTE ON FUNCTION private.ad_campaign_transisi(text[]) FROM public;
REVOKE EXECUTE ON FUNCTION private.ad_campaign_transisi(text[]) FROM anon;
GRANT  EXECUTE ON FUNCTION private.ad_campaign_transisi(text[]) TO authenticated, service_role;
