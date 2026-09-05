/**
 * Tests for the mslseed plan/apply engine — port of
 * `archive/backend-go/cmd/mslseed/engine_db_test.go`.
 *
 * - Unit: `sameService` (the idempotency no-op predicate).
 * - Integration (skipped unless DATABASE_URL is set): the real 32-row seed
 *   against a migrated Postgres — dry-run writes nothing, apply creates 32
 *   versioned+audited services, a rerun is a pure no-op, a changed field appends
 *   a version instead of mutating, and a Sales staff actor is refused.
 *
 * Actor ids are namespaced `ZZ-` and afterEach deletes only what the test wrote,
 * matching `packages/domain/src/msl.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { msl } from '@cdps/domain';
import { parseCsv, type Row } from './csv';
import { execute, sameService } from './engine';
import { rowToServiceInput } from './validate';

const SEED_CSV = fileURLToPath(new URL('../../../../supabase/seed/msl_kalkulator.csv', import.meta.url));
const seedText = readFileSync(SEED_CSV, 'utf8');

const salesLead = (): msl.Actor => ({
  employeeId: 'ZZ-SLEAD', role: permission.makeRole({ division: 'Sales', level: 'lead' }),
});
const salesStaff = (): msl.Actor => ({
  employeeId: 'ZZ-SSTAFF', role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});

/** A ServiceView as the DB would return it (money already round-tripped). */
function view(over: Partial<msl.ServiceView> = {}): msl.ServiceView {
  return {
    id: 'MSV-202607-0001', name: 'Jasa A', standardPrice: '1000000.00',
    commissionRule: '0% of standard price', category: 'Kat', unit: 'paket', minQty: '',
    pricingMode: 'flat', applyPPN: false, frequency: 'Monthly', priceNote: 'catatan',
    description: 'desc', active: true, requiresStrategyPlan: false, planTier: 'tanpa_plan', durasiJasa: null,
    versionNo: 1,
    effectiveFrom: '2026-07-16', ...over,
  };
}

function input(over: Partial<msl.ServiceInput> = {}): msl.ServiceInput {
  return {
    name: 'Jasa A', standardPrice: '1000000', commissionRule: '0% of standard price',
    category: 'Kat', unit: 'paket', minQty: '', pricingMode: 'flat', applyPPN: false,
    frequency: 'Monthly', priceNote: 'catatan', description: 'desc', active: true,
    effectiveFrom: '2026-07-16', ...over,
  };
}

// ---------------------------------------------------------------------------
// Unit: sameService.
// ---------------------------------------------------------------------------
describe('sameService', () => {
  it('treats a DB-round-tripped price as identical ("1000000" vs "1000000.00")', () => {
    expect(sameService(view(), input())).toBe(true);
  });

  it('treats a round-tripped min_qty as identical ("300" vs "300.00")', () => {
    expect(sameService(
      view({ pricingMode: 'min_floor', minQty: '300.00' }),
      input({ pricingMode: 'min_floor', minQty: '300' }),
    )).toBe(true);
  });

  it('defaults an unset pricing_mode to flat rather than reporting a difference', () => {
    expect(sameService(view({ pricingMode: 'flat' }), input({ pricingMode: undefined }))).toBe(true);
  });

  it('ignores requires_strategy_plan (not a seeded column)', () => {
    expect(sameService(view({ requiresStrategyPlan: true }), input())).toBe(true);
  });

  const diffs: Array<[string, Partial<msl.ServiceInput>]> = [
    ['price', { standardPrice: '2000000' }],
    ['name', { name: 'Jasa B' }],
    ['commission_rule', { commissionRule: '5% of standard price' }],
    ['category', { category: 'Lain' }],
    ['unit', { unit: 'sesi' }],
    ['apply_ppn', { applyPPN: true }],
    ['frequency', { frequency: 'One-time' }],
    ['price_note', { priceNote: 'lain' }],
    ['description', { description: 'lain' }],
    ['active', { active: false }],
    ['effective_from', { effectiveFrom: '2026-08-01' }],
  ];
  for (const [field, over] of diffs) {
    it(`reports a difference in ${field}`, () => {
      expect(sameService(view(), input(over))).toBe(false);
    });
  }

  it('reports a difference when min_qty appears or disappears', () => {
    expect(sameService(view({ minQty: '' }), input({ minQty: '10' }))).toBe(false);
    expect(sameService(view({ minQty: '10.00' }), input({ minQty: '' }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration (real Postgres).
// ---------------------------------------------------------------------------
const DB_URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!DB_URL);

let sql: Sql;
if (DB_URL) {
  sql = createClient(DB_URL);
}

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  await sql`delete from master_service_versions where created_by like 'ZZ-%'`;
  await sql`delete from master_services where created_by like 'ZZ-%'`;
  // audit_log is deliberately NOT cleaned: house rule #3 makes it append-only and
  // the DB rejects DELETE outright. Assertions below therefore scope audit counts
  // to the service ids alive in that test, never to a whole-table count.
});

/** Rows of the real seed, re-keyed so they cannot collide with fixture names. */
function seedRows(): Row[] {
  return parseCsv(seedText).map((r) => ({ ...r, name: `ZZTEST ${r.name}` }));
}

const sink = () => {
  const lines: string[] = [];
  return { lines, log: (l: string) => lines.push(l) };
};

describeDb('execute — dry-run', () => {
  it('plans 32 creates and writes nothing', async () => {
    const out = sink();
    const rep = await execute(sql, salesLead(), seedRows(), false, out.log);
    expect(rep).toEqual({ created: 32, newVersion: 0, skipped: 0, errors: 0 });

    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from master_service_versions where created_by like 'ZZ-%'`;
    expect(rows[0].n).toBe(0);
    expect(out.lines.at(-1)).toBe('ringkasan (dry-run): dibuat=32 versi_baru=0 dilewati=0 error=0');
  });
});

describeDb('execute — apply', () => {
  it('creates 32 services, each version 1 with an audit row', async () => {
    const rep = await execute(sql, salesLead(), seedRows(), true, () => {});
    expect(rep).toEqual({ created: 32, newVersion: 0, skipped: 0, errors: 0 });

    const [{ n: services }] = await sql<{ n: number }[]>`
      select count(*)::int as n from master_services where created_by like 'ZZ-%'`;
    expect(services).toBe(32);

    const [{ n: versions }] = await sql<{ n: number }[]>`
      select count(*)::int as n from master_service_versions
      where created_by like 'ZZ-%' and version_no = 1`;
    expect(versions).toBe(32);

    // House rule #1: every id is PREFIX-YYYYMM-NNNN with the MSV prefix.
    const ids = await sql<{ id: string }[]>`
      select id from master_services where created_by like 'ZZ-%'`;
    for (const { id } of ids) {
      expect(id).toMatch(/^MSV-\d{6}-\d{4}$/);
    }

    // House rule #3: the write is audited, once per service, by our actor.
    const [{ n: audits }] = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log a
      where a.entity_type = 'master_service' and a.action = 'create'
        and a.actor_employee_id = 'ZZ-SLEAD'
        and a.entity_id in (select id from master_services where created_by like 'ZZ-%')`;
    expect(audits).toBe(32);
  });

  it('is idempotent: rerunning the same CSV skips all 32 and adds no version', async () => {
    await execute(sql, salesLead(), seedRows(), true, () => {});
    const out = sink();
    const rep = await execute(sql, salesLead(), seedRows(), true, out.log);
    expect(rep).toEqual({ created: 0, newVersion: 0, skipped: 32, errors: 0 });

    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from master_service_versions where created_by like 'ZZ-%'`;
    expect(n).toBe(32);
    expect(out.lines.at(-1)).toBe('ringkasan (apply): dibuat=0 versi_baru=0 dilewati=32 error=0');
  });

  it('appends a NEW version when a price changes — never mutating version 1', async () => {
    const rows = seedRows();
    await execute(sql, salesLead(), rows, true, () => {});

    const target = rows[0];
    const before = rowToServiceInput(target);
    const bumped = rows.map((r) => r === target ? { ...r, unitPrice: '7000000' } : r);

    const rep = await execute(sql, salesLead(), bumped, true, () => {});
    expect(rep).toEqual({ created: 0, newVersion: 1, skipped: 31, errors: 0 });

    const [{ id }] = await sql<{ id: string }[]>`
      select service_id as id from master_service_versions
      where created_by like 'ZZ-%' and name = ${before.name} limit 1`;
    const chain = await msl.listVersions(sql, id);
    expect(chain.map((v) => v.versionNo)).toEqual([2, 1]);
    // v1 still holds the original price: history was appended to, not rewritten.
    expect(chain[1].standardPrice).toBe(before.standardPrice);
    expect(chain[0].standardPrice).toBe('7000000.00');
  });

  it('plans a new version in dry-run without writing it', async () => {
    const rows = seedRows();
    await execute(sql, salesLead(), rows, true, () => {});
    const bumped = rows.map((r, i) => i === 0 ? { ...r, unitPrice: '7000000' } : r);

    const out = sink();
    const rep = await execute(sql, salesLead(), bumped, false, out.log);
    expect(rep).toEqual({ created: 0, newVersion: 1, skipped: 31, errors: 0 });
    expect(out.lines.some((l) => l.startsWith('[DRY-RUN] versi baru'))).toBe(true);

    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from master_service_versions where created_by like 'ZZ-%'`;
    expect(n).toBe(32);
  });
});

describeDb('execute — gates', () => {
  it('refuses a Sales staff actor with the verbatim BI message, before any write', async () => {
    await expect(execute(sql, salesStaff(), seedRows(), true, () => {}))
      .rejects.toThrow(msl.MSG_MASTER_SERVICE_DENIED);

    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from master_service_versions where created_by like 'ZZ-%'`;
    expect(n).toBe(0);
  });

  it('aborts on an invalid row before touching the DB, even with --apply', async () => {
    const rows = seedRows();
    rows[5] = { ...rows[5], commissionRule: '10 persen' };

    const out = sink();
    await expect(execute(sql, salesLead(), rows, true, out.log))
      .rejects.toThrow(/validasi CSV gagal: 1 dari 32 baris tidak valid — dibatalkan sebelum menyentuh DB/);
    expect(out.lines.some((l) => l.includes('commission_rule tidak dikenal'))).toBe(true);

    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from master_service_versions where created_by like 'ZZ-%'`;
    expect(n).toBe(0);
  });
});
