-- pgTAP: foundation functions — WIB bucketing (O20) + ident_next generator (§B.1).
--
-- Verifies AT THE DB LEVEL (not just "our code calls it right") the properties the
-- Go engine relied on: wib_date/wib_period are fixed-offset +7h (no DST), and
-- ident_next issues PREFIX-YYYYMM-NNNN gap-free, incrementing, WIB-bucketed, and
-- rollback-safe. Mirrors backend/internal/core/{tz,ident}/*_test.go against Postgres.
--
-- Run by `supabase test db`. The whole file runs in one transaction and rolls back,
-- so the id_sequences rows consumed here do not leak into the local db.

begin;
create extension if not exists pgtap;
select plan(8);

-- WIB fixed-offset +7h, no DST (DECISIONS O20).
select is(
  wib_period('2026-06-30T17:30:00Z'::timestamptz), '202607'::char(6),
  'wib_period: 17:30Z (00:30 WIB next day) buckets to July 202607');
select is(
  wib_period('2026-06-30T16:00:00Z'::timestamptz), '202606'::char(6),
  'wib_period: 16:00Z (23:00 WIB) still June 202606');
select is(
  wib_date('2026-07-16T18:30:00Z'::timestamptz), '2026-07-17'::date,
  'wib_date: 18:30Z (01:30 WIB next day) is the 17 Jul civil date');

-- ident_next: format, increment, WIB month boundary.
select is(
  ident_next('TST','2026-07-01T00:00:00Z'::timestamptz), 'TST-202607-0001',
  'ident_next: first id for a new (prefix, period) is 0001');
select is(
  ident_next('TST','2026-07-01T00:00:00Z'::timestamptz), 'TST-202607-0002',
  'ident_next: same (prefix, period) increments to 0002');
select is(
  ident_next('BND','2026-06-30T17:30:00Z'::timestamptz), 'BND-202607-0001',
  'ident_next: month bucket is WIB (17:30Z -> 202607, not 202606)');
select matches(
  ident_next('FMT','2026-07-01T00:00:00Z'::timestamptz), '^FMT-\d{6}-\d{4}$',
  'ident_next: id matches PREFIX-YYYYMM-NNNN');

-- Rollback-safety: a rolled-back allocation consumes no sequence (the number is
-- reissued to the next committer). ON CONFLICT ... RETURNING locks the counter row
-- so this holds under concurrency too (proven by construction, §B.1).
select ident_next('ROLL','2026-07-01T00:00:00Z'::timestamptz);   -- 0001 (kept)
savepoint before_rollback;
select ident_next('ROLL','2026-07-01T00:00:00Z'::timestamptz);   -- 0002 (to be undone)
rollback to savepoint before_rollback;
select is(
  ident_next('ROLL','2026-07-01T00:00:00Z'::timestamptz), 'ROLL-202607-0002',
  'ident_next: rolled-back allocation is reissued (no gap)');

select * from finish();
rollback;
