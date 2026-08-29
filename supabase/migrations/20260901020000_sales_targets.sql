-- ============================================================================
-- S-02 (docs/handoff/RENCANA_KINERJA_SALES.md §5) — `sales_targets`, the home
-- for Sales OKR that M0 §7.1 names ("OD inputs/manages Sales OKR") but never
-- specifies a schema for. NOL prefix baru — natural key, same pattern as
-- `plan_satuan` / `riset_awal` / `division_registry` (DATA_MODEL.md 25/29/45).
-- Prefix registry stays 36.
--
-- NOT immutable history — config that may be revised, same as
-- `perf_period_targets` (T-1): a target set for a period can be corrected before
-- the period closes, and correction is a value edit, not a new fact about the
-- past. Every write still lands in `audit_log` via the domain layer
-- (`salesperf.setTarget`), so who-changed-what-when stays recomputable — house
-- rule #3 is honoured through the log, not through a forbid_mutation trigger on
-- this table. Deliberately NOT `perf_period_targets`: pulling Sales into the
-- M14 scoring frame before its component weights are signed off would be the
-- same guardrail X-12/LT-1 violates ("never invent a weight") — logged
-- DECISIONS.md (Kinerja Sales #2).
--
-- RLS mirrors `scopeFor` (salesperf.ts) exactly: canReadAll, the salesperson's
-- own row, or the Sales lead/SPV reading the whole division. Write is RPC/
-- service-role + TS gate (Director / OD write target — OD is the one write path
-- a pure-OD account has, M0 §7.1). GRANT SELECT TO authenticated is MANDATORY —
-- a table created after the RLS baseline is NOT covered by baseline's grant
-- loop, and without it `readAsActor` is denied before the policy is even
-- evaluated (DATA_MODEL.md #44 gotcha, TSK- precedent).
-- ============================================================================

CREATE TABLE sales_targets (
    salesperson_id varchar(64)   NOT NULL,
    period_start   date          NOT NULL,   -- tgl 1 bulan (WIB); 1 Jan = target tahunan
    period_kind    varchar(8)    NOT NULL,   -- 'bulan' | 'tahun'
    target_omzet   numeric(15,2) NOT NULL,
    updated_at     timestamptz   NOT NULL DEFAULT now(),
    updated_by     varchar(64)   NOT NULL,
    PRIMARY KEY (salesperson_id, period_start, period_kind),
    CONSTRAINT ck_sales_targets_period_kind CHECK (period_kind IN ('bulan', 'tahun')),
    CONSTRAINT ck_sales_targets_omzet CHECK (target_omzet >= 0)
);

CREATE TRIGGER trg_sales_targets_updated_at BEFORE UPDATE ON sales_targets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Tabel dibuat SETELAH rls_baseline — ulangi grant hygiene eksplisit (pola
-- prospect_activities / TSK-): anon dicabut total, authenticated hanya SELECT.
REVOKE ALL ON public.sales_targets FROM anon;
REVOKE ALL ON public.sales_targets FROM authenticated;
GRANT SELECT ON public.sales_targets TO authenticated;
ALTER TABLE public.sales_targets ENABLE ROW LEVEL SECURITY;

-- jwt_can_read_all() = OD ∨ Director (M0 §7.1: OD read-only + manages OKR ⇒ OD
-- must be able to READ every target it might later write). Own row for every
-- salesperson (staff sees their own OKR). Sales lead/SPV = division-wide,
-- cermin scopeFor() salesperf.ts — dua sisi TIDAK BOLEH divergen (CLAUDE.md).
CREATE POLICY sales_targets_select ON public.sales_targets FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() = salesperson_id
       OR (jwt_is_lead() AND jwt_division() = 'Sales'));

COMMENT ON TABLE sales_targets IS
  'S-02 (Kinerja Sales): Sales OKR (M0 §7.1) — target omzet per salesperson per periode (bulan/tahun). Nol prefix baru, kunci alami.';
