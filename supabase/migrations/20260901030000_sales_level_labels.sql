-- ============================================================================
-- §3a (docs/handoff/RENCANA_KINERJA_SALES.md) — "Level Sales (Senior/Junior)"
-- from `employees.jabatan` (HRIS sync, read-only). NOL new field: a mapping
-- table from the SIX Sales-division jabatan values already in
-- `supabase/seed/hris_department_jabatan_pairs.csv` / `role_mappings_riil.csv`
-- to a display label — dual-home pattern (table + TS constant + registry test)
-- already used by `role_mappings` / `division_registry`.
--
-- CAVEATS (recorded, not ignored — see DECISIONS.md Kinerja Sales #3):
--   1. `jabatan` is HRIS-owned, synced read-only. HRIS renaming a jabatan
--      changes the label with no migration on our side — this table's PK is
--      the jabatan STRING, so an unmapped (renamed) jabatan reads as "—", not
--      an error.
--   2. `employees.jabatan` stores the CURRENT jabatan, not history. A
--      salesperson promoted to Senior last month shows "Senior" for closed
--      prior periods too — accepted as "current level" per owner decision;
--      revisit only if level ever feeds commission/scoring (it doesn't today).
-- ============================================================================

CREATE TABLE sales_level_labels (
    jabatan    varchar(64) NOT NULL PRIMARY KEY,
    level_label varchar(16) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(64) NOT NULL DEFAULT 'SYSTEM'
);

-- Tabel dibuat SETELAH rls_baseline — ulangi grant hygiene eksplisit. Katalog
-- murni (nol PII, nol data klien) — dibaca bebas seperti master_services.
REVOKE ALL ON public.sales_level_labels FROM anon;
REVOKE ALL ON public.sales_level_labels FROM authenticated;
GRANT SELECT ON public.sales_level_labels TO authenticated;
ALTER TABLE public.sales_level_labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY sales_level_labels_select ON public.sales_level_labels FOR SELECT TO authenticated
USING (true);

-- Verbatim dari hris_department_jabatan_pairs.csv / role_mappings_riil.csv,
-- baris divisi SALES (39-karyawan HRIS riil). Harus tetap identik dengan
-- SALES_LEVEL_LABELS di packages/domain/src/salesperf.ts — dijaga
-- salesperf.test.ts (pola division.registry.test.ts).
INSERT INTO sales_level_labels (jabatan, level_label) VALUES
    ('HEAD OF SALES JASA',        'Head'),
    ('SENIOR SALES JASA',         'Senior'),
    ('SALES JASA',                'Junior'),
    ('SALES',                     'Junior'),
    ('ADMIN SALES',               'Admin'),
    ('CUSTOMER RELATION OFFICER', 'CRO');

COMMENT ON TABLE sales_level_labels IS
  '§3a (Kinerja Sales): jabatan HRIS → label Level Sales tampilan. Level SAAT INI, bukan snapshot per periode (lihat DECISIONS.md).';
