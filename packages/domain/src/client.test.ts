/**
 * Tests for the M4 Client Record lock matrix.
 *
 * - Unit: the §4 authorization predicates + the pre-DB gate (empty patch, a
 *   locked/system field, an unauthorized field, a bad value — all reject before
 *   any DB access).
 * - Integration (skipped unless DATABASE_URL is set): the atomic edit + audit
 *   against a migrated Postgres, over a Client Record born from the closing
 *   pipeline. Ids namespaced `ZZ-`; afterEach deletes what it made.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { leads, sales } from './index.js';
import {
  canEditAccountRevisable,
  canEditBaseline,
  canEditProfile,
  canReassignPic,
  editableFields,
  ForbiddenError,
  IncompleteError,
  isEditableField,
  LockedFieldError,
  NotFoundError,
  type Actor,
  type ClientPatch,
  updateClient,
} from './client.js';

const budi = (): Actor => ({
  employeeId: 'ZZ-BUDI', divisi: 'Sales', role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});
const salesLead = (): Actor => ({
  employeeId: 'ZZ-SLEAD', divisi: 'Sales', role: permission.makeRole({ division: 'Sales', level: 'lead' }),
});
const accountStaff = (): Actor => ({
  employeeId: 'ZZ-AM', divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'staff' }),
});
const accountLead = (): Actor => ({
  employeeId: 'ZZ-ALEAD', divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'lead' }),
});
const od = (): Actor => ({ employeeId: 'ZZ-OD', divisi: 'Management', role: permission.makeRole({ od: true }) });
const director = (): Actor => ({ employeeId: 'ZZ-DIR', divisi: 'Management', role: permission.makeRole({ director: true }) });

// ---------------------------------------------------------------------------
// Unit: lock-matrix authorization predicates (§4).
// ---------------------------------------------------------------------------
describe('lock-matrix predicates', () => {
  it('profile: Account Lead / OD / Director only', () => {
    expect(canEditProfile(accountLead())).toBe(true);
    expect(canEditProfile(od())).toBe(true);
    expect(canEditProfile(director())).toBe(true);
    expect(canEditProfile(accountStaff())).toBe(false);
    expect(canEditProfile(budi())).toBe(false);
  });
  it('GMV baseline: OD / Director only', () => {
    expect(canEditBaseline(od())).toBe(true);
    expect(canEditBaseline(director())).toBe(true);
    expect(canEditBaseline(accountLead())).toBe(false);
  });
  it('Target GMV / Marketing Budget: any Account or Director', () => {
    expect(canEditAccountRevisable(accountStaff())).toBe(true);
    expect(canEditAccountRevisable(accountLead())).toBe(true);
    expect(canEditAccountRevisable(director())).toBe(true);
    expect(canEditAccountRevisable(budi())).toBe(false);
    expect(canEditAccountRevisable(od())).toBe(false);
  });
  it('PIC reassign: Sales Lead / Director only', () => {
    expect(canReassignPic(salesLead())).toBe(true);
    expect(canReassignPic(director())).toBe(true);
    expect(canReassignPic(budi())).toBe(false);
    expect(canReassignPic(accountLead())).toBe(false);
  });
});

describe('field registry', () => {
  it('exposes the ten editable fields and rejects locked/system ones', () => {
    expect(editableFields()).toContain('targetGmv');
    expect(editableFields()).toHaveLength(10);
    expect(isEditableField('targetGmv')).toBe(true);
    expect(isEditableField('totalSales')).toBe(false);
    expect(isEditableField('clientId')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unit: pre-DB gate (no DB).
// ---------------------------------------------------------------------------
describe('updateClient gate (no DB)', () => {
  const noSql = null as unknown as Sql;

  it('rejects an empty patch', async () => {
    await expect(updateClient(noSql, accountLead(), 'CLI-x', {})).rejects.toBeInstanceOf(IncompleteError);
  });
  it('rejects a locked / system field (not in the registry)', async () => {
    await expect(updateClient(noSql, director(), 'CLI-x', { totalSales: '1' } as unknown as ClientPatch))
      .rejects.toBeInstanceOf(LockedFieldError);
  });
  it('rejects a field the role may not edit', async () => {
    await expect(updateClient(noSql, accountStaff(), 'CLI-x', { toko: 'X' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateClient(noSql, budi(), 'CLI-x', { targetGmv: '1000' })).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('rejects a bad value (empty string / unparseable money)', async () => {
    await expect(updateClient(noSql, accountLead(), 'CLI-x', { toko: '  ' })).rejects.toBeInstanceOf(IncompleteError);
    await expect(updateClient(noSql, accountStaff(), 'CLI-x', { targetGmv: 'abc' })).rejects.toBeInstanceOf(IncompleteError);
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

let seq = 0;
const uniquePhone = (): string => `0815${String(Date.now()).slice(-6)}${String(seq++).padStart(3, '0')}`;
const uniqueSvc = (): string => `SVC-ZZ-M4-${seq++}`;

/** Close a deal (Budi solo, Lunas) and return the born client id. */
async function closedClient(): Promise<string> {
  const svc = uniqueSvc();
  await sql`insert into master_services (id, created_by) values (${svc}, 'ZZ-ADMIN')`;
  await sql`
    insert into master_service_versions
      (service_id, version_no, name, standard_price, commission_rule, active, effective_from, pricing_mode, created_by)
    values (${svc}, 1, ${'Svc ' + svc}, '9000000.00', '10% of standard price', true, '2020-01-01', 'flat', 'ZZ-ADMIN')`;
  const { attempt } = await leads.register(sql, budi(), { leadName: 'Alpha Digital', phoneNumber: uniquePhone() });
  await sales.markContacted(sql, budi(), attempt.id);
  await sales.submitQualifiedForm(sql, budi(), attempt.id, {
    namaPic: 'Ibu Alpha', toko: 'Alpha Digital', kota: 'Jakarta', linkToko: 'https://shopee/alpha',
    kategori: 'Fashion', platform: 'Shopee', gmvBaseline: '50000000', targetGmv: '80000000',
    services: [{ masterServiceId: svc, quantity: 1 }],
  });
  await sales.submitNegotiation(sql, budi(), attempt.id, [], true);
  const res = await sales.close(sql, budi(), attempt.id, {
    parties: { primarySalespersonId: 'ZZ-BUDI', allocations: [{ salespersonId: 'ZZ-BUDI', basisPoints: 10000 }] },
    paymentScheme: sales.PAYMENT_SCHEME_LUNAS,
  });
  return res.clientId;
}

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  await sql`delete from installments where created_by like 'ZZ-%'`;
  await sql`delete from transactions where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from client_platforms where created_by like 'ZZ-%'`;
  await sql`delete from client_sales_allocations where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
  await sql`delete from negotiation_proposal_lines where created_by like 'ZZ-%'`;
  await sql`delete from negotiation_proposals where created_by like 'ZZ-%'`;
  await sql`delete from qualified_form_services where created_by like 'ZZ-%'`;
  await sql`delete from qualified_forms where created_by like 'ZZ-%'`;
  await sql`delete from prospect_attempts where created_by like 'ZZ-%'`;
  await sql`delete from leads where created_by like 'ZZ-%'`;
  await sql`delete from master_service_versions where created_by like 'ZZ-%'`;
  await sql`delete from master_services where created_by like 'ZZ-%'`;
});

describeDb('updateClient (lock matrix, M4 §4)', () => {
  const field = async (clientId: string, col: string): Promise<string | null> =>
    (await sql<Record<string, string | null>[]>`select ${sql(col)} as v from clients where id = ${clientId}`)[0].v as string | null;

  it('Account Lead corrects a profile field, logged before→after', async () => {
    const id = await closedClient();
    await updateClient(sql, accountLead(), id, { toko: 'Alpha Digital (koreksi)' });
    expect(await field(id, 'toko')).toBe('Alpha Digital (koreksi)');

    const audit = await sql<{ before_json: { value: string }; after_json: { value: string } }[]>`
      select before_json, after_json from audit_log
      where entity_id = ${id} and action = 'client_field_edited' order by id desc limit 1`;
    expect(audit[0].before_json.value).toBe('Alpha Digital');
    expect(audit[0].after_json.value).toBe('Alpha Digital (koreksi)');
  });

  it('Account (staff) revises Target GMV + Marketing Budget', async () => {
    const id = await closedClient();
    await updateClient(sql, accountStaff(), id, { targetGmv: '120000000', marketingBudget: '15000000' });
    expect(await field(id, 'target_gmv')).toBe('120000000.00');
    expect(await field(id, 'marketing_budget')).toBe('15000000.00');
  });

  it('only OD/Director may correct the GMV baseline', async () => {
    const id = await closedClient();
    await expect(updateClient(sql, accountLead(), id, { gmvBaseline: '60000000' })).rejects.toBeInstanceOf(ForbiddenError);
    await updateClient(sql, od(), id, { gmvBaseline: '60000000' });
    expect(await field(id, 'gmv_baseline')).toBe('60000000.00');
  });

  it('Sales Lead reassigns the Sales PIC + Commission PIC', async () => {
    const id = await closedClient();
    await updateClient(sql, salesLead(), id, { salesPicId: 'ZZ-NEWSALES', commissionPaymentPicId: 'ZZ-NEWSALES' });
    expect(await field(id, 'sales_pic_id')).toBe('ZZ-NEWSALES');
    expect(await field(id, 'commission_payment_pic_id')).toBe('ZZ-NEWSALES');
  });

  it('a Sales staff cannot edit a profile field (locked after Qualified)', async () => {
    const id = await closedClient();
    await expect(updateClient(sql, budi(), id, { toko: 'X' })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await field(id, 'toko')).toBe('Alpha Digital'); // unchanged
  });

  it('an unauthorized field in a multi-field patch rolls back the whole edit', async () => {
    const id = await closedClient();
    // accountStaff may edit targetGmv but NOT toko → the whole patch is rejected.
    await expect(updateClient(sql, accountStaff(), id, { targetGmv: '120000000', toko: 'X' }))
      .rejects.toBeInstanceOf(ForbiddenError);
    expect(await field(id, 'target_gmv')).toBe('80000000.00'); // unchanged (atomic)
  });

  it('404s on an unknown client', async () => {
    await expect(updateClient(sql, accountLead(), 'CLI-000000-0000', { toko: 'X' }))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});
