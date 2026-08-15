-- CDPS — PENUGASAN INTERNAL (`TSK-`): atasan menugaskan anggota timnya.
--
-- ---------------------------------------------------------------------------
-- KENAPA MODUL BARU, BUKAN PERLUASAN M12
-- ---------------------------------------------------------------------------
-- Permintaan pemilik 2026-08-14: *"halaman untuk membuat task, lengkap dengan
-- due date, … kolom yang diisi (bisa berupa link drive) … task yg selesai akan
-- tercatat, dan apabila task yg tidak selesai, lewat waktu itu tercatat sebagai
-- log juga untuk menghitung performa team"*.
--
-- M12 TIDAK bisa memikul ini. Definisi Task-nya beku di PRD M12 §2 Rule 1:
-- Task = Asset (M7) | Creator Booking (M9) | Brief-as-task (M8) — ketiganya
-- WAJIB turunan rantai Klien → Service → Brief (M6 §5). Tidak ada satu pun
-- jalan di sistem hari ini untuk menugaskan pekerjaan yang bukan pekerjaan
-- klien (mis. Direktur → Head Finance: "siapkan laporan bulanan"). Melonggarkan
-- M12 supaya Brief boleh tanpa Service berarti membongkar gerbang pembayaran
-- M4/M5 yang justru menjadi alasan rantai itu ada.
--
-- Jadi: entitas SENDIRI, mesin SENDIRI, tabel SENDIRI. M12 tidak disentuh sama
-- sekali, dan tidak ada versi kedua dari aturan bisnis yang sama.
--
-- ---------------------------------------------------------------------------
-- KEPUTUSAN YANG DITEGAKKAN DI DB (bukan hanya di TS)
-- ---------------------------------------------------------------------------
--  * KETERLAMBATAN TIDAK DISIMPAN SEBAGAI KOLOM. Ia diturunkan saat baca dari
--    `due_date` + `selesai_pada` + `status` (house rule #4). Nol kolom
--    `terlambat`/`pernah_terlambat` ⇒ tidak ada angka yang bisa berbohong
--    terhadap jangkarnya, dan angka performa selalu recomputable:
--      - selesai tepat waktu : status [Selesai] AND selesai_pada(WIB)::date <= due_date
--      - selesai TERLAMBAT   : status [Selesai] AND selesai_pada(WIB)::date >  due_date
--      - terlambat berjalan  : status belum terminal AND due_date < hari ini (WIB)
--    Ini yang membuat pilihan pemilik "flag permanen, tetap bisa diselesaikan"
--    benar-benar permanen: telat tetap terbaca telat setelah tugasnya beres,
--    karena yang dibandingkan adalah dua tanggal yang keduanya beku.
--  * JANGKAR WAKTU IMMUTABLE. `dimulai_pada` dan `selesai_pada` beku setelah
--    terisi (trigger `trg_internal_tasks_jangkar`). Tanpa ini "terlambat"
--    hanyalah kolom yang bisa diketik ulang oleh orang yang sedang dinilai.
--  * STATUS HANYA LEWAT sm_transition. Mesin #21 `internal_task`.
--  * PENUGASAN BEKU. `assignee_id`, `assignee_division`, `due_date`, dan
--    `created_by` tidak bisa diubah setelah baris lahir — memindahkan due date
--    setelah lewat tenggat adalah cara paling mudah menghapus keterlambatan
--    dari catatan. Salah tugas ⇒ [Dibatalkan] lalu tugaskan ulang (jejaknya
--    utuh), bukan edit senyap.
--  * DIVISI PENUGASAN DIBEKUKAN DI BARIS. `assignee_division` disalin saat
--    penugasan dibuat, bukan di-join ke `role_mappings` saat baca: karyawan yang
--    pindah divisi tidak boleh memindahkan catatan performa lamanya ke divisi
--    baru, dan atasan lama harus tetap bisa membaca tugas yang ia berikan.
--
-- ---------------------------------------------------------------------------
-- CAKUPAN v1 — apa yang SENGAJA TIDAK ada di sini
-- ---------------------------------------------------------------------------
--  * TIDAK ADA BOBOT M14. Pemilik memilih "catat + dashboard terpisah" (lihat
--    DECISIONS 2026-08-14). Bobot KPI M14 §9 baru ditandatangani 2026-08-13
--    (RM-9a) dan tiap profil peran pas 100 — menyisipkan komponen berbobot di
--    sini berarti memotong ulang bobot yang baru saja disepakati, tanpa satu
--    bulan pun data nyata untuk membenarkan angkanya. `PERF-` tidak disentuh.
--  * TIDAK ADA JOB NOTIFIKASI JATUH TEMPO. Keterlambatan TERLIHAT (daftar +
--    dashboard) dan TERCATAT (turunan di atas); yang belum ada hanya notifikasi
--    terjadwalnya, karena itu butuh job cron tersendiri (pola D-06). Dicatat
--    sebagai tindak lanjut di DECISIONS, bukan ditambal diam-diam.

-- ===========================================================================
-- 1. Registry prefix (TSK) — house rule #1, ID lahir HANYA lewat ident_next.
-- ===========================================================================
INSERT INTO entity_prefix (prefix, entity_name, module) VALUES
    ('TSK', 'Penugasan Internal (internal task)', 'Penugasan');

-- ===========================================================================
-- 2. Mesin #21 `internal_task` (data, bukan kode).
--
--    [Ditugaskan] → [Dikerjakan] → [Selesai]         (terminal)
--    [Ditugaskan] → [Dibatalkan]                      (terminal, atasan)
--    [Dikerjakan] → [Dibatalkan]                      (terminal, atasan)
--
--    `require_lead` pada kedua edge [Dibatalkan]: yang membatalkan penugasan
--    adalah yang memberikannya, dan pemberi tugas menurut definisi lead/SPV/
--    Direktur (gerbang SIAPA persisnya di domain). Tanpa gerbang ini, PIC yang
--    sedang dinilai bisa menghapus tugasnya sendiri dari hitungan — mode gagal
--    yang sama persis dengan alasan M12 §5.3a mengunci [Blocked] ke SPV/Lead.
--
--    TIDAK ADA edge "buka kembali" dari [Selesai]: ia akan memindahkan
--    `selesai_pada` dan merusak ukuran yang justru jadi alasan modul ini ada.
--    Butuh keputusan pemilik lebih dulu (sama seperti mesin #20 `riset_awal`).
-- ===========================================================================
INSERT INTO sm_machines (name, initial_state, auto_computed, flags) VALUES
    ('internal_task', '[Ditugaskan]', false, '{}');

INSERT INTO sm_terminal_states (machine, state) VALUES
    ('internal_task', '[Selesai]'),
    ('internal_task', '[Dibatalkan]');

INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('internal_task', '[Ditugaskan]', '[Dikerjakan]', false),  -- PIC mulai
    ('internal_task', '[Dikerjakan]', '[Selesai]',    false),  -- PIC selesai + link hasil
    ('internal_task', '[Ditugaskan]', '[Dibatalkan]', true),   -- atasan batalkan
    ('internal_task', '[Dikerjakan]', '[Dibatalkan]', true);   -- atasan batalkan

-- ===========================================================================
-- 3. Tabel internal_tasks.
-- ===========================================================================
CREATE TABLE internal_tasks (
    id                varchar(32)  NOT NULL PRIMARY KEY,          -- TSK-YYYYMM-NNNN

    judul             text         NOT NULL,
    deskripsi         text         NOT NULL DEFAULT '',

    -- Kepada siapa. Divisi dibekukan di baris (lihat catatan kepala berkas).
    assignee_id       varchar(64)  NOT NULL,
    assignee_division varchar(32)  NOT NULL,

    due_date          date         NOT NULL,

    -- Dua link yang berbeda peran, mencontoh pasangan yang SUDAH ada di sistem:
    --   lampiran_link = rujukan dari pemberi tugas  (cermin Brief.reference_attachments, M6)
    --   link_hasil    = hasil kerja dari PIC        (cermin Asset.output_link, M7 — wajib saat submit)
    -- Keduanya teks bebas: Drive, Sheets, Figma, atau apa pun yang dipakai tim.
    lampiran_link     text         NOT NULL DEFAULT '',
    link_hasil        text         NOT NULL DEFAULT '',

    status            varchar(24)  NOT NULL DEFAULT '[Ditugaskan]',

    -- Jangkar beku. NULL = belum terjadi. Tidak ada kolom durasi/keterlambatan:
    -- semuanya diturunkan dari ketiga tanggal + status saat baca.
    dimulai_pada      timestamptz  NULL,
    selesai_pada      timestamptz  NULL,
    dibatalkan_pada   timestamptz  NULL,
    alasan_pembatalan text         NOT NULL DEFAULT '',

    created_at        timestamptz  NOT NULL DEFAULT now(),
    created_by        varchar(64)  NOT NULL,                      -- pemberi tugas (atasan)
    updated_at        timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT fk_internal_tasks_assignee FOREIGN KEY (assignee_id) REFERENCES employees (employee_id),
    CONSTRAINT fk_internal_tasks_creator  FOREIGN KEY (created_by)  REFERENCES employees (employee_id),

    -- [Selesai] menuntut jangkar + link hasil. Domain menulis keduanya SEBELUM
    -- sm_transition di transaksi yang sama (pola `alasan_pembatalan` interview /
    -- `disubmit_pada` riset awal), jadi CHECK non-deferrable cukup. Arah
    -- sebaliknya TIDAK di-CHECK: mengisi jangkar saat masih [Dikerjakan] adalah
    -- langkah sah dari urutan itu.
    CONSTRAINT ck_internal_tasks_selesai CHECK (
        status <> '[Selesai]' OR (selesai_pada IS NOT NULL AND btrim(link_hasil) <> '')),
    CONSTRAINT ck_internal_tasks_batal CHECK (
        status <> '[Dibatalkan]' OR dibatalkan_pada IS NOT NULL),
    -- Urutan waktu tidak boleh mundur.
    CONSTRAINT ck_internal_tasks_urutan CHECK (
        selesai_pada IS NULL OR dimulai_pada IS NULL OR selesai_pada >= dimulai_pada)
);

-- Daftar "tugas saya" (PIC, terbaru dulu) dan daftar per divisi/atasan.
CREATE INDEX idx_internal_tasks_assignee ON internal_tasks (assignee_id, status, due_date);
CREATE INDEX idx_internal_tasks_division ON internal_tasks (assignee_division, status, due_date);
CREATE INDEX idx_internal_tasks_creator  ON internal_tasks (created_by, due_date);

-- ===========================================================================
-- 4. Jangkar + penugasan beku.
--
--    UPDATE boleh: menggerakkan status (lewat sm_transition), mengisi jangkar
--    SEKALI, mengisi link_hasil, mengisi alasan_pembatalan. Selebihnya ditolak
--    di DB — termasuk menggeser due_date, yang merupakan cara termudah membuat
--    keterlambatan menghilang dari catatan performa.
-- ===========================================================================
CREATE OR REPLACE FUNCTION internal_tasks_beku()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'internal_tasks: id beku';
    END IF;
    IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
        RAISE EXCEPTION 'internal_tasks: assignee_id beku — batalkan lalu tugaskan ulang';
    END IF;
    IF NEW.assignee_division IS DISTINCT FROM OLD.assignee_division THEN
        RAISE EXCEPTION 'internal_tasks: assignee_division beku';
    END IF;
    IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
        RAISE EXCEPTION 'internal_tasks: due_date beku — menggesernya menghapus keterlambatan dari catatan';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION 'internal_tasks: created_by beku';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'internal_tasks: created_at beku';
    END IF;
    IF OLD.dimulai_pada IS NOT NULL AND NEW.dimulai_pada IS DISTINCT FROM OLD.dimulai_pada THEN
        RAISE EXCEPTION 'internal_tasks: dimulai_pada beku — jangkar durasi tidak boleh diubah';
    END IF;
    IF OLD.selesai_pada IS NOT NULL AND NEW.selesai_pada IS DISTINCT FROM OLD.selesai_pada THEN
        RAISE EXCEPTION 'internal_tasks: selesai_pada beku setelah selesai';
    END IF;
    IF OLD.dibatalkan_pada IS NOT NULL AND NEW.dibatalkan_pada IS DISTINCT FROM OLD.dibatalkan_pada THEN
        RAISE EXCEPTION 'internal_tasks: dibatalkan_pada beku setelah dibatalkan';
    END IF;
    -- Link hasil beku setelah [Selesai]: mengganti bukti setelah dinilai adalah
    -- mengedit riwayat. Sebelum selesai ia bebas diisi/diperbaiki PIC.
    IF OLD.status = '[Selesai]' AND NEW.link_hasil IS DISTINCT FROM OLD.link_hasil THEN
        RAISE EXCEPTION 'internal_tasks: link_hasil beku setelah [Selesai]';
    END IF;
    IF OLD.status IN ('[Selesai]', '[Dibatalkan]') AND NEW.status <> OLD.status THEN
        RAISE EXCEPTION 'internal_tasks: % adalah state terminal', OLD.status;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_internal_tasks_jangkar
    BEFORE UPDATE ON internal_tasks
    FOR EACH ROW EXECUTE FUNCTION internal_tasks_beku();

-- ===========================================================================
-- 5. RLS — kunci kedua di bawah gerbang TS (pola D-12 / T-4c).
--
--    Tiga arm, cermin persis Role Matrix Fase 0 §4 yang dipilih pemilik:
--      * OD/Direktur      : baca semua              (jwt_can_read_all)
--      * Lead/SPV divisi   : baca divisinya sendiri  (jwt_is_lead + divisi baris)
--      * Staff             : baris SENDIRI — sebagai PIC (arm assignee_id)
--                            ATAU sebagai pemberi tugas (arm created_by).
--
--    Arm `created_by` bukan duplikat arm divisi: ia yang menjaga agar pemberi
--    tugas tetap bisa membaca tugas yang ia berikan setelah ia sendiri berpindah
--    divisi — tanpanya, tugas yang ia buat menghilang dari matanya sendiri.
--
--    Arm divisi memakai `assignee_division` (kolom beku), BUKAN join ke
--    role_mappings — supaya baris tidak berpindah pemilik saat karyawan pindah
--    divisi. Pelajaran O52: policy yang men-join tabel lain membuang barisnya.
-- ===========================================================================
ALTER TABLE public.internal_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY internal_tasks_select ON public.internal_tasks FOR SELECT TO authenticated
USING (public.jwt_can_read_all()
       OR (public.jwt_is_lead() AND public.jwt_division() = assignee_division)
       OR public.jwt_employee_id() = assignee_id
       OR public.jwt_employee_id() = created_by);

-- ⚠️ WAJIB, dan mudah terlupa: `readAsActor` (apps/api/src/lib/db.ts, O37)
-- BERPINDAH ke role `authenticated` sebelum membaca. Tanpa GRANT ini, policy di
-- atas tidak pernah sempat dievaluasi — Postgres menolak lebih dulu dengan
-- "permission denied for table internal_tasks", dan SETIAP pembacaan lewat API
-- gagal untuk SEMUA orang. RLS memberi row-scope; GRANT-lah yang memberi akses
-- tabelnya. Ditemukan oleh `rls_checks` §43, bukan oleh test domain — test
-- domain memakai koneksi service-role, jadi ia buta terhadap kelas cacat ini.
GRANT SELECT ON public.internal_tasks TO authenticated;

REVOKE ALL ON public.internal_tasks FROM anon;

-- --- Kesetaraan lingkungan: client_milestones (T-4c) ------------------------
-- ⚠️ KOREKSI (2026-08-14, sesudah apply ke CDPS SG). Komentar versi pertama
-- berkas ini menyatakan halaman Upcoming Milestones "gagal untuk setiap pembaca
-- hari ini". **Itu SALAH untuk produksi**, dan koreksinya dicatat di DECISIONS.
--
-- Yang benar: `20260814070000_t4c_milestones.sql` memang tidak pernah GRANT
-- SELECT, tapi proyek Supabase memasang `ALTER DEFAULT PRIVILEGES IN SCHEMA
-- public GRANT ALL ON TABLES TO authenticated`, jadi di produksi tabel itu
-- SUDAH punya hibah (`authenticated=arwdDxtm`) dan halamannya jalan normal.
-- Yang benar-benar rusak adalah Postgres POLOS — CI dan `scripts/db-rebuild.sh`
-- — yang tidak punya default privileges itu.
--
-- GRANT di bawah karena itu bukan perbaikan bug produksi melainkan penyetaraan
-- lingkungan: ia membuat migrasi berdiri sendiri, sehingga DB yang dibangun dari
-- berkas repo berperilaku sama dengan live. Di produksi ia no-op (hibah sudah
-- ada dan lebih luas). Tetap dipertahankan justru karena itu.
--
-- Tabel lain yang muncul di query itu (sm_edges, role_mappings,
-- employee_credentials, id_sequences, …) TIDAK disentuh: semuanya memang
-- sengaja tertutup (O51 / 20260803123327), dan membuka salah satunya "supaya
-- konsisten" adalah keputusan visibility, bukan perbaikan.
GRANT SELECT ON public.client_milestones TO authenticated;

-- ===========================================================================
-- 6. Katalog notifikasi v9 (+2 event).
--    Registrasi lewat SATU baris notif_catalog_versions (event_count: 2).
--    Invariant O55 menghitung SUM(event_count) = COUNT(notif_events) — JANGAN
--    hardcode 54. Gate hitung notif_events 52 → 54 di .github/workflows/ci.yml
--    + scripts/db-rebuild.sh dinaikkan bersama migrasi ini (satu commit).
--
--    DUA event, bukan tiga: `penugasan_jatuh_tempo` sengaja TIDAK didaftarkan
--    karena emitternya (job cron harian) belum dibangun — mendaftarkan event
--    yang tak pernah diemisikan hanya membuat katalog berbohong.
-- ===========================================================================
INSERT INTO notif_catalog_versions (version, description, event_count, decision_ref) VALUES
    (9,
     'Penugasan Internal — 2 event (penugasan_ditugaskan → PIC; penugasan_selesai → pemberi tugas)',
     2,
     'docs/DECISIONS.md 2026-08-14 (Penugasan Internal — permintaan pemilik)');

INSERT INTO notif_events (event_type, description, resolver, catalog_version) VALUES
    ('penugasan_ditugaskan', 'Penugasan internal baru diberikan — ke karyawan yang ditugaskan', 'explicit', 9),
    ('penugasan_selesai',    'Penugasan internal ditandai selesai PIC — ke pemberi tugas',      'explicit', 9);
