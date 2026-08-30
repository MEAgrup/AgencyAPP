-- R-03 (Kinerja Sales — Renewal/Cross-Sell dari Client Record).
-- Deviasi PRD M0 §6 disetujui pemilik (docs/DECISIONS.md 2026-08-30, arah a):
-- closing tidak lagi selalu mencetak `CLI-` baru. Pintu ini menutup pekerjaan
-- yang R-01/R-02 buka skemanya: kredit alokasi mengikuti sales yang MEMPROSES
-- perpanjangan (bukan otomatis sales pemilik lama); aturan komisi renewal
-- SAMA dengan penjualan baru; Strategi kontrak baru TETAP manual oleh AM
-- (tidak dibuat otomatis di sini); cross-sell selalu kontrak (`CTR-`) baru
-- terpisah, tidak menempel ke kontrak yang sedang aktif.
--
-- KENAPA MESIN STATUS BARU, BUKAN MENUMPANG `prospect_attempt`. Renewal tidak
-- pernah punya Lead/Prospect (RENCANA_KINERJA_SALES.md §4: "nol LEAD-/PRSP-
-- palsu, supaya metrik lead & closing-rate dashboard tetap bersih"), padahal
-- SETIAP fungsi negosiasi existing (`submitNegotiation`/`decideNegotiation`/
-- dst, `sales.ts`) memuat `attempt_id` di jantungnya — memaksakan alur itu ke
-- entitas tanpa attempt berarti menulis ulang mesin closing yang sudah lama
-- stabil & diuji. Mesin baru `contract_renewal` mereplikasi HANYA sub-alur
-- negosiasi (Qualified→Negotiation→Closed), dengan label status YANG SAMA
-- PERSIS (STATUS_NEG_* punya arti identik) supaya tidak ada kosakata kedua.
--
-- KENAPA `negotiation_proposals` DIPERLUAS, BUKAN DIDUPLIKASI. Rencana
-- eksplisit minta "jalur approval negosiasi yang sama" — penentuan harga MSL,
-- penomoran versi proposal, dan aturan "harga standar auto-approve / harga
-- custom butuh ACC atasan" dipakai ulang APA ADANYA lewat tabel yang sama,
-- ditambat opsional ke `contract_renewals` alih-alih `prospect_attempts`.
-- Kolom anak (`negotiation_proposal_lines`) tidak berubah — ia sudah agnostik
-- terhadap jenis penambat induknya.

-- ===========================================================================
-- 1. Prefix `RNW` (M6A §7 pattern — registry adalah yang memutuskan)
-- ===========================================================================
INSERT INTO entity_prefix (prefix, entity_name, module) VALUES
    ('RNW', 'Contract Renewal/Cross-Sell Request', 'Kinerja Sales (R-03)');

-- ===========================================================================
-- 2. Mesin `contract_renewal`. sm_machines 29 -> 30.
--    Sub-alur negosiasi prospect_attempt, direplikasi TANPA New Lead/Contacted/
--    Not Qualified/Closed-Lost (tidak relevan — klien sudah ada, tidak ada
--    "hilang", membatalkan = Cancelled).
-- ===========================================================================
INSERT INTO sm_machines (name, initial_state, block_message, auto_computed, flags) VALUES
    ('contract_renewal', 'Draft', '[transisi status perpanjangan/cross-sell tidak diizinkan]', false, '{}');

INSERT INTO sm_terminal_states (machine, state) VALUES
    ('contract_renewal', 'Closed'),
    ('contract_renewal', 'Cancelled');

INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('contract_renewal', 'Draft', 'Negotiation - Pending Approval', false),
    ('contract_renewal', 'Draft', 'Negotiation - Auto Approved', false),
    ('contract_renewal', 'Negotiation - Pending Approval', 'Negotiation - Approved', true),
    ('contract_renewal', 'Negotiation - Pending Approval', 'Negotiation - Revision Required', true),
    ('contract_renewal', 'Negotiation - Pending Approval', 'Negotiation - Rejected', true),
    ('contract_renewal', 'Negotiation - Revision Required', 'Negotiation - Approved', false),
    ('contract_renewal', 'Negotiation - Revision Required', 'Negotiation - Pending Approval', false),
    ('contract_renewal', 'Negotiation - Rejected', 'Negotiation - Pending Approval', false),
    ('contract_renewal', 'Negotiation - Approved', 'Closed', false),
    ('contract_renewal', 'Negotiation - Auto Approved', 'Closed', false),
    -- Membatalkan sebelum closing — pintu keluar yang prospect_attempt tidak
    -- perlukan (di sana "batal" = Closed-Lost, lewat lead yang hilang).
    ('contract_renewal', 'Draft', 'Cancelled', false),
    ('contract_renewal', 'Negotiation - Pending Approval', 'Cancelled', false),
    ('contract_renewal', 'Negotiation - Revision Required', 'Cancelled', false),
    ('contract_renewal', 'Negotiation - Rejected', 'Cancelled', false);

-- ===========================================================================
-- 3. Tabel `contract_renewals`. tabel 129 -> 130.
-- ===========================================================================
CREATE TABLE contract_renewals (
    id                      varchar(32)  NOT NULL PRIMARY KEY,
    client_id               varchar(32)  NOT NULL,
    jenis                   varchar(16)  NOT NULL,
    -- Wajib terisi utk 'perpanjangan' (rantai ke kontrak yang diperpanjang);
    -- selalu NULL utk 'cross_sell' (kontrak baru berdiri sendiri, R-01 tidak
    -- menaut cross_sell ke kontrak manapun).
    contract_sebelumnya_id  varchar(32)  NULL,
    status                  varchar(48)  NOT NULL DEFAULT 'Draft',
    created_at              timestamptz  NOT NULL DEFAULT now(),
    created_by              varchar(64)  NOT NULL,
    CONSTRAINT fk_rnw_client FOREIGN KEY (client_id) REFERENCES clients (id),
    CONSTRAINT fk_rnw_contract_sebelumnya FOREIGN KEY (contract_sebelumnya_id) REFERENCES contracts (id),
    CONSTRAINT ck_rnw_jenis CHECK (jenis IN ('perpanjangan', 'cross_sell')),
    CONSTRAINT ck_rnw_sebelumnya_shape CHECK (
        (jenis = 'perpanjangan' AND contract_sebelumnya_id IS NOT NULL) OR
        (jenis = 'cross_sell' AND contract_sebelumnya_id IS NULL))
);

CREATE INDEX idx_rnw_client ON contract_renewals (client_id);

COMMENT ON TABLE contract_renewals IS
  'R-03 — permintaan perpanjangan/cross-sell dari Client Record. Mesin '
  'contract_renewal (Draft→Negotiation→Closed|Cancelled). Berhasil (Closed) '
  'melahirkan CTR-/SVC-/TRX- baru pada client_id yang SAMA (nol CLI- baru).';

-- ===========================================================================
-- 4. `negotiation_proposals` — penambat ganda (attempt_id ATAU renewal_id).
-- ===========================================================================
ALTER TABLE negotiation_proposals ALTER COLUMN attempt_id DROP NOT NULL;
ALTER TABLE negotiation_proposals ADD COLUMN renewal_id varchar(32) NULL;

ALTER TABLE negotiation_proposals
    ADD CONSTRAINT fk_neg_renewal FOREIGN KEY (renewal_id) REFERENCES contract_renewals (id);

ALTER TABLE negotiation_proposals
    ADD CONSTRAINT ck_neg_anchor_shape CHECK (
        (attempt_id IS NOT NULL AND renewal_id IS NULL) OR
        (attempt_id IS NULL AND renewal_id IS NOT NULL));

ALTER TABLE negotiation_proposals
    ADD CONSTRAINT uq_neg_renewal_version UNIQUE (renewal_id, version_no);

COMMENT ON COLUMN negotiation_proposals.attempt_id IS
  'R-03 — nullable sejak penambat ganda. NULL hanya bila renewal_id terisi '
  '(ck_neg_anchor_shape). Proposal closing biasa tetap selalu attempt_id.';
COMMENT ON COLUMN negotiation_proposals.renewal_id IS
  'R-03 — penambat proposal renewal/cross-sell (nol PRSP- palsu). NULL '
  'kecuali proposal ini milik sebuah contract_renewals.';

-- ===========================================================================
-- 5. RLS. Sama pola `contracts_select` — scope kliennya: Sales PIC/AM/
--    Finance yang punya klien itu, Sales/Account lead, read-all.
--    `negotiation_proposals_select`/`negotiation_proposal_lines_select`
--    TIDAK disentuh — sudah agnostik penambat (proposed_by/created_by).
-- ===========================================================================
ALTER TABLE public.contract_renewals ENABLE ROW LEVEL SECURITY;

CREATE POLICY contract_renewals_select ON public.contract_renewals FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR private.jwt_owns_client(client_id)
       OR (jwt_is_lead() AND jwt_division() = 'Sales')
       OR (jwt_is_lead() AND jwt_division() = 'Account'));

GRANT SELECT ON public.contract_renewals TO authenticated;

-- Policy TULIS sengaja tidak ada (default-deny, pola `contracts`): semua
-- tulis lewat service-role + gate TS (`renewal.canManageRenewal`) + mesin
-- `sm_transition` untuk kolom status.
