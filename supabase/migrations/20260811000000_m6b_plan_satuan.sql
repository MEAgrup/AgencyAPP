-- CDPS — Module 6C §7 / backlog B-10: Plan Satuan (Service Satuan).
--
-- Closes Rule 6 M6C ("the first service determined to need a Plan opens it;
-- every later Plan-gated satuan service joins it — never a second Plan") and adds
-- the dormancy state machine (#17) that B-01 deliberately deferred here.
--
-- ===========================================================================
-- Kenapa TABEL `plan_satuan`, bukan kolom `status_dormansi` di `plan`
-- ===========================================================================
-- M6C §10 menuliskan "`PLAN` gains … `status_dormansi`", dan komentar ci.yml
-- sempat menduga B-10 menambahnya sebagai KOLOM (tanpa tabel). Tapi B-01 sudah
-- menamai masalahnya sendiri: *"dorman itu properti RANTAI periode, bukan satu
-- periode"* — persis alasan `defisit_terbawa` BUKAN kolom `plan` (menaruh fakta
-- rantai di tiap baris periode = n salinan satu angka; siklus tanggal 31 melintas
-- Februari, dst.). `plan` = SATU periode (§8 "PLAN- (period)"). Menempel dormansi
-- di sana memaksa pertanyaan "periode MANA yang Dorman" saat justru TAK ADA
-- periode aktif — keadaan yang mendefinisikan dorman.
--
-- Jadi dormansi + `tanggal_mulai_siklus` (jangkar Rule 7 — untuk Full-Management
-- ia hidup di `strategi`; Plan Satuan tak punya Strategi) hidup di entitas RANTAI
-- per-klien: satu baris `plan_satuan` per klien, PK = client_id (S2: satu Plan
-- Satuan per klien). Tak butuh prefix ID baru — kunci rantai memang client_id.
-- Deviasi dari dugaan ci.yml dicatat docs/DECISIONS.md 2026-08-11 (B-10); gerbang
-- tabel naik 89 → 90, mesin 17 → 18.
--
-- ===========================================================================
-- Apa yang ADA di sini, dan apa yang SENGAJA menyusul
-- ===========================================================================
-- ADA (B-10): mesin #17 (`Aktif ⇄ Dorman`); tabel rantai `plan_satuan`; FK
--   `service_plan_gate.plan_id → plan` (M6C gate menundanya sampai PLAN ada);
--   `plan_flag` jenis `di_luar_service` (analog `di_luar_strategi`, M6C §7.9).
--   Jalur buka/gabung/reaktivasi + transisi dormansi + gerbang review 4-field =
--   domain (packages/domain/src/plan.ts + wiring plangate.ts).
--
-- MENYUSUL, tiketnya masing-masing:
--   * B-11 — index integritas §4(b): satu service ⇒ ≤1 Plan + service full-mgmt
--     tak boleh menunjuk Plan `lingkup='klien'`. Partial unique index; kecil.
--   * Generasi periode BERJALAN untuk Plan Satuan aktif (bulanan, "periods stop
--     generating when dormant"). B-10 membuka periode 1 saat open dan satu
--     periode segar saat reaktivasi; kadensi bulanan = job (seam B-09).
--   * Sweep harian §10(c) (flip Dorman saat service terakhir berakhir) — domain
--     `markPlanSatuanDormant` menyediakan jalur tulisnya; PEMICU otomatisnya
--     (deteksi "service terakhir berakhir") menyusul di job, seperti B-03→B-09.
--   * Rangka baris `service`-parented (PC-3 service_id) — sama restraint B-02:
--     channel/pilar tak ada di gate; mengarangnya melanggar "never invent".
--     Baris diisi lewat form; `ck_plan_row_asal_tunggal` (B-01) sudah mengizinkan
--     baris ber-`service_id` dan ber-`di_luar_service`.
--   * Tiga event notifikasi gate (§10) — katalog beku, seam sama B-03…B-08.

-- ===========================================================================
-- 1. Mesin status #17 — `plan_satuan` (dormansi rantai)
-- ===========================================================================
-- `Aktif ⇄ Dorman`. TIDAK terminal: dorman bisa bangun lagi (service baru
-- mereaktivasi rantai yang sama — S2/§8, "keeps one continuous history"). Kedua
-- edge `require_lead = false`: reaktivasi dijalankan saat AM menentukan service
-- baru butuh Plan (gerbang kepemilikan di domain, bukan lead), dormansi
-- dijalankan job service-role. Bukan mesin kosong — persis kenapa B-01 menolak
-- mendaftarkannya sebelum rancangannya jelas (preseden `contracts`).
INSERT INTO sm_machines (name, initial_state, block_message, auto_computed, flags) VALUES
    ('plan_satuan', 'Aktif', '[transisi status dormansi Plan Satuan tidak diizinkan]', false, '{}');

INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('plan_satuan', 'Aktif',  'Dorman', false),
    ('plan_satuan', 'Dorman', 'Aktif',  false);

-- ===========================================================================
-- 2. `plan_satuan` — rantai Plan Satuan per klien (S2)
-- ===========================================================================
CREATE TABLE plan_satuan (
    client_id            varchar(32)  NOT NULL PRIMARY KEY,

    -- Rule 7: jangkar siklus anniversary-month. Beku setelah periode 1 (Rule 17),
    -- rumah bagi angka yang untuk Full-Management ada di `strategi.tanggal_mulai_siklus`.
    tanggal_mulai_siklus date         NOT NULL,

    -- Mesin #17 — HANYA lewat sm_transition(machine='plan_satuan'). CHECK adalah
    -- lapis kedua (mesin sudah membatasi transisi; ini menolak nilai liar dari
    -- jalur mana pun).
    status_dormansi      varchar(16)  NOT NULL DEFAULT 'Aktif',

    created_at           timestamptz  NOT NULL DEFAULT now(),
    updated_at           timestamptz  NOT NULL DEFAULT now(),
    created_by           varchar(64)  NOT NULL,

    CONSTRAINT fk_plan_satuan_client FOREIGN KEY (client_id) REFERENCES clients (id),
    CONSTRAINT ck_plan_satuan_status CHECK (status_dormansi IN ('Aktif', 'Dorman'))
);

CREATE TRIGGER trg_plan_satuan_updated_at BEFORE UPDATE ON plan_satuan
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE plan_satuan IS
  'M6C §7 — rantai Plan Satuan satu klien (S2: satu per klien, kontinu, dorman '
  'saat idle). Status via mesin #17 (plan_satuan) saja. Periode-nya tetap baris '
  '`plan` lingkup=klien (mesin #16).';
COMMENT ON COLUMN plan_satuan.status_dormansi IS
  'PA/§7 — Aktif ⇄ Dorman (mesin #17). Dorman = semua service satuan berakhir, '
  'periode berhenti tumbuh; service baru mereaktivasi rantai yang SAMA.';

-- RLS: scope = kliennya, cermin `plan` (jwt_owns_client menutupi Plan Satuan yang
-- tak punya contract_id) + lengan lead Account.
REVOKE ALL ON public.plan_satuan FROM anon;
REVOKE ALL ON public.plan_satuan FROM authenticated;
GRANT SELECT ON public.plan_satuan TO authenticated;
ALTER TABLE public.plan_satuan ENABLE ROW LEVEL SECURITY;
CREATE POLICY plan_satuan_select ON public.plan_satuan FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR private.jwt_owns_client(client_id)
       OR (jwt_is_lead() AND jwt_division() = 'Account'));

-- ===========================================================================
-- 3. FK `service_plan_gate.plan_id → plan` (M6C gate menundanya sampai PLAN ada)
-- ===========================================================================
-- Migrasi gate M6C (20260806061000) menaruh `plan_id` nullable TANPA FK: "FK
-- ditambahkan pada migrasi M6B, bukan di sini." Rule 6 kini membukanya, jadi
-- link-nya berintegritas. ON DELETE SET NULL: kalau periode dibersihkan (hanya
-- di test — di prod periode transisi status, tak dihapus), gate kehilangan
-- tautannya, bukan menahan penghapusan.
ALTER TABLE service_plan_gate
    ADD CONSTRAINT fk_spg_plan FOREIGN KEY (plan_id)
        REFERENCES plan (id) ON DELETE SET NULL;

-- ===========================================================================
-- 4. `plan_flag` jenis `di_luar_service` (M6C §7.9 — analog `di_luar_strategi`)
-- ===========================================================================
-- Plan Satuan tak punya Strategi; analog `Di Luar Strategi` adalah `Di Luar
-- Service` — baris yang tak memetakan ke service dibeli (scope creep). Kolom
-- `plan_row.di_luar_service` sudah ada (B-01); yang belum: jenis flag PG-1 untuk
-- mendeteksinya, sama bentuk dengan `di_luar_strategi`.
ALTER TABLE plan_flag DROP CONSTRAINT ck_plan_flag_jenis;
ALTER TABLE plan_flag ADD CONSTRAINT ck_plan_flag_jenis CHECK (jenis IN (
    'di_luar_strategi', 'di_luar_service', 'lewat_komitmen', 'di_bawah_floor',
    'belum_dieksekusi', 'keberatan_kapasitas', 'penyesuaian_turun'));
