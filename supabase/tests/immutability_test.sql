-- pgTAP: append-only immutability (§B.3, CLAUDE.md #3).
--
-- Proves AT THE DB LEVEL that history cannot be mutated: the forbid_mutation()
-- BEFORE UPDATE/DELETE triggers fire on the four append-only tables. This is the
-- Postgres port of the MySQL SIGNAL SQLSTATE '45000' guards the Go engine relied on
-- — "invalid mutation blocked server-side", not merely "our code never issues it".
--
-- NOTE: a BEFORE trigger only fires when a row actually matches, so every case
-- seeds a real row first (a WHERE that matches nothing would pass vacuously).
-- The single allowed mutation on a history table — notifications.read_at (mark
-- read) — is asserted to succeed.
--
-- Fase 1 will add the second defense layer (REVOKE UPDATE/DELETE from
-- authenticated/anon) and its own pgTAP asserting the same under the authenticated
-- role; this file covers the trigger layer that also binds service_role.

begin;
create extension if not exists pgtap;
select plan(8);

-- Seed one row per append-only table (with the minimal parents their FKs need).
insert into employees (employee_id, nama, email, divisi, jabatan)
  values ('EMP-IMMUT', 'Immut', 'immut@mea.co.id', 'Account', 'AM');
insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, sales_pic_id, commission_payment_pic_id, created_by)
  values ('CLI-IMMUT', 'PIC', 'Toko', 'Kota', 'http://x', 'Fashion', 0, 0, 'EMP-IMMUT', 'EMP-IMMUT', 'EMP-IMMUT');
insert into audit_log (entity_type, entity_id, actor_employee_id, action, created_by)
  values ('sm_probe', 'IMMUT-1', 'EMP-IMMUT', 'seed', 'EMP-IMMUT');
insert into notifications (recipient_employee_id, event_type, entity_type, entity_id, actor_employee_id, deep_link, created_by)
  values ('EMP-IMMUT', 'm12.block_request.submitted', 'demo_task', 'IMMUT-1', 'EMP-IMMUT', '/x', 'EMP-IMMUT');
insert into client_health_snapshots (id, client_id, period_start, period_end, band, roas_toggle_state, components_json, computed_by)
  values ('CHS-IMMUT', 'CLI-IMMUT', '2026-07-01', '2026-07-31', 'Watch', true, '{}', 'SYSTEM');
insert into performance_snapshots (id, staff_id, role_type, period_start, period_end, components_json, computed_by)
  values ('PS-IMMUT', 'EMP-IMMUT', 'account', '2026-07-01', '2026-07-31', '{}', 'SYSTEM');

-- audit_log: no UPDATE, no DELETE.
select throws_ok(
  $$ UPDATE audit_log SET action = 'hacked' WHERE entity_id = 'IMMUT-1' $$,
  'P0001', 'audit_log is append-only/immutable: UPDATE forbidden',
  'audit_log UPDATE is blocked');
select throws_ok(
  $$ DELETE FROM audit_log WHERE entity_id = 'IMMUT-1' $$,
  'P0001', 'audit_log is append-only/immutable: DELETE forbidden',
  'audit_log DELETE is blocked');

-- notifications: no DELETE ever; UPDATE of read_at (mark read) IS allowed.
select throws_ok(
  $$ DELETE FROM notifications WHERE entity_id = 'IMMUT-1' $$,
  'P0001', 'notifications is append-only/immutable: DELETE forbidden',
  'notifications DELETE is blocked');
select lives_ok(
  $$ UPDATE notifications SET read_at = now() WHERE entity_id = 'IMMUT-1' $$,
  'notifications mark-read (read_at UPDATE) is allowed');

-- client_health_snapshots: no UPDATE, no DELETE.
select throws_ok(
  $$ UPDATE client_health_snapshots SET band = 'Healthy' WHERE id = 'CHS-IMMUT' $$,
  'P0001', 'client_health_snapshots is append-only/immutable: UPDATE forbidden',
  'client_health_snapshots UPDATE is blocked');
select throws_ok(
  $$ DELETE FROM client_health_snapshots WHERE id = 'CHS-IMMUT' $$,
  'P0001', 'client_health_snapshots is append-only/immutable: DELETE forbidden',
  'client_health_snapshots DELETE is blocked');

-- performance_snapshots: no UPDATE, no DELETE.
select throws_ok(
  $$ UPDATE performance_snapshots SET final_score = 1 WHERE id = 'PS-IMMUT' $$,
  'P0001', 'performance_snapshots is append-only/immutable: UPDATE forbidden',
  'performance_snapshots UPDATE is blocked');
select throws_ok(
  $$ DELETE FROM performance_snapshots WHERE id = 'PS-IMMUT' $$,
  'P0001', 'performance_snapshots is append-only/immutable: DELETE forbidden',
  'performance_snapshots DELETE is blocked');

select * from finish();
rollback;
