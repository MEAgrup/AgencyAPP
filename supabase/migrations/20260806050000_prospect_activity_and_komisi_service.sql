-- ============================================================================
-- QA halaman Leads (permintaan pemilik 2026-08-06) — dua penambahan:
--
--   1. `prospect_activities` (ACT-YYYYMM-NNNN) — catatan aktivitas sales SETELAH
--      Qualified: Follow Up / Jadwal Meeting / Online Meeting / Visit / Lainnya.
--      Satu prospek boleh punya BANYAK aktivitas; tiap aktivitas wajib membawa
--      ringkasan hasil. Dari sinilah "berapa banyak effort sampai closing"
--      terbaca — sebelum ini yang tercatat hanya SATU titik (`Contacted`), jadi
--      tiga meeting dan satu chat terlihat identik di sistem.
--
--   2. Satu layanan MSL baru: **Komisi**, `pricing_mode = 'passthrough'` —
--      nominalnya diketik sales per-deal (angka tidak tetap), bukan rate card.
--
-- DEVIASI PRD: M0 §4 hanya mengenal transisi `Contacted`; tidak ada entitas
-- aktivitas di PRD mana pun. Ditambahkan atas permintaan pemilik dan dicatat di
-- `docs/DECISIONS.md` (2026-08-06) + `docs/DATA_MODEL.md` (prefix `ACT`).
--
-- Aturan rumah yang membentuk desainnya:
--   #3 riwayat immutable ⇒ `prospect_activities` INSERT-only; UPDATE dan DELETE
--      ditolak trigger `forbid_mutation()`, sama seperti `audit_log`. Salah
--      ketik ringkasan diperbaiki dengan aktivitas baru, bukan dengan edit.
--   #2 status hanya lewat engine ⇒ tabel ini SENGAJA tidak punya kolom status
--      dan tidak menyentuh `prospect_attempts.status`. Mencatat aktivitas BUKAN
--      transisi; ia tidak memindahkan prospek ke mana pun.
--   #4 field terhitung read-only ⇒ jumlah effort tidak disimpan di mana pun; ia
--      selalu `count(*)` atas tabel ini (recomputable dari log).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Entity: aktivitas prospek (ACT-YYYYMM-NNNN)
-- ---------------------------------------------------------------------------
-- `lead_id` didenormalisasi dari `prospect_attempts` supaya policy RLS dan
-- rollup per-lead tidak perlu join tiap baris; ia diisi server dari attempt-nya
-- (bukan dari input klien) dan tidak pernah berubah karena barisnya immutable.
--
-- Tidak ada ON DELETE CASCADE (konvensi Sprint 0: entity teraudit tidak pernah
-- di-cascade) — sejalan dengan `lead_delete_requests`.
CREATE TABLE prospect_activities (
    id            varchar(32)  NOT NULL PRIMARY KEY,
    attempt_id    varchar(32)  NOT NULL,
    lead_id       varchar(32)  NOT NULL,
    activity_type varchar(32)  NOT NULL,
    occurred_at   timestamptz  NOT NULL,
    summary       varchar(2000) NOT NULL,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    created_by    varchar(64)  NOT NULL,
    CONSTRAINT fk_act_attempt FOREIGN KEY (attempt_id) REFERENCES prospect_attempts (id),
    CONSTRAINT fk_act_lead    FOREIGN KEY (lead_id)    REFERENCES leads (id),
    -- Daftar TERTUTUP, ditegakkan DB dan bukan hanya TypeScript: jenis aktivitas
    -- adalah dimensi laporan effort, jadi satu nilai bebas dari pemanggil
    -- service-role akan merusak agregatnya tanpa error.
    CONSTRAINT ck_act_type CHECK (activity_type IN
        ('Follow Up', 'Jadwal Meeting', 'Online Meeting', 'Visit', 'Lainnya')),
    CONSTRAINT ck_act_summary CHECK (btrim(summary) <> '')
);
CREATE INDEX idx_act_attempt ON prospect_activities (attempt_id, occurred_at DESC);
CREATE INDEX idx_act_lead    ON prospect_activities (lead_id);
CREATE INDEX idx_act_creator ON prospect_activities (created_by);

-- Immutable: sekali tercatat, aktivitas tidak bisa diubah maupun dihapus.
CREATE TRIGGER prospect_activities_no_update BEFORE UPDATE ON prospect_activities
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER prospect_activities_no_delete BEFORE DELETE ON prospect_activities
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------------
-- 2. RLS — tabel dibuat SETELAH 20260723064438_rls_baseline, jadi loop grant di
--    sana tidak menyentuhnya. Ulangi eksplisit: anon dicabut total,
--    authenticated hanya SELECT (difilter policy), tulis lewat service-role.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.prospect_activities FROM anon;
REVOKE ALL ON public.prospect_activities FROM authenticated;
GRANT SELECT ON public.prospect_activities TO authenticated;
ALTER TABLE public.prospect_activities ENABLE ROW LEVEL SECURITY;

-- `jwt_owns_lead` dipanggil BER-SKEMA `private.` — migrasi 20260727072443
-- memindahkannya ke sana, jadi pemanggilan tanpa skema (seperti di baseline)
-- gagal `function jwt_owns_lead(...) does not exist` pada DB yang sudah
-- di-harden. Helper klaim yang tetap publik (`jwt_can_read_all` / `jwt_is_lead`
-- / `jwt_division` / `jwt_employee_id`) dipanggil apa adanya.
--
-- Predikatnya SENGAJA dibuat kembar `prospect_attempts_select` (baseline §M0/M1):
-- aktivitas adalah anak dari attempt, jadi siapa pun yang boleh melihat attempt
-- harus boleh melihat effort-nya — kalau tidak, panel aktivitas milik SPV kosong
-- tanpa error (kelas cacat yang sama dengan 20260805160305).
CREATE POLICY prospect_activities_select ON public.prospect_activities FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR private.jwt_owns_lead(lead_id)
       OR EXISTS (SELECT 1 FROM prospect_attempts pa
                   WHERE pa.id = prospect_activities.attempt_id
                     AND jwt_employee_id() IN (pa.owner_employee_id, pa.created_by))
       -- Lead/SPV = division-wide (CLAUDE.md §6): Head Sales membaca effort
       -- seluruh timnya, yang justru alasan fitur ini diminta.
       OR (jwt_is_lead() AND EXISTS (
             SELECT 1 FROM leads l
              WHERE l.id = prospect_activities.lead_id
                AND l.origin_division = jwt_division())));

-- ---------------------------------------------------------------------------
-- 3. MSL: layanan "Komisi" (passthrough) — permintaan pemilik 2026-08-06
-- ---------------------------------------------------------------------------
-- Ini DATA, bukan skema, dan sengaja dimasukkan lewat migrasi: MSL produksi
-- di-seed dari `supabase/seed/msl_kalkulator.csv` yang tidak dijalankan ulang di
-- `CDPS SG`, jadi tanpa baris ini layanannya tidak akan pernah muncul di sana.
-- Idempoten (guard NOT EXISTS on name) supaya `supabase db push` berulang, CI
-- rebuild, dan lingkungan yang sudah punya barisnya sama-sama aman.
--
-- Bentuknya persis apa yang akan dihasilkan `msl.createService` untuk mode
-- passthrough (`standard_price = 0`, `min_qty` NULL): nominal rupiah diketik
-- sales di kalkulator dan dipakai apa adanya sebagai subtotal (DECISIONS
-- 2026-07-16, mekanisme yang sama dengan GMV Max).
--
-- `commission_rule` = 'flat Rp 0': layanan ini SENDIRI adalah komisi, jadi
-- menghitung komisi lagi di atasnya akan menghitung ganda. Grammar-nya tetap
-- yang sah menurut DECISIONS O14 supaya `parseCommissionRule` tidak menolaknya.
-- `apply_ppn = false`: komisi bukan objek PPN jasa di rate card ini.
DO $$
DECLARE
    v_id text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM master_service_versions WHERE name = 'Komisi') THEN
        v_id := ident_next('MSV', now());
        INSERT INTO master_services (id, created_by) VALUES (v_id, 'SYSTEM');
        INSERT INTO master_service_versions
            (service_id, version_no, name, standard_price, commission_rule, category, unit,
             min_qty, pricing_mode, apply_ppn, frequency, price_note, description,
             active, requires_strategy_plan, effective_from, created_by)
        VALUES
            (v_id, 1, 'Komisi', 0, 'flat Rp 0', 'Komisi', NULL,
             NULL, 'passthrough', false, NULL,
             'Nominal diisi sales per-deal (angka tidak tetap).',
             'Komisi kesepakatan yang nominalnya diketik sales saat Qualified/Negosiasi. '
             || 'Mode passthrough: nilai yang diketik dipakai apa adanya sebagai subtotal, '
             || 'tanpa harga satuan dan tanpa PPN.',
             true, false, DATE '2026-08-06', 'SYSTEM');
        INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, after_json, created_by)
            VALUES ('master_service', v_id, 'SYSTEM', 'create',
                    jsonb_build_object('version_no', 1, 'name', 'Komisi',
                                       'standard_price', '0.00',
                                       'pricing_mode', 'passthrough'),
                    'SYSTEM');
    END IF;
END $$;
