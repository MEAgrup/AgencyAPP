-- CDPS M17 §5.4 — LT-53: dua item Master Service List baru: `AI Video` dan
-- `Optimasi SKU`, agar keduanya bisa dijual dan punya `durasi_jasa` (kolom
-- generik ditambahkan LT-42, `20260831020000`). Pola seed idempoten meniru
-- `20260806050000_prospect_activity_and_komisi_service.sql` (DO block +
-- `ident_next`, dilindungi `IF NOT EXISTS ... WHERE name = ...` supaya migrasi
-- ini aman dijalankan ulang).
--
-- `plan_tier`/`durasi_jasa` di sini adalah NILAI AWAL yang wajar (M17 §5.4:
-- "ditetapkan Admin") — Admin (Sales Head/SPV/Director, `canEditMasterServices`)
-- tetap bisa mengubahnya lewat `updateService` (versi baru, immutable chain),
-- persis service lain di MSL. `pricing_mode='flat'` + harga placeholder Rp 0
-- dipilih karena PRD tidak menulis angka harga — Admin mengisi harga
-- sesungguhnya lewat UI MSL yang sudah ada, sama seperti pola `Komisi`
-- (`nominal diisi ... angka tidak tetap`) di migrasi rujukan.

DO $$
DECLARE
    v_id text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM master_service_versions WHERE name = 'AI Video') THEN
        v_id := ident_next('MSV', now());
        INSERT INTO master_services (id, created_by) VALUES (v_id, 'SYSTEM');
        INSERT INTO master_service_versions
            (service_id, version_no, name, standard_price, commission_rule, category, unit,
             min_qty, pricing_mode, apply_ppn, frequency, price_note, description,
             active, requires_strategy_plan, durasi_jasa, effective_from, created_by)
        VALUES (v_id, 1, 'AI Video', 0, 'flat Rp 0', 'AI Optimizer', 'video',
                NULL, 'flat', false, 'Monthly',
                'Harga ditetapkan Admin saat onboarding — placeholder Rp 0 sampai diisi.',
                'M17 — produksi video berbantuan AI (Generate AI menggantikan Shooting), tanpa tahap shooting.',
                true, false, 30, DATE '2026-08-31', 'SYSTEM');
        -- requires_strategy_plan=false: pipeline AI Video (Cek Brief AM -> Script ->
        -- Generate AI -> Edit -> QC -> Jadwal Posting) tidak bergantung pada STRG,
        -- beda dengan Optimasi SKU di bawah yang menarik daftar SKU dari STRG E-3.
        INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, before_json, after_json, created_by)
        VALUES ('master_service', v_id, 'SYSTEM', 'create', NULL,
                jsonb_build_object('version_no', 1, 'name', 'AI Video', 'standard_price', 0, 'pricing_mode', 'flat'),
                'SYSTEM');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM master_service_versions WHERE name = 'Optimasi SKU') THEN
        v_id := ident_next('MSV', now());
        INSERT INTO master_services (id, created_by) VALUES (v_id, 'SYSTEM');
        INSERT INTO master_service_versions
            (service_id, version_no, name, standard_price, commission_rule, category, unit,
             min_qty, pricing_mode, apply_ppn, frequency, price_note, description,
             active, requires_strategy_plan, durasi_jasa, effective_from, created_by)
        VALUES (v_id, 1, 'Optimasi SKU', 0, 'flat Rp 0', 'AI Optimizer', 'sku',
                NULL, 'flat', false, 'Monthly',
                'Harga ditetapkan Admin saat onboarding — placeholder Rp 0 sampai diisi.',
                'M17 — perbaikan SKU klien terdaftar di STRG (judul/deskripsi/atribut/foto), disinkronkan balik sebagai revisi bernomor.',
                true, true, 30, DATE '2026-08-31', 'SYSTEM');
        -- requires_strategy_plan=true: "Ambil SKU" menarik daftar dari STRG E-3
        -- (hero/Pareto) — tanpa Strategi Aktif tidak ada SKU untuk digarap.
        INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, before_json, after_json, created_by)
        VALUES ('master_service', v_id, 'SYSTEM', 'create', NULL,
                jsonb_build_object('version_no', 1, 'name', 'Optimasi SKU', 'standard_price', 0, 'pricing_mode', 'flat'),
                'SYSTEM');
    END IF;
END $$;
