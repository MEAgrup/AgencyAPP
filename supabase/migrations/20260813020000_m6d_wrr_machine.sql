-- CDPS — Module 6D (Rekap Hasil Mingguan) — D-02: MESIN #18 + guard flag permanen.
--
-- Mendaftar mesin state `weekly_result_recap` (mesin #18, STATE_MACHINES §15) +
-- trigger yang menjaga `pernah_ditutup_otomatis` tak pernah dicabut. Melanjutkan
-- D-01 (skema, 20260813010000). PRD §9 · backlog D-02.
--
-- ---------------------------------------------------------------------------
-- MESIN #18 — siklus rekap mingguan per klien
-- ---------------------------------------------------------------------------
--   Terjadwal → Terbuka           (sistem, job Senin 00:00 WIB — D-06)
--   Terbuka   → Ditutup           (AM/CRO pemilik, konfirmasi — Rule 8)
--   Terbuka   → Ditutup Otomatis  (sistem, force-close N=2 hari kerja — D-06)
--   Ditutup Otomatis → Terbuka    (Head of Account, buka-kembali RM-5, alasan wajib)
--
-- Terminal SEJATI: hanya `Ditutup`. `Ditutup Otomatis` **quasi-terminal** — buntu
-- bagi AM, tapi Head punya satu edge keluar (buka-kembali). Karena ia PUNYA edge
-- keluar, ia BUKAN baris `sm_terminal_states` (terminal = state tanpa edge keluar;
-- Go/engine menyimpannya eksplisit hanya untuk introspeksi). Kontras dgn mesin
-- #16 (plan) yang mendaftar `Ditutup Otomatis` sebagai terminal karena di sana ia
-- benar-benar buntu.
--
-- GERBANG SIAPA ada di DOMAIN (`packages/domain/src/recap.ts`), bukan di mesin
-- (pola `plan.ts`). `sm_edges.require_lead` hanya membedakan Director/Lead vs
-- bukan; penyempitan ke *divisi Account* (Head of Account, bukan sekadar lead
-- mana pun) dilakukan `canReopenRecap`. Edge:
--   * `Terjadwal→Terbuka` require_lead=false — dijalankan service-role (job),
--     bukan seorang lead (preseden `plan` `Terjadwal→Aktif`).
--   * `Terbuka→Ditutup` require_lead=false — AM pemilik = staff; kepemilikan
--     diperiksa `canCloseRecap` di domain (bukan gerbang lead engine).
--   * `Terbuka→Ditutup Otomatis` require_lead=false — sistem (force-close).
--   * `Ditutup Otomatis→Terbuka` require_lead=TRUE — buka-kembali hanya Head/
--     Director; `canReopenRecap` menyempitkan lead ke divisi Account, dan
--     MENGECUALIKAN AM pemilik (RM-5: "Head, BUKAN AM pemilik").
--
-- Semua transisi HANYA lewat `sm_transition` (row lock + cek edge + gerbang
-- require_lead + baris audit immutable, satu transaksi). Nol UPDATE status mentah.

INSERT INTO sm_machines (name, initial_state, block_message, auto_computed, flags) VALUES
    ('weekly_result_recap', 'Terjadwal', '[transisi status rekap mingguan tidak diizinkan]', false, '{}');

-- Terminal sejati: hanya `Ditutup` (lihat header — `Ditutup Otomatis` quasi-terminal).
INSERT INTO sm_terminal_states (machine, state) VALUES
    ('weekly_result_recap', 'Ditutup');

INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('weekly_result_recap', 'Terjadwal',        'Terbuka',          false),
    ('weekly_result_recap', 'Terbuka',          'Ditutup',          false),
    ('weekly_result_recap', 'Terbuka',          'Ditutup Otomatis', false),
    -- Buka-kembali Head (RM-5): Director/Lead di engine; Account-only di domain.
    ('weekly_result_recap', 'Ditutup Otomatis', 'Terbuka',          true);

-- ---------------------------------------------------------------------------
-- Guard: `pernah_ditutup_otomatis` PERMANEN (RM-5/RM-9). Force-close menyetel
-- true (D-06); buka-kembali Head (edge di atas) MENYELAMATKAN data tapi TIDAK
-- mencabut catatan bahwa AM tak perform — nilai non-performa AM tetap tercatat
-- untuk skor disiplin M14 (D-14) + blok H-2. Trigger menolak true→false dari
-- SIAPA pun (termasuk service-role), bentuk sama guard_plan_target_nilai_strategi.
-- false→true tetap sah (force-close menyalakannya).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_wrr_pernah_ditutup_otomatis()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.pernah_ditutup_otomatis AND NOT NEW.pernah_ditutup_otomatis THEN
        RAISE EXCEPTION '[tanda ditutup otomatis bersifat permanen dan tidak dapat dicabut]';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_wrr_guard_pernah_ditutup_otomatis BEFORE UPDATE ON weekly_result_recap
    FOR EACH ROW EXECUTE FUNCTION guard_wrr_pernah_ditutup_otomatis();
