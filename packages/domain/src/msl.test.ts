/**
 * Tests for the Master Service List admin + read.
 *
 * - Unit: the edit-permission matrix (pure predicate).
 * - Integration (skipped unless DATABASE_URL is set): create → immutable version
 *   chain → effective read against a migrated Postgres. Each test namespaces its
 *   actor ids with `ZZ-` and afterEach deletes the rows it made.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { money, permission, tz } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  type Actor,
  canEditMasterServices,
  createService,
  effectiveAt,
  ForbiddenError,
  IncompleteError,
  listEffectiveAt,
  listVersions,
  MSG_MASTER_SERVICE_DENIED,
  ServiceNotFoundError,
  updateService,
} from './msl';

const salesLead = (): Actor => ({
  employeeId: 'ZZ-SLEAD', role: permission.makeRole({ division: 'Sales', level: 'lead' }),
});
const salesStaff = (): Actor => ({
  employeeId: 'ZZ-SSTAFF', role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});
const director = (): Actor => ({
  employeeId: 'ZZ-DIR', role: permission.makeRole({ division: 'OD', level: 'lead', director: true }),
});

// ---------------------------------------------------------------------------
// Unit: edit-permission matrix.
// ---------------------------------------------------------------------------
describe('canEditMasterServices', () => {
  it('allows Sales Lead and Director; denies Sales staff and other divisions', () => {
    expect(canEditMasterServices(salesLead())).toBe(true);
    expect(canEditMasterServices(director())).toBe(true);
    expect(canEditMasterServices(salesStaff())).toBe(false);
    expect(canEditMasterServices({
      employeeId: 'ZZ-CLEAD', role: permission.makeRole({ division: 'Creative', level: 'lead' }),
    })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration (real Postgres).
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

const TODAY = tz.dateString(new Date());

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  await sql`delete from master_service_versions where created_by like 'ZZ-%'`;
  await sql`delete from master_services where created_by like 'ZZ-%'`;
});

describeDb('createService', () => {
  it('mints an MSV id + version 1, audits, and is effective-readable', async () => {
    const id = await createService(sql, salesLead(), {
      name: 'Jasa Live Streaming Basic', standardPrice: '6900000',
      commissionRule: '10% of standard price', effectiveFrom: '2020-01-01',
      category: 'Live', unit: 'sesi', pricingMode: 'flat', active: true,
    });
    expect(id).toMatch(/^MSV-\d{6}-\d{4}$/);

    const v = await effectiveAt(sql, id, TODAY);
    expect(v.name).toBe('Jasa Live Streaming Basic');
    expect(money.parse(v.standardPrice)).toBe(money.parse('6900000'));
    expect(v.versionNo).toBe(1);

    const audit = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
      where entity_id = ${id} and entity_type = 'master_service' and action = 'create'`;
    expect(audit[0].n).toBe(1);
  });

  it('denies a Sales staff with the verbatim BI message', async () => {
    await expect(createService(sql, salesStaff(), {
      name: 'x', standardPrice: '1000', commissionRule: 'flat Rp 100', effectiveFrom: '2020-01-01',
    })).rejects.toThrow(MSG_MASTER_SERVICE_DENIED);
    await expect(createService(sql, salesStaff(), {
      name: 'x', standardPrice: '1000', commissionRule: 'flat Rp 100', effectiveFrom: '2020-01-01',
    })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects incomplete / bad-mode input with the house BI message', async () => {
    // Missing commission_rule.
    await expect(createService(sql, salesLead(), {
      name: 'x', standardPrice: '1000', commissionRule: '', effectiveFrom: '2020-01-01',
    })).rejects.toBeInstanceOf(IncompleteError);
    // min_floor without a whole positive min_qty.
    await expect(createService(sql, salesLead(), {
      name: 'x', standardPrice: '1000', commissionRule: 'flat Rp 100', effectiveFrom: '2020-01-01',
      pricingMode: 'min_floor', minQty: '2.5',
    })).rejects.toBeInstanceOf(IncompleteError);
  });

  // Regression: a non-empty but unparseable commission_rule ("10%") used to
  // persist here and then throw on EVERY later pricing read — the quote preview
  // and Qualified Lead Form both answered 500 for the salesperson. The rule the
  // calculator cannot parse must never reach the catalog (DECISIONS O14).
  it('rejects a commission_rule outside the O14 grammar, minting no MSV id', async () => {
    const before = await sql<{ n: number }[]>`select count(*)::int as n from master_services`;
    for (const commissionRule of ['10%', '10 persen', 'flat 500000', 'konten']) {
      await expect(createService(sql, salesLead(), {
        name: 'Jasa Aturan Komisi Ngawur', standardPrice: '150000',
        commissionRule, effectiveFrom: '2020-01-01', pricingMode: 'flat', active: true,
      })).rejects.toBeInstanceOf(IncompleteError);
    }
    // House rule #1: the id is minted only after validation passes, so a
    // rejected create leaves no orphan master_services row behind.
    const after = await sql<{ n: number }[]>`select count(*)::int as n from master_services`;
    expect(after[0].n).toBe(before[0].n);
  });

  it('accepts both documented shapes', async () => {
    for (const commissionRule of ['0% of standard price', 'flat Rp 500.000']) {
      const id = await createService(sql, salesLead(), {
        name: `Jasa ${commissionRule}`, standardPrice: '150000',
        commissionRule, effectiveFrom: '2020-01-01', pricingMode: 'flat', active: true,
      });
      expect((await effectiveAt(sql, id, TODAY)).commissionRule).toBe(commissionRule);
    }
  });
});

describeDb('updateService', () => {
  it('appends an immutable version 2 (old version still effective before its cutover)', async () => {
    const id = await createService(sql, salesLead(), {
      name: 'Jasa A', standardPrice: '5000000', commissionRule: '10% of standard price',
      effectiveFrom: '2020-01-01', active: true,
    });
    const next = await updateService(sql, salesLead(), id, {
      name: 'Jasa A (naik harga)', standardPrice: '6000000', commissionRule: '10% of standard price',
      effectiveFrom: '2020-06-01', active: true,
    });
    expect(next).toBe(2);

    // Version chain has both, newest first; nothing was mutated in place.
    const chain = await listVersions(sql, id);
    expect(chain.map((v) => v.versionNo)).toEqual([2, 1]);
    expect(money.parse(chain[1].standardPrice)).toBe(money.parse('5000000'));

    // Effective before the v2 cutover resolves v1; today resolves v2.
    const before = await effectiveAt(sql, id, '2020-03-01');
    expect(before.versionNo).toBe(1);
    const now = await effectiveAt(sql, id, TODAY);
    expect(now.versionNo).toBe(2);
  });

  it('throws ServiceNotFoundError for an unknown service id', async () => {
    await expect(updateService(sql, salesLead(), 'MSV-209901-9999', {
      name: 'x', standardPrice: '1000', commissionRule: 'flat Rp 100', effectiveFrom: '2020-01-01',
    })).rejects.toBeInstanceOf(ServiceNotFoundError);
  });

  // The gate has to hold on the edit door too — otherwise a valid v1 could be
  // superseded by an unpriceable v2 and break the calculator from tomorrow on.
  it('rejects a commission_rule outside the O14 grammar, appending no version', async () => {
    const id = await createService(sql, salesLead(), {
      name: 'Jasa B', standardPrice: '5000000', commissionRule: '10% of standard price',
      effectiveFrom: '2020-01-01', active: true,
    });
    await expect(updateService(sql, salesLead(), id, {
      name: 'Jasa B', standardPrice: '5000000', commissionRule: '10%',
      effectiveFrom: '2020-06-01', active: true,
    })).rejects.toBeInstanceOf(IncompleteError);
    expect((await listVersions(sql, id)).map((v) => v.versionNo)).toEqual([1]);
  });
});

describeDb('listEffectiveAt', () => {
  it('returns the newest-effective version per service', async () => {
    const a = await createService(sql, salesLead(), {
      name: 'Svc A', standardPrice: '1000000', commissionRule: 'flat Rp 100', effectiveFrom: '2020-01-01', active: true,
    });
    await updateService(sql, salesLead(), a, {
      name: 'Svc A v2', standardPrice: '2000000', commissionRule: 'flat Rp 100', effectiveFrom: '2020-02-01', active: true,
    });
    const b = await createService(sql, salesLead(), {
      name: 'Svc B', standardPrice: '3000000', commissionRule: 'flat Rp 100', effectiveFrom: '2020-01-01', active: true,
    });

    const list = await listEffectiveAt(sql, TODAY);
    const mine = list.filter((v) => v.id === a || v.id === b);
    const byId = Object.fromEntries(mine.map((v) => [v.id, v]));
    expect(byId[a].versionNo).toBe(2);
    expect(byId[a].name).toBe('Svc A v2');
    expect(byId[b].versionNo).toBe(1);
  });
});
