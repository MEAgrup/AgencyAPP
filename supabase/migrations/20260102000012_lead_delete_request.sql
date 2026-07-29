-- Penambahan native Postgres (bukan port skema) — hapus lead dengan persetujuan Head.
--
-- KEPUTUSAN PEMILIK 2026-07-29 (docs/DECISIONS.md): lead boleh terus ditambah,
-- tapi harus ada tombol hapus yang **wajib di-ACC oleh Head**. Ini DEVIASI dari
-- PRD M1 (yang tidak punya jalur hapus sama sekali) — dicatat di DECISIONS.md.
--
-- Bentuk implementasinya dipaksa oleh aturan rumah CLAUDE.md:
--   #3 riwayat immutable  ⇒ TIDAK ADA `DELETE FROM leads`. Baris lead tetap ada;
--      "hapus" = state terminal `[Deleted]` pada machine `lead_record`. audit_log
--      dan prospect_attempts (FK) karenanya tetap utuh dan bisa diaudit.
--   #2 status hanya via engine ⇒ `[Deleted]` dicapai lewat sm_transition, dan
--      keempat edge masuknya ber-`require_lead = true` sehingga fungsi SQL
--      sendiri (bukan cuma TypeScript) menolak staff. Panggilan langsung via
--      service-role pun tidak bisa melewati gate persetujuan Head.
--   #8 notifikasi dari audit log ⇒ dua event baru di katalog (lihat §3).
--
-- Pola dua-langkah (ajukan → ACC) menyalin verticalnya yang sudah ada:
-- demo_task_block_requests (20260101000001_init) + demo.submitBlockRequest /
-- approveBlockRequest. Nama kolom dibuat identik supaya satu pola dibaca sekali.

-- ---------------------------------------------------------------------------
-- 1. Entity: permintaan hapus lead (LDR-YYYYMM-NNNN)
-- ---------------------------------------------------------------------------
-- Tidak ada ON DELETE CASCADE (konvensi Sprint 0: entity teraudit tidak pernah
-- di-cascade). `status` di sini BUKAN status lifecycle machine — ia hanya
-- pending/approved/rejected untuk baris permintaan itu sendiri, sama seperti
-- demo_task_block_requests.status; status lead-nya tetap milik lead_record.
CREATE TABLE lead_delete_requests (
    id            varchar(32)  NOT NULL PRIMARY KEY,
    lead_id       varchar(32)  NOT NULL,
    reason        varchar(500) NOT NULL,
    status        varchar(16)  NOT NULL DEFAULT 'pending',
    decision_note varchar(500) NULL,
    requested_by  varchar(64)  NOT NULL,
    resolved_by   varchar(64)  NULL,
    resolved_at   timestamptz  NULL,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    created_by    varchar(64)  NOT NULL,
    CONSTRAINT fk_ldr_lead FOREIGN KEY (lead_id) REFERENCES leads (id),
    CONSTRAINT ck_ldr_status CHECK (status IN ('pending', 'approved', 'rejected'))
);
CREATE INDEX idx_ldr_lead ON lead_delete_requests (lead_id);
CREATE INDEX idx_ldr_status ON lead_delete_requests (status);
CREATE INDEX idx_ldr_requested_by ON lead_delete_requests (requested_by);

-- Satu permintaan pending per lead — dijamin INDEKS, bukan hanya cek aplikasi,
-- supaya dua pengaju yang balapan tidak bisa membuat dua antrian ACC.
CREATE UNIQUE INDEX uq_ldr_one_pending ON lead_delete_requests (lead_id)
    WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- 2. Machine lead_record: state terminal [Deleted]
-- ---------------------------------------------------------------------------
-- require_lead = true di SEMUA edge masuk ⇒ hanya Director/Lead (Head) yang
-- boleh mendorongnya; staff mendapat '[anda tidak memiliki akses untuk
-- melakukan transisi ini]' dari sm_transition. Tidak ada edge KELUAR dari
-- [Deleted]: hapus bersifat final (dan tercatat), bukan toggle.
--
-- [Closed-Success] TIDAK diberi edge: lead yang sudah jadi klien punya
-- turunan uang (CLI/TRX/INST) dan tidak boleh hilang dari muka bumi.
INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('lead_record', 'active',           '[Deleted]', true),
    ('lead_record', '[Pool]',           '[Deleted]', true),
    ('lead_record', '[Rejected]',       '[Deleted]', true),
    ('lead_record', '[Not Qualified]',  '[Deleted]', true);

INSERT INTO sm_terminal_states (machine, state) VALUES
    ('lead_record', '[Deleted]');

-- ---------------------------------------------------------------------------
-- 3. Katalog notifikasi: +2 event (15 → 17)
-- ---------------------------------------------------------------------------
-- Katalog Phase 0 v2 §9 disebut "frozen" karena harus identik dengan katalog Go.
-- Deviasi disengaja & dicatat di DECISIONS.md: build Go sedang didekomisi pada
-- cutover ini, dan alur ACC tidak bisa berfungsi tanpa Head diberi tahu.
-- Harus tetap sinkron dengan packages/core/src/notification.ts (CATALOG).
INSERT INTO notif_events (event_type, description, resolver) VALUES
    ('m1.lead.delete_requested', 'Permintaan hapus lead diajukan',    'leadsOfDivision'),
    ('m1.lead.delete_decided',   'Permintaan hapus lead di-ACC/tolak', 'explicit');

-- ---------------------------------------------------------------------------
-- 4. RLS — tabel dibuat SETELAH 20260102000003_rls_baseline, jadi loop grant di
--    sana tidak menyentuhnya. Ulangi eksplisit: anon dicabut total,
--    authenticated hanya SELECT (difilter policy), tulis lewat RPC/service-role.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.lead_delete_requests FROM anon;
REVOKE ALL ON public.lead_delete_requests FROM authenticated;
GRANT SELECT ON public.lead_delete_requests TO authenticated;
ALTER TABLE public.lead_delete_requests ENABLE ROW LEVEL SECURITY;

-- Predikat mirror permission.ts: pihak yang terlibat (pengaju/pemutus) selalu
-- lihat; Head lihat seluruh divisi asal lead-nya (jwt_is_lead() AND divisi
-- lead = divisi Head) — kalau tidak, antrian ACC-nya kosong dan fiturnya mati;
-- OD/Director read-everywhere lewat jwt_can_read_all().
CREATE POLICY lead_delete_requests_select ON public.lead_delete_requests FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() IN (requested_by, resolved_by, created_by)
       OR (jwt_is_lead() AND EXISTS (
             SELECT 1 FROM leads l
              WHERE l.id = lead_delete_requests.lead_id
                AND l.origin_division = jwt_division())));
