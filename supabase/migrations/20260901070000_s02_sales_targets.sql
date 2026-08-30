-- Kinerja Sales — S-02: `sales_targets`, rumah Sales OKR yang M0 §7.1 sebut
-- ("Head/SPV Sales dapat sales analytics dashboard + monthly achievement vs
-- OKR"; "OD inputs/manages Sales OKR") tapi tidak pernah dispesifikasikan di
-- PRD manapun.
--
-- Nol prefix baru — kunci alami (salesperson_id, period_start, period_kind),
-- preseden `plan_satuan` (PK client_id) / `riset_awal` (PK interview_id) /
-- `division_registry` (PK code) di DATA_MODEL.md.
--
-- BUKAN `perf_period_targets` (M14). Menghindari menarik Sales ke kerangka
-- skor M14 sebelum bobotnya ditandatangani — sejajar guardrail X-12/LT-1 yang
-- sudah menahan diri dari mengarang bobot untuk role_type baru. Sales OKR di
-- sini adalah target OMZET murni (M0 §7.1/§8), bukan komponen KPI-Profile.
--
-- Config yang boleh direvisi (bukan history immutable) — sama seperti
-- `perf_period_targets`: perubahannya masuk `audit_log` lewat domain
-- (`salesperf.setTarget`), bukan trigger append-only.
--
-- period_start = tanggal 1 bulan (WIB). period_kind='tahun' memakai 1 Jan
-- tahun itu sebagai period_start (View 4 sheet: target bulanan DAN tahunan
-- hidup berdampingan, mis. Cena Rp1.400.000.000/tahun) — dua baris berbeda
-- period_kind untuk period_start yang bertepatan (1 Januari) TIDAK bentrok
-- karena period_kind ikut PK.

CREATE TABLE sales_targets (
    salesperson_id varchar(64)   NOT NULL,
    period_start   date          NOT NULL,
    period_kind    varchar(8)    NOT NULL,
    target_omzet   numeric(15,2) NOT NULL,
    updated_at     timestamptz   NOT NULL DEFAULT now(),
    updated_by     varchar(64)   NOT NULL,
    PRIMARY KEY (salesperson_id, period_start, period_kind),
    CONSTRAINT ck_sales_targets_period_kind CHECK (period_kind IN ('bulan', 'tahun')),
    CONSTRAINT ck_sales_targets_omzet CHECK (target_omzet >= 0)
);

CREATE TRIGGER trg_sales_targets_updated_at BEFORE UPDATE ON sales_targets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE sales_targets IS
  'S-02 (Kinerja Sales, M0 §7.1) — target omzet Sales OKR per salesperson per '
  'periode (bulan/tahun). Config, bukan history — revisi lewat upsert '
  'domain, audited. Nol prefix baru.';

-- RLS: read = pemilik target / Sales lead-SPV (division-wide, CLAUDE.md #6) /
-- read-all (OD/Director). Tulis lewat RPC/service-role + gate TS
-- (salesperf.canManageTarget), bukan lewat policy WITH CHECK — pola yang sama
-- dengan perf_period_targets. GRANT SELECT wajib eksplisit di sini: tabel ini
-- lahir SETELAH baseline's blanket `GRANT SELECT ... TO authenticated` loop
-- (20260723064438:163), jadi tanpa baris ini `readAsActor` ditolak SEBELUM
-- policy dievaluasi (jebakan tercatat DATA_MODEL.md baris `Penugasan Internal`).
ALTER TABLE public.sales_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY sales_targets_select ON public.sales_targets FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() = salesperson_id
       OR (jwt_is_lead() AND jwt_division() = 'Sales'));

GRANT SELECT ON public.sales_targets TO authenticated;
