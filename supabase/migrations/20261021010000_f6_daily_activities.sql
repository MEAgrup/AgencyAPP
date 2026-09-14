-- ============================================================================
-- F-6 (feedback lapangan 2026-09-14) — Daily Activity (DACT-).
--
-- Permintaan Account: riwayat aktivitas harian karyawan — kegiatan (meeting
-- klien / internal / training / webinar / input data), waktu, bukti
-- pelaksanaan. Pemilik menjawab (AskUserQuestion, 2026-09-14): ini KELUARAN
-- KERJA, nyambung ke M14 Team Performance — BUKAN absensi (jam masuk/pulang),
-- yang tetap milik HRIS (CLAUDE.md: CDPS bukan HRIS).
--
-- DEVIASI PRD — tidak ada modul PRD yang mendefinisikan entitas ini; dicatat
-- di docs/DECISIONS.md (2026-09-14, F-6) seperti `prospect_activities` (O-nya
-- sendiri, 2026-08-06) sebelum ini.
--
-- Bentuknya SENGAJA meniru `prospect_activities`
-- (20260806050000_prospect_activity_and_komisi_service.sql) — log, bukan
-- lifecycle:
--   #2 status hanya lewat engine ⇒ TIDAK ADA kolom status. Mencatat aktivitas
--      bukan transisi apa pun; sm_machines TIDAK bertambah.
--   #3 riwayat immutable ⇒ INSERT-only, `forbid_mutation()` menolak
--      UPDATE/DELETE. Salah catat ⇒ catat ulang, bukan edit.
--   #4 field terhitung read-only ⇒ rollup (kalau dibutuhkan M14 nanti) selalu
--      count(*)/group-by atas log ini, tidak pernah disimpan terpisah.
--
-- `divisi` DIDENORMALISASI dari `employees`/role mapping actor SAAT MENCATAT
-- (bukan di-join saat RLS dievaluasi) — pola PERSIS `internal_tasks.
-- assignee_division` (20260814110000_penugasan_internal.sql): `employees.
-- divisi` adalah divisi HRIS mentah, BUKAN divisi CDPS (rls_baseline §5
-- comment), jadi RLS tidak bisa join employees langsung untuk menyaring per
-- divisi CDPS.
--
-- Prefix `DACT`, BUKAN `ACT` — `ACT` sudah dipakai (`Prospect activity`,
-- M0/M1). Reuse akan menyamarkan dua entitas berbeda di balik satu prefix,
-- persis kelas cacat yang registry ini ada untuk mencegah.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Entity: aktivitas harian (DACT-YYYYMM-NNNN)
-- ---------------------------------------------------------------------------
CREATE TABLE daily_activities (
    id                varchar(32)   NOT NULL PRIMARY KEY,
    employee_id       varchar(64)   NOT NULL REFERENCES employees (employee_id),
    -- Divisi CDPS (bukan divisi HRIS mentah) actor SAAT mencatat — lihat
    -- catatan header. Dipakai RLS, bukan employees.divisi.
    divisi            varchar(64)   NOT NULL,
    activity_type     varchar(32)   NOT NULL,
    activity_date     date          NOT NULL,
    jam_mulai         time          NOT NULL,
    jam_selesai       time          NULL,
    keterangan        varchar(2000) NOT NULL,
    bukti_pelaksanaan varchar(255)  NULL,
    created_at        timestamptz   NOT NULL DEFAULT now(),
    created_by        varchar(64)   NOT NULL,
    -- Daftar TERTUTUP, ditegakkan DB — persis pola ck_act_type
    -- (prospect_activities) dan NQ-reasons: menambah jenis butuh migrasi +
    -- entri DECISIONS, bukan string bebas dari pemanggil service-role.
    CONSTRAINT ck_dact_type CHECK (activity_type IN
        ('Meeting Klien', 'Meeting Internal', 'Training', 'Webinar', 'Input Data', 'Lainnya')),
    CONSTRAINT ck_dact_keterangan CHECK (btrim(keterangan) <> ''),
    CONSTRAINT ck_dact_jam CHECK (jam_selesai IS NULL OR jam_selesai >= jam_mulai)
);
CREATE INDEX idx_dact_employee ON daily_activities (employee_id, activity_date DESC);
CREATE INDEX idx_dact_divisi ON daily_activities (divisi, activity_date DESC);

-- Immutable: sekali tercatat, tidak bisa diubah maupun dihapus (house rule #3).
CREATE TRIGGER daily_activities_no_update BEFORE UPDATE ON daily_activities
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER daily_activities_no_delete BEFORE DELETE ON daily_activities
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

COMMENT ON TABLE daily_activities IS
  'F-6 (feedback lapangan 2026-09-14) — log aktivitas harian karyawan (keluaran '
  'kerja, BUKAN absensi/HRIS), nyambung M14 Team Performance. Append-only.';

-- ---------------------------------------------------------------------------
-- 2. RLS — staff hanya miliknya, Lead/SPV se-divisi, OD baca-semua, Director
--    penuh (Matriks Peran Phase 0 §4, persis permintaan handoff). Tulis lewat
--    service-role (domain layer), sama seperti prospect_activities.
-- ---------------------------------------------------------------------------
ALTER TABLE public.daily_activities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_activities FROM anon;
REVOKE ALL ON public.daily_activities FROM authenticated;
GRANT SELECT ON public.daily_activities TO authenticated;

CREATE POLICY daily_activities_select ON public.daily_activities FOR SELECT TO authenticated
USING (public.jwt_can_read_all()
       OR employee_id = public.jwt_employee_id()
       OR (public.jwt_is_lead() AND public.jwt_division() = divisi));

COMMENT ON POLICY daily_activities_select ON public.daily_activities IS
  'F-6 — staff hanya miliknya (employee_id), Lead/SPV se-divisi (divisi '
  'didenormalisasi, pola internal_tasks.assignee_division), OD/Director penuh '
  'lewat jwt_can_read_all().';

-- ---------------------------------------------------------------------------
-- 3. Prefix registry — dual-home dengan PREFIXES di
--    packages/core/src/ident.ts, dipaksa identik oleh ident.registry.test.ts.
-- ---------------------------------------------------------------------------
INSERT INTO entity_prefix (prefix, entity_name, module) VALUES
    ('DACT', 'Daily activity (keluaran kerja harian)', 'M14');

-- Nol mesin (sm_machines TETAP) — log, bukan lifecycle. Nol event notifikasi
-- (notif_events TETAP) — mencatat aktivitas sendiri tidak perlu memberi tahu
-- siapa pun; rollup untuk atasan dibaca, bukan didorong.
