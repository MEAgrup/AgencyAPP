/**
 * Tests for M2 Marketing (marketing.ts). Ported from Go's
 * archive/backend-go/internal/module2_marketing/{marketing,metrics}_test.go.
 *
 * - Unit: the §3 Rule 5 / §5 Rule 3 manage gate (owner-only, not any-lead).
 * - Integration (skipped unless DATABASE_URL is set): record create/edit validation +
 *   1:1 duplicate + permissions + append-only audit + get visibility, and the derived
 *   Auto-Metrics (worked example recompute, last-touch↔origin divergence, 3-month
 *   window, div-zero "—", Collected-ROAS, junk breakdown, dashboard split).
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { campaignRollup, createCampaign, MARKETING_DIVISION, STATUS_ACTIVE, STATUS_CLOSED, transitionCampaign } from './campaign';
import {
  canManageRecord,
  createRecord,
  dashboard,
  DuplicateError,
  ForbiddenError,
  getRecord,
  metrics,
  MSG_DUPLICATE,
  MSG_FORBIDDEN,
  MSG_INCOMPLETE,
  MSG_NOT_FOUND,
  NotFoundError,
  updateBudget,
  ValidationError,
  type Actor,
} from './marketing';

const mktStaff = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: MARKETING_DIVISION, level: 'staff' }) });
const mktLead = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: MARKETING_DIVISION, level: 'lead' }) });
const salesStaff = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Sales', level: 'staff' }) });
const od = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Management', level: 'staff', od: true }) });
const director = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Management', level: 'staff', director: true }) });

// ===========================================================================
// Unit.
// ===========================================================================

describe('canManageRecord (§3 Rule 5 / §5 Rule 3)', () => {
  it('owner (staff or lead) + Director manage; non-owner lead / OD / other division cannot', () => {
    expect(canManageRecord(mktStaff('OWNER'), 'OWNER')).toBe(true);
    expect(canManageRecord(mktLead('OWNER'), 'OWNER')).toBe(true); // lead who OWNS
    expect(canManageRecord(director('D'), 'OWNER')).toBe(true);
    expect(canManageRecord(mktLead('OTHER'), 'OWNER')).toBe(false); // non-owning lead read-only
    expect(canManageRecord(mktStaff('OTHER'), 'OWNER')).toBe(false);
    expect(canManageRecord(od('O'), 'OWNER')).toBe(false);
    expect(canManageRecord(salesStaff('S'), 'OWNER')).toBe(false);
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
/** ph returns a unique phone (leads.phone_norm is unique) so seeds never collide across runs. */
const ph = (): string => `08${Date.now() % 100000000}${seq++}`;
const validInput = () => ({ name: 'Promo Skilskul Maret', channel: 'TikTok Ads', online: true, startDate: '2026-03-02' });

/** A Draft campaign owned by owner. */
async function mustCampaign(owner: string): Promise<string> {
  return (await createCampaign(sql, mktStaff(owner), validInput())).id;
}
/** An Active campaign owned by owner with a performance record of the given budget. */
async function activeWithRecord(owner: string, budget: string): Promise<string> {
  const id = await mustCampaign(owner);
  await transitionCampaign(sql, mktStaff(owner), id, STATUS_ACTIVE);
  await createRecord(sql, mktStaff(owner), id, budget);
  return id;
}

async function seedLead(id: string, phone: string, origin: string | null, lastTouch: string | null): Promise<void> {
  await sql`
    insert into leads (id, lead_name, phone_number, phone_norm, source, origin_division,
      origin_campaign_id, last_touch_campaign_id, record_status, created_by)
    values (${id}, ${'Lead ' + id}, ${phone}, ${phone}, 'Leads - Iklan', 'Marketing', ${origin}, ${lastTouch}, '[Pool]', 'ZZ-LIA')`;
}
async function seedAttempt(id: string, leadId: string, reached: boolean): Promise<void> {
  await sql`insert into prospect_attempts (id, lead_id, owner_employee_id, status, created_by)
    values (${id}, ${leadId}, 'ZZ-SAL', 'Contacted', 'ZZ-SAL')`;
  const action = reached ? 'transition:Contacted->Qualified' : 'transition:New Lead->Contacted';
  await sql`insert into audit_log (entity_type, entity_id, actor_employee_id, action, created_by)
    values ('prospect_attempt', ${id}, 'ZZ-SAL', ${action}, 'ZZ-SAL')`;
}
async function seedNQReason(attemptId: string, reason: string, createdBy = 'ZZ-SAL'): Promise<void> {
  await sql`insert into prospect_attempt_nq_reasons (attempt_id, reason, created_by) values (${attemptId}, ${reason}, ${createdBy})`;
}
async function seedWonClient(clientId: string, trxId: string, leadId: string, origin: string, totalDec: string, winAt: Date): Promise<void> {
  await sql`
    insert into clients (id, lead_id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      origin_campaign_id, sales_pic_id, commission_payment_pic_id, transaction_id, created_at, created_by)
    values (${clientId}, ${leadId}, 'P', 'T', 'K', 'L', 'C', '0.00', '0.00', ${origin}, 'ZZ-SAL', 'ZZ-SAL', ${trxId}, ${winAt}, 'ZZ-SAL')`;
  await sql`
    insert into transactions (id, client_id, payment_intent_scheme, total_agreed_value, payment_status, created_by)
    values (${trxId}, ${clientId}, '[Bayar Penuh (Lunas)]', ${totalDec}, '[Lunas]', 'ZZ-SAL')`;
  await sql`
    insert into audit_log (entity_type, entity_id, actor_employee_id, action, created_at, created_by)
    values ('client', ${clientId}, 'ZZ-SAL', 'closing', ${winAt}, 'ZZ-SAL')`;
}
async function seedDirectVerification(trxId: string, amountDec: string): Promise<void> {
  await sql`insert into payment_verifications (transaction_id, installment_id, amount, received_date, verified_by, created_by)
    values (${trxId}, null, ${amountDec}, '2026-03-15', 'ZZ-FIN', 'ZZ-FIN')`;
}
async function seedVerifiedInstallment(instId: string, trxId: string, no: number, amountDec: string): Promise<void> {
  await sql`insert into installments (id, transaction_id, installment_no, amount, due_date, status, created_by)
    values (${instId}, ${trxId}, ${no}, ${amountDec}, '2026-04-01', '[Terverifikasi]', 'ZZ-FIN')`;
}

afterAll(async () => {
  if (sql) await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  await sql`delete from marketing_performance_records where created_by like 'ZZ-%'`;
  await sql`delete from payment_verifications where created_by like 'ZZ-%'`;
  await sql`delete from installments where created_by like 'ZZ-%'`;
  await sql`delete from transactions where created_by like 'ZZ-%'`;
  // By attempt, not by the reason row's own created_by: L5 (Revisi Sales/
  // Creative/Performa) tests seed a SISTEM-authored reason on a ZZ- attempt,
  // which the old `created_by like 'ZZ-%'` filter would leave behind and
  // then trip the FK on the next line.
  await sql`delete from prospect_attempt_nq_reasons where attempt_id in
    (select id from prospect_attempts where created_by like 'ZZ-%')`;
  await sql`delete from prospect_attempts where created_by like 'ZZ-%'`;
  await sql`delete from contracts where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
  await sql`delete from leads where created_by like 'ZZ-%'`;
  await sql`delete from campaigns where created_by like 'ZZ-%'`;
});

describeDb('createRecord', () => {
  it('budget validation: empty/0/negative/garbage → ValidationError, no row; valid → record + IDR + online/offline', async () => {
    const cid = await mustCampaign('ZZ-LIA');
    for (const bad of ['', '   ', '0', '0.00', '-5000000', 'abc']) {
      await expect(createRecord(sql, mktStaff('ZZ-LIA'), cid, bad)).rejects.toThrow(ValidationError);
    }
    const n = Number((await sql<{ n: string }[]>`select count(*) as n from marketing_performance_records where campaign_id=${cid}`)[0].n);
    expect(n).toBe(0);

    const rec = await createRecord(sql, mktStaff('ZZ-LIA'), cid, '5000000');
    expect(rec.budget).toBe('5000000.00');
    expect(rec.budgetIdr).toBe('Rp. 5.000.000,00');
    expect(rec.online).toBe(true);
    expect(rec.offline).toBe(false);
  });

  it('1:1 duplicate rejected; the first budget is unchanged', async () => {
    const cid = await mustCampaign('ZZ-LIA');
    await createRecord(sql, mktStaff('ZZ-LIA'), cid, '5000000');
    await expect(createRecord(sql, mktStaff('ZZ-LIA'), cid, '9000000')).rejects.toThrow(DuplicateError);
    const dec = (await sql<{ budget: string }[]>`select budget from marketing_performance_records where campaign_id=${cid}`)[0].budget;
    expect(dec).toBe('5000000.00');
  });

  it('permissions: non-owner staff / non-owning lead / OD / Sales denied; owner & Director allowed; missing → NotFound', async () => {
    const cid = await mustCampaign('ZZ-LIA'); // owned by Lia
    await expect(createRecord(sql, mktStaff('ZZ-DINA'), cid, '5000000')).rejects.toThrow(ForbiddenError);
    await expect(createRecord(sql, mktLead('ZZ-MHEAD'), cid, '5000000')).rejects.toThrow(ForbiddenError);
    await expect(createRecord(sql, od('ZZ-OD'), cid, '5000000')).rejects.toThrow(ForbiddenError);
    await expect(createRecord(sql, salesStaff('ZZ-SAL'), cid, '5000000')).rejects.toThrow(ForbiddenError);
    await expect(createRecord(sql, mktStaff('ZZ-LIA'), cid, '5000000')).resolves.toBeTruthy();

    const dcid = await mustCampaign('ZZ-LIA');
    await expect(createRecord(sql, director('ZZ-DIR'), dcid, '3000000')).resolves.toBeTruthy();
    await expect(createRecord(sql, mktStaff('ZZ-LIA'), 'CMP-000000-9999', '5000000')).rejects.toThrow(NotFoundError);
  });

  it('a Marketing lead who OWNS the campaign may create/edit its record', async () => {
    const c = await createCampaign(sql, mktLead('ZZ-MHEAD'), validInput());
    await expect(createRecord(sql, mktLead('ZZ-MHEAD'), c.id, '5000000')).resolves.toBeTruthy();
    await expect(updateBudget(sql, mktLead('ZZ-MHEAD'), c.id, '7000000')).resolves.toBeTruthy();
  });
});

describeDb('updateBudget + audit', () => {
  it('validates, gates to owner, and appends a before→after audit row', async () => {
    const cid = await mustCampaign('ZZ-LIA');
    await createRecord(sql, mktStaff('ZZ-LIA'), cid, '5000000');
    await expect(updateBudget(sql, mktStaff('ZZ-LIA'), cid, '0')).rejects.toThrow(ValidationError);
    await expect(updateBudget(sql, mktLead('ZZ-MHEAD'), cid, '9000000')).rejects.toThrow(ForbiddenError);
    await expect(updateBudget(sql, od('ZZ-OD'), cid, '9000000')).rejects.toThrow(ForbiddenError);
    const rec = await updateBudget(sql, mktStaff('ZZ-LIA'), cid, '9000000');
    expect(rec.budget).toBe('9000000.00');
    const audit = await sql<{ before_json: unknown; after_json: unknown }[]>`
      select before_json, after_json from audit_log
       where entity_type='marketing_performance_record' and entity_id=${cid} and action='budget_edited'`;
    expect(audit.length).toBe(1);
  });

  it('history is append-only: create + 2 edits = 3 rows', async () => {
    const cid = await mustCampaign('ZZ-LIA');
    await createRecord(sql, mktStaff('ZZ-LIA'), cid, '5000000');
    await updateBudget(sql, mktStaff('ZZ-LIA'), cid, '7000000');
    await updateBudget(sql, mktStaff('ZZ-LIA'), cid, '8000000');
    const n = Number(
      (await sql<{ n: string }[]>`select count(*) as n from audit_log where entity_type='marketing_performance_record' and entity_id=${cid}`)[0].n,
    );
    expect(n).toBe(3);
  });
});

describeDb('getRecord visibility (§5)', () => {
  it('owner/lead/OD read; non-owner staff denied; visible campaign without a record → NotFound', async () => {
    const cid = await mustCampaign('ZZ-LIA');
    await createRecord(sql, mktStaff('ZZ-LIA'), cid, '5000000');
    await expect(getRecord(sql, mktStaff('ZZ-LIA'), cid)).resolves.toBeTruthy();
    await expect(getRecord(sql, mktLead('ZZ-MHEAD'), cid)).resolves.toBeTruthy();
    await expect(getRecord(sql, od('ZZ-OD'), cid)).resolves.toBeTruthy();
    await expect(getRecord(sql, mktStaff('ZZ-DINA'), cid)).rejects.toThrow(ForbiddenError);
    const empty = await mustCampaign('ZZ-LIA');
    await expect(getRecord(sql, mktStaff('ZZ-LIA'), empty)).rejects.toThrow(NotFoundError);
  });
});

describeDb('M2-G5 — verbatim BI messages on every error path', () => {
  // The BI constants are byte-exact (§3 Rule 4 / house rule 5); this pins the actual
  // `err.message` each path throws, not just its error class (M2-G5).
  const msg = async (p: Promise<unknown>): Promise<string> => {
    try {
      await p;
      return '<no throw>';
    } catch (e) {
      return (e as Error).message;
    }
  };
  it('incomplete / forbidden / not-found / duplicate carry the exact bracketed strings', async () => {
    const cid = await mustCampaign('ZZ-LIA');
    expect(await msg(createRecord(sql, mktStaff('ZZ-LIA'), cid, '0'))).toBe(MSG_INCOMPLETE);
    expect(await msg(createRecord(sql, mktStaff('ZZ-DINA'), cid, '5000000'))).toBe(MSG_FORBIDDEN);
    expect(await msg(createRecord(sql, mktStaff('ZZ-LIA'), 'CMP-000000-9999', '5000000'))).toBe(MSG_NOT_FOUND);
    await createRecord(sql, mktStaff('ZZ-LIA'), cid, '5000000');
    expect(await msg(createRecord(sql, mktStaff('ZZ-LIA'), cid, '9000000'))).toBe(MSG_DUPLICATE);
    // getRecord: visible campaign without a record → not-found; non-owner staff → forbidden.
    const empty = await mustCampaign('ZZ-LIA');
    expect(await msg(getRecord(sql, mktStaff('ZZ-LIA'), empty))).toBe(MSG_NOT_FOUND);
    expect(await msg(getRecord(sql, mktStaff('ZZ-DINA'), cid))).toBe(MSG_FORBIDDEN);
    // updateBudget: bad budget → incomplete; non-owning lead → forbidden.
    expect(await msg(updateBudget(sql, mktStaff('ZZ-LIA'), cid, '-1'))).toBe(MSG_INCOMPLETE);
    expect(await msg(updateBudget(sql, mktLead('ZZ-MHEAD'), cid, '9000000'))).toBe(MSG_FORBIDDEN);
  });
});

describeDb('M2-G6 — audit history is immutable at the DB (not just append-only)', () => {
  // The append-only tests above prove no code PATH mutates history; this proves the DB
  // itself rejects an UPDATE/DELETE on the audit row, via the house-wide forbid_mutation()
  // trigger (init.sql audit_log_no_update / _no_delete). Belt to the code's suspenders.
  it('UPDATE and DELETE on a marketing-record audit row are rejected by forbid_mutation()', async () => {
    const cid = await mustCampaign('ZZ-LIA');
    await createRecord(sql, mktStaff('ZZ-LIA'), cid, '5000000');
    const row = await sql<{ id: string }[]>`
      select id from audit_log where entity_type='marketing_performance_record' and entity_id=${cid} limit 1`;
    expect(row.length).toBe(1);
    await expect(sql`update audit_log set action='tampered' where id=${row[0].id}`).rejects.toThrow(/append-only\/immutable/);
    await expect(sql`delete from audit_log where id=${row[0].id}`).rejects.toThrow(/append-only\/immutable/);
    // The row is still there, unchanged.
    const still = await sql<{ action: string }[]>`select action from audit_log where id=${row[0].id}`;
    expect(still[0].action).toBe('create');
  });
});

describeDb('Auto-Metrics (§4) recompute-from-log', () => {
  it('worked example: 46 leads, 12 real, 3 wins Rp 21.9M on budget Rp 5M', async () => {
    const cid = await activeWithRecord('ZZ-LIA', '5000000');
    const win = new Date(Date.UTC(2026, 2, 20, 10, 0, 0));
    const leadIds: string[] = [];
    for (let i = 0; i < 46; i++) {
      const lid = uid('LEAD');
      leadIds.push(lid);
      await seedLead(lid, ph(), cid, cid);
      await seedAttempt(uid('PRSP'), lid, i < 12);
    }
    await seedWonClient(uid('CLI'), uid('TRX'), leadIds[0], cid, '9000000.00', win);
    await seedWonClient(uid('CLI'), uid('TRX'), leadIds[1], cid, '6900000.00', win);
    await seedWonClient(uid('CLI'), uid('TRX'), leadIds[2], cid, '6000000.00', win);

    const m = await metrics(sql, mktStaff('ZZ-LIA'), cid);
    expect(m.owner).toBe('ZZ-LIA'); // M2-G1: dashboard can compare across staff (§5 Rule 2)
    expect(m.leadByDashboard).toBe(46);
    expect(m.leadRealBySales).toBe(12);
    expect(m.leadQualityRate).toBe('26%'); // 12/46 = 26.08 → 26%
    expect(m.attributedSales).toBe('Rp. 21.900.000,00');
    expect(m.attributedSalesDecimal).toBe('21900000.00');
    expect(m.roas).toBe('4.38'); // 21.9M / 5M
    expect(m.costPerLead).toBe('Rp. 108.695,00'); // 5M/46
    expect(m.costPerRealLead).toBe('Rp. 416.666,00'); // 5M/12
    expect(m.budgetIdr).toBe('Rp. 5.000.000,00');
  });

  it('last-touch diverges from origin (M2-OA-2): M2 credits last-touch, M3 rollup credits origin', async () => {
    const origin = await activeWithRecord('ZZ-LIA', '1000000');
    const lastTouch = await activeWithRecord('ZZ-LIA', '1000000');
    const win = new Date(Date.UTC(2026, 3, 10, 0, 0, 0));
    const lead = uid('LEAD');
    await seedLead(lead, ph(), origin, lastTouch);
    await seedWonClient(uid('CLI'), uid('TRX'), lead, origin, '8000000.00', win);

    expect((await metrics(sql, mktStaff('ZZ-LIA'), lastTouch)).attributedSalesDecimal).toBe('8000000.00');
    expect((await metrics(sql, mktStaff('ZZ-LIA'), origin)).attributedSalesDecimal).toBe('0.00');
    // M3 rollup mirror image: origin credited, last-touch not.
    const roll = await campaignRollup(sql, mktStaff('ZZ-LIA'), origin);
    expect(roll.clientsWon).toBe(1);
    expect(roll.totalValueWon).toBe('8000000.00');
    expect((await campaignRollup(sql, mktStaff('ZZ-LIA'), lastTouch)).clientsWon).toBe(0);
  });

  it('3-month post-Close window (M3-OA-4): in-window win credited, beyond-window excluded', async () => {
    const owner = mktStaff('ZZ-LIA');
    const cid = await mustCampaign('ZZ-LIA');
    await transitionCampaign(sql, owner, cid, STATUS_ACTIVE);
    await createRecord(sql, owner, cid, '1000000');
    const leadIn = uid('LEAD');
    const leadOut = uid('LEAD');
    await seedLead(leadIn, ph(), cid, cid);
    await seedLead(leadOut, ph(), cid, cid);
    await transitionCampaign(sql, owner, cid, STATUS_CLOSED);
    const end = await campaignEndDate(cid);
    const inWin = addMonths(end, 2);
    const outWin = addMonths(end, 4);
    await seedWonClient(uid('CLI'), uid('TRX'), leadIn, cid, '5000000.00', inWin);
    await seedWonClient(uid('CLI'), uid('TRX'), leadOut, cid, '9000000.00', outWin);

    const m = await metrics(sql, owner, cid);
    expect(m.attributedSalesDecimal).toBe('5000000.00'); // only the in-window win
  });

  it('div-zero renders "—" but attributed 0 / budget is a valid 0.00 ROAS', async () => {
    const cid = await activeWithRecord('ZZ-LIA', '5000000');
    const m = await metrics(sql, mktStaff('ZZ-LIA'), cid);
    expect(m.costPerLead).toBe('—');
    expect(m.costPerRealLead).toBe('—');
    expect(m.leadQualityRate).toBe('—');
    expect(m.roas).toBe('0.00'); // 0 / 5M, not div-zero
    expect(m.attributedSales).toBe('Rp. 0,00');
  });

  it('Collected-ROAS uses only verified-received (M2-OA-5): booked 10M, verified 4M', async () => {
    const cid = await activeWithRecord('ZZ-LIA', '2000000');
    const win = new Date(Date.UTC(2026, 2, 20, 0, 0, 0));
    const lead = uid('LEAD');
    const trx = uid('TRX');
    await seedLead(lead, ph(), cid, cid);
    await seedWonClient(uid('CLI'), trx, lead, cid, '10000000.00', win);
    await seedDirectVerification(trx, '2000000.00');
    await seedVerifiedInstallment(uid('INST'), trx, 1, '2000000.00');

    const m = await metrics(sql, mktStaff('ZZ-LIA'), cid);
    expect(m.attributedSalesDecimal).toBe('10000000.00');
    expect(m.roas).toBe('5.00'); // 10M / 2M
    expect(m.collectedSalesDecimal).toBe('4000000.00'); // 2M + 2M
    expect(m.collectedRoas).toBe('2.00'); // 4M / 2M
  });

  it('junk breakdown: NQ reason counts for own campaign, ordered count desc, other campaign excluded', async () => {
    const cid = await activeWithRecord('ZZ-LIA', '5000000');
    const other = await activeWithRecord('ZZ-LIA', '5000000');
    const leadA = uid('LEAD');
    const leadB = uid('LEAD');
    const leadZ = uid('LEAD');
    const prspA = uid('PRSP');
    const prspB = uid('PRSP');
    const prspZ = uid('PRSP');
    await seedLead(leadA, ph(), cid, cid);
    await seedLead(leadB, ph(), cid, cid);
    await seedLead(leadZ, ph(), other, other);
    await seedAttempt(prspA, leadA, false);
    await seedAttempt(prspB, leadB, false);
    await seedAttempt(prspZ, leadZ, false);
    await seedNQReason(prspA, '[Bukan seller]');
    await seedNQReason(prspA, '[Tidak ada respon]');
    await seedNQReason(prspB, '[Bukan seller]');
    await seedNQReason(prspZ, '[Kontak salah]');

    const m = await metrics(sql, mktStaff('ZZ-LIA'), cid);
    expect(m.junkBreakdown).toEqual([
      { reason: '[Bukan seller]', count: 2 },
      { reason: '[Tidak ada respon]', count: 1 },
    ]);
  });

  it('junk breakdown excludes SISTEM-authored reasons (L5, Revisi Sales/Creative/Performa)', async () => {
    // A lead the daily leads_unrespon_tick job auto-closed (L1/L3) for simply
    // sitting untouched is not a judgment call about THIS campaign's lead
    // quality — counting it would measure sales inattention as if it were junk.
    const cid = await activeWithRecord('ZZ-LIA', '5000000');
    const leadHuman = uid('LEAD');
    const leadAuto = uid('LEAD');
    const prspHuman = uid('PRSP');
    const prspAuto = uid('PRSP');
    await seedLead(leadHuman, ph(), cid, cid);
    await seedLead(leadAuto, ph(), cid, cid);
    await seedAttempt(prspHuman, leadHuman, false);
    await seedAttempt(prspAuto, leadAuto, false);
    await seedNQReason(prspHuman, '[Bukan seller]', 'ZZ-SAL');
    await seedNQReason(prspAuto, '[Tidak ada respon]', 'SISTEM');

    const m = await metrics(sql, mktStaff('ZZ-LIA'), cid);
    expect(m.junkBreakdown).toEqual([{ reason: '[Bukan seller]', count: 1 }]);
  });
});

describeDb('dashboard split (§5)', () => {
  it('staff own-only; lead/OD all; Sales denied; campaign without a record shows "—"', async () => {
    const lia = await activeWithRecord('ZZ-LIA', '5000000');
    await activeWithRecord('ZZ-DINA', '3000000');

    const liaList = await dashboard(sql, mktStaff('ZZ-LIA'));
    expect(liaList.map((m) => m.campaignId)).toEqual([lia]);
    expect(liaList[0].owner).toBe('ZZ-LIA');
    // M2-G1: the Lead board carries each campaign's owner, so it can compare across staff (§5 Rule 2).
    const leadList = await dashboard(sql, mktLead('ZZ-MHEAD'));
    expect(leadList.length).toBeGreaterThanOrEqual(2);
    expect(leadList.map((m) => m.owner)).toEqual(expect.arrayContaining(['ZZ-LIA', 'ZZ-DINA']));
    expect((await dashboard(sql, od('ZZ-OD'))).length).toBeGreaterThanOrEqual(2);
    // M2-G7: exercise the READ path (dashboard + metrics) for a Director — the layered
    // Director role gets full, read-only breadth like OD/lead (§5 Rule 3 / house rule 6),
    // which the read gate had asserted only on the write path (createRecord) before.
    const dirList = await dashboard(sql, director('ZZ-DIR'));
    expect(dirList.length).toBeGreaterThanOrEqual(2);
    expect(dirList.map((m) => m.campaignId)).toEqual(expect.arrayContaining([lia]));
    expect((await metrics(sql, director('ZZ-DIR'), lia)).owner).toBe('ZZ-LIA');
    await expect(dashboard(sql, salesStaff('ZZ-SAL'))).rejects.toThrow(ForbiddenError);

    const noRec = await createCampaign(sql, mktStaff('ZZ-LIA'), validInput());
    const list = await dashboard(sql, mktStaff('ZZ-LIA'));
    const card = list.find((m) => m.campaignId === noRec.id);
    expect(card?.budgetIdr).toBe('—');
    expect(card?.costPerLead).toBe('—');
    expect(card?.roas).toBe('—');
  });
});

/** campaignEndDate reads the stamped end_date (WIB) of a Closed campaign as a Date at UTC midnight. */
async function campaignEndDate(campaignId: string): Promise<Date> {
  const rows = await sql<{ end_date: string | Date }[]>`select end_date from campaigns where id = ${campaignId}`;
  const s = rows[0].end_date instanceof Date ? rows[0].end_date.toISOString().slice(0, 10) : String(rows[0].end_date).slice(0, 10);
  return new Date(`${s}T00:00:00Z`);
}
/** addMonths adds whole months to a Date (UTC), normalizing overflow (mirrors the domain's window math). */
function addMonths(d: Date, months: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()));
}
