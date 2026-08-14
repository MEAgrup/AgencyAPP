/**
 * P-1 regression guard — the aggregation reads must stay SET-BASED.
 *
 * The point of P-1 was not "make it a bit faster", it was to remove the N+1
 * shape: one extra round-trip per row. A wall-clock assertion would be flaky and
 * would pass on a fast local socket even if the N+1 came back, so these tests
 * assert the thing that actually matters and is deterministic:
 *
 *   the number of QUERIES a read issues must NOT grow with the number of ROWS.
 *
 * Each case computes the same read over a small fixture and over a 4× larger one
 * and requires an identical query count. Any future `for (… of rows) { await
 * sql… }` reintroduced into these paths fails here immediately.
 *
 * The companion assertions check that batching did not change the ARITHMETIC:
 * the component values for a hand-computed fixture are pinned, and the batched
 * transition loader is compared row-for-row against a per-entity read.
 *
 * Skipped unless DATABASE_URL is set (same convention as the other integration
 * suites). Fixtures use the shared 'ZZ-' prefix so afterEach can clear them.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  COMP_OUTPUT_QUANTITY,
  COMP_REVISION_COUNT,
  COMP_SPEED_SCORE,
  previewCurrent,
  type Actor,
  type Component,
} from './performance';
import { loadTransitions, transitionsOf } from './transitions';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
/** A second client wired with postgres.js' debug hook so queries can be counted. */
let counted: Sql;
let queries = 0;
const seenQueries: string[] = [];

if (URL) {
  sql = createClient(URL);
  counted = postgres(URL, {
    prepare: false,
    debug: (_c, q) => {
      // postgres.js issues a one-off pg_catalog type-OID lookup the first time a
      // connection is used. That is driver bootstrap, not part of the read under
      // test, and counting it would make the first measurement differ from the
      // second for reasons that have nothing to do with N+1.
      if (q.includes('pg_catalog')) {
        return;
      }
      queries++;
      seenQueries.push(q.replace(/\s+/g, ' ').trim().slice(0, 90));
    },
  });
}

/**
 * countQueries runs fn and reports how many statements it put on the wire, plus
 * their (truncated) texts — a failing count is only actionable if you can see
 * WHICH query multiplied.
 */
async function countQueries<T>(
  fn: (q: Sql) => Promise<T>,
): Promise<{ result: T; queries: number; texts: string[] }> {
  queries = 0;
  seenQueries.length = 0;
  const result = await fn(counted);
  return { result, queries, texts: [...seenQueries] };
}

// Fixed clock: WIB 2026-06-17 — previewCurrent scores the CURRENT (still open)
// month, so the fixtures' June transitions are the ones in scope.
const nowJun = new Date('2026-06-17T05:00:00Z');
const director: Actor = {
  employeeId: 'ZZ-N1-DIR',
  divisi: 'Management',
  role: permission.makeRole({ director: true }),
};

let seq = 0;
const uid = (p: string): string => `${p}-ZZN1-${Date.now() % 100000}-${seq++}`;

async function insEmployee(id: string, divisi: string, jabatan: string): Promise<void> {
  await sql`insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${id}, ${id}, ${id + '@mea.id'}, ${divisi}, ${jabatan}, true, 'ZZ-N1') on conflict (employee_id) do nothing`;
}
async function insRoleMapping(divisi: string, jabatan: string, division: string, level: string): Promise<void> {
  await sql`insert into role_mappings (divisi, jabatan, division, level, created_by)
    values (${divisi}, ${jabatan}, ${division}, ${level}, 'ZZ-N1') on conflict (divisi, jabatan) do nothing`;
}
async function insClient(id: string, amId: string): Promise<void> {
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
    values (${id}, 'PIC', ${id}, 'Bandung', 'link', 'Fashion', '0.00', '0.00', '0.00',
      'ZZ-N1-SALES', 'ZZ-N1-SALES', now(), ${amId}, 'ZZ-N1')`;
}
async function insService(id: string, clientId: string): Promise<void> {
  await sql`
    insert into services (id, client_id, master_service_id, master_version_no, name,
      standard_price, commission_rule, status, requires_strategy_plan, created_by)
    values (${id}, ${clientId}, 'MSV-X', 1, 'Full Mgmt', '10000000.00', 'rule', '[In Execution]', false, 'ZZ-N1')`;
}
async function insBrief(id: string, svcId: string, division: string, pic: string): Promise<void> {
  await sql`insert into briefs (id, service_id, title, status, assigned_division, assigned_pic, sla_target_hours, created_by)
    values (${id}, ${svcId}, 'B', '[Approved]', ${division}, ${pic}, 10, 'ZZ-N1')`;
}
async function insAudit(entityType: string, entityId: string, action: string, at: Date): Promise<void> {
  await sql`insert into audit_log (entity_type, entity_id, actor_employee_id, action, created_by, created_at)
    values (${entityType}, ${entityId}, 'system', ${action}, 'system', ${at})`;
}

/**
 * insAsset creates one Creative Asset assigned to `pic`, approved in June after
 * `turnaroundH` hours against a 10h SLA, having gone through `revisions` revision
 * rounds. Everything the score reads is written to the immutable log.
 */
async function insAsset(briefId: string, pic: string, turnaroundH: number, revisions: number): Promise<string> {
  const id = uid('AST');
  await sql`insert into assets (id, brief_id, asset_type, sequence_no, assigned_pic, status,
      sla_target_hours, attributed_gmv, created_by)
    values (${id}, ${briefId}, 'Video', ${(seq % 900) + 1}, ${pic}, '[Approved]', 10, '0.00', 'ZZ-N1')`;
  const start = new Date('2026-06-10T00:00:00Z');
  await insAudit('asset', id, 'transition:[To Do]->[In Progress]', start);
  for (let r = 0; r < revisions; r++) {
    await insAudit('asset', id, 'transition:[In Review]->[Revision Requested]', new Date(start.getTime() + (r + 1) * 60_000));
  }
  await insAudit('asset', id, 'transition:[In Review]->[Approved]', new Date(start.getTime() + turnaroundH * 3_600_000));
  return id;
}

/** A Creative staff member owning `n` identical in-SLA, zero-revision Assets. */
async function creativeFixture(n: number): Promise<string> {
  const staff = uid('EMP-CRE');
  const client = uid('CLI-N1');
  const svc = uid('SVC-N1');
  const brief = uid('BRF-N1');
  await insEmployee(staff, 'Creative', 'ZZ-N1-Designer');
  await insRoleMapping('Creative', 'ZZ-N1-Designer', 'Creative', 'staff');
  await insEmployee('ZZ-N1-AM', 'Account', 'ZZ-N1-AM-Jab');
  await insClient(client, 'ZZ-N1-AM');
  await insService(svc, client);
  await insBrief(brief, svc, 'Creative', staff);
  for (let i = 0; i < n; i++) {
    await insAsset(brief, staff, 5, 0);
  }
  return staff;
}

/** whichQueryGrew renders both query lists so a failure names the culprit. */
function whichQueryGrew(small: string[], big: string[]): string {
  return `query counts diverged — small fixture:\n  ${small.join('\n  ')}\nlarge fixture:\n  ${big.join('\n  ')}`;
}

const comp = (comps: Component[], name: string): Component | undefined => comps.find((c) => c.name === name);

afterAll(async () => {
  if (sql) await sql.end();
  if (counted) await counted.end();
});

afterEach(async () => {
  if (!sql) return;
  await sql`delete from assets where created_by = 'ZZ-N1'`;
  await sql`delete from briefs where created_by = 'ZZ-N1'`;
  await sql`delete from services where created_by = 'ZZ-N1'`;
  await sql`delete from clients where created_by = 'ZZ-N1'`;
  await sql`delete from employees where created_by = 'ZZ-N1'`;
  await sql`delete from role_mappings where created_by = 'ZZ-N1'`;
});

describeDb('P-1 — reads stay set-based (no N+1)', () => {
  it('Creative preview costs the same number of queries for 2 assets and for 8', async () => {
    const small = await creativeFixture(2);
    const big = await creativeFixture(8);

    const a = await countQueries((q) => previewCurrent(q, director, small, nowJun));
    const b = await countQueries((q) => previewCurrent(q, director, big, nowJun));

    // The whole point: 4× the rows, not one extra round-trip.
    expect(b.queries, whichQueryGrew(a.texts, b.texts)).toBe(a.queries);
    // And a sanity bound, so "same" can never mean "same and enormous".
    expect(a.queries).toBeLessThan(15);
  });

  it('AM preview costs the same number of queries for 1 client and for 4', async () => {
    const amSmall = uid('EMP-AM');
    const amBig = uid('EMP-AM');
    await insEmployee(amSmall, 'Account', 'ZZ-N1-AM-Role');
    await insEmployee(amBig, 'Account', 'ZZ-N1-AM-Role');
    await insRoleMapping('Account', 'ZZ-N1-AM-Role', 'Account', 'staff');

    for (const [am, n] of [[amSmall, 1] as const, [amBig, 4] as const]) {
      for (let i = 0; i < n; i++) {
        const client = uid('CLI-N1');
        const svc = uid('SVC-N1');
        const brief = uid('BRF-N1');
        await insClient(client, am);
        await insService(svc, client);
        await insBrief(brief, svc, 'Creative', 'ZZ-N1-NOBODY');
        await insAsset(brief, 'ZZ-N1-NOBODY', 5, 0);
      }
    }

    const a = await countQueries((q) => previewCurrent(q, director, amSmall, nowJun));
    const b = await countQueries((q) => previewCurrent(q, director, amBig, nowJun));

    expect(b.queries, whichQueryGrew(a.texts, b.texts)).toBe(a.queries);
    expect(a.queries).toBeLessThan(15);
  });
});

describeDb('P-1 — batching did not change the arithmetic', () => {
  it('pins the Creative components for a hand-computed fixture', async () => {
    const staff = uid('EMP-CRE');
    const client = uid('CLI-N1');
    const svc = uid('SVC-N1');
    const brief = uid('BRF-N1');
    await insEmployee(staff, 'Creative', 'ZZ-N1-Designer');
    await insRoleMapping('Creative', 'ZZ-N1-Designer', 'Creative', 'staff');
    await insEmployee('ZZ-N1-AM', 'Account', 'ZZ-N1-AM-Jab');
    await insClient(client, 'ZZ-N1-AM');
    await insService(svc, client);
    await insBrief(brief, svc, 'Creative', staff);
    // Asset 1: 5h against a 10h SLA → speed 50% → OA-1 transform → 100.
    await insAsset(brief, staff, 5, 0);
    // Asset 2: 20h against a 10h SLA → speed 200% → transform 200−200 = 0.
    await insAsset(brief, staff, 20, 4);

    const snap = await previewCurrent(sql, director, staff, nowJun);
    const comps = snap.components;

    // Speed Score (OA-1): the transform is applied to the MEAN raw speed
    // percentage, not per Asset — mean(50%, 200%) = 125% → 200 − 125 = 75.
    expect(comp(comps, COMP_SPEED_SCORE)?.included).toBe(true);
    expect(comp(comps, COMP_SPEED_SCORE)?.raw).toBeCloseTo(75, 6);
    // Both Assets were approved in the period → Output Quantity actual = 2.
    expect(comp(comps, COMP_OUTPUT_QUANTITY)?.included).toBe(true);
    // Revision Count (inverse): Σ4 revisions over 2 approved Assets → avg 2 →
    // 100 − min(2 × 20, 100) = 60.
    expect(comp(comps, COMP_REVISION_COUNT)?.included).toBe(true);
    expect(comp(comps, COMP_REVISION_COUNT)?.raw).toBeCloseTo(60, 6);
  });

  it('loadTransitions returns exactly what a per-entity read returns', async () => {
    const client = uid('CLI-N1');
    const svc = uid('SVC-N1');
    const brief = uid('BRF-N1');
    await insEmployee('ZZ-N1-AM', 'Account', 'ZZ-N1-AM-Jab');
    await insClient(client, 'ZZ-N1-AM');
    await insService(svc, client);
    await insBrief(brief, svc, 'Creative', 'ZZ-N1-NOBODY');
    const ids = [
      await insAsset(brief, 'ZZ-N1-NOBODY', 5, 0),
      await insAsset(brief, 'ZZ-N1-NOBODY', 7, 3),
      await insAsset(brief, 'ZZ-N1-NOBODY', 9, 1),
    ];

    const batched = await loadTransitions(sql, 'asset', ids);
    for (const id of ids) {
      // The pre-P-1 read, verbatim: one entity, ordered by id.
      const rows = await sql<{ action: string; created_at: Date }[]>`
        select action, created_at from audit_log
         where entity_type = 'asset' and entity_id = ${id} order by id asc`;
      const expected = rows
        .filter((r) => r.action.startsWith('transition:'))
        .map((r) => ({ to: r.action.slice(r.action.indexOf('->') + 2), at: r.created_at }));
      expect(transitionsOf(batched, id)).toEqual(expected);
    }
    // An id with no log at all reads as an empty list, not undefined.
    expect(transitionsOf(batched, 'AST-DOES-NOT-EXIST')).toEqual([]);
  });
});
