-- ============================================================================
-- Improvement Req Account (pemilik, 2026-09-30) — butir 1, 2, 3.
-- Rujukan: docs/DECISIONS.md 2026-09-30 "BRIEF-KEMBALI-SIKLUS".
--
-- 1. AM bisa MEREVISI brief yang dikembalikan divisi lalu MENGIRIM ULANG-nya.
--    LT-4 sudah memberi edge balik `Brief Dikembalikan ke AM → Cek Brief AM`,
--    tapi hanya untuk divisi BER-pipeline, tanpa jalur ubah isi, dan
--    `brief_review` append-ONCE membuat divisi tidak bisa menilai ulang brief
--    hasil revisi. Divisi TANPA pipeline (Ads, Store Operation) — contoh di
--    dokumen pemilik justru Ads — buntu total: brief yang dikembalikan tidak
--    punya jalan keluar sama sekali.
--
--    Jawabannya SIKLUS PUTARAN:
--      * `brief_review` jadi multi-baris: PK (brief_id, putaran). Satu baris per
--        keputusan divisi, tetap append-only di domain (nol UPDATE/DELETE).
--      * `brief_kirim_ulang` BARU: satu baris per kiriman ulang AM, ber-putaran
--        yang sama dengan pengembalian yang dijawabnya. Menyimpan catatan revisi
--        + perubahan field (before/after). Append-only.
--      * Putaran n+1 hanya terbuka sesudah kiriman ulang putaran n.
--
-- 2. Brief yang dikembalikan tampil HOLD di sisi divisi (bukan `[In Progress]`).
--    Hold di sini adalah STATUS TURUNAN (`private.brief_intake_state`), BUKAN
--    state baru di mesin `brief_task` — menambah state ke mesin itu akan
--    menggeser turnaround/Speed Score seluruh Brief (computeMetrics membaca nama
--    state dari audit_log). Kolom `status` tidak disentuh.
--
-- 3. Brief yang sudah DITERIMA divisi (Cek Brief AM) otomatis `[In Progress]`.
--    Domain (`brief-intake.ts`) mendorong `[To Do] → [In Progress]` di transaksi
--    yang sama dengan keputusan "Diterima". Brief lama yang sudah Diterima tapi
--    masih `[To Do]` didorong di sini lewat `sm_transition` (aktor SISTEM),
--    pola backfill 20260922100400 — bukan UPDATE mentah.
--
-- Gate: tabel public 186 → 187 (+brief_kirim_ulang); entity_prefix 45 TETAP;
-- sm_machines 36 TETAP; notif_events 82 → 83 (katalog v21, +1 event).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. brief_review — multi-putaran.
-- ---------------------------------------------------------------------------
ALTER TABLE brief_review ADD COLUMN putaran smallint NOT NULL DEFAULT 1;
ALTER TABLE brief_review ADD CONSTRAINT ck_brief_review_putaran CHECK (putaran >= 1);
ALTER TABLE brief_review DROP CONSTRAINT brief_review_pkey;
ALTER TABLE brief_review ADD CONSTRAINT brief_review_pkey PRIMARY KEY (brief_id, putaran);

COMMENT ON TABLE brief_review IS
  'M16 — keputusan gerbang intake Cek Brief AM (PRD §2 Rule 10), SATU baris per '
  'PUTARAN (PK brief_id+putaran, sejak 2026-09-30 BRIEF-KEMBALI-SIKLUS). Putaran '
  'n+1 hanya lahir sesudah AM mengirim ulang (brief_kirim_ulang putaran n). '
  'Domain HANYA INSERT. Independen dari mesin tahapan: divisi TANPA pipeline '
  '(Rule 12) tetap bisa mengisi baris ini.';

-- Arm STAFF divisi pelaksana — cermin briefs_select (B-1/B-4). Tanpa arm ini
-- staff divisi yang bukan PIC membaca `review = null` dan panel tahapan
-- menawarkan tombol Terima/Kembalikan untuk brief yang sudah diputus.
DROP POLICY IF EXISTS brief_review_select ON public.brief_review;
CREATE POLICY brief_review_select ON public.brief_review FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM briefs b
   WHERE b.id = brief_review.brief_id
     AND (jwt_can_read_all()
          OR jwt_employee_id() IN (b.assigned_pic, b.created_by)
          OR (jwt_is_lead() AND b.assigned_division = jwt_division())
          OR private.jwt_is_am_of_service(b.service_id)
          OR (jwt_is_lead() AND jwt_division() = 'Account')
          OR (b.assigned_division = jwt_division() AND jwt_employee_id() <> ''))));

-- ---------------------------------------------------------------------------
-- 2. brief_kirim_ulang — kiriman ulang AM atas brief yang dikembalikan.
-- ---------------------------------------------------------------------------
CREATE TABLE brief_kirim_ulang (
    brief_id          varchar(32)  NOT NULL REFERENCES briefs (id),
    -- putaran pengembalian yang DIJAWAB kiriman ini (= brief_review.putaran).
    putaran           smallint     NOT NULL,
    catatan           text         NOT NULL,
    -- {field: {before, after}} — hanya field yang benar-benar berubah.
    perubahan         jsonb        NOT NULL DEFAULT '{}'::jsonb,
    actor_employee_id varchar(64)  NOT NULL,
    created_at        timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (brief_id, putaran),
    CONSTRAINT ck_brief_kirim_ulang_putaran CHECK (putaran >= 1),
    CONSTRAINT fk_brief_kirim_ulang_review
        FOREIGN KEY (brief_id, putaran) REFERENCES brief_review (brief_id, putaran)
);

COMMENT ON TABLE brief_kirim_ulang IS
  'BRIEF-KEMBALI-SIKLUS (2026-09-30) — satu baris per kiriman ulang AM atas brief '
  'yang dikembalikan divisi. putaran = putaran brief_review yang dijawab (FK). '
  'Domain HANYA INSERT (brief-intake.ts::kirimUlangBrief). `catatan` wajib: '
  'divisi harus tahu apa yang diperbaiki.';

REVOKE ALL ON public.brief_kirim_ulang FROM anon;
ALTER TABLE public.brief_kirim_ulang ENABLE ROW LEVEL SECURITY;
CREATE POLICY brief_kirim_ulang_select ON public.brief_kirim_ulang FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM briefs b
   WHERE b.id = brief_kirim_ulang.brief_id
     AND (jwt_can_read_all()
          OR jwt_employee_id() IN (b.assigned_pic, b.created_by)
          OR (jwt_is_lead() AND b.assigned_division = jwt_division())
          OR private.jwt_is_am_of_service(b.service_id)
          OR (jwt_is_lead() AND jwt_division() = 'Account')
          OR (b.assigned_division = jwt_division() AND jwt_employee_id() <> ''))));
GRANT SELECT ON public.brief_kirim_ulang TO authenticated;

-- Backfill: kiriman ulang LT-4 lama hanya tercatat sebagai transisi tahapan.
-- Jadikan baris putaran 1 supaya siklusnya terbaca utuh. Idempoten.
INSERT INTO brief_kirim_ulang (brief_id, putaran, catatan, perubahan, actor_employee_id, created_at)
SELECT DISTINCT ON (a.entity_id)
       a.entity_id, 1, '(kiriman ulang sebelum fitur revisi — tanpa catatan)', '{}'::jsonb,
       a.actor_employee_id, a.created_at
  FROM audit_log a
  JOIN brief_review r ON r.brief_id = a.entity_id AND r.putaran = 1 AND r.keputusan = 'Dikembalikan'
 WHERE a.entity_type = 'brief_stage'
   AND a.action = 'transition:Brief Dikembalikan ke AM->Cek Brief AM'
 ORDER BY a.entity_id, a.created_at ASC
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. private.brief_intake_state — status intake turunan.
--    'menunggu'     : belum diputus divisi (atau sudah dikirim ulang, putaran baru)
--    'diterima'     : putaran terakhir Diterima
--    'dikembalikan' : putaran terakhir Dikembalikan dan BELUM dikirim ulang ⇒ HOLD
--    Brief ber-pipeline yang tahapannya sudah lewat intake dianggap 'diterima'
--    (mesin tahapan sumber kebenaran untuk mereka; Brief Live lama lahir di
--    `Terima Sampel` tanpa intake).
--    SECURITY DEFINER: briefCols dibaca di bawah RLS (pola O52 / A-req-3).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.brief_intake_state(p_brief_id text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  WITH b AS (
    SELECT id, stage_pipeline_code, production_stage FROM public.briefs WHERE id = p_brief_id
  ), last_r AS (
    SELECT r.putaran, r.keputusan FROM public.brief_review r
     WHERE r.brief_id = p_brief_id ORDER BY r.putaran DESC LIMIT 1
  )
  SELECT CASE
           WHEN b.stage_pipeline_code IS NOT NULL AND b.production_stage IS NOT NULL
                AND b.production_stage NOT IN ('Cek Brief AM', 'Brief Dikembalikan ke AM')
             THEN 'diterima'
           WHEN (SELECT keputusan FROM last_r) IS NULL THEN 'menunggu'
           WHEN (SELECT keputusan FROM last_r) = 'Diterima' THEN 'diterima'
           WHEN EXISTS (SELECT 1 FROM public.brief_kirim_ulang k
                         WHERE k.brief_id = p_brief_id AND k.putaran = (SELECT putaran FROM last_r))
             THEN 'menunggu'
           ELSE 'dikembalikan'
         END
    FROM b
$$;

COMMENT ON FUNCTION private.brief_intake_state(text) IS
  'BRIEF-KEMBALI-SIKLUS — status intake turunan sebuah Brief: menunggu | diterima | '
  'dikembalikan (= HOLD, menunggu revisi AM). Turunan dari brief_review + '
  'brief_kirim_ulang (+ production_stage), nol kolom tersimpan. NULL untuk Brief '
  'tak dikenal.';

REVOKE EXECUTE ON FUNCTION private.brief_intake_state(text) FROM public;
REVOKE EXECUTE ON FUNCTION private.brief_intake_state(text) FROM anon;
GRANT  EXECUTE ON FUNCTION private.brief_intake_state(text) TO authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION private.brief_intake_state(text) TO service_role;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Katalog notifikasi v21 (+1 event): 82 → 83.
-- ---------------------------------------------------------------------------
INSERT INTO notif_catalog_versions (version, description, event_count, decision_ref) VALUES
    (21,
     'BRIEF-KEMBALI-SIKLUS — 1 event (m16.brief.dikirim_ulang): AM merevisi & mengirim ulang brief yang dikembalikan divisi.',
     1,
     'docs/DECISIONS.md 2026-09-30 (BRIEF-KEMBALI-SIKLUS)');

INSERT INTO notif_events (event_type, description, resolver, catalog_version) VALUES
    ('m16.brief.dikirim_ulang',
     'AM merevisi & mengirim ulang brief yang dikembalikan — ke divisi (penolak + PIC)',
     'explicit', 21);

-- ---------------------------------------------------------------------------
-- 5. Backfill butir 3: Brief yang sudah Diterima tapi masih [To Do].
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    r        record;
    res      jsonb;
    v_moved  integer := 0;
BEGIN
    FOR r IN
        SELECT b.id, b.service_id
          FROM briefs b
         WHERE b.status = '[To Do]'
           AND private.brief_intake_state(b.id) = 'diterima'
           AND EXISTS (SELECT 1 FROM brief_review x WHERE x.brief_id = b.id AND x.keputusan = 'Diterima')
         ORDER BY b.id ASC
    LOOP
        res := sm_transition('brief_task', 'brief', 'briefs', 'id', 'status', r.id, '[In Progress]',
                             'SISTEM', true, false, '');
        IF NOT (res ->> 'ok')::boolean THEN
            RAISE EXCEPTION 'brief_kembali backfill: % -> [In Progress] gagal: %', r.id, res;
        END IF;
        -- Cermin account.onBriefLeavesToDo: Service [Briefed] → [In Execution].
        IF (SELECT status FROM services WHERE id = r.service_id) = '[Briefed]' THEN
            res := sm_transition('service', 'service', 'services', 'id', 'status', r.service_id,
                                 '[In Execution]', 'SISTEM', true, false, '');
            IF NOT (res ->> 'ok')::boolean THEN
                RAISE EXCEPTION 'brief_kembali backfill: service % -> [In Execution] gagal: %', r.service_id, res;
            END IF;
        END IF;
        v_moved := v_moved + 1;
    END LOOP;
    RAISE NOTICE 'BRIEF-KEMBALI-SIKLUS backfill: % Brief Diterima didorong ke [In Progress]', v_moved;
END $$;
