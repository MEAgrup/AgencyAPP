/**
 * Tests for the M5 read models + schedule creation ported to close O41:
 * financeQueue / loadTransactionAggregate / createSchedule / bermasalahStatus.
 *
 * - Unit: the three permission matrices, which are the whole reason these reads
 *   403 instead of returning an empty list.
 * - Integration (skipped unless DATABASE_URL is set): the aggregates against a
 *   migrated Postgres. Ids are namespaced `ZZ-` and cleaned up in afterEach.
 *
 * NOTE these run WITHOUT RLS (the domain gets a plain client), which is exactly
 * the point for the Account arm: `transactions_select` has no released-only
 * clause, so if the app-layer filter regressed, only a test at this level would
 * catch it.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { money, permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { leads, sales } from './index';
import {
  attachContract,
  bermasalahStatus,
  canCreateSchedule,
  canReadFinanceQueue,
  canReadTransaction,
  createSchedule,
  financeQueue,
  flagBermasalah,
  ForbiddenError,
  IncompleteError,
  loadTransactionAggregate,
  NoOutstandingError,
  NotFoundError,
  OutstandingTotalError,
  reminderDashboard,
  resolveBermasalah,
  ScheduleExistsError,
  scheduleOutstanding,
  ScheduleTotalError,
  SchemeNoScheduleError,
  type Actor,
  verifyPayment,
  VOTE_APPROVE,
  VOTE_REJECT,
} from './finance';

const financeStaff = (): Actor => ({
  employeeId: 'ZZ-FIN', divisi: 'Finance',
  role: permission.makeRole({ division: 'Finance', level: 'staff' }),
});
const financeLead = (): Actor => ({
  employeeId: 'ZZ-FINLEAD', divisi: 'Finance',
  role: permission.makeRole({ division: 'Finance', level: 'lead' }),
});
const director = (): Actor => ({
  employeeId: 'ZZ-DIR', divisi: 'Management',
  role: permission.makeRole({ director: true }),
});
const od = (): Actor => ({
  employeeId: 'ZZ-OD', divisi: 'Management',
  role: permission.makeRole({ od: true }),
});
const accountLead = (): Actor => ({
  employeeId: 'ZZ-ACCLEAD', divisi: 'Account',
  role: permission.makeRole({ division: 'Account', level: 'lead' }),
});
const salesLead = (): Actor => ({
  employeeId: 'ZZ-SLEAD', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'lead' }),
});
const budi = (): Actor => ({
  employeeId: 'ZZ-BUDI', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});
const creativeStaff = (): Actor => ({
  employeeId: 'ZZ-CRE', divisi: 'Creative',
  role: permission.makeRole({ division: 'Creative', level: 'staff' }),
});

// ---------------------------------------------------------------------------
// Unit: permission matrices.
// ---------------------------------------------------------------------------
describe('canReadFinanceQueue (M5 §8.1)', () => {
  it('allows Finance at any level, OD, and Director', () => {
    expect(canReadFinanceQueue(financeStaff())).toBe(true);
    expect(canReadFinanceQueue(financeLead())).toBe(true);
    expect(canReadFinanceQueue(od())).toBe(true);
    expect(canReadFinanceQueue(director())).toBe(true);
  });

  it('denies Sales and Account — the queue is Finance-only', () => {
    expect(canReadFinanceQueue(budi())).toBe(false);
    expect(canReadFinanceQueue(salesLead())).toBe(false);
    expect(canReadFinanceQueue(accountLead())).toBe(false);
  });
});

describe('canReadTransaction (M5 §5)', () => {
  it('allows Finance, Sales, Account, OD, Director', () => {
    for (const a of [financeStaff(), budi(), salesLead(), accountLead(), od(), director()]) {
      expect(canReadTransaction(a)).toBe(true);
    }
  });

  it('denies a division with no Module 5 role at all', () => {
    expect(canReadTransaction(creativeStaff())).toBe(false);
  });
});

describe('canCreateSchedule (Go canManageIntent)', () => {
  it('allows Director and Finance unconditionally', () => {
    expect(canCreateSchedule(director(), 'ZZ-OTHER', false)).toBe(true);
    expect(canCreateSchedule(financeStaff(), 'ZZ-OTHER', false)).toBe(true);
  });

  it('allows a Sales lead, the own sales PIC, or an allocation member', () => {
    expect(canCreateSchedule(salesLead(), 'ZZ-OTHER', false)).toBe(true);
    expect(canCreateSchedule(budi(), 'ZZ-BUDI', false)).toBe(true);
    expect(canCreateSchedule(budi(), 'ZZ-OTHER', true)).toBe(true);
  });

  it('denies a Sales staff who is neither PIC nor allocation member, and other divisions', () => {
    expect(canCreateSchedule(budi(), 'ZZ-OTHER', false)).toBe(false);
    expect(canCreateSchedule(accountLead(), 'ZZ-OTHER', false)).toBe(false);
    expect(canCreateSchedule(creativeStaff(), 'ZZ-OTHER', false)).toBe(false);
  });

  it('denies a pure-OD account — read-only everywhere means no writes', () => {
    expect(canCreateSchedule(od(), 'ZZ-OD', true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration.
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

let seq = 0;
const uniquePhone = (): string => `0816${String(Date.now()).slice(-6)}${String(seq++).padStart(3, '0')}`;
const uniqueSvc = (): string => `SVC-ZZ-FR-${seq++}`;

async function seedService(id: string): Promise<string> {
  await sql`insert into master_services (id, created_by) values (${id}, 'ZZ-ADMIN')`;
  await sql`
    insert into master_service_versions
      (service_id, version_no, name, standard_price, commission_rule, active, effective_from, pricing_mode, created_by)
    values (${id}, 1, ${'Svc ' + id}, '9000000.00', '10% of standard price', true, '2020-01-01', 'flat', 'ZZ-ADMIN')`;
  return id;
}

/** Close a deal (Budi solo) under `scheme`, returning the birthed ids. */
async function closedDeal(
  scheme: string,
  installments?: { amount: string; dueDate: string }[],
): Promise<{ transactionId: string; clientId: string }> {
  const svc = await seedService(uniqueSvc());
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
    paymentScheme: scheme,
    installments,
  });
  return { transactionId: res.transactionId, clientId: res.clientId };
}

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  await sql`delete from transaction_issue_approvals where created_by like 'ZZ-%'`;
  await sql`delete from payment_verifications where created_by like 'ZZ-%'`;
  await sql`delete from installments where created_by like 'ZZ-%'`;
  await sql`delete from client_sales_allocations where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from transactions where created_by like 'ZZ-%'`;
  await sql`delete from client_platforms where created_by like 'ZZ-%'`;
  await sql`delete from contracts where created_by like 'ZZ-%'`;
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

describeDb('financeQueue', () => {
  it('lists a fresh [Menunggu Verifikasi] deal with derived amounts and the schedule', async () => {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_TERMIN, [
      { amount: '4000000', dueDate: '2026-07-01' },
      { amount: '5000000', dueDate: '2026-08-01' },
    ]);

    const rows = await financeQueue(sql, financeStaff());
    const mine = rows.find((r) => r.id === transactionId);
    expect(mine).toBeDefined();
    expect(mine!.paymentStatus).toBe('[Menunggu Verifikasi]');
    expect(money.parse(mine!.amountVerified)).toBe(0n);
    expect(money.parse(mine!.amountOutstanding)).toBe(money.parse('9000000'));
    expect(mine!.installments).toHaveLength(2);
    // proof_of_payment was the field missing from InstallmentRow entirely.
    expect(mine!.installments[0]).toHaveProperty('proofOfPayment');
  });

  /**
   * The QA report this replaces: Finance verified a PARTIAL payment and the
   * transaction disappeared from the only page they have, while the client had
   * already routed to Account (§5 releases on the first payment) — so the money
   * still owed became invisible exactly when chasing it became Finance's job. The
   * old assertion here locked that in ("drops a transaction once it leaves the
   * queue"), which is why the defect survived a green suite.
   */
  it('KEEPS a partially-verified transaction in the queue, with the shortfall visible', async () => {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_SEBAGIAN);
    await verifyPayment(sql, financeStaff(), {
      transactionId, amount: '4000000', receivedDate: '2026-06-03', proofOfPayment: 'https://drive/p1.pdf',
    });

    const trx = await loadTransactionAggregate(sql, financeStaff(), transactionId);
    expect(trx.paymentStatus).toBe('[Terverifikasi - Sebagian]');
    expect(money.parse(trx.amountVerified)).toBe(money.parse('4000000'));
    expect(money.parse(trx.amountOutstanding)).toBe(money.parse('5000000'));

    const row = (await financeQueue(sql, financeStaff())).find((r) => r.id === transactionId);
    expect(row, 'a partially-paid transaction must stay on Finance’s worklist').toBeDefined();
    expect(row!.paymentStatus).toBe('[Terverifikasi - Sebagian]');
    expect(money.parse(row!.amountOutstanding)).toBe(money.parse('5000000'));
  });

  it('drops a transaction only when it is [Lunas] — settlement is the single exit', async () => {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_SEBAGIAN);
    await attachContract(sql, financeStaff(), transactionId, 'https://drive/contract.pdf');
    await verifyPayment(sql, financeStaff(), { transactionId, amount: '4000000', receivedDate: '2026-06-03' });
    expect((await financeQueue(sql, financeStaff())).map((r) => r.id)).toContain(transactionId);

    await verifyPayment(sql, financeStaff(), { transactionId, amount: '5000000', receivedDate: '2026-06-20' });
    const settled = await loadTransactionAggregate(sql, financeStaff(), transactionId);
    expect(settled.paymentStatus).toBe('[Lunas]');
    expect((await financeQueue(sql, financeStaff())).map((r) => r.id)).not.toContain(transactionId);
  });

  it('orders awaiting-verification before partially-verified', async () => {
    // The partially-paid deal is created FIRST so it holds the LOWER id: plain
    // `order by id` would put it on top, so this only passes if status leads.
    const partial = await closedDeal(sales.PAYMENT_SCHEME_SEBAGIAN);
    await verifyPayment(sql, financeStaff(), {
      transactionId: partial.transactionId, amount: '1000000', receivedDate: '2026-06-03',
    });
    const fresh = await closedDeal(sales.PAYMENT_SCHEME_LUNAS);
    expect(fresh.transactionId > partial.transactionId).toBe(true);

    const ids = (await financeQueue(sql, financeStaff())).map((r) => r.id);
    expect(ids.indexOf(fresh.transactionId)).toBeLessThan(ids.indexOf(partial.transactionId));
  });

  it('403s for Sales rather than answering an empty list', async () => {
    await expect(financeQueue(sql, budi())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(financeQueue(sql, accountLead())).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describeDb('loadTransactionAggregate', () => {
  it('404s for an unknown id and 403s for a division with no M5 access', async () => {
    await expect(loadTransactionAggregate(sql, financeStaff(), 'TRX-000000-9999'))
      .rejects.toBeInstanceOf(NotFoundError);
    await expect(loadTransactionAggregate(sql, creativeStaff(), 'TRX-000000-9999'))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it('hides a pre-release transaction from Account, then reveals it after release (§5 Rule 2)', async () => {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_LUNAS);

    // Not released yet: Account gets NotFound (never Forbidden — that would
    // confirm the row exists). This is the arm RLS cannot express.
    await expect(loadTransactionAggregate(sql, accountLead(), transactionId))
      .rejects.toBeInstanceOf(NotFoundError);
    // Finance sees it all along.
    expect((await loadTransactionAggregate(sql, financeStaff(), transactionId)).id).toBe(transactionId);

    await attachContract(sql, financeStaff(), transactionId, 'https://drive/contract.pdf');
    await verifyPayment(sql, financeStaff(), {
      transactionId, amount: '9000000', receivedDate: '2026-06-03', proofOfPayment: 'https://drive/p.pdf',
    });

    const seen = await loadTransactionAggregate(sql, accountLead(), transactionId);
    expect(seen.id).toBe(transactionId);
    expect(seen.releasedToAccountAt).not.toBeNull();
  });
});

describeDb('createSchedule', () => {
  /** A [Termin] deal closed WITHOUT a schedule, so createSchedule has work to do. */
  async function terminWithoutSchedule(): Promise<string> {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_TERMIN, [
      { amount: '9000000', dueDate: '2026-07-01' },
    ]);
    await sql`delete from installments where transaction_id = ${transactionId}`;
    return transactionId;
  }

  it('mints the schedule at [Belum Jatuh Tempo] and audits the set once', async () => {
    const transactionId = await terminWithoutSchedule();
    const created = await createSchedule(sql, financeStaff(), transactionId, [
      { amount: '4000000', dueDate: '2026-07-01' },
      { amount: '5000000', dueDate: '2026-08-01' },
    ]);

    expect(created).toHaveLength(2);
    expect(created.map((i) => i.installmentNo)).toEqual([1, 2]);
    expect(created.every((i) => i.status === '[Belum Jatuh Tempo]')).toBe(true);
    expect(created.every((i) => i.id.startsWith('INST-'))).toBe(true);

    const audits = (await sql<{ action: string }[]>`
      select action from audit_log where entity_type = 'transaction' and entity_id = ${transactionId}`)
      .map((r) => r.action);
    expect(audits.filter((a) => a === 'schedule_created')).toHaveLength(1);
  });

  it('rejects a sum that is not exactly the agreed total, and burns no INST id', async () => {
    const transactionId = await terminWithoutSchedule();
    const before = await sql<{ next_n: string }[]>`
      select next_n::text from id_sequences where prefix = 'INST' and period = to_char(now() at time zone 'Asia/Jakarta', 'YYYYMM')`;

    await expect(createSchedule(sql, financeStaff(), transactionId, [
      { amount: '4000000', dueDate: '2026-07-01' },
      { amount: '4000000', dueDate: '2026-08-01' },
    ])).rejects.toBeInstanceOf(ScheduleTotalError);

    const after = await sql<{ next_n: string }[]>`
      select next_n::text from id_sequences where prefix = 'INST' and period = to_char(now() at time zone 'Asia/Jakarta', 'YYYYMM')`;
    // House rule #1: ids are minted only after validation passes.
    expect(after[0]?.next_n ?? '0').toBe(before[0]?.next_n ?? '0');
    const insts = await sql<{ id: string }[]>`select id from installments where transaction_id = ${transactionId}`;
    expect(insts).toHaveLength(0);
  });

  it('refuses a scheme that carries no schedule', async () => {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_LUNAS);
    await expect(createSchedule(sql, financeStaff(), transactionId, [
      { amount: '9000000', dueDate: '2026-07-01' },
    ])).rejects.toBeInstanceOf(SchemeNoScheduleError);
  });

  it('is not an upsert: a second call fails instead of replacing rows', async () => {
    const transactionId = await terminWithoutSchedule();
    await createSchedule(sql, financeStaff(), transactionId, [
      { amount: '9000000', dueDate: '2026-07-01' },
    ]);
    await expect(createSchedule(sql, financeStaff(), transactionId, [
      { amount: '4000000', dueDate: '2026-07-01' },
      { amount: '5000000', dueDate: '2026-08-01' },
    ])).rejects.toBeInstanceOf(ScheduleExistsError);

    const insts = await sql<{ id: string }[]>`select id from installments where transaction_id = ${transactionId}`;
    expect(insts).toHaveLength(1);
  });

  it('rejects an empty item list and a non-permitted actor', async () => {
    const transactionId = await terminWithoutSchedule();
    await expect(createSchedule(sql, financeStaff(), transactionId, [])).rejects.toBeTruthy();
    await expect(createSchedule(sql, creativeStaff(), transactionId, [
      { amount: '9000000', dueDate: '2026-07-01' },
    ])).rejects.toBeInstanceOf(ForbiddenError);
  });
});

/**
 * The second half of the QA report: once Finance can SEE the shortfall, they must
 * be able to put a date on it and have the system chase it (M5 §6). See
 * `scheduleOutstanding` for why this deviates from M5-OA-2.
 */
describeDb('scheduleOutstanding', () => {
  /** A [Bayar Sebagian] deal of Rp 9.000.000 with Rp 4.000.000 verified. */
  async function partiallyPaid(): Promise<string> {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_SEBAGIAN);
    await verifyPayment(sql, financeStaff(), {
      transactionId, amount: '4000000', receivedDate: '2026-06-03',
    });
    return transactionId;
  }

  it('dates the shortfall as installments and puts it on the reminder dashboard', async () => {
    const transactionId = await partiallyPaid();
    const created = await scheduleOutstanding(sql, financeStaff(), transactionId, [
      { amount: '2000000', dueDate: '2026-07-10' },
      { amount: '3000000', dueDate: '2026-08-10' },
    ]);

    expect(created).toHaveLength(2);
    expect(created.map((i) => i.installmentNo)).toEqual([1, 2]);
    expect(created.every((i) => i.status === '[Belum Jatuh Tempo]')).toBe(true);
    expect(created.every((i) => i.id.startsWith('INST-'))).toBe(true);
    expect(created.every((i) => money.parse(i.amountVerified) === 0n)).toBe(true);

    // The whole point: it is now chase-able. Both rows are overdue relative to a
    // clock past their due dates, so both surface with the §6 BI label.
    const dash = await reminderDashboard(sql, new Date('2026-09-01T05:00:00.000Z'));
    const mine = dash.overdue.filter((r) => r.transactionId === transactionId);
    expect(mine).toHaveLength(2);
    expect(mine[0].label).toMatch(/^\[jatuh tempo \d+ hari, segera tindak lanjuti\]$/);

    // …and it is no longer double-listed as open-ended (M5 §6 Rule 4 list).
    expect(dash.outstandingNoDueDate.map((o) => o.transactionId)).not.toContain(transactionId);

    const audits = (await sql<{ action: string }[]>`
      select action from audit_log where entity_type = 'transaction' and entity_id = ${transactionId}`)
      .map((r) => r.action);
    expect(audits.filter((a) => a === 'outstanding_schedule_created')).toHaveLength(1);
  });

  it('continues the installment numbering instead of reusing #1', async () => {
    // Termin: installment 1 paid in full, 2 written off the schedule so the
    // remainder needs a fresh date. #1 must keep meaning what it meant.
    const { transactionId, } = await closedDeal(sales.PAYMENT_SCHEME_TERMIN, [
      { amount: '4000000', dueDate: '2026-07-01' },
      { amount: '5000000', dueDate: '2026-08-01' },
    ]);
    const insts = await sql<{ id: string }[]>`
      select id from installments where transaction_id = ${transactionId} order by installment_no`;
    await verifyPayment(sql, financeStaff(), {
      transactionId, installmentId: insts[0].id, amount: '4000000', receivedDate: '2026-07-01',
    });
    await sql`delete from installments where id = ${insts[1].id}`;

    const created = await scheduleOutstanding(sql, financeStaff(), transactionId, [
      { amount: '5000000', dueDate: '2026-09-01' },
    ]);
    expect(created.map((i) => i.installmentNo)).toEqual([2]);
  });

  it('requires the schedule to sum EXACTLY to Amount Outstanding, and burns no INST id', async () => {
    const transactionId = await partiallyPaid();
    const before = await sql<{ next_n: string }[]>`
      select next_n::text from id_sequences where prefix = 'INST' and period = to_char(now() at time zone 'Asia/Jakarta', 'YYYYMM')`;

    // The agreed TOTAL (9.000.000) is deliberately wrong here — outstanding is 5.
    await expect(scheduleOutstanding(sql, financeStaff(), transactionId, [
      { amount: '9000000', dueDate: '2026-07-10' },
    ])).rejects.toBeInstanceOf(OutstandingTotalError);
    await expect(scheduleOutstanding(sql, financeStaff(), transactionId, [
      { amount: '4000000', dueDate: '2026-07-10' },
    ])).rejects.toBeInstanceOf(OutstandingTotalError);

    const after = await sql<{ next_n: string }[]>`
      select next_n::text from id_sequences where prefix = 'INST' and period = to_char(now() at time zone 'Asia/Jakarta', 'YYYYMM')`;
    expect(after[0]?.next_n ?? '0').toBe(before[0]?.next_n ?? '0'); // house rule #1
    expect(await sql`select id from installments where transaction_id = ${transactionId}`).toHaveLength(0);
  });

  it('carries the verbatim BI message, distinct from the agreed-total one', async () => {
    const transactionId = await partiallyPaid();
    await expect(scheduleOutstanding(sql, financeStaff(), transactionId, [
      { amount: '1000000', dueDate: '2026-07-10' },
    ])).rejects.toThrow('[total jadwal penagihan tidak sama dengan kekurangan pembayaran]');
  });

  it('refuses when there is nothing left to collect', async () => {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_SEBAGIAN);
    await attachContract(sql, financeStaff(), transactionId, 'https://drive/c.pdf');
    await verifyPayment(sql, financeStaff(), { transactionId, amount: '9000000', receivedDate: '2026-06-03' });
    await expect(scheduleOutstanding(sql, financeStaff(), transactionId, [
      { amount: '1000000', dueDate: '2026-07-10' },
    ])).rejects.toBeInstanceOf(NoOutstandingError);
  });

  it('refuses a second schedule while an installment is still open', async () => {
    const transactionId = await partiallyPaid();
    await scheduleOutstanding(sql, financeStaff(), transactionId, [
      { amount: '5000000', dueDate: '2026-07-10' },
    ]);
    await expect(scheduleOutstanding(sql, financeStaff(), transactionId, [
      { amount: '5000000', dueDate: '2026-08-10' },
    ])).rejects.toBeInstanceOf(ScheduleExistsError);
    expect(await sql`select id from installments where transaction_id = ${transactionId}`).toHaveLength(1);
  });

  it('is Finance/Director work — Sales, Account and OD cannot schedule a collection', async () => {
    const transactionId = await partiallyPaid();
    for (const actor of [budi(), salesLead(), accountLead(), od(), creativeStaff()]) {
      await expect(scheduleOutstanding(sql, actor, transactionId, [
        { amount: '5000000', dueDate: '2026-07-10' },
      ])).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect((await scheduleOutstanding(sql, director(), transactionId, [
      { amount: '5000000', dueDate: '2026-07-10' },
    ]))).toHaveLength(1);
  });

  it('rejects an empty list, a zero amount and a missing due date', async () => {
    const transactionId = await partiallyPaid();
    await expect(scheduleOutstanding(sql, financeStaff(), transactionId, []))
      .rejects.toBeInstanceOf(IncompleteError);
    await expect(scheduleOutstanding(sql, financeStaff(), transactionId, [
      { amount: '0', dueDate: '2026-07-10' },
    ])).rejects.toBeInstanceOf(IncompleteError);
    await expect(scheduleOutstanding(sql, financeStaff(), transactionId, [
      { amount: '5000000', dueDate: '' },
    ])).rejects.toBeInstanceOf(IncompleteError);
  });

  it('leaves the Payment Intent scheme alone — scheduling is not renegotiating', async () => {
    const transactionId = await partiallyPaid();
    await scheduleOutstanding(sql, financeStaff(), transactionId, [
      { amount: '5000000', dueDate: '2026-07-10' },
    ]);
    const trx = await loadTransactionAggregate(sql, financeStaff(), transactionId);
    expect(trx.scheme).toBe(sales.PAYMENT_SCHEME_SEBAGIAN);
    expect(trx.paymentStatus).toBe('[Terverifikasi - Sebagian]');
  });

  it('the scheduled shortfall is then verifiable installment by installment', async () => {
    const transactionId = await partiallyPaid();
    await attachContract(sql, financeStaff(), transactionId, 'https://drive/c.pdf');
    const created = await scheduleOutstanding(sql, financeStaff(), transactionId, [
      { amount: '2000000', dueDate: '2026-07-10' },
      { amount: '3000000', dueDate: '2026-08-10' },
    ]);

    // A Transaction with open installments now REQUIRES one to be named, even
    // though the declared scheme is [Bayar Sebagian].
    await expect(verifyPayment(sql, financeStaff(), {
      transactionId, amount: '2000000', receivedDate: '2026-07-10',
    })).rejects.toBeInstanceOf(IncompleteError);

    const r1 = await verifyPayment(sql, financeStaff(), {
      transactionId, installmentId: created[0].id, amount: '2000000', receivedDate: '2026-07-10',
    });
    expect(r1.paymentStatus).toBe('[Terverifikasi - Sebagian]');
    expect(money.parse(r1.amountOutstanding)).toBe(money.parse('3000000'));

    const r2 = await verifyPayment(sql, financeStaff(), {
      transactionId, installmentId: created[1].id, amount: '3000000', receivedDate: '2026-08-10',
    });
    expect(r2.paymentStatus).toBe('[Lunas]');
    expect(money.parse(r2.amountOutstanding)).toBe(0n);
    expect((await financeQueue(sql, financeStaff())).map((r) => r.id)).not.toContain(transactionId);
  });
});

describeDb('bermasalahStatus', () => {
  async function flaggedDeal(): Promise<string> {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_LUNAS);
    await flagBermasalah(sql, financeStaff(), transactionId, 'pembayaran ditarik kembali');
    return transactionId;
  }

  it('reports not-flagged before anything happens', async () => {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_LUNAS);
    const s = await bermasalahStatus(sql, financeStaff(), transactionId);
    expect(s.flagged).toBe(false);
    expect(s.votes).toEqual([]);
    expect(s.escalated).toBe(false);
  });

  it('surfaces the flag and each division vote', async () => {
    const transactionId = await flaggedDeal();
    let s = await bermasalahStatus(sql, financeStaff(), transactionId);
    expect(s.flagged).toBe(true);

    await resolveBermasalah(sql, financeLead(), transactionId, VOTE_APPROVE, 'ok dari finance');
    s = await bermasalahStatus(sql, financeStaff(), transactionId);
    expect(s.financeVote).toBe(VOTE_APPROVE);
    expect(s.accountVote).toBe('');
    expect(s.votes).toHaveLength(1);
    expect(s.votes[0].note).toBe('ok dari finance');
  });

  it('escalates when the two SPVs disagree and no Director has ruled', async () => {
    const transactionId = await flaggedDeal();
    await resolveBermasalah(sql, financeLead(), transactionId, VOTE_APPROVE);
    await resolveBermasalah(sql, accountLead(), transactionId, VOTE_REJECT);

    const s = await bermasalahStatus(sql, financeStaff(), transactionId);
    expect(s.flagged).toBe(true);
    expect(s.escalated).toBe(true);
  });

  /**
   * REGRESSION: resolveBermasalah wrote a Director's vote under 'Management'
   * while the Go reader keys on 'Director', so directorVote stayed empty and a
   * case could read as escalated after a Director had already ruled against it.
   */
  it('maps a Director ruling onto directorVote and clears escalation', async () => {
    const transactionId = await flaggedDeal();
    await resolveBermasalah(sql, financeLead(), transactionId, VOTE_APPROVE);
    await resolveBermasalah(sql, accountLead(), transactionId, VOTE_REJECT);
    await resolveBermasalah(sql, director(), transactionId, VOTE_REJECT, 'ditolak direksi');

    const s = await bermasalahStatus(sql, financeStaff(), transactionId);
    expect(s.directorVote).toBe(VOTE_REJECT);
    expect(s.escalated).toBe(false);

    const stored = await sql<{ division: string }[]>`
      select division from transaction_issue_approvals
      where transaction_id = ${transactionId} and created_by = 'ZZ-DIR'`;
    expect(stored[0].division).toBe('Director');
  });

  it('counts only the CURRENT cycle — a re-flag drops earlier votes', async () => {
    const transactionId = await flaggedDeal();
    await resolveBermasalah(sql, financeLead(), transactionId, VOTE_APPROVE);
    // Director approval resolves and clears the flag, then it is raised again.
    await resolveBermasalah(sql, director(), transactionId, VOTE_APPROVE);
    await flagBermasalah(sql, financeStaff(), transactionId, 'ditarik lagi');

    const s = await bermasalahStatus(sql, financeStaff(), transactionId);
    expect(s.flagged).toBe(true);
    expect(s.financeVote).toBe('');
    expect(s.directorVote).toBe('');
    expect(s.votes).toEqual([]);
  });

  it('follows Transaction visibility — Account cannot read it pre-release', async () => {
    const transactionId = await flaggedDeal();
    await expect(bermasalahStatus(sql, accountLead(), transactionId))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});
