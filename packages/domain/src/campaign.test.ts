/**
 * Tests for M3 Campaign (campaign.ts). Ported from Go's
 * backend/internal/module3_campaign/{campaign,rollup}_test.go.
 *
 * - Unit: the §5/§6.1 authority predicates (no DB).
 * - Integration (skipped unless DATABASE_URL is set): create validation +
 *   mint-after-validation, the Draft→Active⇄Paused→Closed→Archived machine
 *   (legal path stamps end_date, illegal edges blocked), transition/reassign
 *   authority per role (incl. layered OD/Director), Get/List visibility,
 *   reassign target validation + append-only audit, and the derived rollups.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { money, permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  campaignRollup,
  canCreate,
  canManageCampaign,
  canReassign,
  canViewCampaign,
  createCampaign,
  ForbiddenError,
  getCampaign,
  listCampaigns,
  MARKETING_DIVISION,
  NotFoundError,
  reassignCampaign,
  STATUS_ACTIVE,
  STATUS_ARCHIVED,
  STATUS_CLOSED,
  STATUS_DRAFT,
  STATUS_PAUSED,
  transitionCampaign,
  ValidationError,
  type Actor,
  type CampaignInput,
} from './campaign';

// ---- actors ---------------------------------------------------------------

const mktStaff = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: MARKETING_DIVISION, level: 'staff' }) });
const mktLead = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: MARKETING_DIVISION, level: 'lead' }) });
const salesStaff = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Sales', level: 'staff' }) });
const od = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Management', level: 'staff', od: true }) });
const director = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Management', level: 'staff', director: true }) });

// ===========================================================================
// Unit — authority predicates.
// ===========================================================================

describe('campaign authority predicates (§5/§6.1)', () => {
  it('canCreate: Marketing staff/lead or Director; Sales/OD denied', () => {
    expect(canCreate(mktStaff('X'))).toBe(true);
    expect(canCreate(mktLead('X'))).toBe(true);
    expect(canCreate(director('X'))).toBe(true);
    expect(canCreate(salesStaff('X'))).toBe(false);
    expect(canCreate(od('X'))).toBe(false);
  });
  it('canManageCampaign: owner staff / any Marketing lead / Director; other staff & OD denied', () => {
    expect(canManageCampaign(mktStaff('OWNER'), 'OWNER')).toBe(true);
    expect(canManageCampaign(mktStaff('OTHER'), 'OWNER')).toBe(false);
    expect(canManageCampaign(mktLead('L'), 'OWNER')).toBe(true);
    expect(canManageCampaign(director('D'), 'OWNER')).toBe(true);
    expect(canManageCampaign(salesStaff('S'), 'OWNER')).toBe(false);
    expect(canManageCampaign(od('O'), 'OWNER')).toBe(false);
  });
  it('canReassign: only Marketing lead/head or Director', () => {
    expect(canReassign(mktLead('L'))).toBe(true);
    expect(canReassign(director('D'))).toBe(true);
    expect(canReassign(mktStaff('OWNER'))).toBe(false);
    expect(canReassign(od('O'))).toBe(false);
  });
  it('canViewCampaign: OD/Director/lead see all; owning staff sees own', () => {
    expect(canViewCampaign(od('O'), 'OWNER')).toBe(true);
    expect(canViewCampaign(director('D'), 'OWNER')).toBe(true);
    expect(canViewCampaign(mktLead('L'), 'OWNER')).toBe(true);
    expect(canViewCampaign(mktStaff('OWNER'), 'OWNER')).toBe(true);
    expect(canViewCampaign(mktStaff('OTHER'), 'OWNER')).toBe(false);
    expect(canViewCampaign(salesStaff('S'), 'OWNER')).toBe(false);
  });
});

// ===========================================================================
// Integration.
// ===========================================================================

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

let seq = 0;
const uid = (p: string): string => `${p}-ZZ-${Date.now() % 100000}-${seq++}`;

async function registerEmp(id: string, jabatan: string, division: string, level: string, active = true): Promise<void> {
  await sql`insert into role_mappings (divisi, jabatan, division, level, created_by)
    values (${division}, ${jabatan}, ${division}, ${level}, 'ZZ-TEST') on conflict (divisi, jabatan) do nothing`;
  await sql`insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${id}, ${id}, ${id + '@mea.id'}, ${division}, ${jabatan}, ${active}, 'ZZ-TEST')
    on conflict (employee_id) do nothing`;
}

const validInput = (): CampaignInput => ({ name: 'Promo Skilskul Maret', channel: 'TikTok Ads', online: true, startDate: '2026-03-02' });

async function seedLead(id: string, phone: string, originCmp: string | null): Promise<void> {
  await sql`
    insert into leads (id, lead_name, phone_number, phone_norm, source, origin_division, origin_campaign_id, record_status, created_by)
    values (${id}, ${'Lead ' + id}, ${phone}, ${phone}, 'Leads - Iklan', 'Marketing', ${originCmp}, '[Pool]', 'ZZ-LIA')`;
}
async function seedAttempt(id: string, leadId: string, reached: boolean): Promise<void> {
  await sql`
    insert into prospect_attempts (id, lead_id, owner_employee_id, status, created_by)
    values (${id}, ${leadId}, 'ZZ-SAL', 'Contacted', 'ZZ-SAL')`;
  const action = reached ? 'transition:Contacted->Qualified' : 'transition:New Lead->Contacted';
  await sql`
    insert into audit_log (entity_type, entity_id, actor_employee_id, action, created_by)
    values ('prospect_attempt', ${id}, 'ZZ-SAL', ${action}, 'ZZ-SAL')`;
}
async function seedWonClient(clientId: string, trxId: string, originCmp: string, totalDecimal: string): Promise<void> {
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      origin_campaign_id, sales_pic_id, commission_payment_pic_id, transaction_id, created_by)
    values (${clientId}, 'P', 'T', 'K', 'L', 'C', '0.00', '0.00', ${originCmp}, 'ZZ-SAL', 'ZZ-SAL', ${trxId}, 'ZZ-SAL')`;
  await sql`
    insert into transactions (id, client_id, payment_intent_scheme, total_agreed_value, payment_status, created_by)
    values (${trxId}, ${clientId}, '[Bayar Penuh (Lunas)]', ${totalDecimal}, '[Lunas]', 'ZZ-SAL')`;
}

afterAll(async () => {
  if (sql) await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  await sql`delete from transactions where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
  await sql`delete from prospect_attempts where created_by like 'ZZ-%'`;
  await sql`delete from leads where created_by like 'ZZ-%'`;
  await sql`delete from campaigns where created_by like 'ZZ-%'`;
  await sql`delete from employees where created_by = 'ZZ-TEST'`;
  await sql`delete from role_mappings where created_by = 'ZZ-TEST'`;
});

describeDb('createCampaign', () => {
  it('validates BEFORE minting the id (no row, no sequence consumed), then mints CMP- born Draft', async () => {
    const lia = mktStaff('ZZ-LIA');
    await expect(createCampaign(sql, lia, { ...validInput(), name: '   ' })).rejects.toThrow(ValidationError);
    await expect(createCampaign(sql, lia, { ...validInput(), online: false, offline: false })).rejects.toThrow(ValidationError);

    // Mint-after-validation: the two failed creates wrote no campaign row at all.
    const rowsAfterFail = Number(
      (await sql<{ n: string }[]>`select count(*) as n from campaigns where created_by like 'ZZ-%'`)[0].n,
    );
    expect(rowsAfterFail).toBe(0);

    const c = await createCampaign(sql, lia, validInput());
    expect(c.id).toMatch(/^CMP-\d{6}-\d{4}$/);
    expect(c.status).toBe(STATUS_DRAFT);
    expect(c.owner).toBe('ZZ-LIA');
    expect(c.endDate).toBeNull();
  });

  it('is forbidden for non-Marketing / OD; Director may create and owns it', async () => {
    await expect(createCampaign(sql, salesStaff('ZZ-SAL'), validInput())).rejects.toThrow(ForbiddenError);
    await expect(createCampaign(sql, od('ZZ-OD'), validInput())).rejects.toThrow(ForbiddenError);
    const c = await createCampaign(sql, director('ZZ-DIR'), validInput());
    expect(c.owner).toBe('ZZ-DIR');
  });
});

describeDb('lifecycle (§3)', () => {
  it('legal path Draft→Active→Paused→Active→Closed→Archived; Closed stamps end_date', async () => {
    const owner = mktStaff('ZZ-LIA');
    const c = await createCampaign(sql, owner, validInput());
    for (const to of [STATUS_ACTIVE, STATUS_PAUSED, STATUS_ACTIVE, STATUS_CLOSED, STATUS_ARCHIVED]) {
      const res = await transitionCampaign(sql, owner, c.id, to);
      expect(res.ok).toBe(true);
    }
    const got = await getCampaign(sql, owner, c.id);
    expect(got.status).toBe(STATUS_ARCHIVED);
    expect(got.endDate).not.toBeNull(); // stamped on Closed (§6.3)
  });

  it('illegal edges blocked (Draft→Closed, Closed→Active, Archived→Active)', async () => {
    const owner = mktStaff('ZZ-LIA');
    const c = await createCampaign(sql, owner, validInput());
    let res = await transitionCampaign(sql, owner, c.id, STATUS_CLOSED);
    expect(res.ok).toBe(false); // Draft→Closed illegal
    await transitionCampaign(sql, owner, c.id, STATUS_ACTIVE);
    await transitionCampaign(sql, owner, c.id, STATUS_CLOSED);
    res = await transitionCampaign(sql, owner, c.id, STATUS_ACTIVE);
    expect(res.ok).toBe(false); // Closed→Active illegal
    await transitionCampaign(sql, owner, c.id, STATUS_ARCHIVED);
    res = await transitionCampaign(sql, owner, c.id, STATUS_ACTIVE);
    expect(res.ok).toBe(false); // Archived terminal
  });

  it('transition authority: other staff / Sales / OD denied; owner, lead, Director allowed', async () => {
    const c = await createCampaign(sql, mktStaff('ZZ-LIA'), validInput());
    await expect(transitionCampaign(sql, mktStaff('ZZ-DINA'), c.id, STATUS_ACTIVE)).rejects.toThrow(ForbiddenError);
    await expect(transitionCampaign(sql, salesStaff('ZZ-SAL'), c.id, STATUS_ACTIVE)).rejects.toThrow(ForbiddenError);
    await expect(transitionCampaign(sql, od('ZZ-OD'), c.id, STATUS_ACTIVE)).rejects.toThrow(ForbiddenError);
    expect((await transitionCampaign(sql, mktLead('ZZ-MHEAD'), c.id, STATUS_ACTIVE)).ok).toBe(true);
    expect((await transitionCampaign(sql, director('ZZ-DIR'), c.id, STATUS_PAUSED)).ok).toBe(true);
    expect((await transitionCampaign(sql, mktStaff('ZZ-LIA'), c.id, STATUS_ACTIVE)).ok).toBe(true);
  });
});

describeDb('Get/List visibility (§5)', () => {
  it('staff own-only; lead/OD/Director all; foreign division denied; missing → NotFound', async () => {
    const lia = mktStaff('ZZ-LIA');
    const dina = mktStaff('ZZ-DINA');
    const cLia = await createCampaign(sql, lia, validInput());
    const cDina = await createCampaign(sql, dina, validInput());

    const liaList = await listCampaigns(sql, lia);
    expect(liaList.map((c) => c.id)).toEqual([cLia.id]);
    await expect(getCampaign(sql, lia, cDina.id)).rejects.toThrow(ForbiddenError);

    expect((await listCampaigns(sql, mktLead('ZZ-MHEAD'))).length).toBeGreaterThanOrEqual(2);
    expect((await listCampaigns(sql, od('ZZ-OD'))).length).toBeGreaterThanOrEqual(2);
    expect((await listCampaigns(sql, director('ZZ-DIR'))).length).toBeGreaterThanOrEqual(2);

    await expect(listCampaigns(sql, salesStaff('ZZ-SAL'))).rejects.toThrow(ForbiddenError);
    await expect(getCampaign(sql, salesStaff('ZZ-SAL'), cLia.id)).rejects.toThrow(ForbiddenError);
    await expect(getCampaign(sql, lia, 'CMP-000000-9999')).rejects.toThrow(NotFoundError);
  });
});

describeDb('reassign (§5 Rule 1/3 / M3-OA-6)', () => {
  it('authority + target validation + ownership handover + append-only audit', async () => {
    await registerEmp('ZZ-LIA', 'Marketing Staff', MARKETING_DIVISION, 'staff');
    await registerEmp('ZZ-DINA', 'Marketing Staff', MARKETING_DIVISION, 'staff');
    await registerEmp('ZZ-INACT', 'Marketing Staff', MARKETING_DIVISION, 'staff', false);
    await registerEmp('ZZ-SAL', 'Sales Executive', 'Sales', 'staff');

    const lia = mktStaff('ZZ-LIA');
    const c = await createCampaign(sql, lia, validInput());

    // Staff (even owner) & OD cannot reassign.
    await expect(reassignCampaign(sql, lia, c.id, 'ZZ-DINA')).rejects.toThrow(ForbiddenError);
    await expect(reassignCampaign(sql, od('ZZ-OD'), c.id, 'ZZ-DINA')).rejects.toThrow(ForbiddenError);
    // Target must be an active Marketing employee.
    await expect(reassignCampaign(sql, mktLead('ZZ-MHEAD'), c.id, 'ZZ-SAL')).rejects.toThrow(NotFoundError);
    await expect(reassignCampaign(sql, mktLead('ZZ-MHEAD'), c.id, 'ZZ-INACT')).rejects.toThrow(NotFoundError);
    await expect(reassignCampaign(sql, mktLead('ZZ-MHEAD'), c.id, '  ')).rejects.toThrow(ValidationError);

    // Lead reassigns Lia → Dina; visibility follows ownership.
    const got = await reassignCampaign(sql, mktLead('ZZ-MHEAD'), c.id, 'ZZ-DINA');
    expect(got.owner).toBe('ZZ-DINA');
    await expect(getCampaign(sql, mktStaff('ZZ-DINA'), c.id)).resolves.toBeTruthy();
    await expect(getCampaign(sql, lia, c.id)).rejects.toThrow(ForbiddenError);
    // Director may also reassign.
    await expect(reassignCampaign(sql, director('ZZ-DIR'), c.id, 'ZZ-LIA')).resolves.toBeTruthy();

    const n = Number(
      (await sql<{ n: string }[]>`select count(*) as n from audit_log where entity_type='campaign' and entity_id=${c.id}`)[0].n,
    );
    expect(n).toBeGreaterThanOrEqual(3); // create + ≥2 owner_reassigned
  });
});

describeDb('audit append-only trail', () => {
  it('create + transitions + set_end_date + reassign append; UPDATE of a row rejected', async () => {
    await registerEmp('ZZ-DINA', 'Marketing Staff', MARKETING_DIVISION, 'staff');
    const lia = mktStaff('ZZ-LIA');
    const c = await createCampaign(sql, lia, validInput());
    await transitionCampaign(sql, lia, c.id, STATUS_ACTIVE);
    await transitionCampaign(sql, lia, c.id, STATUS_CLOSED); // transition + set_end_date
    await reassignCampaign(sql, mktLead('ZZ-MHEAD'), c.id, 'ZZ-DINA');

    const n = Number(
      (await sql<{ n: string }[]>`select count(*) as n from audit_log where entity_type='campaign' and entity_id=${c.id}`)[0].n,
    );
    expect(n).toBeGreaterThanOrEqual(5); // create + 2 transitions + set_end_date + owner_reassigned
    // The immutability trigger forbids UPDATE of an audit row.
    await expect(sql`update audit_log set action='x' where entity_type='campaign' and entity_id=${c.id}`).rejects.toThrow();
  });
});

describeDb('rollup (§4 Rule 4 / §6.3)', () => {
  it('recomputes leads/real-leads/clients-won/total-value from the linkage fixture; excludes other campaigns', async () => {
    const cmp = await createCampaign(sql, mktStaff('ZZ-LIA'), validInput());
    await transitionCampaign(sql, mktStaff('ZZ-LIA'), cmp.id, STATUS_ACTIVE);
    const other = await createCampaign(sql, mktStaff('ZZ-LIA'), validInput());

    await seedLead('ZZ-LEAD-1', '0811000001', cmp.id);
    await seedLead('ZZ-LEAD-2', '0811000002', cmp.id);
    await seedLead('ZZ-LEAD-3', '0811000003', cmp.id);
    await seedLead('ZZ-LEAD-X', '0811000009', other.id);
    await seedAttempt('ZZ-PRSP-1', 'ZZ-LEAD-1', true);
    await seedAttempt('ZZ-PRSP-2', 'ZZ-LEAD-2', false);
    await seedAttempt('ZZ-PRSP-X', 'ZZ-LEAD-X', true); // real, but on the other campaign

    await seedWonClient('ZZ-CLI-1', 'ZZ-TRX-1', cmp.id, '21900000.00');
    await seedWonClient('ZZ-CLI-2', 'ZZ-TRX-2', cmp.id, '5000000.00');
    await seedWonClient('ZZ-CLI-X', 'ZZ-TRX-X', other.id, '9999999.00');

    const roll = await campaignRollup(sql, mktStaff('ZZ-LIA'), cmp.id);
    expect(roll.leadsGenerated).toBe(3);
    expect(roll.realLeads).toBe(1);
    expect(roll.clientsWon).toBe(2);
    expect(roll.totalValueWon).toBe('26900000.00');
    expect(roll.totalValueWonIdr).toBe(money.format(money.parse('26900000.00')));
  });

  it('empty campaign rolls up to zeros and Rp. 0,00', async () => {
    const cmp = await createCampaign(sql, mktStaff('ZZ-LIA'), validInput());
    const roll = await campaignRollup(sql, mktStaff('ZZ-LIA'), cmp.id);
    expect(roll).toMatchObject({ leadsGenerated: 0, realLeads: 0, clientsWon: 0, totalValueWon: '0.00' });
  });

  it('reuses the §5 read gate: non-owner staff forbidden, missing not-found, OD may read', async () => {
    const cmp = await createCampaign(sql, mktStaff('ZZ-LIA'), validInput());
    await expect(campaignRollup(sql, mktStaff('ZZ-DINA'), cmp.id)).rejects.toThrow(ForbiddenError);
    await expect(campaignRollup(sql, mktStaff('ZZ-LIA'), 'CMP-999999-9999')).rejects.toThrow(NotFoundError);
    await expect(campaignRollup(sql, od('ZZ-OD'), cmp.id)).resolves.toBeTruthy();
  });
});
