-- Alpha Digital worked-example fixture (S0-11).
--
-- Port 1:1 dari backend/internal/seed/seed.go. Dijalankan otomatis oleh
-- `supabase db reset` dan pada pembuatan Supabase branch (preview) — memastikan
-- setiap DB baru punya data demo yang sama untuk QA/UAT (Lampiran §E.4).
--
-- IDEMPOTEN: aman dijalankan berulang (upsert / guarded), konvergen ke state sama —
-- persis sifat seed.go. Auth (kredensial) TIDAK di-seed di sini: di stack baru auth =
-- Supabase Auth (Fase 1); employees hanya data karyawan (sumber HRIS/CSV, OQ-4).
--
-- Isi (paritas seed.go): 10 karyawan, 11 role mapping, 3 layered Director
-- (EMP-0008/0009/0010), 3 master service (via ident_next 'MSV'), 1 demo task milik
-- Budi/EMP-0001 (via ident_next 'DEMO', status awal brief_task '[To Do]'). Setiap
-- pembuatan entity ber-ID menulis baris audit 'create' immutable, seperti kode domain.

-- ============================================================================
-- 1) Karyawan (10) — upsert idempotent (mirror HRIS sync dari testdata/employees.csv)
-- ============================================================================
INSERT INTO employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by) VALUES
    ('EMP-0001', 'Budi Santoso',    'budi@mea.co.id',    'Sales',      'Sales Executive',  true, 'SYSTEM'),
    ('EMP-0002', 'Sinta Rahma',     'sinta@mea.co.id',   'Account',    'Account Manager',  true, 'SYSTEM'),
    ('EMP-0003', 'Rian Pratama',    'rian@mea.co.id',    'Creative',   'Creative Designer',true, 'SYSTEM'),
    ('EMP-0004', 'Kenny Wijaya',    'kenny@mea.co.id',   'Ads',        'Ads Specialist',   true, 'SYSTEM'),
    ('EMP-0005', 'Putri Lestari',   'putri@mea.co.id',   'KOL',        'KOL Specialist',   true, 'SYSTEM'),
    ('EMP-0006', 'Dewi Anggraini',  'dewi@mea.co.id',    'Sales',      'Sales Head',       true, 'SYSTEM'),
    ('EMP-0007', 'Fajar Nugroho',   'fajar@mea.co.id',   'Finance',    'Finance Staff',    true, 'SYSTEM'),
    ('EMP-0008', 'Yohan Saputra',   'yohan@mea.co.id',   'Management', 'Director',         true, 'SYSTEM'),
    ('EMP-0009', 'Nerissa Arviana', 'nerissa@mea.co.id', 'Management', 'Director',         true, 'SYSTEM'),
    ('EMP-0010', 'Hans Kurniawan',  'hans@mea.co.id',    'Management', 'Director',         true, 'SYSTEM')
ON CONFLICT (employee_id) DO UPDATE SET
    nama = EXCLUDED.nama, email = EXCLUDED.email, divisi = EXCLUDED.divisi,
    jabatan = EXCLUDED.jabatan, status_aktif = EXCLUDED.status_aktif;

-- ============================================================================
-- 2) Role mapping HRIS(divisi,jabatan) -> CDPS(division,level) (11) — upsert
-- ============================================================================
INSERT INTO role_mappings (divisi, jabatan, division, level, created_by) VALUES
    ('Sales',    'Sales Executive',   'Sales',    'staff', 'SYSTEM'),
    ('Sales',    'Sales Head',        'Sales',    'lead',  'SYSTEM'),
    ('Account',  'Account Manager',   'Account',  'staff', 'SYSTEM'),
    ('Account',  'Account Lead',      'Account',  'lead',  'SYSTEM'),
    ('Creative', 'Creative Designer', 'Creative', 'staff', 'SYSTEM'),
    ('Creative', 'Creative Lead',     'Creative', 'lead',  'SYSTEM'),
    ('Ads',      'Ads Specialist',    'Ads',      'staff', 'SYSTEM'),
    ('Ads',      'Ads Lead',          'Ads',      'lead',  'SYSTEM'),
    ('KOL',      'KOL Specialist',    'KOL',      'staff', 'SYSTEM'),
    ('KOL',      'KOL Lead',          'KOL',      'lead',  'SYSTEM'),
    ('Finance',  'Finance Staff',     'Finance',  'staff', 'SYSTEM'),
    ('Finance',  'Finance Head',      'Finance',  'lead',  'SYSTEM')
ON CONFLICT (divisi, jabatan) DO UPDATE SET
    division = EXCLUDED.division, level = EXCLUDED.level;

-- ============================================================================
-- 3) Layered Director (EMP-0008/0009/0010) — upsert (enabled)
-- ============================================================================
INSERT INTO employee_layered_roles (employee_id, role, enabled, created_by) VALUES
    ('EMP-0008', 'director', true, 'SYSTEM'),
    ('EMP-0009', 'director', true, 'SYSTEM'),
    ('EMP-0010', 'director', true, 'SYSTEM')
ON CONFLICT (employee_id, role) DO UPDATE SET enabled = true;

-- ============================================================================
-- 4) Master service (3) — via ident_next('MSV'), guarded PER NAMA
--    Setiap service: master_services + master_service_versions v1 + audit 'create'.
--    Kolom pricing kalkulator memakai default (pricing_mode 'flat', apply_ppn false,
--    requires_strategy_plan false) — persis ServiceInput minimal seed.go.
-- ============================================================================
DO $$
DECLARE
    v_id text;
    r    record;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('Ads Management',      numeric '10000000.00', '5% of standard price'),
            ('KOL Management',      numeric '7500000.00',  '4% of standard price'),
            ('Live Stream Package', numeric '12000000.00', 'flat Rp 500.000')
        ) AS t(name, price, rule)
    LOOP
        -- Guard PER NAMA, bukan "tabel kosong". Sejak migrasi 20260806050000
        -- menanam layanan 'Komisi', tabelnya TIDAK PERNAH kosong lagi, jadi guard
        -- lama akan melewatkan seluruh seed demo dan fixture Alpha Digital
        -- kehilangan katalognya — gagal diam-diam, persis kelas cacat yang
        -- CLAUDE.md peringatkan.
        IF NOT EXISTS (SELECT 1 FROM master_service_versions WHERE name = r.name) THEN
            v_id := ident_next('MSV', now());
            INSERT INTO master_services (id, created_by) VALUES (v_id, 'SYSTEM');
            INSERT INTO master_service_versions
                (service_id, version_no, name, standard_price, commission_rule, active, effective_from, created_by)
                VALUES (v_id, 1, r.name, r.price, r.rule, true, DATE '2026-01-01', 'SYSTEM');
            INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, after_json, created_by)
                VALUES ('master_service', v_id, 'SYSTEM', 'create',
                        jsonb_build_object('version_no', 1, 'name', r.name,
                                           'standard_price', to_char(r.price, 'FM9999999990.00'),
                                           'pricing_mode', 'flat'),
                        'SYSTEM');
        END IF;
    END LOOP;
END $$;

-- ============================================================================
-- 5) Satu demo task milik Budi (EMP-0001, Sales staff) — via ident_next('DEMO'),
--    guarded. Status awal machine brief_task = '[To Do]'; audit 'create'.
-- ============================================================================
DO $$
DECLARE
    v_id text;
BEGIN
    IF (SELECT count(*) FROM demo_tasks) = 0 THEN
        v_id := ident_next('DEMO', now());
        INSERT INTO demo_tasks (id, title, description, division, status, created_by)
            VALUES (v_id, 'Contoh Brief — Konten Feed Alpha Digital',
                    'Task demo Sprint 0 untuk Alpha Digital.', 'Sales', '[To Do]', 'EMP-0001');
        INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, after_json, created_by)
            VALUES ('demo_task', v_id, 'EMP-0001', 'create',
                    jsonb_build_object('status', '[To Do]', 'title', 'Contoh Brief — Konten Feed Alpha Digital'),
                    'EMP-0001');
    END IF;
END $$;

-- ============================================================================
-- 6) Klien Alpha Digital + Interview "Kelola Klien" terskoring (Modul Interview
--    langkah 9). Klien via ident_next('CLI'), Interview via ident_next('ITV');
--    dua-duanya guarded (idempoten, seed 2× konvergen). Klien dipegang Sinta
--    (EMP-0002, Account Manager), closing oleh Budi (EMP-0001, Sales).
--
--    Kualifikasi di-seed dengan angka DARI kontrak core: klien "perfect" pada
--    packages/core/src/interview.test.ts ("perfect client → growth_ready at 100")
--    — {A:30,B:20,C:20,D:15,E:15} = 100, verdict growth_ready, tanpa deal-breaker,
--    kualitas terverifikasi. BUKAN skor karangan: ia mencerminkan hasil scorer
--    yang SATU itu (aturan rumah #4). Verdict advisory (Blok D): tidak ada gate.
-- ============================================================================
DO $$
DECLARE
    v_client text;
    v_itv    text;
BEGIN
    -- Klien — guard per nama toko.
    SELECT id INTO v_client FROM clients WHERE toko = 'Alpha Digital';
    IF v_client IS NULL THEN
        v_client := ident_next('CLI', now());
        INSERT INTO clients
            (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
             total_sales, sales_pic_id, commission_payment_pic_id, assigned_am_id,
             released_to_account_at, created_by)
            VALUES (v_client, 'Rani', 'Alpha Digital', 'Bandung',
                    'https://shopee.co.id/alpha', 'Home Living', 0, 0, 0,
                    'EMP-0001', 'EMP-0001', 'EMP-0002', now(), 'EMP-0002');
        INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, after_json, created_by)
            VALUES ('client', v_client, 'EMP-0002', 'create',
                    jsonb_build_object('toko', 'Alpha Digital', 'assigned_am_id', 'EMP-0002'),
                    'EMP-0002');
    END IF;

    -- Interview — guard per klien (satu interview fixture cukup).
    IF NOT EXISTS (SELECT 1 FROM interview WHERE client_id = v_client) THEN
        v_itv := ident_next('ITV', now());
        INSERT INTO interview
            (id, client_id, am_pengisi_id, sales_closing_id, status, versi_no,
             interview_profile, created_by)
            VALUES (v_itv, v_client, 'EMP-0002', 'EMP-0001', 'Selesai', 1,
                    'full_management', 'EMP-0002');
        -- Kualifikasi (growth_ready @ 100) — angka mengikuti fixture core.
        INSERT INTO interview_kualifikasi
            (interview_id, skor_kualifikasi, skor_per_blok, verdict_kualifikasi,
             hambatan_mendasar, prasyarat_status, margin_bersih, margin_bersih_basis,
             margin_kotor, kualitas_data, bep_roas, rasio_target, config_snapshot,
             dihitung_oleh)
            VALUES (v_itv, 100,
                    jsonb_build_object('A', 30, 'B', 20, 'C', 20, 'D', 15, 'E', 15),
                    'growth_ready', '[]'::jsonb, 'selesai', 35.00, 'bersih_klien',
                    45.00, 'terverifikasi', 2.86, 2.00,
                    jsonb_build_object('seed', true, 'source', 'core perfect-client fixture'),
                    'EMP-0002');
        INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, after_json, created_by)
            VALUES ('interview', v_itv, 'EMP-0002', 'create',
                    jsonb_build_object('client_id', v_client, 'versi_no', 1, 'status', 'Selesai',
                                       'verdict_kualifikasi', 'growth_ready'),
                    'EMP-0002');
    END IF;
END $$;
