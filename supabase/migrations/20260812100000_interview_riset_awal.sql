-- CDPS — Modul Interview / "Kelola Klien" LANGKAH 1: **Riset Awal**.
--
-- QA pemilik 2026-08-12: alur "Kelola Klien" seharusnya TIGA langkah —
--   1. Riset Awal  (AM login ke toko klien & mencatat data baseline)
--   2. Interview   (sudah ada, Modul Interview)
--   3. Buat Strategi (sudah ada, M6A)
-- Sistem hanya punya langkah 2 dan 3; langkah 1 hilang. Setiap langkah diukur
-- supaya timeline tidak terlewat (masuk ke kinerja AM/klien).
--
-- Migrasi ini adalah BAGIAN 1 dari dua bagian yang diminta pemilik:
--   * Bagian 1 (INI): catat KAPAN riset awal dimulai (= saat AM klik "Kelola
--     Klien"; membuka Kelola Klien BERARTI riset awal dimulai) dan KAPAN
--     di-submit, supaya lama pengerjaan terukur.
--   * Bagian 2 (NANTI): kolom isian riset awal — sebagian dipindah dari daftar
--     pertanyaan Interview. Tabel ini sengaja dibiarkan tipis supaya bagian 2
--     menambah tabel anak `interview_riset_awal_isian` tanpa membongkar apa pun.
--
-- ---------------------------------------------------------------------------
-- KEPUTUSAN YANG DITEGAKKAN DI DB (bukan hanya di TS)
-- ---------------------------------------------------------------------------
--  * DURASI TIDAK DISIMPAN. Ia diturunkan saat baca dari `disubmit_pada −
--    dimulai_pada` (house rule #4: field terhitung selalu recomputable dari log).
--    Nol kolom durasi ⇒ tidak ada angka yang bisa berbohong terhadap jangkarnya.
--  * JANGKAR WAKTU IMMUTABLE. `dimulai_pada` tak pernah boleh berubah, dan
--    `disubmit_pada` beku setelah terisi (trigger `trg_riset_awal_jangkar`).
--    Tanpa ini "berapa lama" hanyalah kolom yang bisa diketik ulang.
--  * STATUS HANYA LEWAT sm_transition. Mesin #20 `riset_awal`
--    (`Berjalan → Selesai`, Selesai terminal). Submit = satu baris audit_log
--    immutable, jadi durasi juga bisa direkonstruksi dari audit_log saja.
--  * SATU RISET AWAL PER INTERVIEW (PK = interview_id). Barisnya lahir bersama
--    interview-nya di transaksi yang sama (klik "Kelola Klien"), bukan menunggu
--    AM menekan apa pun — kalau tidak, "mulai" jadi kejadian yang bisa ditunda.
--  * TANPA AMBANG SLA. Berapa lama riset awal BOLEH berjalan adalah fakta bisnis
--    yang belum diberikan pemilik; menebaknya berarti mengarang KPI. Migrasi ini
--    hanya MENGUKUR. Lihat DECISIONS 2026-08-12 (pertanyaan terbuka RA-1).

-- ===========================================================================
-- 1. interview_riset_awal — 1:1 dengan interview (anak, tanpa prefix ID baru).
--    Kunci alaminya interview_id (preseden `plan_satuan`: kunci rantai =
--    client_id, nol prefix baru). Riset awal TIDAK berdiri sendiri: ia adalah
--    langkah pertama dari satu sesi Kelola Klien, dan sesi itu = satu ITV.
-- ===========================================================================
CREATE TABLE interview_riset_awal (
    interview_id   varchar(32)  NOT NULL PRIMARY KEY,

    status         varchar(24)  NOT NULL DEFAULT 'Berjalan',

    -- Jangkar mulai = saat interview dibuat (klik "Kelola Klien"). Beku.
    dimulai_pada   timestamptz  NOT NULL DEFAULT now(),
    dimulai_oleh   varchar(64)  NOT NULL,

    -- Jangkar selesai = saat AM menekan "Submit riset awal". Beku setelah terisi.
    disubmit_pada  timestamptz  NULL,
    disubmit_oleh  varchar(64)  NULL,

    created_at     timestamptz  NOT NULL DEFAULT now(),
    updated_at     timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT fk_riset_awal_interview FOREIGN KEY (interview_id) REFERENCES interview (id) ON DELETE CASCADE,
    CONSTRAINT fk_riset_awal_dimulai   FOREIGN KEY (dimulai_oleh)  REFERENCES employees (employee_id),
    CONSTRAINT fk_riset_awal_disubmit  FOREIGN KEY (disubmit_oleh) REFERENCES employees (employee_id),

    CONSTRAINT ck_riset_awal_status CHECK (status IN ('Berjalan', 'Selesai')),
    -- 'Selesai' menuntut kedua jangkar submit. Route menulis jangkar SEBELUM
    -- sm_transition di transaksi yang sama (pola alasan_pembatalan di interview),
    -- jadi CHECK non-deferrable cukup. Arah sebaliknya TIDAK di-CHECK: menulis
    -- jangkar saat masih 'Berjalan' adalah langkah sah dari urutan itu.
    CONSTRAINT ck_riset_awal_selesai CHECK (
        status <> 'Selesai' OR (disubmit_pada IS NOT NULL AND disubmit_oleh IS NOT NULL)),
    -- Durasi tidak boleh negatif — submit tak pernah mendahului mulai.
    CONSTRAINT ck_riset_awal_urutan CHECK (
        disubmit_pada IS NULL OR disubmit_pada >= dimulai_pada)
);

CREATE INDEX idx_riset_awal_status ON interview_riset_awal (status);

COMMENT ON TABLE interview_riset_awal IS
  'Langkah 1 "Kelola Klien" (Riset Awal). Mengukur lama pengerjaan: dimulai_pada = klik Kelola Klien, disubmit_pada = klik Submit. DURASI TIDAK DISIMPAN — diturunkan saat baca (house rule #4).';

-- ===========================================================================
-- 2. Jangkar waktu beku — inti dari "diukur", bukan "diketik".
--    UPDATE boleh menyentuh status (via sm_transition) dan mengisi jangkar
--    submit SEKALI. Mengubah jangkar yang sudah ada, atau menghidupkan kembali
--    riset awal yang sudah Selesai, ditolak. DELETE dibiarkan (ON DELETE CASCADE
--    dari interview; produksi tak pernah menghapus interview).
-- ===========================================================================
CREATE OR REPLACE FUNCTION interview_riset_awal_jangkar_frozen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.dimulai_pada IS DISTINCT FROM OLD.dimulai_pada THEN
        RAISE EXCEPTION 'interview_riset_awal: dimulai_pada beku — jangkar durasi tidak boleh diubah';
    END IF;
    IF NEW.dimulai_oleh IS DISTINCT FROM OLD.dimulai_oleh THEN
        RAISE EXCEPTION 'interview_riset_awal: dimulai_oleh beku';
    END IF;
    IF OLD.disubmit_pada IS NOT NULL AND NEW.disubmit_pada IS DISTINCT FROM OLD.disubmit_pada THEN
        RAISE EXCEPTION 'interview_riset_awal: disubmit_pada beku setelah submit';
    END IF;
    IF OLD.disubmit_oleh IS NOT NULL AND NEW.disubmit_oleh IS DISTINCT FROM OLD.disubmit_oleh THEN
        RAISE EXCEPTION 'interview_riset_awal: disubmit_oleh beku setelah submit';
    END IF;
    IF OLD.status = 'Selesai' AND NEW.status <> 'Selesai' THEN
        RAISE EXCEPTION 'interview_riset_awal: Selesai adalah state terminal';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_riset_awal_jangkar
    BEFORE UPDATE ON interview_riset_awal
    FOR EACH ROW EXECUTE FUNCTION interview_riset_awal_jangkar_frozen();

-- ===========================================================================
-- 3. State machine `riset_awal` (mesin #20 — data, bukan kode).
--    Dua state saja, sesuai yang diminta: mulai dan submit. Tidak ada edge
--    "buka kembali" — menambahnya akan memindahkan jangkar dan merusak ukuran
--    yang justru jadi alasan langkah ini ada (butuh keputusan pemilik dulu).
-- ===========================================================================
INSERT INTO sm_machines (name, initial_state) VALUES
    ('riset_awal', 'Berjalan');

INSERT INTO sm_terminal_states (machine, state) VALUES
    ('riset_awal', 'Selesai');

INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('riset_awal', 'Berjalan', 'Selesai', false);

-- ===========================================================================
-- 4. Backfill — setiap interview yang sudah ada mendapat riset awal berjangkar
--    pada saat interview itu dibuat (itulah kapan "Kelola Klien" diklik).
--    Idempoten: LEFT JOIN anti-semi, jadi apply ulang tak menggandakan.
-- ===========================================================================
INSERT INTO interview_riset_awal (interview_id, dimulai_pada, dimulai_oleh, created_at)
SELECT i.id, i.created_at, i.am_pengisi_id, i.created_at
  FROM interview i
  LEFT JOIN interview_riset_awal r ON r.interview_id = i.id
 WHERE r.interview_id IS NULL;

-- ===========================================================================
-- 5. RLS — cermin persis `interview_jadwal_sel`: scope Account (assigned AM /
--    Account lead / OD / Director). Sales default-deny (riset awal memuat data
--    baseline toko klien — hard-internal Account, sama seperti Blok B).
--    Model tulis = default-deny untuk authenticated; tulis lewat service-role
--    dengan izin ditegakkan di domain (packages/domain/src/interview.ts).
--    Arm lead/divisi DI-INLINE supaya detektor O48 (rls_checks.sql §42)
--    melihatnya dan tabel ini tidak perlu masuk ledger.
-- ===========================================================================
REVOKE ALL ON public.interview_riset_awal FROM anon;
REVOKE ALL ON public.interview_riset_awal FROM authenticated;
ALTER TABLE public.interview_riset_awal ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.interview_riset_awal TO authenticated;

CREATE POLICY interview_riset_awal_sel ON public.interview_riset_awal FOR SELECT TO authenticated
    USING (public.jwt_can_read_all()
           OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
           OR public.jwt_owns_interview_am(interview_id));
