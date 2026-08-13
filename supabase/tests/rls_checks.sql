-- Fase-1 DB invariant check: Row Level Security (plain psql; run with -v ON_ERROR_STOP=1).
--
-- Verifies that the RLS policies in 20260723064438_rls_baseline.sql enforce the
-- SAME predicate as packages/core/src/permission.ts (the two implementations must
-- never diverge — Tech Appendix §B.4/§D). Exercised by switching to the real
-- `authenticated` Postgres role and injecting JWT claims via the GUC that the
-- portable `auth.jwt()` shim reads (`request.jwt.claims`), so the policies run
-- exactly as they will under Supabase Auth.
--
-- Runs in a transaction and ROLLBACKs — leaves no rows behind. Seed-independent
-- (inserts its own fixture with a unique id, isolated by `WHERE id = ...`).
--
-- See ident_checks.sql for why these are plain-SQL (not pgTAP) at this stage.

BEGIN;

-- Fixture inserted as the owning superuser (RLS does not apply here): one demo
-- task owned by EMP-RLS-OWNER in division 'Sales'.
INSERT INTO demo_tasks (id, title, division, status, created_at, created_by)
VALUES ('RLS-TEST-0001', 'rls fixture', 'Sales', 'To Do', now(), 'EMP-RLS-OWNER');

-- Drop to the RLS-bearing role for the remainder of the transaction.
SET LOCAL ROLE authenticated;

-- Helper: assert how many fixture rows are visible under a given claim set.
-- (Inline DO blocks run as `authenticated` → RLS applies; auth.jwt() reads the
--  claims GUC set immediately before each.)

-- 1. Owner staff sees own row.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-OWNER","division":"Sales","level":"staff"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM demo_tasks WHERE id='RLS-TEST-0001') <> 1
  THEN RAISE EXCEPTION 'RLS demo_tasks: owner staff must see own row'; END IF;
END $$;

-- 2. A different staff (not owner, different division) sees nothing.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-OTHER","division":"Ops","level":"staff"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM demo_tasks WHERE id='RLS-TEST-0001') <> 0
  THEN RAISE EXCEPTION 'RLS demo_tasks: unrelated staff must see nothing'; END IF;
END $$;

-- 3. Lead of the row's division sees it (division-wide read).
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-LEAD","division":"Sales","level":"lead"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM demo_tasks WHERE id='RLS-TEST-0001') <> 1
  THEN RAISE EXCEPTION 'RLS demo_tasks: same-division lead must see the row'; END IF;
END $$;

-- 4. Lead of a DIFFERENT division does not.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-LEAD2","division":"Ops","level":"lead"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM demo_tasks WHERE id='RLS-TEST-0001') <> 0
  THEN RAISE EXCEPTION 'RLS demo_tasks: other-division lead must NOT see the row'; END IF;
END $$;

-- 5. Director reads everything (layered full-access).
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-DIR","director":true}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM demo_tasks WHERE id='RLS-TEST-0001') <> 1
  THEN RAISE EXCEPTION 'RLS demo_tasks: director must read all'; END IF;
END $$;

-- 6. OD reads everything (read-only-everywhere).
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-OD","od":true}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM demo_tasks WHERE id='RLS-TEST-0001') <> 1
  THEN RAISE EXCEPTION 'RLS demo_tasks: OD must read all'; END IF;
END $$;

-- 7. No/empty claims → default deny.
SELECT set_config('request.jwt.claims', '{}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM demo_tasks WHERE id='RLS-TEST-0001') <> 0
  THEN RAISE EXCEPTION 'RLS demo_tasks: empty claims must see nothing'; END IF;
END $$;

-- 8. Master Service List is a shared catalogue — any authenticated user reads it
--    (policy USING (true)); assert the policy path is reachable without error.
DO $$ BEGIN
  PERFORM count(*) FROM master_services;
END $$;

-- 9. Internal tables are locked to `authenticated` entirely (no grant, no policy):
--    even a director claim cannot read sessions / employee_credentials.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-DIR","director":true}}', true);
DO $$
DECLARE t text; denied boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['sessions','employee_credentials','id_sequences','sm_edges','role_mappings','strategi_share_token','strategi_share_access_log'] LOOP
    denied := false;
    BEGIN
      EXECUTE format('SELECT 1 FROM public.%I LIMIT 1', t);
    EXCEPTION WHEN insufficient_privilege THEN denied := true;
    END;
    IF NOT denied THEN
      RAISE EXCEPTION 'internal table % must be denied to authenticated', t;
    END IF;
  END LOOP;
END $$;

-- 9b. …and yet the transition engine must still be INTROSPECTABLE by a logged-in
--     caller. QA live 2026-08-03: `sales.getAttempt` (the attempt-detail page)
--     read `sm_edges` directly under `readAsActor`, hit 42501 from check 9's very
--     invariant, and the page rendered a bare "internal server error" (an
--     unmapped Postgres error → 500). The fix keeps the TABLE denied above and
--     exposes only the ANSWER through `private.sm_allowed_transitions`
--     (SECURITY DEFINER, migration 20260803123327). Both halves are asserted
--     here: the call must succeed AND return the real edges, because a function
--     that silently returned {} would render an action-less page instead of an
--     error — the harder failure to notice.
DO $$
DECLARE moves text[];
BEGIN
  moves := private.sm_allowed_transitions('prospect_attempt', 'New Lead');
  IF NOT ('Contacted' = ANY (moves)) THEN
    RAISE EXCEPTION 'sm_allowed_transitions must reach Contacted from New Lead as authenticated (got %)', moves;
  END IF;
  -- Unknown machine / terminal state → EMPTY array, never NULL: the client
  -- iterates the result to decide which buttons exist at all.
  IF private.sm_allowed_transitions('mesin_yang_tidak_ada', 'Apapun') <> '{}'::text[] THEN
    RAISE EXCEPTION 'sm_allowed_transitions must return {} for an unknown machine';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 10-13. O37 — `leads` read scope. These are the cases the API read path got
--        wrong before O37: it queried as the service role, so RLS never ran and
--        ANY authenticated caller could read every lead. `readAsActor`
--        (apps/api/src/lib/db.ts) now reproduces exactly the role switch + claim
--        injection used here, so these assertions cover the real request path.
-- ---------------------------------------------------------------------------
RESET ROLE;

-- Fixture (as superuser): a Marketing-origin lead created by EMP-RLS-MKT1 whose
-- origin campaign is owned by a DIFFERENT marketing staffer, EMP-RLS-MKT2.
INSERT INTO campaigns (id, name, channel, start_date, owner_employee_id, status, created_by)
VALUES ('CMP-RLS-0001', 'rls fixture campaign', 'TikTok Ads', current_date, 'EMP-RLS-MKT2', 'Active', 'EMP-RLS-MKT2');
INSERT INTO leads (id, lead_name, phone_number, phone_norm, source, origin_division,
                   origin_campaign_id, record_status, created_by)
VALUES ('LEAD-RLS-0001', 'rls fixture lead', '0811000111', '62811000111', 'Leads - Iklan',
        'Marketing', 'CMP-RLS-0001', 'active', 'EMP-RLS-MKT1');
INSERT INTO prospect_attempts (id, lead_id, owner_employee_id, status, created_by)
VALUES ('PRSP-RLS-0001', 'LEAD-RLS-0001', 'EMP-RLS-SLS1', 'New Lead', 'EMP-RLS-SLS1');

SET LOCAL ROLE authenticated;

-- 10. An unrelated staff member (different division, no attempt, not creator)
--     must NOT see the lead. This is the core O37 leak.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-NOBODY","division":"Creative","level":"staff"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM leads WHERE id='LEAD-RLS-0001') <> 0
  THEN RAISE EXCEPTION 'RLS leads: unrelated staff must not see the lead (O37)'; END IF;
END $$;

-- 11. A Sales staffer who does NOT hold an attempt sees nothing either — being
--     in Sales is not by itself a licence to read every lead.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-SLS9","division":"Sales","level":"staff"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM leads WHERE id='LEAD-RLS-0001') <> 0
  THEN RAISE EXCEPTION 'RLS leads: sales staff without an attempt must not see the lead'; END IF;
END $$;

-- 12. The Sales staffer holding the attempt DOES see it (co-pursuit, M1-OA-1).
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-SLS1","division":"Sales","level":"staff"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM leads WHERE id='LEAD-RLS-0001') <> 1
  THEN RAISE EXCEPTION 'RLS leads: attempt holder must see the lead'; END IF;
END $$;

-- 13. Marketing staff who own the ORIGIN CAMPAIGN see the lead even though they
--     did not create it — the arm added by 20260729031525 for parity with Go
--     `canReadLead`. Without that migration this check fails.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-MKT2","division":"Marketing","level":"staff"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM leads WHERE id='LEAD-RLS-0001') <> 1
  THEN RAISE EXCEPTION 'RLS leads: own-campaign origin must be readable (Go canReadLead parity)'; END IF;
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 13b. Picker campaign intake (M1 §9.3 Origin Campaign, migrasi 20260805022245).
--      Sales HARUS bisa memilih campaign asal lead, padahal ia tidak memiliki
--      campaign apa pun — sedangkan `campaigns_select` sengaja hanya membuka
--      baris milik/ciptaan aktor. Kedua sisinya ditegakkan di sini: TABEL-nya
--      tetap tertutup untuk Sales, TAPI `private.campaign_selectable()` menjawab.
--      Kalau assertion pertama merah, row-scope M3 §5 sudah dilebarkan diam-diam;
--      kalau yang kedua merah, dropdown registrasi lead tampil KOSONG di produksi
--      dan field campaign kembali dilewati — persis bug yang diperbaiki.
-- ---------------------------------------------------------------------------

-- Fixture tambahan (superuser): campaign Closed dan Draft. Keduanya WAJIB ikut
-- ditawarkan (arahan pemilik 2026-08-04): campaign yang tidak ada di dropdown
-- tidak bisa diatribusikan sama sekali, jadi performanya permanen nol — dan nol
-- itu tak bisa dibedakan dari campaign yang benar-benar gagal.
INSERT INTO campaigns (id, name, channel, start_date, owner_employee_id, status, created_by)
VALUES ('CMP-RLS-0002', 'rls fixture closed campaign', 'IG', current_date, 'EMP-RLS-MKT2', 'Closed', 'EMP-RLS-MKT2'),
       ('CMP-RLS-0003', 'rls fixture draft campaign', 'IG', current_date, 'EMP-RLS-MKT2', 'Draft', 'EMP-RLS-MKT2');

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-SLS9","division":"Sales","level":"staff"}}', true);
DO $$
DECLARE ids text[]; funnel record;
BEGIN
  IF (SELECT count(*) FROM campaigns WHERE id LIKE 'CMP-RLS-%') <> 0 THEN
    RAISE EXCEPTION 'RLS campaigns: Sales staff must NOT read the campaigns table (M3 §5 owner scope)';
  END IF;
  SELECT coalesce(array_agg(id), '{}'::text[]) INTO ids
    FROM private.campaign_selectable() WHERE id LIKE 'CMP-RLS-%';
  IF NOT ('CMP-RLS-0001' = ANY (ids)          -- Active
      AND 'CMP-RLS-0002' = ANY (ids)          -- Closed
      AND 'CMP-RLS-0003' = ANY (ids)) THEN    -- Draft
    RAISE EXCEPTION 'campaign_selectable: EVERY status must be pickable by Sales (got %)', ids;
  END IF;

  -- …dan funnel turunannya ikut terbaca. Fixture LEAD-RLS-0001 ber-Origin
  -- CMP-RLS-0001 dan attempt-nya belum pernah mencapai Qualified, jadi angkanya
  -- 1 lead masuk / 0 lead asli / 0 not qualified. Nol di ketiganya akan lolos
  -- assertion yang cuma memeriksa "ada barisnya" — makanya dicek nilainya.
  SELECT lead_by_dashboard, lead_real_by_sales, lead_not_qualified INTO funnel
    FROM private.campaign_selectable() WHERE id = 'CMP-RLS-0001';
  IF funnel.lead_by_dashboard <> 1 OR funnel.lead_real_by_sales <> 0 OR funnel.lead_not_qualified <> 0 THEN
    RAISE EXCEPTION 'campaign_selectable: funnel must read 1/0/0 for the fixture (got %/%/%)',
      funnel.lead_by_dashboard, funnel.lead_real_by_sales, funnel.lead_not_qualified;
  END IF;
END $$;

-- Kontrol negatif: belum login tidak punya urusan dengan daftar campaign.
RESET ROLE;
SET LOCAL ROLE anon;
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    PERFORM * FROM private.campaign_selectable();
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'campaign_selectable: EXECUTE must be denied to anon';
  END IF;
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 14-17. O41 — M5 verification-queue read scope. The baseline policies gave
--        Finance read access only through `jwt_is_lead() AND jwt_division() =
--        'Finance'`, i.e. LEAD ONLY, while Go `trxVisibility` grants Finance
--        "(staff/lead) -> all (they own the queue)" and `canVerifyPayment`
--        (M5 §8.1) lets Finance STAFF set Payment Status. Under the lead-only
--        policy, porting the read path to `readAsActor` hands Finance staff an
--        EMPTY queue with no error — and a Finance staffer could verify a
--        payment they cannot read (writes go through SECURITY DEFINER RPCs).
--        20260729032805 restores parity; without it, check 15 fails.
-- ---------------------------------------------------------------------------

-- Fixture (as superuser): one client + a transaction awaiting verification,
-- created by Sales, on a client no Finance actor owns.
INSERT INTO clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline,
                     target_gmv, sales_pic_id, commission_payment_pic_id, created_by)
VALUES ('CLI-RLS-0001', 'rls fixture pic', 'Toko RLS', 'Jakarta', 'https://shopee/rls', 'Fashion',
        1000000, 2000000, 'EMP-RLS-SLS1', 'EMP-RLS-SLS1', 'EMP-RLS-SLS1');
INSERT INTO transactions (id, client_id, payment_intent_scheme, total_agreed_value, payment_status, created_by)
VALUES ('TRX-RLS-0001', 'CLI-RLS-0001', 'Termin', 9000000, '[Menunggu Verifikasi]', 'EMP-RLS-SLS1');

SET LOCAL ROLE authenticated;

-- 14. A foreign-division staffer must not see the transaction at all.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-NOBODY","division":"Creative","level":"staff"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM transactions WHERE id='TRX-RLS-0001') <> 0
  THEN RAISE EXCEPTION 'RLS transactions: foreign division must not see the transaction'; END IF;
END $$;

-- 15. Finance STAFF sees it — they are the verification queue's primary user
--     (Go trxVisibility: Finance staff/lead -> all). Fails without …0010.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-FIN1","division":"Finance","level":"staff"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM transactions WHERE id='TRX-RLS-0001') <> 1
  THEN RAISE EXCEPTION 'RLS transactions: Finance STAFF must see the queue (Go trxVisibility parity, O41)'; END IF;
END $$;

-- 16. Finance lead keeps its access (the arm that already existed).
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-FINLEAD","division":"Finance","level":"lead"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM transactions WHERE id='TRX-RLS-0001') <> 1
  THEN RAISE EXCEPTION 'RLS transactions: Finance lead must see the queue'; END IF;
END $$;

-- 17. Widening Finance must not widen anyone else: an Account staffer who is not
--     the assigned AM of this client still sees nothing.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-AM9","division":"Account","level":"staff"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM transactions WHERE id='TRX-RLS-0001') <> 0
  THEN RAISE EXCEPTION 'RLS transactions: non-owning Account staff must not see the transaction'; END IF;
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 17b-17e. M5-OA-7 (keputusan pemilik 2026-08-04) — pengajuan perubahan
--          transaksi. Antrian ACC ini memuat rencana uang (skema + jadwal
--          pengganti) sebuah deal, jadi lingkupnya sengaja SAMA SEMPITNYA dengan
--          jalur baca M5: Finance (worklist-nya), pihak yang terlibat, dan
--          Director/OD. Sales & Account TIDAK dapat arm — mereka membaca Payment
--          Status, bukan proses persetujuan internal Finance.
-- ---------------------------------------------------------------------------
INSERT INTO transaction_change_requests
  (id, transaction_id, from_scheme, to_scheme, schedule_json, amount_outstanding,
   reason, status, requested_by, created_by)
VALUES
  ('TCR-RLS-0001', 'TRX-RLS-0001', '[Bayar Penuh (Lunas)]', '[Termin]',
   '[{"amount":"9000000","due_date":"2026-09-01"}]'::jsonb, 9000000,
   'klien pindah metode bayar', 'pending', 'EMP-RLS-FINLEAD', 'EMP-RLS-FINLEAD');

SET LOCAL ROLE authenticated;

-- 17b. Finance melihat antrian ACC-nya (staff sekalipun — halaman transaksi M5
--      menampilkan panel ini, dan nol di sini berarti panelnya kosong senyap).
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-FIN1","division":"Finance","level":"staff"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM transaction_change_requests WHERE id='TCR-RLS-0001') <> 1
  THEN RAISE EXCEPTION 'RLS transaction_change_requests: Finance must see the ACC queue (M5-OA-7)'; END IF;
END $$;

-- 17c. Director membaca semuanya — dialah yang harus memutuskan. Kalau check ini
--      merah, tombol ACC-nya tidak pernah punya baris untuk ditindak.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-DIR","division":"Management","level":"staff","director":true}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM transaction_change_requests WHERE id='TCR-RLS-0001') <> 1
  THEN RAISE EXCEPTION 'RLS transaction_change_requests: Director must see every filing (M5-OA-7)'; END IF;
END $$;

-- 17d. Sales — termasuk PIC klien-nya sendiri — TIDAK melihat antrian ini.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-SLS1","division":"Sales","level":"staff"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM transaction_change_requests WHERE id='TCR-RLS-0001') <> 0
  THEN RAISE EXCEPTION 'RLS transaction_change_requests: Sales PIC must NOT see the Finance approval queue (M5-OA-7)'; END IF;
END $$;

-- 17e. Fail-closed: klaim kosong membaca NOL.
SELECT set_config('request.jwt.claims', '{"app_metadata":{}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM transaction_change_requests WHERE id='TCR-RLS-0001') <> 0
  THEN RAISE EXCEPTION 'RLS transaction_change_requests: empty claims must read NOTHING'; END IF;
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 18-23. O46 — arm "Lead/SPV = division-wide" (PRD Role Matrix §6), ditambahkan
--        20260730091540. Dua policy sebelumnya lebih SEMPIT dari Go DAN dari PRD:
--        `transactions_select` tak punya arm Sales-Lead (Go `trxVisibility` memberi
--        Sales Lead seluruh transaksi klien sales-nya), dan `audit_log_select`
--        tak punya arm lead sama sekali sehingga seorang lead tidak bisa membaca
--        jejak audit divisinya sendiri.
--
--        Berbeda dari check 1-17, blok ini butuh baris `employees` NYATA: kedua
--        helper baru (`private.jwt_same_division`,
--        `private.jwt_division_owns_client`) me-resolve divisi karyawan LAIN, dan
--        divisi itu tidak ada di JWT si pembaca. Tanpa fixture ini kedua arm akan
--        selalu false — hijau karena hampa, bukan karena benar.
-- ---------------------------------------------------------------------------

-- Fixture (superuser): karyawan riil untuk resolusi divisi.
--
-- 🔴 BENTUKNYA PENTING, DAN PERNAH SALAH. `employees.divisi` menyimpan
-- **departemen HRIS** (`SALES`, huruf besar), BUKAN divisi CDPS (`Sales`).
-- Jembatannya `role_mappings`, dan fungsi kanonik yang menyeberanginya adalah
-- `public.employee_claims()` — fungsi yang sama yang mengisi klaim JWT.
--
-- Versi pertama fixture ini memakai `divisi='Sales'` (bentuk CDPS). Itu
-- meng-encode asumsi penulisnya, mencocokkan `jwt_division()` secara KEBETULAN,
-- dan membuat keenam check 18-23 hijau **sementara arm-nya mati di produksi**.
-- Probe terhadap live yang menemukannya, bukan test ini. Pelajaran yang harus
-- dibawa: fixture yang meng-encode asumsi penulis tentang bentuk data produksi
-- BUKAN bukti — kalau predikatnya bergantung pada bentuk data riil, fixture-nya
-- wajib memakai bentuk riil itu.
--
-- EMP-RLS-SLS1 adalah sales_pic klien CLI-RLS-0001 yang dibuat blok 14-17.
INSERT INTO employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by) VALUES
  ('EMP-RLS-SLS1',    'rls sales staff',   'rls.sls1@example.test',    'SALES',    'SALES JASA',       true, 'SYSTEM'),
  ('EMP-RLS-SLSLEAD', 'rls sales lead',    'rls.slslead@example.test', 'SALES',    'HEAD OF SALES RLS', true, 'SYSTEM'),
  ('EMP-RLS-CRELEAD', 'rls creative lead', 'rls.crelead@example.test', 'CREATIVE', 'LEAD CREATIVE RLS', true, 'SYSTEM');

-- Jembatan HRIS -> CDPS. Tanpa baris ini `employee_claims()` mengembalikan
-- division '' dan seluruh check 18-23 gagal — yaitu tepat perilaku yang benar,
-- karena karyawan tanpa role mapping memang tidak punya divisi CDPS.
INSERT INTO role_mappings (divisi, jabatan, division, level, created_by) VALUES
  ('SALES',    'SALES JASA',        'Sales',    'staff', 'SYSTEM'),
  ('SALES',    'HEAD OF SALES RLS', 'Sales',    'lead',  'SYSTEM'),
  ('CREATIVE', 'LEAD CREATIVE RLS', 'Creative', 'lead',  'SYSTEM');

-- Jejak audit milik EMP-RLS-SLS1 (divisi Sales) — objek uji arm audit.
INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, created_by)
VALUES ('transaction', 'TRX-RLS-0001', 'EMP-RLS-SLS1', 'transition:->[Menunggu Verifikasi]', 'EMP-RLS-SLS1');

SET LOCAL ROLE authenticated;

-- 18. O46 (a) — Sales LEAD melihat transaksi klien yang PIC-nya sedivisi
--     dengannya, walau ia sendiri bukan PIC mana pun. GAGAL tanpa …073000.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-SLSLEAD","division":"Sales","level":"lead"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM transactions WHERE id='TRX-RLS-0001') <> 1
  THEN RAISE EXCEPTION 'RLS transactions: Sales LEAD must see division transactions (O46 a, PRD Role Matrix)'; END IF;
END $$;

-- 19. Arm lead TIDAK boleh melebar ke divisi lain: lead Creative tetap nol.
--     Ini yang membedakan "division-wide" dari "lead-wide".
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-CRELEAD","division":"Creative","level":"lead"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM transactions WHERE id='TRX-RLS-0001') <> 0
  THEN RAISE EXCEPTION 'RLS transactions: foreign-division lead must NOT see the transaction (O46 a)'; END IF;
END $$;

-- 20. Arm lead TIDAK boleh melebar ke staff sedivisi yang bukan PIC. Kalau check
--     ini merah, `jwt_is_lead()` hilang dari arm dan seluruh divisi ikut terbuka.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-SLS9","division":"Sales","level":"staff"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM transactions WHERE id='TRX-RLS-0001') <> 0
  THEN RAISE EXCEPTION 'RLS transactions: same-division STAFF who is not PIC must NOT see it (O46 a guard)'; END IF;
END $$;

-- 21. O46 (b) — Sales LEAD membaca entri audit yang ditulis anggota divisinya.
--     GAGAL tanpa …073000.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-SLSLEAD","division":"Sales","level":"lead"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM audit_log WHERE entity_id='TRX-RLS-0001' AND actor_employee_id='EMP-RLS-SLS1') <> 1
  THEN RAISE EXCEPTION 'RLS audit_log: Sales LEAD must read division audit trail (O46 b, PRD Role Matrix)'; END IF;
END $$;

-- 22. Arm audit TIDAK boleh melebar lintas divisi: lead Creative tetap nol.
--     Tabel audit adalah yang paling mahal kalau melebar, jadi ia diuji dua arah.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-CRELEAD","division":"Creative","level":"lead"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM audit_log WHERE entity_id='TRX-RLS-0001' AND actor_employee_id='EMP-RLS-SLS1') <> 0
  THEN RAISE EXCEPTION 'RLS audit_log: foreign-division lead must NOT read the trail (O46 b)'; END IF;
END $$;

-- 23. Batas yang DINYATAKAN (bukan cacat): staff sedivisi tetap TIDAK membaca
--     entri audit orang lain — "Staff = own data only" (PRD §6). Panel riwayat
--     Asset Creative karenanya tetap parsial bagi staff, dan itu perilaku PRD.
--     Kalau check ini merah, seseorang memperluas audit ke seluruh divisi tanpa
--     entri DECISIONS.md.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-SLS9","division":"Sales","level":"staff"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM audit_log WHERE entity_id='TRX-RLS-0001' AND actor_employee_id='EMP-RLS-SLS1') <> 0
  THEN RAISE EXCEPTION 'RLS audit_log: same-division STAFF must NOT read other actors entries (PRD staff=own-only)'; END IF;
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 24-32. O48 GRUP C + D — arm "Lead/SPV = division-wide" untuk 6 policy,
--        ditambahkan 20260730160000. Keputusan pemilik 2026-07-30; analisis di
--        `docs/handoff/O48_ANALISIS_KEPUTUSAN.md`.
--
--        Fixture di bawah memakai bentuk HRIS (`divisi='CREATIVE'`) + baris
--        `role_mappings` penjembatan, bukan bentuk CDPS — aturan yang lahir dari
--        O46: fixture yang meng-encode asumsi penulis tentang bentuk data
--        produksi BUKAN bukti.
-- ---------------------------------------------------------------------------

-- Fixture (superuser). Rantai: client (blok 14) -> service -> brief -> asset.
INSERT INTO employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by) VALUES
  ('EMP-RLS-CRE1', 'rls creative staff', 'rls.cre1@example.test', 'CREATIVE', 'VIDEOGRAPHER RLS', true, 'SYSTEM');
INSERT INTO role_mappings (divisi, jabatan, division, level, created_by) VALUES
  ('CREATIVE', 'VIDEOGRAPHER RLS', 'Creative', 'staff', 'SYSTEM');

INSERT INTO services (id, client_id, master_service_id, master_version_no, name, standard_price,
                      commission_rule, status, created_by)
VALUES ('SVC-RLS-0001', 'CLI-RLS-0001', 'MSV-RLS-0001', 1, 'rls service', 9000000,
        '10% of standard price', 'Ongoing', 'EMP-RLS-SLS1');

-- Brief milik divisi CREATIVE. `assigned_division` inilah yang diresolusi helper.
INSERT INTO briefs (id, service_id, title, status, assigned_division, created_by)
VALUES ('BRF-RLS-0001', 'SVC-RLS-0001', 'rls brief', '[Draft]', 'Creative', 'EMP-RLS-CRE1');

-- Asset: PIC dan pembuatnya STAF, BUKAN lead. Ini disengaja — check 25 bertumpu
-- pada kenyataan bahwa lead Creative TIDAK bisa melihat baris `assets` ini.
INSERT INTO assets (id, brief_id, asset_type, sequence_no, assigned_pic, status, created_by)
VALUES ('AST-RLS-0001', 'BRF-RLS-0001', 'Video', 1, 'EMP-RLS-CRE1', '[To Do]', 'EMP-RLS-CRE1');

INSERT INTO demo_tasks (id, title, division, status, created_at, created_by)
VALUES ('DTK-RLS-C001', 'rls creative task', 'Creative', 'To Do', now(), 'EMP-RLS-CRE1');

-- Tiga block request, semuanya diajukan STAF (bukan lead, bukan resolver).
INSERT INTO brief_block_requests (id, brief_id, reason, requested_by, created_by)
VALUES ('BBR-RLS-0001', 'BRF-RLS-0001', 'rls reason', 'EMP-RLS-CRE1', 'EMP-RLS-CRE1');
INSERT INTO asset_block_requests (id, asset_id, reason, requested_by, created_by)
VALUES ('ABR-RLS-0001', 'AST-RLS-0001', 'rls reason', 'EMP-RLS-CRE1', 'EMP-RLS-CRE1');
INSERT INTO demo_task_block_requests (id, task_id, reason, requested_by, created_by)
VALUES ('DBR-RLS-0001', 'DTK-RLS-C001', 'rls reason', 'EMP-RLS-CRE1', 'EMP-RLS-CRE1');

-- Grup D: snapshot performa milik anggota divisi SALES + dua baris config.
INSERT INTO performance_snapshots (id, staff_id, role_type, period_start, period_end,
                                   profile_score, final_score, components_json, computed_by)
VALUES ('PRF-RLS-0001', 'EMP-RLS-SLS1', 'AM', DATE '2026-07-01', DATE '2026-07-31',
        86.4, 88.4, '{}'::jsonb, 'SYSTEM');
INSERT INTO perf_kpi_weights (role_type, component, weight, updated_by)
VALUES ('RLSROLE', 'rls_component', 100, 'SYSTEM');
INSERT INTO perf_period_targets (role_type, component, period_start, target_value, updated_by)
VALUES ('RLSROLE', 'rls_component', DATE '2026-07-01', 42, 'SYSTEM');

SET LOCAL ROLE authenticated;

-- 24. Grup C — lead Creative melihat block request BRIEF divisinya, walau ia
--     bukan requester/resolver/pembuat. Nol tanpa 20260730160000.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-CRELEAD","division":"Creative","level":"lead"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM brief_block_requests WHERE id='BBR-RLS-0001') <> 1
  THEN RAISE EXCEPTION 'RLS brief_block_requests: Creative LEAD must see own-division queue (O48 Grup C)'; END IF;
END $$;

-- 25. Lead Creative melihat block request ASSET divisinya.
--
--     ⚠️ CHECK INI DULU PUNYA DAYA BEDA YANG SEKARANG HILANG, dan itu ditulis
--     di sini alih-alih didiamkan. Sampai `20260807160000` (O48 Grup B) premisnya
--     adalah "lead Creative TIDAK bisa melihat baris `assets`", sehingga check
--     ini membuktikan `private.jwt_division_owns_asset` WAJIB SECURITY DEFINER:
--     kalau seseorang menggantinya dengan `EXISTS (SELECT 1 FROM assets …)`
--     inline, subquery-nya ikut disaring RLS, hasilnya false, dan check ini
--     merah — tepat kelas cacat O46.
--
--     O48 Grup B memberi `assets_select` arm lead/divisi (dibutuhkan O52: tanpa
--     itu `GET /assets/{id}` tetap 404 untuk divisi eksekusinya sendiri), jadi
--     baris `assets`-nya kini TERLIHAT dan `EXISTS` inline pun akan lolos.
--     Konsekuensinya: penjaga anti-O46 untuk helper ini sekarang hidup di
--     definisi fungsinya + review, bukan di sini. Dicatat di DECISIONS 2026-08-07.
--     Yang MASIH dijaga check ini: arm Grup C-nya sendiri (queue divisi terlihat
--     oleh lead) — dan check 27/28 tetap menjaga ia tidak melebar.
DO $$ BEGIN
  IF (SELECT count(*) FROM assets WHERE id='AST-RLS-0001') <> 1
  THEN RAISE EXCEPTION 'RLS assets: Creative LEAD must see own-division asset (O48 Grup B, migrasi 20260807160000)'; END IF;
  IF (SELECT count(*) FROM asset_block_requests WHERE id='ABR-RLS-0001') <> 1
  THEN RAISE EXCEPTION 'RLS asset_block_requests: Creative LEAD must see own-division queue (O48 Grup C)'; END IF;
END $$;

-- 26. Grup C — block request DEMO TASK divisinya.
DO $$ BEGIN
  IF (SELECT count(*) FROM demo_task_block_requests WHERE id='DBR-RLS-0001') <> 1
  THEN RAISE EXCEPTION 'RLS demo_task_block_requests: Creative LEAD must see own-division queue (O48 Grup C)'; END IF;
END $$;

-- 27. Grup C — arm TIDAK melebar lintas divisi: lead Sales nol di ketiganya.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-SLSLEAD","division":"Sales","level":"lead"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM brief_block_requests    WHERE id='BBR-RLS-0001') <> 0
  OR (SELECT count(*) FROM asset_block_requests    WHERE id='ABR-RLS-0001') <> 0
  OR (SELECT count(*) FROM demo_task_block_requests WHERE id='DBR-RLS-0001') <> 0
  THEN RAISE EXCEPTION 'RLS *_block_requests: foreign-division lead must see NOTHING (O48 Grup C)'; END IF;
END $$;

-- 28. Grup C — arm TIDAK melebar ke staff sedivisi. Kalau check ini merah,
--     `jwt_is_lead()` hilang dari arm dan seluruh divisi ikut terbuka.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-CRE9","division":"Creative","level":"staff"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM brief_block_requests WHERE id='BBR-RLS-0001') <> 0
  OR (SELECT count(*) FROM asset_block_requests WHERE id='ABR-RLS-0001') <> 0
  THEN RAISE EXCEPTION 'RLS *_block_requests: same-division STAFF must NOT see the queue (O48 Grup C guard)'; END IF;
END $$;

-- 29. Grup D — lead Sales melihat snapshot performa anggota divisinya (M14
--     Rule 7 "Leader/SPV: team"). Nol tanpa 20260730160000, dan itulah sebabnya
--     `teamRollup` merata-rata satu orang lalu menampilkannya sebagai rata-rata
--     TIM — angka salah yang terlihat benar.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-SLSLEAD","division":"Sales","level":"lead"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM performance_snapshots WHERE id='PRF-RLS-0001') <> 1
  THEN RAISE EXCEPTION 'RLS performance_snapshots: Sales LEAD must see division member snapshot (O48 Grup D, M14 Rule 7)'; END IF;
END $$;

-- 30. Grup D — skor performa TIDAK bocor lintas divisi.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-CRELEAD","division":"Creative","level":"lead"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM performance_snapshots WHERE id='PRF-RLS-0001') <> 0
  THEN RAISE EXCEPTION 'RLS performance_snapshots: foreign-division lead must NOT see the snapshot (O48 Grup D)'; END IF;
END $$;

-- 31. Grup D — STAF biasa membaca tabel config KPI. Ini menegakkan entri Decided
--     W3-M14-C1 ("BACA = semua aktor ber-scope") dan mencerminkan
--     `performance.canScope()`. Nol tanpa 20260730160000 — dan nol di sini
--     berarti halaman config tampil KOSONG bagi semua orang selain Director/OD.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-CRE9","division":"Creative","level":"staff"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM perf_kpi_weights   WHERE role_type='RLSROLE') <> 1
  OR (SELECT count(*) FROM perf_period_targets WHERE role_type='RLSROLE') <> 1
  THEN RAISE EXCEPTION 'RLS perf config: any scoped actor must READ weights/targets (O48 Grup D, Decided W3-M14-C1)'; END IF;
END $$;

-- 32. Grup D — pelebaran itu tetap FAIL-CLOSED: klaim kosong membaca NOL.
--     Kontrol negatif; kalau merah, `canScope` diterjemahkan jadi `true`.
SELECT set_config('request.jwt.claims', '{"app_metadata":{}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM perf_kpi_weights    WHERE role_type='RLSROLE') <> 0
  OR (SELECT count(*) FROM perf_period_targets WHERE role_type='RLSROLE') <> 0
  THEN RAISE EXCEPTION 'RLS perf config: empty claims must read NOTHING (O48 Grup D fail-closed)'; END IF;
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 33. Picker KARYAWAN untuk pintu penugasan (migrasi 20260805030000).
--     Seorang SPV/Head Account adalah SATU-SATUNYA role yang boleh menunjuk AM
--     (M6 §3 Rule 2), tapi ia BUKAN Director/OD — jadi `employees_select` hanya
--     membuka barisnya sendiri, dan `role_mappings` default-deny. Kedua sisinya
--     ditegakkan di sini: TABEL-nya tetap tertutup, TAPI
--     `private.employee_assignable()` menjawab. Kalau assertion pertama merah,
--     row-scope `employees` sudah dilebarkan diam-diam; kalau yang kedua merah,
--     SEMUA dropdown penugasan tampil KOSONG di produksi dan orang kembali
--     mengetik Employee ID dari hafalan — persis bug yang diperbaiki.
-- ---------------------------------------------------------------------------

-- Fixture (superuser): satu AM aktif, satu lead Account, satu AM nonaktif, dan
-- satu karyawan tanpa role mapping. Yang boleh ditawarkan HANYA yang aktif +
-- ter-mapping — sama dengan yang diterima `account.validateAMCandidate`.
INSERT INTO role_mappings (divisi, jabatan, division, level, created_by)
VALUES ('RLSDIV', 'RLSAM', 'Account', 'staff', 'EMP-RLS-DIR'),
       ('RLSDIV', 'RLSHEAD', 'Account', 'lead', 'EMP-RLS-DIR');
INSERT INTO employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
VALUES ('EMP-RLS-AM1', 'rls am aktif',    'rlsam1@mea.id',  'RLSDIV', 'RLSAM',   true,  'EMP-RLS-DIR'),
       ('EMP-RLS-AM2', 'rls am nonaktif', 'rlsam2@mea.id',  'RLSDIV', 'RLSAM',   false, 'EMP-RLS-DIR'),
       ('EMP-RLS-AH1', 'rls head account','rlsah1@mea.id',  'RLSDIV', 'RLSHEAD', true,  'EMP-RLS-DIR'),
       ('EMP-RLS-NOM', 'rls tanpa map',   'rlsnom@mea.id',  'RLSDIV', 'RLSNOMAP',true,  'EMP-RLS-DIR');

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-AH1","division":"Account","level":"lead"}}', true);
DO $$
DECLARE offered text[];
BEGIN
  -- Tabelnya: hanya baris sendiri (arm `employee_id = jwt_employee_id()`).
  IF (SELECT count(*) FROM employees WHERE employee_id LIKE 'EMP-RLS-A%') <> 1 THEN
    RAISE EXCEPTION 'RLS employees: Account lead must read ONLY their own row (got %)',
      (SELECT count(*) FROM employees WHERE employee_id LIKE 'EMP-RLS-A%');
  END IF;

  -- …dan yet picker-nya menjawab, dengan isi yang PERSIS = kandidat yang sah.
  SELECT coalesce(array_agg(employee_id ORDER BY employee_id), '{}'::text[]) INTO offered
    FROM private.employee_assignable()
   WHERE employee_id LIKE 'EMP-RLS-%' AND division = 'Account' AND level = 'staff';
  IF offered <> ARRAY['EMP-RLS-AM1'] THEN
    RAISE EXCEPTION 'employee_assignable: Account/staff harus tepat {EMP-RLS-AM1} (got %) — nonaktif & tanpa-mapping wajib absen', offered;
  END IF;
END $$;

-- Kontrol negatif: belum login tidak punya urusan dengan daftar karyawan.
RESET ROLE;
SET LOCAL ROLE anon;
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    PERFORM * FROM private.employee_assignable();
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'employee_assignable: EXECUTE must be denied to anon';
  END IF;
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 34. Antrean Intake Account (M6 §3 Rule 1, migrasi 20260805030100). Klien yang
--     SUDAH dirilis tapi BELUM punya AM tidak dimiliki siapa pun secara
--     perorangan, jadi tanpa arm divisi seorang SPV/Head Account membaca NOL
--     baris — antrean penunjukan AM kosong tanpa error, dan penunjukan AM tidak
--     bisa dilakukan lewat UI sama sekali. Empat arah diuji: lead Account LIHAT,
--     staff Account (bukan AM klien itu) TIDAK, divisi lain TIDAK, Director LIHAT.
-- ---------------------------------------------------------------------------

-- Klien BARU (bukan `CLI-RLS-0009` milik blok 14-17, yang sudah punya sales_pic
-- sendiri): dirilis ke Account dan SENGAJA tanpa AM — itulah bentuk baris yang
-- antrean intake baca, dan bentuk yang tidak dimiliki siapa pun secara perorangan.
INSERT INTO clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
                     total_sales, sales_pic_id, commission_payment_pic_id,
                     released_to_account_at, created_by)
VALUES ('CLI-RLS-0009', 'PIC rls', 'rls fixture intake', 'Bandung', 'link', 'Fashion', 0, 0, 0,
        'EMP-RLS-SLS9', 'EMP-RLS-SLS9', now(), 'EMP-RLS-SLS9');

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-AH1","division":"Account","level":"lead"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM clients WHERE id='CLI-RLS-0009') <> 1
  THEN RAISE EXCEPTION 'RLS clients: Account lead/SPV must SEE the released-unassigned client (M6 §3 Rule 1 intake queue)'; END IF;
END $$;

-- Kontrol negatif 1: AM staff yang bukan pemegang klien itu tetap tidak melihat
-- (M4 §6 "own clients"; `canReadIntake` juga menolak staff di app-layer).
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-AM1","division":"Account","level":"staff"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM clients WHERE id='CLI-RLS-0009') <> 0
  THEN RAISE EXCEPTION 'RLS clients: Account STAFF must NOT read a client they do not own'; END IF;
END $$;

-- Kontrol negatif 2: divisi eksekusi tidak membaca tabel klien lewat arm ini.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-CRE9","division":"Creative","level":"lead"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM clients WHERE id='CLI-RLS-0009') <> 0
  THEN RAISE EXCEPTION 'RLS clients: Creative lead must NOT read clients (arm is Account-only)'; END IF;
END $$;

-- Kontrol positif: Director (oversight) selalu melihat.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-DIR","director":true}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM clients WHERE id='CLI-RLS-0009') <> 1
  THEN RAISE EXCEPTION 'RLS clients: Director must read all'; END IF;
END $$;


RESET ROLE;

-- ---------------------------------------------------------------------------
-- 35. Log aktivitas prospek (`prospect_activities`, migrasi 20260806050000).
--     Predikatnya dibuat kembar `prospect_attempts_select`: siapa pun yang boleh
--     melihat attempt HARUS boleh melihat effort-nya, kalau tidak panel "Log
--     Aktivitas" kosong tanpa error — persis kelas cacat yang 20260805060000
--     tambal untuk rantai Account. Lima arah diuji: pemilik attempt LIHAT,
--     penulis LIHAT, lead sedivisi LIHAT, sales lain TIDAK, Director LIHAT.
-- ---------------------------------------------------------------------------

INSERT INTO leads (id, lead_name, phone_number, phone_norm, source, origin_division,
                   record_status, created_by)
VALUES ('LEAD-RLS-ACT1', 'rls fixture aktivitas', '08120000001', '8120000001', 'Scouting',
        'Sales', 'active', 'EMP-RLS-SLS9');
INSERT INTO prospect_attempts (id, lead_id, owner_employee_id, status, created_by)
VALUES ('PRSP-RLS-ACT1', 'LEAD-RLS-ACT1', 'EMP-RLS-SLS9', 'Qualified', 'EMP-RLS-SLS9');
INSERT INTO prospect_activities (id, attempt_id, lead_id, activity_type, occurred_at,
                                 summary, created_by)
VALUES ('ACT-RLS-0001', 'PRSP-RLS-ACT1', 'LEAD-RLS-ACT1', 'Visit', now(),
        'visit fixture rls', 'EMP-RLS-SLS9');

SET LOCAL ROLE authenticated;

-- Pemilik attempt (yang juga penulisnya) melihat effort-nya sendiri.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-SLS9","division":"Sales","level":"staff"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM prospect_activities WHERE id='ACT-RLS-0001') <> 1
  THEN RAISE EXCEPTION 'RLS prospect_activities: attempt owner must see own activity'; END IF;
END $$;

-- Head Sales membaca effort seluruh divisinya — justru alasan fitur ini diminta.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-SLD9","division":"Sales","level":"lead"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM prospect_activities WHERE id='ACT-RLS-0001') <> 1
  THEN RAISE EXCEPTION 'RLS prospect_activities: Sales lead must read division effort'; END IF;
END $$;

-- Kontrol negatif 1: sales lain (bukan pemilik attempt, bukan penulis) tidak.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-SLS8","division":"Sales","level":"staff"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM prospect_activities WHERE id='ACT-RLS-0001') <> 0
  THEN RAISE EXCEPTION 'RLS prospect_activities: another salesperson must NOT read it'; END IF;
END $$;

-- Kontrol negatif 2: lead divisi lain tidak — arm divisi memakai origin lead-nya.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-CRE9","division":"Creative","level":"lead"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM prospect_activities WHERE id='ACT-RLS-0001') <> 0
  THEN RAISE EXCEPTION 'RLS prospect_activities: a lead of another division must NOT read it'; END IF;
END $$;

-- Kontrol positif: Director (oversight) selalu melihat.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-DIR","director":true}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM prospect_activities WHERE id='ACT-RLS-0001') <> 1
  THEN RAISE EXCEPTION 'RLS prospect_activities: Director must read all'; END IF;
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- O57 — `contracts` + `strategi` scoped through `private.jwt_is_am_of_contract`.
--
-- The Strategi row-scope moved from Service to Contract in 20260807120000. The
-- predicate is supposed to be UNCHANGED — the owning AM of the client — with
-- only the entry point different, and this is what proves it, because "the
-- policy compiles" and "the policy still scopes" are different claims. The one
-- that would have gone unnoticed: `jwt_is_am_of_contract` returning false for
-- everyone, which reads as a locked page rather than an error.
-- ---------------------------------------------------------------------------

INSERT INTO clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
                     total_sales, sales_pic_id, commission_payment_pic_id, assigned_am_id,
                     payment_intent, created_by)
VALUES ('CLI-RLS-CTR1', 'Rani', 'RLS Contract Fixture', 'Bandung', 'https://shopee/rlsctr',
        'Home Living', 0, 0, 0, 'EMP-RLS-SLS9', 'EMP-RLS-SLS9', 'EMP-RLS-AM1',
        '[Termin]', 'EMP-RLS-AM1');
INSERT INTO contracts (id, client_id, durasi_bulan, tanggal_mulai, tanggal_akhir, created_by)
VALUES ('CTR-RLS-0001', 'CLI-RLS-CTR1', 6, DATE '2026-08-12', DATE '2027-02-11', 'EMP-RLS-AM1');
INSERT INTO strategi (id, contract_id, client_id, versi_no, status, created_by)
VALUES ('STRG-RLS-0001', 'CTR-RLS-0001', 'CLI-RLS-CTR1', 1, 'Draft', 'EMP-RLS-AM1');

SET LOCAL ROLE authenticated;

-- The owning AM reads both the agreement and the Strategi hanging off it.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-AM1","division":"Account","level":"staff"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM contracts WHERE id='CTR-RLS-0001') <> 1
  THEN RAISE EXCEPTION 'RLS contracts: owning AM must see the agreement'; END IF;
  IF (SELECT count(*) FROM strategi WHERE id='STRG-RLS-0001') <> 1
  THEN RAISE EXCEPTION 'RLS strategi: owning AM must see the Strategi via jwt_is_am_of_contract'; END IF;
END $$;

-- Negative control: another Account staff member, who owns a different client.
-- If `jwt_is_am_of_contract` were written as `true` this is the check that fails.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-AM2","division":"Account","level":"staff"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM contracts WHERE id='CTR-RLS-0001') <> 0
  THEN RAISE EXCEPTION 'RLS contracts: an unrelated AM must NOT see the agreement'; END IF;
  IF (SELECT count(*) FROM strategi WHERE id='STRG-RLS-0001') <> 0
  THEN RAISE EXCEPTION 'RLS strategi: an unrelated AM must NOT see the Strategi'; END IF;
END $$;

-- Negative control 2: a lead of an execution division. Section E/F reach into
-- `strategi_pillar` / `strategi_resource` for their own pillar (§7), but the
-- header itself is not theirs.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-CRE9","division":"Creative","level":"lead"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM strategi WHERE id='STRG-RLS-0001') <> 0
  THEN RAISE EXCEPTION 'RLS strategi: a Creative lead must NOT read the Strategi header'; END IF;
END $$;

-- Positive control: the Account lead (division-wide) and the Director.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-ACL9","division":"Account","level":"lead"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM strategi WHERE id='STRG-RLS-0001') <> 1
  THEN RAISE EXCEPTION 'RLS strategi: the Account lead must read division-wide'; END IF;
END $$;

SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-DIR","director":true}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM contracts WHERE id='CTR-RLS-0001') <> 1
  THEN RAISE EXCEPTION 'RLS contracts: Director must read all'; END IF;
END $$;

RESET ROLE;
-- ---------------------------------------------------------------------------
-- 40-41. O51 + O52 — dua instans dari SATU kelas cacat: sebuah jalur BACA
--        menabrak tabel yang sengaja tertutup (atau yang policy-nya tidak punya
--        arm untuk aktor itu), lalu gagal dengan gejala yang TIDAK terlihat
--        seperti izin: 500 opaque (O51) dan 404 "tidak ada" (O52).
--
--        Keduanya diperbaiki dengan pola yang sama seperti `sm_edges`
--        (20260803123327): tabelnya tetap tertutup, yang dibuka hanya
--        JAWABANNYA lewat SECURITY DEFINER di schema `private`.
--
--        Check 9 di atas kini ikut meng-assert `role_mappings` tertutup — itu
--        yang HILANG saat O51 lolos: invariannya hanya menyebut 4 tabel, jadi
--        tidak ada yang bisa merah karena temuan itu.
-- ---------------------------------------------------------------------------

-- Fixture (superuser). Klien blok 14 belum punya AM; O52 justru tentang kolom
-- itu, jadi ia diberikan di sini — sesudah seluruh check finance/account
-- berjalan, sehingga tidak ada check lain yang berubah artinya.
UPDATE clients SET assigned_am_id = 'EMP-RLS-AM52' WHERE id = 'CLI-RLS-0001';

SET LOCAL ROLE authenticated;

-- 40. O51 — `private.employee_role` bisa dipanggil `authenticated` DAN
--     mengembalikan pemetaan yang benar. Dua-duanya di-assert: fungsi yang
--     mengembalikan nol baris diam-diam akan membuat `/portal` menjawab 404
--     alih-alih 500 — tetap salah, tapi lebih sulit dilihat.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-CRE1","division":"Creative","level":"staff"}}', true);
DO $$
DECLARE d text; l text;
BEGIN
  SELECT division, level INTO d, l FROM private.employee_role('EMP-RLS-CRE1');
  IF d IS DISTINCT FROM 'Creative' OR l IS DISTINCT FROM 'staff' THEN
    RAISE EXCEPTION 'private.employee_role must resolve EMP-RLS-CRE1 to Creative/staff (got %/%)', d, l;
  END IF;
  -- Karyawan tanpa mapping ⇒ NOL BARIS, bukan ('',''). `staffRoleType`
  -- memetakan nol baris ke null ⇒ NotFoundError; baris kosong akan membuat
  -- `roleTypeFor` memutuskan atas divisi kosong.
  IF EXISTS (SELECT 1 FROM private.employee_role('EMP-TIDAK-ADA')) THEN
    RAISE EXCEPTION 'private.employee_role must return zero rows for an unknown employee';
  END IF;
END $$;

-- 41. O52 — lead Creative membaca Brief divisinya BESERTA AM pemiliknya, tanpa
--     bisa membaca `services` maupun `clients`. Premisnya di-assert lebih dulu:
--     kalau salah satu dari kedua tabel itu suatu hari terbuka untuk divisi
--     eksekusi, check ini kehilangan daya bedanya dan harus diketahui.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-CRELEAD","division":"Creative","level":"lead"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM services WHERE id='SVC-RLS-0001') <> 0
  OR (SELECT count(*) FROM clients  WHERE id='CLI-RLS-0001') <> 0
  THEN RAISE EXCEPTION 'premis check 41 rusak: divisi eksekusi TIDAK boleh membaca services/clients (kalau bisa, O52 sudah jadi keputusan (a) tanpa entri Decided)'; END IF;

  -- Barisnya sendiri memang selamat — `briefs` punya arm divisi. Inilah yang
  -- membuat 404-nya membingungkan: yang hilang cuma hasil JOIN-nya.
  IF (SELECT count(*) FROM briefs WHERE id='BRF-RLS-0001') <> 1
  THEN RAISE EXCEPTION 'RLS briefs: Creative lead must read own-division brief'; END IF;

  IF private.brief_owner_am('BRF-RLS-0001') IS DISTINCT FROM 'EMP-RLS-AM52'
  THEN RAISE EXCEPTION 'private.brief_owner_am must return the owning AM for the execution division (O52)'; END IF;

  IF private.service_owner_am('SVC-RLS-0001') IS DISTINCT FROM 'EMP-RLS-AM52'
  THEN RAISE EXCEPTION 'private.service_owner_am must return the owning AM for the execution division (O52)'; END IF;

  -- Entitas tak dikenal ⇒ NULL, bukan error: pemanggil membedakan
  -- "tidak ditemukan" lewat keberadaan baris induknya, bukan lewat exception.
  IF private.brief_owner_am('BRF-TIDAK-ADA') IS NOT NULL
  THEN RAISE EXCEPTION 'private.brief_owner_am must be NULL for an unknown brief'; END IF;
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 42. O48 — LEDGER policy SELECT yang BELUM punya arm lead/divisi.
--
--     Keputusan pemilik 2026-08-07: pilihan **(b)** — perbaiki per tabel sesuai
--     kebutuhan halaman, bukan menyapu semuanya dalam satu migrasi. Yang
--     membuat (b) aman adalah daftar ini: tanpa ledger, "per tabel sesuai
--     kebutuhan" berarti setiap halaman baru berpotensi menemukan ulang cacat
--     yang sama, dan itulah yang terjadi pada O46 (ia menyebut 3 arm; survei
--     kemudian menemukan 36 — angkanya bukan hasil hitungan).
--
--     ATURAN: daftar ini hanya boleh MENYUSUT. Menghapus satu baris = sebuah
--     migrasi memberi tabel itu arm lead/divisi (bagus, catat di DECISIONS).
--     MENAMBAH baris = sebuah tabel baru lahir tanpa arm, dan itu keputusan
--     visibility yang butuh entri Decided — bukan sesuatu yang boleh mendarat
--     karena tesnya diperbarui agar cocok.
--
--     Deteksinya sintaktik (`jwt_is_lead`/`jwt_division` di predikat), sama
--     seperti survei O48. Itu bisa memberi false-negative kalau seseorang
--     menulis arm divisi tanpa memakai kedua helper — dan itu justru alasan
--     tambahan untuk memakai helper yang ada.
--
--     Sebagian besar isi daftar ini adalah TABEL ANAK yang visibilitasnya
--     mengalir dari induknya lewat `jwt_owns_*`/`EXISTS`. Mereka BUKAN 39 gap
--     independen — memperbaiki induknya memperbaiki mereka. Daftar ini
--     mengukur permukaan, bukan jumlah bug.
--
--     ⚠️ **Sebelas baris `strategi_*` di bawah adalah FALSE-NEGATIVE yang sudah
--     diverifikasi, bukan gap.** Predikatnya `private.jwt_can_read_strategi()`,
--     dan badan fungsi itu adalah cermin persis `strategi_select` — TERMASUK
--     arm `jwt_is_lead() AND jwt_division() = 'Account'`. Jadi arm-nya ADA; ia
--     hanya satu tingkat di balik SECURITY DEFINER, yang tidak bisa dilihat
--     detektor sintaktik di atas (persis false-negative yang paragraf
--     sebelumnya sudah antisipasi). Lima di antaranya ditambahkan oleh A-09b
--     (DECISIONS 2026-08-08 "A-09b — lima tabel anak Strategi masuk ledger
--     O48") dan satu oleh A-10 bagian 2 (DECISIONS 2026-08-09
--     "strategi_field_visibility masuk ledger O48"); mereka mengikuti kelas
--     siblingnya, bukan membuka kelas baru.
--     Empat baris `plan_*` (target/actual/review/flag) adalah kelas yang SAMA:
--     predikatnya `private.jwt_can_read_plan()`, cermin persis `plan_select` —
--     termasuk arm `jwt_is_lead() AND jwt_division() = 'Account'` (DECISIONS
--     2026-08-10 "B-01 — empat tabel anak Plan masuk ledger O48"). `plan_row`
--     TIDAK di sini: policy-nya membawa arm divisi PIC-nya sendiri, dan
--     `plan_row_week` mewarisinya lewat EXISTS, jadi keduanya lolos detektor.
--     O60 (jika dikerjakan) akan menghapus keempatnya bersama kesebelas
--     `strategi_*` sekaligus.
--     Empat baris `wrr_*` (divisi/metrik/catatan/catatan_divisi) adalah kelas
--     yang SAMA: predikatnya `private.jwt_can_read_recap()`, cermin persis
--     `weekly_result_recap_select` — termasuk arm `jwt_is_lead() AND
--     jwt_division() = 'Account'` (DECISIONS 2026-08-13 "M6D D-01 — empat tabel
--     anak Rekap Mingguan masuk ledger O48"). Induk `weekly_result_recap_select`
--     membawa arm-nya inline jadi TIDAK di sini. Lead DIVISI (non-Account)
--     sengaja belum punya arm di D-01 — baca rekap divisi menyusul bersama jalur
--     tulis RM-D6 (D-09), tak dilebarkan spekulatif (O48).
--     Membuat detektor menembus satu tingkat indireksi akan MENGHAPUS
--     kesebelasnya sekaligus — diusulkan sebagai **O60**, sengaja tidak
--     dikerjakan di dalam tiket fitur: mengubah semantik invariant bersama
--     supaya tiket sendiri hijau adalah cara paling mudah kehilangan gerbang.
-- ---------------------------------------------------------------------------
RESET ROLE;
DO $$
DECLARE
  actual text[];
  expected text[] := ARRAY[
    'ad_campaign_assets_select','ad_campaigns_select','campaigns_select',
    'client_platforms_select','client_sales_allocations_select','complaints_select',
    'creator_bookings_select','creator_lists_select','creator_payment_requests_select',
    'dependencies_select','employees_select','live_stream_sessions_select',
    'marketing_performance_records_select','master_service_versions_select',
    'master_services_select','metric_entries_select','metric_entry_assets_select',
    'negotiation_proposal_lines_select','negotiation_proposals_select','notifications_select',
    'optimization_logs_select','plan_actual_select','plan_flag_select',
    'plan_gate_config_select','plan_review_select','plan_target_select',
    'prospect_attempt_nq_reasons_select',
    'prospect_attempts_select','qualified_form_services_select','qualified_forms_select',
    'strategi_akses_select','strategi_assumption_select','strategi_baseline_bulan_select',
    'strategi_channel_select','strategi_diagnosa_select','strategi_dispatch_select',
    'strategi_fase_select','strategi_field_visibility_select',
    'strategi_ketergantungan_klien_select',
    'strategi_prasyarat_klien_select','strategi_quick_win_select',
    'strategi_risiko_struktural_select','strategi_risk_select',
    'strategi_tanggal_besar_select','strategi_target_select',
    'strategi_trigger_revisi_select','strategi_version_select','vendors_select',
    'wrr_catatan_divisi_select','wrr_catatan_select','wrr_divisi_select','wrr_metrik_select'
  ];
  gained text[];
  lost   text[];
BEGIN
  SELECT coalesce(array_agg(p.polname ORDER BY p.polname), '{}')
    INTO actual
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND p.polcmd IN ('r','*')
     AND coalesce(pg_get_expr(p.polqual, p.polrelid), '') !~ 'jwt_is_lead|jwt_division';

  SELECT coalesce(array_agg(x ORDER BY x), '{}') INTO gained
    FROM unnest(actual) x WHERE x <> ALL (expected);
  SELECT coalesce(array_agg(x ORDER BY x), '{}') INTO lost
    FROM unnest(expected) x WHERE x <> ALL (actual);

  IF cardinality(gained) > 0 THEN
    RAISE EXCEPTION 'O48 ledger GREW: % has no lead/division arm. A new table without one is a visibility decision — write a DECISIONS entry, do not extend this list to make the test pass.', gained;
  END IF;
  IF cardinality(lost) > 0 THEN
    RAISE EXCEPTION 'O48 ledger SHRANK (good) — % now has a lead/division arm. Remove it from `expected` in this check, in the same commit as the migration.', lost;
  END IF;
END $$;

ROLLBACK;

\echo 'rls_checks: PASS'
