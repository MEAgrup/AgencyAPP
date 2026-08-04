-- ============================================================================
-- QA halaman finance 2026-08-04 (temuan pemilik ke-3, lihat docs/DECISIONS.md):
-- SPV/Head Finance harus bisa MENGUBAH transaksi yang sudah berjalan — kasus
-- nyatanya klien berganti metode pembayaran di tengah jalan — tetapi perubahan
-- itu baru terwujud setelah **ACC Direktur**.
--
-- INI MENGUBAH DUA ATURAN YANG SEBELUMNYA MELARANG (revisi disengaja, diminta
-- pemilik, dicatat di DECISIONS.md + PRD M5 §4 Rule 5 / M5-OA-6 → M5-OA-7):
--
--   (a) PRD M5-OA-6 dulu berkata ganti skema "requires minimum SPV/Head Finance
--       approval to action" — SPV Finance mengeksekusi sendiri. Sekarang SPV/Head
--       Finance hanya **mengajukan**; yang mengeksekusi adalah ACC Direktur.
--   (b) Implementasi TS dulu mengunci ganti skema begitu ada uang masuk
--       (`SchemeLockedError`, pre-verification only). Sekarang perubahan boleh
--       mid-flight selama transaksi belum `[Lunas]` — justru di situlah kasus
--       pemilik hidup (klien sudah bayar DP lalu minta pindah ke termin).
--
-- Yang TIDAK berubah, karena aturan rumah CLAUDE.md #3 tidak dinegosiasikan:
--   - installment yang sudah `[Terverifikasi]` dan seluruh baris
--     `payment_verifications` TIDAK PERNAH disentuh. Yang diganti hanya jadwal
--     yang masih terbuka, dan jumlah jadwal pengganti wajib SAMA DENGAN Amount
--     Outstanding — jadi Σ(termin) = Total Agreed Value tetap invariant.
--   - `total_agreed_value` tetap immutable: ini pintu ganti METODE bayar, bukan
--     pintu renegosiasi nilai deal (itu ranah M0/M4, bukan M5).
--   - setiap pengajuan/keputusan/penerapan menulis baris audit.
--
-- Bentuk dua-langkah (ajukan → ACC) menyalin vertikal yang sudah ada:
-- lead_delete_requests (20260729162101) + demo_task_block_requests. Nama kolom
-- dibuat identik supaya satu pola dibaca sekali.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Entity: pengajuan perubahan transaksi (TCR-YYYYMM-NNNN)
-- ---------------------------------------------------------------------------
-- Tanpa ON DELETE CASCADE (konvensi Sprint 0: entity teraudit tidak di-cascade).
-- `status` di sini BUKAN status lifecycle machine — hanya
-- pending/approved/rejected/cancelled untuk baris permintaannya sendiri, persis
-- lead_delete_requests.status. Skema transaksi sendiri bukan kolom status
-- machine (payment_status yang machine, dan pintu ini tidak menyentuhnya).
--
-- `schedule_json` menyimpan jadwal pengganti yang DIAJUKAN, bukan yang berlaku:
-- installments baru baru lahir saat ACC. Snapshot `amount_outstanding` dipakai
-- untuk menunjukkan dasar perhitungan pengaju; saat ACC nilainya DIHITUNG ULANG
-- dari log verifikasi (bisa berubah kalau ada pembayaran masuk selama menunggu),
-- dan pengajuan yang jadwalnya tidak lagi cocok ditolak alih-alih diterapkan.
CREATE TABLE transaction_change_requests (
    id                 varchar(32)   NOT NULL PRIMARY KEY,
    transaction_id     varchar(32)   NOT NULL,
    from_scheme        varchar(48)   NOT NULL,
    to_scheme          varchar(48)   NOT NULL,
    schedule_json      jsonb         NOT NULL DEFAULT '[]'::jsonb,
    amount_outstanding numeric(15,2) NOT NULL,
    reason             varchar(500)  NOT NULL,
    status             varchar(16)   NOT NULL DEFAULT 'pending',
    decision_note      varchar(500)  NULL,
    requested_by       varchar(64)   NOT NULL,
    resolved_by        varchar(64)   NULL,
    resolved_at        timestamptz   NULL,
    created_at         timestamptz   NOT NULL DEFAULT now(),
    created_by         varchar(64)   NOT NULL,
    CONSTRAINT fk_tcr_trx FOREIGN KEY (transaction_id) REFERENCES transactions (id),
    CONSTRAINT ck_tcr_status CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'))
);
CREATE INDEX idx_tcr_trx ON transaction_change_requests (transaction_id);
CREATE INDEX idx_tcr_status ON transaction_change_requests (status);
CREATE INDEX idx_tcr_requested_by ON transaction_change_requests (requested_by);

-- Satu pengajuan pending per transaksi — dijamin INDEKS, bukan hanya cek
-- aplikasi, supaya dua SPV yang balapan tidak bisa menaruh dua antrian ACC atas
-- uang yang sama.
CREATE UNIQUE INDEX uq_tcr_one_pending ON transaction_change_requests (transaction_id)
    WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- 2. Katalog notifikasi: +2 event (17 → 19)
-- ---------------------------------------------------------------------------
-- Alasannya sama dengan dua event m1.lead.delete_* (20260729162101): alur ACC
-- mati kalau Direktur tidak pernah diberi tahu ada yang menunggu, dan pengaju
-- tidak pernah tahu keputusannya. Resolver 'explicit' karena penerimanya bukan
-- "lead sebuah divisi": Direktur adalah layered role (employee_layered_roles),
-- jadi daftar penerimanya di-resolve di TypeScript lalu dikirim eksplisit.
-- Harus tetap sinkron dengan packages/core/src/notification.ts (CATALOG).
INSERT INTO notif_events (event_type, description, resolver) VALUES
    ('m5.transaction.change_requested', 'Pengajuan perubahan transaksi menunggu ACC Direktur', 'explicit'),
    ('m5.transaction.change_decided',   'Pengajuan perubahan transaksi di-ACC/tolak',          'explicit');

-- ---------------------------------------------------------------------------
-- 3. RLS — tabel dibuat SETELAH 20260723064438_rls_baseline, jadi loop grant di
--    sana tidak menyentuhnya. Ulangi eksplisit: anon dicabut total,
--    authenticated hanya SELECT (difilter policy), tulis lewat service-role.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.transaction_change_requests FROM anon;
REVOKE ALL ON public.transaction_change_requests FROM authenticated;
GRANT SELECT ON public.transaction_change_requests TO authenticated;
ALTER TABLE public.transaction_change_requests ENABLE ROW LEVEL SECURITY;

-- Predikat mirror gate app-layer: pihak yang terlibat (pengaju/pemutus) selalu
-- lihat; seluruh divisi Finance lihat (ini worklist mereka — arm yang sama
-- dipakai clients_select sejak 20260804035500); OD/Director lewat
-- jwt_can_read_all(). Sales/Account tidak dapat arm: mereka membaca Payment
-- Status, bukan antrian persetujuan internal Finance.
CREATE POLICY transaction_change_requests_select ON public.transaction_change_requests FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() IN (requested_by, resolved_by, created_by)
       OR jwt_division() = 'Finance');
