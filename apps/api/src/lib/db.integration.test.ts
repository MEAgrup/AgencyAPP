/**
 * Integration test for the O37 read discipline: `readAs(actor, …)` must run the
 * query under RLS as the actor, so a user only sees rows their role scope allows
 * (packages/core/src/permission.ts, encoded as SQL policies in
 * 20260102000003_rls_baseline.sql). Skipped unless DATABASE_URL is set.
 *
 * Recipe (matches the session's local Postgres): apply supabase/migrations/* in
 * order (+ optional seed), then `DATABASE_URL=… npm test -w @cdps/api`. The DB
 * login role must be able to `SET ROLE authenticated` (Supabase's pooler role and
 * a local superuser both can — verified on CDPS SG).
 *
 * Uses the demo_tasks policy (own-row / division-lead / read-all) — the same
 * fixture shape as supabase/tests/rls_checks.sql, but exercised through the
 * apps/api `readAs` wrapper rather than raw SQL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { db, readAs } from './db';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

const OWNER = 'EMP-RLSAPI-OWNER';
const TASK_ID = 'RLSAPI-TEST-0001';

const actor = (employeeId: string, role: Partial<permission.Role> = {}): permission.Actor => ({
  employeeId,
  role: { division: 'Sales', level: 'staff', od: false, director: false, ...role },
});

const visibleCount = (a: permission.Actor): Promise<number> =>
  readAs(a, async (tx) => {
    const rows = await tx<{ id: string }[]>`select id from demo_tasks where id = ${TASK_ID}`;
    return rows.length;
  });

describeDb('readAs — RLS row scope (integration)', () => {
  beforeAll(async () => {
    // Insert as the service-role connection (RLS bypassed) so the fixture exists
    // regardless of scope; readAs below re-reads it under `authenticated`.
    await db()`
      insert into demo_tasks (id, title, division, status, created_at, created_by)
      values (${TASK_ID}, 'rls api fixture', 'Sales', 'To Do', now(), ${OWNER})
      on conflict (id) do nothing`;
  });

  afterAll(async () => {
    await db()`delete from demo_tasks where id = ${TASK_ID}`;
    await db().end();
  });

  it('owner staff sees their own row', async () => {
    expect(await visibleCount(actor(OWNER, { division: 'Sales', level: 'staff' }))).toBe(1);
  });

  it('an unrelated staff (other division, not owner) sees nothing', async () => {
    expect(await visibleCount(actor('EMP-STRANGER', { division: 'Ops', level: 'staff' }))).toBe(0);
  });

  it('a same-division lead sees the division row', async () => {
    expect(await visibleCount(actor('EMP-LEAD', { division: 'Sales', level: 'lead' }))).toBe(1);
  });

  it('a Director (read-all) sees it across scope', async () => {
    expect(await visibleCount(actor('EMP-DIR', { division: '', level: '', director: true }))).toBe(1);
  });

  it('an OD (read-all) sees it across scope', async () => {
    expect(await visibleCount(actor('EMP-OD', { division: '', level: '', od: true }))).toBe(1);
  });
});
