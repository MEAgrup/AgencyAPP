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
  FOREACH t IN ARRAY ARRAY['sessions','employee_credentials','id_sequences','sm_edges'] LOOP
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
--     (SECURITY DEFINER, migration 20260803120000). Both halves are asserted
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

-- 25. 🔴 CHECK PEMBEDA — inilah yang membuktikan helper WAJIB SECURITY DEFINER.
--     Lead Creative melihat block request ASSET-nya, PADAHAL ia tidak bisa
--     melihat baris `assets` itu sendiri (`assets_select` belum punya arm lead —
--     O48 Grup B, sengaja di luar cakupan). Kalau seseorang mengganti
--     `private.jwt_division_owns_asset` dengan `EXISTS (SELECT 1 FROM assets …)`
--     inline, subquery-nya ikut disaring RLS, hasilnya false, dan check ini
--     MERAH — yaitu tepat kelas cacat O46 yang tertangkap sebelum di-apply.
DO $$ BEGIN
  IF (SELECT count(*) FROM assets WHERE id='AST-RLS-0001') <> 0
  THEN RAISE EXCEPTION 'RLS premis check 25 rusak: lead Creative TIDAK boleh melihat assets row (kalau ia bisa, check 25 kehilangan daya bedanya)'; END IF;
  IF (SELECT count(*) FROM asset_block_requests WHERE id='ABR-RLS-0001') <> 1
  THEN RAISE EXCEPTION 'RLS asset_block_requests: Creative LEAD must see the queue even though assets row is invisible (O48 Grup C — helper must be SECURITY DEFINER)'; END IF;
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
ROLLBACK;

\echo 'rls_checks: PASS'
