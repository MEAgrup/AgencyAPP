-- CDPS M16 — Akun A "Tahapan & Metrik", Fase 2 (LT-20). Skema lapisan tahapan
-- produksi per Brief + lead time (PRD `CDPS_Module16_Lead_Time.md` §5.1,
-- STATE_MACHINES §18, DATA_MODEL.md baris M16). Rencana kerja penuh + keputusan
-- desain ada di `docs/handoff/HANDOFF_M16_AKUN_A.md` — baca itu untuk KENAPA di
-- balik setiap pilihan di sini; komentar di bawah hanya meringkas.
--
-- ---------------------------------------------------------------------------
-- EMPAT TABEL BARU (nol prefix ID baru — bukan entity ber-ID, konsisten dengan
-- registrasi Fase 1: division_registry juga PK kode, bukan ID bernomor).
-- ---------------------------------------------------------------------------
--   stage_pipeline    — satu baris per (divisi, deliverable_type) yang punya
--                       mesin tahapan. PK kode, FK ke division_registry DAN ke
--                       sm_machines (mesinnya di-seed di migrasi berikutnya,
--                       20260830020000, dalam urutan sm_machines dulu baru
--                       stage_pipeline — FK menuntutnya).
--   stage_definition  — SETIAP checkpoint pipeline, termasuk yang sumber='status_brief'
--                       (QC Account Service / Revisi) yang TIDAK punya state sendiri
--                       di mesin tahapan (Rule 3 PRD §2, STATE_MACHINES §18 "⟨…⟩").
--                       Konsekuensinya: sm_edges (migrasi berikutnya) HANYA merangkai
--                       checkpoint ber-sumber='stage'; dua checkpoint 'status_brief'
--                       ada di sini murni untuk timeline lead time lengkap AM
--                       (computeStageLeadTime menyisipkannya dari audit_log
--                       entity_type='brief' status Brief, bukan 'brief_stage').
--   brief_stage_sla   — override target per Brief (PRD §2 Rule 7), gerbang
--                       isLead(division) di domain — pola setSlaTarget M12,
--                       nol beda gerbang dengan Task SLA yang sudah ada.
--   brief_review      — keputusan Cek Brief AM (PRD §2 Rule 10). SATU baris per
--                       Brief (PK brief_id, BUKAN log appendable) — devisi hanya
--                       pernah menjawab gerbang intake SEKALI; mesin tahapan
--                       (audit_log entity_type='brief_stage') tetap jadi ledger
--                       immutable untuk PERGERAKAN tahap, brief_review murni
--                       menyimpan KEPUTUSAN + alasannya. Domain HANYA melakukan
--                       INSERT (tidak pernah UPDATE) — PK brief_id sendiri yang
--                       menolak percobaan kedua, konsisten aturan rumah #3.
--
-- ---------------------------------------------------------------------------
-- KENAPA `entity_type='brief_stage'`, BUKAN 'brief' (PRD §5.2 / STATE_MACHINES §18)
-- ---------------------------------------------------------------------------
-- sm_transition menulis audit_log dengan entity_type = p_entity_type apa adanya.
-- Menulis transisi tahapan sebagai 'brief' akan bercampur dengan transisi status
-- brief_task di computeMetrics (M12, task.ts) yang memfilter entity_type='brief' +
-- action LIKE 'transition:%', merusak turnaround/Speed Score/revision count SETIAP
-- Brief. Namespace 'brief_stage' dipakai APA ADANYA oleh packages/domain/src/stage.ts
-- (LT-22) — tidak ada perubahan pada sm_transition/audit_log di migrasi ini.
--
-- ---------------------------------------------------------------------------
-- KOLOM BARU `briefs.production_stage` / `briefs.stage_pipeline_code`
-- ---------------------------------------------------------------------------
-- Satu Brief = satu tahap aktif (PRD §2 Rule 1). Keduanya NULLABLE: Rule 12 —
-- "divisi boleh aktif tanpa pipeline" (Store Operation hari ini) — Brief tetap
-- didispatch dengan kedua kolom NULL, Cek Brief AM tetap terukur lewat
-- brief_review yang berdiri sendiri dari mesin tahapan (lihat HANDOFF §"Cek
-- Brief AM tanpa pipeline"). `production_stage` DITULIS HANYA lewat sm_transition
-- (aturan rumah #2) — insertBrief (account.ts) mengisinya SEKALI di INSERT awal
-- sebagai initial_state pipeline (pola yang sama seperti briefs.status/
-- internal_tasks.status diisi literal saat lahir, bukan lewat transisi).
--
-- ---------------------------------------------------------------------------
-- GATE (KEEP IN STEP dengan .github/workflows/ci.yml job `db-and-migrations`)
-- ---------------------------------------------------------------------------
--   tabel public  : 123 → 124 di migrasi ini (+3: stage_pipeline, brief_stage_sla,
--                   brief_review — stage_definition ikut migrasi ini juga, jadi
--                   sesungguhnya +4 di sini: 123 → 127). sm_machines/entity_prefix/
--                   notif_events TETAP di migrasi ini (mesin baru ada di
--                   20260830020000, prefix & event sudah dibereskan Tahap F).
--   Lihat catatan bump lengkap di 20260830020000 (migrasi itu yang menaikkan
--   sm_machines 23→28 setelah kelima mesin ter-INSERT).
--
-- Menyimpang dari §4 PARALEL_M16_DUA_AKUN.md yang menandai `scripts/db-rebuild.sh`
-- "F saja": brief ini WAJIB dibuktikan hijau dengan `scripts/db-rebuild.sh --yes`
-- pada DB nyata (instruksi tugas), yang secara arsitektural menuntut gate-nya
-- dinaikkan untuk delta Akun A. Akun B / langkah penggabungan menaikkannya lagi
-- di atas ini untuk delta mereka sendiri — angka aditif, konflik nol-drama.
-- Dicatat di HANDOFF_M16_AKUN_A.md sebagai deviasi sadar, bukan diam-diam.

-- ===========================================================================
-- 1. stage_pipeline
-- ===========================================================================
CREATE TABLE stage_pipeline (
    code             varchar(32)  NOT NULL PRIMARY KEY,
    division_code    varchar(32)  NOT NULL REFERENCES division_registry (code),
    deliverable_type varchar(64)  NULL,
    machine_name     text         NOT NULL REFERENCES sm_machines (name),
    aktif            boolean      NOT NULL DEFAULT true,
    created_at       timestamptz  NOT NULL DEFAULT now(),
    created_by       varchar(64)  NOT NULL DEFAULT 'SYSTEM',
    -- NULL deliverable_type = "satu-satunya pipeline divisi ini" (Creative/KOL/
    -- Live). AI Optimizer punya DUA baris dengan deliverable_type berbeda
    -- ('Optimasi SKU' / 'AI Video') — resolvePipeline (stage.ts) mencocokkan
    -- exact match dulu, baru fallback ke baris NULL.
    CONSTRAINT uq_stage_pipeline_machine UNIQUE (machine_name)
);

COMMENT ON TABLE stage_pipeline IS
  'M16 — satu baris per pipeline tahapan (divisi × deliverable_type opsional). Resolusi murni data: menambah divisi/deliverable baru = satu migrasi, nol kode TS (PRD §7 Success Metrics).';
COMMENT ON COLUMN stage_pipeline.deliverable_type IS
  'NULL = pipeline tunggal divisi ini. Non-NULL membedakan >1 pipeline dalam SATU divisi (AI Optimizer: Optimasi SKU vs AI Video).';

REVOKE ALL ON public.stage_pipeline FROM anon;
ALTER TABLE public.stage_pipeline ENABLE ROW LEVEL SECURITY;
-- Data referensi non-sensitif (definisi proses, bukan data klien) — dibaca
-- siapa pun yang terautentikasi, pola berbeda dari division_registry (default-deny)
-- karena FE (panel tahapan, LT-28) perlu menampilkannya langsung via readAsActor.
CREATE POLICY stage_pipeline_select ON public.stage_pipeline FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.stage_pipeline TO authenticated;

-- ===========================================================================
-- 2. stage_definition
-- ===========================================================================
CREATE TABLE stage_definition (
    pipeline_code     varchar(32)  NOT NULL REFERENCES stage_pipeline (code),
    stage_code        varchar(64)  NOT NULL,
    label             varchar(128) NOT NULL,
    urutan            integer      NOT NULL,
    sumber            varchar(16)  NOT NULL,
    status_dipetakan  varchar(48)  NULL,
    gate_pihak        varchar(8)   NULL,
    target_hari_kerja integer      NULL,
    created_at        timestamptz  NOT NULL DEFAULT now(),
    created_by        varchar(64)  NOT NULL DEFAULT 'SYSTEM',
    PRIMARY KEY (pipeline_code, stage_code),
    CONSTRAINT uq_stage_definition_urutan UNIQUE (pipeline_code, urutan),
    CONSTRAINT ck_stage_definition_sumber CHECK (sumber IN ('stage', 'status_brief')),
    CONSTRAINT ck_stage_definition_gate CHECK (gate_pihak IS NULL OR gate_pihak IN ('AM', 'KLIEN')),
    -- Rule 3 (PRD §2): 'status_brief' TIDAK punya state sendiri — wajib menunjuk
    -- status Brief yang sudah ada; 'stage' TIDAK BOLEH mengisi kolom itu (kalau
    -- ia mengisi, computeStageLeadTime akan bingung sumber durasinya audit_log
    -- entity_type mana).
    CONSTRAINT ck_stage_definition_status_dipetakan CHECK (
        (sumber = 'status_brief' AND status_dipetakan IS NOT NULL) OR
        (sumber = 'stage' AND status_dipetakan IS NULL)),
    CONSTRAINT ck_stage_definition_target CHECK (target_hari_kerja IS NULL OR target_hari_kerja > 0),
    CONSTRAINT ck_stage_definition_urutan_positif CHECK (urutan > 0)
);

COMMENT ON COLUMN stage_definition.stage_code IS
  'Nilai literal state di sm_edges/briefs.production_stage untuk sumber=''stage'' (mis. ''Script''). Untuk sumber=''status_brief'' ia adalah label checkpoint (mis. ''QC Account Service''), TIDAK PERNAH muncul sebagai state mesin tahapan.';
COMMENT ON COLUMN stage_definition.label IS
  'Label tampil BI. PRD tidak mendefinisikan kode pendek terpisah dari label untuk checkpoint mana pun — disimpan identik dengan stage_code (lihat HANDOFF_M16_AKUN_A.md).';
COMMENT ON COLUMN stage_definition.status_dipetakan IS
  'HANYA utk sumber=''status_brief''. Menunjuk status brief_task yang sudah ada (''[In Review]'' / ''[Revision Requested]''); durasinya diturunkan dari audit_log entity_type=''brief'', BUKAN ''brief_stage''.';
COMMENT ON COLUMN stage_definition.target_hari_kerja IS
  'Default per divisi. NULL ⇒ N/A, tidak pernah di-default diam-diam (PRD §2 Rule 8). Override per Brief ada di brief_stage_sla.';
COMMENT ON COLUMN stage_definition.gate_pihak IS
  'NULL | AM | KLIEN. KLIEN: durasi dicatat tapi DIKELUARKAN dari lead time divisi (Rule 9, identik [Blocked] M12 Rule 7). AM: gerbang PERAN — hanya AM pemilik (atau Director) yang boleh menjalankan transisi KELUAR dari tahap ini (stage.ts advanceStage), bukan pengecualian lead time.';

REVOKE ALL ON public.stage_definition FROM anon;
ALTER TABLE public.stage_definition ENABLE ROW LEVEL SECURITY;
CREATE POLICY stage_definition_select ON public.stage_definition FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.stage_definition TO authenticated;

-- ===========================================================================
-- 3. Kolom baru briefs — tahap aktif + pipeline yang dipakai.
-- ===========================================================================
ALTER TABLE briefs
    ADD COLUMN production_stage    varchar(64) NULL,
    ADD COLUMN stage_pipeline_code varchar(32) NULL REFERENCES stage_pipeline (code);

COMMENT ON COLUMN briefs.production_stage IS
  'M16 — tahap aktif mesin tahapan (stage_pipeline.machine_name). Ditulis HANYA lewat sm_transition dengan p_entity_type=''brief_stage'' (aturan rumah #2) — KECUALI pengisian awal saat Brief lahir (initial_state pipeline, pola yang sama dengan briefs.status). NULL = divisi tanpa pipeline (Rule 12, mis. Store Operation) atau Brief Live Stream lama sebelum kolom ini ada.';
COMMENT ON COLUMN briefs.stage_pipeline_code IS
  'M16 — pipeline yang dipakai Brief ini, diresolusi SEKALI saat lahir dari (assigned_division, deliverable_type) lewat stage.resolvePipeline. NULL = divisi tanpa pipeline aktif.';

-- ===========================================================================
-- 4. brief_stage_sla — override target per Brief (PRD §2 Rule 7).
-- ===========================================================================
CREATE TABLE brief_stage_sla (
    brief_id          varchar(32)  NOT NULL REFERENCES briefs (id),
    stage_code        varchar(64)  NOT NULL,
    target_hari_kerja integer      NOT NULL,
    set_by            varchar(64)  NOT NULL REFERENCES employees (employee_id),
    created_at        timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (brief_id, stage_code),
    CONSTRAINT ck_brief_stage_sla_target CHECK (target_hari_kerja > 0)
);

COMMENT ON TABLE brief_stage_sla IS
  'M16 — override target_hari_kerja per (Brief, stage), gerbang isLead(division) di stage.setStageSlaTarget. Pola setSlaTarget M12 (task.ts) — tidak ada FK ke stage_definition.stage_code karena satu Brief hanya valid untuk stage_code milik pipeline-nya sendiri; validitas ditegakkan di domain (mengikuti pola sla_target_hours yang juga tanpa FK).';

REVOKE ALL ON public.brief_stage_sla FROM anon;
ALTER TABLE public.brief_stage_sla ENABLE ROW LEVEL SECURITY;
-- Cermin persis predikat briefs_select (20260805060000) lewat join — baris
-- override tidak boleh lebih terbuka atau lebih tertutup dari Brief induknya.
CREATE POLICY brief_stage_sla_select ON public.brief_stage_sla FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM briefs b
   WHERE b.id = brief_stage_sla.brief_id
     AND (jwt_can_read_all()
          OR jwt_employee_id() IN (b.assigned_pic, b.created_by)
          OR (jwt_is_lead() AND b.assigned_division = jwt_division())
          OR private.jwt_is_am_of_service(b.service_id)
          OR (jwt_is_lead() AND jwt_division() = 'Account'))));
GRANT SELECT ON public.brief_stage_sla TO authenticated;

-- ===========================================================================
-- 5. brief_review — keputusan Cek Brief AM (PRD §2 Rule 10).
-- ===========================================================================
CREATE TABLE brief_review (
    brief_id          varchar(32)  NOT NULL PRIMARY KEY REFERENCES briefs (id),
    keputusan         varchar(16)  NOT NULL,
    alasan_kode       varchar(64)  NULL,
    catatan           text         NOT NULL DEFAULT '',
    actor_employee_id varchar(64)  NOT NULL REFERENCES employees (employee_id),
    created_at        timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT ck_brief_review_keputusan CHECK (keputusan IN ('Diterima', 'Dikembalikan')),
    -- Union SELURUH alasan lintas divisi (Creative 5 + KOL 2, 1 tumpang tindih
    -- 'Brief kurang jelas' = 6 unik). Subset yang SAH per divisi ditegakkan di
    -- domain (stage.ts REASON_CODES_BY_DIVISION), bukan di sini — CHECK ini
    -- gerbang terakhir anti-sampah, bukan aturan bisnis penuh.
    CONSTRAINT ck_brief_review_alasan CHECK (
        alasan_kode IS NULL OR alasan_kode IN (
            'Brief kurang jelas', 'Sampel belum diterima', 'Talent tidak tersedia',
            'Properti tidak tersedia', 'Lokasi butuh approval', 'Data tidak lengkap')),
    CONSTRAINT ck_brief_review_alasan_wajib CHECK (
        (keputusan = 'Dikembalikan' AND alasan_kode IS NOT NULL) OR
        (keputusan = 'Diterima' AND alasan_kode IS NULL))
);

COMMENT ON TABLE brief_review IS
  'M16 — keputusan gerbang intake Cek Brief AM (PRD §2 Rule 10), SATU baris per Brief (PK brief_id, bukan log appendable — domain HANYA INSERT, PK menolak percobaan kedua). Independen dari mesin tahapan: divisi TANPA pipeline (Rule 12) tetap bisa mengisi baris ini, sehingga "Cek Brief AM tetap terukur" walau tidak ada state ''Cek Brief AM'' di mesinnya.';

REVOKE ALL ON public.brief_review FROM anon;
ALTER TABLE public.brief_review ENABLE ROW LEVEL SECURITY;
CREATE POLICY brief_review_select ON public.brief_review FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM briefs b
   WHERE b.id = brief_review.brief_id
     AND (jwt_can_read_all()
          OR jwt_employee_id() IN (b.assigned_pic, b.created_by)
          OR (jwt_is_lead() AND b.assigned_division = jwt_division())
          OR private.jwt_is_am_of_service(b.service_id)
          OR (jwt_is_lead() AND jwt_division() = 'Account'))));
GRANT SELECT ON public.brief_review TO authenticated;
