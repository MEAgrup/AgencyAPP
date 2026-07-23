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
import { money, permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { finance, leads, sales } from './index.js';
import {
  addPlatform,
  canEditAccountRevisable,
  canEditBaseline,
  canEditProfile,
  canReassignPic,
  canVoidService,
  editableFields,
  ForbiddenError,
  IncompleteError,
  isEditableField,
  listClients,
  LockedFieldError,
  NotFoundError,
  type Actor,
  type ClientPatch,
  updateClient,
  updatePlatform,
  voidService,
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
  it('Void Service: SPV/Account Lead / Director only', () => {
    expect(canVoidService(accountLead())).toBe(true);
    expect(canVoidService(director())).toBe(true);
    expect(canVoidService(accountStaff())).toBe(false);
    expect(canVoidService(budi())).toBe(false);
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

describe('platform gate (no DB)', () => {
  const noSql = null as unknown as Sql;

  it('addPlatform: profile authority + mandatory platform + valid date', async () => {
    await expect(addPlatform(noSql, budi(), 'CLI-x', { platform: 'Shopee' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addPlatform(noSql, accountLead(), 'CLI-x', { platform: '  ' })).rejects.toBeInstanceOf(IncompleteError);
    await expect(addPlatform(noSql, accountLead(), 'CLI-x', { platform: 'Shopee', managedSince: '01-2026' }))
      .rejects.toBeInstanceOf(IncompleteError);
  });

  it('updatePlatform: profile authority + at least one field', async () => {
    await expect(updatePlatform(noSql, budi(), 'CLI-x', 1, { active: false })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updatePlatform(noSql, accountLead(), 'CLI-x', 1, {})).rejects.toBeInstanceOf(IncompleteError);
  });

  it('voidService: Account-Lead authority + mandatory reason', async () => {
    await expect(voidService(noSql, budi(), 'SVC-x', 'salah input')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(voidService(noSql, accountStaff(), 'SVC-x', 'salah input')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(voidService(noSql, accountLead(), 'SVC-x', '  ')).rejects.toBeInstanceOf(IncompleteError);
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
  await sql`delete from briefs where created_by like 'ZZ-%'`;
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

describeDb('Platform List (M4 §3/§4)', () => {
  const primaryPlatformId = async (clientId: string): Promise<number> =>
    Number((await sql<{ id: string }[]>`select id from client_platforms where client_id = ${clientId} order by id limit 1`)[0].id);

  it('Account Lead adds a platform (born active), logged; appears on the record', async () => {
    const id = await closedClient();
    const pid = await addPlatform(sql, accountLead(), id, { platform: 'TikTok Shop', storeLink: 'https://tokopedia/x', managedSince: '2026-05-01' });
    expect(pid).toBeGreaterThan(0);

    const rows = await sql<{ platform: string; active: boolean }[]>`
      select platform, active from client_platforms where client_id = ${id} order by id`;
    expect(rows.map((r) => r.platform)).toEqual(['Shopee', 'TikTok Shop']);
    expect(rows[1].active).toBe(true);

    const audit = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log where entity_id = ${id} and action = 'platform_added'`;
    expect(audit[0].n).toBe(1);
  });

  it('a Sales staff cannot add a platform', async () => {
    const id = await closedClient();
    await expect(addPlatform(sql, budi(), id, { platform: 'Lazada' })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('OD deactivates a platform (removal from the list, not a delete), logged', async () => {
    const id = await closedClient();
    const pid = await primaryPlatformId(id);
    await updatePlatform(sql, od(), id, pid, { active: false });

    const row = await sql<{ active: boolean }[]>`select active from client_platforms where id = ${pid}`;
    expect(row[0].active).toBe(false); // row still exists

    const audit = await sql<{ before_json: { active: boolean }; after_json: { active: boolean } }[]>`
      select before_json, after_json from audit_log
      where entity_id = ${id} and action = 'platform_updated' order by id desc limit 1`;
    expect(audit[0].before_json.active).toBe(true);
    expect(audit[0].after_json.active).toBe(false);
  });

  it('corrects a store link', async () => {
    const id = await closedClient();
    const pid = await primaryPlatformId(id);
    await updatePlatform(sql, accountLead(), id, pid, { storeLink: 'https://shopee/alpha-baru' });
    const row = await sql<{ store_link: string | null }[]>`select store_link from client_platforms where id = ${pid}`;
    expect(row[0].store_link).toBe('https://shopee/alpha-baru');
  });

  it('404s updating a platform that does not belong to the client', async () => {
    const id = await closedClient();
    await expect(updatePlatform(sql, accountLead(), id, 99999999, { active: false }))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

describeDb('voidService (M4-OA-5)', () => {
  const serviceOf = async (clientId: string): Promise<string> =>
    (await sql<{ id: string }[]>`select id from services where client_id = ${clientId} limit 1`)[0].id;
  const transactionOf = async (clientId: string): Promise<string> =>
    (await sql<{ id: string }[]>`select id from transactions where client_id = ${clientId} limit 1`)[0].id;

  /** Seed a Brief on a service at `status` (stub table, brief_task machine). */
  async function seedBrief(serviceId: string, status: string, n: number): Promise<string> {
    const id = `BRF-ZZ-${seq++}-${n}`;
    await sql`insert into briefs (id, service_id, title, status, created_by) values (${id}, ${serviceId}, ${'Brief ' + n}, ${status}, 'ZZ-ADMIN')`;
    return id;
  }

  it('voids a Service and cascade-cancels child Briefs not yet [Approved]', async () => {
    const clientId = await closedClient();
    const svc = await serviceOf(clientId);
    const todo = await seedBrief(svc, '[To Do]', 1);
    const done = await seedBrief(svc, '[Approved]', 2);

    const res = await voidService(sql, accountLead(), svc, 'salah input layanan');
    expect(res.voidedBriefs).toEqual([todo]);

    const svcRow = await sql<{ status: string }[]>`select status from services where id = ${svc}`;
    expect(svcRow[0].status).toBe('[Cancelled — Service Voided]');
    const todoRow = await sql<{ status: string }[]>`select status from briefs where id = ${todo}`;
    expect(todoRow[0].status).toBe('[Cancelled — Service Voided]');
    const doneRow = await sql<{ status: string }[]>`select status from briefs where id = ${done}`;
    expect(doneRow[0].status).toBe('[Approved]'); // Approved brief untouched

    const audit = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log where entity_id = ${svc} and action = 'service_voided'`;
    expect(audit[0].n).toBe(1);
  });

  it('a voided Service is excluded from commission achievement (still-immutable total)', async () => {
    const clientId = await closedClient();
    const trx = await transactionOf(clientId);
    const svc = await serviceOf(clientId);

    const before = await finance.commissionAchievement(sql, trx);
    expect(money.parse(before.totalDealCommission)).toBe(money.parse('900000')); // 10% of 9.000.000

    await voidService(sql, accountLead(), svc, 'salah input');
    const after = await finance.commissionAchievement(sql, trx);
    expect(money.parse(after.totalDealCommission)).toBe(0n); // voided service excluded

    // The Transaction total stays immutable.
    const t = await sql<{ total_agreed_value: string }[]>`select total_agreed_value from transactions where id = ${trx}`;
    expect(money.parse(t[0].total_agreed_value)).toBe(money.parse('9000000'));
  });

  it('cannot re-void an already-voided Service, and rejects non-Account-Lead', async () => {
    const clientId = await closedClient();
    const svc = await serviceOf(clientId);
    await expect(voidService(sql, budi(), svc, 'x')).rejects.toBeInstanceOf(ForbiddenError);
    await voidService(sql, accountLead(), svc, 'x');
    await expect(voidService(sql, accountLead(), svc, 'lagi')).rejects.toBeInstanceOf(LockedFieldError);
  });

  it('404s on an unknown service', async () => {
    await expect(voidService(sql, accountLead(), 'SVC-000000-0000', 'x')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describeDb('listClients (M4 §6)', () => {
  it('returns the client roster newest-first with sales PIC', async () => {
    const clientId = await closedClient();
    const rows = await listClients(sql);
    const mine = rows.find((r) => r.id === clientId);
    expect(mine).toBeDefined();
    expect(mine!.toko).toBe('Alpha Digital');
    expect(mine!.salesPicId).toBe('ZZ-BUDI');
    expect(mine!.paymentIntent).toBe(sales.PAYMENT_SCHEME_LUNAS);
  });
});
