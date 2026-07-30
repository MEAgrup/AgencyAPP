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

-- Fixture (superuser): karyawan riil untuk resolusi divisi. EMP-RLS-SLS1 adalah
-- sales_pic klien CLI-RLS-0001 yang dibuat blok 14-17 di atas.
INSERT INTO employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by) VALUES
  ('EMP-RLS-SLS1',    'rls sales staff',   'rls.sls1@example.test',    'Sales',    'Sales Jasa',    true, 'SYSTEM'),
  ('EMP-RLS-SLSLEAD', 'rls sales lead',    'rls.slslead@example.test', 'Sales',    'Head of Sales', true, 'SYSTEM'),
  ('EMP-RLS-CRELEAD', 'rls creative lead', 'rls.crelead@example.test', 'Creative', 'Lead Creative', true, 'SYSTEM');

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
ROLLBACK;

\echo 'rls_checks: PASS'
